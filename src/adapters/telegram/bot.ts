import { Telegraf } from 'telegraf';
import { env } from '../../config/env';
import { logger } from '../../utils/logger';
import { handleStart } from './handlers/startHandler';
import { handleMessage } from './handlers/messageHandler';
import { handleVoice } from './handlers/voiceHandler';
import { handleCallbackQuery, userStates, cleanupSessionState } from './handlers/callbackHandler';
import { handleDeleteMyData } from './handlers/deleteHandler';
import { withSessionLock } from '../../utils/sessionLock';
import { SessionManager } from '../../core/stateMachine/sessionManager';
import { SessionStateMachine } from '../../core/stateMachine/sessionStateMachine';
import { orchestrateSessionClose } from '../../core/orchestrator/sessionCloseOrchestrator';

export function createBot(): Telegraf {
  const bot = new Telegraf(env.TELEGRAM_BOT_TOKEN);

  // Error handler
  bot.catch((err, ctx) => {
    logger.error('Bot error', {
      error: err instanceof Error ? err.message : String(err),
      updateType: ctx.updateType,
      chatId: ctx.chat?.id,
    });
  });

  // /start command — handles both fresh starts and deep links
  bot.start(async (ctx) => {
    const telegramId = ctx.from.id.toString();
    const lockKey = `user:${telegramId}`;

    await withSessionLock(lockKey, async () => {
      await handleStart(ctx);
    });
  });

  // /delete_my_data command
  bot.command('delete_my_data', async (ctx) => {
    const telegramId = ctx.from.id.toString();
    const lockKey = `user:${telegramId}`;

    await withSessionLock(lockKey, async () => {
      await handleDeleteMyData(ctx);
    });
  });

  // /stop command — properly close session
  bot.command('stop', async (ctx) => {
    const telegramId = ctx.from.id.toString();
    const lockKey = `user:${telegramId}`;

    await withSessionLock(lockKey, async () => {
      const userId = await SessionManager.findOrCreateUser(telegramId, ctx.from.first_name);
      const activeSession = await SessionManager.getActiveSession(userId);

      if (!activeSession) {
        await ctx.reply('אין סשן פתוח.');
        return;
      }

      try {
        await SessionStateMachine.transition(activeSession.id, 'CLOSED', { reason: 'user_stop_command' });

        // Trigger session close orchestration (summaries, email, telemetry)
        orchestrateSessionClose(bot, activeSession.id).catch((error) => {
          logger.error('Session close orchestration failed', {
            sessionId: activeSession.id,
            error: error instanceof Error ? error.message : String(error),
          });
        });

        await ctx.reply('הסשן נסגר. תודה שהשתמשת ברות בוט זוגיות ❤️\nאפשר תמיד להתחיל מחדש עם /start');
      } catch (error) {
        logger.error('/stop transition failed', {
          sessionId: activeSession.id,
          status: activeSession.status,
          error: error instanceof Error ? error.message : String(error),
        });
        await ctx.reply('לא ניתן לסגור את הסשן במצבו הנוכחי.');
      }

      // Clean up all in-memory state for this session and user
      cleanupSessionState(activeSession.id);
      userStates.delete(telegramId);
    });
  });

  // Text messages
  bot.on('text', async (ctx) => {
    const telegramId = ctx.from.id.toString();
    const lockKey = `user:${telegramId}`;

    await withSessionLock(lockKey, async () => {
      await handleMessage(ctx);
    });
  });

  // Voice messages
  bot.on('voice', async (ctx) => {
    const telegramId = ctx.from.id.toString();
    const lockKey = `user:${telegramId}`;

    await withSessionLock(lockKey, async () => {
      await handleVoice(ctx);
    });
  });

  // Callback queries (inline keyboard buttons)
  bot.on('callback_query', async (ctx) => {
    if (!('data' in ctx.callbackQuery)) return;

    const telegramId = ctx.from.id.toString();
    const lockKey = `user:${telegramId}`;

    await withSessionLock(lockKey, async () => {
      await handleCallbackQuery(ctx);
    });
  });

  return bot;
}
