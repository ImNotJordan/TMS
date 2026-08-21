/**
 * `/api/bidding/search` and `/api/bidding/field-options`.
 *
 * The point of this endpoint is that lane aggregation stops shipping the
 * company's loads table to the browser, so the tests that matter are: it is
 * scoped to the caller's company, it projects instead of reading whole records,
 * it bounds the read, and it returns rows rather than loads.
 */
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

const {
  handleBiddingFieldOptionsRequest,
  handleBiddingSearchRequest,
  isBiddingFieldOptionsRequest,
  isBiddingSearchRequest,
} = await import("@/lib/bidding-search-proxy");

const ME = "my-own-sub";
const MY_COMPANY = "acme";

function searchRequest(body: unknown): Request {
  return new Request("https://example.test/api/bidding/search", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

function loadItem(over: Record<string, unknown> = {}) {
  return {
    loadId: "LD-1",
    createdAt: "2026-08-01T00:00:00.000Z",
    loadStatus: "delivered",
    customer: "Acme",
    broker: "Titan",
    equipmentType: "Dry Van",
    pickupCity: "Dallas",
    pickupState: "TX",
    deliveryCity: "Atlanta",
    deliveryState: "GA",
    pickupDate: new Date().toISOString().slice(0, 10),
    carrierRate: "2000",
    customerRate: "2400",
    ...over,
  };
}

const CRITERIA = {
  originCity: "Dallas",
  originState: "TX",
  destinationCity: "Atlanta",
  destinationState: "GA",
  equipmentType: "Dry Van",
};

function lastQuery() {
  return send.mock.calls
    .map(([c]) => c as { constructor: { name: string }; input: Record<string, unknown> })
    .filter((c) => c.constructor.name === "QueryCommand")
    .at(-1);
}

beforeEach(() => {
  requireCurrentTenantContext.mockReset();
  send.mockReset().mockResolvedValue({ Items: [] });
  requireCurrentTenantContext.mockResolvedValue({
    userId: ME,
    role: "Operations Manager",
    companyId: MY_COMPANY,
    isTenantExempt: false,
    isPlatformAdmin: false,
    sessionEpoch: null,
  });
});

describe("routing", () => {
  it("claims exactly its own paths and methods", () => {
    const search = new URL("https://x.test/api/bidding/search");
    const options = new URL("https://x.test/api/bidding/field-options");

    expect(isBiddingSearchRequest(search, "POST")).toBe(true);
    expect(isBiddingSearchRequest(search, "GET")).toBe(false);
    expect(isBiddingFieldOptionsRequest(options, "GET")).toBe(true);
    expect(isBiddingSearchRequest(new URL("https://x.test/api/bidding/search/x"), "POST")).toBe(
      false,
    );
  });
});

describe("tenancy", () => {
  it("queries only the caller's company", async () => {
    await handleBiddingSearchRequest(searchRequest({ criteria: CRITERIA }));

    expect(lastQuery()?.input).toMatchObject({
      IndexName: "companyId-index",
      KeyConditionExpression: "companyId = :companyId",
      ExpressionAttributeValues: { ":companyId": MY_COMPANY },
    });
  });

  it("takes the company from the token, never the body", async () => {
    await handleBiddingSearchRequest(
      searchRequest({ criteria: CRITERIA, companyId: "someone-else", options: {} }),
    );

    expect(JSON.stringify(lastQuery()?.input)).not.toContain("someone-else");
  });

  it("denies an unauthenticated caller before any table access", async () => {
    requireCurrentTenantContext.mockRejectedValueOnce(new Error("no token"));

    const res = await handleBiddingSearchRequest(searchRequest({ criteria: CRITERIA }));

    expect(res.status).toBe(401);
    expect(send).not.toHaveBeenCalled();
  });

  it("returns nothing for a token with no company rather than everything", async () => {
    requireCurrentTenantContext.mockResolvedValueOnce({
      userId: ME,
      role: "Operations Manager",
      companyId: "",
      isTenantExempt: false,
      isPlatformAdmin: false,
      sessionEpoch: null,
    });

    const res = await handleBiddingSearchRequest(searchRequest({ criteria: CRITERIA }));

    await expect(res.json()).resolves.toMatchObject({ results: [], loadsConsidered: 0 });
    expect(send).not.toHaveBeenCalled();
  });
});

describe("the payload is rows, not loads", () => {
  it("returns lane aggregates and leaves the load records on the server", async () => {
    send.mockResolvedValue({
      Items: [loadItem({ loadId: "A" }), loadItem({ loadId: "B", customerRate: "2600" })],
    });

    const res = await handleBiddingSearchRequest(searchRequest({ criteria: CRITERIA }));
    const body = (await res.json()) as {
      results: Array<Record<string, unknown>>;
      loadsConsidered: number;
      matchedLoads: number;
    };

    expect(body.results).toHaveLength(1);
    expect(body.results[0]).toMatchObject({ loadCount: 2, matchType: "exact" });
    expect(body.loadsConsidered).toBe(2);
    expect(body.matchedLoads).toBe(2);
    // The raw records never appear in the response.
    expect(JSON.stringify(body)).not.toContain("LD-1");
  });

  it("reads only the attributes the pricing engine uses", async () => {
    await handleBiddingSearchRequest(searchRequest({ criteria: CRITERIA }));

    const projection = lastQuery()?.input.ProjectionExpression as string;
    expect(projection).toContain("#carrierRate");
    expect(projection).toContain("#customerRate");
    // A LoadRecord carries ~60 attributes; this reads a fraction of them.
    expect(projection.split(", ").length).toBeLessThan(20);
    expect(lastQuery()?.input.ExpressionAttributeNames).toMatchObject({
      "#loadStatus": "loadStatus",
    });
  });

  it("carries leverage and backhaul in the same round trip", async () => {
    send.mockResolvedValue({
      Items: [
        loadItem({ loadId: "live", loadStatus: "in_transit" }),
        loadItem({ loadId: "settled" }),
      ],
    });

    const res = await handleBiddingSearchRequest(searchRequest({ criteria: CRITERIA }));
    const body = (await res.json()) as {
      similarActiveLoads: unknown[];
      backhaulCandidates: unknown[];
    };

    expect(body.similarActiveLoads).toHaveLength(1);
    expect(body.backhaulCandidates).toHaveLength(1);
  });

  it("is not cacheable — the rows carry buy rates and margins", async () => {
    const res = await handleBiddingSearchRequest(searchRequest({ criteria: CRITERIA }));
    expect(res.headers.get("cache-control")).toBe("no-store, private");
  });
});

describe("input handling", () => {
  it("coerces a hostile criteria object instead of trusting its shape", async () => {
    send.mockResolvedValue({ Items: [loadItem()] });

    const res = await handleBiddingSearchRequest(
      searchRequest({
        criteria: {
          originCity: "A".repeat(5000),
          originState: { nested: "object" },
          radiusMiles: "not a number",
          weight: -5,
        },
        options: { exactLaneMatch: "yes please" },
      }),
    );

    // No throw, no 500 — the request is normalised and answered.
    expect(res.status).toBe(200);
  });

  it("rejects an oversized body", async () => {
    const res = await handleBiddingSearchRequest(
      searchRequest({ criteria: { commodity: "A".repeat(40_000) } }),
    );

    expect(res.status).toBe(413);
    expect(send).not.toHaveBeenCalled();
  });

  it("rejects a body that is not a JSON object", async () => {
    const res = await handleBiddingSearchRequest(
      new Request("https://example.test/api/bidding/search", { method: "POST", body: "[]" }),
    );

    expect(res.status).toBe(400);
  });
});

describe("read ceiling", () => {
  it("stops paging at the scan ceiling rather than reading without bound", async () => {
    // Always hands back a full page with a continuation key.
    send.mockResolvedValue({
      Items: Array.from({ length: 10_000 }, (_, i) => loadItem({ loadId: `LD-${i}` })),
      LastEvaluatedKey: { k: 1 },
    });

    const res = await handleBiddingSearchRequest(searchRequest({ criteria: CRITERIA }));
    const body = (await res.json()) as { loadsConsidered: number; truncated: boolean };

    expect(body.loadsConsidered).toBe(50_000);
    expect(body.truncated).toBe(true);
    expect(send.mock.calls.length).toBeLessThanOrEqual(6);
  });
});

describe("field options", () => {
  it("returns distinct values rather than the loads they came from", async () => {
    send.mockResolvedValue({
      Items: [
        loadItem({ customer: "Acme", pickupState: "tx" }),
        loadItem({ customer: "Beta", pickupState: "TX", equipmentType: "Reefer" }),
      ],
    });

    const res = await handleBiddingFieldOptionsRequest(
      new Request("https://example.test/api/bidding/field-options"),
    );

    await expect(res.json()).resolves.toEqual({
      customers: ["Acme", "Beta"],
      brokers: ["Titan"],
      states: ["GA", "TX"],
      equipmentTypes: ["Dry Van", "Reefer"],
    });
  });

  it("requires a signed-in caller", async () => {
    requireCurrentTenantContext.mockRejectedValueOnce(new Error("no token"));

    const res = await handleBiddingFieldOptionsRequest(
      new Request("https://example.test/api/bidding/field-options"),
    );

    expect(res.status).toBe(401);
    expect(send).not.toHaveBeenCalled();
  });
});
