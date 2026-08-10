/**
 * One handler for every tenant-scoped resource.
 *
 *   GET    /api/<resource>        list the caller's company's records
 *   GET    /api/<resource>/:id    one, 404 unless it is theirs
 *   POST   /api/<resource>        create, stamped with their company
 *   PATCH  /api/<resource>/:id    scoped update
 *   DELETE /api/<resource>/:id    scoped delete
 *
 * Generalised from the Loads endpoint once its shape had been proven in
 * production. Eleven copies of that file would have drifted, and the one that
 * drifted would have been the leak — so the resource list is data
 * (`resource-registry`) and the enforcement is code, in exactly one place.
 *
 * Everything the Loads endpoint guarantees holds here unchanged: the tenant
 * comes from the verified token, a payload carrying `companyId` is refused
 * rather than ignored, cross-tenant misses answer 404 with no detail, and no
 * AWS error text reaches the client.
 */
import { RecordNotFoundError, createTenantRepository } from "@/lib/server/tenant-repository";
import { ServerDataPrincipalMissingError } from "@/lib/server/server-dynamo";
import { requireCurrentTenantContext } from "@/lib/tenant/request-context";
import { logTenantDenial, tenantErrorResponse } from "@/lib/tenant/server-tenant-context";
import {
  COMPANY_INDEX,
  findResourceSpec,
  resourceTable,
  type ResourceSpec,
} from "@/lib/api/resource-registry";

/** Owned by the server. A request that tries to set one is refused. */
const SERVER_OWNED_FIELDS = ["companyId", "createdBy", "createdAt", "updatedAt"] as const;

const MAX_BODY_BYTES = 2_000_000;

type Entity = { createdAt: string; updatedAt: string; companyId?: string; createdBy?: string };

/** Built once per resource and reused — the spec never changes at runtime. */
const repositories = new Map<string, ReturnType<typeof createTenantRepository<Entity>>>();

function repositoryFor(spec: ResourceSpec) {
  const existing = repositories.get(spec.name);
  if (existing) return existing;
  const repo = createTenantRepository<Entity>({
    table: () => resourceTable(spec),
    idKey: spec.idKey as keyof Entity & string,
    label: spec.label,
    companyIndex: COMPANY_INDEX,
  });
  repositories.set(spec.name, repo);
  return repo;
}

/** `{ spec, id }` when the path addresses a registered resource. */
function parsePath(url: URL): { spec: ResourceSpec; id: string | null } | null {
  const segments = url.pathname.split("/").filter(Boolean);
  if (segments[0] !== "api" || segments.length < 2 || segments.length > 3) return null;
  const spec = findResourceSpec(segments[1]);
  if (!spec) return null;
  const id = segments[2] ? decodeURIComponent(segments[2]).trim() || null : null;
  return { spec, id };
}

export function isResourceApiRequest(url: URL): boolean {
  return parsePath(url) !== null;
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

function rejectServerOwnedFields(body: Record<string, unknown>): Response | null {
  const offending = SERVER_OWNED_FIELDS.filter((field) => field in body);
  if (offending.length === 0) return null;
  return jsonError(
    `These fields are set by the server and cannot be supplied: ${offending.join(", ")}.`,
    400,
    "server_owned_field",
  );
}

export async function handleResourceApiRequest(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const parsed = parsePath(url);
  if (!parsed) return jsonError("Not found.", 404, "not_found");

  const { spec, id } = parsed;
  const repo = repositoryFor(spec);

  let ctx;
  try {
    ctx = await requireCurrentTenantContext(request);
  } catch (err) {
    return tenantErrorResponse(err) ?? jsonError("Sign in required.", 401, "not_authenticated");
  }

  try {
    switch (request.method) {
      case "GET": {
        if (!id) return Response.json({ [spec.collectionKey]: await repo.list(ctx) });
        const record = await repo.get(ctx, id);
        if (!record) {
          logTenantDenial(ctx, `${spec.label} not found or not in company`, url.pathname);
          return jsonError(`${spec.label} not found.`, 404, "not_found");
        }
        return Response.json({ [spec.itemKey]: record });
      }

      case "POST": {
        if (id) return jsonError("Method not allowed.", 405);
        const body = await readBody(request);
        if (body instanceof Response) return body;
        const rejected = rejectServerOwnedFields(body);
        if (rejected) {
          logTenantDenial(ctx, "create carried server-owned fields", url.pathname);
          return rejected;
        }
        if (typeof body[spec.idKey] !== "string" || !(body[spec.idKey] as string).trim()) {
          return jsonError(`${spec.idKey} is required.`, 400, "invalid_payload");
        }
        const created = await repo.create(ctx, body as never);
        return Response.json({ [spec.itemKey]: created }, { status: 201 });
      }

      case "PATCH": {
        if (!id) return jsonError("Method not allowed.", 405);
        const body = await readBody(request);
        if (body instanceof Response) return body;
        const rejected = rejectServerOwnedFields(body);
        if (rejected) {
          logTenantDenial(ctx, "update carried server-owned fields", url.pathname);
          return rejected;
        }
        const updated = await repo.update(ctx, id, body as Partial<Entity>);
        return Response.json({ [spec.itemKey]: updated });
      }

      case "DELETE": {
        if (!id) return jsonError("Method not allowed.", 405);
        await repo.remove(ctx, id);
        return new Response(null, { status: 204 });
      }

      default:
        return jsonError("Method not allowed.", 405);
    }
  } catch (err) {
    if (err instanceof RecordNotFoundError) {
      logTenantDenial(ctx, "scoped operation matched no record", url.pathname);
      return jsonError(err.message, err.status, err.code);
    }
    if (err instanceof ServerDataPrincipalMissingError) {
      console.error(`[${spec.name}] data principal is not configured`);
      return jsonError("Server is not configured for data access.", 503, err.code);
    }
    // AWS messages carry table names and key values — the detail goes to the
    // log, the caller gets a status.
    console.error(`[${spec.name}] request failed`, err instanceof Error ? err.message : err);
    return jsonError("Could not complete that request.", 502, "error");
  }
}
