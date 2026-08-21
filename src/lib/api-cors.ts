/**
 * CORS for the driver and client portals.
 *
 * Those apps are static SPAs deployed to their own origins, so their `/api/*`
 * calls are cross-origin. Without these headers the browser blocks the response
 * and the portal sees a network error it cannot explain.
 *
 * ## Allowlist, not `*`
 *
 * Origins come from `TITAN_ALLOWED_ORIGINS` (comma-separated) and are matched
 * exactly. `Access-Control-Allow-Origin: *` would work — these endpoints take a
 * bearer token rather than cookies, so there is no ambient authority for a
 * hostile page to ride on — but it also invites the next endpoint to be added
 * without that being true any more. An allowlist keeps the guarantee local.
 *
 * Requests with no `Origin` header (same-origin, curl, the ops console) get no
 * CORS headers and need none.
 */
import { readServerEnv } from "@/lib/server-env";

function allowedOrigins(): string[] {
  const raw = readServerEnv("TITAN_ALLOWED_ORIGINS") ?? "";
  return raw
    .split(",")
    .map((value) => value.trim().replace(/\/$/, ""))
    .filter(Boolean);
}

/** Echo the request's origin when it is allowed. Never a wildcard. */
export function corsHeadersFor(request: Request): Record<string, string> {
  const origin = request.headers.get("origin")?.trim().replace(/\/$/, "");
  if (!origin) return {};
  if (!allowedOrigins().includes(origin)) return {};

  return {
    "Access-Control-Allow-Origin": origin,
    // Origin-dependent response — caches must not serve one origin's response
    // to another.
    Vary: "Origin",
    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Titan-Geocode-Key",
    "Access-Control-Max-Age": "600",
  };
}

/** Answer a preflight, or `null` when this is not one. */
export function preflightResponse(request: Request): Response | null {
  if (request.method !== "OPTIONS") return null;
  const headers = corsHeadersFor(request);
  // An origin that is not allowed gets a bare 403 — no CORS headers, so the
  // browser blocks the real request that would have followed.
  if (Object.keys(headers).length === 0) return new Response(null, { status: 403 });
  return new Response(null, { status: 204, headers });
}

/** Copy CORS headers onto a response produced by a handler. */
export function withCors(request: Request, response: Response): Response {
  const headers = corsHeadersFor(request);
  if (Object.keys(headers).length === 0) return response;

  const merged = new Headers(response.headers);
  for (const [key, value] of Object.entries(headers)) merged.set(key, value);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: merged,
  });
}
