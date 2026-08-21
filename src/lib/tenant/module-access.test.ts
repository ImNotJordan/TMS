import { beforeEach, describe, expect, it, vi } from "vitest";

const resolveRequestRole = vi.fn();

vi.mock("@/lib/ai/ai-authz", () => ({
  resolveRequestRole: (...a: unknown[]) => resolveRequestRole(...a),
}));

const { checkModuleAccess, hasFieldPermission } = await import("@/lib/tenant/module-access");

import type { TenantContext } from "@/lib/tenant/server-tenant-context";
import {
  buildDefaultModulePermissions,
  type ModuleName,
  type PermissionLevel,
  type Role,
} from "@/lib/admin-user-constants";

const request = new Request("https://example.test/api/inventory/items");

function ctx(overrides: Partial<TenantContext> = {}): TenantContext {
  return {
    userId: "user-1",
    role: "Dispatcher",
    companyId: "company-1",
    isTenantExempt: false,
    isPlatformAdmin: false,
    sessionEpoch: null,
    ...overrides,
  };
}

/** A matrix granting exactly the named levels on the named module, nothing else. */
function matrixGranting(moduleName: ModuleName, levels: PermissionLevel[]) {
  const matrix = buildDefaultModulePermissions();
  matrix[moduleName]["No Access"] = levels.length === 0;
  for (const level of levels) matrix[moduleName][level] = true;
  return matrix;
}

function resolved(permissions: Record<string, unknown> | null, role: Role | null = "Dispatcher") {
  resolveRequestRole.mockResolvedValue({
    ok: true,
    sub: "user-1",
    role,
    sessionEpoch: null,
    permissions,
  });
}

beforeEach(() => {
  resolveRequestRole.mockReset();
});

describe("checkModuleAccess", () => {
  it("allows a module the matrix grants for viewing", async () => {
    resolved({ modulePermissions: matrixGranting("Inventory", ["View Only"]) });
    await expect(checkModuleAccess(request, ctx(), "Inventory", "view")).resolves.toEqual({
      ok: true,
    });
  });

  it("refuses writing to a module granted only for viewing", async () => {
    resolved({ modulePermissions: matrixGranting("Inventory", ["View Only"]) });
    const result = await checkModuleAccess(request, ctx(), "Inventory", "mutate");
    expect(result.ok).toBe(false);
    expect(!result.ok && result.code).toBe("module_forbidden");
    expect(!result.ok && result.status).toBe(403);
  });

  it("refuses a module set to No Access", async () => {
    resolved({ modulePermissions: matrixGranting("Inventory", []) });
    const result = await checkModuleAccess(request, ctx(), "Inventory", "view");
    expect(result.ok).toBe(false);
  });

  it("allows mutate when the matrix grants an editing level", async () => {
    resolved({ modulePermissions: matrixGranting("Inventory", ["View Only", "Edit"]) });
    await expect(checkModuleAccess(request, ctx(), "Inventory", "mutate")).resolves.toEqual({
      ok: true,
    });
  });

  /**
   * Matches `canAccessModule`'s deliberate setup-DX behaviour: an org that has
   * never opened the permissions editor is not locked out of its own app.
   */
  it("is permissive when no matrix has been configured", async () => {
    resolved({});
    await expect(checkModuleAccess(request, ctx(), "Inventory", "mutate")).resolves.toEqual({
      ok: true,
    });
  });

  it("fails closed when the permission lookup fails", async () => {
    resolveRequestRole.mockResolvedValue({
      ok: false,
      code: "forbidden",
      message: "Could not verify your permissions.",
    });
    const result = await checkModuleAccess(request, ctx(), "Inventory", "view");
    expect(result.ok).toBe(false);
    expect(!result.ok && result.code).toBe("module_check_failed");
  });

  it("lets a platform operator through without consulting the matrix", async () => {
    const result = await checkModuleAccess(
      request,
      ctx({ isPlatformAdmin: true }),
      "Inventory",
      "mutate",
    );
    expect(result).toEqual({ ok: true });
    expect(resolveRequestRole).not.toHaveBeenCalled();
  });

  describe("privilege comes from the token, not the stored record", () => {
    it("honours a privileged role carried by the token", async () => {
      resolved({ modulePermissions: matrixGranting("Inventory", []) }, "Admin");
      await expect(
        checkModuleAccess(request, ctx({ role: "Admin" }), "Inventory", "mutate"),
      ).resolves.toEqual({ ok: true });
    });

    /**
     * The stored role goes through `normalizeRole`, which maps anything
     * containing "admin" to Admin. If that value were trusted, a stored role of
     * `readonly-admin` would short-circuit the whole matrix. The token's role
     * replaces it before evaluation, so it cannot.
     */
    it("ignores a stored role that would fuzzily normalize to Admin", async () => {
      resolved({
        role: "readonly-admin",
        modulePermissions: matrixGranting("Inventory", []),
      });
      const result = await checkModuleAccess(
        request,
        ctx({ role: "Dispatcher" }),
        "Inventory",
        "view",
      );
      expect(result.ok).toBe(false);
    });

    it("a null token role is simply not privileged", async () => {
      resolved({ role: "admin", modulePermissions: matrixGranting("Inventory", []) }, null);
      const result = await checkModuleAccess(request, ctx({ role: null }), "Inventory", "view");
      expect(result.ok).toBe(false);
    });
  });

  it("names the module in the denial so the user knows what to ask for", async () => {
    resolved({ modulePermissions: matrixGranting("Inventory", []) });
    const result = await checkModuleAccess(request, ctx(), "Inventory", "view");
    expect(!result.ok && result.message).toContain("Inventory");
  });
});

describe("hasFieldPermission", () => {
  it("reads the stored toggle", async () => {
    resolved({ fieldPermissions: { "Can View Inventory Valuation": true } });
    await expect(hasFieldPermission(request, ctx(), "Can View Inventory Valuation")).resolves.toBe(
      true,
    );
  });

  it("refuses when the toggle is off", async () => {
    resolved({
      fieldPermissions: {
        "Can View Inventory Valuation": false,
        "Can View Customer Rates": true,
      },
    });
    await expect(hasFieldPermission(request, ctx(), "Can View Inventory Valuation")).resolves.toBe(
      false,
    );
  });

  it("is permissive when no field matrix exists at all", async () => {
    resolved({});
    await expect(hasFieldPermission(request, ctx(), "Can View Inventory Valuation")).resolves.toBe(
      true,
    );
  });

  it("grants everything to a privileged token role", async () => {
    resolved({ fieldPermissions: { "Can View Inventory Valuation": false } }, "Admin");
    await expect(
      hasFieldPermission(request, ctx({ role: "Admin" }), "Can View Inventory Valuation"),
    ).resolves.toBe(true);
  });

  it("fails closed when the lookup fails", async () => {
    resolveRequestRole.mockResolvedValue({ ok: false, code: "forbidden", message: "nope" });
    await expect(hasFieldPermission(request, ctx(), "Can View Inventory Valuation")).resolves.toBe(
      false,
    );
  });
});
