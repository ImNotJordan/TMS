/**
 * Server-side workspace settings.
 *
 * ## Why this exists
 *
 * The OpenAI key used to live in `WorkspaceSettings` under the partition key
 * `global`, which every signed-in browser reads directly. That made a billable
 * third-party credential world-readable to anyone with an account.
 *
 * The key now lives under the **secrets** partition, sort key
 * `<companyId>#openai`. The partition split is load-bearing for IAM
 * (`dynamodb:LeadingKeys` cannot match a sort key). The company in the sort
 * key is load-bearing for tenancy: a single `secrets/openai` row was every
 * company's key.
 *
 * ## Write-only from the client
 *
 * An admin can set the key; nobody can read it back. Status responses carry
 * `connected` and the last four characters — enough to confirm which key is
 * installed, useless to an attacker.
 *
 * The Google Maps key stays browser-readable (the Maps JS SDK loads it in
 * the page) but is stored under that company's partition, not `global`.
 * HTTP-referrer restriction in Google Cloud still applies.
 */
import { GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";

import { authorizeAdminRequest } from "@/lib/ai/ai-authz";
import { getAiDynamoClient, getWorkspaceSettingsTable } from "@/lib/ai/server-aws";
import { invalidateOpenAiConfigCache } from "@/lib/ai/get-openai-key";
import {
  CHINA_TAX_SECRET_SECTION,
  OPENAI_SECRET_SECTION,
  SECRETS_SCOPE,
  companySecretKey,
} from "@/lib/ai/settings-scopes";
import { DEFAULT_AI_MODEL } from "@/lib/ai-proxy";
import {
  describeChinaTaxSecret as describeChinaTax,
  readChinaTaxSecret as readChinaTax,
} from "@/lib/settings-china-tax";
import {
  describeResendSecret as describeResend,
  readResendSecret as readResend,
} from "@/lib/settings-resend";
import { requireSettingsCompany } from "@/lib/settings-tenant";

export { CHINA_TAX_SECRET_SECTION, OPENAI_SECRET_SECTION, SECRETS_SCOPE };

const ALLOWED_MODELS = new Set(["gpt-4o-mini", "gpt-4o"]);
/** Generous upper bound — a real key is ~164 chars; this only stops abuse. */
const MAX_KEY_LENGTH = 512;

export type OpenAiSecret = {
  apiKey?: string;
  model?: string;
  enabled?: boolean;
  updatedAt?: string;
  updatedBy?: string;
};

export function isSettingsStatusRequest(url: URL, method: string) {
  return method === "GET" && url.pathname === "/api/settings/integrations/status";
}

export function isSettingsAiWriteRequest(url: URL, method: string) {
  return method === "POST" && url.pathname === "/api/settings/integrations/ai";
}

/**
 * The China tax credential lives in its own module. Re-exported here so the
 * status endpoint below can describe it without importing across the two.
 */
export {
  describeChinaTaxSecret,
  handleSettingsChinaTaxWriteRequest,
  isSettingsChinaTaxWriteRequest,
  readChinaTaxSecret,
} from "@/lib/settings-china-tax";

function jsonError(message: string, status: number, code?: string) {
  return Response.json({ error: message, code }, { status });
}

/** Last four characters only — enough to identify, useless to reuse. */
function maskKey(apiKey: string): string | undefined {
  const trimmed = apiKey.trim();
  if (trimmed.length < 4) return undefined;
  return trimmed.slice(-4);
}

export async function readOpenAiSecret(
  request: Request,
  companyId: string,
): Promise<OpenAiSecret | null> {
  const client = await getAiDynamoClient(request);
  const out = (await client.send(
    new GetCommand({
      TableName: getWorkspaceSettingsTable(),
      Key: companySecretKey(companyId, OPENAI_SECRET_SECTION),
    }) as never,
  )) as { Item?: { data?: OpenAiSecret } };
  return out.Item?.data ?? null;
}

/**
 * Integration status for the Settings UI. Authenticated but not admin-only —
 * ordinary users need to know whether AI is available. Carries no secret.
 */
export async function handleSettingsStatusRequest(request: Request): Promise<Response> {
  const { authorizeAiRequest } = await import("@/lib/ai/ai-authz");
  const authz = await authorizeAiRequest(request);
  if (!authz.ok) {
    return jsonError(authz.message, authz.code === "forbidden" ? 403 : 401, authz.code);
  }

  const tenant = await requireSettingsCompany(request);
  if (!tenant.ok) return tenant.response;

  try {
    const secret = await readOpenAiSecret(request, tenant.companyId);
    const apiKey = secret?.apiKey?.trim() ?? "";
    return Response.json({
      ai: {
        connected: Boolean(apiKey) && secret?.enabled !== false,
        model: secret?.model?.trim() || DEFAULT_AI_MODEL,
        last4: maskKey(apiKey),
        updatedAt: secret?.updatedAt,
      },
      chinaTax: describeChinaTax(await readChinaTax(request, tenant.companyId)),
      resend: describeResend(await readResend(request, tenant.companyId)),
    });
  } catch (err) {
    console.error("[settings] status read failed", err instanceof Error ? err.message : err);
    return jsonError("Could not load integration status.", 502, "error");
  }
}

type AiWriteBody = {
  apiKey?: unknown;
  model?: unknown;
  enabled?: unknown;
};

/**
 * Set or clear the workspace OpenAI key. Admin roles only.
 *
 * An omitted `apiKey` leaves the stored one alone, so an admin can change the
 * model without re-entering a key they cannot read back. An explicit empty
 * string clears it.
 */
export async function handleSettingsAiWriteRequest(request: Request): Promise<Response> {
  const authz = await authorizeAdminRequest(request);
  if (!authz.ok) {
    return jsonError(authz.message, authz.code === "forbidden" ? 403 : 401, authz.code);
  }

  const tenant = await requireSettingsCompany(request);
  if (!tenant.ok) return tenant.response;
  const secretKey = companySecretKey(tenant.companyId, OPENAI_SECRET_SECTION);

  let body: AiWriteBody;
  try {
    body = (await request.json()) as AiWriteBody;
  } catch {
    return jsonError("Invalid JSON body.", 400, "invalid_payload");
  }

  // Every attribute goes through ExpressionAttributeNames — `data` is a
  // DynamoDB reserved word, and aliasing the rest keeps a future field rename
  // from silently colliding with one.
  const names: Record<string, string> = { "#data": "data" };
  const values: Record<string, unknown> = {
    ":now": new Date().toISOString(),
    ":by": authz.sub,
  };
  const sets: string[] = ["#data.#updatedAt = :now", "#data.#updatedBy = :by"];
  names["#updatedAt"] = "updatedAt";
  names["#updatedBy"] = "updatedBy";
  let changedFields = 0;

  if (body.apiKey !== undefined) {
    if (typeof body.apiKey !== "string") {
      return jsonError("apiKey must be a string.", 400, "invalid_payload");
    }
    const apiKey = body.apiKey.trim();
    if (apiKey.length > MAX_KEY_LENGTH) {
      return jsonError("apiKey is too long.", 400, "invalid_payload");
    }
    names["#apiKey"] = "apiKey";
    values[":apiKey"] = apiKey;
    sets.push("#data.#apiKey = :apiKey");
    changedFields += 1;
  }

  if (body.model !== undefined) {
    if (typeof body.model !== "string" || !ALLOWED_MODELS.has(body.model.trim())) {
      return jsonError("Unsupported model.", 400, "invalid_payload");
    }
    names["#model"] = "model";
    values[":model"] = body.model.trim();
    sets.push("#data.#model = :model");
    changedFields += 1;
  }

  if (body.enabled !== undefined) {
    if (typeof body.enabled !== "boolean") {
      return jsonError("enabled must be a boolean.", 400, "invalid_payload");
    }
    names["#enabled"] = "enabled";
    values[":enabled"] = body.enabled;
    sets.push("#data.#enabled = :enabled");
    changedFields += 1;
  }

  if (changedFields === 0) {
    return jsonError("Nothing to update.", 400, "invalid_payload");
  }

  try {
    const client = await getAiDynamoClient(request);
    await client.send(
      new UpdateCommand({
        TableName: getWorkspaceSettingsTable(),
        Key: secretKey,
        UpdateExpression: `SET #data = if_not_exists(#data, :empty)`,
        ExpressionAttributeNames: { "#data": "data" },
        ExpressionAttributeValues: { ":empty": {} },
      }) as never,
    );
    await client.send(
      new UpdateCommand({
        TableName: getWorkspaceSettingsTable(),
        Key: secretKey,
        UpdateExpression: `SET ${sets.join(", ")}`,
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
      }) as never,
    );

    invalidateOpenAiConfigCache(tenant.companyId);
    // Field names only — never the values.
    console.info("[settings] OpenAI integration updated", {
      by: authz.sub,
      companyId: tenant.companyId,
      fields: Object.keys(body),
    });

    const secret = await readOpenAiSecret(request, tenant.companyId);
    const apiKey = secret?.apiKey?.trim() ?? "";
    return Response.json({
      ok: true,
      ai: {
        connected: Boolean(apiKey) && secret?.enabled !== false,
        model: secret?.model?.trim() || DEFAULT_AI_MODEL,
        last4: maskKey(apiKey),
        updatedAt: secret?.updatedAt,
      },
    });
  } catch (err) {
    // Never echo the payload — it contains the key.
    console.error(
      "[settings] OpenAI integration write failed",
      err instanceof Error ? err.message : err,
    );
    return jsonError("Could not save the integration.", 502, "error");
  }
}
