import type { UIMessage } from "ai";

/** Keep header chat cheap and bounded at scale. */
export const ASSISTANT_MAX_MESSAGES = 24;
export const ASSISTANT_MAX_CONTENT_CHARS = 8_000;
export const ASSISTANT_MAX_TOTAL_CHARS = 32_000;
export const ASSISTANT_MAX_OUTPUT_TOKENS = 1024;
export const ASSISTANT_DEFAULT_OUTPUT_TOKENS = 800;
export const ASSISTANT_MAX_BODY_BYTES = 256_000;
export const ASSISTANT_STATUS_LIMIT = 30; // /min per user
export const ASSISTANT_CHAT_LIMIT = 20; // /min per user
export const ASSISTANT_WINDOW_MS = 60_000;
export const ASSISTANT_MAX_IN_FLIGHT = 2;
export const ASSISTANT_CLIENT_HISTORY_CAP = 24;
export const ASSISTANT_INPUT_MAX_CHARS = 4_000;
export const ASSISTANT_STATUS_CLIENT_TTL_MS = 90_000;
export const ASSISTANT_CONFIG_CACHE_TTL_MS = 45_000;
export const ASSISTANT_CRED_CACHE_SKEW_MS = 60_000;

const PATHNAME_RE = /^\/[A-Za-z0-9/_-]{0,120}$/;

export function sanitizePathname(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > 120) return undefined;
  if (!PATHNAME_RE.test(trimmed)) return undefined;
  // Block obvious injection / control chars
  if (/[\r\n\0]/.test(trimmed)) return undefined;
  return trimmed;
}

export function sanitizeSummary(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim().slice(0, 500);
  if (!trimmed) return undefined;
  if (/[\0]/.test(trimmed)) return undefined;
  return trimmed;
}

function textFromUiMessage(message: UIMessage): string {
  if (!Array.isArray(message.parts)) return "";
  return message.parts
    .map((part) =>
      part && typeof part === "object" && "type" in part && part.type === "text" && "text" in part
        ? String((part as { text?: unknown }).text ?? "")
        : "",
    )
    .join("");
}

/**
 * Truncate oldest messages and clamp content so OpenAI spend stays bounded.
 * Returns null if nothing usable remains.
 */
export function sanitizeAssistantMessages(raw: unknown): UIMessage[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;

  const clipped = raw.slice(-ASSISTANT_MAX_MESSAGES) as UIMessage[];
  const out: UIMessage[] = [];
  let total = 0;

  for (const message of clipped) {
    if (!message || typeof message !== "object") continue;
    const role = (message as UIMessage).role;
    if (role !== "user" && role !== "assistant" && role !== "system") continue;

    const text = textFromUiMessage(message as UIMessage).trim();
    if (!text) continue;
    const clamped = text.slice(0, ASSISTANT_MAX_CONTENT_CHARS);
    total += clamped.length;
    if (total > ASSISTANT_MAX_TOTAL_CHARS) break;

    out.push({
      id:
        typeof (message as UIMessage).id === "string"
          ? (message as UIMessage).id
          : `msg-${out.length}`,
      role,
      parts: [{ type: "text", text: clamped }],
    } as UIMessage);
  }

  return out.length > 0 ? out : null;
}

export function clampOutputTokens(raw: unknown): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return ASSISTANT_DEFAULT_OUTPUT_TOKENS;
  return Math.min(ASSISTANT_MAX_OUTPUT_TOKENS, Math.max(64, Math.round(raw)));
}

export function clampTemperature(raw: unknown): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return 0.4;
  return Math.min(1, Math.max(0, raw));
}

/** Prefer cheaper model for header chat; gpt-4o only if explicitly stored. */
export function resolveHeaderChatModel(stored: string): string {
  if (stored === "gpt-4o" || stored === "gpt-4o-mini") return stored;
  return "gpt-4o-mini";
}

export function mapPublicAiError(error: unknown): string {
  if (error == null) return "Something went wrong generating a reply.";
  const msg = typeof error === "string" ? error : error instanceof Error ? error.message : "";
  if (/429|rate limit/i.test(msg)) {
    return "OpenAI rate limit reached. Wait a moment and try again.";
  }
  if (/401|incorrect api key|invalid.*key/i.test(msg)) {
    return "The connected OpenAI key looks invalid. Update it in Settings → Integrations.";
  }
  if (/timeout|aborted|AbortError/i.test(msg)) {
    return "The request timed out or was cancelled.";
  }
  return "Something went wrong generating a reply. Try again.";
}
