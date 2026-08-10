import { beforeEach, describe, expect, it, vi } from "vitest";

const requireVerifiedIdClaims = vi.fn();
vi.mock("@/lib/ai/cognito-request-credentials", () => ({
  requireVerifiedIdClaims: (...args: unknown[]) => requireVerifiedIdClaims(...args),
}));

const {
  MissingTenantError,
  TenantForbiddenError,
  assertSessionCurrent,
  buildTenantContext,
  requireCompanyId,
} = await import("@/lib/tenant/server-tenant-context");

const { strictRole, strictRoleFromGroups } = await import("@/lib/tenant/strict-role");

const ACME = "11111111-1111-4111-8111-111111111111";

function withClaims(claims: Record<string, unknown>) {
  requireVerifiedIdClaims.mockResolvedValue({ sub: "user-1", ...claims });
  return new Request("https://example.test/api/loads");
}

beforeEach(() => requireVerifiedIdClaims.mockReset());

describe("buildTenantContext", () => {
  it("derives companyId from the verified custom attribute", async () => {
    const ctx = await buildTenantContext(withClaims({ "custom:companyId": ACME }));
    expect(ctx.companyId).toBe(ACME);
    expect(ctx.userId).toBe("user-1");
  });

  it("prefers cognito:groups over a custom role attribute", async () => {
    const ctx = await buildTenantContext(
      withClaims({ "cognito:groups": ["Admin"], "custom:role": "driver" }),
    );
    expect(ctx.role).toBe("Admin");
  });

  it("resolves storage-key group names", async () => {
    const ctx = await buildTenantContext(withClaims({ "cognito:groups": ["organization_owner"] }));
    expect(ctx.role).toBe("Organization Owner");
  });

  it("marks drivers tenant-exempt", async () => {
    const ctx = await buildTenantContext(withClaims({ "cognito:groups": ["driver"] }));
    expect(ctx.isTenantExempt).toBe(true);
  });

  it("has no company when the attribute is absent", async () => {
    const ctx = await buildTenantContext(withClaims({}));
    expect(ctx.companyId).toBeNull();
    expect(ctx.role).toBeNull();
  });

  it("treats a blank attribute as absent", async () => {
    const ctx = await buildTenantContext(withClaims({ "custom:companyId": "   " }));
    expect(ctx.companyId).toBeNull();
  });

  it("reads a numeric sessionEpoch", async () => {
    const ctx = await buildTenantContext(withClaims({ "custom:sessionEpoch": "7" }));
    expect(ctx.sessionEpoch).toBe(7);
  });

  it("ignores a non-numeric sessionEpoch rather than coercing it", async () => {
    const ctx = await buildTenantContext(withClaims({ "custom:sessionEpoch": "not-a-number" }));
    expect(ctx.sessionEpoch).toBeNull();
  });
});

describe("requireCompanyId", () => {
  it("returns the company for an assigned user", async () => {
    const ctx = await buildTenantContext(withClaims({ "custom:companyId": ACME }));
    expect(requireCompanyId(ctx)).toBe(ACME);
  });

  it("throws COMPANY_ASSIGNMENT_REQUIRED when unassigned", async () => {
    const ctx = await buildTenantContext(withClaims({}));
    expect(() => requireCompanyId(ctx)).toThrow(MissingTenantError);
    expect(() => requireCompanyId(ctx)).toThrow(
      expect.objectContaining({ code: "COMPANY_ASSIGNMENT_REQUIRED" }),
    );
  });

  // "Exempt from the companyId rule" must not become "exempt from filtering".
  it("refuses a tenant-exempt role on a company-scoped path", async () => {
    const ctx = await buildTenantContext(
      withClaims({ "cognito:groups": ["driver"], "custom:companyId": ACME }),
    );
    expect(() => requireCompanyId(ctx)).toThrow(TenantForbiddenError);
  });
});

describe("assertSessionCurrent", () => {
  it("allows a current token", async () => {
    const ctx = await buildTenantContext(withClaims({ "custom:sessionEpoch": "3" }));
    expect(() => assertSessionCurrent(ctx, 3)).not.toThrow();
  });

  it("rejects a token issued before the epoch was bumped", async () => {
    const ctx = await buildTenantContext(withClaims({ "custom:sessionEpoch": "2" }));
    expect(() => assertSessionCurrent(ctx, 3)).toThrow(TenantForbiddenError);
  });

  // A token predating the feature carries no epoch — once one is stored, it is stale.
  it("rejects a token with no epoch once one is stored", async () => {
    const ctx = await buildTenantContext(withClaims({}));
    expect(() => assertSessionCurrent(ctx, 1)).toThrow(TenantForbiddenError);
  });

  it("allows when no epoch has ever been stored", async () => {
    const ctx = await buildTenantContext(withClaims({}));
    expect(() => assertSessionCurrent(ctx, null)).not.toThrow();
  });
});

describe("strictRole", () => {
  it("accepts canonical labels and storage keys", () => {
    expect(strictRole("Admin")).toBe("Admin");
    expect(strictRole("admin")).toBe("Admin");
    expect(strictRole("organization_owner")).toBe("Organization Owner");
    expect(strictRole("  DRIVER  ")).toBe("Driver");
  });

  // These are the values normalizeRole would have widened into a staff role.
  it("returns null rather than inferring a role", () => {
    expect(strictRole("everyone")).toBeNull();
    expect(strictRole("readonly-admin")).toBeNull();
    expect(strictRole("company-admins")).toBeNull();
    expect(strictRole("")).toBeNull();
    expect(strictRole(undefined)).toBeNull();
    expect(strictRole(null)).toBeNull();
    expect(strictRole({ role: "Admin" })).toBeNull();
  });

  it("finds the first recognized group and ignores the rest", () => {
    expect(strictRoleFromGroups(["everyone", "us-east-1_pool", "Dispatcher"])).toBe("Dispatcher");
    expect(strictRoleFromGroups(["everyone"])).toBeNull();
    expect(strictRoleFromGroups("Admin")).toBeNull();
    expect(strictRoleFromGroups(undefined)).toBeNull();
  });
});
