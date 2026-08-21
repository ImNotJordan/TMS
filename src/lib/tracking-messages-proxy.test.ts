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

const { handleTrackingMessagesRequest, isTrackingMessagesRequest } =
  await import("@/lib/tracking-messages-proxy");

const DRIVER = "a90949fe-f051-702f-fd14-65f688a4dcc3";
const OWN_COMPANY = "acme";
const OTHER_COMPANY = "globex";

function req(method: string, path: string, body?: unknown): Request {
  return new Request(`https://example.test${path}`, {
    method,
    ...(body === undefined
      ? {}
      : { body: JSON.stringify(body), headers: { "Content-Type": "application/json" } }),
  });
}

function signedInAsOps() {
  requireCurrentTenantContext.mockResolvedValue({
    userId: "ops-user",
    role: "Operations Manager",
    companyId: OWN_COMPANY,
    isTenantExempt: false,
    isPlatformAdmin: false,
    sessionEpoch: null,
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

/** The parent-load Get resolves to `load`; any later call resolves to `rest`. */
function loadIs(load: Record<string, unknown> | undefined, rest: unknown = { Items: [] }) {
  send.mockReset();
  send.mockImplementation(async (command: { constructor: { name: string } }) =>
    command.constructor.name === "GetCommand" ? { Item: load } : rest,
  );
}

function sentCommand(name: string) {
  return send.mock.calls
    .map(([c]) => c as { constructor: { name: string }; input: Record<string, unknown> })
    .find((c) => c.constructor.name === name);
}

beforeEach(() => {
  requireCurrentTenantContext.mockReset();
  send.mockReset().mockResolvedValue({});
  signedInAsOps();
});

describe("routing", () => {
  it("claims exactly its own path", () => {
    expect(isTrackingMessagesRequest(new URL("https://x.test/api/tracking-messages"))).toBe(true);
    expect(isTrackingMessagesRequest(new URL("https://x.test/api/tracking-messages/x"))).toBe(
      false,
    );
    // Must not collide with the loads handlers, which parse their own ids.
    expect(isTrackingMessagesRequest(new URL("https://x.test/api/loads/L-1"))).toBe(false);
  });
});

describe("the parent load is authorized before any message is read", () => {
  it("reads the load first, then queries messages by loadId", async () => {
    loadIs({ loadId: "L-1", companyId: OWN_COMPANY });
    const res = await handleTrackingMessagesRequest(
      req("GET", "/api/tracking-messages?loadId=L-1"),
    );

    expect(res.status).toBe(200);
    // Order matters: authorize, then read. Not read, then filter.
    expect(send.mock.calls[0][0].constructor.name).toBe("GetCommand");
    expect(sentCommand("QueryCommand")?.input).toMatchObject({
      KeyConditionExpression: "loadId = :loadId",
      ExpressionAttributeValues: { ":loadId": "L-1" },
    });
  });

  it("never scans", async () => {
    loadIs({ loadId: "L-1", companyId: OWN_COMPANY });
    await handleTrackingMessagesRequest(req("GET", "/api/tracking-messages?loadId=L-1"));
    expect(sentCommand("ScanCommand")).toBeUndefined();
  });

  it("404s on another company's load and never touches the message table", async () => {
    loadIs({ loadId: "L-9", companyId: OTHER_COMPANY });
    const res = await handleTrackingMessagesRequest(
      req("GET", "/api/tracking-messages?loadId=L-9"),
    );

    expect(res.status).toBe(404);
    expect(sentCommand("QueryCommand")).toBeUndefined();
  });

  it("404s identically for a load that does not exist", async () => {
    loadIs(undefined);
    const res = await handleTrackingMessagesRequest(
      req("GET", "/api/tracking-messages?loadId=nope"),
    );

    // Same status and same body as the foreign-load case, so the id space
    // cannot be enumerated by diffing responses.
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toMatchObject({ error: "Load not found." });
  });

  it("leaks no company identifier in the denial body", async () => {
    loadIs({ loadId: "L-9", companyId: OTHER_COMPANY });
    const res = await handleTrackingMessagesRequest(
      req("GET", "/api/tracking-messages?loadId=L-9"),
    );

    const text = await res.text();
    expect(text).not.toContain(OTHER_COMPANY);
    expect(text).not.toContain(OWN_COMPANY);
  });

  it("rejects a request with no loadId rather than returning everything", async () => {
    const res = await handleTrackingMessagesRequest(req("GET", "/api/tracking-messages"));
    expect(res.status).toBe(400);
    expect(send).not.toHaveBeenCalled();
  });
});

describe("drivers qualify by assignment, not company", () => {
  beforeEach(signedInAsDriver);

  it("allows a load assigned to them even though they have no companyId", async () => {
    loadIs({ loadId: "L-1", companyId: OWN_COMPANY, assignedDriver: DRIVER });
    const res = await handleTrackingMessagesRequest(
      req("GET", "/api/tracking-messages?loadId=L-1"),
    );

    expect(res.status).toBe(200);
    expect(sentCommand("QueryCommand")).toBeDefined();
  });

  it("404s a load assigned to a different driver", async () => {
    loadIs({ loadId: "L-2", companyId: OWN_COMPANY, assignedDriver: "someone-else" });
    const res = await handleTrackingMessagesRequest(
      req("GET", "/api/tracking-messages?loadId=L-2"),
    );

    expect(res.status).toBe(404);
    expect(sentCommand("QueryCommand")).toBeUndefined();
  });

  it("404s an unassigned load", async () => {
    loadIs({ loadId: "L-3", companyId: OWN_COMPANY });
    const res = await handleTrackingMessagesRequest(
      req("GET", "/api/tracking-messages?loadId=L-3"),
    );
    expect(res.status).toBe(404);
  });
});

describe("writes", () => {
  it("authorizes the load before writing", async () => {
    loadIs({ loadId: "L-9", companyId: OTHER_COMPANY });
    const res = await handleTrackingMessagesRequest(
      req("POST", "/api/tracking-messages", { loadId: "L-9", from: "ops", text: "hi" }),
    );

    expect(res.status).toBe(404);
    expect(sentCommand("PutCommand")).toBeUndefined();
  });

  it("stamps the real author from the token", async () => {
    loadIs({ loadId: "L-1", companyId: OWN_COMPANY });
    await handleTrackingMessagesRequest(
      req("POST", "/api/tracking-messages", { loadId: "L-1", from: "ops", text: "hi" }),
    );

    expect(sentCommand("PutCommand")?.input.Item).toMatchObject({
      loadId: "L-1",
      sentBy: "ops-user",
      from: "ops",
    });
  });

  it("refuses a driver posting as ops", async () => {
    signedInAsDriver();
    loadIs({ loadId: "L-1", assignedDriver: DRIVER });
    const res = await handleTrackingMessagesRequest(
      req("POST", "/api/tracking-messages", { loadId: "L-1", from: "ops", text: "spoofed" }),
    );

    expect(res.status).toBe(400);
    expect(sentCommand("PutCommand")).toBeUndefined();
  });

  it("still lets ops post the system sender", async () => {
    loadIs({ loadId: "L-1", companyId: OWN_COMPANY });
    const res = await handleTrackingMessagesRequest(
      req("POST", "/api/tracking-messages", { loadId: "L-1", from: "system", text: "welcome" }),
    );

    expect(res.status).toBe(201);
    expect(sentCommand("PutCommand")?.input.Item).toMatchObject({ from: "system" });
  });

  it("rejects unexpected fields rather than dropping them", async () => {
    loadIs({ loadId: "L-1", companyId: OWN_COMPANY });
    const res = await handleTrackingMessagesRequest(
      req("POST", "/api/tracking-messages", {
        loadId: "L-1",
        from: "ops",
        text: "hi",
        companyId: OTHER_COMPANY,
      }),
    );

    expect(res.status).toBe(400);
    expect(sentCommand("PutCommand")).toBeUndefined();
  });
});

describe("deletes", () => {
  it("authorizes the load first", async () => {
    loadIs({ loadId: "L-9", companyId: OTHER_COMPANY });
    const res = await handleTrackingMessagesRequest(
      req("DELETE", "/api/tracking-messages?loadId=L-9&messageId=m1"),
    );

    expect(res.status).toBe(404);
    expect(sentCommand("DeleteCommand")).toBeUndefined();
  });

  it("deletes on the caller's own load", async () => {
    loadIs({ loadId: "L-1", companyId: OWN_COMPANY });
    const res = await handleTrackingMessagesRequest(
      req("DELETE", "/api/tracking-messages?loadId=L-1&messageId=m1"),
    );

    expect(res.status).toBe(204);
    expect(sentCommand("DeleteCommand")?.input).toMatchObject({
      Key: { loadId: "L-1", messageId: "m1" },
    });
  });

  it("refuses a driver deleting from a load they are assigned to", async () => {
    signedInAsDriver();
    loadIs({ loadId: "L-1", assignedDriver: DRIVER });
    const res = await handleTrackingMessagesRequest(
      req("DELETE", "/api/tracking-messages?loadId=L-1&messageId=m1"),
    );

    // Editing the record of a load is a dispatch action, not a driver one.
    expect(res.status).toBe(404);
    expect(sentCommand("DeleteCommand")).toBeUndefined();
  });
});

describe("unauthenticated callers", () => {
  it("are denied before any table is touched", async () => {
    requireCurrentTenantContext.mockRejectedValueOnce(new Error("no token"));
    const res = await handleTrackingMessagesRequest(
      req("GET", "/api/tracking-messages?loadId=L-1"),
    );

    expect(res.status).toBe(401);
    expect(send).not.toHaveBeenCalled();
  });
});
