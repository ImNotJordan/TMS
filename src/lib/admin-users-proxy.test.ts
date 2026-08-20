import { beforeEach, describe, expect, it, vi } from "vitest";

const requireCurrentTenantContext = vi.fn();
const authorizeAdminRequest = vi.fn();
const cognitoSend = vi.fn();
const dynamoSend = vi.fn();

vi.mock("@/lib/tenant/request-context", () => ({
  requireCurrentTenantContext: (...a: unknown[]) => requireCurrentTenantContext(...a),
}));
vi.mock("@/lib/ai/ai-authz", () => ({
  authorizeAdminRequest: (...a: unknown[]) => authorizeAdminRequest(...a),
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

const { handleAdminUsersRequest, isAdminUsersRequest } = await import("@/lib/admin-users-proxy");

const req = () => new Request("https://example.test/api/admin/users");

function signedInAs(overrides: Record<string, unknown> = {}) {
  requireCurrentTenantContext.mockResolvedValue({
    userId: "admin-1",
    role: "Admin",
    companyId: "acme",
    isTenantExempt: false,
    isPlatformAdmin: false,
    sessionEpoch: null,
    ...overrides,
  });
}

/** One Cognito page, then the Profile rows keyed by sub. */
function poolIs(
  users: Array<{ sub: string; email?: string }>,
  profiles: Record<string, Record<string, unknown>> = {},
) {
  cognitoSend.mockReset();
  cognitoSend.mockResolvedValue({
    Users: users.map((u) => ({
      Attributes: [
        { Name: "sub", Value: u.sub },
        ...(u.email ? [{ Name: "email", Value: u.email }] : []),
      ],
      Enabled: true,
      UserStatus: "CONFIRMED",
    })),
  });

  dynamoSend.mockReset();
  dynamoSend.mockResolvedValue({
    Responses: {
      UsersTable: Object.entries(profiles).map(([userId, data]) => ({ userId, data })),
    },
  });
}

async function listedIds(): Promise<string[]> {
  const res = await handleAdminUsersRequest(req());
  const body = (await res.json()) as { users?: Array<{ id: string }> };
  return (body.users ?? []).map((u) => u.id);
}

beforeEach(() => {
  requireCurrentTenantContext.mockReset();
  authorizeAdminRequest.mockReset().mockResolvedValue({ ok: true });
  cognitoSend.mockReset().mockResolvedValue({ Users: [] });
  dynamoSend.mockReset().mockResolvedValue({ Responses: { UsersTable: [] } });
  signedInAs();
});

describe("routing", () => {
  it("claims GET on its own path only", () => {
    expect(isAdminUsersRequest(new URL("https://x.test/api/admin/users"), "GET")).toBe(true);
    expect(isAdminUsersRequest(new URL("https://x.test/api/admin/users"), "POST")).toBe(false);
    expect(isAdminUsersRequest(new URL("https://x.test/api/admin/users/1"), "GET")).toBe(false);
  });
});

describe("drivers are scoped to their employer", () => {
  it("returns only the drivers this company employs", async () => {
    poolIs(
      [{ sub: "d-ours" }, { sub: "d-theirs" }, { sub: "d-orphan" }],
      {
        "d-ours": { role: "driver", employerCompanyId: "acme" },
        "d-theirs": { role: "driver", employerCompanyId: "globex" },
        "d-orphan": { role: "driver" },
      },
    );

    expect(await listedIds()).toEqual(["d-ours"]);
  });

  it("does not leak another company's driver through the response body", async () => {
    poolIs([{ sub: "d-theirs", email: "someone@globex.test" }], {
      "d-theirs": { role: "driver", employerCompanyId: "globex" },
    });

    const res = await handleAdminUsersRequest(req());
    const text = await res.text();
    expect(text).not.toContain("globex");
    expect(text).not.toContain("someone@globex.test");
  });
});

describe("ordinary users", () => {
  it("are scoped to their company, with unassigned still visible", async () => {
    poolIs([{ sub: "u-ours" }, { sub: "u-theirs" }, { sub: "u-pending" }], {
      "u-ours": { role: "dispatcher", companyId: "acme" },
      "u-theirs": { role: "dispatcher", companyId: "globex" },
      "u-pending": { role: "dispatcher" },
    });

    expect((await listedIds()).sort()).toEqual(["u-ours", "u-pending"]);
  });
});

describe("platform admins", () => {
  /** The wider view is opt-in; the default must be the caller's own company. */
  function everyoneElsesPool() {
    poolIs([{ sub: "d-ours" }, { sub: "d-orphan" }, { sub: "u-theirs" }], {
      "d-ours": { role: "driver", employerCompanyId: "acme" },
      "d-orphan": { role: "driver" },
      "u-theirs": { role: "dispatcher", companyId: "globex" },
    });
  }

  it("see only their own company by default, despite holding the privilege", async () => {
    signedInAs({ isPlatformAdmin: true, companyId: "acme" });
    everyoneElsesPool();

    expect(await listedIds()).toEqual(["d-ours"]);
  });

  it("advertise that they could widen it", async () => {
    signedInAs({ isPlatformAdmin: true, companyId: "acme" });
    everyoneElsesPool();

    const res = await handleAdminUsersRequest(req());
    await expect(res.json()).resolves.toMatchObject({
      scope: "company",
      canViewAllCompanies: true,
    });
  });

  it("see every row when they explicitly ask", async () => {
    signedInAs({ isPlatformAdmin: true, companyId: "acme" });
    everyoneElsesPool();

    const res = await handleAdminUsersRequest(
      new Request("https://example.test/api/admin/users?scope=all"),
    );
    const body = (await res.json()) as { users: Array<{ id: string }>; scope: string };

    expect(body.users.map((u) => u.id).sort()).toEqual(["d-orphan", "d-ours", "u-theirs"]);
    expect(body.scope).toBe("platform");
  });

  it("still see everything when they have no company to scope to", async () => {
    // Bootstrap: refusing here would leave nobody able to onboard the first
    // company or repair a driver whose employer was never recorded.
    signedInAs({ isPlatformAdmin: true, companyId: null });
    everyoneElsesPool();

    expect((await listedIds()).sort()).toEqual(["d-orphan", "d-ours", "u-theirs"]);
  });
});

describe("scope=all is not a self-service escalation", () => {
  it("is refused for an ordinary admin", async () => {
    signedInAs({ isPlatformAdmin: false, companyId: "acme" });
    poolIs([{ sub: "u-theirs" }], { "u-theirs": { role: "dispatcher", companyId: "globex" } });

    const res = await handleAdminUsersRequest(
      new Request("https://example.test/api/admin/users?scope=all"),
    );

    // Refused outright rather than quietly downgraded — an attempt to widen the
    // boundary should be visible, not silently ignored.
    expect(res.status).toBe(403);
    expect(cognitoSend).not.toHaveBeenCalled();
  });
});

describe("fail closed", () => {
  it("denies an unauthenticated caller before reading the pool", async () => {
    requireCurrentTenantContext.mockRejectedValueOnce(new Error("no token"));
    const res = await handleAdminUsersRequest(req());

    expect(res.status).toBe(401);
    expect(cognitoSend).not.toHaveBeenCalled();
  });

  it("denies a non-admin before reading the pool", async () => {
    authorizeAdminRequest.mockResolvedValueOnce({ ok: false, code: "forbidden" });
    const res = await handleAdminUsersRequest(req());

    expect(res.status).toBe(403);
    expect(cognitoSend).not.toHaveBeenCalled();
  });

  it("returns an empty directory, not the pool, when the admin has no company", async () => {
    signedInAs({ companyId: null, isPlatformAdmin: false });
    const res = await handleAdminUsersRequest(req());
    const body = (await res.json()) as { users: unknown[]; code?: string };

    expect(body.users).toEqual([]);
    expect(body.code).toBe("no_company_context");
    expect(cognitoSend).not.toHaveBeenCalled();
  });
});

describe("completeness", () => {
  it("drains every Cognito page", async () => {
    cognitoSend
      .mockResolvedValueOnce({
        Users: [{ Attributes: [{ Name: "sub", Value: "a" }], Enabled: true }],
        PaginationToken: "next",
      })
      .mockResolvedValueOnce({
        Users: [{ Attributes: [{ Name: "sub", Value: "b" }], Enabled: true }],
      });
    dynamoSend.mockResolvedValue({
      Responses: {
        UsersTable: [
          { userId: "a", data: { role: "dispatcher", companyId: "acme" } },
          { userId: "b", data: { role: "dispatcher", companyId: "acme" } },
        ],
      },
    });

    expect((await listedIds()).sort()).toEqual(["a", "b"]);
  });

  it("retries unprocessed profile keys rather than shortening the directory", async () => {
    cognitoSend.mockResolvedValue({
      Users: [
        { Attributes: [{ Name: "sub", Value: "a" }], Enabled: true },
        { Attributes: [{ Name: "sub", Value: "b" }], Enabled: true },
      ],
    });
    dynamoSend
      .mockResolvedValueOnce({
        Responses: { UsersTable: [{ userId: "a", data: { role: "driver", employerCompanyId: "acme" } }] },
        UnprocessedKeys: { UsersTable: { Keys: [{ userId: "b", section: "permissions" }] } },
      })
      .mockResolvedValueOnce({
        Responses: { UsersTable: [{ userId: "b", data: { role: "driver", employerCompanyId: "acme" } }] },
      });

    // Without the retry, "b" would arrive with no profile, be treated as a
    // role-less user, and slip through the unassigned carve-out.
    expect((await listedIds()).sort()).toEqual(["a", "b"]);
  });

  it("never issues a Scan", async () => {
    poolIs([{ sub: "a" }], { a: { role: "dispatcher", companyId: "acme" } });
    await handleAdminUsersRequest(req());

    const names = dynamoSend.mock.calls.map(([c]) => (c as object).constructor.name);
    expect(names).not.toContain("ScanCommand");
    expect(names).toContain("BatchGetCommand");
  });
});
