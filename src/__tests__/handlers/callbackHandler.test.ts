// Tests for callback handler authorization and validation logic

const mockGetPendingReframe = jest.fn();
const mockDeletePendingReframe = jest.fn();
const mockGetUserState = jest.fn();
const mockSetUserState = jest.fn();
const mockDeleteUserState = jest.fn();
const mockPrismaMessageUpdate = jest.fn();
const mockPrismaMessageCreate = jest.fn();
const mockPrismaMessageUpdateMany = jest.fn();
const mockPrismaSessionFindUnique = jest.fn();
const mockPrismaUserFindUnique = jest.fn();
const mockPrismaSessionFindFirst = jest.fn();
const mockFindOrCreateUser = jest.fn();
const mockGetActiveSession = jest.fn();
const mockLogBotMessage = jest.fn();
const mockTrackedReply = jest.fn();
const mockEncrypt = jest.fn().mockImplementation((t: string) => `enc_${t}`);
const mockDecrypt = jest.fn().mockImplementation((t: string) => t.replace(/^enc_/, ''));

jest.mock('../../utils/stateStore', () => ({
  getUserState: (...args: any[]) => mockGetUserState(...args),
  setUserState: (...args: any[]) => mockSetUserState(...args),
  deleteUserState: (...args: any[]) => mockDeleteUserState(...args),
  getPendingReframe: (...args: any[]) => mockGetPendingReframe(...args),
  setPendingReframe: jest.fn(),
  deletePendingReframe: (...args: any[]) => mockDeletePendingReframe(...args),
  invalidateOldPendingReframes: jest.fn(),
  cleanupSessionStateDB: jest.fn(),
}));

jest.mock('../../db/client', () => ({
  prisma: {
    message: {
      update: (...args: any[]) => mockPrismaMessageUpdate(...args),
      create: (...args: any[]) => mockPrismaMessageCreate(...args),
      updateMany: (...args: any[]) => mockPrismaMessageUpdateMany(...args),
      findMany: jest.fn().mockResolvedValue([]),
    },
    coupleSession: {
      findUnique: (...args: any[]) => mockPrismaSessionFindUnique(...args),
      findFirst: (...args: any[]) => mockPrismaSessionFindFirst(...args),
    },
    user: {
      findUnique: (...args: any[]) => mockPrismaUserFindUnique(...args),
    },
    userFlowState: {
      upsert: jest.fn(),
      deleteMany: jest.fn(),
    },
    pendingReframeState: {
      deleteMany: jest.fn(),
    },
  },
}));

jest.mock('../../utils/encryption', () => ({
  encrypt: (...args: any[]) => mockEncrypt(...args),
  decrypt: (...args: any[]) => mockDecrypt(...args),
}));

jest.mock('../../utils/trackedReply', () => ({
  trackedReply: (...args: any[]) => mockTrackedReply(...args),
  logBotMessage: (...args: any[]) => mockLogBotMessage(...args),
}));

jest.mock('../../utils/telegramHelpers', () => ({
  splitMessage: (text: string) => [text],
  detectLanguage: () => 'he',
}));

jest.mock('../../utils/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

jest.mock('../../core/stateMachine/sessionManager', () => ({
  SessionManager: {
    findOrCreateUser: (...args: any[]) => mockFindOrCreateUser(...args),
    getActiveSession: (...args: any[]) => mockGetActiveSession(...args),
    getSession: jest.fn(),
    recordPartnerConsent: jest.fn(),
    generateInviteLink: jest.fn(),
    storeInvitationMessage: jest.fn(),
    setPartnerHasTelegram: jest.fn(),
    incrementMirrorAttempts: jest.fn(),
  },
}));

jest.mock('../../core/stateMachine/sessionStateMachine', () => ({
  SessionStateMachine: {
    transition: jest.fn(),
    getStatus: jest.fn(),
  },
}));

jest.mock('../../services/ai/claudeClient', () => ({
  callClaude: jest.fn(),
  callClaudeJSON: jest.fn(),
}));

jest.mock('../../services/ai/systemPrompts', () => ({
  buildInvitationDraftPrompt: jest.fn(),
  buildMirrorEvaluationPrompt: jest.fn(),
}));

jest.mock('../../core/pipeline/messagePipeline', () => ({
  processMessage: jest.fn(),
  secondRiskCheck: jest.fn(),
}));

jest.mock('../../services/email/emailService', () => ({
  sendSessionSummaryEmail: jest.fn(),
}));

jest.mock('../../config/env', () => ({
  env: {
    BOT_USERNAME: 'TestBot',
    NODE_ENV: 'test',
  },
}));

jest.mock('../../utils/chatLogger', () => ({
  logUserMessage: jest.fn(),
  logBotCoaching: jest.fn(),
  logReframe: jest.fn(),
}));

import { handleCallbackQuery } from '../../adapters/telegram/handlers/callbackHandler';

function createMockContext(callbackData: string, telegramId: string = '12345') {
  const replyMock = jest.fn().mockResolvedValue(undefined);
  return {
    callbackQuery: { data: callbackData },
    from: { id: parseInt(telegramId), first_name: 'Test' },
    answerCbQuery: jest.fn().mockResolvedValue(undefined),
    reply: replyMock,
    telegram: {
      sendMessage: jest.fn().mockResolvedValue(undefined),
      getMe: jest.fn().mockResolvedValue({ username: 'TestBot' }),
    },
    message: { message_id: 1 },
    sendChatAction: jest.fn(),
    _replyMock: replyMock,
  } as any;
}

describe('handleCallbackQuery — authorization', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('reframe_cancel authorization', () => {
    it('should reject cancel from non-owner', async () => {
      const ctx = createMockContext('reframe_cancel:msg123', '99999');

      mockGetPendingReframe.mockResolvedValue({
        sessionId: 'sess1',
        senderRole: 'USER_A',
        ownerTelegramId: '12345', // owner is 12345
        reframedText: 'test reframe',
        originalText: 'test original',
        editIterations: 0,
        messageId: 'msg123',
      });

      mockGetUserState.mockResolvedValue({ state: 'coaching', sessionId: 'sess1' });

      await handleCallbackQuery(ctx);

      // Should NOT have deleted the pending reframe
      expect(mockDeletePendingReframe).not.toHaveBeenCalled();
      // Should have warned the user
      expect(ctx._replyMock).toHaveBeenCalledWith(
        expect.stringContaining('הרשאה')
      );
    });

    it('should allow cancel from owner', async () => {
      const ctx = createMockContext('reframe_cancel:msg123', '12345');

      mockGetPendingReframe.mockResolvedValue({
        sessionId: 'sess1',
        senderRole: 'USER_A',
        ownerTelegramId: '12345',
        reframedText: 'test reframe',
        originalText: 'test original',
        editIterations: 0,
        messageId: 'msg123',
      });

      mockGetUserState.mockResolvedValue({ state: 'coaching', sessionId: 'sess1' });

      await handleCallbackQuery(ctx);

      // Should have deleted the pending reframe
      expect(mockDeletePendingReframe).toHaveBeenCalledWith('msg123');
    });
  });

  describe('reframe_approve authorization', () => {
    it('should reject approve from non-owner', async () => {
      const ctx = createMockContext('reframe_approve:msg123', '99999');

      mockGetPendingReframe.mockResolvedValue({
        sessionId: 'sess1',
        senderRole: 'USER_A',
        ownerTelegramId: '12345',
        reframedText: 'test reframe',
        originalText: 'test original',
        editIterations: 0,
        messageId: 'msg123',
      });

      await handleCallbackQuery(ctx);

      expect(mockPrismaMessageUpdate).not.toHaveBeenCalled();
      expect(ctx._replyMock).toHaveBeenCalledWith(
        expect.stringContaining('הרשאה')
      );
    });
  });

  describe('reframe_edit authorization', () => {
    it('should reject edit from non-owner', async () => {
      const ctx = createMockContext('reframe_edit:msg123', '99999');

      mockGetPendingReframe.mockResolvedValue({
        sessionId: 'sess1',
        senderRole: 'USER_A',
        ownerTelegramId: '12345',
        reframedText: 'test reframe',
        originalText: 'test original',
        editIterations: 0,
        messageId: 'msg123',
      });

      await handleCallbackQuery(ctx);

      expect(ctx._replyMock).toHaveBeenCalledWith(
        expect.stringContaining('הרשאה')
      );
    });
  });
});
