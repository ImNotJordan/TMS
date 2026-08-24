import { beforeEach, describe, expect, it, vi } from "vitest";

const tryVerifiedIdClaims = vi.fn();
const send = vi.fn();

vi.mock("@/lib/ai/cognito-request-credentials", () => ({
  tryVerifiedIdClaims: (...args: unknown[]) => tryVerifiedIdClaims(...args),
}));

vi.mock("@/lib/ai/server-aws", () => ({
  getAiDynamoClient: async () => ({ send: (...args: unknown[]) => send(...args) }),
  getProfileTable: () => "Profile",
  getWorkspaceSettingsTable: () => "WorkspaceSettings",
  getAiDailyRequestBudget: () => 1000,
}));

const { authorizeAdminRequest, authorizeAiRequest } = await import("@/lib/ai/ai-authz");

/** Distinct sub per test — the module caches roles for 60s by sub. */
let counter = 0;
function request(): Request {
  counter += 1;
  tryVerifiedIdClaims.mockResolvedValue({ sub: `user-${counter}` });
  return new Request("https://example.test/api/settings/integrations/ai", { method: "POST" });
}

function roleIs(role: string | null) {
  send.mockResolvedValue(role ? { Item: { data: { role } } } : { Item: undefined });
}

beforeEach(() => {
  tryVerifiedIdClaims.mockReset();
  send.mockReset();
});

describe("authorizeAdminRequest", () => {
  it("allows privileged roles", async () => {
    for (const role of ["Organization Owner", "Admin", "SuperAdmin"]) {
      const req = request();
      roleIs(role);
      await expect(authorizeAdminRequest(req)).resolves.toMatchObject({ ok: true });
    }
  });

  it("denies ordinary staff roles", async () => {
    for (const role of ["Dispatcher", "Broker", "Sales", "Accounting", "Operations Manager"]) {
      const req = request();
      roleIs(role);
      await expect(authorizeAdminRequest(req)).resolves.toMatchObject({
        ok: false,
        code: "forbidden",
      });
    }
  });

  // The AI path allows a roleless user for setup DX. Settings writes touch a
  // company-scoped secret, so that grace must not extend here.
  it("denies a user with no role at all", async () => {
    const req = request();
    roleIs(null);
    await expect(authorizeAdminRequest(req)).resolves.toMatchObject({
      ok: false,
      code: "forbidden",
    });
  });

  it("denies an unauthenticated caller", async () => {
    tryVerifiedIdClaims.mockResolvedValue(null);
    const req = new Request("https://example.test/api/settings/integrations/ai");
    await expect(authorizeAdminRequest(req)).resolves.toMatchObject({
      ok: false,
      code: "not_authenticated",
    });
  });

  // A role lookup that cannot complete is a denial, not a pass.
  it("fails closed when the role lookup throws", async () => {
    const req = request();
    send.mockRejectedValue(new Error("Dynamo unavailable"));
    await expect(authorizeAdminRequest(req)).resolves.toMatchObject({
      ok: false,
      code: "forbidden",
    });
  });

  it("does not leak the role or subject in the denial message", async () => {
    const req = request();
    roleIs("Dispatcher");
    const result = await authorizeAdminRequest(req);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).not.toMatch(/Dispatcher|user-/);
    }
  });
});

describe("authorizeAiRequest", () => {
  it("allows an allowlisted role", async () => {
    const req = request();
    roleIs("Dispatcher");
    await expect(authorizeAiRequest(req)).resolves.toMatchObject({ ok: true });
  });

  it("denies a role off the allowlist", async () => {
    const req = request();
    roleIs("Driver");
    await expect(authorizeAiRequest(req)).resolves.toMatchObject({
      ok: false,
      code: "forbidden",
    });
  });

  it("allows a roleless user (documented setup-DX grace)", async () => {
    const req = request();
    roleIs(null);
    await expect(authorizeAiRequest(req)).resolves.toMatchObject({ ok: true });
  });

  it("fails closed when the role lookup throws", async () => {
    const req = request();
    send.mockRejectedValue(new Error("Dynamo unavailable"));
    await expect(authorizeAiRequest(req)).resolves.toMatchObject({ ok: false });
  });

  it("denies an unauthenticated caller", async () => {
    tryVerifiedIdClaims.mockResolvedValue(null);
    const req = new Request("https://example.test/api/ai/chat");
    await expect(authorizeAiRequest(req)).resolves.toMatchObject({
      ok: false,
      code: "not_authenticated",
    });
  });
});
