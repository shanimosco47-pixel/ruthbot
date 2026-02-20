import { prisma } from '../../db/client';
import { callClaude } from '../ai/claudeClient';
import { logger } from '../../utils/logger';
import type { TopicCategory } from '../../config/constants';

/**
 * Memory Service — Vector DB for pattern recognition.
 * Uses pgvector for semantic similarity search.
 *
 * What is stored: Session summaries (NOT raw transcripts).
 * What is retrieved: Top 3 matches above similarity threshold.
 * Anti-Stalker: Only patterns relevant to current conflict.
 */

/**
 * Generate and store a session summary embedding after session closes.
 * Called when session transitions to CLOSED.
 */
export async function generateSessionEmbedding(params: {
  sessionId: string;
  anonymizedCoupleId: string;
  userRole: 'A' | 'B';
  topicCategory: TopicCategory;
}): Promise<void> {
  const { sessionId, anonymizedCoupleId, userRole, topicCategory } = params;

  try {
    // Get conversation history for summary generation
    const messages = await prisma.message.findMany({
      where: { sessionId },
      orderBy: { createdAt: 'asc' },
      select: {
        senderRole: true,
        rawContent: true,
        messageType: true,
        createdAt: true,
      },
    });

    if (messages.length === 0) {
      logger.info('No messages to summarize', { sessionId });
      return;
    }

    // Generate semantic summary using Claude
    const conversationText = messages
      .filter((m) => m.rawContent)
      .map((m) => `[${m.senderRole}] ${m.rawContent}`)
      .join('\n');

    const summary = await callClaude({
      systemPrompt: `You are generating a semantic summary of a couples mediation session for pattern recognition.

RULES:
- Focus on COMMUNICATION PATTERNS, not specific grievances.
- Identify dominant emotions (fear, loneliness, rejection, frustration, etc.).
- Note any recurring conflict themes.
- Keep it under 200 words.
- Do NOT include any PII, names, or identifiable information.
- Output in English for consistent embedding.`,
      userMessage: `Session topic: ${topicCategory}\n\nConversation:\n${conversationText}`,
      maxTokens: 512,
      sessionId,
    });

    // Extract dominant emotion tags
    const emotionTagsResponse = await callClaude({
      systemPrompt: `Extract 2-4 dominant emotion tags from this session summary. Return ONLY a JSON array of strings. Example: ["fear_of_abandonment", "loneliness", "need_for_recognition"]`,
      userMessage: summary,
      maxTokens: 128,
      sessionId,
    });

    let emotionTags: string[] = [];
    try {
      emotionTags = JSON.parse(emotionTagsResponse);
    } catch {
      emotionTags = ['unclassified'];
    }

    // Find or create telemetry record
    const telemetry = await prisma.sessionTelemetry.findFirst({
      where: { anonymizedCoupleId },
      orderBy: { createdAt: 'desc' },
    });

    const telemetryId = telemetry?.id || 'unknown';

    // Store embedding record (vector will be added via pgvector extension)
    await prisma.sessionEmbedding.create({
      data: {
        anonymizedCoupleId,
        sessionTelemetryId: telemetryId,
        summary,
        dominantEmotionTags: emotionTags,
        userRole,
      },
    });

    logger.info('Session embedding created', {
      sessionId,
      anonymizedCoupleId,
      userRole,
      emotionTags,
    });

    // TODO: Generate actual vector embedding using text-embedding-3-small
    // and store in pgvector column for similarity search.
    // For MVP, we use text-based retrieval from SessionEmbedding.summary.
  } catch (error) {
    logger.error('Failed to generate session embedding', {
      sessionId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Retrieve relevant pattern summaries for the current conflict.
 * Uses semantic similarity (pgvector) with Anti-Stalker filter.
 */
export async function retrievePatterns(params: {
  anonymizedCoupleId: string;
  currentMessage: string;
  threshold?: number;
}): Promise<string[]> {
  const { anonymizedCoupleId } = params;

  try {
    // TODO: Implement proper vector similarity search with pgvector
    // For MVP, retrieve latest 3 session summaries for this couple
    const embeddings = await prisma.sessionEmbedding.findMany({
      where: { anonymizedCoupleId },
      orderBy: { createdAt: 'desc' },
      take: 3,
      select: { summary: true, dominantEmotionTags: true },
    });

    // Anti-Stalker filter: Only return patterns, not specific grievances
    // The summaries are already generated with this constraint (see generateSessionEmbedding)
    return embeddings.map((e) => e.summary);
  } catch (error) {
    logger.error('Failed to retrieve patterns', {
      anonymizedCoupleId,
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

/**
 * Create telemetry record for a session.
 */
export async function createSessionTelemetry(params: {
  anonymizedCoupleId: string;
  topicCategory?: string;
  invitationVariant?: string;
  inviteTtlHours?: number;
  partnerHasTelegram?: boolean;
}): Promise<string> {
  const record = await prisma.sessionTelemetry.create({
    data: {
      anonymizedCoupleId: params.anonymizedCoupleId,
      sessionStartedAt: new Date(),
      status: 'ACTIVE',
      topicCategory: params.topicCategory,
      invitationVariant: params.invitationVariant,
      inviteTtlHours: params.inviteTtlHours,
      partnerHasTelegram: params.partnerHasTelegram,
    },
  });

  return record.id;
}

/**
 * Update telemetry on session close.
 */
export async function updateSessionTelemetry(params: {
  anonymizedCoupleId: string;
  status: string;
  topicCategory?: string;
  mirrorAttempts?: number;
  partnerJoined?: boolean;
  emotionScoreStart?: number;
  emotionScoreEnd?: number;
  messageCount?: number;
  riskEventsCount?: number;
  maxRiskLevel?: string;
}): Promise<void> {
  try {
    const latest = await prisma.sessionTelemetry.findFirst({
      where: { anonymizedCoupleId: params.anonymizedCoupleId },
      orderBy: { createdAt: 'desc' },
    });

    if (!latest) {
      logger.warn('No telemetry record found to update', {
        anonymizedCoupleId: params.anonymizedCoupleId,
      });
      return;
    }

    await prisma.sessionTelemetry.update({
      where: { id: latest.id },
      data: {
        sessionClosedAt: new Date(),
        status: params.status,
        topicCategory: params.topicCategory ?? latest.topicCategory,
        mirrorAttempts: params.mirrorAttempts ?? latest.mirrorAttempts,
        partnerJoined: params.partnerJoined ?? latest.partnerJoined,
        emotionScoreStart: params.emotionScoreStart,
        emotionScoreEnd: params.emotionScoreEnd,
        messageCount: params.messageCount ?? latest.messageCount,
        riskEventsCount: params.riskEventsCount ?? latest.riskEventsCount,
        maxRiskLevel: params.maxRiskLevel ?? latest.maxRiskLevel,
      },
    });
  } catch (error) {
    logger.error('Failed to update session telemetry', {
      anonymizedCoupleId: params.anonymizedCoupleId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
