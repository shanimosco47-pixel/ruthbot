import { Telegraf } from 'telegraf';
import { env } from '../../config/env';
import { logger } from '../../utils/logger';
import { handleStart } from './handlers/startHandler';
import { handleMessage } from './handlers/messageHandler';
import { handleVoice } from './handlers/voiceHandler';
import { handleCallbackQuery } from './handlers/callbackHandler';
import { handleDeleteMyData } from './handlers/deleteHandler';
import { withSessionLock } from '../../utils/sessionLock';

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

  // /stop command
  bot.command('stop', async (ctx) => {
    await ctx.reply(
      'הסשן נסגר. תודה שהשתמשת ב-CoupleBot. אפשר תמיד להתחיל מחדש עם /start'
    );
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
