// Mock all dependencies
const mockClassifyRisk = jest.fn();
const mockClassifyRiskAndCoach = jest.fn();
const mockCallClaude = jest.fn();
const mockBuildReframePrompt = jest.fn().mockReturnValue('reframe-prompt');
const mockGetEmergencyResources = jest.fn().mockReturnValue('Emergency: call 1201');
const mockTransition = jest.fn();
const mockCleanup = jest.fn();
const mockPrismaMessageCreate = jest.fn();
const mockPrismaMessageFindMany = jest.fn();
const mockPrismaEmbeddingFindMany = jest.fn();
const mockEncrypt = jest.fn().mockImplementation((text: string) => `enc_${text}`);
const mockDecrypt = jest.fn().mockImplementation((text: string) => text.startsWith('enc_') ? text.slice(4) : text);

jest.mock('../../services/risk/riskEngine', () => ({
  classifyRisk: (...args: any[]) => mockClassifyRisk(...args),
  classifyRiskAndCoach: (...args: any[]) => mockClassifyRiskAndCoach(...args),
}));

jest.mock('../../services/ai/claudeClient', () => ({
  callClaude: (...args: any[]) => mockCallClaude(...args),
}));

jest.mock('../../services/ai/systemPrompts', () => ({
  buildReframePrompt: (...args: any[]) => mockBuildReframePrompt(...args),
  getEmergencyResources: (...args: any[]) => mockGetEmergencyResources(...args),
}));

jest.mock('../../core/stateMachine/sessionStateMachine', () => ({
  SessionStateMachine: {
    transition: (...args: any[]) => mockTransition(...args),
  },
}));

jest.mock('../../adapters/telegram/handlers/callbackHandler', () => ({
  cleanupSessionState: (...args: any[]) => mockCleanup(...args),
}));

jest.mock('../../db/client', () => ({
  prisma: {
    message: {
      create: (...args: any[]) => mockPrismaMessageCreate(...args),
      findMany: (...args: any[]) => mockPrismaMessageFindMany(...args),
    },
    sessionEmbedding: {
      findMany: (...args: any[]) => mockPrismaEmbeddingFindMany(...args),
    },
  },
}));

jest.mock('../../services/memory/memoryService', () => ({
  retrievePatterns: jest.fn().mockResolvedValue([]),
}));

jest.mock('../../utils/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

jest.mock('../../utils/encryption', () => ({
  encrypt: (...args: any[]) => mockEncrypt(...args),
  decrypt: (...args: any[]) => mockDecrypt(...args),
}));

import { processMessage, secondRiskCheck } from '../../core/pipeline/messagePipeline';
import type { PipelineInput } from '../../types';

const makeInput = (overrides?: Partial<PipelineInput>): PipelineInput => ({
  context: {
    sessionId: 'session-1',
    anonymizedCoupleId: 'anon-1',
    userAId: 'user-a',
    userBId: 'user-b',
    currentUserId: 'user-a',
    currentRole: 'USER_A',
    status: 'ACTIVE',
    language: 'he',
  },
  rawText: 'אני רוצה לדבר על משהו חשוב',
  messageType: 'TEXT',
  telegramMessageId: 123,
  ...overrides,
});

describe('Message Pipeline', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPrismaMessageCreate.mockResolvedValue({});
    mockPrismaMessageFindMany.mockResolvedValue([]);
    mockPrismaEmbeddingFindMany.mockResolvedValue([]);
    mockCallClaude.mockResolvedValue('reframed message');
  });

  // ============================================
  // L1 — Normal flow (combined call)
  // ============================================
  describe('L1 flow', () => {
    beforeEach(() => {
      mockClassifyRiskAndCoach.mockResolvedValue({
        risk: {
          risk_level: 'L1',
          topic_category: 'תקשורת ורגש',
          action_required: 'none',
          reasoning: 'safe',
        },
        coaching: 'coaching response',
      });
    });

    it('should use combined risk+coaching call', async () => {
      const input = makeInput();
      await processMessage(input);

      expect(mockClassifyRiskAndCoach).toHaveBeenCalledWith(
        expect.objectContaining({
          message: input.rawText,
          sessionId: 'session-1',
          senderRole: 'USER_A',
        })
      );
    });

    it('should return coaching response from combined call', async () => {
      const result = await processMessage(makeInput());

      expect(result.coachingResponse).toBe('coaching response');
      expect(result.riskLevel).toBe('L1');
      expect(result.halted).toBe(false);
    });

    it('should generate reframe when session is ACTIVE with partner', async () => {
      mockCallClaude.mockResolvedValueOnce('reframed message');

      const result = await processMessage(makeInput());

      expect(result.reframedMessage).toBe('reframed message');
      expect(result.requiresApproval).toBe(true);
    });

    it('should NOT generate reframe when no partner (solo coaching)', async () => {
      const input = makeInput({
        context: {
          sessionId: 'session-1',
          anonymizedCoupleId: 'anon-1',
          userAId: 'user-a',
          userBId: null,
          currentUserId: 'user-a',
          currentRole: 'USER_A',
          status: 'ASYNC_COACHING',
          language: 'he',
        },
      });

      const result = await processMessage(input);

      expect(result.reframedMessage).toBeNull();
      expect(result.requiresApproval).toBe(false);
    });

    it('should encrypt raw content before storing in DB', async () => {
      await processMessage(makeInput());

      const createCalls = mockPrismaMessageCreate.mock.calls;
      const userMessageCall = createCalls.find((c: any[]) => c[0]?.data?.messageType === 'TEXT');
      expect(userMessageCall?.[0].data.rawContent).toBe('enc_אני רוצה לדבר על משהו חשוב');
    });

    it('should encrypt coaching response before storing in DB', async () => {
      await processMessage(makeInput());

      const createCalls = mockPrismaMessageCreate.mock.calls;
      const coachingCall = createCalls.find((c: any[]) => c[0]?.data?.messageType === 'COACHING');
      expect(coachingCall?.[0].data.rawContent).toBe('enc_coaching response');
    });
  });

  // ============================================
  // L2 — Mild risk
  // ============================================
  describe('L2 flow', () => {
    it('should continue pipeline and generate reframe for L2', async () => {
      mockClassifyRiskAndCoach.mockResolvedValue({
        risk: {
          risk_level: 'L2',
          topic_category: 'תקשורת ורגש',
          action_required: 'soften language',
          reasoning: 'mild frustration',
        },
        coaching: 'L2 coaching',
      });
      mockCallClaude.mockResolvedValueOnce('L2 reframe');

      const result = await processMessage(makeInput());

      expect(result.riskLevel).toBe('L2');
      expect(result.coachingResponse).toBe('L2 coaching');
      expect(result.reframedMessage).toBe('L2 reframe');
      expect(result.halted).toBe(false);
    });
  });

  // ============================================
  // L3 — High risk (coaching from combined call, no reframe)
  // ============================================
  describe('L3 flow', () => {
    it('should stop pipeline, return coaching from combined call, no reframe', async () => {
      mockClassifyRiskAndCoach.mockResolvedValue({
        risk: {
          risk_level: 'L3',
          topic_category: 'גבולות ומרחב אישי',
          action_required: 'Stop pipeline, coach sender',
          reasoning: 'threatening language',
        },
        coaching: 'L3 coaching — please reconsider',
      });

      const result = await processMessage(makeInput());

      expect(result.riskLevel).toBe('L3');
      expect(result.coachingResponse).toBe('L3 coaching — please reconsider');
      expect(result.reframedMessage).toBeNull();
      expect(result.requiresApproval).toBe(false);
      expect(result.halted).toBe(false);
    });
  });

  // ============================================
  // L3_PLUS — High risk
  // ============================================
  describe('L3_PLUS flow', () => {
    it('should handle L3_PLUS same as L3', async () => {
      mockClassifyRiskAndCoach.mockResolvedValue({
        risk: {
          risk_level: 'L3_PLUS',
          topic_category: 'תקשורת ורגש',
          action_required: 'Stop pipeline',
          reasoning: 'escalated threat',
        },
        coaching: 'L3+ coaching',
      });

      const result = await processMessage(makeInput());

      expect(result.riskLevel).toBe('L3_PLUS');
      expect(result.reframedMessage).toBeNull();
    });
  });

  // ============================================
  // L4 — Critical safety / Hard stop
  // ============================================
  describe('L4 hard stop', () => {
    it('should halt pipeline and return emergency resources', async () => {
      mockClassifyRiskAndCoach.mockResolvedValue({
        risk: {
          risk_level: 'L4',
          topic_category: 'תקשורת ורגש',
          action_required: 'HALT immediately',
          reasoning: 'self-harm detected',
        },
        coaching: 'ignored coaching',
      });

      const result = await processMessage(makeInput());

      expect(result.riskLevel).toBe('L4');
      expect(result.halted).toBe(true);
      expect(result.haltReason).toBe('L4_critical_safety');
      expect(result.coachingResponse).toContain('Emergency');
    });

    it('should lock session on L4', async () => {
      mockClassifyRiskAndCoach.mockResolvedValue({
        risk: {
          risk_level: 'L4',
          topic_category: 'תקשורת ורגש',
          action_required: 'HALT',
          reasoning: 'danger',
        },
        coaching: 'ignored',
      });

      await processMessage(makeInput());

      expect(mockTransition).toHaveBeenCalledWith(
        'session-1',
        'LOCKED',
        expect.objectContaining({ reason: 'L4_hard_stop' })
      );
    });

    it('should cleanup session state on L4', async () => {
      mockClassifyRiskAndCoach.mockResolvedValue({
        risk: {
          risk_level: 'L4',
          topic_category: 'תקשורת ורגש',
          action_required: 'HALT',
          reasoning: 'danger',
        },
        coaching: 'ignored',
      });

      await processMessage(makeInput());

      expect(mockCleanup).toHaveBeenCalledWith('session-1');
    });

    it('should NOT call standalone Claude for coaching on L4', async () => {
      mockClassifyRiskAndCoach.mockResolvedValue({
        risk: {
          risk_level: 'L4',
          topic_category: 'תקשורת ורגש',
          action_required: 'HALT',
          reasoning: 'danger',
        },
        coaching: 'ignored',
      });

      await processMessage(makeInput());

      // callClaude should NOT be called (reframe is skipped on L4)
      expect(mockCallClaude).not.toHaveBeenCalled();
    });
  });

  // ============================================
  // Frustration — fast path (risk-only call + menu)
  // ============================================
  describe('Frustration fast path', () => {
    it('should use risk-only call for frustrated users', async () => {
      mockClassifyRisk.mockResolvedValue({
        risk_level: 'L1',
        topic_category: 'תקשורת ורגש',
        action_required: 'none',
        reasoning: 'frustration',
      });

      const input = makeInput({ rawText: 'נמאס לי מזה' });
      const result = await processMessage(input);

      expect(mockClassifyRisk).toHaveBeenCalled();
      expect(mockClassifyRiskAndCoach).not.toHaveBeenCalled();
      expect(result.coachingResponse).toContain('בחר אחד');
    });

    it('should still detect L4 in frustrated messages', async () => {
      mockClassifyRisk.mockResolvedValue({
        risk_level: 'L4',
        topic_category: 'תקשורת ורגש',
        action_required: 'HALT',
        reasoning: 'self-harm in frustrated message',
      });

      const input = makeInput({ rawText: 'נמאס לי, אני רוצה למות' });
      const result = await processMessage(input);

      expect(result.riskLevel).toBe('L4');
      expect(result.halted).toBe(true);
    });
  });

  // ============================================
  // secondRiskCheck
  // ============================================
  describe('secondRiskCheck', () => {
    it('should classify edited text through risk engine', async () => {
      mockClassifyRisk.mockResolvedValue({
        risk_level: 'L1',
        topic_category: 'תקשורת ורגש',
        action_required: 'none',
        reasoning: 'safe edit',
      });

      const result = await secondRiskCheck({
        editedText: 'edited message',
        sessionId: 'session-1',
        senderRole: 'USER_A',
      });

      expect(result.risk_level).toBe('L1');
      expect(mockClassifyRisk).toHaveBeenCalledWith({
        message: 'edited message',
        sessionId: 'session-1',
        senderRole: 'USER_A',
      });
    });
  });
});
