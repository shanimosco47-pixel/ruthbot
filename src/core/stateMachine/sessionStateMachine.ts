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

    // Reset idle reminder counter on PAUSED transitions
    if (newStatus === 'PAUSED' || (currentStatus === 'PAUSED' && newStatus === 'ACTIVE')) {
      updateData.idleRemindersSent = 0;
    }

    // Atomic compare-and-swap: only update if status hasn't changed since we read it.
    // This prevents race conditions where two concurrent calls both read the same status.
    const result = await prisma.coupleSession.updateMany({
      where: { id: sessionId, status: currentStatus },
      data: updateData,
    });

    if (result.count === 0) {
      const errorMsg = `State transition conflict: session ${sessionId} status changed concurrently (expected ${currentStatus})`;
      logger.error(errorMsg, { sessionId, currentStatus, newStatus, metadata });
      throw new Error(errorMsg);
    }

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
  static isValidTransition(currentStatus: SessionStatus, newStatus: SessionStatus): boolean {
    const allowed = VALID_TRANSITIONS[currentStatus];
    return !!allowed && allowed.includes(newStatus);
  }

  /**
   * Close idle sessions that have been PAUSED for longer than SESSION_EXPIRY_HOURS.
   * Returns the list of session IDs that were successfully closed.
   */
  static async closeExpiredSessions(expiryHours: number): Promise<string[]> {
    const cutoff = new Date(Date.now() - expiryHours * 60 * 60 * 1000);

    const expiredSessions = await prisma.coupleSession.findMany({
      where: {
        status: 'PAUSED',
        updatedAt: { lt: cutoff },
      },
      select: { id: true },
    });

    const closedIds: string[] = [];
    for (const session of expiredSessions) {
      try {
        await SessionStateMachine.transition(session.id, 'CLOSED', {
          reason: 'auto_close_expired',
          expiryHours,
        });
        closedIds.push(session.id);
      } catch (error) {
        logger.error('Failed to auto-close expired session', {
          sessionId: session.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (closedIds.length > 0) {
      logger.info(`Auto-closed ${closedIds.length} expired sessions`);
    }

    return closedIds;
  }
}
