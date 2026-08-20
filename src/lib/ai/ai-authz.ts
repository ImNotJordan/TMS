import { GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";

import { readIdTokenClaims } from "@/lib/ai/cognito-request-credentials";
import {
  getAiDailyRequestBudget,
  getAiDynamoClient,
  getProfileTable,
  getWorkspaceSettingsTable,
} from "@/lib/ai/server-aws";
import { normalizeRole, type Role } from "@/lib/admin-user-constants";

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
};

const roleCache = new Map<string, { role: Role | null; expiresAt: number }>();
const ROLE_CACHE_TTL_MS = 60_000;

/**
 * Authorize AI use: valid Cognito ID token + role from Profile permissions
 * (when a role is set). Missing profile/role allows access for setup DX;
 * explicit non-allowed roles are denied.
 */
export async function authorizeAiRequest(request: Request): Promise<AiAuthzResult> {
  const claims = readIdTokenClaims(request);
  if (!claims?.sub) {
    return {
      ok: false,
      code: "not_authenticated",
      message: "Sign in to use Logistics AI.",
    };
  }

  const sub = claims.sub;
  const now = Date.now();
  const cached = roleCache.get(sub);
  if (cached && cached.expiresAt > now) {
    if (cached.role && !AI_ALLOWED_ROLES.has(cached.role)) {
      return {
        ok: false,
        code: "forbidden",
        message: "Your role is not permitted to use Logistics AI.",
      };
    }
    return { ok: true, sub, role: cached.role };
  }

  try {
    const client = await getAiDynamoClient(request);
    const out = (await (client as { send: (c: unknown) => Promise<{ Item?: { data?: PermissionsData } }> }).send(
      new GetCommand({
        TableName: getProfileTable(),
        Key: { userId: sub, section: "permissions" },
      }),
    )) as { Item?: { data?: PermissionsData } };

    const rawRole = out.Item?.data?.role;
    const role = rawRole ? normalizeRole(rawRole) : null;
    roleCache.set(sub, { role, expiresAt: now + ROLE_CACHE_TTL_MS });

    if (role && !AI_ALLOWED_ROLES.has(role)) {
      return {
        ok: false,
        code: "forbidden",
        message: "Your role is not permitted to use Logistics AI.",
      };
    }
    return { ok: true, sub, role };
  } catch (err) {
    console.warn(
      "[ai] role lookup failed; allowing authenticated user",
      err instanceof Error ? err.message : err,
    );
    roleCache.set(sub, { role: null, expiresAt: now + 15_000 });
    return { ok: true, sub, role: null };
  }
}

export type UsageMeterResult =
  | { ok: true; requests: number; budget: number }
  | { ok: false; requests: number; budget: number; message: string };

/** Soft daily org budget on shared OpenAI key (cross-instance via Dynamo). */
export async function consumeDailyAiBudget(
  request: Request,
  estimatedTokens = 0,
): Promise<UsageMeterResult> {
  const budget = getAiDailyRequestBudget();
  const day = new Date().toISOString().slice(0, 10);
  const section = `day:${day}`;

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
        message: "Daily Logistics AI budget reached. Try again tomorrow or raise TITAN_AI_DAILY_REQUEST_BUDGET.",
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
