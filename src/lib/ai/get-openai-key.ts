import { GetCommand } from "@aws-sdk/lib-dynamodb";

import { DEFAULT_AI_MODEL } from "@/lib/ai-proxy";
import { ASSISTANT_CONFIG_CACHE_TTL_MS } from "@/lib/ai/assistant-limits";
import { authorizeAiRequest } from "@/lib/ai/ai-authz";
import {
  CognitoRequestAuthFailure,
  assertValidIdToken,
  readBearerToken,
  readIdTokenClaims,
} from "@/lib/ai/cognito-request-credentials";
import { getAiDynamoClient, getWorkspaceSettingsTable } from "@/lib/ai/server-aws";
import { GLOBAL_SETTINGS_SCOPE } from "@/lib/workspace-settings-store";

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

export type OpenAiConfigResult =
  | ({ status: "ok" } & ConnectedOpenAiConfig)
  | OpenAiConfigMiss;

type IntegrationsRow = {
  data?: {
    ai?: {
      enabled?: boolean;
      apiKey?: string;
      model?: string;
    };
  };
};

type ConfigCacheEntry = {
  result: OpenAiConfigResult;
  expiresAtMs: number;
};

/** Workspace integrations are global — one hot cache avoids GetItem stampede. */
let integrationsCache: ConfigCacheEntry | null = null;

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

async function loadIntegrationsFromDynamo(request: Request): Promise<OpenAiConfigResult> {
  const client = await getAiDynamoClient(request);
  const table = getWorkspaceSettingsTable();

  const out = (await withTimeout(
    (client as { send: (command: unknown) => Promise<{ Item?: IntegrationsRow }> }).send(
      new GetCommand({
        TableName: table,
        Key: { scope: GLOBAL_SETTINGS_SCOPE, section: "integrations" },
      }),
    ),
    6_000,
    "DynamoDB GetItem",
  )) as { Item?: IntegrationsRow };

  const item = out.Item;
  const ai = item?.data?.ai;
  const apiKey = typeof ai?.apiKey === "string" ? ai.apiKey.trim() : "";
  const enabled = Boolean(ai?.enabled) && apiKey.length > 0;

  if (!enabled || !apiKey) {
    return {
      status: "not_connected",
      message: "Connect your OpenAI key in Settings → Integrations to use Logistics AI.",
    };
  }

  return {
    status: "ok",
    apiKey,
    model: normalizeModel(typeof ai?.model === "string" ? ai.model : undefined),
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
  const token = readBearerToken(request);
  if (!token) {
    return {
      status: "not_authenticated",
      message: "Sign in to use Logistics AI.",
    };
  }

  try {
    assertValidIdToken(token);
  } catch (err) {
    if (err instanceof CognitoRequestAuthFailure) {
      return {
        status: "not_authenticated",
        message: "Sign in to use Logistics AI.",
      };
    }
    throw err;
  }

  // Cheap claim check before Dynamo
  const claims = readIdTokenClaims(request);
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

  const now = Date.now();
  if (
    !options?.bypassCache &&
    integrationsCache &&
    integrationsCache.expiresAtMs > now
  ) {
    return integrationsCache.result;
  }

  try {
    const result = await loadIntegrationsFromDynamo(request);
    if (result.status === "ok" || result.status === "not_connected") {
      integrationsCache = {
        result,
        expiresAtMs: now + ASSISTANT_CONFIG_CACHE_TTL_MS,
      };
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

export function invalidateOpenAiConfigCache() {
  integrationsCache = null;
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
