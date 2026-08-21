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

const { handleBiddingWorkspaceRequest, isBiddingWorkspaceRequest } =
  await import("@/lib/bidding-workspace-proxy");

const ME = "my-own-sub";
const COLLEAGUE = "a-colleague-sub";

function req(method: string, path: string, body?: unknown): Request {
  return new Request(`https://example.test${path}`, {
    method,
    ...(body === undefined
      ? {}
      : { body: JSON.stringify(body), headers: { "Content-Type": "application/json" } }),
  });
}

function signedIn() {
  requireCurrentTenantContext.mockResolvedValue({
    userId: ME,
    role: "Operations Manager",
    companyId: "acme",
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
  send.mockReset().mockResolvedValue({ Items: [] });
  signedIn();
});

describe("routing", () => {
  it("claims exactly its own path", () => {
    expect(isBiddingWorkspaceRequest(new URL("https://x.test/api/bidding-workspace"))).toBe(true);
    expect(isBiddingWorkspaceRequest(new URL("https://x.test/api/bidding-workspace/x"))).toBe(
      false,
    );
  });
});

describe("the workspace id comes from the token, never the request", () => {
  it("queries the caller's own sub", async () => {
    await handleBiddingWorkspaceRequest(req("GET", "/api/bidding-workspace"));

    // One query per record type now, each bounded — see the hardening suite.
    expect(sentCommand("QueryCommand")?.input).toMatchObject({
      KeyConditionExpression: "workspaceId = :w AND begins_with(itemKey, :prefix)",
      ExpressionAttributeValues: { ":w": ME },
    });
  });

  it("ignores a workspaceId query parameter naming a colleague", async () => {
    // This is the original bug, expressed as a request.
    await handleBiddingWorkspaceRequest(
      req("GET", `/api/bidding-workspace?workspaceId=${COLLEAGUE}`),
    );

    const values = sentCommand("QueryCommand")?.input.ExpressionAttributeValues as Record<
      string,
      string
    >;
    expect(values[":w"]).toBe(ME);
    expect(JSON.stringify(sentCommand("QueryCommand")?.input)).not.toContain(COLLEAGUE);
  });

  it("never scans", async () => {
    await handleBiddingWorkspaceRequest(req("GET", "/api/bidding-workspace"));
    expect(sentCommand("ScanCommand")).toBeUndefined();
  });

  it("pages within a record type rather than returning only the first page", async () => {
    // Quotes, searches and audit are queried concurrently, so key the mock on
    // the prefix rather than on call order.
    send.mockImplementation(async (command: { input: Record<string, unknown> }) => {
      const values = command.input.ExpressionAttributeValues as Record<string, string>;
      if (values?.[":prefix"] !== "quote#") return { Items: [] };
      if (!command.input.ExclusiveStartKey) {
        return { Items: [{ itemKey: "quote#1" }], LastEvaluatedKey: { k: 1 } };
      }
      return { Items: [{ itemKey: "quote#2" }] };
    });

    const res = await handleBiddingWorkspaceRequest(req("GET", "/api/bidding-workspace"));
    await expect(res.json()).resolves.toMatchObject({
      items: [{ itemKey: "quote#1" }, { itemKey: "quote#2" }],
    });
  });
});

describe("writes land in the caller's own workspace", () => {
  it("stamps workspaceId and createdBy from the token", async () => {
    send.mockResolvedValue({});
    await handleBiddingWorkspaceRequest(
      req("PUT", "/api/bidding-workspace", {
        itemKey: "quote#QT-1",
        recordType: "quote",
        bidAmount: 100,
        mode: "create",
      }),
    );

    expect(sentCommand("PutCommand")?.input).toMatchObject({
      Item: { workspaceId: ME, createdBy: ME, companyId: "acme" },
      ConditionExpression: "attribute_not_exists(itemKey)",
    });
  });

  it("rejects a body carrying workspaceId rather than silently correcting it", async () => {
    const res = await handleBiddingWorkspaceRequest(
      req("PUT", "/api/bidding-workspace", {
        itemKey: "quote#QT-1",
        recordType: "quote",
        workspaceId: COLLEAGUE,
      }),
    );

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ code: "server_owned_field" });
    expect(sentCommand("PutCommand")).toBeUndefined();
  });

  it("rejects a body carrying createdBy", async () => {
    const res = await handleBiddingWorkspaceRequest(
      req("PUT", "/api/bidding-workspace", {
        itemKey: "quote#QT-1",
        recordType: "quote",
        createdBy: COLLEAGUE,
      }),
    );
    expect(res.status).toBe(400);
  });

  it("refuses an itemKey whose prefix contradicts the record type", async () => {
    // Otherwise a "quote" could be filed as a search and skip the quote UI.
    const res = await handleBiddingWorkspaceRequest(
      req("PUT", "/api/bidding-workspace", { itemKey: "search#x", recordType: "quote" }),
    );

    expect(res.status).toBe(400);
    expect(sentCommand("PutCommand")).toBeUndefined();
  });

  it("refuses an unknown record type", async () => {
    const res = await handleBiddingWorkspaceRequest(
      req("PUT", "/api/bidding-workspace", { itemKey: "x#1", recordType: "sneaky" }),
    );
    expect(res.status).toBe(400);
  });

  it("maps a failed update condition to 404", async () => {
    send.mockImplementationOnce(async () => {
      throw Object.assign(new Error("no"), { name: "ConditionalCheckFailedException" });
    });
    const res = await handleBiddingWorkspaceRequest(
      req("PUT", "/api/bidding-workspace", {
        itemKey: "quote#QT-1",
        recordType: "quote",
        mode: "update",
      }),
    );
    expect(res.status).toBe(404);
  });
});

describe("deletes are scoped by key construction", () => {
  it("uses the caller's own workspace in the key", async () => {
    send.mockResolvedValue({});
    const res = await handleBiddingWorkspaceRequest(
      req("DELETE", `/api/bidding-workspace?itemKey=quote%23QT-1&workspaceId=${COLLEAGUE}`),
    );

    expect(res.status).toBe(204);
    expect(sentCommand("DeleteCommand")?.input).toMatchObject({
      Key: { workspaceId: ME, itemKey: "quote#QT-1" },
    });
  });

  it("requires an itemKey", async () => {
    const res = await handleBiddingWorkspaceRequest(req("DELETE", "/api/bidding-workspace"));
    expect(res.status).toBe(400);
    expect(send).not.toHaveBeenCalled();
  });
});

describe("fail closed", () => {
  it("denies an unauthenticated caller before any table access", async () => {
    requireCurrentTenantContext.mockRejectedValueOnce(new Error("no token"));
    const res = await handleBiddingWorkspaceRequest(req("GET", "/api/bidding-workspace"));

    expect(res.status).toBe(401);
    expect(send).not.toHaveBeenCalled();
  });

  it("denies a token with no subject rather than using a shared workspace", async () => {
    // The old client fell back to the literal "_" here.
    requireCurrentTenantContext.mockResolvedValueOnce({
      userId: "",
      role: "Operations Manager",
      companyId: "acme",
      isTenantExempt: false,
      isPlatformAdmin: false,
      sessionEpoch: null,
    });

    const res = await handleBiddingWorkspaceRequest(req("GET", "/api/bidding-workspace"));
    expect(res.status).toBe(401);
    expect(send).not.toHaveBeenCalled();
  });
});
