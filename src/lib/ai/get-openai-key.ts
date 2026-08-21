import { GetCommand } from "@aws-sdk/lib-dynamodb";

import { DEFAULT_AI_MODEL } from "@/lib/ai-proxy";
import { ASSISTANT_CONFIG_CACHE_TTL_MS } from "@/lib/ai/assistant-limits";
import { authorizeAiRequest } from "@/lib/ai/ai-authz";
import {
  CognitoRequestAuthFailure,
  tryVerifiedIdClaims,
} from "@/lib/ai/cognito-request-credentials";
import { getAiDynamoClient, getWorkspaceSettingsTable } from "@/lib/ai/server-aws";
import { OPENAI_SECRET_SECTION, companySecretKey } from "@/lib/ai/settings-scopes";
import { COMPANY_ID_CLAIM } from "@/lib/tenant/server-tenant-context";

const ALLOWED_MODELS = new Set(["gpt-4o-mini", "gpt-4o"]);

export type ConnectedOpenAiConfig = {
  apiKey: string;
  model: string;
  enabled: boolean;
};

export type OpenAiConfigMiss =
  | { status: "not_authenticated"; message: string }
  | { status: "not_connected"; message: string }
  | { status: "forbidden"; message: string }
  | { status: "error"; message: string };

export type OpenAiConfigResult = ({ status: "ok" } & ConnectedOpenAiConfig) | OpenAiConfigMiss;

type ConfigCacheEntry = {
  result: OpenAiConfigResult;
  expiresAtMs: number;
};

/** Per-company hot cache. A single workspace cache was a cross-tenant leak. */
const integrationsCache = new Map<string, ConfigCacheEntry>();

function normalizeModel(raw: string | undefined): string {
  const model = (raw ?? "").trim() || DEFAULT_AI_MODEL;
  return ALLOWED_MODELS.has(model) ? model : DEFAULT_AI_MODEL;
}

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function getRow(
  request: Request,
  scope: string,
  section: string,
): Promise<Record<string, unknown> | null> {
  const client = await getAiDynamoClient(request);
  const out = (await withTimeout(
    (client as { send: (command: unknown) => Promise<{ Item?: { data?: unknown } }> }).send(
      new GetCommand({
        TableName: getWorkspaceSettingsTable(),
        Key: { scope, section },
      }),
    ),
    6_000,
    "DynamoDB GetItem",
  )) as { Item?: { data?: unknown } };

  const data = out.Item?.data;
  return data && typeof data === "object" ? (data as Record<string, unknown>) : null;
}

/**
 * Load this company's OpenAI key.
 *
 * Reads only `<companyId>#openai` under `secrets`. The unscoped `openai` row
 * and the browser-readable `global/integrations` row are leftover data — using
 * either as a fallback would give every tenant the first key that was ever
 * saved.
 */
async function loadIntegrationsFromDynamo(
  request: Request,
  companyId: string,
): Promise<OpenAiConfigResult> {
  const secretKey = companySecretKey(companyId, OPENAI_SECRET_SECTION);
  const secret = await getRow(request, secretKey.scope, secretKey.section);
  const apiKey = typeof secret?.apiKey === "string" ? secret.apiKey.trim() : "";
  const model = typeof secret?.model === "string" ? secret.model : undefined;
  const enabledFlag = secret?.enabled;

  // `enabled` defaults to true when a key is present — an admin who saved a key
  // meant to turn it on.
  const enabled = apiKey.length > 0 && enabledFlag !== false;

  if (!enabled || !apiKey) {
    return {
      status: "not_connected",
      message: "Connect your OpenAI key in Settings → Integrations to use Logistics AI.",
    };
  }

  return {
    status: "ok",
    apiKey,
    model: normalizeModel(model),
    enabled: true,
  };
}

/**
 * Load the workspace OpenAI key server-side. Requires a Cognito Bearer token.
 * Uses TITAN_AWS_* IAM when configured (no Identity Pool STS per request).
 */
export async function getConnectedOpenAiConfig(
  request: Request,
  options?: { bypassCache?: boolean; skipAuthz?: boolean },
): Promise<OpenAiConfigResult> {
  // Full signature + claim verification before Dynamo is touched.
  const claims = await tryVerifiedIdClaims(request);
  if (!claims?.sub) {
    return {
      status: "not_authenticated",
      message: "Sign in to use Logistics AI.",
    };
  }

  if (!options?.skipAuthz) {
    const authz = await authorizeAiRequest(request);
    if (!authz.ok) {
      return {
        status: authz.code === "forbidden" ? "forbidden" : "not_authenticated",
        message: authz.message,
      };
    }
  }

  const rawCompany = claims[COMPANY_ID_CLAIM];
  const companyId = typeof rawCompany === "string" ? rawCompany.trim() : "";
  if (!companyId) {
    return {
      status: "not_connected",
      message: "Connect your OpenAI key in Settings → Integrations to use Logistics AI.",
    };
  }

  const now = Date.now();
  const cached = integrationsCache.get(companyId);
  if (!options?.bypassCache && cached && cached.expiresAtMs > now) {
    return cached.result;
  }

  try {
    const result = await loadIntegrationsFromDynamo(request, companyId);
    if (result.status === "ok" || result.status === "not_connected") {
      integrationsCache.set(companyId, {
        result,
        expiresAtMs: now + ASSISTANT_CONFIG_CACHE_TTL_MS,
      });
    }
    return result;
  } catch (err) {
    if (err instanceof CognitoRequestAuthFailure) {
      if (err.code === "missing_token" || err.code === "expired_token") {
        return { status: "not_authenticated", message: "Sign in to use Logistics AI." };
      }
      return { status: "error", message: "Could not verify your session for Logistics AI." };
    }
    console.error("[ai] WorkspaceSettings read failed", err instanceof Error ? err.message : err);
    return {
      status: "error",
      message: "Could not load AI integration settings.",
    };
  }
}

export function invalidateOpenAiConfigCache(companyId?: string) {
  if (companyId?.trim()) {
    integrationsCache.delete(companyId.trim());
    return;
  }
  integrationsCache.clear();
}

/** Public status only — never includes the API key. */
export async function getOpenAiConnectionStatus(request: Request): Promise<{
  connected: boolean;
  model?: string;
  error?: string;
  code?: "not_authenticated" | "not_connected" | "forbidden" | "error";
}> {
  const url = new URL(request.url);
  const bypassCache = url.searchParams.get("fresh") === "1";
  const result = await getConnectedOpenAiConfig(request, { bypassCache });
  if (result.status === "ok") {
    return { connected: true, model: result.model };
  }
  return {
    connected: false,
    code: result.status,
    error: result.message,
  };
}

export function resolveAssistantModel(preferred: string | undefined, stored: string): string {
  void preferred;
  const candidate = stored.trim() || DEFAULT_AI_MODEL;
  return ALLOWED_MODELS.has(candidate) ? candidate : DEFAULT_AI_MODEL;
}
