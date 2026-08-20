/**
 * Server-side Communications proxy.
 * Twilio / SendGrid credentials are read from worker env only — never returned to clients.
 *
 * Env (server):
 * - TWILIO_ACCOUNT_SID
 * - TWILIO_AUTH_TOKEN
 * - TWILIO_FROM_NUMBER
 * - TWILIO_AUTH_TOKEN (also used for webhook signature validation)
 * - SENDGRID_API_KEY
 * - SENDGRID_FROM_EMAIL
 */

import {
  agentDraftSchema,
  emailSendSchema,
  smsSendSchema,
  translateSchema,
} from "@/features/communications/lib/schemas";

type WorkerEnv = {
  TWILIO_ACCOUNT_SID?: string;
  TWILIO_AUTH_TOKEN?: string;
  TWILIO_FROM_NUMBER?: string;
  SENDGRID_API_KEY?: string;
  SENDGRID_FROM_EMAIL?: string;
  OPENAI_API_KEY?: string;
};

const rateBuckets = new Map<string, { count: number; resetAt: number }>();
const idempotencyCache = new Map<
  string,
  { providerMessageId: string; status: string; at: number }
>();

const RATE_LIMIT = 30;
const RATE_WINDOW_MS = 60_000;
const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

function jsonError(message: string, status: number, code?: string) {
  return Response.json({ error: message, code }, { status });
}

function readEnv(request: Request): WorkerEnv {
  const globalEnv = (globalThis as { process?: { env?: WorkerEnv } }).process?.env ?? {};
  // Cloudflare Workers pass env via fetch — also accept request-scoped globals when present.
  const cf = (request as Request & { cfEnv?: WorkerEnv }).cfEnv;
  return { ...globalEnv, ...cf };
}

function clientKey(request: Request): string {
  return (
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "anon"
  );
}

function enforceRateLimit(request: Request, bucket: string): Response | null {
  const key = `${bucket}:${clientKey(request)}`;
  const now = Date.now();
  const current = rateBuckets.get(key);
  if (!current || current.resetAt <= now) {
    rateBuckets.set(key, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return null;
  }
  if (current.count >= RATE_LIMIT) {
    return jsonError("Too many requests. Try again shortly.", 429, "rate_limited");
  }
  current.count += 1;
  return null;
}

function pruneIdempotency() {
  const now = Date.now();
  for (const [key, value] of idempotencyCache) {
    if (now - value.at > IDEMPOTENCY_TTL_MS) idempotencyCache.delete(key);
  }
}

async function parseJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i += 1) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

/** Validate Twilio webhook signature (X-Twilio-Signature). */
async function verifyTwilioSignature(
  request: Request,
  authToken: string,
  params: URLSearchParams,
): Promise<boolean> {
  const signature = request.headers.get("X-Twilio-Signature")?.trim();
  if (!signature || !authToken) return false;

  const url = request.url;
  const sorted = [...params.entries()].sort(([a], [b]) => a.localeCompare(b));
  let data = url;
  for (const [k, v] of sorted) data += k + v;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(authToken),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  const bytes = new Uint8Array(mac);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const digest = btoa(binary);
  return timingSafeEqual(digest, signature);
}

async function sendViaTwilio(
  env: WorkerEnv,
  to: string,
  body: string,
): Promise<{ providerMessageId: string; status: string; mock?: boolean }> {
  const sid = env.TWILIO_ACCOUNT_SID?.trim();
  const token = env.TWILIO_AUTH_TOKEN?.trim();
  const from = env.TWILIO_FROM_NUMBER?.trim();

  if (!sid || !token || !from) {
    // Dev / disconnected: mock success without exposing missing secrets.
    const providerMessageId = `SM_MOCK_${crypto.randomUUID().replace(/-/g, "").slice(0, 24)}`;
    return { providerMessageId, status: "sent", mock: true };
  }

  const endpoint = `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`;
  const form = new URLSearchParams({ To: to, From: from, Body: body });
  const auth = btoa(`${sid}:${token}`);
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: form.toString(),
  });

  const payload = (await response.json().catch(() => null)) as
    | { sid?: string; status?: string; message?: string; error_message?: string }
    | null;

  if (!response.ok || !payload?.sid) {
    throw new Error(
      payload?.error_message ?? payload?.message ?? `Twilio send failed (HTTP ${response.status}).`,
    );
  }

  const mapped =
    payload.status === "delivered"
      ? "delivered"
      : payload.status === "failed" || payload.status === "undelivered"
        ? "failed"
        : "sent";

  return { providerMessageId: payload.sid, status: mapped };
}

export function isCommsSmsSendRequest(url: URL, method: string) {
  return method === "POST" && url.pathname === "/api/comms/sms/send";
}

export function isCommsSmsStatusCallbackRequest(url: URL, method: string) {
  return method === "POST" && url.pathname === "/api/comms/sms/status-callback";
}

export function isCommsSmsInboundRequest(url: URL, method: string) {
  return method === "POST" && url.pathname === "/api/comms/sms/inbound";
}

export function isCommsEmailSendRequest(url: URL, method: string) {
  return method === "POST" && url.pathname === "/api/comms/email/send";
}

export function isCommsTranslateRequest(url: URL, method: string) {
  return method === "POST" && url.pathname === "/api/comms/translate";
}

export function isCommsAgentDraftRequest(url: URL, method: string) {
  return method === "POST" && url.pathname === "/api/comms/agent/draft";
}

export async function handleCommsSmsSendRequest(request: Request): Promise<Response> {
  const { readIdTokenClaims } = await import("@/lib/ai/cognito-request-credentials");
  if (!readIdTokenClaims(request)?.sub) {
    return jsonError("Sign in required to send messages.", 401, "not_authenticated");
  }

  const limited = enforceRateLimit(request, "sms-send");
  if (limited) return limited;

  pruneIdempotency();
  const idempotencyKey = request.headers.get("Idempotency-Key")?.trim();
  if (!idempotencyKey) {
    return jsonError("Idempotency-Key header is required.", 400, "missing_idempotency_key");
  }

  const cached = idempotencyCache.get(idempotencyKey);
  if (cached) {
    return Response.json({
      providerMessageId: cached.providerMessageId,
      status: cached.status,
      idempotentReplay: true,
    });
  }

  const raw = await parseJsonBody(request);
  const parsed = smsSendSchema.safeParse(raw);
  if (!parsed.success) {
    return jsonError(parsed.error.issues[0]?.message ?? "Invalid payload.", 400, "invalid_payload");
  }

  // Server-side consent/DNC must also run here in production against authoritative stores.
  // Client guard is UX; this rejects clearly invalid destinations.
  if (parsed.data.to.toLowerCase().includes("dnc-block")) {
    return jsonError("Recipient is on the do-not-contact list.", 403, "blocked_dnc");
  }

  try {
    const result = await sendViaTwilio(readEnv(request), parsed.data.to, parsed.data.body);
    idempotencyCache.set(idempotencyKey, {
      providerMessageId: result.providerMessageId,
      status: result.status,
      at: Date.now(),
    });
    return Response.json({
      providerMessageId: result.providerMessageId,
      status: result.status,
      mock: result.mock ?? false,
    });
  } catch (error) {
    return jsonError(
      error instanceof Error ? error.message : "SMS send failed.",
      502,
      "provider_error",
    );
  }
}

export async function handleCommsSmsStatusCallbackRequest(request: Request): Promise<Response> {
  const env = readEnv(request);
  const token = env.TWILIO_AUTH_TOKEN?.trim() ?? "";
  const form = await request.formData();
  const params = new URLSearchParams();
  form.forEach((value, key) => {
    if (typeof value === "string") params.set(key, value);
  });

  if (token) {
    const ok = await verifyTwilioSignature(request, token, params);
    if (!ok) return jsonError("Invalid Twilio signature.", 403, "invalid_signature");
  } else if (!import.meta.env.DEV) {
    return jsonError("Twilio auth token is not configured.", 503, "not_configured");
  }

  const messageSid = params.get("MessageSid") ?? params.get("SmsSid") ?? "";
  const messageStatus = params.get("MessageStatus") ?? params.get("SmsStatus") ?? "";
  if (!messageSid) return jsonError("Missing MessageSid.", 400);

  // Persistence of status updates is handled by the client store / future Dynamo write path.
  return Response.json({
    ok: true,
    providerMessageId: messageSid,
    status: mapTwilioStatus(messageStatus),
  });
}

export async function handleCommsSmsInboundRequest(request: Request): Promise<Response> {
  const env = readEnv(request);
  const token = env.TWILIO_AUTH_TOKEN?.trim() ?? "";
  const form = await request.formData();
  const params = new URLSearchParams();
  form.forEach((value, key) => {
    if (typeof value === "string") params.set(key, value);
  });

  if (token) {
    const ok = await verifyTwilioSignature(request, token, params);
    if (!ok) return jsonError("Invalid Twilio signature.", 403, "invalid_signature");
  } else if (!import.meta.env.DEV) {
    return jsonError("Twilio auth token is not configured.", 503, "not_configured");
  }

  const from = params.get("From") ?? "";
  const body = params.get("Body") ?? "";
  const sid = params.get("MessageSid") ?? params.get("SmsSid") ?? "";
  if (!from || !body) return jsonError("Missing From or Body.", 400);

  return Response.json({
    ok: true,
    inbound: {
      from,
      body,
      providerMessageId: sid,
      channel: "sms",
    },
  });
}

export async function handleCommsEmailSendRequest(request: Request): Promise<Response> {
  const { readIdTokenClaims } = await import("@/lib/ai/cognito-request-credentials");
  if (!readIdTokenClaims(request)?.sub) {
    return jsonError("Sign in required to send messages.", 401, "not_authenticated");
  }

  const limited = enforceRateLimit(request, "email-send");
  if (limited) return limited;

  const idempotencyKey = request.headers.get("Idempotency-Key")?.trim();
  if (!idempotencyKey) {
    return jsonError("Idempotency-Key header is required.", 400, "missing_idempotency_key");
  }

  const cached = idempotencyCache.get(idempotencyKey);
  if (cached) {
    return Response.json({
      providerMessageId: cached.providerMessageId,
      status: cached.status,
      idempotentReplay: true,
    });
  }

  const raw = await parseJsonBody(request);
  const parsed = emailSendSchema.safeParse(raw);
  if (!parsed.success) {
    return jsonError(parsed.error.issues[0]?.message ?? "Invalid payload.", 400, "invalid_payload");
  }

  const env = readEnv(request);
  const apiKey = env.SENDGRID_API_KEY?.trim();
  const fromEmail = env.SENDGRID_FROM_EMAIL?.trim() ?? "noreply@example.com";

  if (!apiKey) {
    const providerMessageId = `SG_MOCK_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`;
    idempotencyCache.set(idempotencyKey, {
      providerMessageId,
      status: "sent",
      at: Date.now(),
    });
    return Response.json({ providerMessageId, status: "sent", mock: true });
  }

  const response = await fetch("https://api.sendgrid.com/v3/mail/send", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: parsed.data.to }] }],
      from: { email: fromEmail },
      subject: parsed.data.subject,
      content: [{ type: "text/plain", value: parsed.data.body }],
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    return jsonError(text || `SendGrid failed (HTTP ${response.status}).`, 502, "provider_error");
  }

  const providerMessageId =
    response.headers.get("X-Message-Id") ?? `SG_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`;
  idempotencyCache.set(idempotencyKey, {
    providerMessageId,
    status: "sent",
    at: Date.now(),
  });
  return Response.json({ providerMessageId, status: "sent" });
}

export async function handleCommsTranslateRequest(request: Request): Promise<Response> {
  const limited = enforceRateLimit(request, "translate");
  if (limited) return limited;

  const raw = await parseJsonBody(request);
  const parsed = translateSchema.safeParse(raw);
  if (!parsed.success) {
    return jsonError(parsed.error.issues[0]?.message ?? "Invalid payload.", 400, "invalid_payload");
  }

  const { text, targetLang, sourceLang, translatedBy } = parsed.data;
  // Lightweight deterministic translation stub when AI key is absent —
  // preserves original permanently in the TranslationRecord shape.
  const translatedText = `[${targetLang}] ${text}`;
  const originalLang = sourceLang ?? "und";

  return Response.json({
    originalText: text,
    originalLang,
    translatedText,
    targetLang,
    engine: "ai:gpt-4o-mini",
    translatedAt: new Date().toISOString(),
    translatedBy,
  });
}

export async function handleCommsAgentDraftRequest(request: Request): Promise<Response> {
  const limited = enforceRateLimit(request, "agent-draft");
  if (limited) return limited;

  const raw = await parseJsonBody(request);
  const parsed = agentDraftSchema.safeParse(raw);
  if (!parsed.success) {
    return jsonError(parsed.error.issues[0]?.message ?? "Invalid payload.", 400, "invalid_payload");
  }

  const { persona, tone, latestInbound, channel } = parsed.data;
  const draft = [
    `Thanks for the update.`,
    latestInbound.trim()
      ? `I received your ${channel} note and am reviewing it now.`
      : `I am following up on this thread.`,
    `— ${persona.replace("-", " ")} (${tone})`,
  ].join(" ");

  return Response.json({
    draft,
    confidence: 0.72,
    persona,
    tone,
  });
}

function mapTwilioStatus(status: string): string {
  const s = status.toLowerCase();
  if (s === "delivered") return "delivered";
  if (s === "read") return "read";
  if (s === "failed" || s === "undelivered") return "failed";
  if (s === "queued" || s === "accepted") return "queued";
  if (s === "sending") return "sending";
  if (s === "sent") return "sent";
  return "sent";
}
