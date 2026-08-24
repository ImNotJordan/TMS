/**
 * Where the API lives.
 *
 * This portal is a static SPA. `/api/*` belongs to the operations console's
 * Worker. In dev, Vite proxies `/api` there. In production set
 * `VITE_API_BASE_URL` to the console origin and add this origin to
 * `TITAN_ALLOWED_ORIGINS`.
 */
const configured = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim() ?? "";

export function apiUrl(path: string): string {
  const base = configured.replace(/\/$/, "");
  return base ? `${base}${path}` : path;
}
