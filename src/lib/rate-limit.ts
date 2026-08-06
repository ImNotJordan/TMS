function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createRateLimitedExecutor(minIntervalMs: number) {
  let nextAllowedAt = 0;
  let tail: Promise<void> = Promise.resolve();

  return async function runRateLimited<T>(task: () => Promise<T>): Promise<T> {
    const run = async () => {
      const now = Date.now();
      const delay = Math.max(0, nextAllowedAt - now);
      if (delay > 0) {
        await wait(delay);
      }
      nextAllowedAt = Date.now() + minIntervalMs;
      return task();
    };

    const scheduled = tail.then(run, run);
    tail = scheduled.then(
      () => undefined,
      () => undefined,
    );
    return scheduled;
  };
}

export type DynamoRateLimiters = {
  /** Shared read queue — default 100ms min interval. */
  runRead: ReturnType<typeof createRateLimitedExecutor>;
  /** Shared write queue — default 200ms min interval. */
  runWrite: ReturnType<typeof createRateLimitedExecutor>;
};

/**
 * Process-wide Dynamo rate limiters used by `dynamo-entity-store`
 * (100ms read / 200ms write). Prefer these over per-store queues so
 * concurrent entity stores do not stack independent delays.
 */
let globalDynamoLimiters: DynamoRateLimiters | null = null;

export function getGlobalDynamoRateLimiters(): DynamoRateLimiters {
  if (!globalDynamoLimiters) {
    globalDynamoLimiters = {
      runRead: createRateLimitedExecutor(100),
      runWrite: createRateLimitedExecutor(200),
    };
  }
  return globalDynamoLimiters;
}

/** Alias for callers that want to create/obtain the shared global executors. */
export function createGlobalDynamoExecutors(): DynamoRateLimiters {
  return getGlobalDynamoRateLimiters();
}
