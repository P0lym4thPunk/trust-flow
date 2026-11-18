/**
 * Process-local keyed FIFO async mutex for coordinating multi-store mutations
 * within a single Node.js process. Does NOT provide cross-process or distributed locking.
 */
export class KeyedOperationLock {
  private readonly tails = new Map<string, Promise<void>>();

  public async withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.tails.get(key) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.tails.set(key, current);

    await prev;
    try {
      return await fn();
    } finally {
      if (this.tails.get(key) === current) {
        this.tails.delete(key);
      }
      release();
    }
  }

  public async withLocks<T>(keys: string[], fn: () => Promise<T>): Promise<T> {
    const sortedUniqueKeys = Array.from(
      new Set(keys.map((k) => k.trim()).filter((k) => k.length > 0))
    ).sort();

    if (sortedUniqueKeys.length === 0) {
      return fn();
    }

    const runAt = (index: number): Promise<T> => {
      if (index >= sortedUniqueKeys.length) {
        return fn();
      }
      return this.withLock(sortedUniqueKeys[index], () => runAt(index + 1));
    };

    return runAt(0);
  }
}
