import { Context, Markup } from 'telegraf';
import { SessionManager } from '../../../core/stateMachine/sessionManager';
import { SessionStateMachine } from '../../../core/stateMachine/sessionStateMachine';
import { callClaude } from '../../../services/ai/claudeClient';
import { requiresPayment, createCheckoutSession } from '../../../services/billing/stripeService';
import { env } from '../../../config/env';
import { logger } from '../../../utils/logger';
import { splitMessage } from '../../../utils/telegramHelpers';
import { decrypt } from '../../../utils/encryption';
import { prisma } from '../../../db/client';
import { MAX_EDIT_ITERATIONS } from '../../../config/constants';
import type { PendingReframe } from '../../../types';

// In-memory store for pending reframes and user states
const pendingReframes = new Map<string, PendingReframe>();
const userStates = new Map<string, {
  state: string;
  sessionId?: string;
  data?: Record<string, unknown>;
}>();

export { userStates, pendingReframes };

/**
 * Clean up all in-memory state for a given session.
 * Called on session close, L4 hard stop, /start restart.
 */
export function cleanupSessionState(sessionId: string): void {
  // Remove all pending reframes for this session
  for (const [messageId, pending] of pendingReframes) {
    if (pending.sessionId === sessionId) {
      pendingReframes.delete(messageId);
    }
  }

  // Remove all user states tied to this session
  for (const [telegramId, state] of userStates) {
    if (state.sessionId === sessionId) {
      userStates.delete(telegramId);
    }
  }
}

/**
 * Handle all inline keyboard callback queries.
 */
export async function handleCallbackQuery(ctx: Context): Promise<void> {
  if (!ctx.callbackQuery || !('data' in ctx.callbackQuery)) return;

  const data = ctx.callbackQuery.data;
  const telegramId = ctx.from?.id.toString();

  if (!telegramId) return;

  await ctx.answerCbQuery();

  try {
    // Route based on callback data prefix
    if (data.startsWith('disclaimer_accept:')) {
      await handleDisclaimerAccept(ctx, telegramId);
    } else if (data.startsWith('consent_accept:')) {
      await handleConsentAccept(ctx, telegramId, data);
    } else if (data.startsWith('onboard_choice:')) {
      await handleOnboardingChoice(ctx, telegramId, data);
    } else if (data.startsWith('ttl_choice:')) {
      await handleTtlChoice(ctx, telegramId, data);
    } else if (data.startsWith('telegram_check:')) {
      await handleTelegramCheck(ctx, telegramId, data);
    } else if (data.startsWith('invite_draft:')) {
      await handleInviteDraftChoice(ctx, telegramId, data);
    } else if (data.startsWith('reframe_approve:')) {
      await handleReframeApprove(ctx, telegramId, data);
    } else if (data.startsWith('reframe_edit:')) {
      await handleReframeEdit(ctx, telegramId, data);
    } else if (data.startsWith('reframe_cancel:')) {
      await handleReframeCancel(ctx, telegramId, data);
    } else if (data.startsWith('partner_declined:')) {
      await handlePartnerDeclinedChoice(ctx, telegramId, data);
    } else if (data.startsWith('email_opt:')) {
      await handleEmailOptChoice(ctx, telegramId, data);
    } else if (data.startsWith('delete_confirm:')) {
      await handleDeleteConfirm(ctx, telegramId, data);
    } else {
      logger.warn('Unknown callback query', { data, telegramId });
    }
  } catch (error) {
    logger.error('Callback handler error', {
      data,
      telegramId,
      error: error instanceof Error ? error.message : String(error),
    });
    await ctx.reply('אירעה שגיאה. נסה/י שוב.');
  }
}

// ============================================
// Disclaimer Accept (User A)
// ============================================

async function handleDisclaimerAccept(ctx: Context, telegramId: string): Promise<void> {
  const userId = await SessionManager.findOrCreateUser(telegramId, ctx.from?.first_name);
  const sessionId = await SessionManager.createSession(userId);

  logger.info('Disclaimer accepted, session created', { telegramId, sessionId });

  // Payment gate: check if this non-trial session requires payment
  const needsPayment = await requiresPayment(sessionId);
  if (needsPayment) {
    const botInfo = await ctx.telegram.getMe();
    const checkoutUrl = await createCheckoutSession({
      sessionId,
      userId,
      botUsername: botInfo.username || env.BOT_USERNAME,
    });

    if (checkoutUrl) {
      await ctx.reply(
        '💳 הסשן הראשון שלך היה חינם. כדי להמשיך, צריך מנוי פעיל.\n\nלאחר התשלום, הקלד/י /start כדי להתחיל סשן חדש.',
        Markup.inlineKeyboard([
          [Markup.button.url('💳 לתשלום', checkoutUrl)],
        ])
      );
    } else {
      await ctx.reply(
        '⚠️ אירעה שגיאה ביצירת קישור לתשלום. נסה/י שוב בעוד רגע.'
      );
    }
    return;
  }

  // Ask: join partner now or work alone first? (Section 2.5, 1A)
  await ctx.reply(
    'רוצה לעבד לבד קודם, או להזמין את בן/בת הזוג? (כל אחד בשיחה פרטית נפרדת איתי)',
    Markup.inlineKeyboard([
      [Markup.button.callback('🤝 להזמין עכשיו', `onboard_choice:invite:${sessionId}`)],
      [Markup.button.callback('🧘 לעבד לבד קודם', `onboard_choice:solo:${sessionId}`)],
    ])
  );

  await ctx.reply('אפשר תמיד להזמין את בן/בת הזוג מאוחר יותר — בכל שלב בסשן.');
}

// ============================================
// Onboarding Choice
// ============================================

async function handleOnboardingChoice(ctx: Context, telegramId: string, data: string): Promise<void> {
  const parts = data.split(':');
  const choice = parts[1]; // 'invite' or 'solo'
  const sessionId = parts[2];

  if (choice === 'solo') {
    // Transition to ASYNC_COACHING
    await SessionStateMachine.transition(sessionId, 'ASYNC_COACHING', { reason: 'user_chose_solo' });

    // RULE 0: First message MUST be the intake template
    await ctx.reply(
      `שלום! אני רות, מנחה זוגי.
בואו נתחיל בתלוש (משפט אחד לכל שאלה):
1️⃣ מה קרה?
2️⃣ מה אתה רוצה שיקרה בסוף?
3️⃣ מה אסור שיקרה?`
    );

    userStates.set(telegramId, { state: 'coaching', sessionId });
  } else {
    // Start invitation flow (1B)
    await ctx.reply(
      'מה הדבר הכי חשוב שאתה רוצה שהם ידעו לפני שנכנסים?'
    );

    userStates.set(telegramId, { state: 'invitation_drafting', sessionId });
  }
}

// ============================================
// TTL Choice
// ============================================

async function handleTtlChoice(ctx: Context, telegramId: string, data: string): Promise<void> {
  const parts = data.split(':');
  const ttlHours = parseInt(parts[1], 10) as 1 | 3 | 12;
  const sessionId = parts[2];

  const state = userStates.get(telegramId);
  if (!state || !state.sessionId) return;

  // Get bot username
  const botInfo = await ctx.telegram.getMe();
  const botUsername = botInfo.username;

  const { link } = await SessionManager.generateInviteLink(
    sessionId,
    ttlHours,
    botUsername
  );

  const invitationMessage = state.data?.invitationMessage as string || '';

  // Send shareable package (Section 2.5, 1D)
  const shareableText = `✉️ העתק ושלח לבן/בת הזוג בוואטסאפ או בטלגרם:

"${invitationMessage}"

🔗 הלינק לסשן: ${link}

💡 שלח את ההודעה והלינק ביחד, בהודעה אחת.`;

  await ctx.reply(shareableText);
  await ctx.reply(
    `⏰ הלינק פעיל למשך ${ttlHours === 1 ? 'שעה אחת' : ttlHours === 3 ? '3 שעות' : '12 שעות'}.\n\nבינתיים, אני כאן אם תרצה/י להמשיך לעבד לבד.`
  );

  userStates.set(telegramId, { state: 'coaching', sessionId });
}

// ============================================
// Telegram Check (1E)
// ============================================

async function handleTelegramCheck(ctx: Context, telegramId: string, data: string): Promise<void> {
  const parts = data.split(':');
  const answer = parts[1]; // 'yes', 'unsure', 'no'
  const sessionId = parts[2];

  const hasTelegram = answer === 'yes' ? true : answer === 'no' ? false : null;
  const variant = answer === 'yes' ? 'standard' : 'no_telegram';

  await SessionManager.setPartnerHasTelegram(sessionId, hasTelegram, variant as 'standard' | 'no_telegram');

  if (answer === 'yes') {
    // Proceed to TTL selection
    await showTtlSelection(ctx, sessionId);
  } else {
    // Modified invitation text explaining Telegram download
    await ctx.reply(
      'לא נורא! הלינק עובד גם אם הם יורידים טלגרם עכשיו. הנה טקסט הזמנה שמסביר למה אנחנו בטלגרם:'
    );

    const state = userStates.get(telegramId);
    const invitationMessage = (state?.data?.invitationMessage as string) || '';

    const modifiedText = `היי, פתחתי לנו סשן ברות בוט זוגיות. חשוב לי שנדבר בצורה רגועה שמכבדת את שנינו.

כל אחד מדבר עם הבוט בנפרד, בשיחה פרטית. הבוט הוא המתווך — עוזר לנסח ומעביר רק מה שמאושר. הבוט יושב בטלגרם כדי שהשיחות יהיו הכי פרטיות ומאובטחות.

אם אין לך את האפליקציה, זה ייקח דקה להוריד. אשמח שתיכנס/י.

${invitationMessage ? `\n${invitationMessage}` : ''}`;

    if (state) {
      state.data = { ...state.data, invitationMessage: modifiedText };
      userStates.set(telegramId, state);
    }

    await showTtlSelection(ctx, sessionId);
  }
}

async function showTtlSelection(ctx: Context, sessionId: string): Promise<void> {
  await ctx.reply(
    'כמה זמן תרצה שהלינק יהיה פתוח?',
    Markup.inlineKeyboard([
      [Markup.button.callback('⚡ שעה אחת', `ttl_choice:1:${sessionId}`)],
      [Markup.button.callback('🕐 3 שעות', `ttl_choice:3:${sessionId}`)],
      [Markup.button.callback('🌙 12 שעות', `ttl_choice:12:${sessionId}`)],
    ])
  );

  await ctx.reply('טיפ: אם הם בעבודה או בפגישה כרגע, בחר/י 3 שעות לפחות.');
}

// ============================================
// Consent Accept (User B)
// ============================================

async function handleConsentAccept(ctx: Context, telegramId: string, data: string): Promise<void> {
  const sessionId = data.split(':')[1];

  // NOW we can store User B's data (GDPR: only after consent)
  const userId = await SessionManager.findOrCreateUser(telegramId, ctx.from?.first_name);
  await SessionManager.recordPartnerConsent(sessionId, userId);

  // Get the reframed message to show User B
  const session = await SessionManager.getSession(sessionId);
  if (!session) return;

  // Find the latest approved reframe
  const latestReframe = await prisma.message.findFirst({
    where: {
      sessionId,
      messageType: 'REFRAME',
      approved: true,
    },
    orderBy: { createdAt: 'desc' },
    select: { reframedContent: true },
  });

  // Decrypt reframed content (stored encrypted at rest)
  let reframedText = '';
  if (latestReframe?.reframedContent) {
    try {
      reframedText = decrypt(latestReframe.reframedContent);
    } catch {
      reframedText = latestReframe.reframedContent;
    }

    // Deliver the reframe (Section 2.5, Phase 3, 3A)
    await ctx.reply(
      `בן/בת הזוג שלך ביקש/ה להעביר לך את הדברים הבאים. ביקשתי ממנו/ממנה לנסח אותם בצורה שתאפשר לכם לדבר בצורה רגועה:\n\n— ${reframedText} —`
    );
  }

  // Start Reflection Gate (Section 2.5, Phase 3, 3B)
  await ctx.reply(
    'לפני שנגיב — מה הדבר הראשון שאתה מרגיש כשאתה קורא את זה?'
  );

  userStates.set(telegramId, {
    state: 'reflection_gate_step1',
    sessionId,
    data: { reframedContent: reframedText },
  });
}

// ============================================
// Reframe Approval Flow (Rule 2)
// ============================================

async function handleReframeApprove(ctx: Context, _telegramId: string, data: string): Promise<void> {
  const messageId = data.split(':')[1];
  const pending = pendingReframes.get(messageId);

  if (!pending) {
    await ctx.reply('ההודעה כבר לא זמינה.');
    return;
  }

  // Mark as approved and delivered
  await prisma.message.update({
    where: { id: messageId },
    data: { approved: true, delivered: true, reframedContent: pending.reframedText },
  });

  // Deliver to partner
  await deliverToPartner(ctx, pending);

  pendingReframes.delete(messageId);

  await ctx.reply('✅ ההודעה נשלחה.');
}

async function handleReframeEdit(ctx: Context, telegramId: string, data: string): Promise<void> {
  const messageId = data.split(':')[1];
  const pending = pendingReframes.get(messageId);

  if (!pending) {
    await ctx.reply('ההודעה כבר לא זמינה.');
    return;
  }

  if (pending.editIterations >= MAX_EDIT_ITERATIONS) {
    // Max iterations reached — only cancel is available
    await ctx.reply(
      'הגעת למספר המקסימלי של עריכות.',
      Markup.inlineKeyboard([
        [Markup.button.callback('❌ בטל / אל תשלח', `reframe_cancel:${messageId}`)],
      ])
    );
    return;
  }

  await ctx.reply('כתוב/י את הגרסה שלך:');

  userStates.set(telegramId, {
    state: 'editing_reframe',
    sessionId: pending.sessionId,
    data: { messageId },
  });
}

async function handleReframeCancel(ctx: Context, telegramId: string, data: string): Promise<void> {
  const messageId = data.split(':')[1];
  pendingReframes.delete(messageId);

  await ctx.reply('ההודעה בוטלה. הסשן ממשיך — אתה יכול להמשיך לדבר.');

  userStates.set(telegramId, {
    state: 'coaching',
    sessionId: userStates.get(telegramId)?.sessionId,
  });
}

// ============================================
// Partner Declined Choice
// ============================================

async function handlePartnerDeclinedChoice(ctx: Context, telegramId: string, data: string): Promise<void> {
  const parts = data.split(':');
  const choice = parts[1]; // 'reminder', 'solo', 'close'
  const sessionId = parts[2];

  if (choice === 'reminder') {
    // Generate soft reminder text
    const reminderText = await callClaude({
      systemPrompt: 'Generate a warm, zero-pressure reminder text in Hebrew for someone to send to their partner about joining a mediation session. Keep it under 2 sentences. Return ONLY the text.',
      userMessage: 'Generate reminder',
      maxTokens: 256,
    });

    await ctx.reply(`✉️ הנה טקסט תזכורת שאפשר לשלוח:\n\n"${reminderText}"`);

    // Show TTL selection for new link
    await showTtlSelection(ctx, sessionId);
  } else if (choice === 'solo') {
    await SessionStateMachine.transition(sessionId, 'ASYNC_COACHING', { reason: 'partner_declined_solo' });
    await ctx.reply('בסדר גמור 💪 בואו נמשיך ביחד. מה עובר עליך עכשיו?');
    userStates.set(telegramId, { state: 'coaching', sessionId });
  } else if (choice === 'close') {
    await SessionStateMachine.transition(sessionId, 'CLOSED', { reason: 'user_chose_close' });
    await ctx.reply('הסשן נסגר. אפשר תמיד להתחיל מחדש עם /start ❤️');
    userStates.delete(telegramId);
  }
}

// ============================================
// Invite Draft Choice
// ============================================

async function handleInviteDraftChoice(ctx: Context, telegramId: string, data: string): Promise<void> {
  const parts = data.split(':');
  const choice = parts[1]; // 'v1', 'v2', 'regenerate'
  const sessionId = parts[2];

  if (choice === 'regenerate') {
    await ctx.reply('נסח/י שוב — מה הדבר הכי חשוב שתרצה שידעו?');
    userStates.set(telegramId, { state: 'invitation_drafting', sessionId });
    return;
  }

  const state = userStates.get(telegramId);
  const drafts = state?.data?.drafts as string[] | undefined;
  const selectedDraft = choice === 'v1' ? drafts?.[0] : drafts?.[1];

  if (!selectedDraft) {
    await ctx.reply('אירעה שגיאה. נסה/י שוב.');
    return;
  }

  // Store invitation message
  await SessionManager.storeInvitationMessage(sessionId, selectedDraft);

  // Update state with the selected message
  userStates.set(telegramId, {
    state: 'pre_invite',
    sessionId,
    data: { invitationMessage: selectedDraft },
  });

  // Ask about partner's Telegram (1E)
  await ctx.reply(
    'האם לבן/בת הזוג שלך יש טלגרם מותקן בטלפון?',
    Markup.inlineKeyboard([
      [Markup.button.callback('✅ כן', `telegram_check:yes:${sessionId}`)],
      [Markup.button.callback('❓ לא בטוח', `telegram_check:unsure:${sessionId}`)],
      [Markup.button.callback('❌ לא', `telegram_check:no:${sessionId}`)],
    ])
  );
}

// ============================================
// Email Opt Choice
// ============================================

async function handleEmailOptChoice(ctx: Context, telegramId: string, data: string): Promise<void> {
  const parts = data.split(':');
  const choice = parts[1]; // 'yes' or 'no'

  if (choice === 'yes') {
    await ctx.reply('מה כתובת המייל שלך?');
    userStates.set(telegramId, { state: 'awaiting_email' });
  } else {
    await ctx.reply('בסדר! הסיכום נשלח לך כאן בטלגרם. תודה שהשתמשת ברות בוט זוגיות ❤️');
    userStates.delete(telegramId);
  }
}

// ============================================
// Delete Confirm
// ============================================

async function handleDeleteConfirm(ctx: Context, telegramId: string, data: string): Promise<void> {
  const choice = data.split(':')[1]; // 'yes' or 'no'

  if (choice === 'yes') {
    // Actual deletion handled by deleteHandler
    const { handleDeleteConfirmation } = await import('./deleteHandler');
    await handleDeleteConfirmation(ctx, telegramId);
  } else {
    await ctx.reply('ביטלנו את הבקשה. הנתונים שלך לא נמחקו.');
  }

  userStates.delete(telegramId);
}

// ============================================
// Deliver to Partner
// ============================================

async function deliverToPartner(ctx: Context, pending: PendingReframe): Promise<void> {
  try {
    const session = await prisma.coupleSession.findUnique({
      where: { id: pending.sessionId },
      select: { userAId: true, userBId: true },
    });

    if (!session) return;

    // Determine recipient
    const recipientUserId = pending.senderRole === 'USER_A' ? session.userBId : session.userAId;
    if (!recipientUserId) return;

    const recipient = await prisma.user.findUnique({
      where: { id: recipientUserId },
      select: { telegramId: true },
    });

    if (!recipient) return;

    const recipientTelegramId = decrypt(recipient.telegramId);

    // Rule 1: NEVER send raw text. Only AI-reframed, approved content.
    const deliveryMessage = `💌 בן/בת הזוג שלך רוצה לשתף אותך:\n\n${pending.reframedText}`;

    for (const chunk of splitMessage(deliveryMessage)) {
      await ctx.telegram.sendMessage(recipientTelegramId, chunk);
    }

    logger.info('Reframed message delivered to partner', {
      sessionId: pending.sessionId,
      senderRole: pending.senderRole,
    });
  } catch (error) {
    logger.error('Failed to deliver message to partner', {
      sessionId: pending.sessionId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
