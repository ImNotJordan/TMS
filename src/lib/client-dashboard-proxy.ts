/**
 * Client portal dashboard — the customer-scoped counterpart to `/api/loads`.
 *
 *   GET  /api/client/dashboard
 *
 * ## Why this is separate from `/api/loads`
 *
 * Clients are company users. The company-index query that `/api/loads` runs
 * would return every load the tenant has, including other shippers' freight and
 * the brokerage's buy rates. Filtering in the browser is not a boundary.
 *
 * Two audiences, two endpoints. A single handler that switched predicate on
 * role would be one `if` away from serving the company board to a customer.
 *
 * ## What a client receives
 *
 * An allowlist: identity of the move, where it is going, live GPS when the
 * driver is actually sharing, the amount they are billed, and the tax charged
 * to them. `carrierRate`, margin, internal notes, documents and the tracking
 * session body stay on the server.
 *
 * Writes do not exist. There is no PATCH. A customer watching a truck is not
 * an editor of the load.
 */
import { resolveRequestRole } from "@/lib/ai/ai-authz";
import { snapshotClientLoadTax, type ClientTaxSnapshot } from "@/lib/client-dashboard-tax";
import { isDriverGpsFresh, type DriverGpsPing } from "@/lib/driver-gps";
import { parseMoney } from "@/lib/tax/tax-domain";
import type { LoadRecord } from "@/lib/loads-store";
import { createTenantRepository } from "@/lib/server/tenant-repository";
import { readServerEnv } from "@/lib/server-env";
import { requireCurrentTenantContext } from "@/lib/tenant/request-context";
import {
  isClientActiveLoad,
  loadBelongsToAssignedCustomers,
  parseAssignedCustomers,
} from "@/lib/tenant/client-scope";
import {
  logTenantDenial,
  tenantErrorResponse,
  type TenantContext,
} from "@/lib/tenant/server-tenant-context";
import { readCompanyGoogleMaps } from "@/lib/server/company-workspace-settings";

const CLIENT_DASHBOARD_PATH = "/api/client/dashboard";

function loadsTable(): string {
  return readServerEnv("VITE_LOADS_TABLE_NAME") || "Loads";
}

const loads = createTenantRepository<LoadRecord>({
  table: loadsTable,
  idKey: "loadId",
  label: "Load",
  companyIndex: "companyId-index",
});

export type ClientDashboardGps = {
  lat: number;
  lng: number;
  lastPingAt: string;
  source: "driver";
  fresh: boolean;
};

export type ClientDashboardLoad = {
  loadId: string;
  loadStatus: string;
  trackingState?: string;
  customer: string;
  pickupFacility?: string;
  pickupAddress?: string;
  pickupCity?: string;
  pickupState?: string;
  pickupZip?: string;
  pickupDate?: string;
  deliveryFacility?: string;
  deliveryAddress?: string;
  deliveryCity?: string;
  deliveryState?: string;
  deliveryZip?: string;
  deliveryDate?: string;
  equipmentType?: string;
  commodityDescription?: string;
  weight?: string;
  weightUnit?: string;
  eta?: string | null;
  routeProgressPct?: number;
  gps: ClientDashboardGps | null;
  billedAmount: number | null;
  tax: ClientTaxSnapshot;
};

export type ClientDashboardResponse = {
  companyName: string;
  assignedCustomers: string[];
  generatedAt: string;
  /** This company's Settings → Integrations Google Maps key, when connected. */
  maps: { apiKey: string } | null;
  summary: {
    activeCount: number;
    inTransitCount: number;
    trackedCount: number;
    billedTotal: number;
    taxTotal: number;
    currency: ClientTaxSnapshot["currency"];
    taxTotals: Array<{ currency: ClientTaxSnapshot["currency"]; amount: number }>;
  };
  loads: ClientDashboardLoad[];
};

export function isClientDashboardRequest(url: URL): boolean {
  return url.pathname === CLIENT_DASHBOARD_PATH;
}

function jsonError(message: string, status: number, code?: string) {
  return Response.json({ error: message, code }, { status });
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/**
 * Live position a customer may see: a driver ping, never a simulated tick.
 *
 * The ops tracking board interpolates a route when GPS is quiet. Showing that
 * to a shipper as "where the truck is" would be a lie they would quote back
 * during a claim.
 */
function publicGps(load: LoadRecord): ClientDashboardGps | null {
  const ping = load.driverGps;
  const fromPing = toGps(ping, ping ? isDriverGpsFresh(ping) : false);
  if (fromPing) return fromPing;

  const sessionGps = load.trackingSession?.gps;
  if (!sessionGps || sessionGps.source !== "driver") return null;
  return toGps(
    {
      lat: sessionGps.location.lat,
      lng: sessionGps.location.lng,
      lastPingAt: sessionGps.lastPingAt,
    },
    isDriverGpsFresh({
      lat: sessionGps.location.lat,
      lng: sessionGps.location.lng,
      lastPingAt: sessionGps.lastPingAt,
    }),
  );
}

function toGps(
  ping: Pick<DriverGpsPing, "lat" | "lng" | "lastPingAt"> | undefined | null,
  fresh: boolean,
): ClientDashboardGps | null {
  if (!ping) return null;
  if (!Number.isFinite(ping.lat) || !Number.isFinite(ping.lng)) return null;
  if (ping.lat === 0 && ping.lng === 0) return null;
  if (!ping.lastPingAt) return null;
  return {
    lat: ping.lat,
    lng: ping.lng,
    lastPingAt: ping.lastPingAt,
    source: "driver",
    fresh,
  };
}

function projectLoad(load: LoadRecord): ClientDashboardLoad {
  const billed = parseMoney(load.customerRate) ?? null;
  return {
    loadId: load.loadId,
    loadStatus: load.loadStatus ?? "unknown",
    trackingState: load.trackingSession?.trackingState,
    customer: load.customer?.trim() || "—",
    pickupFacility: load.pickupFacility,
    pickupAddress: load.pickupAddress,
    pickupCity: load.pickupCity,
    pickupState: load.pickupState,
    pickupZip: load.pickupZip,
    pickupDate: load.pickupDate,
    deliveryFacility: load.deliveryFacility,
    deliveryAddress: load.deliveryAddress,
    deliveryCity: load.deliveryCity,
    deliveryState: load.deliveryState,
    deliveryZip: load.deliveryZip,
    deliveryDate: load.deliveryDate,
    equipmentType: load.equipmentType,
    commodityDescription: load.commodityDescription,
    weight: load.weight,
    weightUnit: load.weightUnit,
    eta: load.trackingSession?.eta ?? null,
    routeProgressPct: load.trackingSession?.routeProgressPct,
    gps: publicGps(load),
    billedAmount: billed,
    tax: snapshotClientLoadTax(load),
  };
}

function isInTransit(load: ClientDashboardLoad): boolean {
  const status = load.loadStatus.toLowerCase();
  return (
    status === "in-transit" ||
    status === "loaded" ||
    status === "at-delivery" ||
    load.trackingState === "in-transit" ||
    load.trackingState === "at-delivery"
  );
}

export async function handleClientDashboardRequest(request: Request): Promise<Response> {
  if (request.method !== "GET") {
    return jsonError("Method not allowed.", 405, "method_not_allowed");
  }

  let ctx: TenantContext;
  try {
    ctx = await requireCurrentTenantContext(request);
  } catch (err) {
    return tenantErrorResponse(err) ?? jsonError("Sign in required.", 401, "not_authenticated");
  }

  if (ctx.role !== "Client") {
    logTenantDenial(ctx, "non-client role on client dashboard", CLIENT_DASHBOARD_PATH);
    return jsonError("This dashboard is for customer accounts.", 403, "wrong_audience");
  }

  if (!ctx.companyId) {
    logTenantDenial(ctx, "client missing company assignment", CLIENT_DASHBOARD_PATH);
    return jsonError(
      "This account is not assigned to a company. Ask your broker to finish setup.",
      403,
      "company_required",
    );
  }

  const resolved = await resolveRequestRole(request);
  if (!resolved.ok) {
    return jsonError(resolved.message, 403, resolved.code);
  }

  const assignedCustomers = parseAssignedCustomers(resolved.permissions?.assignedCustomers);
  const companyName = asString(resolved.permissions?.companyName) || "Your shipments";

  let records: LoadRecord[];
  let maps: { apiKey: string } | null;
  try {
    [records, maps] = await Promise.all([loads.list(ctx), readCompanyGoogleMaps(ctx.companyId)]);
  } catch (err) {
    console.error("[client-dashboard] list failed", err);
    return jsonError("Could not load shipments. Try again shortly.", 502, "upstream");
  }

  const visible = records
    .filter(
      (load) =>
        isClientActiveLoad(load) &&
        loadBelongsToAssignedCustomers(load.customer, assignedCustomers),
    )
    .map(projectLoad)
    .sort((a, b) => (b.pickupDate ?? "").localeCompare(a.pickupDate ?? ""));

  const billedTotal = roundMoney(visible.reduce((sum, load) => sum + (load.billedAmount ?? 0), 0));
  const taxTotals = summarizeTaxTotals(visible);
  const taxTotal = taxTotals[0]?.amount ?? 0;
  const currency = taxTotals[0]?.currency ?? "USD";

  const body: ClientDashboardResponse = {
    companyName,
    assignedCustomers,
    generatedAt: new Date().toISOString(),
    maps,
    summary: {
      activeCount: visible.length,
      inTransitCount: visible.filter(isInTransit).length,
      trackedCount: visible.filter((load) => load.gps?.fresh).length,
      billedTotal,
      taxTotal,
      currency,
      taxTotals,
    },
    loads: visible,
  };

  return Response.json(body);
}

function roundMoney(value: number): number {
  return Math.round((Number.isFinite(value) ? value : 0) * 100) / 100;
}

function summarizeTaxTotals(
  loads: ClientDashboardLoad[],
): Array<{ currency: ClientTaxSnapshot["currency"]; amount: number }> {
  const byCurrency = new Map<ClientTaxSnapshot["currency"], number>();
  for (const load of loads) {
    const rows = load.tax.lines.length > 0 ? load.tax.lines : [{ currency: load.tax.currency, amount: load.tax.amount }];
    for (const row of rows) {
      byCurrency.set(row.currency, roundMoney((byCurrency.get(row.currency) ?? 0) + row.amount));
    }
  }
  return [...byCurrency.entries()]
    .map(([currency, amount]) => ({ currency, amount }))
    .sort((a, b) => b.amount - a.amount);
}
