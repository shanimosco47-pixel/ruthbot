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
import { trackedReply, logBotMessage } from '../../../utils/trackedReply';
import { MAX_EDIT_ITERATIONS } from '../../../config/constants';
import { getMessageTemplate } from '../../../utils/responseValidator';
import type { MessageTemplate } from '../../../utils/responseValidator';
import type { PendingReframe } from '../../../types';
import {
  getUserState, setUserState, deleteUserState,
  getPendingReframe, setPendingReframe, deletePendingReframe,
  cleanupSessionStateDB,
} from '../../../utils/stateStore';
import type { UserFlowState } from '../../../utils/stateStore';

/**
 * Non-throwing wrapper for setUserState.
 * Use after user-facing messages have already been sent — a failure here
 * should NOT show an error to the user because fallback routing via
 * getActiveSession will handle future messages.
 */
async function safeSetUserState(telegramId: string, state: UserFlowState, context: string): Promise<void> {
  try {
    await setUserState(telegramId, state);
  } catch (error) {
    logger.error(`safeSetUserState failed [${context}] — fallback routing will handle`, {
      telegramId,
      state: state.state,
      sessionId: state.sessionId,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
  }
}

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
 * Clean up all DB-persisted state for a given session.
 * Called on session close, L4 hard stop, /start restart.
 */
export async function cleanupSessionState(sessionId: string): Promise<void> {
  await cleanupSessionStateDB(sessionId);
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
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error('Callback handler error', {
      data,
      telegramId,
      error: errorMsg,
      stack: error instanceof Error ? error.stack : undefined,
    });

    // Double-click / stale button detection: invalid state transitions are harmless
    if (errorMsg.includes('Invalid state transition') || errorMsg.includes('State transition conflict')) {
      logger.info('Ignoring double-click state transition error', { data, telegramId });
      await ctx.reply('הפעולה כבר בוצעה. אפשר להמשיך.');
      return;
    }

    await ctx.reply('אירעה שגיאה. נסה/י שוב.');
  }
}

// ============================================
// Disclaimer Accept (User A)
// ============================================

async function handleDisclaimerAccept(ctx: Context, telegramId: string): Promise<void> {
  const userId = await SessionManager.findOrCreateUser(telegramId, ctx.from?.first_name);

  // Guard: prevent double-click creating duplicate sessions
  const existingSession = await SessionManager.getActiveSession(userId);
  if (existingSession) {
    logger.info('Disclaimer accept: user already has active session, reusing', {
      telegramId,
      sessionId: existingSession.id,
      status: existingSession.status,
    });

    // If already past onboarding, just acknowledge
    if (existingSession.status !== 'INVITE_CRAFTING') {
      await ctx.reply('כבר יש לך סשן פתוח. אפשר להמשיך לכתוב.');
      return;
    }

    // Still in INVITE_CRAFTING — re-show the onboarding choice
    await ctx.reply(
      'רוצה לעבד לבד קודם, או להזמין את בן/בת הזוג? אני אגשר ביניכם.',
      Markup.inlineKeyboard([
        [Markup.button.callback('🤝 להזמין עכשיו', `onboard_choice:invite:${existingSession.id}`)],
        [Markup.button.callback('🧘 לעבד לבד קודם', `onboard_choice:solo:${existingSession.id}`)],
      ])
    );
    return;
  }

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

  // Guard: verify session exists and check current state
  let currentStatus: string;
  try {
    currentStatus = await SessionStateMachine.getStatus(sessionId);
  } catch {
    logger.warn('Onboarding choice for non-existent session', { sessionId, choice });
    await ctx.reply('הסשן לא נמצא. הקלד/י /start כדי להתחיל מחדש.');
    return;
  }

  if (choice === 'solo') {
    // If already transitioned (e.g., double-click), just set state and acknowledge
    if (currentStatus !== 'INVITE_CRAFTING') {
      logger.info('Onboarding solo: session not in INVITE_CRAFTING, skipping transition', {
        sessionId, currentStatus,
      });
      await safeSetUserState(telegramId, { state: 'coaching', sessionId }, 'solo-double-click');
      await ctx.reply('כבר בוצע. אפשר להמשיך לכתוב.');
      return;
    }

    // Transition to ASYNC_COACHING
    await SessionStateMachine.transition(sessionId, 'ASYNC_COACHING', { reason: 'user_chose_solo' });

    // RULE 0: First message — conversational opening (RC2: no rigid form)
    await trackedReply(
      ctx,
      'שלום! אני רות, מנחה זוגי 🙂\n\nספר/י לי — מה קרה?',
      { sessionId, senderRole: 'USER_A' }
    );

    await safeSetUserState(telegramId, { state: 'coaching', sessionId }, 'solo-onboarding');
  } else {
    // If already transitioned (e.g., double-click), skip
    if (currentStatus !== 'INVITE_CRAFTING') {
      logger.info('Onboarding invite: session not in INVITE_CRAFTING, skipping', {
        sessionId, currentStatus,
      });
      await ctx.reply('כבר בוצע. אפשר להמשיך.');
      return;
    }

    // Start invitation flow (1B)
    await ctx.reply(
      'מה הדבר הכי חשוב שאתה רוצה שהם ידעו לפני שנכנסים?'
    );

    await safeSetUserState(telegramId, { state: 'invitation_drafting', sessionId }, 'invite-onboarding');
  }
}

// ============================================
// TTL Choice
// ============================================

async function handleTtlChoice(ctx: Context, telegramId: string, data: string): Promise<void> {
  const parts = parseCallbackData(data, 3);
  if (!parts) { await ctx.reply('אירעה שגיאה. נסה/י שוב.'); return; }
  const ttlValue = parseInt(parts[1], 10);
  if (![1, 3, 12].includes(ttlValue)) {
    await ctx.reply('אירעה שגיאה. נסה/י שוב.');
    return;
  }
  const ttlHours = ttlValue as 1 | 3 | 12;
  const sessionId = parts[2];

  const state = await getUserState(telegramId);
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

  await safeSetUserState(telegramId, { state: 'coaching', sessionId }, 'ttl-choice');
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

    const state = await getUserState(telegramId);
    const invitationMessage = (state?.data?.invitationMessage as string) || '';

    const modifiedText = `היי, פתחתי לנו סשן ברות בוט זוגיות. חשוב לי שנדבר בצורה רגועה שמכבדת את שנינו.

כל אחד מדבר עם הבוט בנפרד, בשיחה פרטית. הבוט הוא המתווך — עוזר לנסח ומעביר רק מה שמאושר. הבוט יושב בטלגרם כדי שהשיחות יהיו הכי פרטיות ומאובטחות.

אם אין לך את האפליקציה, זה ייקח דקה להוריד. אשמח שתיכנס/י.

${invitationMessage ? `\n${invitationMessage}` : ''}`;

    if (state) {
      await safeSetUserState(telegramId, {
        ...state,
        data: { ...state.data, invitationMessage: modifiedText },
      }, 'telegram-check-modified');
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
  const parts = parseCallbackData(data, 2);
  if (!parts) { await ctx.reply('אירעה שגיאה. נסה/י שוב.'); return; }
  const sessionId = parts[1];

  // Guard: prevent double-click — check if session already moved past PENDING_PARTNER_CONSENT
  try {
    const currentStatus = await SessionStateMachine.getStatus(sessionId);
    if (currentStatus !== 'PENDING_PARTNER_CONSENT') {
      logger.info('Consent accept: session already past PENDING_PARTNER_CONSENT, ignoring double-click', {
        telegramId, sessionId, currentStatus,
      });
      await ctx.reply('כבר קיבלנו את ההסכמה שלך. אפשר להמשיך.');
      return;
    }
  } catch {
    logger.warn('Consent accept: session not found', { sessionId });
    await ctx.reply('הסשן לא נמצא. הקלד/י /start כדי להתחיל.');
    return;
  }

  // NOW we can store User B's data (GDPR: only after consent)
  const userId = await SessionManager.findOrCreateUser(telegramId, ctx.from?.first_name);

  // Guard: prevent User B from joining multiple sessions simultaneously
  const existingSession = await SessionManager.getActiveSession(userId);
  if (existingSession && existingSession.id !== sessionId) {
    logger.warn('User B already has an active session, rejecting join', {
      telegramId, existingSessionId: existingSession.id, newSessionId: sessionId,
    });
    await ctx.reply('יש לך סשן פעיל כרגע. סיים/י אותו קודם לפני שמצטרפ/ת לסשן חדש.');
    return;
  }

  // recordPartnerConsent already transitions to REFLECTION_GATE internally
  await SessionManager.recordPartnerConsent(sessionId, userId);

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
    } catch (decryptError) {
      // SECURITY: Never send encrypted ciphertext to user — log error and show empty
      logger.error('Failed to decrypt reframed content for User B delivery', {
        sessionId,
        messageId: latestReframe.id,
        error: decryptError instanceof Error ? decryptError.message : String(decryptError),
      });
      reframedText = '';
    }

    // Deliver the reframe FIRST, then mark as delivered (Section 2.5, Phase 3, 3A)
    await trackedReply(
      ctx,
      `בן/בת הזוג שלך ביקש/ה להעביר לך את הדברים הבאים. ביקשתי ממנו/ממנה לנסח אותם בצורה שתאפשר לכם לדבר בצורה רגועה:\n\n— ${reframedText} —`,
      { sessionId, senderRole: 'USER_B' }
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
    await trackedReply(
      ctx,
      'לפני שנגיב — מה הדבר הראשון שאתה מרגיש כשאתה קורא את זה?',
      { sessionId, senderRole: 'USER_B' }
    );
  } else {
    // No reframe to show — start User B intake
    await trackedReply(
      ctx,
      'שלום! אני רות. בן/בת הזוג שלך פתח/ה את הסשן הזה כי חשוב לו/לה לדבר.\n\nאיך את/ה מרגיש/ה לגבי זה?',
      { sessionId, senderRole: 'USER_B' }
    );
  }

  await safeSetUserState(telegramId, {
    state: 'reflection_gate_step1',
    sessionId,
    data: { reframedContent: reframedText },
  }, 'consent-accept');
}

// ============================================
// Reframe Approval Flow (Rule 2)
// ============================================

async function handleReframeApprove(ctx: Context, telegramId: string, data: string): Promise<void> {
  const parts = parseCallbackData(data, 2);
  if (!parts) { await ctx.reply('אירעה שגיאה. נסה/י שוב.'); return; }
  const messageId = parts[1];
  const pending = await getPendingReframe(messageId);

  if (!pending) {
    await ctx.reply('ההודעה כבר לא זמינה.');
    return;
  }

  // Authorization: only the user who created this reframe can approve it
  if (pending.ownerTelegramId !== telegramId) {
    logger.warn('Unauthorized reframe approve attempt', { telegramId, messageId });
    await ctx.reply('אין הרשאה לפעולה זו.');
    return;
  }

  // Atomic claim: delete pending reframe to prevent double-click race condition
  const claimed = await deletePendingReframe(messageId);
  if (!claimed) {
    await ctx.reply('ההודעה כבר טופלה.');
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
    await trackedReply(ctx, '✅ ההודעה נשלחה לבן/בת הזוג.', { sessionId: pending.sessionId, senderRole: pending.senderRole });
  } else {
    // Partner not yet in session — message queued for delivery when they join
    await trackedReply(ctx, '✅ ההודעה אושרה ונשמרה. היא תועבר לבן/בת הזוג בצ\'אט הפרטי שלהם ברגע שיפתחו את הלינק.', { sessionId: pending.sessionId, senderRole: pending.senderRole });
  }
}

async function handleReframeEdit(ctx: Context, telegramId: string, data: string): Promise<void> {
  const parts = parseCallbackData(data, 2);
  if (!parts) { await ctx.reply('אירעה שגיאה. נסה/י שוב.'); return; }
  const messageId = parts[1];
  const pending = await getPendingReframe(messageId);

  if (!pending) {
    await ctx.reply('ההודעה כבר לא זמינה.');
    return;
  }

  // Authorization: only the owner can edit
  if (pending.ownerTelegramId !== telegramId) {
    logger.warn('Unauthorized reframe edit attempt', { telegramId, messageId });
    await ctx.reply('אין הרשאה לפעולה זו.');
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

  await safeSetUserState(telegramId, {
    state: 'editing_reframe',
    sessionId: pending.sessionId,
    data: { messageId },
  }, 'reframe-edit');
}

async function handleReframeCancel(ctx: Context, telegramId: string, data: string): Promise<void> {
  const parts = parseCallbackData(data, 2);
  if (!parts) { await ctx.reply('אירעה שגיאה. נסה/י שוב.'); return; }
  const messageId = parts[1];

  const pending = await getPendingReframe(messageId);
  if (!pending) {
    await ctx.reply('ההודעה כבר לא זמינה.');
    return;
  }

  // Authorization: only the user who created this reframe can cancel it
  if (pending.ownerTelegramId !== telegramId) {
    logger.warn('Unauthorized reframe cancel attempt', { telegramId, messageId });
    await ctx.reply('אין הרשאה לפעולה זו.');
    return;
  }

  await deletePendingReframe(messageId);

  const currentState = await getUserState(telegramId);
  await trackedReply(ctx, 'ההודעה בוטלה. הסשן ממשיך — אתה יכול להמשיך לדבר.', { sessionId: currentState?.sessionId });
  await safeSetUserState(telegramId, {
    state: 'coaching',
    sessionId: currentState?.sessionId,
  }, 'reframe-cancel');
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
    // Send typing indicator while generating reminder (hat 15: perf)
    await ctx.sendChatAction('typing');
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
    await safeSetUserState(telegramId, { state: 'coaching', sessionId }, 'partner-declined-solo');
  } else if (choice === 'close') {
    await SessionStateMachine.transition(sessionId, 'CLOSED', { reason: 'user_chose_close' });
    await ctx.reply('הסשן נסגר. אפשר תמיד להתחיל מחדש עם /start ❤️');
    await deleteUserState(telegramId);
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
    await safeSetUserState(telegramId, { state: 'invitation_drafting', sessionId }, 'draft-regenerate');
    return;
  }

  const state = await getUserState(telegramId);
  const drafts = state?.data?.drafts as string[] | undefined;
  const selectedDraft = choice === 'v1' ? drafts?.[0] : drafts?.[1];

  if (!selectedDraft) {
    await ctx.reply('אירעה שגיאה. נסה/י שוב.');
    return;
  }

  // Store invitation message
  await SessionManager.storeInvitationMessage(sessionId, selectedDraft);

  // Update state with the selected message
  await safeSetUserState(telegramId, {
    state: 'pre_invite',
    sessionId,
    data: { invitationMessage: selectedDraft },
  }, 'draft-selected');

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
  const parts = parseCallbackData(data, 2);
  if (!parts) { await ctx.reply('אירעה שגיאה. נסה/י שוב.'); return; }
  const choice = parts[1]; // 'yes' or 'no'

  if (choice === 'yes') {
    await ctx.reply('מה כתובת המייל שלך?');
    await safeSetUserState(telegramId, { state: 'awaiting_email' }, 'email-opt-yes');
  } else {
    await ctx.reply('בסדר! הסיכום נשלח לך כאן בטלגרם. תודה שהשתמשת ברות בוט זוגיות ❤️');
    await deleteUserState(telegramId);
  }
}

// ============================================
// Delete Confirm
// ============================================

async function handleDeleteConfirm(ctx: Context, telegramId: string, data: string): Promise<void> {
  const parts = parseCallbackData(data, 2);
  if (!parts) { await ctx.reply('אירעה שגיאה. נסה/י שוב.'); return; }
  const choice = parts[1]; // 'yes' or 'no'

  if (choice === 'yes') {
    // Actual deletion handled by deleteHandler
    const { handleDeleteConfirmation } = await import('./deleteHandler');
    await handleDeleteConfirmation(ctx, telegramId);
  } else {
    await ctx.reply('ביטלנו את הבקשה. הנתונים שלך לא נמחקו.');
  }

  await deleteUserState(telegramId);
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

    // RC0: Log the delivered message in the recipient's context
    const recipientRole = pending.senderRole === 'USER_A' ? 'USER_B' : 'USER_A';
    await logBotMessage(pending.sessionId, deliveryMessage, recipientRole as 'USER_A' | 'USER_B');

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
  const parts = parseCallbackData(data, 3);
  if (!parts) { await ctx.reply('אירעה שגיאה. נסה/י שוב.'); return; }
  const templateType = parts[1];
  const sessionId = parts[2];

  // Validate template type before use
  const validTemplates: MessageTemplate[] = ['apology', 'boundary', 'future_rule'];
  if (!validTemplates.includes(templateType as MessageTemplate)) {
    logger.warn('Invalid frustration template type', { templateType, telegramId });
    await ctx.reply('אירעה שגיאה. נסה/י שוב.');
    return;
  }

  const template = getMessageTemplate(templateType as MessageTemplate);

  // Determine the sender's actual role (could be User A or User B)
  const userId = await SessionManager.findOrCreateUser(telegramId);
  const activeSession = await SessionManager.getActiveSession(userId);
  const senderRole = activeSession?.role || 'USER_A';

  // Create a proper REFRAME message in DB so it goes through the standard delivery flow
  const message = await prisma.message.create({
    data: {
      sessionId,
      senderRole,
      messageType: 'REFRAME',
      reframedContent: encrypt(template),
      rawContent: encrypt(`[frustration template: ${templateType}]`),
    },
  });

  const pending: PendingReframe = {
    sessionId,
    senderRole,
    ownerTelegramId: telegramId,
    reframedText: template,
    originalText: `[frustration template: ${templateType}]`,
    editIterations: 0,
    messageId: message.id,
  };

  await setPendingReframe(message.id, pending);

  // Use standard reframe approval buttons — connects to the working delivery flow
  await ctx.reply(
    `📝 הנה טיוטה:\n\n${template}`,
    Markup.inlineKeyboard([
      [Markup.button.callback('✅ שלח כפי שזה', `reframe_approve:${message.id}`)],
      [Markup.button.callback('✏️ אני רוצה לערוך', `reframe_edit:${message.id}`)],
      [Markup.button.callback('❌ בטל / אל תשלח', `reframe_cancel:${message.id}`)],
    ])
  );

  await safeSetUserState(telegramId, { state: 'coaching', sessionId }, 'frustration-choice');
}

// NOTE: handleDraftChoice removed — frustration templates now use the standard
// reframe_approve/edit/cancel flow via handleReframeApprove/Edit/Cancel.
