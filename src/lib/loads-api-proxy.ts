/**
 * Loads API — the first domain to move behind the server.
 *
 *   GET    /api/loads          list the caller's company's loads
 *   GET    /api/loads/:id      one load, 404 if it is not theirs
 *   POST   /api/loads          create, stamped with their company
 *   PATCH  /api/loads/:id      scoped update
 *   DELETE /api/loads/:id      scoped delete
 *
 * Every handler resolves a `TenantContext` from the verified token and hands it
 * to the repository, which cannot run without one. No handler sees a company id
 * from the request, and none can opt out of scoping — there is no repository
 * method that takes anything less.
 *
 * ## Client-supplied `companyId` is rejected, not ignored
 *
 * A create or update carrying `companyId` returns 400. Silently dropping it
 * would be safe but invisible: the attempt would never appear in a log, and a
 * genuine wiring mistake would go unnoticed for months. The same applies to
 * `createdBy` and the audit timestamps — all server-owned.
 */
import { RecordNotFoundError, createTenantRepository } from "@/lib/server/tenant-repository";
import { ServerDataPrincipalMissingError } from "@/lib/server/server-dynamo";
import { readServerEnv } from "@/lib/server-env";
import { requireCurrentTenantContext } from "@/lib/tenant/request-context";
import { logTenantDenial, tenantErrorResponse } from "@/lib/tenant/server-tenant-context";
import type { LoadRecord } from "@/lib/loads-store";

const LOADS_PATH = "/api/loads";

/** Server-owned. A request that tries to set one of these is refused. */
const SERVER_OWNED_FIELDS = ["companyId", "createdBy", "createdAt", "updatedAt"] as const;

/** Guard against a payload large enough to be an attack rather than a load. */
const MAX_BODY_BYTES = 2_000_000;

function loadsTable(): string {
  return readServerEnv("VITE_LOADS_TABLE_NAME") || "Loads";
}

const loads = createTenantRepository<LoadRecord>({
  table: loadsTable,
  idKey: "loadId",
  label: "Load",
  companyIndex: "companyId-index",
});

export function isLoadsApiRequest(url: URL): boolean {
  return url.pathname === LOADS_PATH || url.pathname.startsWith(`${LOADS_PATH}/`);
}

/** The `:id` segment, or null for the collection route. */
function loadIdFromPath(url: URL): string | null {
  if (url.pathname === LOADS_PATH) return null;
  const rest = url.pathname.slice(LOADS_PATH.length + 1);
  return decodeURIComponent(rest).trim() || null;
}

function jsonError(message: string, status: number, code?: string) {
  return Response.json({ error: message, code }, { status });
}

async function readBody(request: Request): Promise<Record<string, unknown> | Response> {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    return jsonError("Request body too large.", 413, "payload_too_large");
  }
  try {
    const parsed = (await request.json()) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return jsonError("Expected a JSON object.", 400, "invalid_payload");
    }
    return parsed as Record<string, unknown>;
  } catch {
    return jsonError("Invalid JSON body.", 400, "invalid_payload");
  }
}

/**
 * Refuse a payload that tries to set a server-owned field.
 *
 * Returns a 400 naming the offending fields — the caller already sent them, so
 * echoing the names back leaks nothing, and it makes a wiring bug obvious.
 */
function rejectServerOwnedFields(body: Record<string, unknown>): Response | null {
  const offending = SERVER_OWNED_FIELDS.filter((field) => field in body);
  if (offending.length === 0) return null;
  return jsonError(
    `These fields are set by the server and cannot be supplied: ${offending.join(", ")}.`,
    400,
    "server_owned_field",
  );
}

export async function handleLoadsApiRequest(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const loadId = loadIdFromPath(url);

  let ctx;
  try {
    ctx = await requireCurrentTenantContext(request);
  } catch (err) {
    return tenantErrorResponse(err) ?? jsonError("Sign in required.", 401, "not_authenticated");
  }

  try {
    switch (request.method) {
      case "GET": {
        if (!loadId) return Response.json({ loads: await loads.list(ctx) });
        const record = await loads.get(ctx, loadId);
        if (!record) {
          logTenantDenial(ctx, "load not found or not in company", `${LOADS_PATH}/:id`);
          return jsonError("Load not found.", 404, "not_found");
        }
        return Response.json({ load: record });
      }

      case "POST": {
        if (loadId) return jsonError("Method not allowed.", 405);
        const body = await readBody(request);
        if (body instanceof Response) return body;
        const rejected = rejectServerOwnedFields(body);
        if (rejected) {
          logTenantDenial(ctx, "create carried server-owned fields", LOADS_PATH);
          return rejected;
        }
        if (typeof body.loadId !== "string" || !body.loadId.trim()) {
          return jsonError("loadId is required.", 400, "invalid_payload");
        }
        const created = await loads.create(ctx, body as never);
        return Response.json({ load: created }, { status: 201 });
      }

      case "PATCH": {
        if (!loadId) return jsonError("Method not allowed.", 405);
        const body = await readBody(request);
        if (body instanceof Response) return body;
        const rejected = rejectServerOwnedFields(body);
        if (rejected) {
          logTenantDenial(ctx, "update carried server-owned fields", `${LOADS_PATH}/:id`);
          return rejected;
        }
        const updated = await loads.update(ctx, loadId, body as Partial<LoadRecord>);
        return Response.json({ load: updated });
      }

      case "DELETE": {
        if (!loadId) return jsonError("Method not allowed.", 405);
        await loads.remove(ctx, loadId);
        return new Response(null, { status: 204 });
      }

      default:
        return jsonError("Method not allowed.", 405);
    }
  } catch (err) {
    // A cross-tenant miss surfaces here as not-found, with no detail.
    if (err instanceof RecordNotFoundError) {
      logTenantDenial(ctx, "scoped operation matched no record", url.pathname);
      return jsonError(err.message, err.status, err.code);
    }
    if (err instanceof ServerDataPrincipalMissingError) {
      console.error("[loads] data principal is not configured");
      return jsonError("Server is not configured for data access.", 503, err.code);
    }
    // Never echo the error to the client — AWS messages carry table names and
    // key values. The detail goes to the log; the caller gets a status.
    console.error("[loads] request failed", err instanceof Error ? err.message : err);
    return jsonError("Could not complete that request.", 502, "error");
  }
}
