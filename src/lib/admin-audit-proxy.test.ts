import { beforeEach, describe, expect, it, vi } from "vitest";

const requireCurrentTenantContext = vi.fn();
const authorizeAdminRequest = vi.fn();
const dynamoSend = vi.fn();

vi.mock("@/lib/tenant/request-context", () => ({
  requireCurrentTenantContext: (...a: unknown[]) => requireCurrentTenantContext(...a),
}));
vi.mock("@/lib/ai/ai-authz", () => ({
  authorizeAdminRequest: (...a: unknown[]) => authorizeAdminRequest(...a),
}));
vi.mock("@/lib/ai/server-aws", () => ({
  getAiDynamoClient: async () => ({ send: (...a: unknown[]) => dynamoSend(...a) }),
  getProfileTable: () => "UsersTable",
}));

const { handleAdminAuditRequest, isAdminAuditRequest } = await import("@/lib/admin-audit-proxy");

const ME = "admin-1";

const get = (q = "") => new Request(`https://example.test/api/admin/audit${q}`);
const post = (body: unknown) =>
  new Request("https://example.test/api/admin/audit", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });

function signedIn(overrides: Record<string, unknown> = {}) {
  requireCurrentTenantContext.mockResolvedValue({
    userId: ME,
    role: "Admin",
    companyId: "acme",
    isTenantExempt: false,
    isPlatformAdmin: false,
    sessionEpoch: null,
    ...overrides,
  });
}

function sent(name: string) {
  return dynamoSend.mock.calls
    .map(([c]) => c as { constructor: { name: string }; input: Record<string, unknown> })
    .filter((c) => c.constructor.name === name);
}

beforeEach(() => {
  requireCurrentTenantContext.mockReset();
  authorizeAdminRequest.mockReset().mockResolvedValue({ ok: true });
  dynamoSend.mockReset().mockResolvedValue({ Items: [] });
  signedIn();
});

describe("routing", () => {
  it("claims GET and POST, and nothing that could delete", () => {
    expect(isAdminAuditRequest(new URL("https://x.test/api/admin/audit"), "GET")).toBe(true);
    expect(isAdminAuditRequest(new URL("https://x.test/api/admin/audit"), "POST")).toBe(true);
    expect(isAdminAuditRequest(new URL("https://x.test/api/admin/audit"), "DELETE")).toBe(false);
    expect(isAdminAuditRequest(new URL("https://x.test/api/admin/audit"), "PUT")).toBe(false);
  });
});

describe("entries are partitioned per company", () => {
  it("reads only the caller's company partition", async () => {
    await handleAdminAuditRequest(get());

    const partitions = sent("QueryCommand").map(
      (c) => (c.input.ExpressionAttributeValues as Record<string, string>)[":u"],
    );
    expect(partitions).toEqual(["ADMIN#audit#acme"]);
    // The shared legacy partition is another company's history too.
    expect(partitions).not.toContain("ADMIN#audit");
  });

  it("writes to the caller's company partition", async () => {
    dynamoSend.mockResolvedValue({});
    await handleAdminAuditRequest(post({ action: "Edit", record: "user-9" }));

    expect(sent("PutCommand")[0]?.input).toMatchObject({
      Item: { userId: "ADMIN#audit#acme" },
    });
  });

  it("lets a platform admin also see the legacy shared partition", async () => {
    signedIn({ isPlatformAdmin: true });
    await handleAdminAuditRequest(get());

    const partitions = sent("QueryCommand").map(
      (c) => (c.input.ExpressionAttributeValues as Record<string, string>)[":u"],
    );
    expect(partitions).toContain("ADMIN#audit#acme");
    expect(partitions).toContain("ADMIN#audit");
  });
});

describe("entries cannot be forged", () => {
  it("takes the actor id from the token and ignores the body", async () => {
    dynamoSend.mockResolvedValue({});
    await handleAdminAuditRequest(
      post({
        action: "Delete",
        record: "everything",
        actorUserId: "someone-else",
        actorName: "Someone Else",
        ip: "1.2.3.4",
      }),
    );

    const item = sent("PutCommand")[0]?.input.Item as Record<string, unknown>;
    const entry = item.data as Record<string, unknown>;
    expect(entry.actorUserId).toBe(ME);
    // The display name is allowed through; the identity is not.
    expect(entry.actorName).toBe("Someone Else");
    // IP is observed from the request, never taken from the body.
    expect(entry.ip).toBeNull();
    expect(entry.companyId).toBe("acme");
  });

  it("is append-only — a replayed id cannot overwrite an entry", async () => {
    dynamoSend.mockResolvedValue({});
    await handleAdminAuditRequest(post({ action: "Edit", record: "r" }));

    const input = sent("PutCommand")[0]?.input as {
      ConditionExpression?: string;
      ExpressionAttributeNames?: Record<string, string>;
    };

    expect(input.ConditionExpression).toContain("attribute_not_exists");

    // `section` is a DynamoDB reserved keyword. Referenced bare, the whole
    // write fails with ValidationException — which is what shipped, because the
    // earlier version of this test asserted the literal string I had written
    // rather than anything DynamoDB would accept. A mock cannot reject invalid
    // grammar, so the assertion has to.
    expect(input.ConditionExpression).not.toMatch(/\(\s*section\s*\)/);
    expect(input.ExpressionAttributeNames).toMatchObject({ "#section": "section" });
  });

  it("reports a duplicate rather than silently replacing", async () => {
    dynamoSend.mockImplementationOnce(async () => {
      throw Object.assign(new Error("exists"), { name: "ConditionalCheckFailedException" });
    });
    const res = await handleAdminAuditRequest(post({ action: "Edit", record: "r" }));
    expect(res.status).toBe(409);
  });
});

describe("access", () => {
  it("denies a non-admin", async () => {
    authorizeAdminRequest.mockResolvedValue({ ok: false, code: "forbidden" });
    const res = await handleAdminAuditRequest(get());

    expect(res.status).toBe(403);
    expect(dynamoSend).not.toHaveBeenCalled();
  });

  it("denies an unauthenticated caller", async () => {
    requireCurrentTenantContext.mockRejectedValueOnce(new Error("no token"));
    const res = await handleAdminAuditRequest(get());

    expect(res.status).toBe(401);
    expect(dynamoSend).not.toHaveBeenCalled();
  });

  it("requires action and record", async () => {
    const res = await handleAdminAuditRequest(post({ details: "no action" }));
    expect(res.status).toBe(400);
    expect(sent("PutCommand")).toHaveLength(0);
  });
});

describe("limits", () => {
  it("clamps an absurd limit rather than trusting it", async () => {
    dynamoSend.mockResolvedValue({
      Items: Array.from({ length: 10 }, (_, i) => ({
        section: `log-${i}`,
        data: { id: `log-${i}`, when: `2026-01-0${i % 9}` },
      })),
    });
    const res = await handleAdminAuditRequest(get("?limit=999999999"));
    const body = (await res.json()) as { entries: unknown[] };

    expect(res.status).toBe(200);
    expect(body.entries.length).toBeLessThanOrEqual(2000);
  });
});
