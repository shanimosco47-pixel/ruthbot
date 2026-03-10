/**
 * Session locking mechanism to prevent concurrent message processing
 * for the same user in the same session.
 *
 * Uses promise chaining: each new call queues behind ALL previous ones,
 * not just the one that happened to be in the Map at call time.
 *
 * Includes a timeout to prevent deadlocks if a lock holder crashes.
 */

import { logger } from './logger';

const locks = new Map<string, Promise<void>>();

const LOCK_TIMEOUT_MS = 30_000; // 30 seconds max wait for previous lock

export async function withSessionLock<T>(
  lockKey: string,
  fn: () => Promise<T>
): Promise<T> {
  // Get the current tail of the chain (or a resolved promise if none)
  const previousLock = locks.get(lockKey) || Promise.resolve();

  let releaseLock: () => void;
  const currentLock = new Promise<void>((resolve) => {
    releaseLock = resolve;
  });

  // Chain: this lock resolves AFTER fn() completes
  // Every subsequent caller will await this promise
  locks.set(lockKey, currentLock);

  // Wait for all previous operations to complete — with timeout to prevent deadlocks
  try {
    await Promise.race([
      previousLock,
      new Promise<void>((_, reject) =>
        setTimeout(() => reject(new Error(`Session lock timeout after ${LOCK_TIMEOUT_MS}ms`)), LOCK_TIMEOUT_MS)
      ),
    ]);
  } catch (error) {
    logger.error('Session lock acquisition timed out, proceeding anyway', {
      lockKey,
      error: error instanceof Error ? error.message : String(error),
    });
    // Proceed despite timeout — risk of concurrent processing is better than permanent hangup
  }

  try {
    return await fn();
  } finally {
    releaseLock!();
    // Only delete if we're still the tail of the chain
    if (locks.get(lockKey) === currentLock) {
      locks.delete(lockKey);
    }
  }
}
