import { Context, Markup } from 'telegraf';
import { SessionManager } from '../../../core/stateMachine/sessionManager';
import { SessionStateMachine } from '../../../core/stateMachine/sessionStateMachine';
import { callClaude } from '../../../services/ai/claudeClient';
// TODO: [BILLING REVIEW NEEDED] Re-enable when Stripe is configured
// import { requiresPayment, createCheckoutSession } from '../../../services/billing/stripeService';
// import { env } from '../../../config/env';
import { logger } from '../../../utils/logger';
import { splitMessage } from '../../../utils/telegramHelpers';
import { decrypt, encrypt } from '../../../utils/encryption';
import { prisma } from '../../../db/client';
import { MAX_EDIT_ITERATIONS } from '../../../config/constants';
import { getMessageTemplate } from '../../../utils/responseValidator';
import type { MessageTemplate } from '../../../utils/responseValidator';
import type { PendingReframe } from '../../../types';

// TODO: [PERF REVIEW NEEDED] In-memory state is lost on server restart (Render free tier restarts on deploy and idle).
// Pending reframes and user states should be persisted to DB for production resilience.
// Current impact: mid-flow reframes/states lost on restart. Acceptable for MVP, not for scale.
const pendingReframes = new Map<string, PendingReframe>();
const userStates = new Map<string, {
  state: string;
  sessionId?: string;
  data?: Record<string, unknown>;
}>();

export { userStates, pendingReframes };

/**
 * Parse and validate callback data with expected number of parts.
 * Returns null if validation fails.
 */
function parseCallbackData(data: string, expectedMinParts: number): string[] | null {
  const parts = data.split(':');
  if (parts.length < expectedMinParts) {
    logger.warn('Malformed callback data', { data, expectedMinParts, actualParts: parts.length });
    return null;
  }
  return parts;
}

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
    } else if (data.startsWith('frustration:')) {
      await handleFrustrationChoice(ctx, telegramId, data);
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

  // Payment gate: DISABLED until Stripe is configured
  // TODO: [BILLING REVIEW NEEDED] Re-enable payment gate when Stripe is set up
  // const needsPayment = await requiresPayment(sessionId);

  // Ask: join partner now or work alone first? (Section 2.5, 1A)
  await ctx.reply(
    'רוצה לעבד לבד קודם, או להזמין את בן/בת הזוג? אני אגשר ביניכם.',
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
  const parts = parseCallbackData(data, 3);
  if (!parts) { await ctx.reply('אירעה שגיאה. נסה/י שוב.'); return; }
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
  const parts = parseCallbackData(data, 3);
  if (!parts) { await ctx.reply('אירעה שגיאה. נסה/י שוב.'); return; }
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

  // ── FIX: Bot does NOT send the invite automatically. ──────────────────────
  // Previous wording ("✉️ העתק ושלח") was ambiguous — users assumed the bot
  // sent the message on their behalf. The bot cannot initiate contact with a
  // user who has never started it (Telegram privacy restriction). The correct
  // flow is: User A manually forwards the invite link to User B via any app.
  // ─────────────────────────────────────────────────────────────────────────

  // Step 1: Show the ready-to-forward package (invitation + link + architecture explanation)
  const architectureExplanation =
    `💡 איך זה עובד: כל אחד מדבר איתי בצ'אט פרטי נפרד. ` +
    `אף אחד לא רואה מה השני כותב. ` +
    `אני עוזרת לנסח ומעבירה רק מה שאושר.`;

  const forwardableText =
    `"${invitationMessage}"\n\n` +
    architectureExplanation + `\n\n` +
    `🔗 לחצ/י כאן כדי להתחיל: ${link}`;

  await ctx.reply(`📋 הודעת ההזמנה מוכנה — העתק/י ושלח/י לבן/בת הזוג:\n\n${forwardableText}`);

  // Step 2: Explicit instruction + timed reminder — no "sent" language
  const ttlLabel = ttlHours === 1 ? 'שעה אחת' : ttlHours === 3 ? '3 שעות' : '12 שעות';
  await ctx.reply(
    `⚠️ שים/י לב: הבוט לא שולח את ההזמנה אוטומטית.\n\n` +
    `📤 שלח/י את ההודעה והלינק מעל לבן/בת הזוג בעצמך — בוואטסאפ, SMS, או בטלגרם.\n\n` +
    `⏰ הלינק יפוג עוד ${ttlLabel}. בינתיים, אני כאן אם תרצה/י להמשיך לעבד לבד.`,
    Markup.inlineKeyboard([
      [Markup.button.url('📤 שתף ישירות בטלגרם', `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(invitationMessage)}`)],
    ])
  );

  userStates.set(telegramId, { state: 'coaching', sessionId });
}

// ============================================
// Telegram Check (1E)
// ============================================

async function handleTelegramCheck(ctx: Context, telegramId: string, data: string): Promise<void> {
  const parts = parseCallbackData(data, 3);
  if (!parts) { await ctx.reply('אירעה שגיאה. נסה/י שוב.'); return; }
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

  // Transition to REFLECTION_GATE — User B must mirror before session becomes ACTIVE
  await SessionStateMachine.transition(sessionId, 'REFLECTION_GATE', {
    reason: 'partner_consent_accepted',
  });

  // Get the reframed message to show User B
  const session = await SessionManager.getSession(sessionId);
  if (!session) return;

  // Find ALL approved-but-undelivered reframes
  const approvedReframes = await prisma.message.findMany({
    where: {
      sessionId,
      messageType: 'REFRAME',
      approved: true,
      delivered: false,
    },
    orderBy: { createdAt: 'asc' },
    select: { id: true, reframedContent: true },
  });

  // Find the latest approved reframe to show
  const latestReframe = approvedReframes[approvedReframes.length - 1] || null;

  // Decrypt reframed content (stored encrypted at rest)
  let reframedText = '';
  if (latestReframe?.reframedContent) {
    try {
      reframedText = decrypt(latestReframe.reframedContent);
    } catch {
      reframedText = latestReframe.reframedContent;
    }

    // Deliver the reframe FIRST, then mark as delivered (Section 2.5, Phase 3, 3A)
    await ctx.reply(
      `בן/בת הזוג שלך ביקש/ה להעביר לך את הדברים הבאים. ביקשתי ממנו/ממנה לנסח אותם בצורה שתאפשר לכם לדבר בצורה רגועה:\n\n— ${reframedText} —`
    );

    // Only mark as delivered AFTER successful send to User B
    if (approvedReframes.length > 0) {
      await prisma.message.updateMany({
        where: {
          id: { in: approvedReframes.map((r) => r.id) },
        },
        data: { delivered: true },
      });
    }
  }

  // Start Reflection Gate with emotional intake for User B
  if (reframedText) {
    await ctx.reply(
      'לפני שנגיב — מה הדבר הראשון שאתה מרגיש כשאתה קורא את זה?'
    );
  } else {
    // No reframe to show — start User B intake
    await ctx.reply(
      'שלום! אני רות. בן/בת הזוג שלך פתח/ה את הסשן הזה כי חשוב לו/לה לדבר.\n\nאיך את/ה מרגיש/ה לגבי זה?'
    );
  }

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

  // Mark as approved (but NOT delivered yet — only after successful send)
  await prisma.message.update({
    where: { id: messageId },
    data: { approved: true, reframedContent: encrypt(pending.reframedText) },
  });

  // Try to deliver to partner
  const delivered = await deliverToPartner(ctx, pending);

  if (delivered) {
    // Mark as delivered only after successful send
    await prisma.message.update({
      where: { id: messageId },
      data: { delivered: true },
    });
    pendingReframes.delete(messageId);
    await ctx.reply('✅ ההודעה נשלחה לבן/בת הזוג.');
  } else {
    // Partner not yet in session — message queued for delivery when they join
    pendingReframes.delete(messageId);
    await ctx.reply('✅ ההודעה אושרה ותישלח ברגע שבן/בת הזוג יצטרף/תצטרף לסשן.');
  }
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
  const parts = parseCallbackData(data, 3);
  if (!parts) { await ctx.reply('אירעה שגיאה. נסה/י שוב.'); return; }
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
  const parts = parseCallbackData(data, 3);
  if (!parts) { await ctx.reply('אירעה שגיאה. נסה/י שוב.'); return; }
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

/**
 * Deliver an approved reframe to the partner.
 * Returns true if delivery succeeded, false if partner not available.
 */
async function deliverToPartner(ctx: Context, pending: PendingReframe): Promise<boolean> {
  try {
    const session = await prisma.coupleSession.findUnique({
      where: { id: pending.sessionId },
      select: { userAId: true, userBId: true },
    });

    if (!session) {
      logger.warn('deliverToPartner: session not found', { sessionId: pending.sessionId });
      return false;
    }

    // Determine recipient
    const recipientUserId = pending.senderRole === 'USER_A' ? session.userBId : session.userAId;
    if (!recipientUserId) {
      logger.info('deliverToPartner: partner not yet in session, message queued', {
        sessionId: pending.sessionId,
        senderRole: pending.senderRole,
      });
      return false;
    }

    const recipient = await prisma.user.findUnique({
      where: { id: recipientUserId },
      select: { telegramId: true },
    });

    if (!recipient) {
      logger.warn('deliverToPartner: recipient user not found', { recipientUserId });
      return false;
    }

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
    return true;
  } catch (error) {
    logger.error('Failed to deliver message to partner', {
      sessionId: pending.sessionId,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

// ============================================
// Frustration Menu Choice (Rule 5)
// ============================================

async function handleFrustrationChoice(ctx: Context, telegramId: string, data: string): Promise<void> {
  const parts = data.split(':');
  if (parts.length < 3) {
    logger.warn('Malformed frustration callback data', { data, telegramId });
    await ctx.reply('אירעה שגיאה. נסה/י שוב.');
    return;
  }
  const templateType = parts[1] as MessageTemplate; // 'apology', 'boundary', 'future_rule'
  const sessionId = parts[2];

  const template = getMessageTemplate(templateType);

  // Create a proper REFRAME message in DB so it goes through the standard delivery flow
  const message = await prisma.message.create({
    data: {
      sessionId,
      senderRole: 'USER_A', // Frustration templates are always from User A
      messageType: 'REFRAME',
      reframedContent: encrypt(template),
      rawContent: encrypt(`[frustration template: ${templateType}]`),
    },
  });

  const pending: PendingReframe = {
    sessionId,
    senderRole: 'USER_A',
    reframedText: template,
    originalText: `[frustration template: ${templateType}]`,
    editIterations: 0,
    messageId: message.id,
  };

  pendingReframes.set(message.id, pending);

  // Use standard reframe approval buttons — connects to the working delivery flow
  await ctx.reply(
    `📝 הנה טיוטה:\n\n${template}`,
    Markup.inlineKeyboard([
      [Markup.button.callback('✅ שלח כפי שזה', `reframe_approve:${message.id}`)],
      [Markup.button.callback('✏️ אני רוצה לערוך', `reframe_edit:${message.id}`)],
      [Markup.button.callback('❌ בטל / אל תשלח', `reframe_cancel:${message.id}`)],
    ])
  );

  userStates.set(telegramId, { state: 'coaching', sessionId });
}

// NOTE: handleDraftChoice removed — frustration templates now use the standard
// reframe_approve/edit/cancel flow via handleReframeApprove/Edit/Cancel.
