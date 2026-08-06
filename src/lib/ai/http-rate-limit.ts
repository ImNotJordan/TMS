/**
 * In-process sliding-window rate limiter for Logistics AI HTTP routes.
 * Suitable for single-node / sticky sessions. For multi-instance at 1M users,
 * replace the store with Redis/Dynamo (same interface).
 */

type Bucket = {
  timestamps: number[];
  inFlight: number;
};

const buckets = new Map<string, Bucket>();

const CLEANUP_EVERY = 500;
let opsSinceCleanup = 0;

function prune(now: number, windowMs: number, bucket: Bucket) {
  const cutoff = now - windowMs;
  while (bucket.timestamps.length > 0 && bucket.timestamps[0]! < cutoff) {
    bucket.timestamps.shift();
  }
}

function cleanupStale(now: number) {
  opsSinceCleanup += 1;
  if (opsSinceCleanup < CLEANUP_EVERY) return;
  opsSinceCleanup = 0;
  for (const [key, bucket] of buckets) {
    if (bucket.timestamps.length === 0 && bucket.inFlight === 0) {
      buckets.delete(key);
      continue;
    }
    // Drop buckets idle for > 10 minutes
    const last = bucket.timestamps[bucket.timestamps.length - 1] ?? 0;
    if (bucket.inFlight === 0 && now - last > 10 * 60_000) {
      buckets.delete(key);
    }
  }
}

export type RateLimitResult =
  | { ok: true; remaining: number }
  | { ok: false; retryAfterSec: number; remaining: 0 };

export function checkRateLimit(options: {
  key: string;
  limit: number;
  windowMs: number;
}): RateLimitResult {
  const now = Date.now();
  cleanupStale(now);
  const bucket = buckets.get(options.key) ?? { timestamps: [], inFlight: 0 };
  prune(now, options.windowMs, bucket);
  if (bucket.timestamps.length >= options.limit) {
    const oldest = bucket.timestamps[0] ?? now;
    const retryAfterSec = Math.max(1, Math.ceil((oldest + options.windowMs - now) / 1000));
    buckets.set(options.key, bucket);
    return { ok: false, retryAfterSec, remaining: 0 };
  }
  bucket.timestamps.push(now);
  buckets.set(options.key, bucket);
  return { ok: true, remaining: Math.max(0, options.limit - bucket.timestamps.length) };
}

export function tryAcquireInFlight(key: string, maxInFlight: number): boolean {
  const bucket = buckets.get(key) ?? { timestamps: [], inFlight: 0 };
  if (bucket.inFlight >= maxInFlight) {
    buckets.set(key, bucket);
    return false;
  }
  bucket.inFlight += 1;
  buckets.set(key, bucket);
  return true;
}

export function releaseInFlight(key: string) {
  const bucket = buckets.get(key);
  if (!bucket) return;
  bucket.inFlight = Math.max(0, bucket.inFlight - 1);
  buckets.set(key, bucket);
}

export function clientIpFromRequest(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return request.headers.get("x-real-ip")?.trim() || "unknown";
}
