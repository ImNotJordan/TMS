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

const { handleDriverLoadsRequest, isDriverLoadsRequest } = await import("@/lib/driver-loads-proxy");

const DRIVER = "a90949fe-f051-702f-fd14-65f688a4dcc3";

function req(method: string, path: string, body?: unknown): Request {
  return new Request(`https://example.test${path}`, {
    method,
    ...(body === undefined
      ? {}
      : { body: JSON.stringify(body), headers: { "Content-Type": "application/json" } }),
  });
}

function signedInAsDriver() {
  requireCurrentTenantContext.mockResolvedValue({
    userId: DRIVER,
    role: "Driver",
    companyId: null,
    isTenantExempt: true,
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
  signedInAsDriver();
});

describe("routing", () => {
  it("claims its own paths and not the company ones", () => {
    expect(isDriverLoadsRequest(new URL("https://x.test/api/driver/loads"))).toBe(true);
    expect(isDriverLoadsRequest(new URL("https://x.test/api/driver/loads/L-1"))).toBe(true);
    expect(isDriverLoadsRequest(new URL("https://x.test/api/loads"))).toBe(false);
    expect(isDriverLoadsRequest(new URL("https://x.test/api/loads/L-1"))).toBe(false);
  });
});

describe("reads are scoped to the caller's assignments", () => {
  // A driver has no companyId, so the index query is the entire boundary.
  it("queries assignedDriver-index with the token's sub, never a scan", async () => {
    send.mockResolvedValue({ Items: [{ loadId: "L-1", assignedDriver: DRIVER }] });
    await handleDriverLoadsRequest(req("GET", "/api/driver/loads"));

    expect(sentCommand("ScanCommand")).toBeUndefined();
    expect(sentCommand("QueryCommand")?.input).toMatchObject({
      IndexName: "assignedDriver-index",
      KeyConditionExpression: "assignedDriver = :owner",
      ExpressionAttributeValues: { ":owner": DRIVER },
    });
  });

  // The driver id comes from the token, so a caller cannot ask about anyone else.
  it("ignores any driver id supplied in the request", async () => {
    send.mockResolvedValue({ Items: [] });
    await handleDriverLoadsRequest(req("GET", "/api/driver/loads?assignedDriver=someone-else"));
    expect(sentCommand("QueryCommand")?.input.ExpressionAttributeValues).toMatchObject({
      ":owner": DRIVER,
    });
  });

  it("returns an assigned load", async () => {
    send.mockResolvedValue({ Items: [{ loadId: "L-1", assignedDriver: DRIVER }] });
    const res = await handleDriverLoadsRequest(req("GET", "/api/driver/loads/L-1"));
    expect(res.status).toBe(200);
  });

  it("404s a load assigned to a different driver", async () => {
    send.mockResolvedValue({ Items: [] });
    const res = await handleDriverLoadsRequest(req("GET", "/api/driver/loads/L-1"));
    expect(res.status).toBe(404);
  });

  it("401s an unauthenticated caller", async () => {
    const { CognitoRequestAuthFailure } = await import("@/lib/ai/auth-failure");
    requireCurrentTenantContext.mockRejectedValueOnce(
      new CognitoRequestAuthFailure("missing_token", "no token"),
    );
    expect((await handleDriverLoadsRequest(req("GET", "/api/driver/loads"))).status).toBe(401);
  });
});

describe("writes are limited to driver-owned fields", () => {
  it("accepts the workflow fields", async () => {
    send.mockResolvedValue({ Attributes: { loadId: "L-1" } });
    const res = await handleDriverLoadsRequest(
      req("PATCH", "/api/driver/loads/L-1", {
        driverWorkflowStatus: "at-pickup",
        driverStatusHistory: [],
      }),
    );
    expect(res.status).toBe(200);
  });

  // The reason this endpoint exists: a driver must not be able to rewrite rates
  // on a load they are legitimately assigned.
  it("403s an attempt to change the rate", async () => {
    const res = await handleDriverLoadsRequest(
      req("PATCH", "/api/driver/loads/L-1", { customerRate: "999999" }),
    );
    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toMatchObject({ code: "field_not_writable" });
    expect(send).not.toHaveBeenCalled();
  });

  it("403s other dispatch-owned fields", async () => {
    for (const field of ["carrierRate", "customer", "assignedDriver", "trackingSession"]) {
      send.mockClear();
      const res = await handleDriverLoadsRequest(
        req("PATCH", "/api/driver/loads/L-1", { [field]: "x" }),
      );
      expect(res.status, `${field} should be refused`).toBe(403);
      expect(send).not.toHaveBeenCalled();
    }
  });

  it("refuses the whole patch when one field is disallowed", async () => {
    const res = await handleDriverLoadsRequest(
      req("PATCH", "/api/driver/loads/L-1", {
        driverWorkflowStatus: "at-pickup",
        customerRate: "1",
      }),
    );
    expect(res.status).toBe(403);
    expect(send).not.toHaveBeenCalled();
  });

  // One statement, not fetch-then-check: a load reassigned in between must not
  // be silently overwritten.
  it("conditions the write on still being assigned", async () => {
    send.mockResolvedValue({ Attributes: { loadId: "L-1" } });
    await handleDriverLoadsRequest(
      req("PATCH", "/api/driver/loads/L-1", { driverWorkflowStatus: "delivered" }),
    );
    const update = sentCommand("UpdateCommand");
    expect(update?.input.ConditionExpression).toBe(
      "attribute_exists(loadId) AND assignedDriver = :owner",
    );
    expect(update?.input.ExpressionAttributeValues).toMatchObject({ ":owner": DRIVER });
  });

  it("404s when the load is no longer assigned to them", async () => {
    send.mockImplementationOnce(async () => {
      throw Object.assign(new Error("c"), { name: "ConditionalCheckFailedException" });
    });
    const res = await handleDriverLoadsRequest(
      req("PATCH", "/api/driver/loads/L-1", { driverWorkflowStatus: "delivered" }),
    );
    expect(res.status).toBe(404);
  });

  it("405s a PATCH to the collection", async () => {
    expect((await handleDriverLoadsRequest(req("PATCH", "/api/driver/loads", {}))).status).toBe(
      405,
    );
  });

  it("405s unsupported methods", async () => {
    for (const method of ["POST", "DELETE", "PUT"]) {
      expect(
        (await handleDriverLoadsRequest(req(method, "/api/driver/loads/L-1", {}))).status,
      ).toBe(405);
    }
  });

  it("400s a malformed body", async () => {
    const bad = new Request("https://example.test/api/driver/loads/L-1", {
      method: "PATCH",
      body: "nope",
    });
    expect((await handleDriverLoadsRequest(bad)).status).toBe(400);
  });
});

describe("error hygiene", () => {
  it("does not echo the underlying AWS error", async () => {
    send.mockImplementationOnce(async () => {
      throw Object.assign(new Error("not authorized for dynamodb:Query on table/Loads"), {
        name: "AccessDeniedException",
      });
    });
    const res = await handleDriverLoadsRequest(req("GET", "/api/driver/loads"));
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: string };
    expect(body.error).not.toMatch(/dynamodb|Loads|authorized/i);
  });
});
