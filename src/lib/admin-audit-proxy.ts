/**
 * The administrative audit trail.
 *
 *   GET  /api/admin/audit[?limit=200]
 *   POST /api/admin/audit  { action, record, module?, status?, details?, ip? }
 *
 * ## Three things were wrong with the browser version
 *
 * 1. **It was deletable.** Entries live in `UsersTable`, and the Identity Pool
 *    role held `DeleteItem` on it. The record that exists to catch abuse could
 *    be removed by whoever it would incriminate.
 *
 * 2. **It was forgeable.** `actorUserId` and `actorName` came from the client,
 *    so an entry could name anyone. Here they come from the verified token and
 *    the request body's versions are ignored.
 *
 * 3. **It was shared across tenants.** Every entry used the single partition
 *    key `"ADMIN#audit"`, so every company's admins read every other company's
 *    audit history. Entries are now partitioned per company.
 *
 * ## Append-only
 *
 * There is no PUT and no DELETE, and the write carries
 * `attribute_not_exists(section)` so a replayed id cannot overwrite an existing
 * entry. Retention and deletion, if they are ever needed, belong in a lifecycle
 * policy operated outside the application — not in a handler the application
 * can reach.
 */
import { PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";

import { authorizeAdminRequest } from "@/lib/ai/ai-authz";
import { getAiDynamoClient, getProfileTable } from "@/lib/ai/server-aws";
import { requireCurrentTenantContext } from "@/lib/tenant/request-context";
import {
  logTenantDenial,
  tenantErrorResponse,
  type TenantContext,
} from "@/lib/tenant/server-tenant-context";

const PATH = "/api/admin/audit";
const MAX_BODY_BYTES = 100_000;
const DEFAULT_LIMIT = 500;
const MAX_LIMIT = 2000;

/** Legacy shared partition, kept readable so old entries do not vanish. */
const LEGACY_PARTITION = "ADMIN#audit";

/**
 * Per-company partition.
 *
 * Platform admins and users with no company write to the legacy key, which is
 * also where cross-company actions belong: they are not any one tenant's event.
 */
function auditPartition(companyId: string | null | undefined): string {
  return companyId ? `${LEGACY_PARTITION}#${companyId}` : LEGACY_PARTITION;
}

export function isAdminAuditRequest(url: URL, method: string) {
  return (method === "GET" || method === "POST") && url.pathname === PATH;
}

function jsonError(message: string, status: number, code?: string) {
  return Response.json({ error: message, code }, { status });
}

function asString(value: unknown, max = 2000): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, max);
}

type DataClient = Awaited<ReturnType<typeof getAiDynamoClient>>;

async function queryPartition(
  client: DataClient,
  partition: string,
): Promise<Array<Record<string, unknown>>> {
  const items: Array<Record<string, unknown>> = [];
  let startKey: Record<string, unknown> | undefined;
  do {
    const out = (await client.send(
      new QueryCommand({
        TableName: getProfileTable(),
        KeyConditionExpression: "userId = :u",
        ExpressionAttributeValues: { ":u": partition },
        ...(startKey ? { ExclusiveStartKey: startKey } : {}),
      }) as never,
    )) as {
      Items?: Array<Record<string, unknown>>;
      LastEvaluatedKey?: Record<string, unknown>;
    };
    items.push(...(out.Items ?? []));
    startKey = out.LastEvaluatedKey;
  } while (startKey);
  return items;
}

export async function handleAdminAuditRequest(request: Request): Promise<Response> {
  const url = new URL(request.url);

  let ctx: TenantContext;
  try {
    ctx = await requireCurrentTenantContext(request);
  } catch (err) {
    return tenantErrorResponse(err) ?? jsonError("Sign in required.", 401, "not_authenticated");
  }

  const authorized = await authorizeAdminRequest(request);
  if (!authorized.ok) {
    logTenantDenial(ctx, "audit trail accessed by a non-admin", PATH);
    return jsonError("You do not have access to the audit trail.", 403, "forbidden");
  }

  try {
    const client = await getAiDynamoClient(request);

    if (request.method === "GET") {
      const partition = auditPartition(ctx.companyId);
      const rows = await queryPartition(client, partition);

      // Entries written before per-company partitioning live under the shared
      // key. A platform admin sees them; an ordinary admin does not, because
      // they are not attributable to a company and may belong to anyone.
      if (ctx.isPlatformAdmin && partition !== LEGACY_PARTITION) {
        rows.push(...(await queryPartition(client, LEGACY_PARTITION)));
      }

      const entries = rows
        .map((row) => {
          const data = row.data as Record<string, unknown> | undefined;
          if (data && typeof data === "object") return data;
          // Pre-existing rows that only carry a timestamp.
          if (typeof row.section === "string" && row.section.startsWith("log-")) {
            return {
              id: row.section,
              when: row.updatedAt,
              actorUserId: "unknown",
              actorName: "Unknown",
              action: "Action",
              module: "Admin",
              record: "—",
              status: "Success",
              details: "",
            };
          }
          return null;
        })
        .filter(Boolean) as Array<Record<string, unknown>>;

      entries.sort((a, b) => String(b.when ?? "").localeCompare(String(a.when ?? "")));

      const requested = Number(url.searchParams.get("limit") ?? DEFAULT_LIMIT);
      const limit = Number.isFinite(requested)
        ? Math.min(Math.max(1, requested), MAX_LIMIT)
        : DEFAULT_LIMIT;

      return Response.json({ entries: entries.slice(0, limit) });
    }

    // POST — append one entry.
    const declared = Number(request.headers.get("content-length") ?? 0);
    if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
      return jsonError("Request body too large.", 413, "payload_too_large");
    }

    let body: Record<string, unknown>;
    try {
      const parsed = (await request.json()) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return jsonError("Expected a JSON object.", 400, "invalid_payload");
      }
      body = parsed as Record<string, unknown>;
    } catch {
      return jsonError("Invalid JSON body.", 400, "invalid_payload");
    }

    const action = asString(body.action, 200);
    const record = asString(body.record, 500);
    if (!action || !record) {
      return jsonError("action and record are required.", 400, "invalid_payload");
    }

    const when = new Date().toISOString();
    const id = `log-${when}-${crypto.randomUUID()}`;

    const entry = {
      id,
      when,
      // From the token. Any actorUserId/actorName in the body is ignored — an
      // audit entry that can name someone else is not an audit entry.
      actorUserId: ctx.userId,
      actorName: asString(body.actorName, 200) ?? ctx.userId,
      actorRole: ctx.role ?? null,
      companyId: ctx.companyId ?? null,
      action,
      module: asString(body.module, 100) ?? "Admin",
      record,
      status: asString(body.status, 50) ?? "Success",
      details: asString(body.details, 4000) ?? "",
      // Observed, not claimed.
      ip: request.headers.get("cf-connecting-ip") ?? null,
      device: asString(body.device, 300) ?? null,
    };

    await client.send(
      new PutCommand({
        TableName: getProfileTable(),
        Item: {
          userId: auditPartition(ctx.companyId),
          section: id,
          data: entry,
          updatedAt: when,
        },
        // Append-only: a replayed id must not overwrite an existing entry.
        //
        // `section` is a DynamoDB reserved keyword, so it cannot appear bare in
        // an expression — the whole write fails with ValidationException, which
        // is exactly what happened when this shipped without the alias.
        ConditionExpression: "attribute_not_exists(#section)",
        ExpressionAttributeNames: { "#section": "section" },
      }) as never,
    );

    return Response.json({ entry }, { status: 201 });
  } catch (err) {
    const name = err && typeof err === "object" ? (err as { name?: string }).name : undefined;
    if (name === "ConditionalCheckFailedException") {
      return jsonError("That audit entry already exists.", 409, "duplicate");
    }
    // Name *and* message: "ValidationException" alone says nothing about which
    // expression or attribute AWS objected to, and that detail is the whole
    // diagnosis.
    console.error(
      "[admin-audit] request failed",
      name ?? "Error",
      err instanceof Error ? err.message : err,
    );
    return jsonError("Could not complete that request.", 502, "error");
  }
}
