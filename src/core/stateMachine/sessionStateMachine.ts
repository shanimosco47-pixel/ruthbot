import { SessionStatus } from '@prisma/client';
import { VALID_TRANSITIONS } from '../../config/constants';
import { prisma } from '../../db/client';
import { logger } from '../../utils/logger';

export class SessionStateMachine {
  /**
   * Transition a session to a new status.
   * Validates the transition is allowed per the state machine diagram.
   * Logs every transition.
   */
  static async transition(
    sessionId: string,
    newStatus: SessionStatus,
    metadata?: Record<string, unknown>
  ): Promise<void> {
    const session = await prisma.coupleSession.findUnique({
      where: { id: sessionId },
      select: { status: true, anonymizedCoupleId: true },
    });

    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    const currentStatus = session.status;
    const allowed = VALID_TRANSITIONS[currentStatus];

    if (!allowed || !allowed.includes(newStatus)) {
      const errorMsg = `Invalid state transition: ${currentStatus} → ${newStatus}`;
      logger.error(errorMsg, { sessionId, currentStatus, newStatus, metadata });
      throw new Error(errorMsg);
    }

    // Perform the transition
    const updateData: Record<string, unknown> = { status: newStatus };

    // Set closedAt when transitioning to CLOSED
    if (newStatus === 'CLOSED') {
      updateData.closedAt = new Date();
    }

    await prisma.coupleSession.update({
      where: { id: sessionId },
      data: updateData,
    });

    logger.info('Session state transition', {
      sessionId,
      anonymizedCoupleId: session.anonymizedCoupleId,
      from: currentStatus,
      to: newStatus,
      metadata,
    });
  }

  /**
   * Get the current status of a session.
   */
  static async getStatus(sessionId: string): Promise<SessionStatus> {
    const session = await prisma.coupleSession.findUnique({
      where: { id: sessionId },
      select: { status: true },
    });

    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    return session.status;
  }

  /**
   * Check if a transition is valid without performing it.
   */
  static isValidTransition(currentStatus: string, newStatus: string): boolean {
    const allowed = VALID_TRANSITIONS[currentStatus];
    return !!allowed && allowed.includes(newStatus);
  }

  /**
   * Close idle sessions that have been PAUSED for longer than SESSION_EXPIRY_HOURS.
   */
  static async closeExpiredSessions(expiryHours: number): Promise<number> {
    const cutoff = new Date(Date.now() - expiryHours * 60 * 60 * 1000);

    const expiredSessions = await prisma.coupleSession.findMany({
      where: {
        status: 'PAUSED',
        updatedAt: { lt: cutoff },
      },
      select: { id: true },
    });

    let closedCount = 0;
    for (const session of expiredSessions) {
      try {
        await SessionStateMachine.transition(session.id, 'CLOSED', {
          reason: 'auto_close_expired',
          expiryHours,
        });
        closedCount++;
      } catch (error) {
        logger.error('Failed to auto-close expired session', {
          sessionId: session.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (closedCount > 0) {
      logger.info(`Auto-closed ${closedCount} expired sessions`);
    }

    return closedCount;
  }
}
