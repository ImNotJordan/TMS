/**
 * Server-side env reader.
 *
 * Config reaches the Worker by three different routes depending on how it is
 * running, so all three are checked:
 *
 * 1. `process.env` — Cloudflare populates this from vars and secrets under
 *    `nodejs_compat`, and it is also where Node-hosted runs put things.
 * 2. The `env` binding handed to `fetch(request, env, ctx)` — the canonical
 *    Workers route, and the one `.dev.vars` and `wrangler secret put` feed.
 *    Captured on the first request via `captureServerEnv`.
 * 3. `import.meta.env` — Vite's server bundle, which only carries `VITE_`
 *    prefixed names.
 *
 * Relying on `process.env` alone means a correctly configured `.dev.vars` can
 * still read as "not configured", which surfaces as a 503 from the settings and
 * assignment endpoints and is thoroughly confusing to debug.
 */
let workerEnv: Record<string, unknown> | null = null;

/**
 * Record the Worker's env binding. Called once per request from the fetch
 * handler; cheap and idempotent.
 */
export function captureServerEnv(env: unknown): void {
  if (env && typeof env === "object") {
    workerEnv = env as Record<string, unknown>;
  }
}

export function readServerEnv(name: string): string | undefined {
  const fromProcess =
    typeof process !== "undefined" ? (process.env?.[name] as string | undefined) : undefined;
  if (fromProcess?.trim()) return fromProcess.trim();

  const fromBinding = workerEnv?.[name];
  if (typeof fromBinding === "string" && fromBinding.trim()) return fromBinding.trim();

  const fromMeta = (import.meta.env as Record<string, string | undefined>)[name];
  return fromMeta?.trim() || undefined;
}
