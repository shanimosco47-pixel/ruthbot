/**
 * Session locking mechanism to prevent concurrent message processing
 * for the same user in the same session.
 */

const locks = new Map<string, Promise<void>>();

export async function withSessionLock<T>(
  lockKey: string,
  fn: () => Promise<T>
): Promise<T> {
  // Wait for existing lock to release
  const existingLock = locks.get(lockKey);
  if (existingLock) {
    await existingLock;
  }

  let releaseLock: () => void;
  const lockPromise = new Promise<void>((resolve) => {
    releaseLock = resolve;
  });

  locks.set(lockKey, lockPromise);

  try {
    return await fn();
  } finally {
    releaseLock!();
    locks.delete(lockKey);
  }
}
