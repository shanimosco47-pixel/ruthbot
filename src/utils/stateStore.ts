import { Prisma } from '@prisma/client';
import { prisma } from '../db/client';
import { encrypt, decrypt } from './encryption';
import { logger } from './logger';
import type { PendingReframe } from '../types';

// ============================================
// UserFlowState — DB-backed replacement for userStates Map
// ============================================

export interface UserFlowState {
  state: string;
  sessionId?: string;
  data?: Record<string, unknown>;
}

export async function getUserState(telegramId: string): Promise<UserFlowState | null> {
  const row = await prisma.userFlowState.findUnique({
    where: { telegramId },
  });
  if (!row) return null;
  return {
    state: row.state,
    sessionId: row.sessionId ?? undefined,
    data: (row.data as Record<string, unknown>) ?? undefined,
  };
}

export async function setUserState(telegramId: string, state: UserFlowState): Promise<void> {
  const jsonData = state.data
    ? (state.data as Prisma.InputJsonValue)
    : Prisma.JsonNull;
  await prisma.userFlowState.upsert({
    where: { telegramId },
    create: {
      telegramId,
      state: state.state,
      sessionId: state.sessionId ?? null,
      data: jsonData,
    },
    update: {
      state: state.state,
      sessionId: state.sessionId ?? null,
      data: jsonData,
    },
  });
}

export async function deleteUserState(telegramId: string): Promise<void> {
  await prisma.userFlowState.deleteMany({
    where: { telegramId },
  });
}

// ============================================
// PendingReframeState — DB-backed replacement for pendingReframes Map
// ============================================

export async function getPendingReframe(messageId: string): Promise<PendingReframe | null> {
  const row = await prisma.pendingReframeState.findUnique({
    where: { messageId },
  });
  if (!row) return null;
  return {
    sessionId: row.sessionId,
    senderRole: row.senderRole as 'USER_A' | 'USER_B',
    ownerTelegramId: row.ownerTelegramId,
    reframedText: decrypt(row.reframedText),
    originalText: decrypt(row.originalText),
    editIterations: row.editIterations,
    messageId: row.messageId,
  };
}

export async function setPendingReframe(messageId: string, pending: PendingReframe): Promise<void> {
  await prisma.pendingReframeState.upsert({
    where: { messageId },
    create: {
      messageId,
      sessionId: pending.sessionId,
      senderRole: pending.senderRole,
      ownerTelegramId: pending.ownerTelegramId,
      reframedText: encrypt(pending.reframedText),
      originalText: encrypt(pending.originalText),
      editIterations: pending.editIterations,
    },
    update: {
      reframedText: encrypt(pending.reframedText),
      originalText: encrypt(pending.originalText),
      editIterations: pending.editIterations,
    },
  });
}

export async function deletePendingReframe(messageId: string): Promise<boolean> {
  const result = await prisma.pendingReframeState.deleteMany({
    where: { messageId },
  });
  return result.count > 0;
}

/**
 * RC5: Invalidate ALL pending reframes for a given session + owner.
 * Called before creating a new pending reframe — ensures old buttons
 * can't silently approve stale messages.
 */
export async function invalidateOldPendingReframes(sessionId: string, ownerTelegramId: string): Promise<number> {
  const result = await prisma.pendingReframeState.deleteMany({
    where: { sessionId, ownerTelegramId },
  });
  if (result.count > 0) {
    logger.info('Invalidated old pending reframes', {
      sessionId,
      ownerTelegramId,
      count: result.count,
    });
  }
  return result.count;
}

// ============================================
// Session Cleanup — replaces cleanupSessionState()
// ============================================

export async function cleanupSessionStateDB(sessionId: string): Promise<void> {
  const [reframeResult, flowResult] = await Promise.all([
    prisma.pendingReframeState.deleteMany({ where: { sessionId } }),
    prisma.userFlowState.deleteMany({ where: { sessionId } }),
  ]);

  if (reframeResult.count > 0 || flowResult.count > 0) {
    logger.info('Cleaned up session state from DB', {
      sessionId,
      reframesRemoved: reframeResult.count,
      flowStatesRemoved: flowResult.count,
    });
  }
}
