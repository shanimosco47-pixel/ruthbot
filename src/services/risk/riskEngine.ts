import { z } from 'zod';
import { callClaudeJSON } from '../ai/claudeClient';
import { buildRiskEnginePrompt } from '../ai/systemPrompts';
import { TOPIC_CATEGORIES, RISK_LEVELS, FALLBACK_TOPIC_CATEGORY } from '../../config/constants';
import type { RiskAssessment } from '../../types';
import { logger } from '../../utils/logger';
import { prisma } from '../../db/client';

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

  const systemPrompt = buildRiskEnginePrompt();

  try {
    const raw = await callClaudeJSON<Record<string, unknown>>({
      systemPrompt,
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
