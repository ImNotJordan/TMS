import { listAllCarriersCached, type CarrierRecord } from "./carriers-store";
import { listAllLoadsCached, type LoadRecord } from "./loads-store";
import { listBidQuotes, type BidQuoteRecord } from "./bidding-workspace-store";
import { listAllQuotes, type QuoteRecord } from "./quotes-store";
import { listAllRfps, type RfpRecord } from "./rfps-store";
import { STATUS_LABELS, formatLane, isActiveLoad, type Tone } from "./loads-display";

export const DASHBOARD_QUERY_KEY = ["dashboard", "overview"] as const;

export type DashboardSourceError = { source: string; message: string };

export type DashboardData = {
  loads: LoadRecord[];
  quotes: QuoteRecord[];
  rfps: RfpRecord[];
  carriers: CarrierRecord[];
  bids: BidQuoteRecord[];
  errors: DashboardSourceError[];
};

/** Fetch every dashboard source in parallel; a failing table degrades to empty instead of breaking the page. */
export async function fetchDashboardData(workspaceId: string): Promise<DashboardData> {
  const [loads, quotes, rfps, carriers, bids] = await Promise.allSettled([
    listAllLoadsCached(),
    listAllQuotes(),
    listAllRfps(),
    listAllCarriersCached(),
    listBidQuotes(workspaceId),
  ]);

  const errors: DashboardSourceError[] = [];
  const settle = <T,>(result: PromiseSettledResult<T[]>, source: string): T[] => {
    if (result.status === "fulfilled") return result.value;
    const message = result.reason instanceof Error ? result.reason.message : String(result.reason);
    errors.push({ source, message });
    return [];
  };

  return {
    loads: settle(loads, "Loads"),
    quotes: settle(quotes, "Quotes"),
    rfps: settle(rfps, "RFPs"),
    carriers: settle(carriers, "Carriers"),
    bids: settle(bids, "Bids"),
    errors,
  };
}

export function parseMoney(value?: string): number {
  if (!value) return 0;
  const n = parseFloat(value.replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

export function formatMoneyCompact(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}k`;
  return `$${Math.round(value).toLocaleString()}`;
}

function recordTime(iso?: string): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? t : null;
}

/** Best available "when did this load happen" date for revenue bucketing. */
function loadRevenueTime(load: LoadRecord): number | null {
  return recordTime(load.pickupDate) ?? recordTime(load.createdAt);
}

const OPEN_BID_STATUSES = new Set(["draft", "saved", "sent"]);
const PENDING_QUOTE_STATUSES = new Set(["Draft", "Pending", "Sent"]);
const CLOSED_RFP_STATUSES = new Set(["Archived", "Submitted"]);
const TRANSIT_STATUSES = new Set([
  "dispatched",
  "en-route-pickup",
  "at-pickup",
  "in-transit",
  "at-delivery",
]);

export function countOpenBids(bids: BidQuoteRecord[]): number {
  return bids.filter((b) => OPEN_BID_STATUSES.has(b.status)).length;
}

export function countPendingQuotes(quotes: QuoteRecord[]): number {
  return quotes.filter((q) => PENDING_QUOTE_STATUSES.has(q.status)).length;
}

export function countRfpsInFlight(rfps: RfpRecord[]): number {
  return rfps.filter((r) => !CLOSED_RFP_STATUSES.has(r.status)).length;
}

export function isHighRiskLoad(load: LoadRecord): boolean {
  if (!isActiveLoad(load)) return false;
  return (
    load.loadStatus === "exception" ||
    Boolean(load.hazmat) ||
    Boolean(load.highValueFlag) ||
    parseMoney(load.loadValue) >= 100_000
  );
}

export function countExceptions(loads: LoadRecord[]): number {
  return loads.filter((l) => l.loadStatus === "exception").length;
}

/** Sum of customer rates for non-draft loads dated in the given month. */
export function monthRevenue(loads: LoadRecord[], year: number, month: number): number {
  return loads.reduce((sum, load) => {
    if (load.loadStatus === "draft") return sum;
    const t = loadRevenueTime(load);
    if (t == null) return sum;
    const d = new Date(t);
    if (d.getFullYear() !== year || d.getMonth() !== month) return sum;
    return sum + parseMoney(load.customerRate);
  }, 0);
}

export type RevenuePoint = { week: string; revenue: number; cost: number };

/** Weekly revenue (customer rate) vs carrier cost for the trailing `weeks` weeks. */
export function weeklyRevenueSeries(loads: LoadRecord[], now: Date, weeks = 8): RevenuePoint[] {
  const weekStart = new Date(now);
  weekStart.setHours(0, 0, 0, 0);
  weekStart.setDate(weekStart.getDate() - weekStart.getDay()); // back to Sunday
  const buckets: RevenuePoint[] = [];
  const starts: number[] = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const start = new Date(weekStart);
    start.setDate(start.getDate() - i * 7);
    starts.push(start.getTime());
    buckets.push({
      week: start.toLocaleDateString(undefined, { month: "short", day: "numeric" }),
      revenue: 0,
      cost: 0,
    });
  }
  const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
  for (const load of loads) {
    if (load.loadStatus === "draft") continue;
    const t = loadRevenueTime(load);
    if (t == null) continue;
    for (let i = 0; i < starts.length; i++) {
      if (t >= starts[i] && t < starts[i] + WEEK_MS) {
        buckets[i].revenue += parseMoney(load.customerRate);
        buckets[i].cost += parseMoney(load.carrierRate);
        break;
      }
    }
  }
  return buckets;
}

export type LanePoint = { lane: string; loads: number };

function laneCode(city?: string, state?: string): string | null {
  if (city?.trim()) return city.trim().slice(0, 3).toUpperCase();
  if (state?.trim()) return state.trim().toUpperCase();
  return null;
}

/** Top lanes by load count, labeled "ATL→DAL" style. */
export function topLanes(loads: LoadRecord[], limit = 6): LanePoint[] {
  const counts = new Map<string, number>();
  for (const load of loads) {
    const from = laneCode(load.pickupCity, load.pickupState);
    const to = laneCode(load.deliveryCity, load.deliveryState);
    if (!from || !to) continue;
    const key = `${from}→${to}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([lane, count]) => ({ lane, loads: count }))
    .sort((a, b) => b.loads - a.loads)
    .slice(0, limit);
}

export type CarrierScorePoint = { name: string; score: number };

/** OTD% minus claims rate, clamped to 0–100. Carriers without an OTD% are skipped. */
export function carrierScores(carriers: CarrierRecord[], limit = 4): CarrierScorePoint[] {
  return carriers
    .filter((c) => c.otdPercentage != null && c.otdPercentage !== "" && !c.blacklisted)
    .map((c) => ({
      name: c.companyName,
      score: Math.max(0, Math.min(100, parseMoney(c.otdPercentage) - parseMoney(c.claimsRatePercentage))),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

export function averageCarrierScore(carriers: CarrierRecord[]): number | null {
  const scores = carrierScores(carriers, Number.POSITIVE_INFINITY);
  if (scores.length === 0) return null;
  return scores.reduce((sum, c) => sum + c.score, 0) / scores.length;
}

export type DashboardAlert = { title: string; desc: string; tone: "warning" | "destructive" };

export function buildAlerts(
  loads: LoadRecord[],
  carriers: CarrierRecord[],
  rfps: RfpRecord[],
  now: Date,
  limit = 4,
): DashboardAlert[] {
  const alerts: DashboardAlert[] = [];

  for (const load of loads) {
    if (load.loadStatus === "exception") {
      alerts.push({
        title: `Exception · ${load.loadId}`,
        desc: `${formatLane(load)} flagged — review and re-plan.`,
        tone: "destructive",
      });
    }
  }

  for (const load of loads) {
    if (!isActiveLoad(load)) continue;
    if ((load.hazmat || load.highValueFlag) && !load.insuranceVerified) {
      alerts.push({
        title: `Insurance unverified · ${load.loadId}`,
        desc: `${load.hazmat ? "Hazmat" : "High-value"} load on ${formatLane(load)} without verified coverage.`,
        tone: "warning",
      });
    }
  }

  const soon = now.getTime() + 30 * 24 * 60 * 60 * 1000;
  for (const carrier of carriers) {
    const expires = recordTime(carrier.insuranceExpiresAt);
    if (expires == null || carrier.blacklisted) continue;
    if (expires < now.getTime()) {
      alerts.push({
        title: `Insurance expired · ${carrier.companyName}`,
        desc: "Coverage lapsed — pause tendering until renewed.",
        tone: "destructive",
      });
    } else if (expires < soon) {
      alerts.push({
        title: `Insurance expiring · ${carrier.companyName}`,
        desc: `Coverage ends ${new Date(expires).toLocaleDateString(undefined, { month: "short", day: "numeric" })}.`,
        tone: "warning",
      });
    }
  }

  const dueSoon = now.getTime() + 48 * 60 * 60 * 1000;
  for (const rfp of rfps) {
    if (CLOSED_RFP_STATUSES.has(rfp.status)) continue;
    const due = recordTime(rfp.dueDate);
    if (due != null && due < dueSoon) {
      alerts.push({
        title: `${rfp.rfpId} due soon · ${rfp.customer}`,
        desc: `${rfp.laneCount} lanes at ${rfp.pricingProgress}% priced — deadline approaching.`,
        tone: due < now.getTime() ? "destructive" : "warning",
      });
    }
  }

  return alerts
    .sort((a, b) => (a.tone === b.tone ? 0 : a.tone === "destructive" ? -1 : 1))
    .slice(0, limit);
}

export type DashboardDeadline = {
  label: string;
  date: string;
  urgency: "High" | "Medium" | "Low";
};

export function buildDeadlines(
  rfps: RfpRecord[],
  quotes: QuoteRecord[],
  now: Date,
  limit = 5,
): DashboardDeadline[] {
  const entries: Array<DashboardDeadline & { at: number }> = [];

  const urgencyFor = (at: number): DashboardDeadline["urgency"] => {
    const hours = (at - now.getTime()) / (60 * 60 * 1000);
    if (hours < 24) return "High";
    if (hours < 72) return "Medium";
    return "Low";
  };
  const dateLabel = (at: number) =>
    new Date(at).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });

  for (const rfp of rfps) {
    if (CLOSED_RFP_STATUSES.has(rfp.status)) continue;
    const due = recordTime(rfp.dueDate);
    if (due == null) continue;
    entries.push({
      label: `${rfp.rfpId} · ${rfp.customer}`,
      date: `Due ${dateLabel(due)}`,
      urgency: urgencyFor(due),
      at: due,
    });
  }

  for (const quote of quotes) {
    if (!PENDING_QUOTE_STATUSES.has(quote.status)) continue;
    const pickup = recordTime(quote.pickupDate);
    if (pickup == null || pickup < now.getTime()) continue;
    entries.push({
      label: `${quote.quoteId} · ${quote.customer}`,
      date: `Pickup ${dateLabel(pickup)}`,
      urgency: urgencyFor(pickup),
      at: pickup,
    });
  }

  return entries.sort((a, b) => a.at - b.at).slice(0, limit);
}

export type DashboardActivity = {
  who: string;
  what: string;
  when: string;
  tone: Tone;
  at: number;
};

export function relativeTime(at: number, now: Date): string {
  const diff = Math.max(0, now.getTime() - at);
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(at).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

const QUOTE_STATUS_TONE: Record<string, Tone> = {
  Accepted: "success",
  Converted: "success",
  Rejected: "destructive",
  Expired: "destructive",
  Sent: "info",
};

export function buildActivity(
  data: Pick<DashboardData, "loads" | "quotes" | "rfps" | "carriers">,
  now: Date,
  limit = 6,
): DashboardActivity[] {
  const entries: DashboardActivity[] = [];

  for (const load of data.loads) {
    const at = recordTime(load.updatedAt) ?? recordTime(load.createdAt);
    if (at == null) continue;
    const status = load.loadStatus ? STATUS_LABELS[load.loadStatus] : undefined;
    entries.push({
      who: load.dispatcher?.trim() || "Ops",
      what: `Load ${load.loadId} · ${status?.label ?? "updated"} (${formatLane(load)})`,
      when: relativeTime(at, now),
      tone: status?.tone ?? "default",
      at,
    });
  }

  for (const quote of data.quotes) {
    const at = recordTime(quote.updatedAt) ?? recordTime(quote.createdAt);
    if (at == null) continue;
    entries.push({
      who: quote.owner?.trim() || "Sales",
      what: `Quote ${quote.quoteId} ${quote.status.toLowerCase()} · ${quote.customer}`,
      when: relativeTime(at, now),
      tone: QUOTE_STATUS_TONE[quote.status] ?? "default",
      at,
    });
  }

  for (const rfp of data.rfps) {
    const at = recordTime(rfp.updatedAt) ?? recordTime(rfp.createdAt);
    if (at == null) continue;
    entries.push({
      who: rfp.owner?.trim() || "Pricing",
      what: `${rfp.rfpId} · ${rfp.status} (${rfp.customer})`,
      when: relativeTime(at, now),
      tone: rfp.status === "Approved" ? "success" : rfp.status === "Approval Pending" ? "warning" : "info",
      at,
    });
  }

  for (const carrier of data.carriers) {
    const at = recordTime(carrier.updatedAt) ?? recordTime(carrier.createdAt);
    if (at == null) continue;
    const isNew = carrier.updatedAt === carrier.createdAt;
    entries.push({
      who: "Network",
      what: `Carrier ${carrier.companyName} ${isNew ? "onboarded" : "updated"}`,
      when: relativeTime(at, now),
      tone: isNew ? "success" : "default",
      at,
    });
  }

  return entries.sort((a, b) => b.at - a.at).slice(0, limit);
}

export type ShipmentPin = {
  id: string;
  x: number;
  y: number;
  status: string;
  tone: "success" | "warning" | "destructive";
};

/** Approximate state centroids (lat, lon) for positioning pins on the schematic US map. */
const STATE_CENTROIDS: Record<string, [number, number]> = {
  AL: [32.8, -86.8], AR: [34.9, -92.4], AZ: [34.3, -111.7], CA: [37.2, -119.3],
  CO: [39.0, -105.5], CT: [41.6, -72.7], DC: [38.9, -77.0], DE: [39.0, -75.5],
  FL: [28.6, -82.4], GA: [32.6, -83.4], IA: [42.0, -93.5], ID: [44.4, -114.6],
  IL: [40.0, -89.2], IN: [39.9, -86.3], KS: [38.5, -98.4], KY: [37.5, -85.3],
  LA: [31.1, -92.0], MA: [42.3, -71.8], MD: [39.0, -76.8], ME: [45.4, -69.2],
  MI: [44.3, -85.4], MN: [46.3, -94.3], MO: [38.4, -92.5], MS: [32.7, -89.7],
  MT: [47.0, -109.6], NC: [35.5, -79.4], ND: [47.4, -100.5], NE: [41.5, -99.8],
  NH: [43.7, -71.6], NJ: [40.2, -74.7], NM: [34.4, -106.1], NV: [39.3, -116.6],
  NY: [42.9, -75.5], OH: [40.3, -82.8], OK: [35.6, -97.5], OR: [43.9, -120.6],
  PA: [40.9, -77.8], RI: [41.7, -71.6], SC: [33.9, -80.9], SD: [44.4, -100.2],
  TN: [35.8, -86.4], TX: [31.5, -99.3], UT: [39.3, -111.7], VA: [37.5, -78.9],
  VT: [44.1, -72.7], WA: [47.4, -120.4], WI: [44.6, -90.0], WV: [38.6, -80.6],
  WY: [43.0, -107.6],
};

function projectState(state?: string): { x: number; y: number } | null {
  const key = state?.trim().toUpperCase();
  if (!key) return null;
  const centroid = STATE_CENTROIDS[key];
  if (!centroid) return null;
  const [lat, lon] = centroid;
  // Project lon [-125, -67] → x [4, 96] and lat [49, 25] → y [8, 92]
  const x = ((lon + 125) / (125 - 67)) * 92 + 4;
  const y = ((49 - lat) / (49 - 25)) * 84 + 8;
  return { x: Math.max(3, Math.min(97, x)), y: Math.max(5, Math.min(95, y)) };
}

/** How far along the pickup→delivery leg to draw a pin, per status. */
const STATUS_PROGRESS: Record<string, number> = {
  dispatched: 0.1,
  "en-route-pickup": 0.25,
  "at-pickup": 0.35,
  "in-transit": 0.6,
  "at-delivery": 0.9,
  exception: 0.5,
};

export function isInTransit(load: LoadRecord): boolean {
  return Boolean(load.loadStatus && TRANSIT_STATUSES.has(load.loadStatus));
}

export function buildShipmentPins(loads: LoadRecord[], limit = 8): ShipmentPin[] {
  const pins: ShipmentPin[] = [];
  for (const load of loads) {
    const status = load.loadStatus;
    if (!status || (!TRANSIT_STATUSES.has(status) && status !== "exception")) continue;
    const from = projectState(load.pickupState);
    const to = projectState(load.deliveryState);
    const anchor = from ?? to;
    if (!anchor) continue;
    const progress = STATUS_PROGRESS[status] ?? 0.5;
    const x = from && to ? from.x + (to.x - from.x) * progress : anchor.x;
    const y = from && to ? from.y + (to.y - from.y) * progress : anchor.y;
    const meta = STATUS_LABELS[status];
    const tone: ShipmentPin["tone"] =
      status === "exception"
        ? "destructive"
        : meta?.tone === "warning"
          ? "warning"
          : "success";
    pins.push({ id: load.loadId, x, y, status: meta?.label ?? status, tone });
    if (pins.length >= limit) break;
  }
  return pins;
}
