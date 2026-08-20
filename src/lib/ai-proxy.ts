/**
 * Server-side OpenAI-compatible chat proxy.
 *
 * Chat always runs on the server-held workspace key, behind verified Cognito
 * auth, the role allowlist, the rate limiter and the daily budget. There is no
 * client-supplied-key path: it previously let a caller skip all four, and turned
 * this endpoint into a general-purpose relay to OpenAI with an arbitrary key.
 *
 * X-Titan-Ai-Key survives on `/api/ai/test` only, so Settings can validate a key
 * before saving it — and only for an authenticated, AI-authorized, rate-limited
 * caller.
 */

export const AI_API_KEY_HEADER = "X-Titan-Ai-Key";
export const DEFAULT_AI_MODEL = "gpt-4o-mini";
export const OPENAI_CHAT_URL = "https://api.openai.com/v1/chat/completions";
export const OPENAI_MODELS_URL = "https://api.openai.com/v1/models";

const MAX_MESSAGES = 24;
const MAX_CONTENT_CHARS = 12_000;
const MAX_TOTAL_CHARS = 40_000;

export type AiChatRole = "system" | "user" | "assistant";

export type AiChatMessage = {
  role: AiChatRole;
  content: string;
};

export type AiChatRequestBody = {
  messages: AiChatMessage[];
  model?: string;
  temperature?: number;
  maxTokens?: number;
  feature?: string;
};

export function isAiChatRequest(url: URL, method: string) {
  return method === "POST" && url.pathname === "/api/ai/chat";
}

export function isAiTestRequest(url: URL, method: string) {
  return method === "POST" && url.pathname === "/api/ai/test";
}

function jsonError(message: string, status: number, code?: string) {
  return Response.json({ error: message, code }, { status });
}

function readApiKey(request: Request): string {
  return request.headers.get(AI_API_KEY_HEADER)?.trim() ?? "";
}

function sanitizeMessages(raw: unknown): AiChatMessage[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_MESSAGES) return null;
  const out: AiChatMessage[] = [];
  let total = 0;
  for (const item of raw) {
    if (!item || typeof item !== "object") return null;
    const role = (item as { role?: unknown }).role;
    const content = (item as { content?: unknown }).content;
    if (role !== "system" && role !== "user" && role !== "assistant") return null;
    if (typeof content !== "string") return null;
    const trimmed = content.trim();
    if (!trimmed || trimmed.length > MAX_CONTENT_CHARS) return null;
    total += trimmed.length;
    if (total > MAX_TOTAL_CHARS) return null;
    out.push({ role, content: trimmed });
  }
  return out;
}

async function openAiErrorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as {
      error?: { message?: string; code?: string; type?: string };
    };
    const msg = body.error?.message?.trim();
    if (msg) return msg;
  } catch {
    // ignore
  }
  if (response.status === 401) return "Invalid OpenAI API key.";
  if (response.status === 429) return "OpenAI rate limit exceeded. Try again shortly.";
  return `OpenAI request failed (HTTP ${response.status}).`;
}

async function resolveWorkspaceApiKey(
  request: Request,
): Promise<
  | { ok: true; apiKey: string; model: string }
  | { ok: false; status: number; message: string; code?: string }
> {
  const { getConnectedOpenAiConfig } = await import("@/lib/ai/get-openai-key");
  const { enforceDistributedRateLimit } = await import("@/lib/ai/distributed-rate-limit");
  const { consumeDailyAiBudget } = await import("@/lib/ai/ai-authz");

  const limited = await enforceDistributedRateLimit(request, "workspace");
  if (!limited.ok) {
    return {
      ok: false,
      status: 429,
      message: "Too many AI requests. Try again shortly.",
      code: "rate_limited",
    };
  }

  const budget = await consumeDailyAiBudget(request, 600);
  if (!budget.ok) {
    return { ok: false, status: 429, message: budget.message, code: "rate_limited" };
  }

  const config = await getConnectedOpenAiConfig(request);
  if (config.status === "ok") {
    return { ok: true, apiKey: config.apiKey, model: config.model };
  }
  if (config.status === "not_authenticated") {
    return { ok: false, status: 401, message: config.message, code: config.status };
  }
  if (config.status === "forbidden") {
    return { ok: false, status: 403, message: config.message, code: config.status };
  }
  if (config.status === "not_connected") {
    return { ok: false, status: 409, message: config.message, code: config.status };
  }
  return { ok: false, status: 502, message: config.message, code: "error" };
}

export async function handleAiTestRequest(request: Request): Promise<Response> {
  // This route makes an outbound authenticated call using a caller-supplied
  // credential. Unauthenticated, that is a public oracle for validating stolen
  // OpenAI keys against our egress. Gate it exactly like the AI features it
  // configures: verified token, role allowlist, rate limit.
  const { authorizeAiRequest } = await import("@/lib/ai/ai-authz");
  const authz = await authorizeAiRequest(request);
  if (!authz.ok) {
    return jsonError(authz.message, authz.code === "forbidden" ? 403 : 401, authz.code);
  }

  const { enforceDistributedRateLimit } = await import("@/lib/ai/distributed-rate-limit");
  const limited = await enforceDistributedRateLimit(request, "status");
  if (!limited.ok) {
    return jsonError("Too many connection tests. Try again shortly.", 429, "rate_limited");
  }

  // A draft key from the Settings dialog is tested as supplied. With none, test
  // the stored key — the browser cannot read it to send it, so this is the
  // normal path once a key has been saved.
  let apiKey = readApiKey(request);
  if (!apiKey) {
    const { getConnectedOpenAiConfig } = await import("@/lib/ai/get-openai-key");
    const stored = await getConnectedOpenAiConfig(request, { skipAuthz: true });
    if (stored.status !== "ok") {
      return jsonError(
        "No OpenAI key is configured. Add one in Settings → Integrations.",
        409,
        "not_connected",
      );
    }
    apiKey = stored.apiKey;
  }

  try {
    const response = await fetch(`${OPENAI_MODELS_URL}?limit=1`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      return jsonError(await openAiErrorMessage(response), response.status === 401 ? 401 : 502);
    }

    return Response.json({
      ok: true,
      message:
        "OpenAI API key is valid. Workspace AI is ready across Bidding, RFPs, and Content Studio.",
      provider: "openai",
    });
  } catch (error) {
    return jsonError(
      error instanceof Error ? error.message : "Network error while testing OpenAI.",
      502,
    );
  }
}

export async function handleAiChatRequest(request: Request): Promise<Response> {
  const resolved = await resolveWorkspaceApiKey(request);
  if (!resolved.ok) {
    return jsonError(resolved.message, resolved.status, resolved.code);
  }

  let body: AiChatRequestBody;
  try {
    body = (await request.json()) as AiChatRequestBody;
  } catch {
    return jsonError("Invalid JSON body.", 400);
  }

  const messages = sanitizeMessages(body.messages);
  if (!messages) {
    return jsonError(`Provide 1–${MAX_MESSAGES} chat messages with non-empty string content.`, 400);
  }

  const allowed = new Set(["gpt-4o-mini", "gpt-4o"]);
  const requested =
    typeof body.model === "string" && body.model.trim() ? body.model.trim() : resolved.model;
  const model = allowed.has(requested) ? requested : resolved.model || DEFAULT_AI_MODEL;
  const temperature =
    typeof body.temperature === "number" && Number.isFinite(body.temperature)
      ? Math.min(1, Math.max(0, body.temperature))
      : 0.4;
  const maxTokens =
    typeof body.maxTokens === "number" && Number.isFinite(body.maxTokens)
      ? Math.min(1024, Math.max(64, Math.round(body.maxTokens)))
      : 800;

  try {
    const response = await fetch(OPENAI_CHAT_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resolved.apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        model,
        temperature,
        max_tokens: maxTokens,
        messages,
      }),
      signal: request.signal,
    });

    if (!response.ok) {
      return jsonError(await openAiErrorMessage(response), response.status === 401 ? 401 : 502);
    }

    const payload = (await response.json()) as {
      model?: string;
      choices?: { message?: { content?: string | null } }[];
    };
    const text = payload.choices?.[0]?.message?.content?.trim() ?? "";
    if (!text) {
      return jsonError("OpenAI returned an empty response.", 502);
    }

    return Response.json({
      ok: true,
      text,
      model: payload.model ?? model,
      feature: typeof body.feature === "string" ? body.feature : undefined,
    });
  } catch (error) {
    if (request.signal.aborted) {
      return jsonError("AI request cancelled.", 499 as number);
    }
    return jsonError(error instanceof Error ? error.message : "Network error calling OpenAI.", 502);
  }
}
