import { classifyRisk, classifyRiskAndCoach } from '../../services/risk/riskEngine';
import { callClaude } from '../../services/ai/claudeClient';
import { buildReframePrompt, getEmergencyResources } from '../../services/ai/systemPrompts';
import { SessionStateMachine } from '../stateMachine/sessionStateMachine';
import { cleanupSessionState } from '../../adapters/telegram/handlers/callbackHandler';
import { prisma } from '../../db/client';
import { logger } from '../../utils/logger';
import { encrypt, decrypt } from '../../utils/encryption';
import {
  detectFrustration,
  getFrustrationMenu,
  getUserTurnCount,
  shouldGenerateDraft,
} from '../../utils/responseValidator';
import type { PipelineInput, PipelineResult, ConversationMessage, RiskAssessment } from '../../types';
import type { SenderRole, MessageType } from '@prisma/client';

/**
 * 8-Step Message Pipeline (Section 4.2 of PRD):
 * 1. Receive — raw message received (handled by adapter)
 * 2. Transcribe — voice note → text (handled by voice service before pipeline)
 * 3. Risk Classification — BEFORE coaching
 * 4. Emotional Coaching — EFT/Gottman/Imago
 * 5. Reframe Generation — reframed message for partner
 * 6. Reframe Approval — [Send] / [Edit] / [Cancel] (handled by adapter)
 * 7. Second Risk Check on Edit — if user edited (handled on edit callback)
 * 8. Delivery — approved content to partner (handled by adapter)
 */
export async function processMessage(input: PipelineInput): Promise<PipelineResult> {
  const { context, rawText } = input;

  logger.info('Pipeline started', {
    sessionId: context.sessionId,
    role: context.currentRole,
    messageLength: rawText.length,
  });

  // ================================================
  // Step 1: DB prefetch (parallel, no API calls)
  // ================================================
  const [conversationHistory, patternSummaries] = await Promise.all([
    getConversationHistory(context.sessionId),
    getPatternSummaries(context.anonymizedCoupleId, rawText),
  ]);

  // ================================================
  // Step 2: Local checks — turn count, frustration, draft trigger
  // ================================================
  const turnCount = getUserTurnCount(conversationHistory, context.currentRole);
  const isFrustrated = detectFrustration(rawText);
  const shouldDraft = shouldGenerateDraft(turnCount, conversationHistory, context.currentRole);

  logger.info('RUTH V3 state', {
    sessionId: context.sessionId,
    turnCount,
    isFrustrated,
    shouldDraft,
  });

  // ================================================
  // Step 2.5: Frustrated user — quick risk-only call + menu (fast path)
  // ================================================
  if (isFrustrated) {
    const riskAssessment = await classifyRisk({
      message: rawText,
      sessionId: context.sessionId,
      senderRole: context.currentRole,
    });

    // Store user message (await with retry — message loss is unacceptable for mediation)
    await storeMessageWithRetry({
      sessionId: context.sessionId,
      senderRole: context.currentRole,
      messageType: input.messageType,
      rawContent: encrypt(rawText),
      riskLevel: riskAssessment.risk_level,
      topicCategory: riskAssessment.topic_category,
    });

    // L4 even for frustrated users — safety first
    if (riskAssessment.risk_level === 'L4') {
      return handleL4HardStop(context, riskAssessment);
    }

    const frustrationMenu = getFrustrationMenu();

    await prisma.message.create({
      data: {
        sessionId: context.sessionId,
        senderRole: context.currentRole,
        messageType: 'COACHING',
        rawContent: encrypt(frustrationMenu),
      },
    });

    return {
      riskLevel: riskAssessment.risk_level,
      topicCategory: riskAssessment.topic_category,
      coachingResponse: frustrationMenu,
      reframedMessage: null,
      requiresApproval: false,
      halted: false,
      isFrustrationMenu: true,
    };
  }

  // ================================================
  // Step 3: Combined Risk + Coaching (single Claude call — speed optimization)
  // ================================================
  const { risk: riskAssessment, coaching: coachingResponse } = await classifyRiskAndCoach({
    message: rawText,
    sessionId: context.sessionId,
    senderRole: context.currentRole,
    userRole: context.currentRole,
    language: context.language,
    conversationHistory,
    patternSummaries,
    sessionStatus: context.status,
    turnCount,
    shouldDraft,
    isFrustrated,
  });

  // Store user message (await with retry — message loss is unacceptable for mediation)
  await storeMessageWithRetry({
    sessionId: context.sessionId,
    senderRole: context.currentRole,
    messageType: input.messageType,
    rawContent: encrypt(rawText),
    riskLevel: riskAssessment.risk_level,
    topicCategory: riskAssessment.topic_category,
  });

  // ================================================
  // L4: HARD STOP
  // ================================================
  if (riskAssessment.risk_level === 'L4') {
    return handleL4HardStop(context, riskAssessment);
  }

  // ================================================
  // L3/L3_PLUS: Return coaching from combined call, no reframe
  // ================================================
  if (riskAssessment.risk_level === 'L3' || riskAssessment.risk_level === 'L3_PLUS') {
    return {
      riskLevel: riskAssessment.risk_level,
      topicCategory: riskAssessment.topic_category,
      coachingResponse,
      reframedMessage: null,
      requiresApproval: false,
      halted: false,
    };
  }

  // ================================================
  // Step 4: Reframe Generation
  // Generate reframe in two cases:
  // A) ACTIVE session with partner present (standard couple flow)
  // B) shouldDraft is true (solo coaching — draft for later delivery)
  // Only for L1/L2 risk levels.
  // ================================================
  let reframedMessage: string | null = null;
  let requiresApproval = false;

  const shouldGenerateReframe =
    (context.status === 'ACTIVE' && context.userBId) || shouldDraft;

  if (shouldGenerateReframe) {
    if (riskAssessment.risk_level === 'L1' || riskAssessment.risk_level === 'L2') {
      const conversationContext = conversationHistory
        .slice(-6)
        .map((m) => `[${m.role}] ${m.content}`)
        .join('\n');

      reframedMessage = await callClaude({
        systemPrompt: buildReframePrompt({
          language: context.language,
          topicCategory: riskAssessment.topic_category,
          originalMessage: rawText,
          conversationContext,
        }),
        userMessage: rawText,
        sessionId: context.sessionId,
      });

      requiresApproval = true;
    }
  }

  // Store bot response (encrypted at rest)
  await prisma.message.create({
    data: {
      sessionId: context.sessionId,
      senderRole: context.currentRole,
      messageType: 'COACHING',
      rawContent: encrypt(coachingResponse),
    },
  });

  return {
    riskLevel: riskAssessment.risk_level,
    topicCategory: riskAssessment.topic_category,
    coachingResponse,
    reframedMessage,
    requiresApproval,
    halted: false,
  };
}

/**
 * L4 Hard Stop: Lock session, send emergency resources.
 */
async function handleL4HardStop(
  context: SessionContext,
  riskAssessment: RiskAssessment
): Promise<PipelineResult> {
  logger.error('L4 HARD STOP triggered', {
    sessionId: context.sessionId,
    role: context.currentRole,
    reasoning: riskAssessment.reasoning,
  });

  // Lock session immediately — SAFETY CRITICAL: must not fail silently
  try {
    await SessionStateMachine.transition(context.sessionId, 'LOCKED', {
      reason: 'L4_hard_stop',
      riskReasoning: riskAssessment.reasoning,
    });
    // Clean up all in-memory state for this session
    cleanupSessionState(context.sessionId);
  } catch (error) {
    logger.error('Failed to lock session on L4 via state machine, attempting emergency direct DB update', {
      sessionId: context.sessionId,
      error: error instanceof Error ? error.message : String(error),
    });

    // Emergency fallback: direct DB update bypassing state machine validation
    try {
      await prisma.coupleSession.update({
        where: { id: context.sessionId },
        data: { status: 'LOCKED' },
      });
      cleanupSessionState(context.sessionId);
      logger.warn('L4 emergency lock succeeded via direct DB update', {
        sessionId: context.sessionId,
      });
    } catch (emergencyError) {
      logger.error('L4 EMERGENCY LOCK FAILED — session may remain unlocked', {
        sessionId: context.sessionId,
        error: emergencyError instanceof Error ? emergencyError.message : String(emergencyError),
      });
    }
  }

  const emergencyText = getEmergencyResources(context.language);

  return {
    riskLevel: 'L4',
    topicCategory: riskAssessment.topic_category,
    coachingResponse: emergencyText,
    reframedMessage: null,
    requiresApproval: false,
    halted: true,
    haltReason: 'L4_critical_safety',
  };
}

// Import type locally to avoid circular dependency
type SessionContext = PipelineInput['context'];

/**
 * Get conversation history for the current session.
 */
async function getConversationHistory(sessionId: string): Promise<ConversationMessage[]> {
  // Fetch the NEWEST 50 messages: query desc then reverse to chronological order
  const messagesDesc = await prisma.message.findMany({
    where: { sessionId },
    orderBy: { createdAt: 'desc' },
    take: 50,
    select: {
      senderRole: true,
      rawContent: true,
      messageType: true,
      createdAt: true,
    },
  });
  const messages = messagesDesc.reverse();

  return messages
    .filter((m) => m.rawContent)
    .map((m) => {
      let content: string;
      try {
        content = decrypt(m.rawContent!);
      } catch {
        // Skip messages that fail decryption — returning encrypted hex as "content" is a data leak
        logger.warn('Failed to decrypt message, skipping from history', {
          sessionId,
          messageType: m.messageType,
          createdAt: m.createdAt,
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
}

/**
 * Get pattern summaries from vector DB for this couple.
 * Uses semantic similarity search via pgvector.
 */
async function getPatternSummaries(anonymizedCoupleId: string, currentMessage?: string): Promise<string[]> {
  const { retrievePatterns } = await import('../../services/memory/memoryService');
  return retrievePatterns({
    anonymizedCoupleId,
    currentMessage: currentMessage || '',
  });
}

/**
 * Store a message with one retry on failure.
 * Mediation messages are sensitive — silent loss is unacceptable.
 */
async function storeMessageWithRetry(data: {
  sessionId: string;
  senderRole: SenderRole;
  messageType: MessageType;
  rawContent: string;
  riskLevel?: string;
  topicCategory?: string;
}): Promise<void> {
  try {
    await prisma.message.create({ data });
  } catch (err) {
    logger.warn('Message store failed, retrying once', {
      sessionId: data.sessionId,
      error: err instanceof Error ? err.message : String(err),
    });
    try {
      await prisma.message.create({ data });
    } catch (retryErr) {
      // Log as error but don't crash the pipeline — the user still needs a response
      logger.error('Message store failed after retry — message lost', {
        sessionId: data.sessionId,
        error: retryErr instanceof Error ? retryErr.message : String(retryErr),
      });
    }
  }
}

/**
 * Process a second risk check on an edited reframe.
 * Returns the risk assessment for the edited version.
 */
export async function secondRiskCheck(params: {
  editedText: string;
  sessionId: string;
  senderRole: 'USER_A' | 'USER_B';
}): Promise<RiskAssessment> {
  return classifyRisk({
    message: params.editedText,
    sessionId: params.sessionId,
    senderRole: params.senderRole,
  });
}
