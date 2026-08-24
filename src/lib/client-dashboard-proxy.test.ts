import { beforeEach, describe, expect, it, vi } from "vitest";

const requireCurrentTenantContext = vi.fn();
const resolveRequestRole = vi.fn();
const send = vi.fn();

vi.mock("@/lib/tenant/request-context", () => ({
  requireCurrentTenantContext: (...a: unknown[]) => requireCurrentTenantContext(...a),
}));
vi.mock("@/lib/ai/ai-authz", () => ({
  resolveRequestRole: (...a: unknown[]) => resolveRequestRole(...a),
}));
vi.mock("@/lib/server/server-dynamo", async () => {
  const actual = await vi.importActual<typeof import("@/lib/server/server-dynamo")>(
    "@/lib/server/server-dynamo",
  );
  return { ...actual, getServerDataClient: () => ({ send: (...a: unknown[]) => send(...a) }) };
});

const { handleClientDashboardRequest, isClientDashboardRequest } = await import(
  "@/lib/client-dashboard-proxy"
);

const ACME = "11111111-1111-4111-8111-111111111111";
const RIVAL = "22222222-2222-4222-8222-222222222222";

function req(method = "GET"): Request {
  return new Request("https://example.test/api/client/dashboard", { method });
}

function signedInAs(role: string | null = "Client", companyId: string | null = ACME) {
  requireCurrentTenantContext.mockResolvedValue({
    userId: "client-1",
    role,
    companyId,
    isTenantExempt: false,
    isPlatformAdmin: false,
    sessionEpoch: null,
  });
}

function permissions(assignedCustomers: unknown = "Acme") {
  resolveRequestRole.mockResolvedValue({
    ok: true,
    sub: "client-1",
    role: "Client",
    sessionEpoch: null,
    permissions: { assignedCustomers, companyName: "Titan Freight" },
  });
}

function listed(
  items: Record<string, unknown>[],
  mapsByCompany: Record<string, string> = {},
) {
  send.mockReset().mockImplementation(
    async (command: {
      constructor: { name: string };
      input?: { Key?: { scope?: string; section?: string } };
    }) => {
      if (command?.constructor?.name === "GetCommand") {
        const scope = command.input?.Key?.scope;
        const section = command.input?.Key?.section;
        const apiKey = scope && section === "integrations" ? mapsByCompany[scope] : undefined;
        if (!apiKey) return { Item: undefined };
        return { Item: { data: { googleMaps: { enabled: true, apiKey } } } };
      }
      return { Items: items };
    },
  );
}

function getCommandScopes() {
  return send.mock.calls
    .map(([command]) => command as { constructor: { name: string }; input?: { Key?: { scope?: string } } })
    .filter((command) => command.constructor.name === "GetCommand")
    .map((command) => command.input?.Key?.scope);
}

beforeEach(() => {
  requireCurrentTenantContext.mockReset();
  resolveRequestRole.mockReset();
  send.mockReset();
  signedInAs();
  permissions();
  listed([]);
});

describe("routing", () => {
  it("claims only its own path", () => {
    expect(isClientDashboardRequest(new URL("https://x.test/api/client/dashboard"))).toBe(true);
    expect(isClientDashboardRequest(new URL("https://x.test/api/client/dashboard/L-1"))).toBe(
      false,
    );
    expect(isClientDashboardRequest(new URL("https://x.test/api/loads"))).toBe(false);
  });
});

describe("authorization", () => {
  it("401s an unauthenticated caller", async () => {
    const { CognitoRequestAuthFailure } = await import("@/lib/ai/auth-failure");
    requireCurrentTenantContext.mockRejectedValueOnce(
      new CognitoRequestAuthFailure("missing_token", "no token"),
    );
    expect((await handleClientDashboardRequest(req())).status).toBe(401);
  });

  it("403s staff — this endpoint is not a filtered view of the company board", async () => {
    signedInAs("Dispatcher");
    const res = await handleClientDashboardRequest(req());
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: "wrong_audience" });
    expect(send).not.toHaveBeenCalled();
  });

  it("403s a Client with no company assignment", async () => {
    signedInAs("Client", null);
    const res = await handleClientDashboardRequest(req());
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: "company_required" });
  });

  it("refuses writes", async () => {
    expect((await handleClientDashboardRequest(req("POST"))).status).toBe(405);
    expect((await handleClientDashboardRequest(req("PATCH"))).status).toBe(405);
  });
});

describe("customer scoping", () => {
  it("returns only active loads for assigned customers and strips buy-side fields", async () => {
    listed([
      {
        loadId: "L-acme",
        companyId: ACME,
        customer: "Acme",
        loadStatus: "in-transit",
        customerRate: "2400",
        carrierRate: "1800",
        internalNotes: "do not show the client",
        pickupCity: "Dallas",
        pickupState: "TX",
        pickupAddress: "100 Main St",
        pickupZip: "75201",
        deliveryCity: "Houston",
        deliveryState: "TX",
      },
      {
        loadId: "L-other",
        companyId: ACME,
        customer: "Globex",
        loadStatus: "in-transit",
        customerRate: "9999",
        carrierRate: "1",
      },
      {
        loadId: "L-done",
        companyId: ACME,
        customer: "Acme",
        loadStatus: "completed",
        customerRate: "100",
      },
    ]);

    const res = await handleClientDashboardRequest(req());
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      loads: Array<Record<string, unknown>>;
      summary: { activeCount: number };
      maps: { apiKey: string } | null;
    };
    expect(body.summary.activeCount).toBe(1);
    expect(body.loads).toHaveLength(1);
    expect(body.loads[0]?.loadId).toBe("L-acme");
    expect(body.loads[0]?.billedAmount).toBe(2400);
    expect(body.loads[0]?.carrierRate).toBeUndefined();
    expect(body.loads[0]?.internalNotes).toBeUndefined();
    expect(body.loads[0]?.pickupCity).toBe("Dallas");
    expect(body.loads[0]?.pickupAddress).toBe("100 Main St");
    expect(body.loads[0]?.pickupZip).toBe("75201");
    expect(body.loads[0]?.tax).toMatchObject({ currency: "USD" });
    expect(body.maps).toBeNull();
  });

  it("fails closed when no customers are assigned — empty, not the whole board", async () => {
    permissions("");
    listed([
      {
        loadId: "L-acme",
        companyId: ACME,
        customer: "Acme",
        loadStatus: "in-transit",
      },
    ]);
    const body = (await handleClientDashboardRequest(req()).then((r) => r.json())) as {
      loads: unknown[];
    };
    expect(body.loads).toEqual([]);
  });

  it("does not forward simulated GPS as a live truck", async () => {
    listed([
      {
        loadId: "L-acme",
        companyId: ACME,
        customer: "Acme",
        loadStatus: "in-transit",
        trackingSession: {
          gps: {
            location: { lat: 32.7, lng: -96.8 },
            lastPingAt: new Date().toISOString(),
            source: "simulated",
          },
        },
      },
    ]);
    const body = (await handleClientDashboardRequest(req()).then((r) => r.json())) as {
      loads: Array<{ gps: unknown }>;
    };
    expect(body.loads[0]?.gps).toBeNull();
  });

  it("hands the client that company's Google Maps key, not another tenant's", async () => {
    listed(
      [
        {
          loadId: "L-acme",
          companyId: ACME,
          customer: "Acme",
          loadStatus: "in-transit",
        },
      ],
      { [ACME]: "AIza-acme-maps", [RIVAL]: "AIza-rival-maps" },
    );
    const body = (await handleClientDashboardRequest(req()).then((r) => r.json())) as {
      maps: { apiKey: string } | null;
    };
    expect(body.maps).toEqual({ apiKey: "AIza-acme-maps" });
    expect(getCommandScopes()).toEqual([ACME]);
    expect(getCommandScopes()).not.toContain("global");
    expect(getCommandScopes()).not.toContain(RIVAL);
  });
});
