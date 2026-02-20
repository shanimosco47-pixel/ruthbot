import { Context, Markup } from 'telegraf';
import { prisma } from '../../../db/client';
import { hmacHash } from '../../../utils/encryption';
import { logger } from '../../../utils/logger';

/**
 * Handle /delete_my_data command.
 * GDPR: Delete PII immediately, retain anonymized telemetry.
 */
export async function handleDeleteMyData(ctx: Context): Promise<void> {
  if (!ctx.from) return;

  await ctx.reply(
    '⚠️ אזהרה: מחיקת נתונים היא בלתי הפיכה.\n\nהפעולה תמחק את כל המידע האישי שלך (שם, טלגרם ID, אימייל, פרטי תשלום).\nנתונים אנונימיים יישמרו לשיפור השירות.\n\nלהמשיך?',
    Markup.inlineKeyboard([
      [Markup.button.callback('🗑️ כן, מחק את הנתונים שלי', `delete_confirm:yes`)],
      [Markup.button.callback('❌ ביטול', `delete_confirm:no`)],
    ])
  );
}

/**
 * Execute the actual data deletion.
 */
export async function handleDeleteConfirmation(ctx: Context, telegramId: string): Promise<void> {
  try {
    // O(1) lookup using HMAC hash
    const hash = hmacHash(telegramId);
    const targetUser = await prisma.user.findUnique({
      where: { telegramIdHash: hash },
      select: { id: true },
    });

    const targetUserId = targetUser?.id || null;

    if (!targetUserId) {
      await ctx.reply('לא נמצאו נתונים למחיקה.');
      return;
    }

    // Delete messages associated with this user's sessions
    const sessionsAsA = await prisma.coupleSession.findMany({
      where: { userAId: targetUserId },
      select: { id: true },
    });

    const sessionsAsB = await prisma.coupleSession.findMany({
      where: { userBId: targetUserId },
      select: { id: true },
    });

    const allSessionIds = [
      ...sessionsAsA.map((s) => s.id),
      ...sessionsAsB.map((s) => s.id),
    ];

    // Delete messages
    if (allSessionIds.length > 0) {
      await prisma.message.deleteMany({
        where: { sessionId: { in: allSessionIds } },
      });

      // Delete risk events
      await prisma.riskEvent.deleteMany({
        where: { sessionId: { in: allSessionIds } },
      });
    }

    // Remove user from sessions (nullify references)
    await prisma.coupleSession.updateMany({
      where: { userBId: targetUserId },
      data: { userBId: null },
    });

    // For sessions where user is A, close them
    await prisma.coupleSession.updateMany({
      where: { userAId: targetUserId },
      data: { status: 'CLOSED', closedAt: new Date() },
    });

    // Delete the PII user record
    // First remove the foreign key constraints
    await prisma.coupleSession.updateMany({
      where: { billingOwnerId: targetUserId },
      data: { billingOwnerId: null },
    });

    await prisma.user.delete({
      where: { id: targetUserId },
    });

    // Note: SessionTelemetry and SessionEmbedding are kept (anonymized, no PII)
    // This is permitted under GDPR Art. 89 for statistical purposes

    logger.info('User data deleted (GDPR)', { userId: targetUserId });

    await ctx.reply(
      '✅ הנתונים האישיים שלך נמחקו.\n\nנתונים אנונימיים (ללא פרטים מזהים) נשמרים לשיפור השירות.\n\nתודה שהשתמשת ברות בוט זוגיות. ❤️'
    );
  } catch (error) {
    logger.error('Data deletion failed', {
      telegramId,
      error: error instanceof Error ? error.message : String(error),
    });
    await ctx.reply('אירעה שגיאה במחיקת הנתונים. נסה/י שוב מאוחר יותר.');
  }
}
