import { Context, Markup } from 'telegraf';
import { SessionManager } from '../../../core/stateMachine/sessionManager';
import { prisma } from '../../../db/client';
import { hmacHash } from '../../../utils/encryption';
import { logger } from '../../../utils/logger';
import { trackedReply, logBotMessage } from '../../../utils/trackedReply';

const DISCLAIMER_HE = `⚖️ *לפני שמתחילים — חשוב שתדע/י:*

• הבוט הזה הוא לא מטפל מורשה, פסיכולוג או מגשר משפטי.
• תוכן שמשותף ישמש רק לצורך הסשן הנוכחי ולניתוח דפוסים אנונימי. הוא לא נמכר ולא משותף עם צד שלישי.
• נתוני שיחה אנונימיים עשויים לשמש לשיפור השירות.
• במצבי חירום, הבוט יספק משאבי חירום ויעצור את הסשן.
• השימוש מותר מגיל 18 ומעלה.`;

/**
 * Handle /start command.
 * - Fresh start: Show disclaimer → create session
 * - Deep link (token): User B joining via invite link
 */
export async function handleStart(ctx: Context): Promise<void> {
  if (!ctx.from) return;

  const telegramId = ctx.from.id.toString();
  const firstName = ctx.from.first_name || '';

  // Check for deep link payload (invite token)
  const payload = (ctx as unknown as { startPayload?: string }).startPayload;

  // Handle special deep link payloads
  if (payload === 'unsubscribe') {
    await handleUnsubscribe(ctx, telegramId);
    return;
  }

  if (payload && payload.length === 64) {
    // User B clicking invite link
    await handleDeepLinkStart(ctx, telegramId, firstName, payload);
    return;
  }

  // Fresh start — User A flow
  await handleFreshStart(ctx, telegramId, firstName);
}

async function handleFreshStart(ctx: Context, telegramId: string, firstName: string): Promise<void> {
  // Check if user already has an active session
  const userId = await SessionManager.findOrCreateUser(telegramId, firstName);
  const activeSession = await SessionManager.getActiveSession(userId);

  if (activeSession) {
    await ctx.reply(
      `היי ${firstName} 👋\n\nיש לך כבר סשן פתוח. אתה יכול להמשיך לכתוב, או להקליד /stop כדי לסגור אותו ולהתחיל חדש.`
    );
    return;
  }

  // Show disclaimer
  await ctx.reply(DISCLAIMER_HE, {
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard([
      [Markup.button.callback('✅ אני מבין/ה ומסכים/ה', `disclaimer_accept:${telegramId}`)],
    ]),
  });

  logger.info('Disclaimer shown to new user', { telegramId });
}

async function handleDeepLinkStart(
  ctx: Context,
  telegramId: string,
  firstName: string,
  token: string
): Promise<void> {
  logger.info('Deep link start — User B', { telegramId, tokenLength: token.length });

  // Consume the invite token
  const result = await SessionManager.consumeInviteToken(token, telegramId);

  if ('error' in result) {
    await ctx.reply(result.error);
    return;
  }

  const { sessionId } = result;

  // Get session details for the soft landing message
  const session = await SessionManager.getSession(sessionId);
  if (!session) {
    await ctx.reply('אירעה שגיאה. נסה/י שוב.');
    return;
  }

  // Get the topic category from the latest risk event
  const latestRisk = await getSessionTopicCategory(sessionId);
  const topicCategory = latestRisk || 'משהו שחשוב לי לשתף';

  // Soft landing message (Section 2.5 Phase 2)
  const softLanding = `היי ${firstName} 👋

בן/בת הזוג שלך פתח/ה את הסשן הזה כי הקשר שלכם חשוב לו/ה.

אני רות, בוט זוגיות. אני עובדת עם כל אחד מכם בנפרד — בשיחה פרטית. אף אחד לא רואה מה השני כותב. אני המתווכת — עוזרת לנסח את מה שחשוב להעביר, ורק אחרי אישור מעבירה את הניסוח לצד השני.

📌 נושא הסשן: ${topicCategory}`;

  await trackedReply(ctx, softLanding, { sessionId, senderRole: 'USER_B' });

  // Show disclaimer + consent button
  await ctx.reply(DISCLAIMER_HE, {
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard([
      [Markup.button.callback('✅ אני מבין/ה ומסכים/ה', `consent_accept:${sessionId}`)],
    ]),
  });

  // Notify User A that partner opened the link
  const notifyMsg = 'בן/בת הזוג פתח/ה את הלינק! 🎉\nממתינים להסכמה...';
  await notifyUserA(ctx, session.userAId, notifyMsg);
  await logBotMessage(sessionId, notifyMsg, 'USER_A');
}

async function handleUnsubscribe(ctx: Context, telegramId: string): Promise<void> {
  const hash = hmacHash(telegramId);
  const user = await prisma.user.findUnique({
    where: { telegramIdHash: hash },
    select: { id: true, emailOptedOut: true },
  });

  if (!user) {
    await ctx.reply('לא נמצא חשבון משויך. הקלד/י /start כדי להתחיל.');
    return;
  }

  if (user.emailOptedOut) {
    await ctx.reply('כבר הוסרת מרשימת התפוצה. לא תקבל/י מיילים נוספים.');
    return;
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { emailOptedOut: true },
  });

  logger.info('User unsubscribed from emails', { userId: user.id });
  await ctx.reply('הוסרת מרשימת התפוצה בהצלחה. לא תקבל/י מיילים נוספים מרות בוט זוגיות.');
}

async function getSessionTopicCategory(sessionId: string): Promise<string | null> {
  const latestRisk = await prisma.riskEvent.findFirst({
    where: { sessionId },
    orderBy: { createdAt: 'desc' },
    select: { topicCategory: true },
  });
  return latestRisk?.topicCategory || null;
}

async function notifyUserA(ctx: Context, userAId: string, message: string): Promise<void> {
  try {
    const { decrypt } = await import('../../../utils/encryption');

    const userA = await prisma.user.findUnique({
      where: { id: userAId },
      select: { telegramId: true },
    });

    if (userA) {
      const telegramIdA = decrypt(userA.telegramId);
      await ctx.telegram.sendMessage(telegramIdA, message);
    }
  } catch (error) {
    logger.error('Failed to notify User A', {
      userAId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
