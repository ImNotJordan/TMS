import { beforeEach, describe, expect, it, vi } from "vitest";

const requireCurrentTenantContext = vi.fn();
const authorizeAdminRequest = vi.fn();
const dynamoSend = vi.fn();
const adminCreateCognitoUser = vi.fn();
const adminResetCognitoPassword = vi.fn();
const resolveCognitoUsername = vi.fn();

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
vi.mock("@/lib/ai/server-cognito", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/ai/server-cognito")>("@/lib/ai/server-cognito");
  return {
    ...actual,
    getServerUserPoolId: () => "us-west-1_test",
    getServerCognitoClient: () => ({ send: vi.fn() }),
  };
});
vi.mock("@/lib/cognito-admin-core", () => ({
  adminCreateCognitoUser: (...a: unknown[]) => adminCreateCognitoUser(...a),
  adminResetCognitoPassword: (...a: unknown[]) => adminResetCognitoPassword(...a),
  resolveCognitoUsername: (...a: unknown[]) => resolveCognitoUsername(...a),
}));

const { handleAdminCredentialsRequest, isAdminCredentialsRequest } = await import(
  "@/lib/admin-credentials-proxy"
);

const ME = "admin-1";
const TARGET = "user-9";

const post = (body: unknown) =>
  new Request("https://example.test/api/admin/user-credentials", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });

function callerIs(overrides: Record<string, unknown> = {}) {
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

/** The target's stored company, as the Profile mirror would report it. */
function targetCompanyIs(company: string | null) {
  dynamoSend.mockReset();
  dynamoSend.mockResolvedValue(company ? { Item: { data: { companyId: company } } } : { Item: {} });
}

beforeEach(() => {
  requireCurrentTenantContext.mockReset();
  authorizeAdminRequest.mockReset().mockResolvedValue({ ok: true });
  dynamoSend.mockReset().mockResolvedValue({});
  adminCreateCognitoUser.mockReset().mockResolvedValue({ userId: "new-1", username: "new-1" });
  adminResetCognitoPassword
    .mockReset()
    .mockResolvedValue({ username: "u", emailed: true, method: "email-reset-code" });
  resolveCognitoUsername.mockReset().mockResolvedValue({ username: "u", sub: TARGET });
  callerIs();
});

describe("routing", () => {
  it("claims POST on its own path only", () => {
    expect(
      isAdminCredentialsRequest(new URL("https://x.test/api/admin/user-credentials"), "POST"),
    ).toBe(true);
    expect(
      isAdminCredentialsRequest(new URL("https://x.test/api/admin/user-credentials"), "GET"),
    ).toBe(false);
  });
});

describe("authorization", () => {
  it("denies an unauthenticated caller before reaching Cognito", async () => {
    requireCurrentTenantContext.mockRejectedValueOnce(new Error("no token"));
    const res = await handleAdminCredentialsRequest(post({ action: "create" }));

    expect(res.status).toBe(401);
    expect(adminCreateCognitoUser).not.toHaveBeenCalled();
  });

  it("denies a non-admin", async () => {
    authorizeAdminRequest.mockResolvedValueOnce({ ok: false, code: "forbidden" });
    const res = await handleAdminCredentialsRequest(
      post({ action: "reset-password", userId: TARGET }),
    );

    expect(res.status).toBe(403);
    expect(adminResetCognitoPassword).not.toHaveBeenCalled();
  });

  it("rejects an unknown action", async () => {
    const res = await handleAdminCredentialsRequest(post({ action: "delete-everything" }));
    expect(res.status).toBe(400);
  });
});

describe("password reset is scoped to the caller's company", () => {
  it("resets for a user in the same company", async () => {
    targetCompanyIs("acme");
    const res = await handleAdminCredentialsRequest(
      post({ action: "reset-password", userId: TARGET }),
    );

    expect(res.status).toBe(200);
    expect(adminResetCognitoPassword).toHaveBeenCalled();
  });

  it("404s for a user in another company, and resets nothing", async () => {
    targetCompanyIs("globex");
    const res = await handleAdminCredentialsRequest(
      post({ action: "reset-password", userId: TARGET }),
    );

    // Resetting a password for an account you do not administer is account
    // takeover. Opaque 404 so the endpoint cannot enumerate accounts either.
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toMatchObject({ error: "User not found." });
    expect(adminResetCognitoPassword).not.toHaveBeenCalled();
  });

  it("404s for a user with no company at all", async () => {
    targetCompanyIs(null);
    const res = await handleAdminCredentialsRequest(
      post({ action: "reset-password", userId: TARGET }),
    );

    expect(res.status).toBe(404);
    expect(adminResetCognitoPassword).not.toHaveBeenCalled();
  });

  it("applies the same rule to resend-invite", async () => {
    targetCompanyIs("globex");
    const res = await handleAdminCredentialsRequest(
      post({ action: "resend-invite", userId: TARGET }),
    );

    expect(res.status).toBe(404);
    expect(adminResetCognitoPassword).not.toHaveBeenCalled();
  });

  it("lets a platform admin cross companies", async () => {
    callerIs({ isPlatformAdmin: true });
    targetCompanyIs("globex");
    const res = await handleAdminCredentialsRequest(
      post({ action: "reset-password", userId: TARGET }),
    );

    expect(res.status).toBe(200);
  });

  it("requires a userId or an email", async () => {
    const res = await handleAdminCredentialsRequest(post({ action: "reset-password" }));
    expect(res.status).toBe(400);
    expect(resolveCognitoUsername).not.toHaveBeenCalled();
  });
});

describe("creation", () => {
  it("reports the caller's own company, never one from the body", async () => {
    const res = await handleAdminCredentialsRequest(
      post({
        action: "create",
        email: "New@Example.test",
        firstName: "New",
        lastName: "User",
        companyId: "globex",
      }),
    );

    expect(res.status).toBe(201);
    await expect(res.json()).resolves.toMatchObject({ companyId: "acme" });
  });

  it("normalises the email", async () => {
    await handleAdminCredentialsRequest(
      post({ action: "create", email: "  MiXeD@Example.test ", firstName: "A", lastName: "B" }),
    );

    expect(adminCreateCognitoUser).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ email: "mixed@example.test" }),
    );
  });

  it("refuses when the caller has no company to create into", async () => {
    callerIs({ companyId: null, isPlatformAdmin: false });
    const res = await handleAdminCredentialsRequest(
      post({ action: "create", email: "a@b.test", firstName: "A", lastName: "B" }),
    );

    expect(res.status).toBe(403);
    expect(adminCreateCognitoUser).not.toHaveBeenCalled();
  });

  it("requires the identifying fields", async () => {
    const res = await handleAdminCredentialsRequest(post({ action: "create", email: "a@b.test" }));
    expect(res.status).toBe(400);
    expect(adminCreateCognitoUser).not.toHaveBeenCalled();
  });

  it("maps a duplicate account to 409", async () => {
    adminCreateCognitoUser.mockRejectedValueOnce(
      Object.assign(new Error("exists"), { name: "UsernameExistsException" }),
    );
    const res = await handleAdminCredentialsRequest(
      post({ action: "create", email: "a@b.test", firstName: "A", lastName: "B" }),
    );

    expect(res.status).toBe(409);
  });
});
