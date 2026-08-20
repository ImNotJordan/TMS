import { beforeEach, describe, expect, it, vi } from "vitest";

const requireVerifiedIdClaims = vi.fn();
const resolveRequestRole = vi.fn();

vi.mock("@/lib/ai/cognito-request-credentials", () => ({
  requireVerifiedIdClaims: (...a: unknown[]) => requireVerifiedIdClaims(...a),
}));
vi.mock("@/lib/ai/ai-authz", () => ({
  resolveRequestRole: (...a: unknown[]) => resolveRequestRole(...a),
}));

const { requireCurrentTenantContext } = await import("@/lib/tenant/request-context");
const { TenantForbiddenError } = await import("@/lib/tenant/server-tenant-context");

const ACME = "11111111-1111-4111-8111-111111111111";

function request(tokenEpoch?: string) {
  requireVerifiedIdClaims.mockResolvedValue({
    sub: "user-1",
    "custom:companyId": ACME,
    ...(tokenEpoch === undefined ? {} : { "custom:sessionEpoch": tokenEpoch }),
  });
  return new Request("https://example.test/api/loads");
}

function storedEpochIs(sessionEpoch: number | null) {
  resolveRequestRole.mockResolvedValue({
    ok: true,
    sub: "user-1",
    role: "Admin",
    sessionEpoch,
  });
}

beforeEach(() => {
  requireVerifiedIdClaims.mockReset();
  resolveRequestRole.mockReset();
});

describe("requireCurrentTenantContext", () => {
  it("returns the context when the session is current", async () => {
    const req = request("3");
    storedEpochIs(3);
    const ctx = await requireCurrentTenantContext(req);
    expect(ctx.companyId).toBe(ACME);
  });

  it("allows a token ahead of the stored epoch", async () => {
    const req = request("4");
    storedEpochIs(3);
    await expect(requireCurrentTenantContext(req)).resolves.toMatchObject({ companyId: ACME });
  });

  // The point of the whole mechanism: a token minted before the bump is dead,
  // even though Cognito still verifies its signature perfectly.
  it("rejects a token issued before the epoch was bumped", async () => {
    const req = request("2");
    storedEpochIs(3);
    await expect(requireCurrentTenantContext(req)).rejects.toBeInstanceOf(TenantForbiddenError);
  });

  it("rejects a token with no epoch once one is stored", async () => {
    const req = request(undefined);
    storedEpochIs(1);
    await expect(requireCurrentTenantContext(req)).rejects.toBeInstanceOf(TenantForbiddenError);
  });

  it("allows when no epoch has ever been stored", async () => {
    const req = request(undefined);
    storedEpochIs(null);
    await expect(requireCurrentTenantContext(req)).resolves.toMatchObject({ companyId: ACME });
  });

  // Not being able to establish the stored epoch is the same class of problem
  // as not being able to establish the role: a denial, not a pass.
  it("fails closed when the stored epoch cannot be resolved", async () => {
    const req = request("3");
    resolveRequestRole.mockResolvedValue({
      ok: false,
      code: "forbidden",
      message: "Could not verify your permissions. Try again shortly.",
    });
    await expect(requireCurrentTenantContext(req)).rejects.toBeInstanceOf(TenantForbiddenError);
  });
});
