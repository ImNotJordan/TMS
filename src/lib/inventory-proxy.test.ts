/**
 * Handler tests for `/api/inventory`.
 *
 * Mocks the tenant context and the DynamoDB client at the same seams the
 * resource-proxy tests use, so what is under test is the handler's decisions —
 * who is refused, what is refused, and what the ledger ends up holding — not the
 * SDK.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const requireCurrentTenantContext = vi.fn();
const checkModuleAccess = vi.fn();
const hasFieldPermission = vi.fn();
const send = vi.fn();

vi.mock("@/lib/tenant/request-context", () => ({
  requireCurrentTenantContext: (...a: unknown[]) => requireCurrentTenantContext(...a),
}));

vi.mock("@/lib/tenant/module-access", () => ({
  checkModuleAccess: (...a: unknown[]) => checkModuleAccess(...a),
  hasFieldPermission: (...a: unknown[]) => hasFieldPermission(...a),
  moduleAccessResponse: (denial: { message: string; code: string; status: number }) =>
    Response.json({ error: denial.message, code: denial.code }, { status: denial.status }),
}));

vi.mock("@/lib/server/server-dynamo", async () => {
  const actual = await vi.importActual<typeof import("@/lib/server/server-dynamo")>(
    "@/lib/server/server-dynamo",
  );
  return { ...actual, getServerDataClient: () => ({ send: (...a: unknown[]) => send(...a) }) };
});

const { handleInventoryApiRequest, isInventoryApiRequest } = await import("@/lib/inventory-proxy");

const ACME = "11111111-1111-4111-8111-111111111111";
const RIVAL = "22222222-2222-4222-8222-222222222222";
const ITEM_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

type Role =
  | "Organization Owner"
  | "Admin"
  | "SuperAdmin"
  | "Operations Manager"
  | "Dispatcher"
  | "Accounting"
  | "Sales"
  | "Marketing"
  | "Broker";

function req(method: string, path: string, body?: unknown): Request {
  return new Request(`https://example.test${path}`, {
    method,
    ...(body === undefined
      ? {}
      : { body: JSON.stringify(body), headers: { "Content-Type": "application/json" } }),
  });
}

function signedIn(role: Role | null = "Operations Manager", companyId: string | null = ACME) {
  requireCurrentTenantContext.mockResolvedValue({
    userId: "user-1",
    role,
    companyId,
    isTenantExempt: false,
    isPlatformAdmin: false,
    sessionEpoch: null,
  });
}

function storedItem(overrides: Record<string, unknown> = {}) {
  return {
    itemId: ITEM_ID,
    sku: "SKU-1",
    name: "Pallet",
    warehouse: "Dallas DC",
    unitOfMeasure: "Each",
    quantityOnHand: 10,
    quantityAllocated: 2,
    reorderPoint: 5,
    reorderQuantity: 20,
    unitCost: 12.5,
    unitPrice: 20,
    status: "Active",
    companyId: ACME,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function commandsNamed(name: string) {
  return send.mock.calls
    .map(([c]) => c as { constructor: { name: string }; input: Record<string, unknown> })
    .filter((c) => c.constructor.name === name);
}

function firstCommand(name: string) {
  return commandsNamed(name)[0];
}

beforeEach(() => {
  requireCurrentTenantContext.mockReset();
  checkModuleAccess.mockReset().mockResolvedValue({ ok: true });
  hasFieldPermission.mockReset().mockResolvedValue(true);
  send.mockReset().mockResolvedValue({});
  signedIn();
});

describe("routing", () => {
  it("claims the inventory namespace", () => {
    expect(isInventoryApiRequest(new URL("https://x.test/api/inventory/items"))).toBe(true);
    expect(isInventoryApiRequest(new URL("https://x.test/api/inventory/items/ID"))).toBe(true);
    expect(isInventoryApiRequest(new URL("https://x.test/api/inventory/movements"))).toBe(true);
  });

  it("does not claim other resources", () => {
    expect(isInventoryApiRequest(new URL("https://x.test/api/loads"))).toBe(false);
    expect(isInventoryApiRequest(new URL("https://x.test/api/inventories"))).toBe(false);
  });

  it("404s an unknown inventory sub-path rather than falling through to SSR", async () => {
    const res = await handleInventoryApiRequest(req("GET", "/api/inventory/warehouses"));
    expect(res.status).toBe(404);
  });
});

describe("tenancy", () => {
  it("lists through the company index, never a scan", async () => {
    send.mockResolvedValue({ Items: [storedItem()] });
    const res = await handleInventoryApiRequest(req("GET", "/api/inventory/items"));

    expect(res.status).toBe(200);
    expect(commandsNamed("ScanCommand")).toHaveLength(0);
    const query = firstCommand("QueryCommand");
    expect(query.input.IndexName).toBe("companyId-index");
    expect(query.input.ExpressionAttributeValues).toMatchObject({ ":companyId": ACME });
  });

  it("reads another company's item as absent", async () => {
    send.mockResolvedValue({ Item: storedItem({ companyId: RIVAL }) });
    const res = await handleInventoryApiRequest(req("GET", `/api/inventory/items/${ITEM_ID}`));
    expect(res.status).toBe(404);
  });

  it("refuses a caller with no company", async () => {
    signedIn("Operations Manager", null);
    const res = await handleInventoryApiRequest(req("GET", "/api/inventory/items"));
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("COMPANY_ASSIGNMENT_REQUIRED");
  });

  it("stamps the caller's company on a create, ignoring any supplied one", async () => {
    send.mockResolvedValue({ Items: [] });
    const res = await handleInventoryApiRequest(
      req("POST", "/api/inventory/items", { sku: "NEW-1", name: "New" }),
    );

    expect(res.status).toBe(201);
    const put = firstCommand("PutCommand");
    expect((put.input.Item as Record<string, unknown>).companyId).toBe(ACME);
    expect(put.input.ConditionExpression).toContain("attribute_not_exists(itemId)");
  });

  it("scopes an update with a companyId condition", async () => {
    send.mockImplementation((command: { constructor: { name: string } }) => {
      if (command.constructor.name === "GetCommand") return { Item: storedItem() };
      if (command.constructor.name === "QueryCommand") return { Items: [storedItem()] };
      return { Attributes: storedItem({ name: "Renamed" }) };
    });

    const res = await handleInventoryApiRequest(
      req("PATCH", `/api/inventory/items/${ITEM_ID}`, { name: "Renamed" }),
    );

    expect(res.status).toBe(200);
    const update = firstCommand("UpdateCommand");
    expect(update.input.ConditionExpression).toContain("companyId = :ctxCompany");
  });
});

describe("module access gate", () => {
  it("refuses a read when the admin matrix denies the module", async () => {
    checkModuleAccess.mockResolvedValue({
      ok: false,
      status: 403,
      code: "module_forbidden",
      message: "Your access does not include Inventory.",
    });

    const res = await handleInventoryApiRequest(req("GET", "/api/inventory/items"));
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("module_forbidden");
    expect(send).not.toHaveBeenCalled();
  });

  it("asks for view on a GET and mutate on a write", async () => {
    send.mockResolvedValue({ Items: [] });
    await handleInventoryApiRequest(req("GET", "/api/inventory/items"));
    expect(checkModuleAccess.mock.calls[0][3]).toBe("view");

    checkModuleAccess.mockClear();
    await handleInventoryApiRequest(req("POST", "/api/inventory/items", { sku: "S", name: "N" }));
    expect(checkModuleAccess.mock.calls[0][3]).toBe("mutate");
  });
});

describe("role gates on the catalogue", () => {
  it.each(["Sales", "Marketing", "Broker", "Accounting"] as Role[])(
    "%s cannot create items",
    async (role) => {
      signedIn(role);
      const res = await handleInventoryApiRequest(
        req("POST", "/api/inventory/items", { sku: "S", name: "N" }),
      );
      expect(res.status).toBe(403);
      expect((await res.json()).code).toBe("role_cannot_write_inventory");
    },
  );

  it("an absent role is refused rather than defaulted", async () => {
    signedIn(null);
    const res = await handleInventoryApiRequest(
      req("POST", "/api/inventory/items", { sku: "S", name: "N" }),
    );
    expect(res.status).toBe(403);
  });

  it("a Dispatcher may maintain the catalogue but not value it", async () => {
    signedIn("Dispatcher");
    send.mockResolvedValue({ Items: [] });

    const allowed = await handleInventoryApiRequest(
      req("POST", "/api/inventory/items", { sku: "S", name: "N" }),
    );
    expect(allowed.status).toBe(201);

    const refused = await handleInventoryApiRequest(
      req("POST", "/api/inventory/items", { sku: "S2", name: "N", unitCost: 5 }),
    );
    expect(refused.status).toBe(403);
    const body = await refused.json();
    expect(body.code).toBe("role_cannot_value_inventory");
    expect(body.fields).toEqual(["unitCost"]);
  });

  it("only an owner or admin may delete", async () => {
    signedIn("Operations Manager");
    send.mockResolvedValue({ Item: storedItem({ quantityOnHand: 0, quantityAllocated: 0 }) });
    const refused = await handleInventoryApiRequest(
      req("DELETE", `/api/inventory/items/${ITEM_ID}`),
    );
    expect(refused.status).toBe(403);
    expect((await refused.json()).code).toBe("role_cannot_delete_inventory");

    signedIn("Admin");
    const allowed = await handleInventoryApiRequest(
      req("DELETE", `/api/inventory/items/${ITEM_ID}`),
    );
    expect(allowed.status).toBe(204);
  });

  it("refuses deleting a SKU that still holds stock, even for an owner", async () => {
    signedIn("Organization Owner");
    send.mockResolvedValue({ Item: storedItem({ quantityOnHand: 4 }) });

    const res = await handleInventoryApiRequest(req("DELETE", `/api/inventory/items/${ITEM_ID}`));
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("item_has_stock");
    expect(commandsNamed("DeleteCommand")).toHaveLength(0);
  });
});

describe("stock is ledger-owned", () => {
  it.each(["quantityOnHand", "quantityAllocated", "lastMovementAt", "lastCountedAt"])(
    "refuses %s on a create",
    async (field) => {
      const res = await handleInventoryApiRequest(
        req("POST", "/api/inventory/items", { sku: "S", name: "N", [field]: 500 }),
      );
      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.code).toBe("ledger_owned_field");
      expect(body.fields).toEqual([field]);
    },
  );

  it("refuses moving stock through a patch", async () => {
    send.mockResolvedValue({ Item: storedItem() });
    const res = await handleInventoryApiRequest(
      req("PATCH", `/api/inventory/items/${ITEM_ID}`, { quantityOnHand: 5000 }),
    );

    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("ledger_owned_field");
    expect(commandsNamed("UpdateCommand")).toHaveLength(0);
  });

  it("opens a new SKU at zero regardless of anything else in the payload", async () => {
    send.mockResolvedValue({ Items: [] });
    await handleInventoryApiRequest(
      req("POST", "/api/inventory/items", { sku: "S", name: "N", reorderPoint: 12 }),
    );

    const item = firstCommand("PutCommand").input.Item as Record<string, unknown>;
    expect(item.quantityOnHand).toBe(0);
    expect(item.quantityAllocated).toBe(0);
    expect(item.reorderPoint).toBe(12);
  });
});

describe("payload validation", () => {
  it("refuses server-owned fields", async () => {
    const res = await handleInventoryApiRequest(
      req("POST", "/api/inventory/items", { sku: "S", name: "N", companyId: RIVAL }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("server_owned_field");
  });

  it("requires sku and name", async () => {
    send.mockResolvedValue({ Items: [] });
    expect(
      (await handleInventoryApiRequest(req("POST", "/api/inventory/items", { name: "N" }))).status,
    ).toBe(400);
    expect(
      (await handleInventoryApiRequest(req("POST", "/api/inventory/items", { sku: "S" }))).status,
    ).toBe(400);
  });

  it("coerces numeric strings and refuses junk", async () => {
    send.mockResolvedValue({ Items: [] });
    await handleInventoryApiRequest(
      req("POST", "/api/inventory/items", { sku: "S", name: "N", reorderPoint: "25" }),
    );
    expect((firstCommand("PutCommand").input.Item as Record<string, unknown>).reorderPoint).toBe(
      25,
    );

    send.mockClear();
    const res = await handleInventoryApiRequest(
      req("POST", "/api/inventory/items", { sku: "S", name: "N", reorderPoint: "many" }),
    );
    expect(res.status).toBe(400);
  });

  it("refuses a negative reorder point", async () => {
    send.mockResolvedValue({ Items: [] });
    const res = await handleInventoryApiRequest(
      req("POST", "/api/inventory/items", { sku: "S", name: "N", reorderPoint: -1 }),
    );
    expect(res.status).toBe(400);
  });

  it("refuses an unknown status", async () => {
    send.mockResolvedValue({ Items: [] });
    const res = await handleInventoryApiRequest(
      req("POST", "/api/inventory/items", { sku: "S", name: "N", status: "Whatever" }),
    );
    expect(res.status).toBe(400);
  });

  it("drops unknown keys instead of storing them", async () => {
    send.mockResolvedValue({ Items: [] });
    await handleInventoryApiRequest(
      req("POST", "/api/inventory/items", { sku: "S", name: "N", retiredField: "x" }),
    );
    const item = firstCommand("PutCommand").input.Item as Record<string, unknown>;
    expect(item.retiredField).toBeUndefined();
  });

  it("rejects a duplicate SKU within the company", async () => {
    send.mockResolvedValue({ Items: [storedItem({ sku: "SKU-1" })] });
    const res = await handleInventoryApiRequest(
      req("POST", "/api/inventory/items", { sku: "sku-1", name: "Dup" }),
    );
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("duplicate_sku");
  });
});

describe("valuation redaction", () => {
  it("withholds cost and price from a role that may not value stock", async () => {
    signedIn("Dispatcher");
    hasFieldPermission.mockResolvedValue(false);
    send.mockResolvedValue({ Items: [storedItem()] });

    const res = await handleInventoryApiRequest(req("GET", "/api/inventory/items"));
    const body = (await res.json()) as { items: Record<string, unknown>[] };

    expect(body.items[0].sku).toBe("SKU-1");
    expect(body.items[0].unitCost).toBeUndefined();
    expect(body.items[0].unitPrice).toBeUndefined();
    // The rest of the record still comes through.
    expect(body.items[0].quantityOnHand).toBe(10);
  });

  it("returns the valuation for a role entitled to it", async () => {
    signedIn("Accounting");
    send.mockResolvedValue({ Items: [storedItem()] });

    const res = await handleInventoryApiRequest(req("GET", "/api/inventory/items"));
    const body = (await res.json()) as { items: Record<string, unknown>[] };
    expect(body.items[0].unitCost).toBe(12.5);
  });

  it("returns the valuation when the field permission grants it", async () => {
    signedIn("Dispatcher");
    hasFieldPermission.mockResolvedValue(true);
    send.mockResolvedValue({ Items: [storedItem()] });

    const res = await handleInventoryApiRequest(req("GET", "/api/inventory/items"));
    const body = (await res.json()) as { items: Record<string, unknown>[] };
    expect(body.items[0].unitCost).toBe(12.5);
  });
});

describe("movements", () => {
  /** Item read → ledger insert → conditional stock update → ledger settle. */
  function happyPath(item = storedItem()) {
    let updates = 0;
    send.mockImplementation((command: { constructor: { name: string }; input: never }) => {
      const name = command.constructor.name;
      if (name === "GetCommand") return { Item: item };
      if (name === "PutCommand") return {};
      if (name === "UpdateCommand") {
        updates += 1;
        // First update is the stock write, second settles the ledger row.
        return updates === 1
          ? { Attributes: { ...item, quantityOnHand: 16, quantityAllocated: 2 } }
          : { Attributes: { movementId: "mv", postedState: "posted" } };
      }
      return {};
    });
  }

  it("posts a receipt and returns both the movement and the item", async () => {
    happyPath();
    const res = await handleInventoryApiRequest(
      req("POST", "/api/inventory/movements", { itemId: ITEM_ID, kind: "receipt", quantity: 6 }),
    );

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.item.quantityOnHand).toBe(16);
    expect(body.movement.postedState).toBe("posted");
  });

  it("writes the ledger row before touching stock", async () => {
    happyPath();
    await handleInventoryApiRequest(
      req("POST", "/api/inventory/movements", { itemId: ITEM_ID, kind: "receipt", quantity: 6 }),
    );

    const order = send.mock.calls.map(
      ([c]) => (c as { constructor: { name: string } }).constructor.name,
    );
    expect(order.indexOf("PutCommand")).toBeLessThan(order.indexOf("UpdateCommand"));

    const ledgerRow = firstCommand("PutCommand").input.Item as Record<string, unknown>;
    expect(ledgerRow.postedState).toBe("pending");
    expect(ledgerRow.onHandDelta).toBe(6);
    expect(ledgerRow.sku).toBe("SKU-1");
    expect(ledgerRow.actorRole).toBe("Operations Manager");
    expect(ledgerRow.companyId).toBe(ACME);
  });

  it("preconditions the stock write on the levels it read", async () => {
    happyPath();
    await handleInventoryApiRequest(
      req("POST", "/api/inventory/movements", { itemId: ITEM_ID, kind: "receipt", quantity: 6 }),
    );

    const stockUpdate = commandsNamed("UpdateCommand")[0];
    const values = stockUpdate.input.ExpressionAttributeValues as Record<string, unknown>;
    // The exact prior quantities travel with the write — this is what stops two
    // concurrent movements from interleaving.
    expect(Object.values(values)).toContain(10);
    expect(stockUpdate.input.ConditionExpression).toContain("companyId = :ctxCompany");
  });

  it("refuses a movement that would oversell, before writing anything", async () => {
    send.mockResolvedValue({ Item: storedItem({ quantityOnHand: 3 }) });
    const res = await handleInventoryApiRequest(
      req("POST", "/api/inventory/movements", { itemId: ITEM_ID, kind: "shipment", quantity: 4 }),
    );

    expect(res.status).toBe(422);
    expect((await res.json()).code).toBe("insufficient_stock");
    expect(commandsNamed("PutCommand")).toHaveLength(0);
    expect(commandsNamed("UpdateCommand")).toHaveLength(0);
  });

  it("marks the ledger row rejected when the stock write loses a race", async () => {
    const conditionFailure = Object.assign(new Error("conditional"), {
      name: "ConditionalCheckFailedException",
    });
    let updates = 0;
    send.mockImplementation((command: { constructor: { name: string } }) => {
      const name = command.constructor.name;
      if (name === "GetCommand") return { Item: storedItem() };
      if (name === "PutCommand") return {};
      if (name === "UpdateCommand") {
        updates += 1;
        // The stock write fails its precondition; the follow-up marking the
        // ledger row rejected succeeds.
        if (updates === 1) throw conditionFailure;
        return { Attributes: { movementId: "mv", postedState: "rejected" } };
      }
      return {};
    });

    const res = await handleInventoryApiRequest(
      req("POST", "/api/inventory/movements", { itemId: ITEM_ID, kind: "receipt", quantity: 6 }),
    );

    expect(res.status).toBe(409);
    const marking = commandsNamed("UpdateCommand")[1];
    const values = marking.input.ExpressionAttributeValues as Record<string, unknown>;
    expect(Object.values(values)).toContain("rejected");
  });

  it("refuses a movement against another company's item", async () => {
    send.mockResolvedValue({ Item: storedItem({ companyId: RIVAL }) });
    const res = await handleInventoryApiRequest(
      req("POST", "/api/inventory/movements", { itemId: ITEM_ID, kind: "receipt", quantity: 1 }),
    );
    expect(res.status).toBe(404);
    expect(commandsNamed("PutCommand")).toHaveLength(0);
  });

  it("refuses a movement on an archived SKU", async () => {
    send.mockResolvedValue({ Item: storedItem({ status: "Archived" }) });
    const res = await handleInventoryApiRequest(
      req("POST", "/api/inventory/movements", { itemId: ITEM_ID, kind: "receipt", quantity: 1 }),
    );
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("item_not_writable");
  });

  it("refuses an unknown movement kind", async () => {
    const res = await handleInventoryApiRequest(
      req("POST", "/api/inventory/movements", { itemId: ITEM_ID, kind: "teleport", quantity: 1 }),
    );
    expect(res.status).toBe(400);
  });

  it("requires an itemId", async () => {
    const res = await handleInventoryApiRequest(
      req("POST", "/api/inventory/movements", { kind: "receipt", quantity: 1 }),
    );
    expect(res.status).toBe(400);
  });

  describe("who may move what", () => {
    it("a Dispatcher may ship but may not adjust", async () => {
      signedIn("Dispatcher");
      happyPath();
      const shipment = await handleInventoryApiRequest(
        req("POST", "/api/inventory/movements", { itemId: ITEM_ID, kind: "shipment", quantity: 1 }),
      );
      expect(shipment.status).toBe(201);

      const adjustment = await handleInventoryApiRequest(
        req("POST", "/api/inventory/movements", {
          itemId: ITEM_ID,
          kind: "adjustment",
          quantity: -1,
        }),
      );
      expect(adjustment.status).toBe(403);
      expect((await adjustment.json()).code).toBe("role_cannot_adjust_stock");
    });

    it("a Dispatcher may not post a cycle count either", async () => {
      signedIn("Dispatcher");
      const res = await handleInventoryApiRequest(
        req("POST", "/api/inventory/movements", { itemId: ITEM_ID, kind: "count", quantity: 4 }),
      );
      expect(res.status).toBe(403);
    });

    it("an Operations Manager may adjust", async () => {
      signedIn("Operations Manager");
      happyPath();
      const res = await handleInventoryApiRequest(
        req("POST", "/api/inventory/movements", {
          itemId: ITEM_ID,
          kind: "adjustment",
          quantity: -1,
        }),
      );
      expect(res.status).toBe(201);
    });

    it.each(["Sales", "Marketing", "Accounting"] as Role[])(
      "%s cannot post any movement",
      async (role) => {
        signedIn(role);
        const res = await handleInventoryApiRequest(
          req("POST", "/api/inventory/movements", {
            itemId: ITEM_ID,
            kind: "receipt",
            quantity: 1,
          }),
        );
        expect(res.status).toBe(403);
        expect(commandsNamed("PutCommand")).toHaveLength(0);
      },
    );

    it("checks the role before reading the item", async () => {
      signedIn("Sales");
      await handleInventoryApiRequest(
        req("POST", "/api/inventory/movements", { itemId: ITEM_ID, kind: "receipt", quantity: 1 }),
      );
      // A role that cannot move stock learns nothing about whether the id exists.
      expect(commandsNamed("GetCommand")).toHaveLength(0);
    });
  });

  describe("listing the ledger", () => {
    it("returns newest first", async () => {
      send.mockResolvedValue({
        Items: [
          { movementId: "old", itemId: ITEM_ID, createdAt: "2026-01-01T00:00:00.000Z" },
          { movementId: "new", itemId: ITEM_ID, createdAt: "2026-06-01T00:00:00.000Z" },
        ],
      });

      const res = await handleInventoryApiRequest(req("GET", "/api/inventory/movements"));
      const body = (await res.json()) as { movements: { movementId: string }[] };
      expect(body.movements.map((m) => m.movementId)).toEqual(["new", "old"]);
    });

    it("narrows by itemId after the scoped query, not instead of it", async () => {
      send.mockResolvedValue({
        Items: [
          { movementId: "a", itemId: ITEM_ID, createdAt: "2026-01-01T00:00:00.000Z" },
          { movementId: "b", itemId: "other", createdAt: "2026-01-02T00:00:00.000Z" },
        ],
      });

      const res = await handleInventoryApiRequest(
        req("GET", `/api/inventory/movements?itemId=${ITEM_ID}`),
      );
      const body = (await res.json()) as { movements: { movementId: string }[] };
      expect(body.movements.map((m) => m.movementId)).toEqual(["a"]);

      // The query itself was still company-scoped — the parameter is a filter,
      // never an authorization input.
      const query = firstCommand("QueryCommand");
      expect(query.input.ExpressionAttributeValues).toMatchObject({ ":companyId": ACME });
    });
  });
});

describe("provisioning diagnostics", () => {
  it("reports a missing table as a setup step, not a fault", async () => {
    send.mockRejectedValue(Object.assign(new Error("nope"), { name: "ResourceNotFoundException" }));
    const res = await handleInventoryApiRequest(req("GET", "/api/inventory/items"));
    expect(res.status).toBe(503);
    expect((await res.json()).code).toBe("storage_not_provisioned");
  });

  it("reports a missing index distinctly", async () => {
    send.mockRejectedValue(Object.assign(new Error("nope"), { name: "ValidationException" }));
    const res = await handleInventoryApiRequest(req("GET", "/api/inventory/items"));
    expect((await res.json()).code).toBe("index_not_ready");
  });

  it("never leaks an AWS message to the caller", async () => {
    send.mockRejectedValue(new Error("Table InventoryItems key itemId=secret-value"));
    const res = await handleInventoryApiRequest(req("GET", "/api/inventory/items"));
    expect(res.status).toBe(502);
    const body = await res.text();
    expect(body).not.toContain("secret-value");
  });
});
