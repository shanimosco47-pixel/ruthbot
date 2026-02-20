import { env } from './config/env';
import { createBot } from './adapters/telegram/bot';
import { handleStripeWebhook } from './services/billing/stripeService';
import { SessionStateMachine } from './core/stateMachine/sessionStateMachine';
import { prisma } from './db/client';
import { logger } from './utils/logger';
import http from 'http';

async function main(): Promise<void> {
  logger.info('CoupleBot starting...', {
    nodeEnv: env.NODE_ENV,
    model: env.CLAUDE_MODEL,
  });

  // Create bot
  const bot = createBot();

  // Create HTTP server for Stripe webhooks
  const server = http.createServer(async (req, res) => {
    if (req.method === 'POST' && req.url === '/stripe/webhook') {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk.toString();
      });
      req.on('end', async () => {
        try {
          const signature = req.headers['stripe-signature'] as string;
          await handleStripeWebhook(body, signature);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ received: true }));
        } catch (error) {
          logger.error('Stripe webhook error', {
            error: error instanceof Error ? error.message : String(error),
          });
          // Always return 200 to Stripe to prevent redelivery loops
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ received: true }));
        }
      });
    } else if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', timestamp: new Date().toISOString() }));
    } else {
      res.writeHead(404);
      res.end();
    }
  });

  // Start periodic tasks
  startPeriodicTasks();

  // Launch bot
  if (env.NODE_ENV === 'production' && env.WEBHOOK_URL) {
    // Webhook mode for production
    const webhookPath = `/telegram/webhook`;
    await bot.telegram.setWebhook(`${env.WEBHOOK_URL}${webhookPath}`, {
      secret_token: env.TELEGRAM_WEBHOOK_SECRET,
    });

    // Add Telegram webhook handler to HTTP server
    const originalHandler = server.listeners('request')[0] as Function;
    server.removeAllListeners('request');

    server.on('request', async (req, res) => {
      if (req.method === 'POST' && req.url === webhookPath) {
        // Verify secret token
        const secretToken = req.headers['x-telegram-bot-api-secret-token'];
        if (env.TELEGRAM_WEBHOOK_SECRET && secretToken !== env.TELEGRAM_WEBHOOK_SECRET) {
          res.writeHead(403);
          res.end();
          return;
        }

        let body = '';
        req.on('data', (chunk) => {
          body += chunk.toString();
        });
        req.on('end', async () => {
          try {
            const update = JSON.parse(body);
            await bot.handleUpdate(update);
            res.writeHead(200);
            res.end();
          } catch (error) {
            logger.error('Telegram webhook processing error', {
              error: error instanceof Error ? error.message : String(error),
            });
            res.writeHead(200);
            res.end();
          }
        });
      } else {
        originalHandler(req, res);
      }
    });

    server.listen(env.PORT, () => {
      logger.info(`CoupleBot running in webhook mode on port ${env.PORT}`);
    });
  } else {
    // Polling mode for development
    server.listen(env.PORT, () => {
      logger.info(`HTTP server running on port ${env.PORT} (Stripe webhooks + health)`);
    });

    await bot.launch();
    logger.info('CoupleBot running in polling mode (development)');
  }

  // Graceful shutdown
  const shutdown = async (signal: string): Promise<void> => {
    logger.info(`${signal} received. Shutting down...`);
    bot.stop(signal);
    server.close();
    await prisma.$disconnect();
    process.exit(0);
  };

  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));
}

/**
 * Periodic background tasks.
 */
function startPeriodicTasks(): void {
  // Auto-close expired sessions (every 5 minutes)
  setInterval(async () => {
    try {
      const closed = await SessionStateMachine.closeExpiredSessions(env.SESSION_EXPIRY_HOURS);
      if (closed > 0) {
        logger.info(`Periodic task: closed ${closed} expired sessions`);
      }
    } catch (error) {
      logger.error('Periodic task error', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }, 5 * 60 * 1000);

  // Check for expired invite tokens (every minute)
  setInterval(async () => {
    try {
      const expired = await prisma.coupleSession.findMany({
        where: {
          status: 'INVITE_PENDING',
          inviteTokenExpiresAt: { lt: new Date() },
          inviteTokenUsed: false,
        },
        select: { id: true, userAId: true },
      });

      for (const session of expired) {
        // Invalidate token
        await prisma.coupleSession.update({
          where: { id: session.id },
          data: { inviteTokenUsed: true },
        });

        logger.info('Invite token expired', { sessionId: session.id });

        // TODO: Notify User A that the link expired
        // This requires access to the bot instance to send messages
      }
    } catch (error) {
      logger.error('Token expiry check error', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }, 60 * 1000);
}

main().catch((error) => {
  logger.error('Fatal error', {
    error: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
  });
  process.exit(1);
});
