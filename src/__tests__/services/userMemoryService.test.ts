const mockCallClaudeJSON = jest.fn();
const mockPrismaUserMemory = {
  findMany: jest.fn(),
  upsert: jest.fn(),
  deleteMany: jest.fn(),
};
const mockPrismaUser = {
  findUnique: jest.fn(),
};

jest.mock('../../services/ai/claudeClient', () => ({
  callClaudeJSON: (...args: unknown[]) => mockCallClaudeJSON(...args),
}));

jest.mock('../../db/client', () => ({
  prisma: {
    userMemory: mockPrismaUserMemory,
    user: mockPrismaUser,
  },
}));

jest.mock('../../utils/encryption', () => ({
  encrypt: (text: string) => `encrypted:${text}`,
  decrypt: (text: string) => text.replace('encrypted:', ''),
}));

jest.mock('../../utils/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

import { extractUserFacts, getUserMemoryProfile, formatMemoryForPrompt, deleteUserMemories } from '../../services/memory/userMemoryService';
import type { TopicCategory } from '../../config/constants';

describe('UserMemoryService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('extractUserFacts', () => {
    const baseParams = {
      sessionId: 'session-1',
      userId: 'user-1',
      userRole: 'USER_A' as const,
      topicCategory: 'חלוקת תפקידים בבית' as TopicCategory,
      conversationHistory: [
        { role: 'USER_A' as const, content: 'אני עושה הכל בבית, יש לנו 2 ילדים קטנים', timestamp: new Date() },
        { role: 'BOT' as const, content: 'שומעת, זה שוחק', timestamp: new Date() },
        { role: 'USER_A' as const, content: 'הילדים בגילאי 3 ו-7, אני לבד עם הכל', timestamp: new Date() },
        { role: 'BOT' as const, content: 'מה היית רוצה שישתנה?', timestamp: new Date() },
      ],
    };

    it('should extract and upsert facts from conversation', async () => {
      mockCallClaudeJSON.mockResolvedValue({
        facts: [
          { category: 'family_context', key: 'children', value: '2 kids, ages 3 and 7', confidence: 0.95 },
          { category: 'recurring_topic', key: 'division_of_labor', value: 'feels alone with household', confidence: 0.9 },
        ],
      });
      mockPrismaUserMemory.upsert.mockResolvedValue({});

      await extractUserFacts(baseParams);

      expect(mockCallClaudeJSON).toHaveBeenCalledTimes(1);
      expect(mockPrismaUserMemory.upsert).toHaveBeenCalledTimes(2);
      expect(mockPrismaUserMemory.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            userId_category_factKey: {
              userId: 'user-1',
              category: 'family_context',
              factKey: 'children',
            },
          },
          create: expect.objectContaining({
            userId: 'user-1',
            category: 'family_context',
            factKey: 'children',
            factValue: 'encrypted:2 kids, ages 3 and 7',
            confidence: 0.95,
          }),
        })
      );
    });

    it('should skip invalid categories', async () => {
      mockCallClaudeJSON.mockResolvedValue({
        facts: [
          { category: 'invalid_category', key: 'test', value: 'test', confidence: 0.9 },
          { category: 'family_context', key: 'children', value: '1 kid', confidence: 0.8 },
        ],
      });
      mockPrismaUserMemory.upsert.mockResolvedValue({});

      await extractUserFacts(baseParams);

      // Only the valid category should be upserted
      expect(mockPrismaUserMemory.upsert).toHaveBeenCalledTimes(1);
    });

    it('should handle empty facts gracefully', async () => {
      mockCallClaudeJSON.mockResolvedValue({ facts: [] });

      await extractUserFacts(baseParams);

      expect(mockPrismaUserMemory.upsert).not.toHaveBeenCalled();
    });

    it('should handle Claude API failure gracefully', async () => {
      mockCallClaudeJSON.mockRejectedValue(new Error('API timeout'));

      await extractUserFacts(baseParams);

      // Should not throw
      expect(mockPrismaUserMemory.upsert).not.toHaveBeenCalled();
    });

    it('should skip messages too short for extraction', async () => {
      await extractUserFacts({
        ...baseParams,
        conversationHistory: [
          { role: 'USER_A' as const, content: 'hi', timestamp: new Date() },
        ],
      });

      expect(mockCallClaudeJSON).not.toHaveBeenCalled();
    });

    it('should clamp confidence to valid range', async () => {
      mockCallClaudeJSON.mockResolvedValue({
        facts: [
          { category: 'family_context', key: 'children', value: 'test', confidence: 1.5 },
        ],
      });
      mockPrismaUserMemory.upsert.mockResolvedValue({});

      await extractUserFacts(baseParams);

      expect(mockPrismaUserMemory.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            confidence: 1.0,
          }),
        })
      );
    });
  });

  describe('getUserMemoryProfile', () => {
    it('should return decrypted memories', async () => {
      mockPrismaUserMemory.findMany.mockResolvedValue([
        {
          category: 'family_context',
          factKey: 'children',
          factValue: 'encrypted:2 kids',
          confidence: 0.95,
          updatedAt: new Date('2026-03-01'),
        },
      ]);

      const result = await getUserMemoryProfile('user-1');

      expect(result).toHaveLength(1);
      expect(result[0].factValue).toBe('2 kids');
      expect(result[0].category).toBe('family_context');
    });
  });

  describe('formatMemoryForPrompt', () => {
    it('should return null for users with no memories', async () => {
      mockPrismaUserMemory.findMany.mockResolvedValue([]);

      const result = await formatMemoryForPrompt('user-1');

      expect(result).toBeNull();
    });

    it('should format memories into a readable string', async () => {
      mockPrismaUserMemory.findMany.mockResolvedValue([
        { category: 'family_context', factKey: 'children', factValue: 'encrypted:2 kids, ages 3 and 7', confidence: 0.95, updatedAt: new Date() },
        { category: 'recurring_topic', factKey: 'division', factValue: 'encrypted:household responsibilities', confidence: 0.9, updatedAt: new Date() },
      ]);
      mockPrismaUser.findUnique.mockResolvedValue({
        totalSessionCount: 3,
        lastSessionAt: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000), // 14 days ago
      });

      const result = await formatMemoryForPrompt('user-1');

      expect(result).not.toBeNull();
      expect(result).toContain('User Profile (from 3 past sessions)');
      expect(result).toContain('Family');
      expect(result).toContain('Recurring');
      expect(result).toContain('14 days ago');
    });

    it('should handle single session count grammar', async () => {
      mockPrismaUserMemory.findMany.mockResolvedValue([
        { category: 'preference', factKey: 'lang', factValue: 'encrypted:hebrew', confidence: 0.8, updatedAt: new Date() },
      ]);
      mockPrismaUser.findUnique.mockResolvedValue({
        totalSessionCount: 1,
        lastSessionAt: new Date(),
      });

      const result = await formatMemoryForPrompt('user-1');

      expect(result).toContain('1 past session');
    });
  });

  describe('deleteUserMemories', () => {
    it('should delete all memories for a user', async () => {
      mockPrismaUserMemory.deleteMany.mockResolvedValue({ count: 5 });

      const count = await deleteUserMemories('user-1');

      expect(count).toBe(5);
      expect(mockPrismaUserMemory.deleteMany).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
      });
    });
  });
});
