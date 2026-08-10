/**
 * Where the API lives.
 *
 * The driver portal is a static SPA with no server of its own — the `/api/*`
 * routes belong to the dispatcher console's Worker. The two deploy
 * independently, so the portal cannot assume same-origin:
 *
 * - **dev**: empty, and Vite proxies `/api` to the console (see vite.config.ts).
 * - **production**: `VITE_API_BASE_URL` points at the console's origin, e.g.
 *   `https://ops.example.com`. Requests then cross origins, which is why the
 *   Worker sends CORS headers for this origin specifically.
 *
 * Same-origin deployment also works — leave the variable unset.
 */
const configured = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim() ?? "";

/** Absolute base for API calls, or "" when the API is same-origin. */
export function apiBaseUrl(): string {
  return configured.replace(/\/$/, "");
}

/** Resolve an API path against the configured base. */
export function apiUrl(path: string): string {
  const base = apiBaseUrl();
  return base ? `${base}${path}` : path;
}
