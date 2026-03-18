import { prisma } from '../../db/client';
import { logger } from '../../utils/logger';

export type InterventionType = 'reframe' | 'coaching' | 'frustration_menu';
export type InterventionOutcomeType = 'approved' | 'edited_approved' | 'cancelled' | 'ignored';

/**
 * Record the outcome of an intervention (reframe approve/edit/cancel).
 * Telemetry layer — no PII, only anonymized couple ID.
 */
export async function recordInterventionOutcome(params: {
  anonymizedCoupleId: string;
  interventionType: InterventionType;
  outcome: InterventionOutcomeType;
  editCount?: number;
  topicCategory?: string;
  riskLevel?: string;
  turnNumber?: number;
}): Promise<void> {
  try {
    await prisma.interventionOutcome.create({
      data: {
        anonymizedCoupleId: params.anonymizedCoupleId,
        interventionType: params.interventionType,
        outcome: params.outcome,
        editCount: params.editCount ?? 0,
        topicCategory: params.topicCategory,
        riskLevel: params.riskLevel,
        turnNumber: params.turnNumber,
      },
    });

    logger.info('Intervention outcome recorded', {
      anonymizedCoupleId: params.anonymizedCoupleId,
      type: params.interventionType,
      outcome: params.outcome,
    });
  } catch (error) {
    // Non-critical telemetry — don't crash the flow
    logger.error('Failed to record intervention outcome', {
      anonymizedCoupleId: params.anonymizedCoupleId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Get intervention statistics for analysis/training export.
 */
export async function getInterventionStats(filters?: {
  anonymizedCoupleId?: string;
  interventionType?: InterventionType;
  dateFrom?: Date;
  dateTo?: Date;
}): Promise<Array<{
  interventionType: string;
  outcome: string;
  count: number;
  avgEditCount: number;
}>> {
  try {
    const where: Record<string, unknown> = {};
    if (filters?.anonymizedCoupleId) where.anonymizedCoupleId = filters.anonymizedCoupleId;
    if (filters?.interventionType) where.interventionType = filters.interventionType;
    if (filters?.dateFrom || filters?.dateTo) {
      where.createdAt = {
        ...(filters.dateFrom && { gte: filters.dateFrom }),
        ...(filters.dateTo && { lte: filters.dateTo }),
      };
    }

    const results = await prisma.interventionOutcome.groupBy({
      by: ['interventionType', 'outcome'],
      where,
      _count: { id: true },
      _avg: { editCount: true },
    });

    return results.map((r) => ({
      interventionType: r.interventionType,
      outcome: r.outcome,
      count: r._count.id,
      avgEditCount: r._avg.editCount ?? 0,
    }));
  } catch (error) {
    logger.error('Failed to get intervention stats', {
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}
