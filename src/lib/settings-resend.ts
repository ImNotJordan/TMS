/**
 * Resend API credential, stored and read server-side.
 *
 * Same contract as the OpenAI and China tax writers: the key lives under
 * `secrets` / `<companyId>#resend`, an omitted `apiKey` leaves the stored one
 * alone, and an empty string clears it. Status responses carry `connected` and
 * the last four characters — never the key.
 */
import { GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";

import { authorizeAdminRequest } from "@/lib/ai/ai-authz";
import { getAiDynamoClient, getWorkspaceSettingsTable } from "@/lib/ai/server-aws";
import { RESEND_SECRET_SECTION, companySecretKey } from "@/lib/ai/settings-scopes";
import { parseDigestEmails } from "@/lib/digest-emails";
import { sendResendEmail } from "@/lib/resend-mail";
import { getServerDataClient } from "@/lib/server/server-dynamo";
import { requireSettingsCompany } from "@/lib/settings-tenant";

const MAX_KEY_LENGTH = 400;
const MAX_FROM_LENGTH = 200;

export type ResendSecret = {
  apiKey?: string;
  fromEmail?: string;
  enabled?: boolean;
  updatedAt?: string;
  updatedBy?: string;
  /** Last successful 12-hour digest. Server-owned; the browser never writes it. */
  lastDigestAt?: string;
};

export type ResendStatus = {
  connected: boolean;
  fromEmail: string | null;
  last4?: string;
  updatedAt?: string;
  lastDigestAt?: string;
};

function jsonError(message: string, status: number, code?: string) {
  return Response.json({ error: message, code }, { status });
}

function maskKey(apiKey: string): string | undefined {
  const trimmed = apiKey.trim();
  if (trimmed.length < 4) return undefined;
  return trimmed.slice(-4);
}

export function isSettingsResendWriteRequest(url: URL, method: string): boolean {
  return method === "POST" && url.pathname === "/api/settings/integrations/resend";
}

export function describeResendSecret(secret: ResendSecret | null): ResendStatus {
  const apiKey = secret?.apiKey?.trim() ?? "";
  const fromEmail = secret?.fromEmail?.trim() || null;
  return {
    connected: Boolean(apiKey) && secret?.enabled !== false,
    fromEmail,
    last4: maskKey(apiKey),
    updatedAt: secret?.updatedAt,
    lastDigestAt: secret?.lastDigestAt,
  };
}

async function getSecret(
  client: { send: (command: unknown) => Promise<unknown> },
  companyId: string,
): Promise<ResendSecret | null> {
  const out = (await client.send(
    new GetCommand({
      TableName: getWorkspaceSettingsTable(),
      Key: companySecretKey(companyId, RESEND_SECRET_SECTION),
    }),
  )) as { Item?: { data?: ResendSecret } };
  return out.Item?.data ?? null;
}

export async function readResendSecret(
  request: Request,
  companyId: string,
): Promise<ResendSecret | null> {
  const client = await getAiDynamoClient(request);
  return getSecret(client, companyId);
}

/** Cron path — no caller token. Uses the server IAM principal. */
export async function readResendSecretForCompany(companyId: string): Promise<ResendSecret | null> {
  return getSecret(getServerDataClient(), companyId);
}

type ResendWriteBody = {
  apiKey?: unknown;
  fromEmail?: unknown;
  enabled?: unknown;
};

export async function handleSettingsResendWriteRequest(request: Request): Promise<Response> {
  const authz = await authorizeAdminRequest(request);
  if (!authz.ok) {
    return jsonError(authz.message, authz.code === "forbidden" ? 403 : 401, authz.code);
  }

  const tenant = await requireSettingsCompany(request);
  if (!tenant.ok) return tenant.response;
  const secretKey = companySecretKey(tenant.companyId, RESEND_SECRET_SECTION);

  let body: ResendWriteBody;
  try {
    body = (await request.json()) as ResendWriteBody;
  } catch {
    return jsonError("Invalid JSON body.", 400, "invalid_payload");
  }

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

  if (body.fromEmail !== undefined) {
    if (typeof body.fromEmail !== "string") {
      return jsonError("fromEmail must be a string.", 400, "invalid_payload");
    }
    const fromEmail = body.fromEmail.trim();
    if (fromEmail.length > MAX_FROM_LENGTH) {
      return jsonError("fromEmail is too long.", 400, "invalid_payload");
    }
    names["#fromEmail"] = "fromEmail";
    values[":fromEmail"] = fromEmail;
    sets.push("#data.#fromEmail = :fromEmail");
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

    console.info("[settings] Resend integration updated", {
      by: authz.sub,
      companyId: tenant.companyId,
      fields: Object.keys(body),
    });

    return Response.json({
      ok: true,
      resend: describeResendSecret(await readResendSecret(request, tenant.companyId)),
    });
  } catch (err) {
    console.error(
      "[settings] Resend integration write failed",
      err instanceof Error ? err.message : err,
    );
    return jsonError("Could not save the integration.", 502, "error");
  }
}

export function isSettingsResendTestRequest(url: URL, method: string): boolean {
  return method === "POST" && url.pathname === "/api/settings/integrations/resend/test";
}

/**
 * Send one test message to the Automations-tab recipients.
 *
 * Uses the stored key. A 400 that says "add recipients" is more useful than a
 * silent Resend success to nobody.
 */
export async function handleSettingsResendTestRequest(request: Request): Promise<Response> {
  const authz = await authorizeAdminRequest(request);
  if (!authz.ok) {
    return jsonError(authz.message, authz.code === "forbidden" ? 403 : 401, authz.code);
  }

  const tenant = await requireSettingsCompany(request);
  if (!tenant.ok) return tenant.response;

  const secret = await readResendSecret(request, tenant.companyId);
  const apiKey = secret?.apiKey?.trim() ?? "";
  const from = secret?.fromEmail?.trim() ?? "";
  if (!apiKey || secret?.enabled === false) {
    return jsonError("Connect Resend and save an API key first.", 400, "not_connected");
  }
  if (!from) {
    return jsonError(
      "Set a From address on the Resend card — it must be a domain you verified.",
      400,
      "missing_from",
    );
  }

  const settingsOut = (await (
    await getAiDynamoClient(request)
  ).send(
    new GetCommand({
      TableName: getWorkspaceSettingsTable(),
      Key: { scope: tenant.companyId, section: "appSettings" },
    }) as never,
  )) as { Item?: { data?: Record<string, unknown> } };
  const settings = settingsOut.Item?.data ?? {};
  const dedicated =
    typeof settings.driver_location_digest_email === "string"
      ? settings.driver_location_digest_email
      : "";
  const extra =
    typeof settings.driver_location_digest_cc === "string"
      ? settings.driver_location_digest_cc
      : "";
  const audience =
    typeof settings.automation_default_audience === "string"
      ? settings.automation_default_audience
      : "";
  const parsedDedicated = parseDigestEmails(dedicated, extra);
  const recipients = parsedDedicated.length ? parsedDedicated : parseDigestEmails(audience);
  if (recipients.length === 0) {
    return jsonError(
      "Add a recipient email on Settings → Automations (Resend recipient emails).",
      400,
      "no_recipients",
    );
  }

  const result = await sendResendEmail({
    apiKey,
    from,
    to: recipients,
    subject: "Titan Freight — Resend test",
    html: "<p>Resend is connected. The 12-hour driver location digest will use this key.</p>",
    text: "Resend is connected. The 12-hour driver location digest will use this key.",
  });
  if (!result.ok) {
    return jsonError(result.error, 502, "send_failed");
  }
  return Response.json({ ok: true });
}

export async function stampResendDigestAt(companyId: string, at: string): Promise<void> {
  const secretKey = companySecretKey(companyId, RESEND_SECRET_SECTION);
  const client = getServerDataClient();
  await client.send(
    new UpdateCommand({
      TableName: getWorkspaceSettingsTable(),
      Key: secretKey,
      UpdateExpression: "SET #data.#lastDigestAt = :at",
      ExpressionAttributeNames: { "#data": "data", "#lastDigestAt": "lastDigestAt" },
      ExpressionAttributeValues: { ":at": at },
    }),
  );
}
