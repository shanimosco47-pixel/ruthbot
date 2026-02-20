import { withSessionLock } from '../../utils/sessionLock';

describe('Session Lock', () => {
  it('should execute the function and return its result', async () => {
    const result = await withSessionLock('key1', async () => 'hello');
    expect(result).toBe('hello');
  });

  it('should serialize concurrent operations on the same key', async () => {
    const order: number[] = [];

    const op1 = withSessionLock('same-key', async () => {
      order.push(1);
      await sleep(50);
      order.push(2);
      return 'first';
    });

    const op2 = withSessionLock('same-key', async () => {
      order.push(3);
      await sleep(10);
      order.push(4);
      return 'second';
    });

    const [result1, result2] = await Promise.all([op1, op2]);

    expect(result1).toBe('first');
    expect(result2).toBe('second');
    // Op1 should complete (1,2) before op2 starts (3,4)
    expect(order).toEqual([1, 2, 3, 4]);
  });

  it('should allow parallel execution on different keys', async () => {
    const order: string[] = [];

    const op1 = withSessionLock('key-a', async () => {
      order.push('a-start');
      await sleep(50);
      order.push('a-end');
    });

    const op2 = withSessionLock('key-b', async () => {
      order.push('b-start');
      await sleep(10);
      order.push('b-end');
    });

    await Promise.all([op1, op2]);

    // Both should start before either finishes (parallel execution)
    const aStartIndex = order.indexOf('a-start');
    const bStartIndex = order.indexOf('b-start');
    const aEndIndex = order.indexOf('a-end');
    // b should start before a ends
    expect(bStartIndex).toBeLessThan(aEndIndex);
    // Both should have started
    expect(aStartIndex).toBeGreaterThanOrEqual(0);
    expect(bStartIndex).toBeGreaterThanOrEqual(0);
  });

  it('should release lock even when function throws', async () => {
    // First operation throws
    await expect(
      withSessionLock('error-key', async () => {
        throw new Error('test error');
      })
    ).rejects.toThrow('test error');

    // Second operation on same key should still work
    const result = await withSessionLock('error-key', async () => 'recovered');
    expect(result).toBe('recovered');
  });

  it('should handle three queued operations in order', async () => {
    const order: number[] = [];

    const op1 = withSessionLock('triple-key', async () => {
      order.push(1);
      await sleep(30);
    });

    const op2 = withSessionLock('triple-key', async () => {
      order.push(2);
      await sleep(10);
    });

    const op3 = withSessionLock('triple-key', async () => {
      order.push(3);
    });

    await Promise.all([op1, op2, op3]);
    expect(order).toEqual([1, 2, 3]);
  });
});

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
