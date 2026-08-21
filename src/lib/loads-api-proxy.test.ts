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

function signedInAt(companyId: string | null = ACME, role = "Dispatcher") {
  requireCurrentTenantContext.mockResolvedValue({
    userId: "user-1",
    role,
    companyId,
    isTenantExempt: false,
    isPlatformAdmin: false,
    sessionEpoch: null,
  });
}

/**
 * A PATCH now reads the stored load before writing it — the guards need the real
 * current status, and reading it inside the write request is what makes the
 * conditional update able to pin it. So the Get is mocked first, the Update second.
 */
function storedThenWritten(stored: Record<string, unknown>, written?: Record<string, unknown>) {
  send
    .mockReset()
    .mockResolvedValueOnce({ Item: { companyId: ACME, ...stored } })
    .mockResolvedValueOnce({ Attributes: { companyId: ACME, ...stored, ...(written ?? {}) } });
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

  it("403s a Client — they have a company, but this is the ops board", async () => {
    signedInAt(ACME, "Client");
    const res = await handleLoadsApiRequest(req("GET", "/api/loads"));
    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toMatchObject({ code: "client_audience" });
    expect(send).not.toHaveBeenCalled();
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
    storedThenWritten({ loadId: "L-1", loadStatus: "booked" });
    const res = await handleLoadsApiRequest(req("PATCH", "/api/loads/L-1", { customer: "New" }));
    expect(res.status).toBe(200);
  });

  it("400s an attempt to move a load between companies", async () => {
    const res = await handleLoadsApiRequest(req("PATCH", "/api/loads/L-1", { companyId: RIVAL }));
    expect(res.status).toBe(400);
    expect(send).not.toHaveBeenCalled();
  });

  it("404s another company's load before running any guard", async () => {
    send.mockReset().mockResolvedValue({ Item: { loadId: "L-1", companyId: RIVAL } });
    const res = await handleLoadsApiRequest(req("PATCH", "/api/loads/L-1", { customer: "New" }));
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toMatchObject({ code: "not_found" });
  });

  it("404s when the scoped write matches nothing", async () => {
    send
      .mockReset()
      .mockResolvedValueOnce({ Item: { loadId: "L-1", companyId: ACME, loadStatus: "booked" } })
      .mockImplementationOnce(async () => {
        throw Object.assign(new Error("c"), { name: "ConditionalCheckFailedException" });
      });
    const res = await handleLoadsApiRequest(req("PATCH", "/api/loads/L-1", { customer: "New" }));
    expect(res.status).toBe(404);
  });
});

describe("PATCH — the lifecycle is enforced at the wire, not in the UI", () => {
  it("409s a load jumping from draft to delivered", async () => {
    // This returned 200. A load could be invoiced without ever being picked up.
    storedThenWritten({ loadId: "L-1", loadStatus: "draft" });
    const res = await handleLoadsApiRequest(
      req("PATCH", "/api/loads/L-1", { loadStatus: "delivered" }),
    );
    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toMatchObject({ code: "illegal_transition" });
  });

  it("409s a delivered load being walked back to draft", async () => {
    storedThenWritten({ loadId: "L-1", loadStatus: "delivered" });
    const res = await handleLoadsApiRequest(
      req("PATCH", "/api/loads/L-1", { loadStatus: "draft" }),
    );
    expect(res.status).toBe(409);
  });

  it("400s an invented status", async () => {
    storedThenWritten({ loadId: "L-1", loadStatus: "draft" });
    const res = await handleLoadsApiRequest(
      req("PATCH", "/api/loads/L-1", { loadStatus: "totally-invented" }),
    );
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ code: "unknown_status" });
  });

  it("normalises a legacy spelling instead of storing a second variant", async () => {
    storedThenWritten({ loadId: "L-1", loadStatus: "draft" });
    const res = await handleLoadsApiRequest(
      req("PATCH", "/api/loads/L-1", { loadStatus: "Booked" }),
    );
    expect(res.status).toBe(200);
    const update = send.mock.calls[1]?.[0] as {
      input: { ExpressionAttributeValues: Record<string, unknown> };
    };
    expect(Object.values(update.input.ExpressionAttributeValues)).toContain("booked");
  });

  it("pins the current status on the write, so a concurrent move 409s", async () => {
    send
      .mockReset()
      .mockResolvedValueOnce({ Item: { loadId: "L-1", companyId: ACME, loadStatus: "booked" } })
      .mockImplementationOnce(async () => {
        throw Object.assign(new Error("c"), { name: "ConditionalCheckFailedException" });
      })
      // The failure-path re-read: still ours, so this is staleness, not a 404.
      .mockResolvedValueOnce({
        Item: { loadId: "L-1", companyId: ACME, loadStatus: "dispatched" },
      });
    const res = await handleLoadsApiRequest(
      req("PATCH", "/api/loads/L-1", { loadStatus: "driver-assigned" }),
    );
    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toMatchObject({ code: "STALE_RECORD" });
  });

  it("does not pin the status on a no-op, so whole-record editor saves still work", async () => {
    storedThenWritten({ loadId: "L-1", loadStatus: "in-transit" });
    const res = await handleLoadsApiRequest(
      req("PATCH", "/api/loads/L-1", { loadStatus: "in-transit", customer: "New" }),
    );
    expect(res.status).toBe(200);
    const update = send.mock.calls[1]?.[0] as { input: { ConditionExpression: string } };
    expect(update.input.ConditionExpression).not.toMatch(/loadStatus/);
  });
});

describe("PATCH — authorization inside the tenant", () => {
  it("403s a Sales account editing a rate", async () => {
    // The worst of the findings: tenant isolation held, but any authenticated
    // user in the company had the broker's power over pricing, unaudited.
    signedInAt(ACME, "Sales");
    storedThenWritten({ loadId: "L-1", loadStatus: "booked" });
    const res = await handleLoadsApiRequest(
      req("PATCH", "/api/loads/L-1", { customerRate: "1.00" }),
    );
    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toMatchObject({ code: "role_cannot_write_load" });
  });

  it("403s a Dispatcher editing a rate but lets them move the load", async () => {
    storedThenWritten({ loadId: "L-1", loadStatus: "booked" });
    const denied = await handleLoadsApiRequest(
      req("PATCH", "/api/loads/L-1", { customerRate: "1.00" }),
    );
    expect(denied.status).toBe(403);
    await expect(denied.json()).resolves.toMatchObject({ code: "role_cannot_price_load" });

    storedThenWritten({ loadId: "L-1", loadStatus: "booked" });
    const allowed = await handleLoadsApiRequest(
      req("PATCH", "/api/loads/L-1", { loadStatus: "dispatched" }),
    );
    expect(allowed.status).toBe(200);
  });

  it("409s a rate edit on a delivered load, even for a broker", async () => {
    signedInAt(ACME, "Broker");
    storedThenWritten({ loadId: "L-1", loadStatus: "delivered" });
    const res = await handleLoadsApiRequest(
      req("PATCH", "/api/loads/L-1", { customerRate: "9999" }),
    );
    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toMatchObject({ code: "load_economically_frozen" });
  });

  it("refuses a rate edit without ever reaching the write", async () => {
    signedInAt(ACME, "Broker");
    storedThenWritten({ loadId: "L-1", loadStatus: "completed" });
    await handleLoadsApiRequest(req("PATCH", "/api/loads/L-1", { customerRate: "9999" }));
    // One call — the read. The update never happened.
    expect(send).toHaveBeenCalledTimes(1);
  });
});

describe("every allowed change leaves a record of itself", () => {
  function update() {
    return send.mock.calls
      .map(([c]) => c as { constructor: { name: string }; input: Record<string, any> })
      .find((c) => c.constructor.name === "UpdateCommand")!.input;
  }

  it("appends an audit entry naming who changed the rate and what it was", async () => {
    // The role checks stop a disallowed rate change and leave no trace of an
    // allowed one. Enforcement without a record means you can say "that cannot
    // have happened" but never "here is what happened".
    signedInAt(ACME, "Broker");
    storedThenWritten({ loadId: "L-1", loadStatus: "in-transit", customerRate: "2850.00" });
    const res = await handleLoadsApiRequest(
      req("PATCH", "/api/loads/L-1", { customerRate: "1900.00" }),
    );
    expect(res.status).toBe(200);

    const input = update();
    expect(input.UpdateExpression).toContain("list_append");
    const entry = (input.ExpressionAttributeValues[":p0"] as Record<string, any>[])[0]!;
    expect(entry.by).toBe("user-1");
    expect(entry.role).toBe("Broker");
    expect(entry.via).toBe("ops-api");
    expect(entry.rates.customerRate).toEqual({ from: "2850.00", to: "1900.00" });
  });

  it("appends rather than assigning, so the trail cannot be replaced", async () => {
    signedInAt(ACME, "Broker");
    storedThenWritten({ loadId: "L-1", loadStatus: "booked" });
    await handleLoadsApiRequest(req("PATCH", "/api/loads/L-1", { pickupCity: "Waco" }));
    expect(update().UpdateExpression).toContain("if_not_exists");
  });

  it("records a status move with both ends", async () => {
    storedThenWritten({ loadId: "L-1", loadStatus: "booked" });
    await handleLoadsApiRequest(req("PATCH", "/api/loads/L-1", { loadStatus: "dispatched" }));
    const entry = (update().ExpressionAttributeValues[":p0"] as Record<string, any>[])[0]!;
    expect(entry.statusChange).toEqual({ from: "booked", to: "dispatched" });
  });

  it("writes no entry when a resend changes nothing", async () => {
    // Editor screens PUT whole records back; logging forty unchanged fields would
    // bury the one change that mattered.
    storedThenWritten({ loadId: "L-1", loadStatus: "booked", customer: "Acme" });
    await handleLoadsApiRequest(req("PATCH", "/api/loads/L-1", { customer: "Acme" }));
    expect(update().UpdateExpression).not.toContain("list_append");
  });

  it("403s a request that tries to write the trail itself", async () => {
    // Same posture as driverStatusHistory: the audited party does not get to write
    // the record of their own behaviour.
    const res = await handleLoadsApiRequest(
      req("PATCH", "/api/loads/L-1", {
        loadAuditTrail: [{ by: "someone-else", fields: ["customerRate"] }],
      }),
    );
    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toMatchObject({ code: "server_owned_field" });
    expect(send).not.toHaveBeenCalled();
  });

  it("403s a create that tries to seed the trail", async () => {
    const res = await handleLoadsApiRequest(
      req("POST", "/api/loads", { loadId: "L-9", loadAuditTrail: [] }),
    );
    expect(res.status).toBe(403);
    expect(send).not.toHaveBeenCalled();
  });
});

describe("DELETE", () => {
  it("204s for a role allowed to delete", async () => {
    signedInAt(ACME, "Admin");
    send
      .mockResolvedValueOnce({ Item: { companyId: ACME, loadId: "L-1", loadStatus: "draft" } })
      .mockResolvedValueOnce({});
    expect((await handleLoadsApiRequest(req("DELETE", "/api/loads/L-1"))).status).toBe(204);
  });

  it("403s a Dispatcher — deleting destroys what an invoice was derived from", async () => {
    const res = await handleLoadsApiRequest(req("DELETE", "/api/loads/L-1"));
    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toMatchObject({ code: "role_cannot_delete_load" });
    expect(send).not.toHaveBeenCalled();
  });

  it("404s when the scoped delete matches nothing", async () => {
    signedInAt(ACME, "Admin");
    send.mockResolvedValueOnce({});
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

describe("a duplicate create is a 409, not an opaque 502", () => {
  it("reports an existing id plainly", async () => {
    // The attribute_not_exists guard always stopped the duplicate; the reporting
    // was the bug. A double-clicked create surfaced as
    // "502 Could not complete that request", which reads as a server outage and
    // gives a client no way to tell a retryable fault from a settled duplicate.
    send.mockReset().mockImplementationOnce(async () => {
      throw Object.assign(new Error("c"), { name: "ConditionalCheckFailedException" });
    });
    const res = await handleLoadsApiRequest(req("POST", "/api/loads", { loadId: "L-1" }));
    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toMatchObject({ code: "already_exists" });
  });
});
