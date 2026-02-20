import { prisma } from '../../db/client';
import { logger } from '../../utils/logger';
import { encrypt, hmacHash, generateInviteToken, generateAnonymizedCoupleId } from '../../utils/encryption';
import { SessionStateMachine } from './sessionStateMachine';
import type { TtlOption } from '../../config/constants';

export class SessionManager {
  /**
   * Find or create a user by their Telegram ID.
   * Telegram ID is stored encrypted.
   */
  static async findOrCreateUser(telegramId: string, name?: string, language?: string): Promise<string> {
    // O(1) lookup using deterministic HMAC hash
    const hash = hmacHash(telegramId);
    const existing = await prisma.user.findUnique({
      where: { telegramIdHash: hash },
      select: { id: true },
    });

    if (existing) {
      if (language) {
        await prisma.user.update({
          where: { id: existing.id },
          data: { language },
        });
      }
      return existing.id;
    }

    // Create new user
    const encryptedTelegramId = encrypt(telegramId);
    const encryptedName = name ? encrypt(name) : null;

    const newUser = await prisma.user.create({
      data: {
        telegramId: encryptedTelegramId,
        telegramIdHash: hash,
        name: encryptedName,
        language: language || 'he',
      },
    });

    logger.info('New user created', { userId: newUser.id });
    return newUser.id;
  }

  /**
   * Create a new couple session for User A.
   */
  static async createSession(userAId: string): Promise<string> {
    const anonymizedCoupleId = generateAnonymizedCoupleId();

    // Check if user has had any previous sessions (for trial logic)
    const previousSessions = await prisma.coupleSession.findMany({
      where: { userAId },
      select: { id: true, isTrial: true },
    });

    const hasPreviousSessions = previousSessions.length > 0;

    const session = await prisma.coupleSession.create({
      data: {
        anonymizedCoupleId,
        userAId,
        status: 'INVITE_CRAFTING',
        isTrial: !hasPreviousSessions, // First session is free
      },
    });

    logger.info('New session created', {
      sessionId: session.id,
      anonymizedCoupleId,
      userAId,
      isTrial: session.isTrial,
    });

    // Create telemetry record
    try {
      await prisma.sessionTelemetry.create({
        data: {
          anonymizedCoupleId,
          sessionStartedAt: new Date(),
          status: 'INVITE_CRAFTING',
        },
      });
    } catch (error) {
      logger.error('Failed to create session telemetry', {
        sessionId: session.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    return session.id;
  }

  /**
   * Generate an invite token for a session.
   * Invalidates any existing token first.
   * Token: crypto.randomBytes(32).toString('hex') — exactly 64 chars.
   */
  static async generateInviteLink(
    sessionId: string,
    ttlHours: TtlOption,
    botUsername: string
  ): Promise<{ token: string; link: string; expiresAt: Date }> {
    const session = await prisma.coupleSession.findUnique({
      where: { id: sessionId },
    });

    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    // Invalidate any existing token
    if (session.inviteToken && !session.inviteTokenUsed) {
      logger.info('Invalidating existing invite token', { sessionId });
    }

    const token = generateInviteToken();
    const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000);

    await prisma.coupleSession.update({
      where: { id: sessionId },
      data: {
        inviteToken: token,
        inviteTokenUsed: false,
        inviteTokenExpiresAt: expiresAt,
        inviteTtlHours: ttlHours,
      },
    });

    // Deep link: t.me/BotUsername?start=<token>
    // Token is exactly 64 chars (32 bytes hex) — fits Telegram's 64 char limit
    const link = `https://t.me/${botUsername}?start=${token}`;

    logger.info('Invite link generated', {
      sessionId,
      ttlHours,
      expiresAt: expiresAt.toISOString(),
    });

    // Transition to INVITE_PENDING
    await SessionStateMachine.transition(sessionId, 'INVITE_PENDING', { ttlHours });

    return { token, link, expiresAt };
  }

  /**
   * Validate and consume an invite token when User B clicks the link.
   * Returns the session ID if valid.
   */
  static async consumeInviteToken(
    token: string,
    telegramIdB: string
  ): Promise<{ sessionId: string; userAId: string } | { error: string }> {
    const session = await prisma.coupleSession.findFirst({
      where: { inviteToken: token },
      include: { userA: true },
    });

    if (!session) {
      return { error: 'הלינק לא נמצא. פנה/י לשולח/ת לקבלת לינק חדש.' };
    }

    // Check if already used
    if (session.inviteTokenUsed) {
      return { error: 'הלינק כבר שומש. פנה/י לשולח/ת לקבלת לינק חדש.' };
    }

    // Check TTL expiry
    if (session.inviteTokenExpiresAt && new Date() > session.inviteTokenExpiresAt) {
      return { error: 'הלינק פג תוקף. פנה/י לשולח/ת לקבלת לינק חדש.' };
    }

    // Check if User B is already User A (same person clicking their own link)
    const hashB = hmacHash(telegramIdB);
    if (session.userA.telegramIdHash === hashB) {
      return { error: 'אי אפשר להצטרף לסשן שלך עצמך.' };
    }

    // Check if User B is already in this session
    if (session.userBId) {
      const existingB = await prisma.user.findUnique({
        where: { id: session.userBId },
        select: { telegramIdHash: true },
      });
      if (existingB?.telegramIdHash === hashB) {
        return { error: 'אתה/את כבר חלק מהסשן הזה.' };
      }
    }

    // Mark token as used (but DON'T store User B data yet — GDPR: wait for consent)
    await prisma.coupleSession.update({
      where: { id: session.id },
      data: { inviteTokenUsed: true },
    });

    // Transition to PENDING_PARTNER_CONSENT
    await SessionStateMachine.transition(session.id, 'PENDING_PARTNER_CONSENT');

    logger.info('Invite token consumed', {
      sessionId: session.id,
      status: 'PENDING_PARTNER_CONSENT',
    });

    return { sessionId: session.id, userAId: session.userAId };
  }

  /**
   * Record User B's consent and officially add them to the session.
   * GDPR: This is the first time User B's data is stored.
   */
  static async recordPartnerConsent(
    sessionId: string,
    userBId: string
  ): Promise<void> {
    await prisma.coupleSession.update({
      where: { id: sessionId },
      data: {
        userBId,
        partnerJoined: true,
      },
    });

    // Transition to REFLECTION_GATE
    await SessionStateMachine.transition(sessionId, 'REFLECTION_GATE');

    logger.info('Partner consent recorded', {
      sessionId,
      userBId,
      newStatus: 'REFLECTION_GATE',
    });
  }

  /**
   * Get active session for a user (by their internal user ID).
   */
  static async getActiveSession(userId: string): Promise<{
    id: string;
    status: string;
    role: 'USER_A' | 'USER_B';
    anonymizedCoupleId: string;
  } | null> {
    // Check as User A
    const asA = await prisma.coupleSession.findFirst({
      where: {
        userAId: userId,
        status: {
          notIn: ['CLOSED', 'LOCKED'],
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (asA) {
      return {
        id: asA.id,
        status: asA.status,
        role: 'USER_A',
        anonymizedCoupleId: asA.anonymizedCoupleId,
      };
    }

    // Check as User B
    const asB = await prisma.coupleSession.findFirst({
      where: {
        userBId: userId,
        status: {
          notIn: ['CLOSED', 'LOCKED'],
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (asB) {
      return {
        id: asB.id,
        status: asB.status,
        role: 'USER_B',
        anonymizedCoupleId: asB.anonymizedCoupleId,
      };
    }

    return null;
  }

  /**
   * Get session with full details.
   */
  static async getSession(sessionId: string): Promise<{
    id: string;
    status: string;
    userAId: string;
    userBId: string | null;
    anonymizedCoupleId: string;
    invitationMessage: string | null;
    topicCategory: string | null;
    isTrial: boolean;
    mirrorAttempts: number;
  } | null> {
    const session = await prisma.coupleSession.findUnique({
      where: { id: sessionId },
    });

    if (!session) return null;

    return {
      id: session.id,
      status: session.status,
      userAId: session.userAId,
      userBId: session.userBId,
      anonymizedCoupleId: session.anonymizedCoupleId,
      invitationMessage: session.invitationMessage,
      topicCategory: null, // derived from messages
      isTrial: session.isTrial,
      mirrorAttempts: session.mirrorAttempts,
    };
  }

  /**
   * Store the invitation message crafted by User A.
   */
  static async storeInvitationMessage(sessionId: string, message: string): Promise<void> {
    await prisma.coupleSession.update({
      where: { id: sessionId },
      data: { invitationMessage: message },
    });
  }

  /**
   * Record partner_has_telegram on the session (analytics).
   */
  static async setPartnerHasTelegram(
    sessionId: string,
    hasTelegram: boolean | null,
    variant: 'standard' | 'no_telegram'
  ): Promise<void> {
    await prisma.coupleSession.update({
      where: { id: sessionId },
      data: {
        partnerHasTelegram: hasTelegram,
        invitationVariant: variant,
      },
    });
  }

  /**
   * Increment mirror attempts counter.
   */
  static async incrementMirrorAttempts(sessionId: string): Promise<number> {
    const session = await prisma.coupleSession.update({
      where: { id: sessionId },
      data: { mirrorAttempts: { increment: 1 } },
      select: { mirrorAttempts: true },
    });
    return session.mirrorAttempts;
  }
}
