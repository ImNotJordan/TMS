import { beforeEach, describe, expect, it, vi } from "vitest";

const requireCurrentTenantContext = vi.fn();
const send = vi.fn();

vi.mock("@/lib/tenant/request-context", () => ({
  requireCurrentTenantContext: (...a: unknown[]) => requireCurrentTenantContext(...a),
}));
vi.mock("@/lib/server/server-dynamo", async () => {
  const actual = await vi.importActual<typeof import("@/lib/server/server-dynamo")>(
    "@/lib/server/server-dynamo",
  );
  return { ...actual, getServerDataClient: () => ({ send: (...a: unknown[]) => send(...a) }) };
});

const { handleResourceApiRequest, isResourceApiRequest } = await import("@/lib/api/resource-proxy");
const { resourceSpecs } = await import("@/lib/api/resource-registry");
const { MissingTenantError } = await import("@/lib/tenant/server-tenant-context");

const ACME = "11111111-1111-4111-8111-111111111111";
const RIVAL = "22222222-2222-4222-8222-222222222222";

function req(method: string, path: string, body?: unknown): Request {
  return new Request(`https://example.test${path}`, {
    method,
    ...(body === undefined
      ? {}
      : { body: JSON.stringify(body), headers: { "Content-Type": "application/json" } }),
  });
}

function signedIn(companyId: string | null = ACME) {
  requireCurrentTenantContext.mockResolvedValue({
    userId: "user-1",
    role: "Dispatcher",
    companyId,
    isTenantExempt: false,
    isPlatformAdmin: false,
    sessionEpoch: null,
  });
}

function sentCommand(name: string) {
  return send.mock.calls
    .map(([c]) => c as { constructor: { name: string }; input: Record<string, unknown> })
    .find((c) => c.constructor.name === name);
}

beforeEach(() => {
  requireCurrentTenantContext.mockReset();
  send.mockReset().mockResolvedValue({});
  signedIn();
});

describe("routing", () => {
  it("claims every registered resource", () => {
    for (const spec of resourceSpecs()) {
      expect(isResourceApiRequest(new URL(`https://x.test/api/${spec.name}`))).toBe(true);
      expect(isResourceApiRequest(new URL(`https://x.test/api/${spec.name}/ID-1`))).toBe(true);
    }
  });

  it("ignores unregistered paths", () => {
    for (const path of ["/api/loads", "/api/unknown", "/api", "/api/trucks/a/b", "/other"]) {
      expect(isResourceApiRequest(new URL(`https://x.test${path}`)), path).toBe(false);
    }
  });
});

/**
 * The guarantees are enforced in one place, so proving them once per resource
 * would be theatre — but proving them *across* resources catches a registry
 * entry that is wired up wrong.
 */
describe.each(resourceSpecs().map((s) => [s.name, s] as const))("%s", (_name, spec) => {
  it("lists via the company index, never a scan", async () => {
    send.mockResolvedValue({ Items: [{ [spec.idKey]: "X-1", companyId: ACME }] });
    const res = await handleResourceApiRequest(req("GET", `/api/${spec.name}`));

    expect(res.status).toBe(200);
    expect(sentCommand("ScanCommand")).toBeUndefined();
    expect(sentCommand("QueryCommand")?.input).toMatchObject({
      IndexName: "companyId-index",
      ExpressionAttributeValues: { ":companyId": ACME },
    });
    await expect(res.json()).resolves.toHaveProperty(spec.collectionKey);
  });

  it("404s another company's record", async () => {
    send.mockResolvedValue({ Item: { [spec.idKey]: "X-1", companyId: RIVAL } });
    expect((await handleResourceApiRequest(req("GET", `/api/${spec.name}/X-1`))).status).toBe(404);
  });

  it("stamps the company on create", async () => {
    const res = await handleResourceApiRequest(
      req("POST", `/api/${spec.name}`, { [spec.idKey]: "X-9" }),
    );
    expect(res.status).toBe(201);
    expect(sentCommand("PutCommand")?.input.Item).toMatchObject({ companyId: ACME });
  });

  it("400s a payload carrying companyId", async () => {
    const res = await handleResourceApiRequest(
      req("POST", `/api/${spec.name}`, { [spec.idKey]: "X-9", companyId: RIVAL }),
    );
    expect(res.status).toBe(400);
    expect(send).not.toHaveBeenCalled();
  });

  it("403s a caller with no company", async () => {
    requireCurrentTenantContext.mockRejectedValueOnce(new MissingTenantError());
    const res = await handleResourceApiRequest(req("GET", `/api/${spec.name}`));
    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toMatchObject({
      code: "COMPANY_ASSIGNMENT_REQUIRED",
    });
  });

  it("scopes deletes to the company in one statement", async () => {
    await handleResourceApiRequest(req("DELETE", `/api/${spec.name}/X-1`));
    expect(sentCommand("DeleteCommand")?.input.ConditionExpression).toContain(
      "companyId = :ctxCompany",
    );
  });
});

describe("registry integrity", () => {
  it("has unique names, tables and response keys", () => {
    const specs = resourceSpecs();
    for (const field of ["name", "tableFallback", "collectionKey", "itemKey"] as const) {
      const values = specs.map((s) => s[field]);
      expect(new Set(values).size, `${field} must be unique across resources`).toBe(values.length);
    }
  });

  // `/api/loads` has its own handler; a duplicate entry here would shadow it or
  // be shadowed by it, depending on route order.
  it("does not redeclare loads", () => {
    expect(resourceSpecs().some((s) => s.name === "loads")).toBe(false);
  });
});
