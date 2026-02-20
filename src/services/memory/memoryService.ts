import { prisma } from '../../db/client';
import { callClaude } from '../ai/claudeClient';
import { logger } from '../../utils/logger';
import { decrypt } from '../../utils/encryption';
import { env } from '../../config/env';
import type { TopicCategory } from '../../config/constants';
import OpenAI from 'openai';

const openai = new OpenAI({ apiKey: env.OPENAI_API_KEY });

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

    // Generate semantic summary using Claude (decrypt raw content)
    const conversationText = messages
      .filter((m) => m.rawContent)
      .map((m) => {
        let content: string;
        try {
          content = decrypt(m.rawContent!);
        } catch {
          content = m.rawContent!;
        }
        return `[${m.senderRole}] ${content}`;
      })
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

    // Find telemetry record — required for FK constraint
    let telemetry = await prisma.sessionTelemetry.findFirst({
      where: { anonymizedCoupleId },
      orderBy: { createdAt: 'desc' },
    });

    // Create telemetry record if none exists (defensive)
    if (!telemetry) {
      telemetry = await prisma.sessionTelemetry.create({
        data: {
          anonymizedCoupleId,
          sessionStartedAt: new Date(),
          status: 'CLOSED',
        },
      });
      logger.warn('Created missing telemetry record for embedding', { anonymizedCoupleId });
    }

    // Store embedding record (vector added below via raw SQL)
    const embedding = await prisma.sessionEmbedding.create({
      data: {
        anonymizedCoupleId,
        sessionTelemetryId: telemetry.id,
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

    // Generate vector embedding and store via pgvector
    await storeEmbeddingVector(embedding.id, summary);
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
  const { anonymizedCoupleId, currentMessage, threshold } = params;
  const similarityThreshold = threshold ?? env.VECTOR_SIMILARITY_THRESHOLD;

  try {
    // Generate embedding for the current message
    const queryVector = await generateVector(currentMessage);

    if (queryVector) {
      // pgvector cosine similarity search — only for this couple (Anti-Stalker)
      const vectorStr = `[${queryVector.join(',')}]`;
      const results = await prisma.$queryRawUnsafe<Array<{ summary: string; similarity: number }>>(
        `SELECT summary, 1 - (embedding <=> $1::vector) AS similarity
         FROM session_embeddings
         WHERE anonymized_couple_id = $2
           AND embedding IS NOT NULL
           AND 1 - (embedding <=> $1::vector) >= $3
         ORDER BY similarity DESC
         LIMIT 3`,
        vectorStr,
        anonymizedCoupleId,
        similarityThreshold
      );

      if (results.length > 0) {
        return results.map((r) => r.summary);
      }
    }

    // Fallback: retrieve latest 3 session summaries by recency
    const embeddings = await prisma.sessionEmbedding.findMany({
      where: { anonymizedCoupleId },
      orderBy: { createdAt: 'desc' },
      take: 3,
      select: { summary: true },
    });

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
 * Generate a vector embedding using OpenAI text-embedding-3-small.
 * Returns null on failure (non-critical — falls back to recency).
 */
async function generateVector(text: string): Promise<number[] | null> {
  try {
    const response = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: text,
    });
    return response.data[0].embedding;
  } catch (error) {
    logger.error('Failed to generate vector embedding', {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * Store a vector embedding in the pgvector column via raw SQL.
 * Non-critical — if it fails, similarity search falls back to recency.
 */
async function storeEmbeddingVector(embeddingId: string, summary: string): Promise<void> {
  try {
    const vector = await generateVector(summary);
    if (!vector) return;

    const vectorStr = `[${vector.join(',')}]`;
    await prisma.$executeRawUnsafe(
      `UPDATE session_embeddings SET embedding = $1::vector WHERE id = $2`,
      vectorStr,
      embeddingId
    );

    logger.info('Vector embedding stored', { embeddingId });
  } catch (error) {
    logger.error('Failed to store vector embedding', {
      embeddingId,
      error: error instanceof Error ? error.message : String(error),
    });
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
