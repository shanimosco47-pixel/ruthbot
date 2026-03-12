import { Context } from 'telegraf';
import { prisma } from '../db/client';
import { encrypt } from './encryption';
import { logger } from './logger';
import type { SenderRole } from '@prisma/client';

/**
 * RC0 FIX: Send a bot message AND store it in the DB.
 *
 * Wraps ctx.reply() so every outgoing bot message within a session
 * is persisted as a SYSTEM message. This closes the logging gap where
 * only pipeline messages (COACHING / REFRAME) were stored.
 *
 * For messages outside a session context, pass sessionId = null
 * and the message is sent but not stored (no orphan rows).
 */
export async function trackedReply(
  ctx: Context,
  text: string,
  opts: {
    sessionId?: string | null;
    senderRole?: SenderRole;
    extra?: Parameters<Context['reply']>[1];
  } = {}
): Promise<void> {
  const { sessionId = null, senderRole = 'USER_A', extra } = opts;

  // Send the message first — user experience is priority
  await ctx.reply(text, extra);

  // Store in DB if we have a session context
  if (sessionId) {
    try {
      await prisma.message.create({
        data: {
          sessionId,
          senderRole,
          messageType: 'SYSTEM',
          rawContent: encrypt(text),
        },
      });
    } catch (error) {
      // Non-critical: don't crash the flow if logging fails
      logger.warn('trackedReply: failed to store bot message', {
        sessionId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

/**
 * Store a bot message sent via bot.telegram.sendMessage() (no ctx).
 * Used for cross-chat messages (e.g., notifying User A from User B's handler).
 */
export async function logBotMessage(
  sessionId: string,
  text: string,
  senderRole: SenderRole = 'USER_A'
): Promise<void> {
  try {
    await prisma.message.create({
      data: {
        sessionId,
        senderRole,
        messageType: 'SYSTEM',
        rawContent: encrypt(text),
      },
    });
  } catch (error) {
    logger.warn('logBotMessage: failed to store bot message', {
      sessionId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
