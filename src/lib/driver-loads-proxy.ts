/**
 * Driver Loads API — the assignment-scoped counterpart to `/api/loads`.
 *
 *   GET   /api/driver/loads       loads assigned to the caller
 *   GET   /api/driver/loads/:id   one, 404 unless it is theirs
 *   PATCH /api/driver/loads/:id   the driver-owned fields, nothing else
 *
 * ## Why this is separate from `/api/loads`
 *
 * Drivers are tenant-exempt: they carry no `companyId`, because a driver works
 * across companies over a career and giving them one would hand them a whole
 * company's board. "Exempt from the companyId rule" is not "exempt from
 * filtering" though — so their scope is `assignedDriver = <their sub>`, applied
 * here with the same rigour the company predicate gets elsewhere.
 *
 * Two scopes, two endpoints. A single endpoint that switched predicate on role
 * would be one `if` away from serving the wrong one.
 *
 * ## Writes
 *
 * The field allowlist lives here, on the server. It also exists in the driver
 * portal, but that copy is advice: the client can be edited. This copy is the
 * rule. Without it a driver could rewrite `customerRate` on a load they are
 * legitimately assigned.
 */
import { QueryCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";

import { getServerDataClient, ServerDataPrincipalMissingError } from "@/lib/server/server-dynamo";
import { readServerEnv } from "@/lib/server-env";
import { requireCurrentTenantContext } from "@/lib/tenant/request-context";
import {
  logTenantDenial,
  tenantErrorResponse,
  type TenantContext,
} from "@/lib/tenant/server-tenant-context";

const DRIVER_LOADS_PATH = "/api/driver/loads";
const ASSIGNED_DRIVER_INDEX = "assignedDriver-index";

/**
 * Attributes a driver may write. Everything else on a load — rates, customer,
 * addresses, carrier, the ops console's `trackingSession` — belongs to dispatch.
 */
const DRIVER_WRITABLE_FIELDS: ReadonlySet<string> = new Set([
  "driverWorkflowStatus",
  "driverStatusHistory",
  "documentAssets",
  "documents",
  "driverGps",
  // Shared with dispatch by design: a driver marking a load delivered is how the
  // board finds out. Worth narrowing to reachable statuses later.
  "loadStatus",
]);

const MAX_BODY_BYTES = 2_000_000;

function loadsTable(): string {
  return readServerEnv("VITE_LOADS_TABLE_NAME") || "Loads";
}

export function isDriverLoadsRequest(url: URL): boolean {
  return url.pathname === DRIVER_LOADS_PATH || url.pathname.startsWith(`${DRIVER_LOADS_PATH}/`);
}

function loadIdFromPath(url: URL): string | null {
  if (url.pathname === DRIVER_LOADS_PATH) return null;
  const rest = url.pathname.slice(DRIVER_LOADS_PATH.length + 1);
  return decodeURIComponent(rest).trim() || null;
}

function jsonError(message: string, status: number, code?: string) {
  return Response.json({ error: message, code }, { status });
}

type LoadItem = Record<string, unknown>;

/** Loads assigned to this driver, via the index. Never a table scan. */
async function listAssigned(driverId: string): Promise<LoadItem[]> {
  const client = getServerDataClient();
  const items: LoadItem[] = [];
  let cursor: Record<string, unknown> | undefined;

  do {
    const page = (await client.send(
      new QueryCommand({
        TableName: loadsTable(),
        IndexName: ASSIGNED_DRIVER_INDEX,
        KeyConditionExpression: "assignedDriver = :owner",
        ExpressionAttributeValues: { ":owner": driverId },
        ExclusiveStartKey: cursor,
      }) as never,
    )) as { Items?: LoadItem[]; LastEvaluatedKey?: Record<string, unknown> };
    if (page.Items?.length) items.push(...page.Items);
    cursor = page.LastEvaluatedKey;
  } while (cursor);

  return items;
}

/**
 * One assigned load.
 *
 * Queried through the index rather than fetched by id and then checked, so the
 * scope is part of the lookup instead of an afterthought a refactor can drop.
 */
async function getAssigned(driverId: string, loadId: string): Promise<LoadItem | null> {
  const client = getServerDataClient();
  const out = (await client.send(
    new QueryCommand({
      TableName: loadsTable(),
      IndexName: ASSIGNED_DRIVER_INDEX,
      KeyConditionExpression: "assignedDriver = :owner",
      FilterExpression: "loadId = :loadId",
      ExpressionAttributeValues: { ":owner": driverId, ":loadId": loadId },
      Limit: 1,
    }) as never,
  )) as { Items?: LoadItem[] };
  return out.Items?.[0] ?? null;
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

async function patchAssigned(
  ctx: TenantContext,
  loadId: string,
  patch: Record<string, unknown>,
): Promise<Response> {
  const rejected = Object.keys(patch).filter(
    (key) => key !== "loadId" && !DRIVER_WRITABLE_FIELDS.has(key),
  );
  if (rejected.length > 0) {
    logTenantDenial(
      ctx,
      `driver write to non-driver fields: ${rejected.join(", ")}`,
      `${DRIVER_LOADS_PATH}/:id`,
    );
    return jsonError(`Drivers cannot modify: ${rejected.join(", ")}.`, 403, "field_not_writable");
  }

  const entries = Object.entries(patch).filter(
    ([key, value]) => key !== "loadId" && value !== undefined,
  );
  if (entries.length === 0) return jsonError("Nothing to update.", 400, "invalid_payload");

  const names: Record<string, string> = { "#updatedAt": "updatedAt" };
  const values: Record<string, unknown> = {
    ":updatedAt": new Date().toISOString(),
    ":owner": ctx.userId,
  };
  const sets = ["#updatedAt = :updatedAt"];
  entries.forEach(([key, value], i) => {
    names[`#a${i}`] = key;
    values[`:a${i}`] = value;
    sets.push(`#a${i} = :a${i}`);
  });

  try {
    const client = getServerDataClient();
    const out = (await client.send(
      new UpdateCommand({
        TableName: loadsTable(),
        Key: { loadId },
        UpdateExpression: `SET ${sets.join(", ")}`,
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
        // Exists AND is assigned to this driver, in one statement. A load
        // reassigned between read and write fails here rather than being
        // silently overwritten.
        ConditionExpression: "attribute_exists(loadId) AND assignedDriver = :owner",
        ReturnValues: "ALL_NEW",
      }) as never,
    )) as { Attributes?: LoadItem };
    return Response.json({ load: out.Attributes });
  } catch (err) {
    if ((err as { name?: string })?.name === "ConditionalCheckFailedException") {
      logTenantDenial(ctx, "driver write to an unassigned load", `${DRIVER_LOADS_PATH}/:id`);
      // Same answer as a load that does not exist.
      return jsonError("Load not found.", 404, "not_found");
    }
    throw err;
  }
}

export async function handleDriverLoadsRequest(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const loadId = loadIdFromPath(url);

  let ctx: TenantContext;
  try {
    ctx = await requireCurrentTenantContext(request);
  } catch (err) {
    return tenantErrorResponse(err) ?? jsonError("Sign in required.", 401, "not_authenticated");
  }

  // Scoped to the caller's own assignments, whoever they are. No company
  // predicate — a driver has no company — and no way to ask about anyone else's
  // loads, because the driver id comes from the token rather than the request.
  const driverId = ctx.userId;

  try {
    switch (request.method) {
      case "GET": {
        if (!loadId) return Response.json({ loads: await listAssigned(driverId) });
        const load = await getAssigned(driverId, loadId);
        if (!load) {
          logTenantDenial(ctx, "load not assigned to caller", `${DRIVER_LOADS_PATH}/:id`);
          return jsonError("Load not found.", 404, "not_found");
        }
        return Response.json({ load });
      }

      case "PATCH": {
        if (!loadId) return jsonError("Method not allowed.", 405);
        const body = await readBody(request);
        if (body instanceof Response) return body;
        return await patchAssigned(ctx, loadId, body);
      }

      default:
        return jsonError("Method not allowed.", 405);
    }
  } catch (err) {
    if (err instanceof ServerDataPrincipalMissingError) {
      console.error("[driver-loads] data principal is not configured");
      return jsonError("Server is not configured for data access.", 503, err.code);
    }
    console.error("[driver-loads] request failed", err instanceof Error ? err.message : err);
    return jsonError("Could not complete that request.", 502, "error");
  }
}
