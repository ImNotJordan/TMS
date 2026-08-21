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

const { handleProfileRequest, isProfileRequest } = await import("@/lib/profile-proxy");

const ME = "me-1";
const COLLEAGUE = "colleague-1";
const OUTSIDER = "outsider-1";

function get(query = ""): Request {
  return new Request(`https://example.test/api/profile${query}`);
}
function put(body: unknown): Request {
  return new Request("https://example.test/api/profile", {
    method: "PUT",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

function signedIn(overrides: Record<string, unknown> = {}) {
  requireCurrentTenantContext.mockResolvedValue({
    userId: ME,
    role: "Operations Manager",
    companyId: "acme",
    isTenantExempt: false,
    isPlatformAdmin: false,
    sessionEpoch: null,
    ...overrides,
  });
}

/** Company lookup for a target, plus a generic row for reads. */
function companies(byUser: Record<string, string | null>) {
  dynamoSend.mockReset();
  dynamoSend.mockImplementation(async (c: { constructor: { name: string }; input: never }) => {
    const name = c.constructor.name;
    const input = c.input as { Key?: { userId?: string; section?: string } };
    if (name === "GetCommand" && input.Key?.section === "permissions") {
      const company = byUser[input.Key.userId ?? ""];
      return company === undefined
        ? { Item: undefined }
        : { Item: { data: company ? { companyId: company } : {} } };
    }
    if (name === "GetCommand") return { Item: { data: { x: 1 }, updatedAt: "t" } };
    if (name === "QueryCommand") return { Items: [{ section: "personal", data: { x: 1 } }] };
    return {};
  });
}

function sent(name: string) {
  return dynamoSend.mock.calls
    .map(([c]) => c as { constructor: { name: string }; input: Record<string, unknown> })
    .filter((c) => c.constructor.name === name);
}

beforeEach(() => {
  requireCurrentTenantContext.mockReset();
  authorizeAdminRequest.mockReset().mockResolvedValue({ ok: false, code: "forbidden" });
  dynamoSend.mockReset().mockResolvedValue({});
  signedIn();
});

describe("routing", () => {
  it("claims GET and PUT on its own path", () => {
    expect(isProfileRequest(new URL("https://x.test/api/profile"), "GET")).toBe(true);
    expect(isProfileRequest(new URL("https://x.test/api/profile"), "PUT")).toBe(true);
    expect(isProfileRequest(new URL("https://x.test/api/profile"), "DELETE")).toBe(false);
  });
});

describe("self-service", () => {
  it("reads your own row when no userId is given", async () => {
    companies({ [ME]: "acme" });
    const res = await handleProfileRequest(get("?section=personal"));

    expect(res.status).toBe(200);
    expect(sent("GetCommand")[0]?.input).toMatchObject({ Key: { userId: ME } });
  });

  it("never issues a Scan", async () => {
    companies({ [ME]: "acme" });
    await handleProfileRequest(get());
    expect(sent("ScanCommand")).toHaveLength(0);
    expect(sent("QueryCommand")[0]?.input).toMatchObject({
      KeyConditionExpression: "userId = :u",
    });
  });

  it("refuses a self-service write to privileged fields", async () => {
    companies({ [ME]: "acme" });
    const res = await handleProfileRequest(
      put({ section: "permissions", data: { role: "SuperAdmin", nickname: "x" } }),
    );

    // Refused, not silently stripped — this is either a wiring bug or an
    // escalation attempt and both need to surface.
    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toMatchObject({ code: "privileged_field" });
    expect(sent("PutCommand")).toHaveLength(0);
  });

  it("refuses a self-service write to companyId", async () => {
    companies({ [ME]: "acme" });
    const res = await handleProfileRequest(
      put({ section: "permissions", data: { companyId: "globex" } }),
    );
    expect(res.status).toBe(403);
  });

  it("allows an ordinary self-service write", async () => {
    companies({ [ME]: "acme" });
    const res = await handleProfileRequest(put({ section: "personal", data: { nickname: "JA" } }));

    expect(res.status).toBe(200);
    expect(sent("PutCommand")[0]?.input).toMatchObject({
      Item: { userId: ME, section: "personal" },
    });
  });
});

describe("another user's profile", () => {
  it("404s for a non-admin", async () => {
    companies({ [ME]: "acme", [COLLEAGUE]: "acme" });
    const res = await handleProfileRequest(get(`?userId=${COLLEAGUE}&section=personal`));

    expect(res.status).toBe(404);
    // The colleague's row is never fetched, so nothing about them leaks.
    expect(
      sent("GetCommand").some((c) => {
        const key = (c.input as { Key?: { userId?: string; section?: string } }).Key;
        return key?.userId === COLLEAGUE && key?.section === "personal";
      }),
    ).toBe(false);
  });

  it("lets an admin read a colleague in their own company", async () => {
    authorizeAdminRequest.mockResolvedValue({ ok: true });
    companies({ [ME]: "acme", [COLLEAGUE]: "acme" });

    const res = await handleProfileRequest(get(`?userId=${COLLEAGUE}&section=personal`));
    expect(res.status).toBe(200);
  });

  it("404s an admin reading across companies", async () => {
    authorizeAdminRequest.mockResolvedValue({ ok: true });
    companies({ [ME]: "acme", [OUTSIDER]: "globex" });

    const res = await handleProfileRequest(get(`?userId=${OUTSIDER}&section=personal`));
    expect(res.status).toBe(404);
  });

  it("404s an admin writing across companies", async () => {
    authorizeAdminRequest.mockResolvedValue({ ok: true });
    companies({ [ME]: "acme", [OUTSIDER]: "globex" });

    const res = await handleProfileRequest(
      put({ userId: OUTSIDER, section: "personal", data: { nickname: "x" } }),
    );

    expect(res.status).toBe(404);
    expect(sent("PutCommand")).toHaveLength(0);
  });

  it("refuses even an admin setting fields owned by other endpoints", async () => {
    authorizeAdminRequest.mockResolvedValue({ ok: true });
    companies({ [ME]: "acme", [COLLEAGUE]: "acme" });

    const res = await handleProfileRequest(
      put({ userId: COLLEAGUE, section: "permissions", data: { role: "Admin" } }),
    );

    // Role belongs to /api/admin/user-role, which also syncs the Cognito group.
    // Writing it here would leave the group behind and the two disagreeing.
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ code: "server_owned_field" });
  });

  // Regression. This is a full replace, so omitting `role` deleted it — and
  // resolveRequestRole reads that exact field, so an ordinary profile save
  // stripped the user's role and locked them out of everything it gated.
  it("preserves server-owned fields that the payload omits", async () => {
    authorizeAdminRequest.mockResolvedValue({ ok: true });
    dynamoSend.mockReset();
    dynamoSend.mockImplementation(async (c: { constructor: { name: string }; input: never }) => {
      const name = c.constructor.name;
      const input = c.input as { Key?: { userId?: string; section?: string } };
      if (name === "GetCommand" && input.Key?.section === "permissions") {
        return {
          Item: {
            data: {
              companyId: "acme",
              role: "admin",
              employerCompanyId: "acme",
              teams: "old",
            },
          },
        };
      }
      return {};
    });

    await handleProfileRequest(
      put({ userId: COLLEAGUE, section: "permissions", data: { teams: "new" } }),
    );

    const written = sent("PutCommand")[0]?.input as { Item?: { data?: Record<string, unknown> } };
    expect(written.Item?.data).toMatchObject({
      teams: "new",
      role: "admin",
      companyId: "acme",
      employerCompanyId: "acme",
    });
  });

  it("lets an admin write non-privileged permissions fields", async () => {
    authorizeAdminRequest.mockResolvedValue({ ok: true });
    companies({ [ME]: "acme", [COLLEAGUE]: "acme" });

    const res = await handleProfileRequest(
      put({ userId: COLLEAGUE, section: "permissions", data: { teams: "ops" } }),
    );
    expect(res.status).toBe(200);
  });
});

describe("input", () => {
  it("rejects an unknown section", async () => {
    companies({ [ME]: "acme" });
    const res = await handleProfileRequest(put({ section: "../../etc", data: {} }));
    expect(res.status).toBe(400);
    expect(sent("PutCommand")).toHaveLength(0);
  });

  it("denies an unauthenticated caller before touching the table", async () => {
    requireCurrentTenantContext.mockRejectedValueOnce(new Error("no token"));
    const res = await handleProfileRequest(get("?section=personal"));

    expect(res.status).toBe(401);
    expect(dynamoSend).not.toHaveBeenCalled();
  });
});

/**
 * An admin editing their own row in the admin console.
 *
 * Regression: this payload names the caller, which used to be treated as
 * self-service and refused with `privileged_field` — so the admin console could
 * save every user's permission grids except the signed-in admin's own.
 */
describe("admin editing their own permissions", () => {
  const GRIDS = {
    permissionGroup: "Admin Template",
    accessLevel: "Elevated",
    dataAccessScope: "All Company Data",
    modulePermissions: { Inventory: { "Full Access": true } },
    fieldPermissions: { "Can View Inventory Valuation": true },
  };

  it("saves the permission grids when the caller is an admin", async () => {
    authorizeAdminRequest.mockResolvedValue({ ok: true, sub: ME, role: "Admin" });
    companies({ [ME]: "acme" });

    const res = await handleProfileRequest(
      put({ userId: ME, section: "permissions", data: GRIDS }),
    );

    expect(res.status).toBe(200);
    const written = sent("PutCommand")[0].input as {
      Item: { userId: string; data: Record<string, unknown> };
    };
    expect(written.Item.userId).toBe(ME);
    expect(written.Item.data.modulePermissions).toEqual(GRIDS.modulePermissions);
    expect(written.Item.data.fieldPermissions).toEqual(GRIDS.fieldPermissions);
    expect(written.Item.data.dataAccessScope).toBe("All Company Data");
  });

  it("still refuses a non-admin naming themselves", async () => {
    authorizeAdminRequest.mockResolvedValue({ ok: false, code: "forbidden" });
    companies({ [ME]: "acme" });

    const res = await handleProfileRequest(
      put({ userId: ME, section: "permissions", data: GRIDS }),
    );

    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("privileged_field");
    expect(sent("PutCommand")).toHaveLength(0);
  });

  /**
   * The escalation that must stay closed: an admin may rewrite their own grids,
   * which grants them nothing, but not their own role — that would be
   * self-promotion to SuperAdmin.
   */
  it("refuses role even for an admin editing themselves", async () => {
    authorizeAdminRequest.mockResolvedValue({ ok: true, sub: ME, role: "Admin" });
    companies({ [ME]: "acme" });

    const res = await handleProfileRequest(
      put({ userId: ME, section: "permissions", data: { role: "SuperAdmin" } }),
    );

    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("server_owned_field");
    expect(sent("PutCommand")).toHaveLength(0);
  });

  it("refuses companyId even for an admin editing themselves", async () => {
    authorizeAdminRequest.mockResolvedValue({ ok: true, sub: ME, role: "Admin" });
    companies({ [ME]: "acme" });

    const res = await handleProfileRequest(
      put({ userId: ME, section: "permissions", data: { companyId: "rival" } }),
    );

    expect(res.status).toBe(400);
    expect(sent("PutCommand")).toHaveLength(0);
  });

  /**
   * The implicit-self path stays self-service even for an admin, so the profile
   * page cannot become a privilege-writing surface through a UI mistake.
   */
  it("keeps the no-userId path self-service for an admin", async () => {
    authorizeAdminRequest.mockResolvedValue({ ok: true, sub: ME, role: "Admin" });
    companies({ [ME]: "acme" });

    const res = await handleProfileRequest(put({ section: "permissions", data: GRIDS }));

    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("privileged_field");
  });

  it("leaves ordinary self-service saves working", async () => {
    authorizeAdminRequest.mockResolvedValue({ ok: false, code: "forbidden" });
    companies({ [ME]: "acme" });

    const res = await handleProfileRequest(
      put({ section: "personal", data: { given_name: "Jordan" } }),
    );

    expect(res.status).toBe(200);
  });
});
