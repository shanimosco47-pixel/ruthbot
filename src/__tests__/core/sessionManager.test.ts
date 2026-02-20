// Mock dependencies
const mockUserFindUnique = jest.fn();
const mockUserCreate = jest.fn();
const mockUserUpdate = jest.fn();
const mockSessionCreate = jest.fn();
const mockSessionFindUnique = jest.fn();
const mockSessionFindFirst = jest.fn();
const mockSessionFindMany = jest.fn();
const mockSessionUpdate = jest.fn();
const mockTelemetryCreate = jest.fn();

jest.mock('../../db/client', () => ({
  prisma: {
    user: {
      findUnique: (...args: unknown[]) => mockUserFindUnique(...args),
      create: (...args: unknown[]) => mockUserCreate(...args),
      update: (...args: unknown[]) => mockUserUpdate(...args),
    },
    coupleSession: {
      create: (...args: unknown[]) => mockSessionCreate(...args),
      findUnique: (...args: unknown[]) => mockSessionFindUnique(...args),
      findFirst: (...args: unknown[]) => mockSessionFindFirst(...args),
      findMany: (...args: unknown[]) => mockSessionFindMany(...args),
      update: (...args: unknown[]) => mockSessionUpdate(...args),
    },
    sessionTelemetry: {
      create: (...args: unknown[]) => mockTelemetryCreate(...args),
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

jest.mock('../../utils/encryption', () => ({
  encrypt: jest.fn((text: string) => `enc_${text}`),
  hmacHash: jest.fn((text: string) => `hmac_${text}`),
  generateInviteToken: jest.fn(() => 'a'.repeat(64)),
  generateAnonymizedCoupleId: jest.fn(() => 'anon-uuid-123'),
}));

jest.mock('../../core/stateMachine/sessionStateMachine', () => ({
  SessionStateMachine: {
    transition: jest.fn(),
  },
}));

import { SessionManager } from '../../core/stateMachine/sessionManager';

describe('SessionManager', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ============================================
  // findOrCreateUser
  // ============================================
  describe('findOrCreateUser', () => {
    it('should return existing user ID when user exists', async () => {
      mockUserFindUnique.mockResolvedValue({ id: 'existing-user-id' });

      const result = await SessionManager.findOrCreateUser('12345', 'John');
      expect(result).toBe('existing-user-id');
      expect(mockUserCreate).not.toHaveBeenCalled();
    });

    it('should create new user when not found', async () => {
      mockUserFindUnique.mockResolvedValue(null);
      mockUserCreate.mockResolvedValue({ id: 'new-user-id' });

      const result = await SessionManager.findOrCreateUser('99999', 'Jane');
      expect(result).toBe('new-user-id');
      expect(mockUserCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          telegramId: 'enc_99999',
          telegramIdHash: 'hmac_99999',
          name: 'enc_Jane',
          language: 'he',
        }),
      });
    });

    it('should store encrypted telegram ID and HMAC hash', async () => {
      mockUserFindUnique.mockResolvedValue(null);
      mockUserCreate.mockResolvedValue({ id: 'user-1' });

      await SessionManager.findOrCreateUser('67890', 'Test');

      const createCall = mockUserCreate.mock.calls[0][0];
      expect(createCall.data.telegramId).toBe('enc_67890');
      expect(createCall.data.telegramIdHash).toBe('hmac_67890');
    });

    it('should update language when provided for existing user', async () => {
      mockUserFindUnique.mockResolvedValue({ id: 'user-1' });

      await SessionManager.findOrCreateUser('12345', undefined, 'en');

      expect(mockUserUpdate).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { language: 'en' },
      });
    });

    it('should not update language when not provided', async () => {
      mockUserFindUnique.mockResolvedValue({ id: 'user-1' });

      await SessionManager.findOrCreateUser('12345');

      expect(mockUserUpdate).not.toHaveBeenCalled();
    });

    it('should handle null name gracefully', async () => {
      mockUserFindUnique.mockResolvedValue(null);
      mockUserCreate.mockResolvedValue({ id: 'user-1' });

      await SessionManager.findOrCreateUser('12345');

      const createCall = mockUserCreate.mock.calls[0][0];
      expect(createCall.data.name).toBeNull();
    });
  });

  // ============================================
  // createSession
  // ============================================
  describe('createSession', () => {
    it('should create a trial session for first-time user', async () => {
      mockSessionFindMany.mockResolvedValue([]); // no previous sessions
      mockSessionCreate.mockResolvedValue({
        id: 'session-1',
        anonymizedCoupleId: 'anon-uuid-123',
        isTrial: true,
      });
      mockTelemetryCreate.mockResolvedValue({});

      const sessionId = await SessionManager.createSession('user-1');
      expect(sessionId).toBe('session-1');

      const createCall = mockSessionCreate.mock.calls[0][0];
      expect(createCall.data.isTrial).toBe(true);
      expect(createCall.data.status).toBe('INVITE_CRAFTING');
    });

    it('should create a non-trial session for returning user', async () => {
      mockSessionFindMany.mockResolvedValue([{ id: 'old-session' }]); // has previous
      mockSessionCreate.mockResolvedValue({
        id: 'session-2',
        anonymizedCoupleId: 'anon-uuid-123',
        isTrial: false,
      });
      mockTelemetryCreate.mockResolvedValue({});

      await SessionManager.createSession('user-1');

      const createCall = mockSessionCreate.mock.calls[0][0];
      expect(createCall.data.isTrial).toBe(false);
    });

    it('should create telemetry record alongside session', async () => {
      mockSessionFindMany.mockResolvedValue([]);
      mockSessionCreate.mockResolvedValue({
        id: 'session-1',
        anonymizedCoupleId: 'anon-uuid-123',
        isTrial: true,
      });
      mockTelemetryCreate.mockResolvedValue({});

      await SessionManager.createSession('user-1');

      expect(mockTelemetryCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          anonymizedCoupleId: 'anon-uuid-123',
          status: 'INVITE_CRAFTING',
        }),
      });
    });
  });

  // ============================================
  // consumeInviteToken
  // ============================================
  describe('consumeInviteToken', () => {
    it('should return error for non-existent token', async () => {
      mockSessionFindFirst.mockResolvedValue(null);

      const result = await SessionManager.consumeInviteToken('nonexistent-token', '12345');
      expect('error' in result).toBe(true);
    });

    it('should return error for already-used token', async () => {
      jest.spyOn(
        require('../../db/client').prisma.coupleSession,
        'findFirst'
      ).mockResolvedValue({
        id: 'session-1',
        inviteTokenUsed: true,
        inviteTokenExpiresAt: new Date(Date.now() + 3600000),
        userA: { telegramIdHash: 'hmac_11111' },
        userAId: 'user-a',
        userBId: null,
      });

      const result = await SessionManager.consumeInviteToken('used-token', '99999');
      expect('error' in result).toBe(true);
      if ('error' in result) {
        expect(result.error).toContain('כבר שומש');
      }
    });

    it('should return error for expired token', async () => {
      jest.spyOn(
        require('../../db/client').prisma.coupleSession,
        'findFirst'
      ).mockResolvedValue({
        id: 'session-1',
        inviteTokenUsed: false,
        inviteTokenExpiresAt: new Date(Date.now() - 3600000), // expired 1 hour ago
        userA: { telegramIdHash: 'hmac_11111' },
        userAId: 'user-a',
        userBId: null,
      });

      const result = await SessionManager.consumeInviteToken('expired-token', '99999');
      expect('error' in result).toBe(true);
      if ('error' in result) {
        expect(result.error).toContain('פג תוקף');
      }
    });

    it('should return error when User B is same as User A', async () => {
      jest.spyOn(
        require('../../db/client').prisma.coupleSession,
        'findFirst'
      ).mockResolvedValue({
        id: 'session-1',
        inviteTokenUsed: false,
        inviteTokenExpiresAt: new Date(Date.now() + 3600000),
        userA: { telegramIdHash: 'hmac_same_user' },
        userAId: 'user-a',
        userBId: null,
      });

      // hmacHash mock returns 'hmac_same_user' for 'same_user'
      const result = await SessionManager.consumeInviteToken('token', 'same_user');
      expect('error' in result).toBe(true);
      if ('error' in result) {
        expect(result.error).toContain('עצמך');
      }
    });
  });

  // ============================================
  // getActiveSession
  // ============================================
  describe('getActiveSession', () => {
    it('should return session as USER_A', async () => {
      mockSessionFindFirst
        .mockResolvedValueOnce({
          id: 'session-1',
          status: 'ACTIVE',
          anonymizedCoupleId: 'anon-1',
        })
        .mockResolvedValueOnce(null);

      const result = await SessionManager.getActiveSession('user-1');
      expect(result).toEqual({
        id: 'session-1',
        status: 'ACTIVE',
        role: 'USER_A',
        anonymizedCoupleId: 'anon-1',
      });
    });

    it('should return session as USER_B when not found as USER_A', async () => {
      mockSessionFindFirst
        .mockResolvedValueOnce(null) // not USER_A
        .mockResolvedValueOnce({
          id: 'session-2',
          status: 'REFLECTION_GATE',
          anonymizedCoupleId: 'anon-2',
        });

      const result = await SessionManager.getActiveSession('user-2');
      expect(result).toEqual({
        id: 'session-2',
        status: 'REFLECTION_GATE',
        role: 'USER_B',
        anonymizedCoupleId: 'anon-2',
      });
    });

    it('should return null when no active session exists', async () => {
      mockSessionFindFirst.mockResolvedValue(null);

      const result = await SessionManager.getActiveSession('user-3');
      expect(result).toBeNull();
    });
  });

  // ============================================
  // incrementMirrorAttempts
  // ============================================
  describe('incrementMirrorAttempts', () => {
    it('should return incremented mirror attempts count', async () => {
      mockSessionUpdate.mockResolvedValue({ mirrorAttempts: 2 });

      const count = await SessionManager.incrementMirrorAttempts('session-1');
      expect(count).toBe(2);
      expect(mockSessionUpdate).toHaveBeenCalledWith({
        where: { id: 'session-1' },
        data: { mirrorAttempts: { increment: 1 } },
        select: { mirrorAttempts: true },
      });
    });
  });
});
