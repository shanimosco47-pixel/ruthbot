import { classifyRisk } from '../../services/risk/riskEngine';
import { callClaude } from '../../services/ai/claudeClient';
import { buildCoachingPrompt, buildReframePrompt, getEmergencyResources } from '../../services/ai/systemPrompts';
import { SessionStateMachine } from '../stateMachine/sessionStateMachine';
import { cleanupSessionState } from '../../adapters/telegram/handlers/callbackHandler';
import { prisma } from '../../db/client';
import { logger } from '../../utils/logger';
import { encrypt, decrypt } from '../../utils/encryption';
import type { PipelineInput, PipelineResult, ConversationMessage, RiskAssessment } from '../../types';

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
  // Step 3: Risk Classification (MANDATORY — never skip)
  // ================================================
  const riskAssessment = await classifyRisk({
    message: rawText,
    sessionId: context.sessionId,
    senderRole: context.currentRole,
  });

  // Store message in DB (raw content encrypted at rest — Hat 4: Privacy)
  await prisma.message.create({
    data: {
      sessionId: context.sessionId,
      senderRole: context.currentRole,
      messageType: input.messageType,
      rawContent: encrypt(rawText),
      riskLevel: riskAssessment.risk_level,
      topicCategory: riskAssessment.topic_category,
    },
  });

  // ================================================
  // L4: HARD STOP
  // ================================================
  if (riskAssessment.risk_level === 'L4') {
    return handleL4HardStop(context, riskAssessment);
  }

  // ================================================
  // L3/L3_PLUS: Stop pipeline, coaching only
  // ================================================
  if (riskAssessment.risk_level === 'L3' || riskAssessment.risk_level === 'L3_PLUS') {
    return handleHighRisk(context, rawText, riskAssessment);
  }

  // ================================================
  // Step 4: Emotional Coaching
  // ================================================
  const conversationHistory = await getConversationHistory(context.sessionId);
  const patternSummaries = await getPatternSummaries(context.anonymizedCoupleId, rawText);

  const coachingResponse = await callClaude({
    systemPrompt: buildCoachingPrompt({
      userRole: context.currentRole,
      language: context.language,
      riskLevel: riskAssessment.risk_level,
      topicCategory: riskAssessment.topic_category,
      conversationHistory,
      patternSummaries,
      sessionId: context.sessionId,
    }),
    userMessage: rawText,
    sessionId: context.sessionId,
  });

  // ================================================
  // Step 5: Reframe Generation (only in ACTIVE state with partner)
  // ================================================
  let reframedMessage: string | null = null;
  let requiresApproval = false;

  if (context.status === 'ACTIVE' && context.userBId) {
    // Only generate reframe for L1/L2 messages when session is ACTIVE
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

  // Store bot response as message (encrypted at rest)
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

  // Lock session immediately
  try {
    await SessionStateMachine.transition(context.sessionId, 'LOCKED', {
      reason: 'L4_hard_stop',
      riskReasoning: riskAssessment.reasoning,
    });
    // Clean up all in-memory state for this session
    cleanupSessionState(context.sessionId);
  } catch (error) {
    logger.error('Failed to lock session on L4', {
      sessionId: context.sessionId,
      error: error instanceof Error ? error.message : String(error),
    });
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

/**
 * L3/L3_PLUS: Stop pipeline for this message, continue coaching sender.
 */
async function handleHighRisk(
  context: SessionContext,
  rawText: string,
  riskAssessment: RiskAssessment
): Promise<PipelineResult> {
  logger.warn('High risk message detected', {
    sessionId: context.sessionId,
    role: context.currentRole,
    riskLevel: riskAssessment.risk_level,
  });

  const conversationHistory = await getConversationHistory(context.sessionId);
  const patternSummaries = await getPatternSummaries(context.anonymizedCoupleId, rawText);

  // Generate coaching response for L3/L3_PLUS
  const coachingResponse = await callClaude({
    systemPrompt: buildCoachingPrompt({
      userRole: context.currentRole,
      language: context.language,
      riskLevel: riskAssessment.risk_level,
      topicCategory: riskAssessment.topic_category,
      conversationHistory,
      patternSummaries,
      sessionId: context.sessionId,
    }),
    userMessage: rawText,
    sessionId: context.sessionId,
  });

  return {
    riskLevel: riskAssessment.risk_level,
    topicCategory: riskAssessment.topic_category,
    coachingResponse,
    reframedMessage: null,
    requiresApproval: false,
    halted: false, // Session continues, but message NOT forwarded
  };
}

// Import type locally to avoid circular dependency
type SessionContext = PipelineInput['context'];

/**
 * Get conversation history for the current session.
 */
async function getConversationHistory(sessionId: string): Promise<ConversationMessage[]> {
  const messages = await prisma.message.findMany({
    where: { sessionId },
    orderBy: { createdAt: 'asc' },
    take: 50, // Limit context window
    select: {
      senderRole: true,
      rawContent: true,
      messageType: true,
      createdAt: true,
    },
  });

  return messages
    .filter((m) => m.rawContent)
    .map((m) => {
      let content: string;
      try {
        content = decrypt(m.rawContent!);
      } catch {
        // Fallback for messages stored before encryption was added
        content = m.rawContent!;
      }
      return {
        role: m.messageType === 'COACHING' ? ('BOT' as const) : m.senderRole,
        content,
        timestamp: m.createdAt,
      };
    });
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
