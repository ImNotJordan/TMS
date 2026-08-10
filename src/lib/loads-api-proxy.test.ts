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

const { handleLoadsApiRequest, isLoadsApiRequest } = await import("@/lib/loads-api-proxy");
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

function signedInAt(companyId: string | null = ACME) {
  requireCurrentTenantContext.mockResolvedValue({
    userId: "user-1",
    role: "Dispatcher",
    companyId,
    isTenantExempt: false,
    isPlatformAdmin: false,
    sessionEpoch: null,
  });
}

beforeEach(() => {
  requireCurrentTenantContext.mockReset();
  send.mockReset().mockResolvedValue({});
  signedInAt();
});

describe("routing", () => {
  it("claims the collection and item paths", () => {
    expect(isLoadsApiRequest(new URL("https://x.test/api/loads"))).toBe(true);
    expect(isLoadsApiRequest(new URL("https://x.test/api/loads/L-1"))).toBe(true);
    expect(isLoadsApiRequest(new URL("https://x.test/api/loadsomething"))).toBe(false);
    expect(isLoadsApiRequest(new URL("https://x.test/api/other"))).toBe(false);
  });
});

describe("authentication and tenancy", () => {
  it("401s an unauthenticated caller", async () => {
    const { CognitoRequestAuthFailure } = await import("@/lib/ai/auth-failure");
    requireCurrentTenantContext.mockRejectedValueOnce(
      new CognitoRequestAuthFailure("missing_token", "no token"),
    );
    expect((await handleLoadsApiRequest(req("GET", "/api/loads"))).status).toBe(401);
  });

  // A user with no company sees nothing — never everything.
  it("403s a caller with no company, with a machine-readable code", async () => {
    requireCurrentTenantContext.mockRejectedValueOnce(new MissingTenantError());
    const res = await handleLoadsApiRequest(req("GET", "/api/loads"));
    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toMatchObject({ code: "COMPANY_ASSIGNMENT_REQUIRED" });
  });
});

describe("GET", () => {
  it("lists via the company index", async () => {
    send.mockResolvedValue({ Items: [{ loadId: "L-1", companyId: ACME }] });
    const res = await handleLoadsApiRequest(req("GET", "/api/loads"));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ loads: [{ loadId: "L-1" }] });
  });

  it("returns one load the company owns", async () => {
    send.mockResolvedValue({ Item: { loadId: "L-1", companyId: ACME } });
    const res = await handleLoadsApiRequest(req("GET", "/api/loads/L-1"));
    expect(res.status).toBe(200);
  });

  // The core BOLA case: change the id, get nothing.
  it("404s another company's load", async () => {
    send.mockResolvedValue({ Item: { loadId: "L-1", companyId: RIVAL } });
    const res = await handleLoadsApiRequest(req("GET", "/api/loads/L-1"));
    expect(res.status).toBe(404);
  });

  it("answers a foreign load exactly as a missing one", async () => {
    send.mockResolvedValue({ Item: { loadId: "L-1", companyId: RIVAL } });
    const foreign = await handleLoadsApiRequest(req("GET", "/api/loads/L-1"));
    send.mockResolvedValue({ Item: undefined });
    const missing = await handleLoadsApiRequest(req("GET", "/api/loads/nope"));

    expect(foreign.status).toBe(missing.status);
    await expect(foreign.json()).resolves.toEqual(await missing.json());
  });
});

describe("POST", () => {
  it("creates, stamping the company server-side", async () => {
    const res = await handleLoadsApiRequest(req("POST", "/api/loads", { loadId: "L-9" }));
    expect(res.status).toBe(201);
    await expect(res.json()).resolves.toMatchObject({ load: { companyId: ACME } });
  });

  // Rejected, not ignored: a silent drop leaves no trace of the attempt.
  it("400s a body carrying companyId", async () => {
    const res = await handleLoadsApiRequest(
      req("POST", "/api/loads", { loadId: "L-9", companyId: RIVAL }),
    );
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ code: "server_owned_field" });
    expect(send).not.toHaveBeenCalled();
  });

  it("400s a body carrying createdBy or timestamps", async () => {
    for (const field of ["createdBy", "createdAt", "updatedAt"]) {
      send.mockClear();
      const res = await handleLoadsApiRequest(
        req("POST", "/api/loads", { loadId: "L-9", [field]: "x" }),
      );
      expect(res.status).toBe(400);
    }
  });

  it("400s a missing loadId", async () => {
    expect((await handleLoadsApiRequest(req("POST", "/api/loads", {}))).status).toBe(400);
  });

  it("400s a malformed body", async () => {
    const bad = new Request("https://example.test/api/loads", { method: "POST", body: "nope" });
    expect((await handleLoadsApiRequest(bad)).status).toBe(400);
  });

  it("405s a POST to an item path", async () => {
    expect((await handleLoadsApiRequest(req("POST", "/api/loads/L-1", {}))).status).toBe(405);
  });
});

describe("PATCH", () => {
  it("updates a load the company owns", async () => {
    send.mockResolvedValue({ Attributes: { loadId: "L-1", companyId: ACME } });
    const res = await handleLoadsApiRequest(req("PATCH", "/api/loads/L-1", { customer: "New" }));
    expect(res.status).toBe(200);
  });

  it("400s an attempt to move a load between companies", async () => {
    const res = await handleLoadsApiRequest(req("PATCH", "/api/loads/L-1", { companyId: RIVAL }));
    expect(res.status).toBe(400);
    expect(send).not.toHaveBeenCalled();
  });

  it("404s when the scoped write matches nothing", async () => {
    send.mockImplementationOnce(async () => {
      throw Object.assign(new Error("c"), { name: "ConditionalCheckFailedException" });
    });
    const res = await handleLoadsApiRequest(req("PATCH", "/api/loads/L-1", { customer: "New" }));
    expect(res.status).toBe(404);
  });
});

describe("DELETE", () => {
  it("204s on success", async () => {
    expect((await handleLoadsApiRequest(req("DELETE", "/api/loads/L-1"))).status).toBe(204);
  });

  it("404s when the scoped delete matches nothing", async () => {
    send.mockImplementationOnce(async () => {
      throw Object.assign(new Error("c"), { name: "ConditionalCheckFailedException" });
    });
    expect((await handleLoadsApiRequest(req("DELETE", "/api/loads/L-1"))).status).toBe(404);
  });
});

describe("error hygiene", () => {
  // AWS messages carry table names and key values. None of that reaches a client.
  it("does not echo the underlying AWS error", async () => {
    send.mockImplementationOnce(async () => {
      throw Object.assign(
        new Error("User is not authorized to perform dynamodb:Query on table/Loads"),
        { name: "AccessDeniedException" },
      );
    });
    const res = await handleLoadsApiRequest(req("GET", "/api/loads"));
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: string };
    expect(body.error).not.toMatch(/dynamodb|Loads|authorized/i);
  });
});
