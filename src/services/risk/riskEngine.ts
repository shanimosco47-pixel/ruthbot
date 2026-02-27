import { z } from 'zod';
import { callClaudeJSON } from '../ai/claudeClient';
import { buildRiskEnginePrompt, buildCombinedRiskCoachingPrompt } from '../ai/systemPrompts';
import { TOPIC_CATEGORIES, RISK_LEVELS, FALLBACK_TOPIC_CATEGORY } from '../../config/constants';
import type { RiskAssessment, CombinedRiskCoachingResult, ConversationMessage } from '../../types';
import { logger } from '../../utils/logger';
import { prisma } from '../../db/client';
import { checkResponseQuality } from '../../utils/responseValidator';

// Zod schema for validating Risk Engine output
const riskAssessmentSchema = z.object({
  risk_level: z.enum(RISK_LEVELS),
  topic_category: z.enum(TOPIC_CATEGORIES),
  action_required: z.string(),
  reasoning: z.string(),
});

/**
 * Classify a message through the Risk Engine.
 * This is a separate, fast Claude call that runs BEFORE any coaching.
 * Risk classification CANNOT be skipped — it is deterministic.
 */
export async function classifyRisk(params: {
  message: string;
  sessionId: string;
  senderRole: 'USER_A' | 'USER_B';
}): Promise<RiskAssessment> {
  const { message, sessionId, senderRole } = params;

  // Risk engine prompt is fully static — cache the entire thing
  const systemPrompt = buildRiskEnginePrompt();

  try {
    const raw = await callClaudeJSON<Record<string, unknown>>({
      staticSystemPrefix: systemPrompt,
      systemPrompt: '',
      userMessage: message,
      maxTokens: 512,
      sessionId,
      // Uses default model (env.CLAUDE_MODEL) — Haiku not available on this API key
    });

    // Validate with Zod
    const result = riskAssessmentSchema.safeParse(raw);

    if (!result.success) {
      logger.warn('Risk Engine returned invalid format, applying fallback', {
        sessionId,
        errors: result.error.format(),
        raw: JSON.stringify(raw).substring(0, 500),
      });

      // Fallback: conservative classification
      return {
        risk_level: 'L2',
        topic_category: FALLBACK_TOPIC_CATEGORY,
        action_required: 'Manual review — Risk Engine returned invalid format',
        reasoning: 'Automatic fallback due to parsing error',
      };
    }

    const assessment = result.data;

    // Log risk event in DB
    await logRiskEvent({
      sessionId,
      senderRole,
      riskLevel: assessment.risk_level,
      topicCategory: assessment.topic_category,
      reasoning: assessment.reasoning,
      actionRequired: assessment.action_required,
    });

    logger.info('Risk classification complete', {
      sessionId,
      senderRole,
      riskLevel: assessment.risk_level,
      topicCategory: assessment.topic_category,
    });

    return assessment;
  } catch (error) {
    logger.error('Risk Engine failed completely', {
      sessionId,
      senderRole,
      error: error instanceof Error ? error.message : String(error),
    });

    // On total failure: conservative classification, don't crash the pipeline
    return {
      risk_level: 'L2',
      topic_category: FALLBACK_TOPIC_CATEGORY,
      action_required: 'Manual review — Risk Engine call failed',
      reasoning: 'Automatic fallback due to API failure',
    };
  }
}

// Zod schema for combined risk + coaching response
const combinedRiskCoachingSchema = z.object({
  risk: z.object({
    risk_level: z.enum(RISK_LEVELS),
    topic_category: z.enum(TOPIC_CATEGORIES),
    action_required: z.string(),
    reasoning: z.string(),
  }),
  coaching: z.string().min(1),
});

/**
 * Combined risk classification + coaching in a single Claude call.
 * Cuts response time from ~10-15s to ~5-8s by eliminating one API round-trip.
 */
export async function classifyRiskAndCoach(params: {
  message: string;
  sessionId: string;
  senderRole: 'USER_A' | 'USER_B';
  userRole: 'USER_A' | 'USER_B';
  language: string;
  conversationHistory: ConversationMessage[];
  patternSummaries: string[];
  sessionStatus?: string;
  turnCount?: number;
  shouldDraft?: boolean;
  isFrustrated?: boolean;
}): Promise<CombinedRiskCoachingResult> {
  const { message, sessionId, senderRole, userRole, language, conversationHistory, patternSummaries, sessionStatus, turnCount, shouldDraft, isFrustrated } = params;

  const { staticPart, dynamicPart } = buildCombinedRiskCoachingPrompt({
    userRole,
    language,
    conversationHistory,
    patternSummaries,
    sessionId,
    sessionStatus,
    turnCount,
    shouldDraft,
    isFrustrated,
  });

  try {
    const raw = await callClaudeJSON<Record<string, unknown>>({
      staticSystemPrefix: staticPart,
      systemPrompt: dynamicPart,
      userMessage: message,
      maxTokens: 1500,
      sessionId,
    });

    const result = combinedRiskCoachingSchema.safeParse(raw);

    if (!result.success) {
      logger.warn('Combined risk+coaching returned invalid format, applying fallback', {
        sessionId,
        errors: result.error.format(),
        raw: JSON.stringify(raw).substring(0, 500),
      });

      // Try to salvage: extract risk if present, use raw coaching
      const rawRisk = (raw as Record<string, unknown>)?.risk as Record<string, unknown> | undefined;
      const rawCoaching = (raw as Record<string, unknown>)?.coaching;

      const riskResult = riskAssessmentSchema.safeParse(rawRisk);
      const risk: RiskAssessment = riskResult.success
        ? riskResult.data
        : { risk_level: 'L2', topic_category: FALLBACK_TOPIC_CATEGORY, action_required: 'Fallback — invalid combined response', reasoning: 'Automatic fallback due to parsing error' };

      const coaching = typeof rawCoaching === 'string' && rawCoaching.length > 0
        ? checkResponseQuality(rawCoaching)
        : 'אני כאן בשבילך. ספר/י לי מה קורה?';

      await logRiskEvent({ sessionId, senderRole, riskLevel: risk.risk_level, topicCategory: risk.topic_category, reasoning: risk.reasoning, actionRequired: risk.action_required });

      return { risk, coaching };
    }

    const { risk, coaching } = result.data;

    await logRiskEvent({
      sessionId,
      senderRole,
      riskLevel: risk.risk_level,
      topicCategory: risk.topic_category,
      reasoning: risk.reasoning,
      actionRequired: risk.action_required,
    });

    logger.info('Combined risk+coaching complete', {
      sessionId,
      senderRole,
      riskLevel: risk.risk_level,
      topicCategory: risk.topic_category,
    });

    return { risk, coaching: checkResponseQuality(coaching) };
  } catch (error) {
    logger.error('Combined risk+coaching call failed', {
      sessionId,
      senderRole,
      error: error instanceof Error ? error.message : String(error),
    });

    return {
      risk: {
        risk_level: 'L2',
        topic_category: FALLBACK_TOPIC_CATEGORY,
        action_required: 'Manual review — combined call failed',
        reasoning: 'Automatic fallback due to API failure',
      },
      coaching: 'אירעה שגיאה זמנית. ספר/י לי מה קורה — אני כאן.',
    };
  }
}

async function logRiskEvent(params: {
  sessionId: string;
  senderRole: 'USER_A' | 'USER_B';
  riskLevel: string;
  topicCategory: string;
  reasoning: string;
  actionRequired: string;
}): Promise<void> {
  try {
    await prisma.riskEvent.create({
      data: {
        sessionId: params.sessionId,
        senderRole: params.senderRole,
        riskLevel: params.riskLevel,
        topicCategory: params.topicCategory,
        reasoning: params.reasoning,
        actionRequired: params.actionRequired,
      },
    });
  } catch (error) {
    logger.error('Failed to log risk event', {
      sessionId: params.sessionId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
