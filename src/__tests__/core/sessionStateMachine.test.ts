import { VALID_TRANSITIONS } from '../../config/constants';

// Mock Prisma
const mockFindUnique = jest.fn();
const mockUpdate = jest.fn();

jest.mock('../../db/client', () => ({
  prisma: {
    coupleSession: {
      findUnique: (...args: unknown[]) => mockFindUnique(...args),
      update: (...args: unknown[]) => mockUpdate(...args),
      findMany: jest.fn().mockResolvedValue([]),
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

import { SessionStateMachine } from '../../core/stateMachine/sessionStateMachine';

describe('SessionStateMachine', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ============================================
  // isValidTransition — pure function, no mocks
  // ============================================
  describe('isValidTransition', () => {
    it('should allow valid transitions per the state machine diagram', () => {
      // INVITE_CRAFTING → INVITE_PENDING
      expect(SessionStateMachine.isValidTransition('INVITE_CRAFTING', 'INVITE_PENDING')).toBe(true);
      // ACTIVE → PAUSED
      expect(SessionStateMachine.isValidTransition('ACTIVE', 'PAUSED')).toBe(true);
      // ACTIVE → CLOSED
      expect(SessionStateMachine.isValidTransition('ACTIVE', 'CLOSED')).toBe(true);
      // ACTIVE → LOCKED
      expect(SessionStateMachine.isValidTransition('ACTIVE', 'LOCKED')).toBe(true);
      // PAUSED → ACTIVE
      expect(SessionStateMachine.isValidTransition('PAUSED', 'ACTIVE')).toBe(true);
      // CLOSED → LOCKED
      expect(SessionStateMachine.isValidTransition('CLOSED', 'LOCKED')).toBe(true);
    });

    it('should reject invalid transitions', () => {
      // LOCKED → anything (terminal state)
      expect(SessionStateMachine.isValidTransition('LOCKED', 'ACTIVE')).toBe(false);
      expect(SessionStateMachine.isValidTransition('LOCKED', 'CLOSED')).toBe(false);
      // ACTIVE → INVITE_CRAFTING (backwards)
      expect(SessionStateMachine.isValidTransition('ACTIVE', 'INVITE_CRAFTING')).toBe(false);
      // INVITE_CRAFTING → ACTIVE (skip states)
      expect(SessionStateMachine.isValidTransition('INVITE_CRAFTING', 'ACTIVE')).toBe(false);
    });

    it('should reject unknown states', () => {
      expect(SessionStateMachine.isValidTransition('NONEXISTENT', 'ACTIVE')).toBe(false);
    });

    it('should validate LOCKED is terminal (no valid outgoing transitions)', () => {
      const lockedTransitions = VALID_TRANSITIONS['LOCKED'];
      expect(lockedTransitions).toBeDefined();
      expect(lockedTransitions.length).toBe(0);
    });

    it('should validate every state has an entry in VALID_TRANSITIONS', () => {
      const allStates = [
        'INVITE_CRAFTING', 'INVITE_PENDING', 'PENDING_PARTNER_CONSENT',
        'REFLECTION_GATE', 'ACTIVE', 'ASYNC_COACHING', 'PAUSED',
        'CLOSED', 'LOCKED', 'PARTNER_DECLINED',
      ];
      for (const state of allStates) {
        expect(VALID_TRANSITIONS[state]).toBeDefined();
      }
    });

    it('should validate all transition targets exist as states', () => {
      for (const [_source, targets] of Object.entries(VALID_TRANSITIONS)) {
        for (const target of targets) {
          expect(VALID_TRANSITIONS[target]).toBeDefined();
        }
      }
    });
  });

  // ============================================
  // transition — requires mocks
  // ============================================
  describe('transition', () => {
    it('should transition a session to a valid new status', async () => {
      mockFindUnique.mockResolvedValue({
        status: 'ACTIVE',
        anonymizedCoupleId: 'anon-123',
      });
      mockUpdate.mockResolvedValue({});

      await SessionStateMachine.transition('session-1', 'PAUSED' as any, { reason: 'test' });

      expect(mockUpdate).toHaveBeenCalledWith({
        where: { id: 'session-1' },
        data: { status: 'PAUSED' },
      });
    });

    it('should set closedAt when transitioning to CLOSED', async () => {
      mockFindUnique.mockResolvedValue({
        status: 'ACTIVE',
        anonymizedCoupleId: 'anon-123',
      });
      mockUpdate.mockResolvedValue({});

      await SessionStateMachine.transition('session-1', 'CLOSED' as any);

      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'CLOSED',
            closedAt: expect.any(Date),
          }),
        })
      );
    });

    it('should NOT set closedAt for non-CLOSED transitions', async () => {
      mockFindUnique.mockResolvedValue({
        status: 'ACTIVE',
        anonymizedCoupleId: 'anon-123',
      });
      mockUpdate.mockResolvedValue({});

      await SessionStateMachine.transition('session-1', 'PAUSED' as any);

      const updateCall = mockUpdate.mock.calls[0][0];
      expect(updateCall.data.closedAt).toBeUndefined();
    });

    it('should throw on invalid transition', async () => {
      mockFindUnique.mockResolvedValue({
        status: 'LOCKED',
        anonymizedCoupleId: 'anon-123',
      });

      await expect(
        SessionStateMachine.transition('session-1', 'ACTIVE' as any)
      ).rejects.toThrow('Invalid state transition: LOCKED → ACTIVE');
    });

    it('should throw when session not found', async () => {
      mockFindUnique.mockResolvedValue(null);

      await expect(
        SessionStateMachine.transition('nonexistent', 'ACTIVE' as any)
      ).rejects.toThrow('Session not found: nonexistent');
    });
  });

  // ============================================
  // getStatus
  // ============================================
  describe('getStatus', () => {
    it('should return current session status', async () => {
      mockFindUnique.mockResolvedValue({ status: 'ACTIVE' });

      const status = await SessionStateMachine.getStatus('session-1');
      expect(status).toBe('ACTIVE');
    });

    it('should throw when session not found', async () => {
      mockFindUnique.mockResolvedValue(null);

      await expect(
        SessionStateMachine.getStatus('nonexistent')
      ).rejects.toThrow('Session not found: nonexistent');
    });
  });

  // ============================================
  // Exhaustive transition coverage
  // ============================================
  describe('exhaustive transition validation', () => {
    // Test every declared valid transition in the map
    for (const [source, targets] of Object.entries(VALID_TRANSITIONS)) {
      for (const target of targets) {
        it(`should allow ${source} → ${target}`, () => {
          expect(SessionStateMachine.isValidTransition(source, target)).toBe(true);
        });
      }
    }

    // Test critical invalid transitions
    const invalidTransitions = [
      ['LOCKED', 'ACTIVE'],
      ['LOCKED', 'CLOSED'],
      ['LOCKED', 'PAUSED'],
      ['CLOSED', 'ACTIVE'],
      ['CLOSED', 'PAUSED'],
      ['ACTIVE', 'INVITE_CRAFTING'],
      ['ACTIVE', 'INVITE_PENDING'],
      ['ACTIVE', 'PENDING_PARTNER_CONSENT'],
      ['ACTIVE', 'REFLECTION_GATE'],
      ['INVITE_CRAFTING', 'ACTIVE'],
      ['INVITE_CRAFTING', 'LOCKED'],
      ['PARTNER_DECLINED', 'ACTIVE'],
      ['PARTNER_DECLINED', 'LOCKED'],
    ];

    for (const [source, target] of invalidTransitions) {
      it(`should reject ${source} → ${target}`, () => {
        expect(SessionStateMachine.isValidTransition(source, target)).toBe(false);
      });
    }
  });
});
