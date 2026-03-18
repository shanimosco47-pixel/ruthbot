const mockPrismaInterventionOutcome = {
  create: jest.fn(),
  groupBy: jest.fn(),
};

jest.mock('../../db/client', () => ({
  prisma: {
    interventionOutcome: mockPrismaInterventionOutcome,
  },
}));

jest.mock('../../utils/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

import { recordInterventionOutcome, getInterventionStats } from '../../services/memory/interventionTracker';

describe('InterventionTracker', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('recordInterventionOutcome', () => {
    it('should record an approved reframe outcome', async () => {
      mockPrismaInterventionOutcome.create.mockResolvedValue({});

      await recordInterventionOutcome({
        anonymizedCoupleId: 'couple-1',
        interventionType: 'reframe',
        outcome: 'approved',
        editCount: 0,
        topicCategory: 'כספים',
        riskLevel: 'L1',
      });

      expect(mockPrismaInterventionOutcome.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          anonymizedCoupleId: 'couple-1',
          interventionType: 'reframe',
          outcome: 'approved',
          editCount: 0,
        }),
      });
    });

    it('should record an edited_approved outcome with edit count', async () => {
      mockPrismaInterventionOutcome.create.mockResolvedValue({});

      await recordInterventionOutcome({
        anonymizedCoupleId: 'couple-1',
        interventionType: 'reframe',
        outcome: 'edited_approved',
        editCount: 2,
      });

      expect(mockPrismaInterventionOutcome.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          outcome: 'edited_approved',
          editCount: 2,
        }),
      });
    });

    it('should record a cancelled outcome', async () => {
      mockPrismaInterventionOutcome.create.mockResolvedValue({});

      await recordInterventionOutcome({
        anonymizedCoupleId: 'couple-1',
        interventionType: 'reframe',
        outcome: 'cancelled',
      });

      expect(mockPrismaInterventionOutcome.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          outcome: 'cancelled',
          editCount: 0,
        }),
      });
    });

    it('should record a frustration_menu outcome', async () => {
      mockPrismaInterventionOutcome.create.mockResolvedValue({});

      await recordInterventionOutcome({
        anonymizedCoupleId: 'couple-1',
        interventionType: 'frustration_menu',
        outcome: 'approved',
      });

      expect(mockPrismaInterventionOutcome.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          interventionType: 'frustration_menu',
        }),
      });
    });

    it('should not throw on DB failure', async () => {
      mockPrismaInterventionOutcome.create.mockRejectedValue(new Error('DB error'));

      await recordInterventionOutcome({
        anonymizedCoupleId: 'couple-1',
        interventionType: 'reframe',
        outcome: 'approved',
      });

      // Should not throw
    });
  });

  describe('getInterventionStats', () => {
    it('should return grouped stats', async () => {
      mockPrismaInterventionOutcome.groupBy.mockResolvedValue([
        {
          interventionType: 'reframe',
          outcome: 'approved',
          _count: { id: 10 },
          _avg: { editCount: 0.2 },
        },
        {
          interventionType: 'reframe',
          outcome: 'cancelled',
          _count: { id: 3 },
          _avg: { editCount: 0 },
        },
      ]);

      const stats = await getInterventionStats();

      expect(stats).toHaveLength(2);
      expect(stats[0]).toEqual({
        interventionType: 'reframe',
        outcome: 'approved',
        count: 10,
        avgEditCount: 0.2,
      });
    });

    it('should apply filters', async () => {
      mockPrismaInterventionOutcome.groupBy.mockResolvedValue([]);

      await getInterventionStats({
        anonymizedCoupleId: 'couple-1',
        interventionType: 'reframe',
        dateFrom: new Date('2026-01-01'),
      });

      expect(mockPrismaInterventionOutcome.groupBy).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            anonymizedCoupleId: 'couple-1',
            interventionType: 'reframe',
          }),
        })
      );
    });

    it('should return empty array on failure', async () => {
      mockPrismaInterventionOutcome.groupBy.mockRejectedValue(new Error('DB error'));

      const stats = await getInterventionStats();

      expect(stats).toEqual([]);
    });
  });
});
