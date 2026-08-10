import { fetchAuthSession } from "aws-amplify/auth";

import { DEFAULT_AI_MODEL, type AiChatMessage } from "@/lib/ai-proxy";
import { configureAmplify } from "@/lib/amplify";
import {
  ensureAiConnectionStatus,
  ensureIntegrationsConfigLoaded,
  isAiBiddingCopilotEnabled,
  readIntegrationsConfig,
} from "@/lib/integrations-config";

export type { AiChatMessage };

export type CallWorkspaceAiOptions = {
  /** Feature tag for server logs / debugging (e.g. content-studio, bidding). */
  feature: string;
  messages: AiChatMessage[];
  model?: string;
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
};

export type CallWorkspaceAiResult =
  | { status: "ok"; text: string; model: string }
  | { status: "not_configured"; message: string }
  | { status: "error"; message: string };

/** True when Settings → Integrations AI is enabled with a saved API key. */
export function isWorkspaceAiReady(): boolean {
  return isAiBiddingCopilotEnabled();
}

export function getWorkspaceAiModel(): string {
  const model = readIntegrationsConfig().ai.model?.trim();
  return model || DEFAULT_AI_MODEL;
}

async function cognitoAuthHeader(): Promise<Record<string, string>> {
  try {
    configureAmplify();
    const session = await fetchAuthSession();
    const token = session.tokens?.idToken?.toString();
    if (!token) return {};
    return { Authorization: `Bearer ${token}` };
  } catch {
    return {};
  }
}

/**
 * Shared OpenAI chat helper for product surfaces.
 *
 * Sends Cognito auth only. The workspace key is loaded server-side from the
 * `secrets` partition — there is no client-supplied-key path, because one let a
 * caller skip the role check, the rate limiter and the daily budget.
 */
export async function callWorkspaceAi(
  options: CallWorkspaceAiOptions,
): Promise<CallWorkspaceAiResult> {
  await ensureIntegrationsConfigLoaded();

  // Readiness is a server-side fact now: the key lives in the `secrets`
  // partition and the browser only learns whether one is installed.
  await ensureAiConnectionStatus();
  if (!isWorkspaceAiReady()) {
    return {
      status: "not_configured",
      message: "Configure an OpenAI API key in Settings → Integrations to use AI.",
    };
  }

  const auth = await cognitoAuthHeader();
  if (!auth.Authorization) {
    return {
      status: "error",
      message: "Sign in required to use workspace AI.",
    };
  }

  try {
    const headers: Record<string, string> = {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...auth,
    };

    const response = await fetch("/api/ai/chat", {
      method: "POST",
      signal: options.signal,
      headers,
      body: JSON.stringify({
        feature: options.feature,
        messages: options.messages,
        model: options.model ?? getWorkspaceAiModel(),
        temperature: options.temperature,
        maxTokens: options.maxTokens,
      }),
    });

    const body = (await response.json().catch(() => null)) as {
      ok?: boolean;
      text?: string;
      model?: string;
      error?: string;
      code?: string;
    } | null;

    if (!response.ok) {
      if (response.status === 409 || body?.code === "not_connected") {
        return {
          status: "not_configured",
          message: body?.error ?? "Configure an OpenAI API key in Settings → Integrations.",
        };
      }
      return {
        status: "error",
        message: body?.error ?? `AI request failed (HTTP ${response.status}).`,
      };
    }

    const text = body?.text?.trim() ?? "";
    if (!text) {
      return { status: "error", message: "AI returned an empty response." };
    }

    return {
      status: "ok",
      text,
      model: body?.model?.trim() || getWorkspaceAiModel(),
    };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      return { status: "error", message: "AI request cancelled." };
    }
    return {
      status: "error",
      message: error instanceof Error ? error.message : "Network error calling AI.",
    };
  }
}

/** Convenience: single user prompt with optional system instructions. */
export async function askWorkspaceAi(options: {
  feature: string;
  system?: string;
  prompt: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
}): Promise<CallWorkspaceAiResult> {
  const messages: AiChatMessage[] = [];
  if (options.system?.trim()) {
    messages.push({ role: "system", content: options.system.trim() });
  }
  messages.push({ role: "user", content: options.prompt.trim() });
  return callWorkspaceAi({
    feature: options.feature,
    messages,
    model: options.model,
    temperature: options.temperature,
    maxTokens: options.maxTokens,
    signal: options.signal,
  });
}
