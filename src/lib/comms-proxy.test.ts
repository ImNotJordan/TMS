import { beforeEach, describe, expect, it, vi } from "vitest";

const requireCurrentTenantContext = vi.fn();

vi.mock("@/lib/tenant/request-context", () => ({
  requireCurrentTenantContext: (...a: unknown[]) => requireCurrentTenantContext(...a),
}));

const {
  handleCommsAgentDraftRequest,
  handleCommsTranslateRequest,
  handleCommsEmailSendRequest,
  handleCommsSmsSendRequest,
} = await import("@/lib/comms-proxy");

/** Bodies that pass each endpoint's schema, so a 400 cannot mask a 401. */
const VALID = {
  translate: { text: "hello", targetLang: "es", translatedBy: "agent" },
  agentDraft: {
    persona: "dispatcher",
    tone: "neutral",
    threadSummary: "s",
    latestInbound: "i",
    channel: "email",
  },
  // `link` is required — every outbound message must reference a load or a
  // contact, so it can be attributed later.
  sms: { to: "+15555550123", body: "hi", link: { loadId: "L-1" } },
  email: { to: "a@b.test", subject: "s", body: "b", link: { loadId: "L-1" } },
};

function post(path: string, body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(`https://example.test${path}`, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json", ...headers },
  });
}

function signedIn(userId = "user-1") {
  requireCurrentTenantContext.mockResolvedValue({
    userId,
    role: "Operations Manager",
    companyId: "acme",
    isTenantExempt: false,
    isPlatformAdmin: false,
    sessionEpoch: null,
  });
}

function signedOut() {
  requireCurrentTenantContext.mockRejectedValue(new Error("no token"));
}

beforeEach(() => {
  requireCurrentTenantContext.mockReset();
  signedIn();
});

describe("endpoints that were reachable without a token", () => {
  // Regression for the audit finding: both returned HTTP 200 to an
  // unauthenticated caller with a well-formed body. The schema ran first, so an
  // empty body answered 400 and looked superficially guarded.
  const cases = [
    ["translate", handleCommsTranslateRequest, "/api/comms/translate", VALID.translate],
    ["agent draft", handleCommsAgentDraftRequest, "/api/comms/agent/draft", VALID.agentDraft],
  ] as const;

  for (const [name, handler, path, body] of cases) {
    it(`${name} refuses an unauthenticated caller with a valid body`, async () => {
      signedOut();
      const res = await handler(post(path, body));
      expect(res.status).toBe(401);
    });

    it(`${name} checks the token before parsing the body`, async () => {
      // Otherwise the 400/401 ordering leaks whether a payload was well-formed,
      // and an anonymous caller reaches parsing at all.
      signedOut();
      const res = await handler(post(path, { nonsense: true }));
      expect(res.status).toBe(401);
    });

    it(`${name} serves an authenticated caller`, async () => {
      const res = await handler(post(path, body));
      expect(res.status).toBe(200);
    });
  }
});

describe("send endpoints keep their guard", () => {
  it("sms refuses an unauthenticated caller", async () => {
    signedOut();
    const res = await handleCommsSmsSendRequest(
      post("/api/comms/sms/send", VALID.sms, { "Idempotency-Key": "k1" }),
    );
    expect(res.status).toBe(401);
  });

  it("email refuses an unauthenticated caller", async () => {
    signedOut();
    const res = await handleCommsEmailSendRequest(
      post("/api/comms/email/send", VALID.email, { "Idempotency-Key": "k2" }),
    );
    expect(res.status).toBe(401);
  });

  it("a revoked session is refused, not just a missing token", async () => {
    // requireCurrentTenantContext also rejects a token issued before the user's
    // session epoch was bumped — which tryVerifiedIdClaims did not.
    requireCurrentTenantContext.mockRejectedValueOnce(
      Object.assign(new Error("stale"), { code: "SESSION_REVOKED", status: 401 }),
    );
    const res = await handleCommsSmsSendRequest(
      post("/api/comms/sms/send", VALID.sms, { "Idempotency-Key": "k3" }),
    );
    expect(res.status).toBe(401);
  });
});

describe("sending is authorized, not merely authenticated", () => {
  function signedInAs(overrides: Record<string, unknown>) {
    requireCurrentTenantContext.mockResolvedValue({
      userId: "user-1",
      role: "Operations Manager",
      companyId: "acme",
      isTenantExempt: false,
      isPlatformAdmin: false,
      sessionEpoch: null,
      ...overrides,
    });
  }

  const senders = [
    ["sms", handleCommsSmsSendRequest, "/api/comms/sms/send", VALID.sms],
    ["email", handleCommsEmailSendRequest, "/api/comms/email/send", VALID.email],
  ] as const;

  for (const [name, handler, path, body] of senders) {
    it(`${name} refuses a Driver`, async () => {
      // Messaging a customer from the company's number is not a driver
      // capability. They have the load conversation instead.
      signedInAs({ role: "Driver", isTenantExempt: true, companyId: null });
      const res = await handler(post(path, body, { "Idempotency-Key": `d-${name}` }));

      expect(res.status).toBe(403);
      await expect(res.json()).resolves.toMatchObject({ code: "forbidden" });
    });

    it(`${name} refuses a user with no company`, async () => {
      // You can only send as a company you belong to.
      signedInAs({ companyId: null });
      const res = await handler(post(path, body, { "Idempotency-Key": `n-${name}` }));

      expect(res.status).toBe(403);
      await expect(res.json()).resolves.toMatchObject({ code: "no_company_context" });
    });

    it(`${name} allows an ordinary company user`, async () => {
      signedInAs({});
      const res = await handler(post(path, body, { "Idempotency-Key": `ok-${name}` }));
      expect(res.status).toBe(200);
    });
  }

  it("checks authorization before spending the rate-limit budget", async () => {
    signedInAs({ role: "Driver", isTenantExempt: true, companyId: null });
    for (let i = 0; i < 40; i += 1) {
      const res = await handleCommsSmsSendRequest(
        post("/api/comms/sms/send", VALID.sms, { "Idempotency-Key": `burst-${i}` }),
      );
      // Never 429: a denied caller should not be able to consume anyone's
      // budget, including their own.
      expect(res.status).toBe(403);
    }
  });
});

describe("rate limiting follows the caller", () => {
  it("does not let one account exhaust another's budget", async () => {
    // Keyed on IP, two users behind one egress address throttled each other and
    // a single caller escaped by rotating addresses.
    const burst = async (userId: string) => {
      signedIn(userId);
      const results: number[] = [];
      // Past RATE_LIMIT (30/min) so the bucket actually trips.
      for (let i = 0; i < 34; i += 1) {
        const res = await handleCommsTranslateRequest(
          post("/api/comms/translate", VALID.translate),
        );
        results.push(res.status);
      }
      return results;
    };

    const first = await burst("heavy-user");
    expect(first).toContain(429);

    // A different account, same request source, still gets served.
    signedIn("quiet-user");
    const res = await handleCommsTranslateRequest(post("/api/comms/translate", VALID.translate));
    expect(res.status).toBe(200);
  });
});
