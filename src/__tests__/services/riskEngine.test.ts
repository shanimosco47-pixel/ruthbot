import { z } from 'zod';
import { TOPIC_CATEGORIES, RISK_LEVELS, FALLBACK_TOPIC_CATEGORY } from '../../config/constants';

// Mock external dependencies
const mockCallClaudeJSON = jest.fn();

jest.mock('../../services/ai/claudeClient', () => ({
  callClaudeJSON: (...args: unknown[]) => mockCallClaudeJSON(...args),
}));

jest.mock('../../services/ai/systemPrompts', () => ({
  buildRiskEnginePrompt: () => 'test-risk-engine-prompt',
}));

jest.mock('../../db/client', () => ({
  prisma: {
    riskEvent: {
      create: jest.fn().mockResolvedValue({}),
    },
  },
}));

jest.mock('../../utils/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

import { classifyRisk } from '../../services/risk/riskEngine';

describe('Risk Engine', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ============================================
  // Valid risk assessments
  // ============================================
  describe('valid classifications', () => {
    it('should return L1 for safe content', async () => {
      mockCallClaudeJSON.mockResolvedValue({
        risk_level: 'L1',
        topic_category: 'תקשורת ורגש',
        action_required: 'none',
        reasoning: 'Standard communication, no risk detected.',
      });

      const result = await classifyRisk({
        message: 'אני חושב שנצטרך לדבר על זה',
        sessionId: 'session-1',
        senderRole: 'USER_A',
      });

      expect(result.risk_level).toBe('L1');
      expect(result.topic_category).toBe('תקשורת ורגש');
    });

    it('should return L2 for mildly aggressive content', async () => {
      mockCallClaudeJSON.mockResolvedValue({
        risk_level: 'L2',
        topic_category: 'תקשורת ורגש',
        action_required: 'Coach sender on softer language',
        reasoning: 'Mild frustration detected.',
      });

      const result = await classifyRisk({
        message: 'זה ממש מעצבן אותי',
        sessionId: 'session-1',
        senderRole: 'USER_A',
      });

      expect(result.risk_level).toBe('L2');
    });

    it('should return L3 for high-risk content', async () => {
      mockCallClaudeJSON.mockResolvedValue({
        risk_level: 'L3',
        topic_category: 'גבולות ומרחב אישי',
        action_required: 'Stop pipeline, coach sender',
        reasoning: 'Threatening language detected.',
      });

      const result = await classifyRisk({
        message: 'test high risk message',
        sessionId: 'session-1',
        senderRole: 'USER_B',
      });

      expect(result.risk_level).toBe('L3');
    });

    it('should return L4 for critical safety content', async () => {
      mockCallClaudeJSON.mockResolvedValue({
        risk_level: 'L4',
        topic_category: 'תקשורת ורגש',
        action_required: 'HALT session immediately. Provide emergency resources.',
        reasoning: 'Self-harm ideation detected.',
      });

      const result = await classifyRisk({
        message: 'test critical message',
        sessionId: 'session-1',
        senderRole: 'USER_A',
      });

      expect(result.risk_level).toBe('L4');
      expect(result.action_required).toContain('HALT');
    });

    it('should accept all valid topic categories', async () => {
      for (const category of TOPIC_CATEGORIES) {
        mockCallClaudeJSON.mockResolvedValue({
          risk_level: 'L1',
          topic_category: category,
          action_required: 'none',
          reasoning: 'test',
        });

        const result = await classifyRisk({
          message: 'test',
          sessionId: 'session-1',
          senderRole: 'USER_A',
        });

        expect(result.topic_category).toBe(category);
      }
    });

    it('should accept all valid risk levels', async () => {
      for (const level of RISK_LEVELS) {
        mockCallClaudeJSON.mockResolvedValue({
          risk_level: level,
          topic_category: 'תקשורת ורגש',
          action_required: 'test',
          reasoning: 'test',
        });

        const result = await classifyRisk({
          message: 'test',
          sessionId: 'session-1',
          senderRole: 'USER_A',
        });

        expect(result.risk_level).toBe(level);
      }
    });
  });

  // ============================================
  // Zod validation fallback
  // ============================================
  describe('Zod validation fallback', () => {
    it('should fallback to L2 when risk_level is invalid', async () => {
      mockCallClaudeJSON.mockResolvedValue({
        risk_level: 'INVALID_LEVEL',
        topic_category: 'תקשורת ורגש',
        action_required: 'test',
        reasoning: 'test',
      });

      const result = await classifyRisk({
        message: 'test',
        sessionId: 'session-1',
        senderRole: 'USER_A',
      });

      expect(result.risk_level).toBe('L2');
      expect(result.topic_category).toBe(FALLBACK_TOPIC_CATEGORY);
    });

    it('should fallback to L2 when topic_category is not in enum', async () => {
      mockCallClaudeJSON.mockResolvedValue({
        risk_level: 'L1',
        topic_category: 'invented_category',
        action_required: 'test',
        reasoning: 'test',
      });

      const result = await classifyRisk({
        message: 'test',
        sessionId: 'session-1',
        senderRole: 'USER_A',
      });

      // Should fallback because topic_category is invalid
      expect(result.risk_level).toBe('L2');
      expect(result.topic_category).toBe(FALLBACK_TOPIC_CATEGORY);
    });

    it('should fallback when response is missing required fields', async () => {
      mockCallClaudeJSON.mockResolvedValue({
        risk_level: 'L1',
        // missing topic_category, action_required, reasoning
      });

      const result = await classifyRisk({
        message: 'test',
        sessionId: 'session-1',
        senderRole: 'USER_A',
      });

      expect(result.risk_level).toBe('L2');
      expect(result.topic_category).toBe(FALLBACK_TOPIC_CATEGORY);
      expect(result.reasoning).toContain('fallback');
    });

    it('should fallback when response is completely wrong type', async () => {
      mockCallClaudeJSON.mockResolvedValue('not an object');

      const result = await classifyRisk({
        message: 'test',
        sessionId: 'session-1',
        senderRole: 'USER_A',
      });

      expect(result.risk_level).toBe('L2');
    });
  });

  // ============================================
  // API failure handling
  // ============================================
  describe('API failure handling', () => {
    it('should fallback to L2 on Claude API failure', async () => {
      mockCallClaudeJSON.mockRejectedValue(new Error('API timeout'));

      const result = await classifyRisk({
        message: 'test',
        sessionId: 'session-1',
        senderRole: 'USER_A',
      });

      expect(result.risk_level).toBe('L2');
      expect(result.topic_category).toBe(FALLBACK_TOPIC_CATEGORY);
      expect(result.reasoning).toContain('API failure');
    });

    it('should never throw — always return a classification', async () => {
      mockCallClaudeJSON.mockRejectedValue(new Error('Network error'));

      // Should not throw
      const result = await classifyRisk({
        message: 'test',
        sessionId: 'session-1',
        senderRole: 'USER_A',
      });

      expect(result).toBeDefined();
      expect(result.risk_level).toBeDefined();
      expect(result.topic_category).toBeDefined();
    });
  });

  // ============================================
  // Zod schema validation (unit)
  // ============================================
  describe('Zod schema validation', () => {
    const riskAssessmentSchema = z.object({
      risk_level: z.enum(RISK_LEVELS),
      topic_category: z.enum(TOPIC_CATEGORIES),
      action_required: z.string(),
      reasoning: z.string(),
    });

    it('should validate a correct risk assessment', () => {
      const result = riskAssessmentSchema.safeParse({
        risk_level: 'L1',
        topic_category: 'תקשורת ורגש',
        action_required: 'none',
        reasoning: 'safe message',
      });
      expect(result.success).toBe(true);
    });

    it('should reject L5 as invalid risk level', () => {
      const result = riskAssessmentSchema.safeParse({
        risk_level: 'L5',
        topic_category: 'תקשורת ורגש',
        action_required: 'none',
        reasoning: 'test',
      });
      expect(result.success).toBe(false);
    });

    it('should reject invented topic category', () => {
      const result = riskAssessmentSchema.safeParse({
        risk_level: 'L1',
        topic_category: 'some new category',
        action_required: 'none',
        reasoning: 'test',
      });
      expect(result.success).toBe(false);
    });

    it('should reject numeric risk_level', () => {
      const result = riskAssessmentSchema.safeParse({
        risk_level: 1,
        topic_category: 'תקשורת ורגש',
        action_required: 'none',
        reasoning: 'test',
      });
      expect(result.success).toBe(false);
    });
  });
});
