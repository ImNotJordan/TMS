/**
 * The China tax API credential, stored and read server-side.
 *
 * Split into its own module rather than appended to `settings-proxy` for one
 * concrete reason: that file is on the tenant-guard allowlist because it speaks
 * DynamoDB, and every line added there widens what an exception covers. A second
 * small file with the same allowance is easier to review than one large file
 * whose exception has grown to include things nobody re-read.
 *
 * Mirrors the OpenAI writer field for field, including the two behaviours that
 * matter in practice:
 *
 * - an omitted `apiKey` leaves the stored one alone, so an admin can switch
 *   provider without re-entering a key they cannot read back;
 * - an explicit empty string clears it.
 */
import { GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";

import { authorizeAdminRequest } from "@/lib/ai/ai-authz";
import { getAiDynamoClient, getWorkspaceSettingsTable } from "@/lib/ai/server-aws";
import { CHINA_TAX_SECRET_SECTION, companySecretKey } from "@/lib/ai/settings-scopes";
import { requireSettingsCompany } from "@/lib/settings-tenant";

/** Same ceiling the OpenAI writer uses. Long enough for any real key. */
const MAX_KEY_LENGTH = 400;

const CHINA_TAX_PROVIDERS = new Set(["aliyun-market", "juhe", "custom"]);

export type ChinaTaxSecret = {
  provider?: string;
  apiKey?: string;
  endpoint?: string;
  enabled?: boolean;
  updatedAt?: string;
  updatedBy?: string;
};

export type ChinaTaxStatus = {
  connected: boolean;
  provider: string | null;
  endpoint: string | null;
  /** Last four characters — enough to identify, useless to reuse. */
  last4?: string;
  updatedAt?: string;
};

function jsonError(message: string, status: number, code?: string) {
  return Response.json({ error: message, code }, { status });
}

function maskKey(apiKey: string): string | undefined {
  const trimmed = apiKey.trim();
  if (trimmed.length < 4) return undefined;
  return trimmed.slice(-4);
}

export function isSettingsChinaTaxWriteRequest(url: URL, method: string): boolean {
  return method === "POST" && url.pathname === "/api/settings/integrations/china-tax";
}

export async function readChinaTaxSecret(
  request: Request,
  companyId: string,
): Promise<ChinaTaxSecret | null> {
  const client = await getAiDynamoClient(request);
  const out = (await client.send(
    new GetCommand({
      TableName: getWorkspaceSettingsTable(),
      Key: companySecretKey(companyId, CHINA_TAX_SECRET_SECTION),
    }) as never,
  )) as { Item?: { data?: ChinaTaxSecret } };
  return out.Item?.data ?? null;
}

/** Safe to hand to the browser: identifies the credential without exposing it. */
export function describeChinaTaxSecret(secret: ChinaTaxSecret | null): ChinaTaxStatus {
  const apiKey = secret?.apiKey?.trim() ?? "";
  return {
    connected: Boolean(apiKey) && secret?.enabled !== false,
    provider: secret?.provider ?? null,
    endpoint: secret?.endpoint ?? null,
    last4: maskKey(apiKey),
    updatedAt: secret?.updatedAt,
  };
}

type ChinaTaxWriteBody = {
  provider?: unknown;
  apiKey?: unknown;
  endpoint?: unknown;
  enabled?: unknown;
};

export async function handleSettingsChinaTaxWriteRequest(request: Request): Promise<Response> {
  const authz = await authorizeAdminRequest(request);
  if (!authz.ok) {
    return jsonError(authz.message, authz.code === "forbidden" ? 403 : 401, authz.code);
  }

  const tenant = await requireSettingsCompany(request);
  if (!tenant.ok) return tenant.response;
  const secretKey = companySecretKey(tenant.companyId, CHINA_TAX_SECRET_SECTION);

  let body: ChinaTaxWriteBody;
  try {
    body = (await request.json()) as ChinaTaxWriteBody;
  } catch {
    return jsonError("Invalid JSON body.", 400, "invalid_payload");
  }

  // Every attribute is aliased — `data` is a DynamoDB reserved word, and
  // aliasing the rest keeps a later field rename from colliding with one.
  const names: Record<string, string> = {
    "#data": "data",
    "#updatedAt": "updatedAt",
    "#updatedBy": "updatedBy",
  };
  const values: Record<string, unknown> = {
    ":now": new Date().toISOString(),
    ":by": authz.sub,
  };
  const sets: string[] = ["#data.#updatedAt = :now", "#data.#updatedBy = :by"];
  let changedFields = 0;

  if (body.provider !== undefined) {
    if (typeof body.provider !== "string" || !CHINA_TAX_PROVIDERS.has(body.provider.trim())) {
      return jsonError("Unsupported China tax provider.", 400, "invalid_payload");
    }
    names["#provider"] = "provider";
    values[":provider"] = body.provider.trim();
    sets.push("#data.#provider = :provider");
    changedFields += 1;
  }

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

  if (body.endpoint !== undefined) {
    if (typeof body.endpoint !== "string") {
      return jsonError("endpoint must be a string.", 400, "invalid_payload");
    }
    const endpoint = body.endpoint.trim();
    // Refused rather than coerced: an http endpoint would put a metered
    // credential on the wire in clear text.
    if (endpoint && !endpoint.toLowerCase().startsWith("https://")) {
      return jsonError("endpoint must be an https URL.", 400, "invalid_payload");
    }
    names["#endpoint"] = "endpoint";
    values[":endpoint"] = endpoint;
    sets.push("#data.#endpoint = :endpoint");
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
    // Two writes: create the map if absent, then set into it. A single
    // `SET #data.#apiKey` fails when `data` does not yet exist.
    await client.send(
      new UpdateCommand({
        TableName: getWorkspaceSettingsTable(),
        Key: secretKey,
        UpdateExpression: "SET #data = if_not_exists(#data, :empty)",
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

    // Field names only — never the values.
    console.info("[settings] China tax integration updated", {
      by: authz.sub,
      companyId: tenant.companyId,
      fields: Object.keys(body),
    });

    return Response.json({
      ok: true,
      chinaTax: describeChinaTaxSecret(await readChinaTaxSecret(request, tenant.companyId)),
    });
  } catch (err) {
    // Never echo the payload — it contains the key.
    console.error(
      "[settings] China tax integration write failed",
      err instanceof Error ? err.message : err,
    );
    return jsonError("Could not save the integration.", 502, "error");
  }
}
