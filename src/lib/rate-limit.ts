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
