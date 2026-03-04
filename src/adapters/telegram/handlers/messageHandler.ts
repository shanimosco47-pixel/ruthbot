import { Context, Markup } from 'telegraf';
import { SessionManager } from '../../../core/stateMachine/sessionManager';
import { SessionStateMachine } from '../../../core/stateMachine/sessionStateMachine';
import { processMessage, secondRiskCheck } from '../../../core/pipeline/messagePipeline';
import { callClaude, callClaudeJSON } from '../../../services/ai/claudeClient';
import { buildInvitationDraftPrompt, buildMirrorEvaluationPrompt } from '../../../services/ai/systemPrompts';
import { logger } from '../../../utils/logger';
import { detectLanguage, splitMessage } from '../../../utils/telegramHelpers';
import { prisma } from '../../../db/client';
import { encrypt, decrypt } from '../../../utils/encryption';
import { MAX_REFLECTION_REPROMPTS } from '../../../config/constants';
import { env } from '../../../config/env';
import { sendSessionSummaryEmail } from '../../../services/email/emailService';
import { userStates, pendingReframes } from './callbackHandler';
import type { MirrorEvaluation, SessionContext, PendingReframe } from '../../../types';
import type { TopicCategory } from '../../../config/constants';

/**
 * Handle incoming text messages.
 * Routes based on user state and session status.
 */
export async function handleMessage(ctx: Context): Promise<void> {
  if (!ctx.from || !ctx.message || !('text' in ctx.message)) return;

  const telegramId = ctx.from.id.toString();
  const text = ctx.message.text;

  // Check for menu commands
  if (text === 'הזמן את בן/בת הזוג') {
    await handleInviteMenuButton(ctx, telegramId);
    return;
  }

  // Get user state
  const state = userStates.get(telegramId);

  if (state) {
    switch (state.state) {
      case 'invitation_drafting':
        await handleInvitationDraftInput(ctx, telegramId, text, state.sessionId!);
        return;

      case 'editing_reframe':
        await handleReframeEditInput(ctx, telegramId, text, state);
        return;

      case 'reflection_gate_step1':
        await handleReflectionStep1(ctx, telegramId, text, state);
        return;

      case 'reflection_gate_mirror':
        await handleReflectionMirror(ctx, telegramId, text, state);
        return;

      case 'awaiting_email':
        await handleEmailInput(ctx, telegramId, text);
        return;

      case 'coaching':
        await handleCoachingMessage(ctx, telegramId, text, state.sessionId!);
        return;
    }
  }

  // No state — find active session or prompt to start
  const userId = await SessionManager.findOrCreateUser(telegramId, ctx.from.first_name);
  const activeSession = await SessionManager.getActiveSession(userId);

  if (!activeSession) {
    await ctx.reply('היי! 👋 כדי להתחיל, הקלד/י /start');
    return;
  }

  // Detect language — only update if message has enough content to be reliable
  const language = text.replace(/\s/g, '').length >= 10 ? detectLanguage(text) : 'he';

  // Fetch full session to get both user IDs
  const fullSession = await SessionManager.getSession(activeSession.id);

  const sessionContext: SessionContext = {
    sessionId: activeSession.id,
    anonymizedCoupleId: activeSession.anonymizedCoupleId,
    userAId: fullSession?.userAId || userId,
    userBId: fullSession?.userBId || null,
    currentUserId: userId,
    currentRole: activeSession.role,
    status: activeSession.status,
    language,
  };

  if (activeSession.status === 'PAUSED') {
    // Auto-resume PAUSED session when user sends a message
    try {
      await SessionStateMachine.transition(activeSession.id, 'ACTIVE', { reason: 'user_message_resume' });
      sessionContext.status = 'ACTIVE';
      logger.info('Session auto-resumed from PAUSED on user message', {
        sessionId: activeSession.id,
        userId,
      });
    } catch (resumeError) {
      logger.error('Failed to auto-resume PAUSED session', {
        sessionId: activeSession.id,
        error: resumeError instanceof Error ? resumeError.message : String(resumeError),
      });
      await ctx.reply('אירעה שגיאה בחידוש הסשן. נסה/י שוב.');
      return;
    }
    await handleActiveSessionMessage(ctx, telegramId, text, sessionContext);
  } else if (activeSession.status === 'ACTIVE') {
    await handleActiveSessionMessage(ctx, telegramId, text, sessionContext);
  } else if (
    activeSession.status === 'ASYNC_COACHING' ||
    activeSession.status === 'INVITE_CRAFTING' ||
    activeSession.status === 'INVITE_PENDING'
  ) {
    await handleCoachingMessage(ctx, telegramId, text, activeSession.id);
  } else {
    await ctx.reply('הסשן נמצא במצב שלא מאפשר הודעות כרגע.');
  }
}

// ============================================
// Invitation Drafting (1B)
// ============================================

async function handleInvitationDraftInput(
  ctx: Context,
  telegramId: string,
  text: string,
  sessionId: string
): Promise<void> {
  await ctx.reply('רגע, אני מנסח... 🕐');

  // Apply EFT coaching lens to create invitation drafts
  const response = await callClaude({
    systemPrompt: buildInvitationDraftPrompt({ userInput: text, language: 'he' }),
    userMessage: text,
    sessionId,
  });

  // Parse the two versions
  const drafts = parseDrafts(response);

  await ctx.reply(
    `הנה שתי גרסאות:\n\n📝 גרסה 1:\n${drafts[0]}\n\n📝 גרסה 2:\n${drafts[1]}`,
    Markup.inlineKeyboard([
      [Markup.button.callback('✅ גרסה 1', `invite_draft:v1:${sessionId}`)],
      [Markup.button.callback('✅ גרסה 2', `invite_draft:v2:${sessionId}`)],
      [Markup.button.callback('🔄 נסח מחדש', `invite_draft:regenerate:${sessionId}`)],
    ])
  );

  userStates.set(telegramId, {
    state: 'invitation_draft_selection',
    sessionId,
    data: { drafts },
  });
}

function parseDrafts(response: string): string[] {
  // Try to parse "גרסה 1:" and "גרסה 2:" format
  const parts = response.split(/גרסה\s*[12]\s*:/i);
  if (parts.length >= 3) {
    return [parts[1].trim(), parts[2].trim()];
  }

  // Try numbered "1." / "2." format
  const numberedParts = response.split(/\n\s*2\.\s*/);
  if (numberedParts.length >= 2) {
    const first = numberedParts[0].replace(/^\s*1\.\s*/, '').trim();
    return [first, numberedParts[1].trim()];
  }

  // Try double newline split
  const paragraphs = response.split(/\n\n+/).filter((p) => p.trim().length > 0);
  if (paragraphs.length >= 2) {
    return [paragraphs[0].trim(), paragraphs.slice(1).join('\n\n').trim()];
  }

  // Final fallback: use same text for both (user can regenerate)
  return [response.trim(), response.trim()];
}

// ============================================
// Reframe Edit Input
// ============================================

async function handleReframeEditInput(
  ctx: Context,
  telegramId: string,
  editedText: string,
  state: { state: string; sessionId?: string; data?: Record<string, unknown> }
): Promise<void> {
  const messageId = state.data?.messageId as string;
  const pending = pendingReframes.get(messageId);

  if (!pending || !state.sessionId) {
    await ctx.reply('אירעה שגיאה. נסה/י שוב.');
    return;
  }

  // Step 7: Second Risk Check on the edited version
  const riskResult = await secondRiskCheck({
    editedText,
    sessionId: state.sessionId,
    senderRole: pending.senderRole,
  });

  if (riskResult.risk_level === 'L3' || riskResult.risk_level === 'L3_PLUS' || riskResult.risk_level === 'L4') {
    // Toxic edit — AI generates new reframe of the edited version
    pending.editIterations++;

    if (pending.editIterations >= 3) {
      await ctx.reply(
        'הגעת למספר המקסימלי של עריכות.',
        Markup.inlineKeyboard([
          [Markup.button.callback('❌ בטל / אל תשלח', `reframe_cancel:${messageId}`)],
        ])
      );
      return;
    }

    await ctx.reply('הניסוח הזה עדיין חד מדי. בואו ננסח יחד גרסה שתעבוד טוב יותר... 🕐');

    const newReframe = await callClaude({
      systemPrompt: `You are reframing an edited message that was classified as toxic. Apply EFT to surface the primary emotion beneath the secondary emotion. Keep the core message but remove toxicity. Respond in Hebrew. Return ONLY the reframed text.`,
      userMessage: editedText,
      sessionId: state.sessionId,
    });

    pending.reframedText = newReframe;
    pendingReframes.set(messageId, pending);

    await ctx.reply(
      `📝 הנה גרסה מעודכנת:\n\n${newReframe}`,
      Markup.inlineKeyboard([
        [Markup.button.callback('✅ שלח כפי שזה', `reframe_approve:${messageId}`)],
        [Markup.button.callback('✏️ אני רוצה לערוך', `reframe_edit:${messageId}`)],
        [Markup.button.callback('❌ בטל / אל תשלח', `reframe_cancel:${messageId}`)],
      ])
    );
  } else {
    // Clean edit — show approval flow again
    pending.reframedText = editedText;
    pending.editIterations++;
    pendingReframes.set(messageId, pending);

    await ctx.reply(
      `📝 הגרסה שלך:\n\n${editedText}`,
      Markup.inlineKeyboard([
        [Markup.button.callback('✅ שלח כפי שזה', `reframe_approve:${messageId}`)],
        [Markup.button.callback('✏️ אני רוצה לערוך', `reframe_edit:${messageId}`)],
        [Markup.button.callback('❌ בטל / אל תשלח', `reframe_cancel:${messageId}`)],
      ])
    );
  }

  userStates.set(telegramId, { state: 'coaching', sessionId: state.sessionId });
}

// ============================================
// Reflection Gate
// ============================================

async function handleReflectionStep1(
  ctx: Context,
  telegramId: string,
  text: string,
  state: { state: string; sessionId?: string; data?: Record<string, unknown> }
): Promise<void> {
  if (!state.sessionId) {
    logger.warn('Reflection gate step1 called without sessionId', { telegramId });
    await ctx.reply('אירעה שגיאה. נסה/י שוב עם /start');
    userStates.delete(telegramId);
    return;
  }

  // Risk Engine runs on ALL free text in Reflection Gate
  const { classifyRisk } = await import('../../../services/risk/riskEngine');
  const risk = await classifyRisk({
    message: text,
    sessionId: state.sessionId,
    senderRole: 'USER_B',
  });

  if (risk.risk_level === 'L4') {
    const { getEmergencyResources } = await import('../../../services/ai/systemPrompts');
    await ctx.reply(getEmergencyResources('he'));
    return;
  }

  // Proceed to Mirror step
  await ctx.reply(
    'תודה ששיתפת ❤️\n\nעכשיו, האם תוכל/י לשקף במילים שלך מה הבנת שחשוב לבן/בת הזוג שלך?'
  );

  userStates.set(telegramId, {
    state: 'reflection_gate_mirror',
    sessionId: state.sessionId,
    data: { ...state.data, reflectionResponse: text },
  });
}

async function handleReflectionMirror(
  ctx: Context,
  telegramId: string,
  mirrorText: string,
  state: { state: string; sessionId?: string; data?: Record<string, unknown> }
): Promise<void> {
  if (!state.sessionId) {
    logger.warn('Reflection gate mirror called without sessionId', { telegramId });
    await ctx.reply('אירעה שגיאה. נסה/י שוב עם /start');
    userStates.delete(telegramId);
    return;
  }

  // Risk Engine on mirror response
  const { classifyRisk } = await import('../../../services/risk/riskEngine');
  const risk = await classifyRisk({
    message: mirrorText,
    sessionId: state.sessionId,
    senderRole: 'USER_B',
  });

  if (risk.risk_level === 'L4') {
    const { getEmergencyResources } = await import('../../../services/ai/systemPrompts');
    await ctx.reply(getEmergencyResources('he'));
    return;
  }

  // AI Mirror Evaluation (Section 2.10)
  const reframedContent = state.data?.reframedContent as string || '';

  const evaluation = await callClaudeJSON<MirrorEvaluation>({
    systemPrompt: buildMirrorEvaluationPrompt({
      reframedMessage: reframedContent,
      mirrorResponse: mirrorText,
      language: 'he',
    }),
    userMessage: mirrorText,
    sessionId: state.sessionId,
  });

  const currentAttempts = await SessionManager.incrementMirrorAttempts(state.sessionId);

  if (evaluation.mirror_quality === 'GOOD' || currentAttempts >= MAX_REFLECTION_REPROMPTS) {
    // Proceed to Empathy Bridge
    await ctx.reply(
      'תודה ששיקפת 🙏\n\nעכשיו הבוט יעזור לך לנסח את התגובה שלך — גם אתה זכאי/ת להישמע.'
    );

    // Transition to ACTIVE
    await SessionStateMachine.transition(state.sessionId, 'ACTIVE');

    userStates.set(telegramId, { state: 'coaching', sessionId: state.sessionId });
  } else if (evaluation.mirror_quality === 'PARTIAL' || evaluation.mirror_quality === 'MISSED') {
    // Re-prompt (max 2 total)
    const reprompt = evaluation.suggested_reprompt || 'נסה/י לשקף שוב — מה לדעתך חשוב לבן/בת הזוג שלך?';
    await ctx.reply(reprompt);

    // Stay in mirror state
    userStates.set(telegramId, {
      state: 'reflection_gate_mirror',
      sessionId: state.sessionId,
      data: state.data,
    });
  } else {
    // Unrecognized mirror_quality — treat as PARTIAL to avoid silent drop
    logger.warn('Unrecognized mirror_quality from AI, treating as PARTIAL', {
      sessionId: state.sessionId,
      mirrorQuality: evaluation.mirror_quality,
    });
    await ctx.reply('נסה/י לשקף שוב — מה לדעתך חשוב לבן/בת הזוג שלך?');
    userStates.set(telegramId, {
      state: 'reflection_gate_mirror',
      sessionId: state.sessionId,
      data: state.data,
    });
  }
}

// ============================================
// Active Session Message (Full Pipeline)
// ============================================

async function handleActiveSessionMessage(
  ctx: Context,
  _telegramId: string,
  text: string,
  sessionContext: SessionContext
): Promise<void> {
  await ctx.sendChatAction('typing');

  try {
    const result = await processMessage({
      context: sessionContext,
      rawText: text,
      messageType: 'TEXT',
      telegramMessageId: ctx.message!.message_id,
    });

    // Send coaching response (with buttons for frustration)
    if (result.isFrustrationMenu) {
      await ctx.reply(
        result.coachingResponse,
        Markup.inlineKeyboard([
          [Markup.button.callback('🙏 התנצלות', `frustration:apology:${sessionContext.sessionId}`)],
          [Markup.button.callback('🛑 גבול', `frustration:boundary:${sessionContext.sessionId}`)],
          [Markup.button.callback('📏 כלל לעתיד', `frustration:future_rule:${sessionContext.sessionId}`)],
        ])
      );
    } else {
      for (const chunk of splitMessage(result.coachingResponse)) {
        await ctx.reply(chunk);
      }
    }

    // If reframe is available and needs approval
    if (result.requiresApproval && result.reframedMessage) {
      // Store in pending reframes
      const message = await prisma.message.create({
        data: {
          sessionId: sessionContext.sessionId,
          senderRole: sessionContext.currentRole,
          messageType: 'REFRAME',
          reframedContent: encrypt(result.reframedMessage),
          rawContent: encrypt(text),
          riskLevel: result.riskLevel,
          topicCategory: result.topicCategory,
        },
      });

      const pending: PendingReframe = {
        sessionId: sessionContext.sessionId,
        senderRole: sessionContext.currentRole,
        reframedText: result.reframedMessage,
        originalText: text,
        editIterations: 0,
        messageId: message.id,
      };

      pendingReframes.set(message.id, pending);

      // Show reframe with approval buttons (Rule 2)
      await ctx.reply(
        `📝 הנה ניסוח מוצע לשליחה לבן/בת הזוג:\n\n${result.reframedMessage}`,
        Markup.inlineKeyboard([
          [Markup.button.callback('✅ שלח כפי שזה', `reframe_approve:${message.id}`)],
          [Markup.button.callback('✏️ אני רוצה לערוך', `reframe_edit:${message.id}`)],
          [Markup.button.callback('❌ בטל / אל תשלח', `reframe_cancel:${message.id}`)],
        ])
      );
    }

    if (result.halted) {
      logger.warn('Pipeline halted', {
        sessionId: sessionContext.sessionId,
        reason: result.haltReason,
      });
    }
  } catch (error) {
    logger.error('Pipeline error', {
      sessionId: sessionContext.sessionId,
      error: error instanceof Error ? error.message : String(error),
    });
    await ctx.reply('אירעה שגיאה. נסה/י שוב בעוד רגע.');
  }
}

// ============================================
// Coaching Message (Solo / Pre-Active)
// ============================================

async function handleCoachingMessage(
  ctx: Context,
  telegramId: string,
  text: string,
  sessionId: string
): Promise<void> {
  await ctx.sendChatAction('typing');

  const userId = await SessionManager.findOrCreateUser(telegramId, ctx.from?.first_name);
  const session = await SessionManager.getActiveSession(userId);

  if (!session) {
    await ctx.reply('אין סשן פתוח. הקלד/י /start להתחיל.');
    return;
  }

  const language = detectLanguage(text);

  // Fetch full session for correct userAId/userBId
  const fullSession = await SessionManager.getSession(sessionId);

  try {
    const result = await processMessage({
      context: {
        sessionId,
        anonymizedCoupleId: session.anonymizedCoupleId,
        userAId: fullSession?.userAId || userId,
        userBId: fullSession?.userBId || null,
        currentUserId: userId,
        currentRole: session.role,
        status: session.status,
        language,
      },
      rawText: text,
      messageType: 'TEXT',
      telegramMessageId: ctx.message!.message_id,
    });

    // Frustration menu — show with inline buttons
    if (result.isFrustrationMenu) {
      await ctx.reply(
        result.coachingResponse,
        Markup.inlineKeyboard([
          [Markup.button.callback('🙏 התנצלות', `frustration:apology:${sessionId}`)],
          [Markup.button.callback('🛑 גבול', `frustration:boundary:${sessionId}`)],
          [Markup.button.callback('📏 כלל לעתיד', `frustration:future_rule:${sessionId}`)],
        ])
      );
    } else {
      for (const chunk of splitMessage(result.coachingResponse)) {
        await ctx.reply(chunk);
      }
    }

    // If pipeline generated a reframe for approval (draft phase or active session)
    if (result.requiresApproval && result.reframedMessage) {
      const message = await prisma.message.create({
        data: {
          sessionId,
          senderRole: session?.role || 'USER_A',
          messageType: 'REFRAME',
          reframedContent: encrypt(result.reframedMessage),
          rawContent: encrypt(text),
          riskLevel: result.riskLevel,
          topicCategory: result.topicCategory,
        },
      });

      const pendingItem: PendingReframe = {
        sessionId,
        senderRole: session?.role || 'USER_A',
        reframedText: result.reframedMessage,
        originalText: text,
        editIterations: 0,
        messageId: message.id,
      };

      pendingReframes.set(message.id, pendingItem);

      await ctx.reply(
        `📝 הנה ניסוח מוצע לשליחה לבן/בת הזוג:\n\n${result.reframedMessage}`,
        Markup.inlineKeyboard([
          [Markup.button.callback('✅ שלח כפי שזה', `reframe_approve:${message.id}`)],
          [Markup.button.callback('✏️ אני רוצה לערוך', `reframe_edit:${message.id}`)],
          [Markup.button.callback('❌ בטל / אל תשלח', `reframe_cancel:${message.id}`)],
        ])
      );
    }
  } catch (error) {
    logger.error('Coaching message error', {
      sessionId,
      error: error instanceof Error ? error.message : String(error),
    });
    await ctx.reply('אירעה שגיאה. נסה/י שוב בעוד רגע.');
  }
}

// ============================================
// Invite Menu Button
// ============================================

async function handleInviteMenuButton(ctx: Context, telegramId: string): Promise<void> {
  const userId = await SessionManager.findOrCreateUser(telegramId, ctx.from?.first_name);
  const session = await SessionManager.getActiveSession(userId);

  if (!session) {
    await ctx.reply('אין סשן פתוח. הקלד/י /start להתחיל.');
    return;
  }

  if (session.role !== 'USER_A') {
    await ctx.reply('רק מי שפתח/ה את הסשן יכול להזמין.');
    return;
  }

  // Start invitation drafting
  await ctx.reply('מה הדבר הכי חשוב שאתה רוצה שהם ידעו לפני שנכנסים?');
  userStates.set(telegramId, { state: 'invitation_drafting', sessionId: session.id });
}

// ============================================
// Email Input
// ============================================

async function handleEmailInput(ctx: Context, telegramId: string, email: string): Promise<void> {
  // Basic email validation
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    await ctx.reply('הכתובת לא נראית תקינה. נסה/י שוב:');
    return;
  }

  // Store encrypted email
  const userId = await SessionManager.findOrCreateUser(telegramId);
  await prisma.user.update({
    where: { id: userId },
    data: { email: encrypt(email) },
  });

  await ctx.reply('📧 שולח את הסיכום למייל... רגע 🕐');

  // Find the most recent closed session for this user
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { name: true },
  });
  const session = await prisma.coupleSession.findFirst({
    where: {
      OR: [{ userAId: userId }, { userBId: userId }],
      status: 'CLOSED',
    },
    orderBy: { closedAt: 'desc' },
    include: { riskEvents: true },
  });

  if (!session) {
    await ctx.reply('📧 הסיכום יישלח כשהסשן ייסגר. תודה! ❤️');
    userStates.delete(telegramId);
    return;
  }

  // Get session summary from telemetry
  const topicCategory = (session.riskEvents[0]?.topicCategory || 'משהו שחשוב לי לשתף') as TopicCategory;
  const userRole = session.userAId === userId ? 'USER_A' : 'USER_B';

  // Try cached summary first (generated at session close), fall back to API call
  const { getCachedSummary } = await import('../../../core/orchestrator/sessionCloseOrchestrator');
  const cached = getCachedSummary(session.id, userRole);

  let summary: { personalSummary: string; sharedCommitments: string; encouragement: string };
  if (cached) {
    summary = cached;
    logger.info('Using cached summary for email', { sessionId: session.id, userRole });
  } else {
    // Cache miss (e.g., server restart between close and email opt-in) — regenerate
    const { callClaudeJSON } = await import('../../../services/ai/claudeClient');
    const { buildSessionSummaryPrompt } = await import('../../../services/ai/systemPrompts');

    const messages = await prisma.message.findMany({
      where: { sessionId: session.id },
      orderBy: { createdAt: 'asc' },
      select: { senderRole: true, rawContent: true, messageType: true, createdAt: true },
    });

    const conversationHistory = messages
      .filter((m) => m.rawContent)
      .map((m) => {
        let content: string;
        try {
          content = decrypt(m.rawContent!);
        } catch {
          logger.warn('Failed to decrypt message for email summary, skipping', {
            sessionId: session.id,
            messageType: m.messageType,
          });
          return null;
        }
        return {
          role: m.messageType === 'COACHING' ? ('BOT' as const) : m.senderRole,
          content,
          timestamp: m.createdAt,
        };
      })
      .filter((m): m is NonNullable<typeof m> => m !== null);

    try {
      summary = await callClaudeJSON<{ personalSummary: string; sharedCommitments: string; encouragement: string }>({
        systemPrompt: buildSessionSummaryPrompt({
          userRole,
          conversationHistory,
          language: 'he',
          topicCategory,
        }),
        userMessage: 'Generate the session summary.',
        sessionId: session.id,
      });
    } catch {
      summary = {
        personalSummary: 'הסשן הסתיים. תודה שהשתתפת.',
        sharedCommitments: 'לא זוהו מחויבויות ספציפיות בסשן זה.',
        encouragement: 'כל שיחה היא צעד קדימה. אתם בדרך הנכונה. ❤️',
      };
    }
  }

  const userName = user?.name ? decrypt(user.name) : ctx.from?.first_name || 'שם לא ידוע';
  const sessionDate = session.closedAt
    ? session.closedAt.toLocaleDateString('he-IL', { year: 'numeric', month: 'long', day: 'numeric' })
    : new Date().toLocaleDateString('he-IL', { year: 'numeric', month: 'long', day: 'numeric' });

  const sent = await sendSessionSummaryEmail({
    to: email,
    userName,
    sessionDate,
    personalSummary: summary.personalSummary,
    sharedCommitments: summary.sharedCommitments,
    encouragement: summary.encouragement,
    topicCategory,
    ctaUrl: `https://t.me/${env.BOT_USERNAME}`,
  });

  if (sent) {
    await ctx.reply('📧 הסיכום נשלח למייל שלך בהצלחה! תודה ❤️');
  } else {
    await ctx.reply('לא הצלחנו לשלוח את המייל. ניתן לנסות שוב מאוחר יותר.');
  }

  userStates.delete(telegramId);
}
