// Mock all dependencies before importing the module under test
const mockPrismaStripeEvent = {
  findUnique: jest.fn(),
  upsert: jest.fn(),
  update: jest.fn(),
};

const mockPrismaCoupleSession = {
  findUnique: jest.fn(),
  findMany: jest.fn(),
  update: jest.fn(),
};

const mockPrismaUser = {
  findUnique: jest.fn(),
};

jest.mock('../../db/client', () => ({
  prisma: {
    stripeEvent: mockPrismaStripeEvent,
    coupleSession: mockPrismaCoupleSession,
    user: mockPrismaUser,
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
  hmacHash: jest.fn((input: string) => `hmac_${input}`),
  decrypt: jest.fn((input: string) => `decrypted_${input}`),
}));

// Mock Stripe
const mockConstructEvent = jest.fn();
const mockSubscriptionsList = jest.fn();

jest.mock('stripe', () => {
  return jest.fn().mockImplementation(() => ({
    webhooks: {
      constructEvent: mockConstructEvent,
    },
    subscriptions: {
      list: mockSubscriptionsList,
    },
  }));
});

jest.mock('../../core/stateMachine/sessionStateMachine', () => ({
  SessionStateMachine: {
    transition: jest.fn(),
  },
}));

import { handleStripeWebhook, requiresPayment, setBillingBotInstance } from '../../services/billing/stripeService';

describe('Stripe Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ============================================
  // handleStripeWebhook
  // ============================================
  describe('handleStripeWebhook', () => {
    it('should verify webhook signature', async () => {
      mockConstructEvent.mockReturnValue({
        id: 'evt_1',
        type: 'invoice.payment_succeeded',
        data: { object: { customer: 'cus_1' } },
      });
      mockPrismaStripeEvent.findUnique.mockResolvedValue(null);
      mockPrismaStripeEvent.upsert.mockResolvedValue({});

      await handleStripeWebhook('raw-body', 'sig-header');

      expect(mockConstructEvent).toHaveBeenCalledWith('raw-body', 'sig-header', expect.any(String));
    });

    it('should throw on invalid signature', async () => {
      mockConstructEvent.mockImplementation(() => {
        throw new Error('Signature verification failed');
      });

      await expect(handleStripeWebhook('bad-body', 'bad-sig')).rejects.toThrow(
        'Webhook signature verification failed'
      );
    });

    it('should skip already-processed events (idempotency)', async () => {
      mockConstructEvent.mockReturnValue({
        id: 'evt_duplicate',
        type: 'invoice.payment_succeeded',
        data: { object: { customer: 'cus_1' } },
      });

      mockPrismaStripeEvent.findUnique.mockResolvedValue({
        stripeEventId: 'evt_duplicate',
        processed: true,
      });

      await handleStripeWebhook('raw-body', 'sig-header');

      // Should NOT upsert or process the event
      expect(mockPrismaStripeEvent.upsert).not.toHaveBeenCalled();
    });

    it('should record event before processing', async () => {
      mockConstructEvent.mockReturnValue({
        id: 'evt_new',
        type: 'unknown.event',
        data: { object: {} },
      });
      mockPrismaStripeEvent.findUnique.mockResolvedValue(null);
      mockPrismaStripeEvent.upsert.mockResolvedValue({});

      await handleStripeWebhook('raw-body', 'sig-header');

      expect(mockPrismaStripeEvent.upsert).toHaveBeenCalledWith({
        where: { stripeEventId: 'evt_new' },
        create: {
          stripeEventId: 'evt_new',
          eventType: 'unknown.event',
        },
        update: {},
      });
    });
  });

  // ============================================
  // requiresPayment
  // ============================================
  describe('requiresPayment', () => {
    it('should return false for trial sessions', async () => {
      mockPrismaCoupleSession.findUnique.mockResolvedValue({
        isTrial: true,
        billingOwnerId: null,
      });

      const result = await requiresPayment('session-1');
      expect(result).toBe(false);
    });

    it('should return true when session not found', async () => {
      mockPrismaCoupleSession.findUnique.mockResolvedValue(null);

      const result = await requiresPayment('nonexistent');
      expect(result).toBe(true);
    });

    it('should return true when no billing owner', async () => {
      mockPrismaCoupleSession.findUnique.mockResolvedValue({
        isTrial: false,
        billingOwnerId: null,
      });

      const result = await requiresPayment('session-1');
      expect(result).toBe(true);
    });

    it('should return true when billing owner has no Stripe customer', async () => {
      mockPrismaCoupleSession.findUnique.mockResolvedValue({
        isTrial: false,
        billingOwnerId: 'user-1',
      });
      mockPrismaUser.findUnique.mockResolvedValue({
        stripeCustomerId: null,
      });

      const result = await requiresPayment('session-1');
      expect(result).toBe(true);
    });

    it('should return false when active subscription exists', async () => {
      mockPrismaCoupleSession.findUnique.mockResolvedValue({
        isTrial: false,
        billingOwnerId: 'user-1',
      });
      mockPrismaUser.findUnique.mockResolvedValue({
        stripeCustomerId: 'encrypted_cus_1',
      });
      mockSubscriptionsList.mockResolvedValue({
        data: [{ id: 'sub_1', status: 'active' }],
      });

      const result = await requiresPayment('session-1');
      expect(result).toBe(false);
    });

    it('should return true when no active subscription', async () => {
      mockPrismaCoupleSession.findUnique.mockResolvedValue({
        isTrial: false,
        billingOwnerId: 'user-1',
      });
      mockPrismaUser.findUnique.mockResolvedValue({
        stripeCustomerId: 'encrypted_cus_1',
      });
      mockSubscriptionsList.mockResolvedValue({
        data: [],
      });

      const result = await requiresPayment('session-1');
      expect(result).toBe(true);
    });

    it('should return true on Stripe API error (fail-safe)', async () => {
      mockPrismaCoupleSession.findUnique.mockResolvedValue({
        isTrial: false,
        billingOwnerId: 'user-1',
      });
      mockPrismaUser.findUnique.mockResolvedValue({
        stripeCustomerId: 'encrypted_cus_1',
      });
      mockSubscriptionsList.mockRejectedValue(new Error('Stripe error'));

      const result = await requiresPayment('session-1');
      expect(result).toBe(true);
    });
  });

  // ============================================
  // setBillingBotInstance
  // ============================================
  describe('setBillingBotInstance', () => {
    it('should accept a bot instance without throwing', () => {
      const fakBot = { telegram: { sendMessage: jest.fn() } } as any;
      expect(() => setBillingBotInstance(fakBot)).not.toThrow();
    });
  });
});
