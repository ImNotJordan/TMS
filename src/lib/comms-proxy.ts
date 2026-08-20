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

import { requireCurrentTenantContext } from "@/lib/tenant/request-context";
import {
  logTenantDenial,
  tenantErrorResponse,
  type TenantContext,
} from "@/lib/tenant/server-tenant-context";
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
  /**
   * Per-company sending numbers, as JSON: `{"<companyId>": "+15555550123"}`.
   *
   * One shared number for every tenant means a recipient cannot tell which
   * company messaged them, and one tenant's spam complaints damage everyone
   * else's delivery reputation. Configure this and each company sends as
   * itself; leave it unset and the shared number is used, which is recorded on
   * every send so the exposure stays visible rather than implicit.
   */
  TWILIO_FROM_NUMBERS?: string;
  SENDGRID_API_KEY?: string;
  SENDGRID_FROM_EMAIL?: string;
  SENDGRID_FROM_EMAILS?: string;
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

/**
 * Authenticate the caller, or produce the response to send instead.
 *
 * `requireCurrentTenantContext` rather than `tryVerifiedIdClaims`: it verifies
 * the token *and* refuses one issued before the user's session was revoked. The
 * weaker check let a stale token keep working after a company reassignment.
 *
 * Drivers pass — they carry no company but do use messaging — so this asserts
 * identity, not tenancy. Per-endpoint authorization is separate and stricter.
 */
async function requireCaller(request: Request): Promise<TenantContext | Response> {
  try {
    return await requireCurrentTenantContext(request);
  } catch (err) {
    return (
      tenantErrorResponse(err) ??
      jsonError("Sign in required to use messaging.", 401, "not_authenticated")
    );
  }
}

/**
 * May this caller send outbound messages on a company's behalf?
 *
 * One rule rather than a role allowlist: **you may only send as a company you
 * belong to.** Drivers are tenant-exempt and carry no `companyId`, so this
 * denies them by construction — messaging a customer from the company's number
 * is not a driver capability, and no list has to be maintained to say so. A
 * user awaiting company assignment is denied for the same reason.
 *
 * Finer-grained control already exists in the `Communications` module
 * permissions (`rbac.ts`) if it is wanted later. It is deliberately not used as
 * the boundary here: those live in the Profile mirror, whereas the company
 * claim is signed into the token.
 */
function authorizeSender(ctx: TenantContext): Response | null {
  if (ctx.isTenantExempt) {
    logTenantDenial(ctx, "outbound message from a tenant-exempt role", "/api/comms");
    return jsonError(
      "Your role cannot send outbound messages. Use the load conversation instead.",
      403,
      "forbidden",
    );
  }
  if (!ctx.companyId) {
    logTenantDenial(ctx, "outbound message without a company", "/api/comms");
    return jsonError(
      "Your account has no company assigned, so it cannot send messages yet.",
      403,
      "no_company_context",
    );
  }
  return null;
}

/** Parse a `{ companyId: value }` JSON map from env, tolerating a bad value. */
function parseSenderMap(raw: string | undefined): Record<string, string> {
  if (!raw?.trim()) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as Record<string, string>;
  } catch {
    // Misconfiguration must not take messaging down; the shared fallback still
    // works and the warning says why the per-company identity was ignored.
    console.warn("[comms] sender map is not valid JSON — falling back to the shared identity");
    return {};
  }
}

/**
 * The sending identity for a company, and whether it is that company's own.
 *
 * `shared: true` means the message goes out under the default identity, which
 * is a real cross-tenant leak of a lesser kind: the recipient attributes it to
 * whoever else uses that number.
 */
function resolveSender(
  env: WorkerEnv,
  companyId: string,
  mapRaw: string | undefined,
  fallback: string | undefined,
): { identity?: string; shared: boolean } {
  const dedicated = parseSenderMap(mapRaw)[companyId]?.trim();
  if (dedicated) return { identity: dedicated, shared: false };
  return { identity: fallback?.trim(), shared: true };
}

function clientKey(request: Request): string {
  return (
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "anon"
  );
}

/**
 * Rate limit, keyed by caller when we know who they are.
 *
 * An IP key is close to useless for an authenticated endpoint: one caller
 * rotates addresses to escape it, and users behind a shared egress IP throttle
 * each other. `identity` is the account, so the budget follows the actor.
 */
function enforceRateLimit(request: Request, bucket: string, identity?: string): Response | null {
  const key = `${bucket}:${identity ?? clientKey(request)}`;
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
  from?: string,
): Promise<{ providerMessageId: string; status: string; mock?: boolean }> {
  const sid = env.TWILIO_ACCOUNT_SID?.trim();
  const token = env.TWILIO_AUTH_TOKEN?.trim();

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

  const payload = (await response.json().catch(() => null)) as {
    sid?: string;
    status?: string;
    message?: string;
    error_message?: string;
  } | null;

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
  const caller = await requireCaller(request);
  if (caller instanceof Response) return caller;

  const denied = authorizeSender(caller);
  if (denied) return denied;

  const limited = enforceRateLimit(request, "sms-send", caller.userId);
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
    const env = readEnv(request);
    const sender = resolveSender(
      env,
      caller.companyId!,
      env.TWILIO_FROM_NUMBERS,
      env.TWILIO_FROM_NUMBER,
    );
    if (sender.shared) {
      console.warn("[comms] sending under the shared number", {
        companyId: caller.companyId,
        hint: "set TWILIO_FROM_NUMBERS to give this company its own identity",
      });
    }

    const result = await sendViaTwilio(env, parsed.data.to, parsed.data.body, sender.identity);

    // Every outbound message is attributable. Recipient digits are truncated:
    // the audit needs to identify the send, not retain the contact.
    console.info("[audit] sms sent", {
      actor: caller.userId,
      actorRole: caller.role,
      companyId: caller.companyId,
      toSuffix: parsed.data.to.slice(-4),
      providerMessageId: result.providerMessageId,
      sharedSenderIdentity: sender.shared,
      at: new Date().toISOString(),
    });
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
  const caller = await requireCaller(request);
  if (caller instanceof Response) return caller;

  const denied = authorizeSender(caller);
  if (denied) return denied;

  const limited = enforceRateLimit(request, "email-send", caller.userId);
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
  // Same per-company identity as SMS: a shared From address means the recipient
  // cannot tell which company wrote to them, and one tenant's complaints hurt
  // everyone's deliverability.
  const sender = resolveSender(
    env,
    caller.companyId!,
    env.SENDGRID_FROM_EMAILS,
    env.SENDGRID_FROM_EMAIL,
  );
  const fromEmail = sender.identity ?? "noreply@example.com";
  if (sender.shared) {
    console.warn("[comms] sending under the shared email identity", {
      companyId: caller.companyId,
      hint: "set SENDGRID_FROM_EMAILS to give this company its own identity",
    });
  }

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
    response.headers.get("X-Message-Id") ??
    `SG_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`;
  idempotencyCache.set(idempotencyKey, {
    providerMessageId,
    status: "sent",
    at: Date.now(),
  });
  return Response.json({ providerMessageId, status: "sent" });
}

export async function handleCommsTranslateRequest(request: Request): Promise<Response> {
  // Was reachable with no token at all: the handler validated the body and did
  // the work, so an empty request answered 400 and a well-formed one answered
  // 200. Authentication belongs before rate limiting and before the schema —
  // an anonymous caller should never reach either.
  const caller = await requireCaller(request);
  if (caller instanceof Response) return caller;

  const limited = enforceRateLimit(request, "translate", caller.userId);
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
  // Same hole as translate, and a costlier one: this accepts 8 KB of thread
  // summary plus 4 KB of inbound text and is the endpoint a real model gets
  // wired into.
  const caller = await requireCaller(request);
  if (caller instanceof Response) return caller;

  const limited = enforceRateLimit(request, "agent-draft", caller.userId);
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
