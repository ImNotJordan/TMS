import { beforeEach, describe, expect, it, vi } from "vitest";

const authorizeAdminRequest = vi.fn();
const requireVerifiedIdClaims = vi.fn();
const cognitoSend = vi.fn();
const dynamoSend = vi.fn();
const getServerCognitoClient = vi.fn(() => ({ send: cognitoSend }));

const resolveRequestRole = vi.fn();
const invalidateCachedRole = vi.fn();

vi.mock("@/lib/ai/ai-authz", () => ({
  authorizeAdminRequest: (...a: unknown[]) => authorizeAdminRequest(...a),
  resolveRequestRole: (...a: unknown[]) => resolveRequestRole(...a),
  invalidateCachedRole: (...a: unknown[]) => invalidateCachedRole(...a),
}));
vi.mock("@/lib/ai/cognito-request-credentials", () => ({
  requireVerifiedIdClaims: (...a: unknown[]) => requireVerifiedIdClaims(...a),
}));
vi.mock("@/lib/ai/server-cognito", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/ai/server-cognito")>("@/lib/ai/server-cognito");
  return {
    ...actual,
    getServerCognitoClient: () => getServerCognitoClient(),
    getServerUserPoolId: () => "us-east-1_TestPool",
  };
});
vi.mock("@/lib/ai/server-aws", () => ({
  getAiDynamoClient: async () => ({ send: dynamoSend }),
  getProfileTable: () => "Profile",
  getWorkspaceSettingsTable: () => "WorkspaceSettings",
  getServerAiAwsRegion: () => "us-east-1",
  getAiDailyRequestBudget: () => 1000,
}));

const { handleCompanyAssignmentRequest } = await import("@/lib/admin-company-proxy");
const { ServerPrincipalMissingError } = await import("@/lib/ai/server-cognito");

const ACME = "11111111-1111-4111-8111-111111111111";
const RIVAL = "22222222-2222-4222-8222-222222222222";

function post(body: unknown): Request {
  return new Request("https://example.test/api/admin/company-assignment", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

/** Caller: an admin of ACME unless told otherwise. */
function callerIs(claims: Record<string, unknown> = {}) {
  authorizeAdminRequest.mockResolvedValue({ ok: true, sub: "admin-1", role: "Admin" });
  requireVerifiedIdClaims.mockResolvedValue({
    sub: "admin-1",
    "cognito:groups": ["Admin"],
    "custom:companyId": ACME,
    ...claims,
  });
}

function userNotFound() {
  return Object.assign(new Error("no such user"), { name: "UserNotFoundException" });
}

/**
 * Target user's existing Cognito attributes, found directly by Username.
 * `sub === Username` in this shape.
 */
function targetHas(attrs: Record<string, string>) {
  cognitoSend.mockImplementation(async (command: { constructor: { name: string } }) => {
    if (command.constructor.name === "AdminGetUserCommand") {
      return {
        UserAttributes: Object.entries(attrs).map(([Name, Value]) => ({ Name, Value })),
      };
    }
    return {};
  });
}

/**
 * The real-world shape: Username differs from sub, so AdminGetUser misses and
 * the lookup has to fall back to ListUsers by sub.
 */
function targetFoundBySubOnly(username: string, attrs: Record<string, string>) {
  cognitoSend.mockImplementation(async (command: { constructor: { name: string } }) => {
    if (command.constructor.name === "AdminGetUserCommand") throw userNotFound();
    if (command.constructor.name === "ListUsersCommand") {
      return {
        Users: [
          {
            Username: username,
            Attributes: Object.entries(attrs).map(([Name, Value]) => ({ Name, Value })),
          },
        ],
      };
    }
    return {};
  });
}

/** No such user by either route. */
function targetMissing() {
  cognitoSend.mockImplementation(async (command: { constructor: { name: string } }) => {
    if (command.constructor.name === "AdminGetUserCommand") throw userNotFound();
    if (command.constructor.name === "ListUsersCommand") return { Users: [] };
    return {};
  });
}

beforeEach(() => {
  authorizeAdminRequest.mockReset();
  requireVerifiedIdClaims.mockReset();
  cognitoSend.mockReset();
  dynamoSend.mockReset().mockResolvedValue({});
  getServerCognitoClient.mockReset().mockReturnValue({ send: cognitoSend });
  invalidateCachedRole.mockReset();
  // No epoch ever stored — the session-current check passes. Revocation itself
  // is covered in request-context.test.ts.
  resolveRequestRole.mockReset().mockResolvedValue({
    ok: true,
    sub: "admin-1",
    role: "Admin",
    sessionEpoch: null,
  });
});

describe("authorization", () => {
  it("rejects a non-admin", async () => {
    authorizeAdminRequest.mockResolvedValue({
      ok: false,
      code: "forbidden",
      message: "Only an administrator can change workspace settings.",
    });
    const res = await handleCompanyAssignmentRequest(post({ userId: "u", companyId: ACME }));
    expect(res.status).toBe(403);
  });

  it("rejects an unauthenticated caller", async () => {
    authorizeAdminRequest.mockResolvedValue({
      ok: false,
      code: "not_authenticated",
      message: "Sign in.",
    });
    const res = await handleCompanyAssignmentRequest(post({ userId: "u", companyId: ACME }));
    expect(res.status).toBe(401);
  });

  it("returns 503 rather than falling back to caller credentials", async () => {
    callerIs();
    getServerCognitoClient.mockImplementation(() => {
      throw new ServerPrincipalMissingError();
    });
    const res = await handleCompanyAssignmentRequest(
      post({ userId: "u", companyId: ACME, companyName: "Acme" }),
    );
    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toMatchObject({ code: "server_principal_missing" });
  });
});

describe("cross-tenant guard", () => {
  it("assigns a user to the caller's own company", async () => {
    callerIs();
    targetHas({});
    const res = await handleCompanyAssignmentRequest(
      post({ userId: "user-9", companyId: ACME, companyName: "Acme Logistics" }),
    );
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      ok: true,
      companyId: ACME,
      tokenRefreshRequired: true,
    });
  });

  // An admin pushing users into another company is a cross-tenant write — but
  // saying so leaks nothing, since the caller already knows their own company.
  // An opaque 404 here just sends a legitimate admin hunting for a missing user.
  it("refuses assignment to a company the caller does not belong to, and says why", async () => {
    callerIs();
    targetHas({});
    const res = await handleCompanyAssignmentRequest(
      post({ userId: "user-9", companyId: RIVAL, companyName: "Rival Freight" }),
    );
    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toMatchObject({ code: "cross_company_assignment" });
  });

  it("refuses to move a user who belongs to another company", async () => {
    callerIs();
    targetHas({ "custom:companyId": RIVAL });
    const res = await handleCompanyAssignmentRequest(
      post({ userId: "user-9", companyId: ACME, companyName: "Acme Logistics" }),
    );
    expect(res.status).toBe(404);
  });

  // 404, not 403 — a distinct code would confirm the user exists elsewhere.
  it("reports a foreign-company target identically to a missing one", async () => {
    callerIs();
    targetHas({ "custom:companyId": RIVAL });
    const foreign = await handleCompanyAssignmentRequest(
      post({ userId: "user-9", companyId: ACME, companyName: "Acme" }),
    );

    callerIs();
    targetMissing();
    const missing = await handleCompanyAssignmentRequest(
      post({ userId: "nobody", companyId: ACME, companyName: "Acme" }),
    );

    expect(foreign.status).toBe(missing.status);
    await expect(foreign.json()).resolves.toEqual(await missing.json());
  });

  // The bug that shipped: the app identifies users by Cognito `sub`, but the
  // admin APIs key on `Username`, and this pool generates a different one.
  it("resolves a user whose Username differs from their sub", async () => {
    callerIs();
    targetFoundBySubOnly("cognito-generated-username", {});
    const res = await handleCompanyAssignmentRequest(
      post({
        userId: "0949294e-9091-7068-5783-47fd272997ec",
        companyId: ACME,
        companyName: "Acme Logistics",
      }),
    );

    expect(res.status).toBe(200);
    // Attribute writes must target the resolved Username, not the sub.
    const writes = cognitoSend.mock.calls
      .map(([c]) => c as { constructor: { name: string }; input?: { Username?: string } })
      .filter((c) => c.constructor.name === "AdminUpdateUserAttributesCommand");
    expect(writes.length).toBeGreaterThan(0);
    for (const write of writes) {
      expect(write.input?.Username).toBe("cognito-generated-username");
    }
  });

  it("404s when the user exists under neither Username nor sub", async () => {
    callerIs();
    targetMissing();
    const res = await handleCompanyAssignmentRequest(
      post({ userId: "nobody", companyId: ACME, companyName: "Acme" }),
    );
    expect(res.status).toBe(404);
  });

  it("allows removal of a user from the caller's own company", async () => {
    callerIs();
    targetHas({ "custom:companyId": ACME });
    const res = await handleCompanyAssignmentRequest(post({ userId: "user-9", companyId: "" }));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ companyId: null });
  });

  // The intentional escape hatch: onboarding a company means assigning its
  // first users before belonging to it.
  it("lets a platform admin assign across companies", async () => {
    callerIs({ "cognito:groups": ["SuperAdmin"] });
    targetHas({ "custom:companyId": RIVAL });
    const res = await handleCompanyAssignmentRequest(
      post({ userId: "user-9", companyId: RIVAL, companyName: "Rival Freight" }),
    );
    expect(res.status).toBe(200);
  });

  // Platform privilege must come from Cognito group membership, never from the
  // Profile role — that row is writable by any browser with Dynamo access, so
  // keying on it would make the escape hatch self-granting.
  it("does not grant platform privilege from a stored role alone", async () => {
    authorizeAdminRequest.mockResolvedValue({ ok: true, sub: "admin-1", role: "SuperAdmin" });
    requireVerifiedIdClaims.mockResolvedValue({
      sub: "admin-1",
      "cognito:groups": ["Admin"], // company admin, not a platform group
      "custom:companyId": ACME,
    });
    targetHas({});
    const res = await handleCompanyAssignmentRequest(
      post({ userId: "user-9", companyId: RIVAL, companyName: "Rival Freight" }),
    );
    expect(res.status).toBe(403);
  });

  // Documented bootstrap path: no "own company" to compare against yet.
  it("allows an admin with no company to assign (bootstrap)", async () => {
    callerIs({ "custom:companyId": undefined });
    targetHas({});
    const res = await handleCompanyAssignmentRequest(
      post({ userId: "user-9", companyId: RIVAL, companyName: "Rival Freight" }),
    );
    expect(res.status).toBe(200);
  });
});

describe("Rule B — tenant-exempt roles", () => {
  /** The target's stored role, read from the Profile table server-side. */
  function targetRoleIs(role: string | null) {
    dynamoSend.mockImplementation(async (command: { constructor: { name: string } }) => {
      if (command.constructor.name === "GetCommand") {
        return role ? { Item: { data: { role } } } : { Item: undefined };
      }
      return {};
    });
  }

  // A Driver assignment records the *employer* on the Profile row. Rule B is
  // about the token claim, and the claim is still never written — see
  // directory-scope.ts for why the directory needs the second field.
  it("records a Driver's employer instead of a company", async () => {
    callerIs();
    targetHas({});
    targetRoleIs("driver");
    const res = await handleCompanyAssignmentRequest(
      post({ userId: "user-9", companyId: ACME, companyName: "Acme Logistics" }),
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ scope: "employer" });

    const update = dynamoSend.mock.calls
      .map(([c]) => c as { constructor: { name: string }; input: Record<string, unknown> })
      .find((c) => String(c.input?.UpdateExpression ?? "").includes("employerId"));
    expect(update?.input.ExpressionAttributeNames).toMatchObject({
      "#employerId": "employerCompanyId",
    });
    expect(update?.input.ExpressionAttributeValues).toMatchObject({ ":employerId": ACME });
  });

  it("never writes the Cognito company claim for a Driver", async () => {
    callerIs();
    targetHas({});
    targetRoleIs("driver");
    await handleCompanyAssignmentRequest(
      post({ userId: "user-9", companyId: ACME, companyName: "Acme Logistics" }),
    );

    // This is the whole of Rule B: no claim, so requireCompanyId still fails
    // closed for them and no tenant-scoped query will ever return their rows.
    const wroteAttributes = cognitoSend.mock.calls.some(
      ([c]) => (c as object).constructor.name === "AdminUpdateUserAttributesCommand",
    );
    expect(wroteAttributes).toBe(false);
  });

  it("refuses to set a Driver's employer to another company", async () => {
    callerIs();
    targetHas({});
    targetRoleIs("driver");
    const res = await handleCompanyAssignmentRequest(
      post({ userId: "user-9", companyId: RIVAL, companyName: "Rival Freight" }),
    );

    // The employer path sits below the cross-tenant guard on purpose.
    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toMatchObject({ code: "cross_company_assignment" });
  });

  // Clearing a company off someone who became a Driver is the corrective action
  // the rule wants, so removal stays available.
  it("still allows removing a company from a Driver", async () => {
    callerIs();
    targetHas({ "custom:companyId": ACME });
    targetRoleIs("driver");
    const res = await handleCompanyAssignmentRequest(post({ userId: "user-9", companyId: "" }));
    expect(res.status).toBe(200);
  });

  it("allows assignment for non-exempt roles", async () => {
    callerIs();
    targetHas({});
    targetRoleIs("dispatch");
    const res = await handleCompanyAssignmentRequest(
      post({ userId: "user-9", companyId: ACME, companyName: "Acme Logistics" }),
    );
    expect(res.status).toBe(200);
  });

  // An unreadable role must not be treated as "not a Driver".
  it("fails closed when the role cannot be read", async () => {
    callerIs();
    targetHas({});
    dynamoSend.mockRejectedValue(new Error("Dynamo unavailable"));
    const res = await handleCompanyAssignmentRequest(
      post({ userId: "user-9", companyId: ACME, companyName: "Acme Logistics" }),
    );
    expect(res.status).toBe(502);
  });
});

describe("revocation and validation", () => {
  it("bumps the session epoch so existing tokens stop being accepted", async () => {
    callerIs();
    targetHas({ "custom:companyId": ACME, "custom:sessionEpoch": "4" });
    await handleCompanyAssignmentRequest(
      post({ userId: "user-9", companyId: ACME, companyName: "Acme" }),
    );

    const update = cognitoSend.mock.calls
      .map(
        ([command]) =>
          command as { input?: { UserAttributes?: { Name: string; Value: string }[] } },
      )
      .find((c) => c.input?.UserAttributes);
    const epoch = update?.input?.UserAttributes?.find((a) => a.Name === "custom:sessionEpoch");
    expect(epoch?.Value).toBe("5");
  });

  it("starts the epoch at 1 when the user has none", async () => {
    callerIs();
    targetHas({});
    await handleCompanyAssignmentRequest(
      post({ userId: "user-9", companyId: ACME, companyName: "Acme" }),
    );
    const update = cognitoSend.mock.calls
      .map(
        ([command]) =>
          command as { input?: { UserAttributes?: { Name: string; Value: string }[] } },
      )
      .find((c) => c.input?.UserAttributes);
    expect(
      update?.input?.UserAttributes?.find((a) => a.Name === "custom:sessionEpoch")?.Value,
    ).toBe("1");
  });

  it("requires a userId", async () => {
    callerIs();
    const res = await handleCompanyAssignmentRequest(post({ companyId: ACME }));
    expect(res.status).toBe(400);
  });

  it("requires a company name when assigning", async () => {
    callerIs();
    const res = await handleCompanyAssignmentRequest(post({ userId: "u", companyId: ACME }));
    expect(res.status).toBe(400);
  });

  it("rejects an oversized company name", async () => {
    callerIs();
    const res = await handleCompanyAssignmentRequest(
      post({ userId: "u", companyId: ACME, companyName: "x".repeat(500) }),
    );
    expect(res.status).toBe(400);
  });

  it("rejects a malformed body", async () => {
    callerIs();
    const res = await handleCompanyAssignmentRequest(
      new Request("https://example.test/api/admin/company-assignment", {
        method: "POST",
        body: "not json",
      }),
    );
    expect(res.status).toBe(400);
  });
});
