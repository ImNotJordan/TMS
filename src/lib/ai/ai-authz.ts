import { GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";

import { tryVerifiedIdClaims } from "@/lib/ai/cognito-request-credentials";
import {
  getAiDailyRequestBudget,
  getAiDynamoClient,
  getProfileTable,
  getWorkspaceSettingsTable,
} from "@/lib/ai/server-aws";
import { strictRole } from "@/lib/tenant/strict-role";
import { COMPANY_ID_CLAIM } from "@/lib/tenant/server-tenant-context";
import type { Role } from "@/lib/admin-user-constants";

/** Roles allowed to use Logistics AI / workspace AI at scale. */
export const AI_ALLOWED_ROLES: ReadonlySet<Role> = new Set([
  "Organization Owner",
  "Admin",
  "SuperAdmin",
  "Operations Manager",
  "Broker",
  "Dispatcher",
  "Sales",
  "Marketing",
  "Accounting",
]);

export type AiAuthzResult =
  | { ok: true; sub: string; role: Role | null }
  | { ok: false; code: "not_authenticated" | "forbidden"; message: string };

type PermissionsData = {
  role?: string;
  /** Mirror of the Cognito `custom:sessionEpoch`, for cheap revocation checks. */
  sessionEpoch?: unknown;
  /** Per-module access matrix the admin console writes. See `resolveRequestRole`. */
  modulePermissions?: unknown;
  [key: string]: unknown;
};

const roleCache = new Map<
  string,
  {
    role: Role | null;
    sessionEpoch: number | null;
    permissions: PermissionsData | null;
    expiresAt: number;
  }
>();
/**
 * Also the revocation window: a bumped epoch takes effect within this long.
 * Short enough that removing someone from a company is measured in seconds,
 * long enough that the Profile lookup is not per-request.
 */
const ROLE_CACHE_TTL_MS = 60_000;

export type ResolvedRequestRole =
  | {
      ok: true;
      sub: string;
      role: Role | null;
      sessionEpoch: number | null;
      /**
       * The caller's whole stored `permissions` section, as written by the admin
       * console. Carried alongside the role because it comes off the same item
       * in the same read — a module gate that needed its own lookup would either
       * double the Dynamo traffic on every request or grow a second cache with
       * its own TTL to disagree with this one.
       *
       * Consumers should go through `checkModuleAccess` rather than reading the
       * matrix directly, so the server evaluates it with exactly the rules the
       * browser uses.
       */
      permissions: Record<string, unknown> | null;
    }
  | { ok: false; code: "not_authenticated" | "forbidden"; message: string };

function readStoredEpoch(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && /^\d+$/.test(value.trim())) return Number(value.trim());
  return null;
}

/**
 * Verified caller identity plus their stored role.
 *
 * The single place the server turns a request into "who is this and what are
 * they". Shared by every authorization check so the fail-closed behaviour below
 * cannot drift between them.
 *
 * Fails closed: a role lookup that cannot complete is a denial. The previous
 * version returned success here, so any transient Dynamo fault — or one an
 * attacker could induce — granted access to a caller whose role was never
 * established.
 */
export async function resolveRequestRole(request: Request): Promise<ResolvedRequestRole> {
  const claims = await tryVerifiedIdClaims(request);
  if (!claims?.sub) {
    return { ok: false, code: "not_authenticated", message: "Sign in to continue." };
  }

  const sub = claims.sub;
  const now = Date.now();
  const cached = roleCache.get(sub);
  if (cached && cached.expiresAt > now) {
    return {
      ok: true,
      sub,
      role: cached.role,
      sessionEpoch: cached.sessionEpoch,
      permissions: cached.permissions,
    };
  }

  try {
    const client = await getAiDynamoClient(request);
    const out = (await (
      client as { send: (c: unknown) => Promise<{ Item?: { data?: PermissionsData } }> }
    ).send(
      new GetCommand({
        TableName: getProfileTable(),
        Key: { userId: sub, section: "permissions" },
      }),
    )) as { Item?: { data?: PermissionsData } };

    // Strict: an unrecognized stored value is no role, not an inferred one.
    // `normalizeRole` maps anything containing "admin" to Admin and everything
    // else to Operations Manager — fine for a display label, not for deciding
    // who may write a shared secret.
    const role = strictRole(out.Item?.data?.role);
    const sessionEpoch = readStoredEpoch(out.Item?.data?.sessionEpoch);
    const permissions = out.Item?.data ?? null;
    roleCache.set(sub, {
      role,
      sessionEpoch,
      permissions,
      expiresAt: now + ROLE_CACHE_TTL_MS,
    });
    return { ok: true, sub, role, sessionEpoch, permissions };
  } catch (err) {
    console.error(
      "[authz] role lookup failed; denying request",
      err instanceof Error ? err.message : err,
    );
    // Not cached: a transient fault must not pin this user to denied for 60s.
    return {
      ok: false,
      code: "forbidden",
      message: "Could not verify your permissions. Try again shortly.",
    };
  }
}

/**
 * Authorize AI use: verified token + a role on the AI allowlist.
 *
 * A user with no role set is allowed — deliberate setup DX, and the cost of
 * being wrong is AI spend against a metered budget, not data disclosure.
 * Settings writes use `authorizeAdminRequest`, which does not extend that grace.
 */
export async function authorizeAiRequest(request: Request): Promise<AiAuthzResult> {
  const resolved = await resolveRequestRole(request);
  if (!resolved.ok) {
    return {
      ok: false,
      code: resolved.code,
      message:
        resolved.code === "not_authenticated" ? "Sign in to use Logistics AI." : resolved.message,
    };
  }

  if (resolved.role && !AI_ALLOWED_ROLES.has(resolved.role)) {
    return {
      ok: false,
      code: "forbidden",
      message: "Your role is not permitted to use Logistics AI.",
    };
  }
  return { ok: true, sub: resolved.sub, role: resolved.role };
}

/** Drop a cached role/epoch so a bump takes effect immediately for that user. */
export function invalidateCachedRole(sub: string) {
  roleCache.delete(sub);
}

/** Roles permitted to change workspace-wide settings and secrets. */
export const ADMIN_ROLES: ReadonlySet<Role> = new Set([
  "Organization Owner",
  "Admin",
  "SuperAdmin",
]);

/**
 * Authorize a workspace-settings write.
 *
 * Stricter than `authorizeAiRequest` in the way that matters: **no role is a
 * denial here**, not a grace. These endpoints write shared secrets, so the
 * "allow unknown roles for setup DX" trade-off does not apply.
 */
export async function authorizeAdminRequest(request: Request): Promise<AiAuthzResult> {
  const resolved = await resolveRequestRole(request);
  if (!resolved.ok) {
    return {
      ok: false,
      code: resolved.code,
      message:
        resolved.code === "not_authenticated"
          ? "Sign in to change workspace settings."
          : resolved.message,
    };
  }

  if (!resolved.role || !ADMIN_ROLES.has(resolved.role)) {
    console.warn("[authz] non-admin attempted a workspace settings write", {
      sub: resolved.sub,
      role: resolved.role ?? "(none)",
    });
    return {
      ok: false,
      code: "forbidden",
      message: "Only an administrator can change workspace settings.",
    };
  }
  return { ok: true, sub: resolved.sub, role: resolved.role };
}

export type UsageMeterResult =
  | { ok: true; requests: number; budget: number }
  | { ok: false; requests: number; budget: number; message: string };

/** Soft daily org budget on that company's OpenAI key (cross-instance via Dynamo). */
export async function consumeDailyAiBudget(
  request: Request,
  estimatedTokens = 0,
): Promise<UsageMeterResult> {
  const budget = getAiDailyRequestBudget();
  const day = new Date().toISOString().slice(0, 10);
  const claims = await tryVerifiedIdClaims(request);
  const companyId =
    typeof (claims as Record<string, unknown> | null)?.[COMPANY_ID_CLAIM] === "string"
      ? String((claims as Record<string, unknown>)[COMPANY_ID_CLAIM]).trim()
      : "";
  if (!companyId) {
    return {
      ok: false,
      requests: 0,
      budget,
      message: "This account is not assigned to a company.",
    };
  }
  const section = `${companyId}#day:${day}`;

  try {
    const client = await getAiDynamoClient(request);
    const table = getWorkspaceSettingsTable();

    const out = (await client.send(
      new UpdateCommand({
        TableName: table,
        Key: { scope: "ai-usage", section },
        UpdateExpression:
          "ADD requests :one, estimatedTokens :tokens SET updatedAt = :now, #day = :day",
        ConditionExpression: "attribute_not_exists(requests) OR requests < :budget",
        ExpressionAttributeNames: { "#day": "day" },
        ExpressionAttributeValues: {
          ":one": 1,
          ":tokens": Math.max(0, Math.floor(estimatedTokens)),
          ":now": new Date().toISOString(),
          ":day": day,
          ":budget": budget,
        },
        ReturnValues: "ALL_NEW",
      }) as never,
    )) as { Attributes?: { requests?: number } };

    const requests = Number(out.Attributes?.requests ?? 1);
    return { ok: true, requests, budget };
  } catch (err) {
    const name = err && typeof err === "object" ? (err as { name?: string }).name : undefined;
    if (name === "ConditionalCheckFailedException") {
      return {
        ok: false,
        requests: budget,
        budget,
        message:
          "Daily Logistics AI budget reached. Try again tomorrow or raise TITAN_AI_DAILY_REQUEST_BUDGET.",
      };
    }
    console.warn(
      "[ai] usage meter unavailable; allowing request",
      "AI_USAGE_METER_FAILED",
      err instanceof Error ? err.message : err,
    );
    return { ok: true, requests: 0, budget };
  }
}
