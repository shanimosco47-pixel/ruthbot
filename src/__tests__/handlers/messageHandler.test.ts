// Tests for messageHandler session status routing

const mockGetUserState = jest.fn();
const mockSetUserState = jest.fn();
const mockDeleteUserState = jest.fn();
const mockFindOrCreateUser = jest.fn();
const mockGetActiveSession = jest.fn();
const mockGetSession = jest.fn();
const mockTrackedReply = jest.fn();
const mockLogUserMessage = jest.fn();
const mockLogBotCoaching = jest.fn();
const mockLogReframe = jest.fn();
const mockProcessMessage = jest.fn();
const mockSecondRiskCheck = jest.fn();
const mockTransition = jest.fn();

jest.mock('../../utils/stateStore', () => ({
  getUserState: (...args: any[]) => mockGetUserState(...args),
  setUserState: (...args: any[]) => mockSetUserState(...args),
  deleteUserState: (...args: any[]) => mockDeleteUserState(...args),
  getPendingReframe: jest.fn(),
  setPendingReframe: jest.fn(),
  deletePendingReframe: jest.fn(),
  invalidateOldPendingReframes: jest.fn(),
  cleanupSessionStateDB: jest.fn(),
}));

jest.mock('../../db/client', () => ({
  prisma: {
    message: {
      create: jest.fn().mockResolvedValue({ id: 'msg1' }),
      findMany: jest.fn().mockResolvedValue([]),
    },
    coupleSession: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    userFlowState: {
      upsert: jest.fn(),
      deleteMany: jest.fn(),
    },
  },
}));

jest.mock('../../utils/encryption', () => ({
  encrypt: (t: string) => `enc_${t}`,
  decrypt: (t: string) => t.replace(/^enc_/, ''),
}));

jest.mock('../../utils/trackedReply', () => ({
  trackedReply: (...args: any[]) => mockTrackedReply(...args),
  logBotMessage: jest.fn(),
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
    getSession: (...args: any[]) => mockGetSession(...args),
    recordPartnerConsent: jest.fn(),
    generateInviteLink: jest.fn(),
    storeInvitationMessage: jest.fn(),
    setPartnerHasTelegram: jest.fn(),
    incrementMirrorAttempts: jest.fn(),
  },
}));

jest.mock('../../core/stateMachine/sessionStateMachine', () => ({
  SessionStateMachine: {
    transition: (...args: any[]) => mockTransition(...args),
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
  processMessage: (...args: any[]) => mockProcessMessage(...args),
  secondRiskCheck: (...args: any[]) => mockSecondRiskCheck(...args),
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

jest.mock('../../config/constants', () => ({
  MAX_REFLECTION_REPROMPTS: 2,
}));

jest.mock('../../utils/chatLogger', () => ({
  logUserMessage: (...args: any[]) => mockLogUserMessage(...args),
  logBotCoaching: (...args: any[]) => mockLogBotCoaching(...args),
  logReframe: (...args: any[]) => mockLogReframe(...args),
}));

import { handleMessage } from '../../adapters/telegram/handlers/messageHandler';

function createMockMessageContext(text: string, telegramId: string = '12345') {
  const replyMock = jest.fn().mockResolvedValue(undefined);
  return {
    from: { id: parseInt(telegramId), first_name: 'Test' },
    message: { text, message_id: 1 },
    reply: replyMock,
    sendChatAction: jest.fn(),
    telegram: {
      sendMessage: jest.fn().mockResolvedValue(undefined),
    },
    _replyMock: replyMock,
  } as any;
}

describe('handleMessage — session status routing', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should give helpful message for PENDING_PARTNER_CONSENT status', async () => {
    const ctx = createMockMessageContext('שלום', '12345');
    mockGetUserState.mockResolvedValue(null);
    mockFindOrCreateUser.mockResolvedValue('user1');
    mockGetActiveSession.mockResolvedValue({
      id: 'sess1',
      anonymizedCoupleId: 'anon1',
      role: 'USER_A',
      status: 'PENDING_PARTNER_CONSENT',
    });

    await handleMessage(ctx);

    // Should mention partner/waiting — not a generic error
    expect(ctx._replyMock).toHaveBeenCalledWith(
      expect.stringContaining('ממתינ')
    );
  });

  it('should give helpful message for REFLECTION_GATE status without user state', async () => {
    const ctx = createMockMessageContext('שלום', '12345');
    mockGetUserState.mockResolvedValue(null);
    mockFindOrCreateUser.mockResolvedValue('user1');
    mockGetActiveSession.mockResolvedValue({
      id: 'sess1',
      anonymizedCoupleId: 'anon1',
      role: 'USER_B',
      status: 'REFLECTION_GATE',
    });

    await handleMessage(ctx);

    // Should guide user back to reflection, not give generic error
    expect(ctx._replyMock).toHaveBeenCalledWith(
      expect.stringMatching(/שיקוף|שלב/)
    );
  });

  it('should give clear message for CLOSED session', async () => {
    const ctx = createMockMessageContext('שלום', '12345');
    mockGetUserState.mockResolvedValue(null);
    mockFindOrCreateUser.mockResolvedValue('user1');
    mockGetActiveSession.mockResolvedValue({
      id: 'sess1',
      anonymizedCoupleId: 'anon1',
      role: 'USER_A',
      status: 'CLOSED',
    });

    await handleMessage(ctx);

    expect(ctx._replyMock).toHaveBeenCalledWith(
      expect.stringContaining('/start')
    );
  });

  it('should give clear message for LOCKED session', async () => {
    const ctx = createMockMessageContext('שלום', '12345');
    mockGetUserState.mockResolvedValue(null);
    mockFindOrCreateUser.mockResolvedValue('user1');
    mockGetActiveSession.mockResolvedValue({
      id: 'sess1',
      anonymizedCoupleId: 'anon1',
      role: 'USER_A',
      status: 'LOCKED',
    });

    await handleMessage(ctx);

    expect(ctx._replyMock).toHaveBeenCalledWith(
      expect.stringContaining('/start')
    );
  });
});
