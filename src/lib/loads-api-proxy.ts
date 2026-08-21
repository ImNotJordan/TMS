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
import {
  RecordAlreadyExistsError,
  RecordNotFoundError,
  RecordPreconditionFailedError,
  createTenantRepository,
} from "@/lib/server/tenant-repository";
import { ServerDataPrincipalMissingError } from "@/lib/server/server-dynamo";
import { readServerEnv } from "@/lib/server-env";
import { requireCurrentTenantContext } from "@/lib/tenant/request-context";
import { refuseClientOnOpsApi } from "@/lib/tenant/client-scope";
import {
  logTenantDenial,
  tenantErrorResponse,
  type TenantContext,
} from "@/lib/tenant/server-tenant-context";
import { checkLoadTransition, normalizeLoadStatus } from "@/lib/load-status";
import { parseLoadInventoryLines } from "@/lib/load-inventory";
import { syncLoadInventoryForTenant } from "@/lib/inventory-proxy";
import { SERVER_OWNED_LOAD_FIELDS, buildLoadAuditEntry } from "@/lib/load-audit";
import {
  checkLoadCreate,
  checkLoadDelete,
  checkLoadUpdate,
  type LoadWriteCheck,
} from "@/lib/tenant/load-permissions";
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

function sanitizeInventoryLines(body: Record<string, unknown>) {
  if (!("inventoryLines" in body)) return;
  body.inventoryLines = parseLoadInventoryLines(body.inventoryLines);
}

async function loadWriteResponse(
  ctx: TenantContext,
  load: LoadRecord,
  status: number,
  previous?: LoadRecord | null,
): Promise<Response> {
  try {
    const sync = await syncLoadInventoryForTenant(ctx, load, { previous });
    if (!sync.ok) {
      return Response.json(
        {
          load,
          inventoryError: { message: sync.message, code: sync.code },
        },
        { status },
      );
    }
  } catch (err) {
    console.error("[loads] inventory sync failed", err instanceof Error ? err.message : err);
    return Response.json(
      {
        load,
        inventoryError: {
          message: "Load saved, but warehouse stock could not be updated.",
          code: "inventory_sync_failed",
        },
      },
      { status },
    );
  }
  return Response.json({ load }, { status });
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

/**
 * Refuse a request that tries to write a server-owned trail.
 *
 * Separate from `rejectServerOwnedFields` so the message can say *why* — a client
 * sending `loadAuditTrail` is not reaching for someone else's field, it is trying
 * to write the record of its own behaviour.
 */
function rejectServerOwnedTrails(body: Record<string, unknown>): Response | null {
  const offending = SERVER_OWNED_LOAD_FIELDS.filter((field) => field in body);
  if (offending.length === 0) return null;
  return jsonError(
    `${offending.join(", ")} is recorded by the server and cannot be supplied.`,
    403,
    "server_owned_field",
  );
}

/** A permission or freeze denial as a response, with the attempt logged. */
function denialResponse(ctx: TenantContext, check: LoadWriteCheck, path: string): Response | null {
  if (check.ok) return null;
  logTenantDenial(ctx, `${check.code}: ${check.message}`, path);
  return Response.json(
    { error: check.message, code: check.code, fields: check.fields },
    { status: check.status },
  );
}

/**
 * Canonicalise `loadStatus` on the way in, or refuse it.
 *
 * Writing the caller's spelling straight through is how `"Booked"` ended up in
 * the table alongside `booked`: every reader lowercases, so it worked until the
 * first reader that did not. Normalising at the boundary means there is exactly
 * one spelling of each status in storage from here on.
 *
 * Returns `undefined` when the body does not mention status at all — distinct
 * from `null`, which cannot happen because an unrecognised value is a 400.
 */
function canonicalStatusFromBody(
  body: Record<string, unknown>,
): { status: string } | { error: Response } | undefined {
  if (!("loadStatus" in body)) return undefined;
  const raw = body.loadStatus;
  if (raw === undefined || raw === null || raw === "") {
    return {
      error: jsonError("loadStatus cannot be cleared.", 400, "unknown_status"),
    };
  }
  const status = normalizeLoadStatus(typeof raw === "string" ? raw : String(raw));
  if (!status) {
    return {
      error: jsonError(`"${String(raw)}" is not a load status.`, 400, "unknown_status"),
    };
  }
  return { status };
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

  if (ctx.role === "Client") {
    return refuseClientOnOpsApi(ctx, LOADS_PATH)!;
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

        const trail = rejectServerOwnedTrails(body);
        if (trail) {
          logTenantDenial(ctx, "create carried a server-owned trail", LOADS_PATH);
          return trail;
        }

        const denied = denialResponse(ctx, checkLoadCreate(ctx, body), LOADS_PATH);
        if (denied) return denied;

        sanitizeInventoryLines(body);

        const status = canonicalStatusFromBody(body);
        if (status && "error" in status) return status.error;
        // A new load starts at draft unless the caller names a reachable
        // starting status. `checkLoadTransition(null, …)` decides what that is.
        if (status) {
          const check = checkLoadTransition(null, status.status);
          if (!check.ok) {
            logTenantDenial(ctx, `${check.code}: ${check.message}`, LOADS_PATH);
            return jsonError(check.message, 400, check.code);
          }
          body.loadStatus = status.status;
        } else {
          body.loadStatus = "draft";
        }

        const created = await loads.create(ctx, body as never);
        return await loadWriteResponse(ctx, created, 201);
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

        const trail = rejectServerOwnedTrails(body);
        if (trail) {
          logTenantDenial(ctx, "update carried a server-owned trail", `${LOADS_PATH}/:id`);
          return trail;
        }

        // The stored record, read inside the same request that writes. Needed for
        // three decisions: is the caller allowed to touch these fields in this
        // status, is the status move legal, and what does the conditional write
        // expect to still be true. A cross-tenant or absent load reads as null
        // and 404s here, before any of that.
        const current = await loads.get(ctx, loadId);
        if (!current) {
          logTenantDenial(ctx, "load not found or not in company", `${LOADS_PATH}/:id`);
          return jsonError("Load not found.", 404, "not_found");
        }

        const denied = denialResponse(
          ctx,
          checkLoadUpdate(ctx, body, current),
          `${LOADS_PATH}/:id`,
        );
        if (denied) return denied;

        sanitizeInventoryLines(body);

        const status = canonicalStatusFromBody(body);
        if (status && "error" in status) return status.error;

        let expect: Partial<Record<keyof LoadRecord & string, unknown>> | undefined;
        if (status) {
          const check = checkLoadTransition(current.loadStatus, status.status);
          if (!check.ok) {
            logTenantDenial(ctx, `${check.code}: ${check.message}`, `${LOADS_PATH}/:id`);
            return jsonError(check.message, 409, check.code);
          }
          body.loadStatus = status.status;
          // Only pin the status when the write actually moves it. Pinning on a
          // no-op would fail every whole-record save from an editor screen whose
          // copy of `loadStatus` is a normalised alias of what is stored.
          if (check.from !== check.to) {
            expect = { loadStatus: current.loadStatus ?? undefined };
          }
        }

        // Built from the stored record and the verified token, and appended in the
        // same statement as the write — so a change cannot land without its entry.
        const auditEntry = buildLoadAuditEntry({
          ctx,
          patch: body,
          current: current as unknown as Record<string, unknown>,
          via: "ops-api",
        });

        const updated = await loads.update(ctx, loadId, body as Partial<LoadRecord>, {
          expect,
          staleMessage:
            "This load moved to a different status while you were editing it. Reload and try again.",
          append: auditEntry ? { loadAuditTrail: [auditEntry] } : undefined,
        });
        return await loadWriteResponse(ctx, updated, 200, current);
      }

      case "DELETE": {
        if (!loadId) return jsonError("Method not allowed.", 405);
        const denied = denialResponse(ctx, checkLoadDelete(ctx), `${LOADS_PATH}/:id`);
        if (denied) return denied;
        const current = await loads.get(ctx, loadId);
        if (!current) {
          logTenantDenial(ctx, "load not found or not in company", `${LOADS_PATH}/:id`);
          return jsonError("Load not found.", 404, "not_found");
        }
        try {
          await syncLoadInventoryForTenant(ctx, { ...current, loadStatus: "cancelled" }, {
            previous: current,
          });
        } catch (err) {
          console.error(
            "[loads] inventory release on delete failed",
            err instanceof Error ? err.message : err,
          );
        }
        await loads.remove(ctx, loadId);
        return new Response(null, { status: 204 });
      }

      default:
        return jsonError("Method not allowed.", 405);
    }
  } catch (err) {
    // A cross-tenant miss surfaces here as not-found, with no detail.
    if (err instanceof RecordAlreadyExistsError) {
      return jsonError(err.message, err.status, err.code);
    }
    if (err instanceof RecordNotFoundError) {
      logTenantDenial(ctx, "scoped operation matched no record", url.pathname);
      return jsonError(err.message, err.status, err.code);
    }
    // The load is theirs but moved under them — a retryable 409, not a 404.
    if (err instanceof RecordPreconditionFailedError) {
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
