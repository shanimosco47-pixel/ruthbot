import { prisma } from '../../db/client';
import { logger } from '../../utils/logger';

interface TrainingDataRecord {
  anonymizedCoupleId: string;
  sessionStartedAt: Date | null;
  sessionClosedAt: Date | null;
  topicCategory: string | null;
  messageCount: number;
  maxRiskLevel: string | null;
  emotionScoreStart: number | null;
  emotionScoreEnd: number | null;
  embeddingSummary: string | null;
  emotionTags: string[];
  recurringThemes: string[];
  interventionMethods: string[];
  interventionOutcomes: Array<{
    type: string;
    outcome: string;
    editCount: number;
  }>;
}

/**
 * Export anonymized training data for the trainer bot.
 * Zero PII — only telemetry layer data.
 */
export async function exportTrainingData(params?: {
  dateFrom?: Date;
  dateTo?: Date;
  anonymizedCoupleId?: string;
}): Promise<TrainingDataRecord[]> {
  try {
    const telemetryWhere: Record<string, unknown> = {};
    if (params?.anonymizedCoupleId) {
      telemetryWhere.anonymizedCoupleId = params.anonymizedCoupleId;
    }
    if (params?.dateFrom || params?.dateTo) {
      telemetryWhere.createdAt = {
        ...(params?.dateFrom && { gte: params.dateFrom }),
        ...(params?.dateTo && { lte: params.dateTo }),
      };
    }

    const telemetryRecords = await prisma.sessionTelemetry.findMany({
      where: telemetryWhere,
      orderBy: { createdAt: 'desc' },
      take: 500,
    });

    const coupleIds = [...new Set(telemetryRecords.map((t) => t.anonymizedCoupleId))];

    // Batch fetch embeddings and outcomes
    const [embeddings, outcomes] = await Promise.all([
      prisma.sessionEmbedding.findMany({
        where: { anonymizedCoupleId: { in: coupleIds } },
      }),
      prisma.interventionOutcome.findMany({
        where: { anonymizedCoupleId: { in: coupleIds } },
      }),
    ]);

    // Index by coupleId
    const embeddingsByCouple = new Map<string, typeof embeddings>();
    for (const e of embeddings) {
      const list = embeddingsByCouple.get(e.anonymizedCoupleId) || [];
      list.push(e);
      embeddingsByCouple.set(e.anonymizedCoupleId, list);
    }

    const outcomesByCouple = new Map<string, typeof outcomes>();
    for (const o of outcomes) {
      const list = outcomesByCouple.get(o.anonymizedCoupleId) || [];
      list.push(o);
      outcomesByCouple.set(o.anonymizedCoupleId, list);
    }

    return telemetryRecords.map((t) => {
      const coupleEmbeddings = embeddingsByCouple.get(t.anonymizedCoupleId) || [];
      const coupleOutcomes = outcomesByCouple.get(t.anonymizedCoupleId) || [];
      const latestEmbedding = coupleEmbeddings[0];

      return {
        anonymizedCoupleId: t.anonymizedCoupleId,
        sessionStartedAt: t.sessionStartedAt,
        sessionClosedAt: t.sessionClosedAt,
        topicCategory: t.topicCategory,
        messageCount: t.messageCount,
        maxRiskLevel: t.maxRiskLevel,
        emotionScoreStart: t.emotionScoreStart,
        emotionScoreEnd: t.emotionScoreEnd,
        embeddingSummary: latestEmbedding?.summary || null,
        emotionTags: latestEmbedding?.dominantEmotionTags || [],
        recurringThemes: latestEmbedding?.recurringThemes || [],
        interventionMethods: latestEmbedding?.interventionMethods || [],
        interventionOutcomes: coupleOutcomes.map((o) => ({
          type: o.interventionType,
          outcome: o.outcome,
          editCount: o.editCount,
        })),
      };
    });
  } catch (error) {
    logger.error('Failed to export training data', {
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}
