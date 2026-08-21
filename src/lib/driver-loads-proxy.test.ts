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
vi.mock("@/lib/inventory-proxy", () => ({
  syncLoadInventoryForTenant: vi.fn().mockResolvedValue({ ok: true }),
}));

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

/**
 * The PATCH path reads the stored load before writing it — it needs the real
 * record to derive `loadStatus`, validate a document's reference and pick the
 * appointment window. So the mock answers by command type rather than returning one
 * shape for every call: a Query gets the stored row, an Update gets the result.
 */
const ASSIGNED: Record<string, unknown> = { loadId: "L-1", assignedDriver: DRIVER };

function respond(
  opts: { stored?: Record<string, unknown> | null; updated?: Record<string, unknown> } = {},
) {
  const stored = opts.stored === undefined ? ASSIGNED : opts.stored;
  send.mockReset().mockImplementation(async (command: { constructor: { name: string } }) => {
    const kind = command?.constructor?.name;
    // The PATCH path reads the base table consistently (Get); the list/detail
    // endpoints read the assignedDriver GSI (Query).
    if (kind === "GetCommand") return { Item: stored ?? undefined };
    if (kind === "QueryCommand") return { Items: stored ? [stored] : [] };
    if (kind === "UpdateCommand")
      return { Attributes: opts.updated ?? stored ?? { loadId: "L-1" } };
    return {};
  });
}

function sentCommand(name: string) {
  return send.mock.calls
    .map(([c]) => c as { constructor: { name: string }; input: Record<string, unknown> })
    .find((c) => c.constructor.name === name);
}

beforeEach(() => {
  requireCurrentTenantContext.mockReset();
  respond();
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
    // The detail view reads the base table now, so the mock must answer a Get.
    respond({ stored: { loadId: "L-1", assignedDriver: DRIVER } });
    const res = await handleDriverLoadsRequest(req("GET", "/api/driver/loads/L-1"));
    expect(res.status).toBe(200);
  });

  it("404s a load assigned to a different driver", async () => {
    respond({ stored: null });
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
    respond();
    const res = await handleDriverLoadsRequest(
      req("PATCH", "/api/driver/loads/L-1", {
        driverWorkflowStatus: "at-pickup",
        documents: ["bol:scan.jpg"],
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
    respond();
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
    // Reassigned between the read and the write: the ConditionExpression on the
    // Update is what catches it, so the read succeeds and the write fails.
    send.mockReset().mockImplementation(async (command: { constructor: { name: string } }) => {
      const kind = command?.constructor?.name;
      if (kind === "GetCommand") return { Item: ASSIGNED };
      if (kind === "QueryCommand") return { Items: [ASSIGNED] };
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

describe("a driver may report their stage, not close the load out", () => {
  it("403s the statuses that would take a live load off the board", async () => {
    // `loadStatus` had to stay writable — a driver marking delivered is how the
    // board finds out — but it accepted any string. `completed` and `cancelled`
    // are terminal to three separate readers, so one request from a phone could
    // remove a live load from tracking and from the billing queue.
    for (const status of ["completed", "cancelled", "draft", "tendered", "booked"]) {
      send.mockClear();
      const res = await handleDriverLoadsRequest(
        req("PATCH", "/api/driver/loads/L-1", { loadStatus: status }),
      );
      expect(res.status, `${status} should be refused`).toBe(403);
      await expect(res.json()).resolves.toMatchObject({ code: "status_not_writable" });
      expect(send).not.toHaveBeenCalled();
    }
  });

  it("accepts the stages a driver actually reports", async () => {
    for (const status of ["driver-assigned", "at-pickup", "in-transit", "delivered"]) {
      respond();
      const res = await handleDriverLoadsRequest(
        req("PATCH", "/api/driver/loads/L-1", { loadStatus: status }),
      );
      expect(res.status, status).toBe(200);
    }
  });

  it("400s a workflow status the portal could never parse", async () => {
    const res = await handleDriverLoadsRequest(
      req("PATCH", "/api/driver/loads/L-1", { driverWorkflowStatus: "waiting-driver" }),
    );
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ code: "unknown_workflow_status" });
  });
});

describe("the driver's app never receives the customer side of the sheet", () => {
  const withRates = {
    loadId: "L-1",
    assignedDriver: DRIVER,
    carrierRate: "2300.00",
    customerRate: "2850.00",
    linehaulRate: "2800.00",
    pickupCity: "Dallas",
  };

  it("strips customerRate and linehaulRate from a single load", async () => {
    // Found by a driver during a live test: the write path refused `carrierRate`
    // but GET returned the whole item, so the phone could read customerRate next
    // to carrierRate — the brokerage's margin, on every load.
    respond({ stored: withRates });
    const res = await handleDriverLoadsRequest(req("GET", "/api/driver/loads/L-1"));
    const body = (await res.json()) as { load: Record<string, unknown> };
    expect(body.load.customerRate).toBeUndefined();
    expect(body.load.linehaulRate).toBeUndefined();
    // Their own pay stays — the offer card needs it and they are entitled to it.
    expect(body.load.carrierRate).toBe("2300.00");
    expect(body.load.pickupCity).toBe("Dallas");
  });

  it("strips them from the list too, not just the detail view", async () => {
    // The list endpoint was the worse leak: margin on every load without opening one.
    respond({ stored: withRates });
    const res = await handleDriverLoadsRequest(req("GET", "/api/driver/loads"));
    const body = (await res.json()) as { loads: Record<string, unknown>[] };
    expect(body.loads[0]?.customerRate).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain("2850");
  });

  it("strips them from the PATCH response", async () => {
    respond({ stored: withRates });
    const res = await handleDriverLoadsRequest(
      req("PATCH", "/api/driver/loads/L-1", { driverWorkflowStatus: "at-pickup" }),
    );
    expect(JSON.stringify(await res.json())).not.toContain("2850");
  });

  it("drops any unrecognised attribute, so a new rate column cannot leak by default", () => {
    // The allowlist is the point: a denylist would ship the next economic field.
    send.mockReset().mockResolvedValue({
      Items: [{ ...withRates, someNewMarginField: "999" }],
    });
    return handleDriverLoadsRequest(req("GET", "/api/driver/loads/L-1"))
      .then((r) => r.json())
      .then((body) => {
        expect(JSON.stringify(body)).not.toContain("someNewMarginField");
        expect(JSON.stringify(body)).not.toContain("999");
      });
  });
});

describe("status aliases are accepted, not 403'd", () => {
  it("accepts en-route-delivery, which is in-transit under another spelling", async () => {
    // The first cut compared raw strings: `in-transit` passed and
    // `en-route-delivery` 403'd, so a driver tapping "departing shipper" got a
    // permission error on a status they were entitled to set.
    for (const spelling of ["en-route-delivery", "en_route_delivery", "in-transit"]) {
      respond();
      const res = await handleDriverLoadsRequest(
        req("PATCH", "/api/driver/loads/L-1", { loadStatus: spelling }),
      );
      expect(res.status, spelling).toBe(200);
    }
  });

  it("accepts en-route-pickup, which canonicalises to dispatched", async () => {
    respond();
    const res = await handleDriverLoadsRequest(
      req("PATCH", "/api/driver/loads/L-1", { loadStatus: "en-route-pickup" }),
    );
    expect(res.status).toBe(200);
  });

  it("stores the canonical spelling, so one status has one representation", async () => {
    respond();
    await handleDriverLoadsRequest(
      req("PATCH", "/api/driver/loads/L-1", { loadStatus: "en-route-delivery" }),
    );
    const call = sentCommand("UpdateCommand") as unknown as {
      input: { ExpressionAttributeValues: Record<string, unknown> };
    };
    expect(Object.values(call.input.ExpressionAttributeValues)).toContain("in-transit");
  });

  it("still refuses a genuinely out-of-scope status through any spelling", async () => {
    for (const spelling of ["completed", "cancelled", "canceled"]) {
      respond();
      const res = await handleDriverLoadsRequest(
        req("PATCH", "/api/driver/loads/L-1", { loadStatus: spelling }),
      );
      expect(res.status, spelling).toBe(403);
    }
  });

  it("400s a status that is not a status at all", async () => {
    const res = await handleDriverLoadsRequest(
      req("PATCH", "/api/driver/loads/L-1", { loadStatus: "en-route-mars" }),
    );
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ code: "unknown_status" });
  });
});

describe("status history is recorded server-side, not left to the client", () => {
  /** The list_append clause the update builds, if any. */
  function historyClause() {
    // The Update, not the Query — a PATCH reads the load before writing it.
    const call = sentCommand("UpdateCommand") as unknown as {
      input: { UpdateExpression: string; ExpressionAttributeValues: Record<string, unknown> };
    };
    return call.input;
  }

  it("appends an entry when the client reports a status but sends no history", async () => {
    // Found in a live run: a client that never sent `driverStatusHistory` produced
    // a delivered load with no record of the run at all — the exact thing a late
    // delivery or detention claim is argued from.
    respond();
    await handleDriverLoadsRequest(
      req("PATCH", "/api/driver/loads/L-1", { driverWorkflowStatus: "at-pickup" }),
    );
    const input = historyClause();
    expect(input.UpdateExpression).toContain("list_append");
    const entry = (
      input.ExpressionAttributeValues[":historyEntry"] as Record<string, unknown>[]
    )[0]!;
    expect(entry.status).toBe("at-pickup");
    // Attributed to the token's subject, not to anything the client supplied.
    expect(entry.by).toBe(DRIVER);
    expect(entry.serverAt).toBeTypeOf("string");
  });

  it("appends rather than overwriting, so a reconnecting phone cannot erase the trail", async () => {
    respond();
    await handleDriverLoadsRequest(
      req("PATCH", "/api/driver/loads/L-1", { driverWorkflowStatus: "delivered" }),
    );
    // if_not_exists seeds an empty list; two concurrent updates both land.
    expect(historyClause().UpdateExpression).toContain("if_not_exists");
  });

  it("records a loadStatus-only report too", async () => {
    respond();
    await handleDriverLoadsRequest(
      req("PATCH", "/api/driver/loads/L-1", { loadStatus: "at-delivery" }),
    );
    expect(historyClause().UpdateExpression).toContain("list_append");
  });

  it("refuses a client-supplied trail outright", async () => {
    // The first version of this fix accepted the client's array and only filled in
    // a missing `serverAt`. A driver found the hole in minutes: supplying
    // `serverAt` and `by` got them trusted verbatim, and because the update
    // assigned the array rather than appending, one request replaced the whole
    // trail — four recorded stops became one entry dated 2020, attributed to
    // someone else, HTTP 200. Worse than no history, because dispatch trusts it.
    const res = await handleDriverLoadsRequest(
      req("PATCH", "/api/driver/loads/L-1", {
        driverStatusHistory: [
          {
            status: "delivered",
            at: "2020-01-01T00:00:00.000Z",
            serverAt: "2020-01-01T00:00:00.000Z",
            by: "driver-someone-else",
            source: "forged",
          },
        ],
      }),
    );
    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toMatchObject({ code: "server_owned_field" });
    expect(send).not.toHaveBeenCalled();
  });

  it("refuses it even alongside a legitimate status report", async () => {
    // The whole patch goes, so a forged trail cannot ride along with a real tap.
    const res = await handleDriverLoadsRequest(
      req("PATCH", "/api/driver/loads/L-1", {
        driverWorkflowStatus: "at-pickup",
        driverStatusHistory: [{ status: "delivered", at: "2020-01-01T00:00:00.000Z" }],
      }),
    );
    expect(res.status).toBe(403);
    expect(send).not.toHaveBeenCalled();
  });

  it("appends on every status report, so the trail cannot be skipped", async () => {
    // Previously the append was conditional on the client not sending history,
    // which meant a client that always sent it was never recorded by the server.
    respond();
    await handleDriverLoadsRequest(
      req("PATCH", "/api/driver/loads/L-1", { driverWorkflowStatus: "loaded" }),
    );
    expect(historyClause().UpdateExpression).toContain("list_append");
  });

  it("does not append when nothing about status changed", async () => {
    respond();
    await handleDriverLoadsRequest(
      req("PATCH", "/api/driver/loads/L-1", { documents: ["pod:signed.jpg"] }),
    );
    expect(historyClause().UpdateExpression).not.toContain("list_append");
  });
});

describe("the index is a candidate list; the base table decides", () => {
  /** Serve the GSI and the base table independently, so they can disagree. */
  type Row = Record<string, unknown>;
  function indexSays(indexRows: Row[], tableRows: Row[]) {
    send.mockReset().mockImplementation(async (command: any) => {
      const kind = command?.constructor?.name;
      if (kind === "QueryCommand") return { Items: indexRows };
      if (kind === "GetCommand") {
        return { Item: tableRows.find((r) => r.loadId === command.input.Key.loadId) };
      }
      return {};
    });
  }

  const loadIds = async (res: Response) =>
    (((await res.json()) as { loads?: Row[] }).loads ?? []).map((l) => l.loadId);

  it("drops a load that was reassigned away but is still in the index", async () => {
    // The direction I first filed as a mere availability nit, and it is the one
    // that leaks: a stale index entry hands the previous driver a load that is no
    // longer theirs — addresses, receiver contact, carrier rate.
    indexSays(
      [{ loadId: "L-1" }, { loadId: "L-2" }],
      [
        { loadId: "L-1", assignedDriver: DRIVER },
        { loadId: "L-2", assignedDriver: "someone-else" },
      ],
    );
    const res = await handleDriverLoadsRequest(req("GET", "/api/driver/loads"));
    expect(await loadIds(res)).toEqual(["L-1"]);
  });

  it("confirms against the base table consistently", async () => {
    indexSays([{ loadId: "L-1" }], [{ loadId: "L-1", assignedDriver: DRIVER }]);
    await handleDriverLoadsRequest(req("GET", "/api/driver/loads"));
    expect(sentCommand("GetCommand")?.input).toMatchObject({ ConsistentRead: true });
  });

  it("uses only actions the server principal actually holds", async () => {
    // The first version confirmed with BatchGetItem, which is absent from the
    // server principal's policy — so every list request 502'd the moment it
    // shipped. A correctness fix that needs an out-of-band IAM deploy is broken
    // everywhere that deploy has not happened.
    indexSays(
      [{ loadId: "L-1" }, { loadId: "L-2" }],
      [
        { loadId: "L-1", assignedDriver: DRIVER },
        { loadId: "L-2", assignedDriver: DRIVER },
      ],
    );
    await handleDriverLoadsRequest(req("GET", "/api/driver/loads"));
    const used = new Set(
      send.mock.calls.map(([c]) => (c as { constructor: { name: string } }).constructor.name),
    );
    expect([...used].sort()).toEqual(["GetCommand", "QueryCommand"]);
  });

  it("drops a load the index still lists but the table no longer has", async () => {
    indexSays([{ loadId: "L-1" }, { loadId: "GONE" }], [{ loadId: "L-1", assignedDriver: DRIVER }]);
    const res = await handleDriverLoadsRequest(req("GET", "/api/driver/loads"));
    expect(await loadIds(res)).toEqual(["L-1"]);
  });

  it("confirms every candidate, not just the first page", async () => {
    const many = Array.from({ length: 23 }, (_u, n) => `L-${n}`);
    indexSays(
      many.map((loadId) => ({ loadId })),
      many.map((loadId) => ({ loadId, assignedDriver: DRIVER })),
    );
    const res = await handleDriverLoadsRequest(req("GET", "/api/driver/loads"));
    expect((await loadIds(res)).length).toBe(23);
  });

  it("does not hit the base table at all when the index is empty", async () => {
    indexSays([], []);
    const res = await handleDriverLoadsRequest(req("GET", "/api/driver/loads"));
    expect(await loadIds(res)).toEqual([]);
    expect(sentCommand("GetCommand")).toBeUndefined();
  });

  it("reads the detail view from the base table, not the index", async () => {
    // Same staleness both ways, and we already hold the primary key — a
    // Query+Filter over the whole partition was wasteful as well as stale.
    indexSays([{ loadId: "L-1" }], [{ loadId: "L-1", assignedDriver: DRIVER }]);
    const res = await handleDriverLoadsRequest(req("GET", "/api/driver/loads/L-1"));
    expect(res.status).toBe(200);
    expect(sentCommand("GetCommand")?.input).toMatchObject({ ConsistentRead: true });
    expect(sentCommand("QueryCommand")).toBeUndefined();
  });

  it("404s the detail view for a load reassigned away", async () => {
    indexSays([{ loadId: "L-1" }], [{ loadId: "L-1", assignedDriver: "someone-else" }]);
    expect((await handleDriverLoadsRequest(req("GET", "/api/driver/loads/L-1"))).status).toBe(404);
  });
});

describe("a freshly assigned load is writable immediately", () => {
  it("reads the base table consistently, not the eventually-consistent index", async () => {
    // Found on real DynamoDB: the pre-write read went through
    // `assignedDriver-index`, a GSI. For a window after dispatch assigns a load
    // the index does not carry it yet, so a driver tapping accept got
    // "404 Load not found" on a load that was genuinely theirs. The previous code
    // went straight to the conditional Update, which reads the base table — so
    // adding the GSI read introduced the regression.
    respond();
    await handleDriverLoadsRequest(
      req("PATCH", "/api/driver/loads/L-1", { driverWorkflowStatus: "assigned" }),
    );
    const get = sentCommand("GetCommand");
    expect(get, "the pre-write read must be a base-table Get").toBeDefined();
    expect(get?.input).toMatchObject({ Key: { loadId: "L-1" }, ConsistentRead: true });
    // And nothing in the write path may consult the index.
    expect(sentCommand("QueryCommand")).toBeUndefined();
  });

  it("still 404s a load belonging to another driver", async () => {
    // The consistent read checks assignedDriver in code; the boundary is still the
    // ConditionExpression, but this must not become an information leak either.
    respond({ stored: { loadId: "L-1", assignedDriver: "someone-else" } });
    const res = await handleDriverLoadsRequest(
      req("PATCH", "/api/driver/loads/L-1", { driverWorkflowStatus: "assigned" }),
    );
    expect(res.status).toBe(404);
    expect(sentCommand("UpdateCommand")).toBeUndefined();
  });
});

describe("loadStatus moves with the driver's step — one fact, one answer", () => {
  /**
   * The value written to a named attribute, or undefined if it was not written.
   *
   * Resolves `#aN` -> attribute name -> `:aN` value. Asserting on the bare value
   * list proves nothing here: the driver's step and the derived `loadStatus` are
   * frequently the same string, so "the values contain at-pickup" is true even when
   * only `driverWorkflowStatus` was set.
   */
  function writtenAttr(attribute: string) {
    const call = sentCommand("UpdateCommand") as unknown as {
      input: {
        ExpressionAttributeNames: Record<string, string>;
        ExpressionAttributeValues: Record<string, unknown>;
      };
    };
    const alias = Object.entries(call.input.ExpressionAttributeNames).find(
      ([, name]) => name === attribute,
    )?.[0];
    if (!alias) return undefined;
    return call.input.ExpressionAttributeValues[alias.replace("#", ":")];
  }

  it("advances loadStatus when the driver reports a step", async () => {
    // The desync behind three separate defects: the driver writes
    // driverWorkflowStatus, every guard and the billing queue read loadStatus, and
    // nothing kept them in step.
    respond({ stored: { ...ASSIGNED, loadStatus: "driver-assigned" } });
    await handleDriverLoadsRequest(
      req("PATCH", "/api/driver/loads/L-1", { driverWorkflowStatus: "at-pickup" }),
    );
    expect(writtenAttr("loadStatus")).toBe("at-pickup");
  });

  it("carries a delivery through to loadStatus, which is what makes it billable", async () => {
    respond({ stored: { ...ASSIGNED, loadStatus: "in-transit" } });
    await handleDriverLoadsRequest(
      req("PATCH", "/api/driver/loads/L-1", { driverWorkflowStatus: "delivered" }),
    );
    expect(writtenAttr("loadStatus")).toBe("delivered");
  });

  it("maps the driver's vocabulary onto the lifecycle's", async () => {
    for (const [from, step, expected] of [
      ["tendered", "assigned", "driver-assigned"],
      ["driver-assigned", "en-route-pickup", "dispatched"],
      ["at-pickup", "en-route-delivery", "in-transit"],
    ] as const) {
      respond({ stored: { ...ASSIGNED, loadStatus: from } });
      await handleDriverLoadsRequest(
        req("PATCH", "/api/driver/loads/L-1", { driverWorkflowStatus: step }),
      );
      expect(writtenAttr("loadStatus"), step).toBe(expected);
    }
  });

  it("never walks loadStatus backwards on a replayed report", async () => {
    // A queued mutation replaying after a dead zone must not reopen a delivered load.
    respond({ stored: { ...ASSIGNED, loadStatus: "delivered" } });
    await handleDriverLoadsRequest(
      req("PATCH", "/api/driver/loads/L-1", { driverWorkflowStatus: "at-pickup" }),
    );
    expect(writtenAttr("loadStatus")).toBeUndefined();
  });

  it("leaves a terminal load alone", async () => {
    respond({ stored: { ...ASSIGNED, loadStatus: "completed" } });
    await handleDriverLoadsRequest(
      req("PATCH", "/api/driver/loads/L-1", { driverWorkflowStatus: "delivered" }),
    );
    expect(writtenAttr("loadStatus")).toBeUndefined();
  });

  it("does not override an explicit loadStatus in the same patch", async () => {
    respond({ stored: { ...ASSIGNED, loadStatus: "driver-assigned" } });
    await handleDriverLoadsRequest(
      req("PATCH", "/api/driver/loads/L-1", {
        driverWorkflowStatus: "at-pickup",
        loadStatus: "active",
      }),
    );
    expect(writtenAttr("loadStatus")).toBe("active");
  });

  it("writes no loadStatus for a decline — what happens next is dispatch's call", async () => {
    respond({ stored: { ...ASSIGNED, loadStatus: "driver-assigned" } });
    await handleDriverLoadsRequest(
      req("PATCH", "/api/driver/loads/L-1", { driverWorkflowStatus: "declined" }),
    );
    expect(writtenAttr("loadStatus")).toBeUndefined();
  });
});

describe("a POD has to belong to the load it is filed against", () => {
  const load = { ...ASSIGNED, deliveryReference: "BOL-999999", pickupReference: "PO-88213" };

  it("refuses a document carrying another load's reference", async () => {
    // A driver filed pod:BOL-556731-signed.jpg against a load whose reference was
    // BOL-999999 and nothing objected. That is how a POD gets kicked back by AP and
    // payment sits another thirty days, with the load looking fully documented.
    respond({ stored: load });
    const res = await handleDriverLoadsRequest(
      req("PATCH", "/api/driver/loads/L-1", { documents: ["pod:BOL-556731-signed.jpg"] }),
    );
    expect(res.status).toBe(409);
    const body = (await res.json()) as { code: string; error: string };
    expect(body.code).toBe("document_reference_mismatch");
    // The message names what it expected, so the driver can act on it.
    expect(body.error).toContain("BOL-999999");
  });

  it("accepts a document carrying the load's own reference", async () => {
    respond({ stored: load });
    const res = await handleDriverLoadsRequest(
      req("PATCH", "/api/driver/loads/L-1", { documents: ["pod:BOL-999999-signed.jpg"] }),
    );
    expect(res.status).toBe(200);
  });

  it("accepts a match on the pickup reference too", async () => {
    respond({ stored: load });
    const res = await handleDriverLoadsRequest(
      req("PATCH", "/api/driver/loads/L-1", { documents: ["bol:PO-88213.jpg"] }),
    );
    expect(res.status).toBe(200);
  });

  it("accepts a filename with no reference in it at all", async () => {
    // Deliberately narrow. Blocking `signed-pod.jpg` would delay exactly the
    // payment this is meant to protect.
    respond({ stored: load });
    for (const name of ["pod:signed.jpg", "photo.jpg", "pod:scan"]) {
      const res = await handleDriverLoadsRequest(
        req("PATCH", "/api/driver/loads/L-1", { documents: [name] }),
      );
      expect(res.status, name).toBe(200);
    }
  });

  it("does not re-judge documents already on the load", async () => {
    // Re-sending the existing list is routine and must not start failing.
    respond({ stored: { ...load, documents: ["pod:BOL-556731-signed.jpg"] } });
    const res = await handleDriverLoadsRequest(
      req("PATCH", "/api/driver/loads/L-1", {
        documents: ["pod:BOL-556731-signed.jpg", "bol:BOL-999999.jpg"],
      }),
    );
    expect(res.status).toBe(200);
  });

  it("accepts anything when the load carries no reference to compare against", async () => {
    respond({ stored: { loadId: "L-1", assignedDriver: DRIVER } });
    const res = await handleDriverLoadsRequest(
      req("PATCH", "/api/driver/loads/L-1", { documents: ["pod:BOL-556731.jpg"] }),
    );
    expect(res.status).toBe(200);
  });
});

describe("a driver can report a problem they are not allowed to fix", () => {
  function issueEntry() {
    const call = sentCommand("UpdateCommand") as unknown as {
      input: { UpdateExpression: string; ExpressionAttributeValues: Record<string, unknown> };
    };
    return {
      expression: call.input.UpdateExpression,
      entry: (
        call.input.ExpressionAttributeValues[":issueEntry"] as Record<string, unknown>[]
      )?.[0],
    };
  }

  it("turns reportIssue into an attributed exception entry", async () => {
    // They are refused `deliveryReference` — correctly, the invoice reconciles on
    // it — but they are the only person holding the physical BOL.
    respond();
    const res = await handleDriverLoadsRequest(
      req("PATCH", "/api/driver/loads/L-1", {
        reportIssue: { kind: "reference-mismatch", detail: "BOL in my hand reads BOL-556731" },
      }),
    );
    expect(res.status).toBe(200);
    const { expression, entry } = issueEntry();
    expect(expression).toContain("list_append");
    expect(entry.kind).toBe("reference-mismatch");
    expect(entry.detail).toContain("BOL-556731");
    expect(entry.by).toBe(DRIVER);
    expect(entry.status).toBe("open");
  });

  it("accepts a bare string", async () => {
    respond();
    const res = await handleDriverLoadsRequest(
      req("PATCH", "/api/driver/loads/L-1", { reportIssue: "receiver refused two pallets" }),
    );
    expect(res.status).toBe(200);
    expect(issueEntry().entry.kind).toBe("other");
  });

  it("never stores reportIssue as an attribute of its own", async () => {
    respond();
    await handleDriverLoadsRequest(
      req("PATCH", "/api/driver/loads/L-1", { reportIssue: "dock turned me away" }),
    );
    const call = sentCommand("UpdateCommand") as unknown as {
      input: { ExpressionAttributeNames: Record<string, string> };
    };
    expect(Object.values(call.input.ExpressionAttributeNames)).not.toContain("reportIssue");
  });

  it("400s an empty report", async () => {
    respond();
    for (const bad of ["", "   ", { kind: "x" }]) {
      const res = await handleDriverLoadsRequest(
        req("PATCH", "/api/driver/loads/L-1", { reportIssue: bad }),
      );
      expect(res.status, JSON.stringify(bad)).toBe(400);
    }
  });

  it("refuses a driver writing the exceptions trail directly", async () => {
    const res = await handleDriverLoadsRequest(
      req("PATCH", "/api/driver/loads/L-1", {
        driverExceptions: [{ detail: "forged", by: "someone-else" }],
      }),
    );
    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toMatchObject({ code: "server_owned_field" });
  });
});

describe("on-time performance is recorded against the appointment window", () => {
  const withWindow = {
    ...ASSIGNED,
    deliveryWindowStart: "2026-08-16T06:00:00-05:00",
    deliveryWindowEnd: "2026-08-16T07:00:00-05:00",
  };

  function historyEntry() {
    const call = sentCommand("UpdateCommand") as unknown as {
      input: { ExpressionAttributeValues: Record<string, unknown> };
    };
    return (call.input.ExpressionAttributeValues[":historyEntry"] as Record<string, unknown>[])[0]!;
  }

  it("stamps the variance on a delivery report", async () => {
    // Reported two days before the appointment and accepted in silence. On-time
    // percentage, detention and late fees are all computed off this timestamp.
    respond({ stored: withWindow });
    const res = await handleDriverLoadsRequest(
      req("PATCH", "/api/driver/loads/L-1", { driverWorkflowStatus: "delivered" }),
    );
    // Recorded, never refused — refusing would lose the event entirely.
    expect(res.status).toBe(200);
    const entry = historyEntry();
    expect(entry.onTime).toBe(false);
    expect(entry.varianceMinutes).toBeTypeOf("number");
  });

  it("omits the variance when the load carries no window", async () => {
    // Absent rather than "on time" — a missing appointment must not launder into a
    // clean statistic.
    respond();
    await handleDriverLoadsRequest(
      req("PATCH", "/api/driver/loads/L-1", { driverWorkflowStatus: "delivered" }),
    );
    expect(historyEntry()).not.toHaveProperty("onTime");
  });

  it("omits it for steps with no appointment to measure", async () => {
    respond({ stored: withWindow });
    await handleDriverLoadsRequest(
      req("PATCH", "/api/driver/loads/L-1", { driverWorkflowStatus: "en-route-delivery" }),
    );
    expect(historyEntry()).not.toHaveProperty("onTime");
  });
});

describe("server time is stamped onto driver-reported events", () => {
  it("builds the history entry itself, so its timestamp cannot come from the phone", async () => {
    // Every timestamp used to come from the device. A phone hours off does not just
    // mislabel events, it reorders them — and the derive reads "latest".
    respond();
    await handleDriverLoadsRequest(
      req("PATCH", "/api/driver/loads/L-1", { driverWorkflowStatus: "at-pickup" }),
    );
    const call = sentCommand("UpdateCommand") as unknown as {
      input: { ExpressionAttributeValues: Record<string, unknown> };
    };
    const entry = (
      call.input.ExpressionAttributeValues[":historyEntry"] as Record<string, unknown>[] | undefined
    )?.[0];
    expect(entry?.serverAt).toBeTypeOf("string");
    expect(Date.parse(entry!.serverAt as string)).toBeGreaterThan(Date.parse("2025-01-01"));
    expect(entry?.by).toBe(DRIVER);
  });

  it("stamps a GPS ping without overwriting its device time", async () => {
    respond();
    await handleDriverLoadsRequest(
      req("PATCH", "/api/driver/loads/L-1", {
        driverGps: { lat: 32.7, lng: -96.8, lastPingAt: "2020-01-01T00:00:00.000Z" },
      }),
    );
    const call = sentCommand("UpdateCommand") as unknown as {
      input: { ExpressionAttributeValues: Record<string, unknown> };
    };
    const ping = Object.values(call.input.ExpressionAttributeValues).find(
      (v) => v && typeof v === "object" && "lat" in (v as object),
    ) as { lastPingAt: string; serverAt?: string };
    expect(ping.lastPingAt).toBe("2020-01-01T00:00:00.000Z");
    expect(ping.serverAt).toBeTypeOf("string");
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
