import { beforeEach, describe, expect, it, vi } from "vitest";

const requireCurrentTenantContext = vi.fn();
const authorizeAdminRequest = vi.fn();
const invalidateCachedRole = vi.fn();
const cognitoSend = vi.fn();
const dynamoSend = vi.fn();

vi.mock("@/lib/tenant/request-context", () => ({
  requireCurrentTenantContext: (...a: unknown[]) => requireCurrentTenantContext(...a),
}));
vi.mock("@/lib/ai/ai-authz", () => ({
  authorizeAdminRequest: (...a: unknown[]) => authorizeAdminRequest(...a),
  invalidateCachedRole: (...a: unknown[]) => invalidateCachedRole(...a),
}));
vi.mock("@/lib/ai/server-cognito", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/ai/server-cognito")>("@/lib/ai/server-cognito");
  return {
    ...actual,
    getServerUserPoolId: () => "us-west-1_test",
    getServerCognitoClient: () => ({ send: (...a: unknown[]) => cognitoSend(...a) }),
  };
});
vi.mock("@/lib/ai/server-aws", () => ({
  getAiDynamoClient: async () => ({ send: (...a: unknown[]) => dynamoSend(...a) }),
  getProfileTable: () => "UsersTable",
}));

const { handleUserRoleRequest, isUserRoleRequest } = await import("@/lib/admin-role-proxy");

const ADMIN = "admin-1";
const TARGET = "user-9";

function post(body: unknown): Request {
  return new Request("https://example.test/api/admin/user-role", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

function callerIs(overrides: Record<string, unknown> = {}) {
  requireCurrentTenantContext.mockResolvedValue({
    userId: ADMIN,
    role: "Admin",
    companyId: "acme",
    isTenantExempt: false,
    isPlatformAdmin: false,
    sessionEpoch: null,
    ...overrides,
  });
}

/** The target's stored permissions row, plus their current groups. */
function targetIs(data: Record<string, unknown> | null, groups: string[] = []) {
  dynamoSend.mockReset();
  dynamoSend.mockImplementation(async (c: { constructor: { name: string } }) =>
    c.constructor.name === "GetCommand" ? { Item: data ? { data } : undefined } : {},
  );
  cognitoSend.mockReset();
  cognitoSend.mockImplementation(async (c: { constructor: { name: string } }) =>
    c.constructor.name === "AdminListGroupsForUserCommand"
      ? { Groups: groups.map((GroupName) => ({ GroupName })) }
      : {},
  );
}

function cognitoCalls(name: string) {
  return cognitoSend.mock.calls
    .map(([c]) => c as { constructor: { name: string }; input: Record<string, unknown> })
    .filter((c) => c.constructor.name === name);
}

beforeEach(() => {
  requireCurrentTenantContext.mockReset();
  authorizeAdminRequest.mockReset().mockResolvedValue({ ok: true });
  invalidateCachedRole.mockReset();
  cognitoSend.mockReset().mockResolvedValue({});
  dynamoSend.mockReset().mockResolvedValue({});
  callerIs();
});

describe("routing", () => {
  it("claims POST on its own path only", () => {
    expect(isUserRoleRequest(new URL("https://x.test/api/admin/user-role"), "POST")).toBe(true);
    expect(isUserRoleRequest(new URL("https://x.test/api/admin/user-role"), "GET")).toBe(false);
  });
});

describe("group sync", () => {
  it("adds the role's group and removes the stale one", async () => {
    targetIs({ role: "dispatch", companyId: "acme" }, ["dispatch"]);
    const res = await handleUserRoleRequest(post({ userId: TARGET, role: "Admin" }));

    expect(res.status).toBe(200);
    expect(cognitoCalls("AdminAddUserToGroupCommand")[0]?.input).toMatchObject({
      GroupName: "admin",
      Username: TARGET,
    });
    // Otherwise a promoted user keeps both and any first-match check is
    // effectively random.
    expect(cognitoCalls("AdminRemoveUserFromGroupCommand")[0]?.input).toMatchObject({
      GroupName: "dispatch",
    });
  });

  // Regression. The pool carried a hand-made `SuperAdmin` group; matching on
  // the canonical lowercase name skipped it, so demoting to Admin added `admin`
  // and left `SuperAdmin` attached. PLATFORM_ADMIN_GROUPS honours `SuperAdmin`,
  // so the user kept cross-tenant access after being demoted.
  it("removes a differently-cased privileged group on demotion", async () => {
    callerIs({ isPlatformAdmin: true });
    targetIs({ role: "superadmin", companyId: "acme" }, ["SuperAdmin"]);

    const res = await handleUserRoleRequest(post({ userId: TARGET, role: "Admin" }));

    expect(res.status).toBe(200);
    const removed = cognitoCalls("AdminRemoveUserFromGroupCommand").map((c) => c.input.GroupName);
    expect(removed).toContain("SuperAdmin");
    expect(cognitoCalls("AdminAddUserToGroupCommand")[0]?.input).toMatchObject({
      GroupName: "admin",
    });
  });

  it("does not add a duplicate when an equivalent group is already held", async () => {
    callerIs({ isPlatformAdmin: true });
    // Held as `SuperAdmin`, asked for `superadmin` — one grant, two spellings.
    targetIs({ role: "superadmin", companyId: "acme" }, ["SuperAdmin"]);

    await handleUserRoleRequest(post({ userId: TARGET, role: "SuperAdmin" }));

    expect(cognitoCalls("AdminRemoveUserFromGroupCommand")).toHaveLength(0);
    expect(cognitoCalls("AdminAddUserToGroupCommand")[0]?.input).toMatchObject({
      GroupName: "superadmin",
    });
  });

  it("treats a privileged group as privilege even when the stored role disagrees", async () => {
    // The Profile mirror says Dispatcher; the group says otherwise. The group
    // is what the token carries, so it decides.
    targetIs({ role: "dispatch", companyId: "acme" }, ["SuperAdmin"]);

    const res = await handleUserRoleRequest(post({ userId: TARGET, role: "Admin" }));

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toMatchObject({ code: "privileged_role" });
  });

  it("leaves groups it does not manage alone", async () => {
    targetIs({ role: "dispatch", companyId: "acme" }, ["dispatch", "beta-testers"]);
    await handleUserRoleRequest(post({ userId: TARGET, role: "Admin" }));

    const removed = cognitoCalls("AdminRemoveUserFromGroupCommand").map((c) => c.input.GroupName);
    expect(removed).toContain("dispatch");
    expect(removed).not.toContain("beta-testers");
  });

  it("creates the group when the pool has never had it", async () => {
    targetIs({ role: "dispatch", companyId: "acme" }, []);
    let addAttempts = 0;
    cognitoSend.mockImplementation(async (c: { constructor: { name: string } }) => {
      const name = c.constructor.name;
      if (name === "AdminListGroupsForUserCommand") return { Groups: [] };
      if (name === "AdminAddUserToGroupCommand") {
        addAttempts += 1;
        if (addAttempts === 1) {
          throw Object.assign(new Error("no group"), { name: "ResourceNotFoundException" });
        }
      }
      return {};
    });

    const res = await handleUserRoleRequest(post({ userId: TARGET, role: "Admin" }));

    expect(res.status).toBe(200);
    expect(cognitoCalls("CreateGroupCommand")[0]?.input).toMatchObject({ GroupName: "admin" });
    expect(addAttempts).toBe(2);
  });

  it("bumps the session epoch, because groups are baked into the token", async () => {
    targetIs({ role: "dispatch", companyId: "acme" }, []);
    await handleUserRoleRequest(post({ userId: TARGET, role: "Admin" }));

    expect(cognitoCalls("AdminUpdateUserAttributesCommand")[0]?.input).toMatchObject({
      UserAttributes: [{ Name: "custom:sessionEpoch" }],
    });
  });
});

describe("privileged roles", () => {
  it("refuses an ordinary admin granting SuperAdmin", async () => {
    targetIs({ role: "dispatch", companyId: "acme" }, []);
    const res = await handleUserRoleRequest(post({ userId: TARGET, role: "SuperAdmin" }));

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toMatchObject({ code: "privileged_role" });
    expect(cognitoCalls("AdminAddUserToGroupCommand")).toHaveLength(0);
  });

  it("refuses an ordinary admin revoking SuperAdmin", async () => {
    // Otherwise a company admin could demote the platform admin and remove the
    // only oversight above them.
    targetIs({ role: "superadmin", companyId: "acme" }, ["superadmin"]);
    const res = await handleUserRoleRequest(post({ userId: TARGET, role: "Dispatcher" }));

    expect(res.status).toBe(403);
    expect(cognitoCalls("AdminRemoveUserFromGroupCommand")).toHaveLength(0);
  });

  it("allows a platform admin to grant it", async () => {
    callerIs({ isPlatformAdmin: true });
    targetIs({ role: "dispatch", companyId: "acme" }, []);
    const res = await handleUserRoleRequest(post({ userId: TARGET, role: "SuperAdmin" }));

    expect(res.status).toBe(200);
    expect(cognitoCalls("AdminAddUserToGroupCommand")[0]?.input).toMatchObject({
      GroupName: "superadmin",
    });
  });
});

describe("self-service is never allowed", () => {
  it("refuses changing your own role", async () => {
    targetIs({ role: "admin", companyId: "acme" }, ["admin"]);
    const res = await handleUserRoleRequest(post({ userId: ADMIN, role: "SuperAdmin" }));

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toMatchObject({ code: "self_assignment" });
    expect(cognitoSend).not.toHaveBeenCalled();
  });

  it("refuses even a platform admin changing their own role", async () => {
    callerIs({ isPlatformAdmin: true });
    const res = await handleUserRoleRequest(post({ userId: ADMIN, role: "Driver" }));
    expect(res.status).toBe(403);
  });
});

describe("tenant boundary", () => {
  it("404s a target in another company", async () => {
    targetIs({ role: "dispatch", companyId: "globex" }, []);
    const res = await handleUserRoleRequest(post({ userId: TARGET, role: "Admin" }));

    expect(res.status).toBe(404);
    expect(cognitoCalls("AdminAddUserToGroupCommand")).toHaveLength(0);
  });

  it("scopes a Driver by their employer", async () => {
    targetIs({ role: "driver", employerCompanyId: "globex" }, []);
    const res = await handleUserRoleRequest(post({ userId: TARGET, role: "Dispatcher" }));
    expect(res.status).toBe(404);
  });

  it("lets a platform admin cross companies", async () => {
    callerIs({ isPlatformAdmin: true });
    targetIs({ role: "dispatch", companyId: "globex" }, []);
    const res = await handleUserRoleRequest(post({ userId: TARGET, role: "Admin" }));
    expect(res.status).toBe(200);
  });
});

describe("input", () => {
  it("rejects a role that is not exactly one of the known roles", async () => {
    targetIs({ role: "dispatch", companyId: "acme" }, []);
    // "Admins" must not resolve to "Admin" — the closest match to garbage
    // should never be a grant.
    for (const role of ["Admins", "root", "super admin", "", null, 42]) {
      const res = await handleUserRoleRequest(post({ userId: TARGET, role }));
      expect(res.status).toBe(400);
    }
    expect(cognitoSend).not.toHaveBeenCalled();
  });

  it("still resolves a role with surrounding whitespace", async () => {
    // strictRole trims and lowercases, so this is a real grant attempt and is
    // judged on its merits — here, refused because the caller is not a
    // platform admin rather than because the string was unrecognised.
    targetIs({ role: "dispatch", companyId: "acme" }, []);
    const res = await handleUserRoleRequest(post({ userId: TARGET, role: " superadmin " }));

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toMatchObject({ code: "privileged_role" });
  });

  it("404s an unknown user rather than creating anything", async () => {
    targetIs(null, []);
    const res = await handleUserRoleRequest(post({ userId: "nobody", role: "Admin" }));

    expect(res.status).toBe(404);
    expect(cognitoCalls("AdminAddUserToGroupCommand")).toHaveLength(0);
  });

  it("denies a non-admin caller", async () => {
    authorizeAdminRequest.mockResolvedValueOnce({ ok: false, code: "forbidden" });
    const res = await handleUserRoleRequest(post({ userId: TARGET, role: "Admin" }));

    expect(res.status).toBe(403);
    expect(cognitoSend).not.toHaveBeenCalled();
  });
});
