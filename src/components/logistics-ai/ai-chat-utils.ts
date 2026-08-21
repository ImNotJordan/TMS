import { fetchAuthSession } from "aws-amplify/auth";
import type { UIMessage } from "ai";

import {
  ASSISTANT_CLIENT_HISTORY_CAP,
  ASSISTANT_INPUT_MAX_CHARS,
  ASSISTANT_STATUS_CLIENT_TTL_MS,
} from "@/lib/ai/assistant-limits";
import { configureAmplify } from "@/lib/amplify";

export const LOGISTICS_AI_STATUS_EVENT = "titan:logistics-ai-status";

export type LogisticsAiStatus = {
  connected: boolean;
  model?: string;
  code?: "not_authenticated" | "not_connected" | "error" | "rate_limited";
  error?: string;
};

let statusCache: { value: LogisticsAiStatus; expiresAt: number } | null = null;

export async function getCognitoIdToken(): Promise<string | null> {
  try {
    configureAmplify();
    const session = await fetchAuthSession();
    return session.tokens?.idToken?.toString() ?? null;
  } catch {
    return null;
  }
}

export async function authHeaders(): Promise<Record<string, string>> {
  const token = await getCognitoIdToken();
  if (!token) return {};
  return { Authorization: `Bearer ${token}` };
}

export function invalidateLogisticsAiStatusCache() {
  statusCache = null;
}

export async function fetchLogisticsAiStatus(options?: {
  force?: boolean;
}): Promise<LogisticsAiStatus> {
  const now = Date.now();
  if (!options?.force && statusCache && statusCache.expiresAt > now) {
    return statusCache.value;
  }

  const headers = await authHeaders();
  if (!headers.Authorization) {
    const value: LogisticsAiStatus = {
      connected: false,
      code: "not_authenticated",
      error: "Sign in required.",
    };
    statusCache = { value, expiresAt: now + 15_000 };
    return value;
  }

  try {
    const response = await fetch(options?.force ? "/api/ai/status?fresh=1" : "/api/ai/status", {
      method: "GET",
      headers: {
        Accept: "application/json",
        ...headers,
      },
    });
    const payload = (await response.json().catch(() => ({}))) as LogisticsAiStatus & {
      error?: string;
      code?: LogisticsAiStatus["code"];
    };
    const value: LogisticsAiStatus = !response.ok
      ? {
          connected: false,
          code:
            payload.code ??
            (response.status === 429
              ? "rate_limited"
              : response.status === 401
                ? "not_authenticated"
                : "error"),
          error: payload.error ?? "Could not check AI connection.",
        }
      : {
          connected: Boolean(payload.connected),
          model: payload.model,
          code: payload.code,
          error: payload.error,
        };

    statusCache = {
      value,
      expiresAt: now + (response.status === 429 ? 20_000 : ASSISTANT_STATUS_CLIENT_TTL_MS),
    };
    return value;
  } catch {
    const value: LogisticsAiStatus = {
      connected: false,
      code: "error",
      error: "Network error checking AI status.",
    };
    statusCache = { value, expiresAt: now + 20_000 };
    return value;
  }
}

export function storageKeyForUser(userId: string) {
  return `titan-freight:logistics-ai:${userId || "_"}`;
}

function trimMessages(messages: UIMessage[]): UIMessage[] {
  return messages.slice(-ASSISTANT_CLIENT_HISTORY_CAP);
}

export function loadPersistedMessages(userId: string): UIMessage[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(storageKeyForUser(userId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return trimMessages(parsed as UIMessage[]);
  } catch {
    return [];
  }
}

export function persistMessages(userId: string, messages: UIMessage[]) {
  if (typeof window === "undefined") return;
  try {
    const trimmed = trimMessages(messages);
    localStorage.setItem(storageKeyForUser(userId), JSON.stringify(trimmed));
  } catch {
    try {
      localStorage.removeItem(storageKeyForUser(userId));
    } catch {
      // ignore
    }
  }
}

export function clearPersistedMessages(userId: string) {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(storageKeyForUser(userId));
  } catch {
    // ignore
  }
}

export function messageText(message: UIMessage): string {
  return message.parts
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("")
    .trim();
}

export function clampComposerInput(value: string): string {
  if (value.length <= ASSISTANT_INPUT_MAX_CHARS) return value;
  return value.slice(0, ASSISTANT_INPUT_MAX_CHARS);
}

export function friendlyChatError(error: unknown): {
  title: string;
  detail: string;
  kind: "not_connected" | "rate_limit" | "invalid_key" | "network" | "generic";
} {
  const raw =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "Something went wrong.";

  if (/409|not_connected|Connect your OpenAI key/i.test(raw)) {
    return {
      kind: "not_connected",
      title: "OpenAI key not connected",
      detail: "Connect your OpenAI key in Settings → Integrations to use Logistics AI.",
    };
  }
  if (/403|forbidden|not permitted/i.test(raw)) {
    return {
      kind: "generic",
      title: "Access denied",
      detail: "Your role is not permitted to use Logistics AI.",
    };
  }
  if (/429|rate limit|Too many Logistics AI|budget/i.test(raw)) {
    return {
      kind: "rate_limit",
      title: "Rate limit reached",
      detail: "Too many requests. Wait a moment, then retry.",
    };
  }
  if (/401|invalid.*key|incorrect api key/i.test(raw)) {
    return {
      kind: "invalid_key",
      title: "Invalid API key",
      detail: "The connected OpenAI key looks invalid. Update it in Settings → Integrations.",
    };
  }
  if (/Failed to fetch|NetworkError|network/i.test(raw)) {
    return {
      kind: "network",
      title: "Network error",
      detail: "Could not reach Logistics AI. Check your connection and try again.",
    };
  }
  return {
    kind: "generic",
    title: "Couldn’t complete that reply",
    detail: "Something went wrong. Try again.",
  };
}

export const SUGGESTED_PROMPTS = [
  "Summarize today's shipments",
  "Draft a delay-notice email",
  "Explain this delivery exception",
  "Optimize this route stop order",
] as const;

export { ASSISTANT_INPUT_MAX_CHARS, ASSISTANT_CLIENT_HISTORY_CAP };
