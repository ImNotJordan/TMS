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
    const res = await handleProfileRequest(
      put({ section: "personal", data: { nickname: "JA" } }),
    );

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
    expect(sent("GetCommand").some((c) => {
      const key = (c.input as { Key?: { userId?: string; section?: string } }).Key;
      return key?.userId === COLLEAGUE && key?.section === "personal";
    })).toBe(false);
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
