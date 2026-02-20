import { env } from './config/env';
import { createBot } from './adapters/telegram/bot';
import { handleStripeWebhook, setBillingBotInstance } from './services/billing/stripeService';
import { SessionStateMachine } from './core/stateMachine/sessionStateMachine';
import { orchestrateSessionClose } from './core/orchestrator/sessionCloseOrchestrator';
import { prisma } from './db/client';
import { logger } from './utils/logger';
import { decrypt } from './utils/encryption';
import { Telegraf } from 'telegraf';
import http from 'http';

async function main(): Promise<void> {
  logger.info('RuthBot starting...', {
    nodeEnv: env.NODE_ENV,
    model: env.CLAUDE_MODEL,
  });

  // Create bot
  const bot = createBot();

  // Set bot instance for billing notifications
  setBillingBotInstance(bot);

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
  startPeriodicTasks(bot);

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
      logger.info(`RuthBot running in webhook mode on port ${env.PORT}`);
    });
  } else {
    // Polling mode for development
    server.listen(env.PORT, () => {
      logger.info(`HTTP server running on port ${env.PORT} (Stripe webhooks + health)`);
    });

    await bot.launch();
    logger.info('RuthBot running in polling mode (development)');
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
function startPeriodicTasks(bot: Telegraf): void {
  // Auto-close expired PAUSED sessions (every 5 minutes)
  setInterval(async () => {
    try {
      const closedCount = await SessionStateMachine.closeExpiredSessions(env.SESSION_EXPIRY_HOURS);
      if (closedCount > 0) {
        logger.info(`Periodic task: closed ${closedCount} expired sessions`);

        // Trigger session close orchestration for auto-closed sessions
        const recentlyClosed = await prisma.coupleSession.findMany({
          where: {
            status: 'CLOSED',
            closedAt: { gte: new Date(Date.now() - 6 * 60 * 1000) },
          },
          select: { id: true },
        });
        for (const session of recentlyClosed) {
          orchestrateSessionClose(bot, session.id).catch((err) => {
            logger.error('Session close orchestration failed', {
              sessionId: session.id,
              error: err instanceof Error ? err.message : String(err),
            });
          });
        }
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
        await prisma.coupleSession.update({
          where: { id: session.id },
          data: { inviteTokenUsed: true },
        });

        logger.info('Invite token expired', { sessionId: session.id });

        try {
          const userA = await prisma.user.findUnique({
            where: { id: session.userAId },
            select: { telegramId: true },
          });
          if (userA) {
            const telegramIdA = decrypt(userA.telegramId);
            await bot.telegram.sendMessage(
              telegramIdA,
              '⏰ הלינק שיצרת פג תוקף. אפשר ליצור לינק חדש עם /start או לשלוח "הזמן את בן/בת הזוג".'
            );
          }
        } catch (notifyError) {
          logger.error('Failed to notify User A about expired token', {
            sessionId: session.id,
            error: notifyError instanceof Error ? notifyError.message : String(notifyError),
          });
        }
      }
    } catch (error) {
      logger.error('Token expiry check error', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }, 60 * 1000);

  // Auto-pause idle ACTIVE sessions (every 5 minutes)
  setInterval(async () => {
    try {
      const idleThreshold = new Date(Date.now() - env.IDLE_TIMEOUT_MINUTES * 60 * 1000);
      const idleSessions = await prisma.coupleSession.findMany({
        where: {
          status: 'ACTIVE',
          updatedAt: { lt: idleThreshold },
        },
        select: { id: true, userAId: true, userBId: true },
      });

      for (const session of idleSessions) {
        try {
          await SessionStateMachine.transition(session.id, 'PAUSED', { reason: 'idle_timeout' });
          logger.info('Session paused due to idle timeout', { sessionId: session.id });

          // Send idle reminder to both users
          await sendIdleReminder(bot, session, 'הסשן הועבר להשהיה בגלל חוסר פעילות.\n\nתוכלו לחזור בכל שלב — פשוט שלחו הודעה כדי להמשיך.');
        } catch (transitionError) {
          logger.error('Failed to pause idle session', {
            sessionId: session.id,
            error: transitionError instanceof Error ? transitionError.message : String(transitionError),
          });
        }
      }
    } catch (error) {
      logger.error('Idle timeout check error', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }, 5 * 60 * 1000);

  // Auto-decline PENDING_PARTNER_CONSENT sessions after 15 min (every 2 minutes)
  setInterval(async () => {
    try {
      const consentTimeout = new Date(Date.now() - 15 * 60 * 1000);
      const pendingConsent = await prisma.coupleSession.findMany({
        where: {
          status: 'PENDING_PARTNER_CONSENT',
          updatedAt: { lt: consentTimeout },
        },
        select: { id: true, userAId: true },
      });

      for (const session of pendingConsent) {
        try {
          await SessionStateMachine.transition(session.id, 'PARTNER_DECLINED', {
            reason: 'consent_timeout_15min',
          });
          logger.info('Partner consent timed out — auto-declined', { sessionId: session.id });

          // Notify User A
          const userA = await prisma.user.findUnique({
            where: { id: session.userAId },
            select: { telegramId: true },
          });
          if (userA) {
            const telegramIdA = decrypt(userA.telegramId);
            await bot.telegram.sendMessage(
              telegramIdA,
              'בן/בת הזוג לא אישר/ה הצטרפות תוך 15 דקות.\n\nמה תרצה לעשות?',
              {
                reply_markup: {
                  inline_keyboard: [
                    [{ text: '🔄 שלח תזכורת', callback_data: `partner_declined:reminder:${session.id}` }],
                    [{ text: '🧘 להמשיך לבד', callback_data: `partner_declined:solo:${session.id}` }],
                    [{ text: '❌ סגור סשן', callback_data: `partner_declined:close:${session.id}` }],
                  ],
                },
              }
            );
          }
        } catch (transitionError) {
          logger.error('Failed to auto-decline partner consent', {
            sessionId: session.id,
            error: transitionError instanceof Error ? transitionError.message : String(transitionError),
          });
        }
      }
    } catch (error) {
      logger.error('Partner consent timeout check error', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }, 2 * 60 * 1000);

  // Send reminders to PAUSED sessions before auto-close (every 5 minutes)
  setInterval(async () => {
    try {
      // Sessions paused for more than half the expiry time get a reminder
      const reminderThreshold = new Date(Date.now() - (env.SESSION_EXPIRY_HOURS * 60 * 60 * 1000) / 2);
      const pausedSessions = await prisma.coupleSession.findMany({
        where: {
          status: 'PAUSED',
          updatedAt: { lt: reminderThreshold },
        },
        select: { id: true, userAId: true, userBId: true },
      });

      for (const session of pausedSessions) {
        const hoursLeft = Math.round(env.SESSION_EXPIRY_HOURS / 2);
        await sendIdleReminder(
          bot,
          session,
          `⏰ הסשן שלכם בהשהיה כבר זמן מה. אם לא תחזרו תוך ${hoursLeft} שעות, הסשן ייסגר אוטומטית.\n\nשלחו הודעה כדי להמשיך.`
        );
      }
    } catch (error) {
      logger.error('Paused session reminder error', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }, 5 * 60 * 1000);
}

/**
 * Send a reminder to both users in a session.
 */
async function sendIdleReminder(
  bot: Telegraf,
  session: { userAId: string; userBId: string | null },
  message: string
): Promise<void> {
  const userIds = [session.userAId];
  if (session.userBId) userIds.push(session.userBId);

  for (const userId of userIds) {
    try {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { telegramId: true },
      });
      if (user) {
        const telegramId = decrypt(user.telegramId);
        await bot.telegram.sendMessage(telegramId, message);
      }
    } catch (error) {
      logger.error('Failed to send idle reminder', {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

main().catch((error) => {
  logger.error('Fatal error', {
    error: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
  });
  process.exit(1);
});
