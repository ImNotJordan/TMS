import { listAllCarriersCached, type CarrierRecord } from "./carriers-store";
import { listBidQuotes, type BidQuoteRecord } from "./bidding-workspace-store";
import {
  listAllCrmAccountsCached,
  listAllCrmCampaignsCached,
  listAllCrmLeadsCached,
  type CrmAccountRecord,
  type CrmCampaignRecord,
  type CrmLeadRecord,
} from "./crm-store";
import { listAllInvoices, type InvoiceRecord } from "./accounting-store";
import { parseMoney } from "./dashboard-data";
import { listAllLoadsCached, type LoadRecord } from "./loads-store";
import { listAllQuotes, type QuoteRecord } from "./quotes-store";
import { getTrackingSessionsSnapshot, type TrackingSession } from "./tracking-workflow-store";

export const ANALYTICS_QUERY_KEY = ["analytics", "events"] as const;

export type AnalyticsPeriod = "7d" | "30d" | "90d" | "ytd";

export type AnalyticsEntityType =
  | "load"
  | "carrier"
  | "quote"
  | "bid"
  | "account"
  | "lead"
  | "campaign"
  | "lane"
  | "invoice";

export type AnalyticsEventType =
  | "load.covered"
  | "load.delivered"
  | "load.exception"
  | "load.dwell"
  | "load.ota"
  | "load.otd"
  | "load.margin"
  | "invoice.aged"
  | "factoring.draw"
  | "quote.won"
  | "quote.lost"
  | "crm.stage_move"
  | "campaign.touch"
  | "bid.submitted"
  | "bid.won"
  | "bid.dat_spread"
  | "backhaul.matched"
  | "carrier.reliability_score"
  | "lane.profitability"
  | "customer.credit_risk";

export type AnalyticsEventLink = {
  href: string;
  label: string;
};

export type AnalyticsEvent = {
  id: string;
  type: AnalyticsEventType;
  at: string;
  entityType: AnalyticsEntityType;
  entityId: string;
  label: string;
  metrics: Record<string, number>;
  dimensions?: Record<string, string>;
  links: AnalyticsEventLink[];
  source: "derived" | "synthetic";
};

export type AnalyticsSourceError = { source: string; message: string };

export type AnalyticsRawSources = {
  loads: LoadRecord[];
  quotes: QuoteRecord[];
  carriers: CarrierRecord[];
  bids: BidQuoteRecord[];
  accounts: CrmAccountRecord[];
  leads: CrmLeadRecord[];
  campaigns: CrmCampaignRecord[];
  tracking: TrackingSession[];
  invoices: InvoiceRecord[];
  errors: AnalyticsSourceError[];
};

export type AnalyticsBundle = {
  events: AnalyticsEvent[];
  errors: AnalyticsSourceError[];
  builtAt: string;
};

/** FNV-1a style hash for deterministic synthetic metrics. */
export function hashString(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function unitFromSeed(seed: string): number {
  return (hashString(seed) % 10_000) / 10_000;
}

export function periodRange(period: AnalyticsPeriod, now = new Date()): { start: Date; end: Date } {
  const end = new Date(now);
  const start = new Date(now);
  if (period === "7d") start.setDate(start.getDate() - 7);
  else if (period === "30d") start.setDate(start.getDate() - 30);
  else if (period === "90d") start.setDate(start.getDate() - 90);
  else {
    start.setMonth(0, 1);
    start.setHours(0, 0, 0, 0);
  }
  return { start, end };
}

export function filterEventsByPeriod(
  events: AnalyticsEvent[],
  period: AnalyticsPeriod,
  now = new Date(),
): AnalyticsEvent[] {
  const { start, end } = periodRange(period, now);
  const a = start.getTime();
  const b = end.getTime();
  return events.filter((e) => {
    const t = new Date(e.at).getTime();
    return Number.isFinite(t) && t >= a && t <= b;
  });
}

function iso(d: Date): string {
  return d.toISOString();
}

function recordTime(value?: string): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function loadAt(load: LoadRecord): Date {
  return (
    recordTime(load.updatedAt) ??
    recordTime(load.pickupDate) ??
    recordTime(load.createdAt) ??
    new Date()
  );
}

function estimateMiles(load: LoadRecord): number {
  const seed = `${load.pickupCity ?? ""}-${load.deliveryCity ?? ""}-${load.loadId}`;
  return Math.round(180 + unitFromSeed(seed) * 1600);
}

function laneKey(originCity?: string, originState?: string, destCity?: string, destState?: string) {
  const from = (originCity?.trim() || originState?.trim() || "?").slice(0, 3).toUpperCase();
  const to = (destCity?.trim() || destState?.trim() || "?").slice(0, 3).toUpperCase();
  return `${from}→${to}`;
}

function zip3(zip?: string, fallbackSeed?: string): string {
  const digits = (zip ?? "").replace(/\D/g, "");
  if (digits.length >= 3) return digits.slice(0, 3);
  const n = Math.floor(100 + unitFromSeed(fallbackSeed ?? "zip") * 899);
  return String(n);
}

function statusOf(load: LoadRecord): string {
  return (load.loadStatus ?? "").toLowerCase();
}

function isCoveredStatus(status: string): boolean {
  return [
    "driver-assigned",
    "dispatched",
    "en-route-pickup",
    "at-pickup",
    "in-transit",
    "at-delivery",
    "delivered",
    "completed",
  ].includes(status);
}

function isDeliveredStatus(status: string): boolean {
  return status === "delivered" || status === "completed";
}

function push(events: AnalyticsEvent[], event: AnalyticsEvent) {
  events.push(event);
}

function buildLoadEvents(loads: LoadRecord[], events: AnalyticsEvent[]) {
  for (const load of loads) {
    if (statusOf(load) === "draft") continue;
    const at = loadAt(load);
    const miles = estimateMiles(load);
    const customer = parseMoney(load.customerRate);
    const carrier = parseMoney(load.carrierRate);
    const margin = customer - carrier;
    const marginPct = customer > 0 ? (margin / customer) * 100 : 0;
    const lane = laneKey(load.pickupCity, load.pickupState, load.deliveryCity, load.deliveryState);
    const links: AnalyticsEventLink[] = [
      { href: `/loads/${encodeURIComponent(load.loadId)}`, label: load.loadId },
    ];
    const dims = {
      lane,
      zip3Origin: zip3(load.pickupZip, `${load.loadId}-o`),
      zip3Dest: zip3(load.deliveryZip, `${load.loadId}-d`),
      customer: load.customer ?? "Unknown",
      carrier: load.assignedCarrier ?? "Unassigned",
      status: load.loadStatus ?? "unknown",
    };

    if (isCoveredStatus(statusOf(load))) {
      const created = recordTime(load.createdAt) ?? at;
      const coverHours = Math.max(
        0.5,
        Math.min(96, (at.getTime() - created.getTime()) / 3_600_000 || 4 + unitFromSeed(load.loadId) * 28),
      );
      push(events, {
        id: `load.covered:${load.loadId}`,
        type: "load.covered",
        at: iso(at),
        entityType: "load",
        entityId: load.loadId,
        label: `Covered ${load.loadId}`,
        metrics: { coverHours, miles },
        dimensions: dims,
        links,
        source: "derived",
      });
    }

    if (isDeliveredStatus(statusOf(load))) {
      const onTime = unitFromSeed(`${load.loadId}:otd`) > 0.12 ? 1 : 0;
      const onTimeAppt = unitFromSeed(`${load.loadId}:ota`) > 0.18 ? 1 : 0;
      push(events, {
        id: `load.delivered:${load.loadId}`,
        type: "load.delivered",
        at: iso(at),
        entityType: "load",
        entityId: load.loadId,
        label: `Delivered ${load.loadId}`,
        metrics: { onTime, onTimeAppt, miles },
        dimensions: dims,
        links,
        source: "derived",
      });
      push(events, {
        id: `load.otd:${load.loadId}`,
        type: "load.otd",
        at: iso(at),
        entityType: "load",
        entityId: load.loadId,
        label: `OTD ${load.loadId}`,
        metrics: { onTime },
        dimensions: dims,
        links,
        source: "synthetic",
      });
      push(events, {
        id: `load.ota:${load.loadId}`,
        type: "load.ota",
        at: iso(at),
        entityType: "load",
        entityId: load.loadId,
        label: `OTA ${load.loadId}`,
        metrics: { onTimeAppt },
        dimensions: dims,
        links,
        source: "synthetic",
      });
    }

    if (statusOf(load) === "exception") {
      push(events, {
        id: `load.exception:${load.loadId}`,
        type: "load.exception",
        at: iso(at),
        entityType: "load",
        entityId: load.loadId,
        label: `Exception ${load.loadId}`,
        metrics: { count: 1 },
        dimensions: dims,
        links,
        source: "derived",
      });
    }

    const dwellHours = Math.round(1 + unitFromSeed(`${load.loadId}:dwell`) * 14);
    push(events, {
      id: `load.dwell:${load.loadId}`,
      type: "load.dwell",
      at: iso(at),
      entityType: "load",
      entityId: load.loadId,
      label: `Dwell ${load.loadId}`,
      metrics: { dwellHours },
      dimensions: dims,
      links,
      source: "synthetic",
    });

    if (customer > 0) {
      push(events, {
        id: `load.margin:${load.loadId}`,
        type: "load.margin",
        at: iso(at),
        entityType: "load",
        entityId: load.loadId,
        label: `Margin ${load.loadId}`,
        metrics: {
          customerRate: customer,
          carrierRate: carrier,
          margin,
          marginPct,
          miles,
          marginPerMile: miles > 0 ? margin / miles : 0,
        },
        dimensions: dims,
        links,
        source: "derived",
      });

      // AR / factoring come from Invoices Dynamo (see buildInvoiceEvents)
    }
  }
}

function buildQuoteEvents(quotes: QuoteRecord[], events: AnalyticsEvent[]) {
  for (const quote of quotes) {
    const at = recordTime(quote.updatedAt) ?? recordTime(quote.createdAt) ?? new Date();
    const links: AnalyticsEventLink[] = [{ href: "/quotes", label: quote.quoteId }];
    const status = quote.status;
    if (status === "Accepted" || status === "Converted") {
      push(events, {
        id: `quote.won:${quote.quoteId}`,
        type: "quote.won",
        at: iso(at),
        entityType: "quote",
        entityId: quote.quoteId,
        label: `Won ${quote.quoteId}`,
        metrics: {
          amount: quote.baseRate + quote.fuelSurcharge + quote.accessorials,
          count: 1,
        },
        dimensions: {
          customer: quote.customer,
          lane: `${quote.origin}→${quote.destination}`,
        },
        links,
        source: "derived",
      });
    } else if (status === "Rejected" || status === "Expired") {
      push(events, {
        id: `quote.lost:${quote.quoteId}`,
        type: "quote.lost",
        at: iso(at),
        entityType: "quote",
        entityId: quote.quoteId,
        label: `Lost ${quote.quoteId}`,
        metrics: { count: 1, amount: quote.baseRate },
        dimensions: {
          customer: quote.customer,
          lane: `${quote.origin}→${quote.destination}`,
        },
        links,
        source: "derived",
      });
    }
  }
}

function buildBidEvents(bids: BidQuoteRecord[], events: AnalyticsEvent[]) {
  for (const bid of bids) {
    const at = recordTime(bid.updatedAt) ?? recordTime(bid.createdAt) ?? new Date();
    const lane =
      bid.laneLabel ||
      laneKey(bid.originCity, bid.originState, bid.destinationCity, bid.destinationState);
    const zip3Origin = zip3(undefined, `${bid.quoteId}-o`);
    const links: AnalyticsEventLink[] = [{ href: "/bidding", label: bid.quoteId }];
    const dims = {
      lane,
      zip3: zip3Origin,
      equipment: bid.equipmentType,
      status: bid.status,
    };

    push(events, {
      id: `bid.submitted:${bid.quoteId}`,
      type: "bid.submitted",
      at: iso(at),
      entityType: "bid",
      entityId: bid.quoteId,
      label: `Bid ${bid.quoteId}`,
      metrics: { bidAmount: bid.bidAmount, buyRate: bid.buyRate, margin: bid.margin },
      dimensions: dims,
      links,
      source: "derived",
    });

    if (bid.status === "approved" || bid.status === "attached") {
      push(events, {
        id: `bid.won:${bid.quoteId}`,
        type: "bid.won",
        at: iso(at),
        entityType: "bid",
        entityId: bid.quoteId,
        label: `Won bid ${bid.quoteId}`,
        metrics: { count: 1, bidAmount: bid.bidAmount, margin: bid.margin },
        dimensions: dims,
        links,
        source: "derived",
      });
    }

    const datRate = bid.buyRate * (0.92 + unitFromSeed(`${bid.quoteId}:dat`) * 0.2);
    const spread = bid.bidAmount - datRate;
    push(events, {
      id: `bid.dat_spread:${bid.quoteId}`,
      type: "bid.dat_spread",
      at: iso(at),
      entityType: "bid",
      entityId: bid.quoteId,
      label: `DAT spread ${bid.quoteId}`,
      metrics: { historicalBid: bid.bidAmount, datRate, spread },
      dimensions: dims,
      links,
      source: "synthetic",
    });

    if (unitFromSeed(`${bid.quoteId}:bh`) > 0.55) {
      push(events, {
        id: `backhaul.matched:${bid.quoteId}`,
        type: "backhaul.matched",
        at: iso(at),
        entityType: "bid",
        entityId: bid.quoteId,
        label: `Backhaul ${lane}`,
        metrics: {
          success: 1,
          emptyMilesSaved: Math.round(40 + unitFromSeed(`${bid.quoteId}:em`) * 220),
          uplift: Math.round(150 + unitFromSeed(`${bid.quoteId}:up`) * 650),
        },
        dimensions: dims,
        links,
        source: "synthetic",
      });
    }
  }
}

function buildCrmEvents(
  leads: CrmLeadRecord[],
  campaigns: CrmCampaignRecord[],
  accounts: CrmAccountRecord[],
  events: AnalyticsEvent[],
) {
  for (const lead of leads) {
    const at = recordTime(lead.updatedAt) ?? recordTime(lead.createdAt) ?? new Date();
    const links: AnalyticsEventLink[] = [{ href: "/crm", label: lead.title || lead.leadId }];
    push(events, {
      id: `crm.stage_move:${lead.leadId}`,
      type: "crm.stage_move",
      at: iso(at),
      entityType: "lead",
      entityId: lead.leadId,
      label: `${lead.title} → ${lead.stage}`,
      metrics: {
        quotedRate: lead.quotedRate ?? 0,
        probabilityPct: lead.probabilityPct ?? (lead.stage === "Won" ? 100 : 40),
        won: lead.stage === "Won" ? 1 : 0,
        lost: lead.stage === "Lost" ? 1 : 0,
        velocityDays: Math.round(3 + unitFromSeed(lead.leadId) * 28),
      },
      dimensions: {
        stage: lead.stage,
        source: lead.source ?? "manual",
        lane: laneKey(lead.origin, undefined, lead.destination, undefined),
      },
      links,
      source: "derived",
    });
  }

  for (const campaign of campaigns) {
    const at = recordTime(campaign.updatedAt) ?? recordTime(campaign.createdAt) ?? new Date();
    const touches = Math.round(20 + unitFromSeed(campaign.campaignId) * 480);
    const replies = Math.round(touches * (0.04 + unitFromSeed(`${campaign.campaignId}:r`) * 0.12));
    const conversions = Math.round(replies * (0.1 + unitFromSeed(`${campaign.campaignId}:c`) * 0.25));
    push(events, {
      id: `campaign.touch:${campaign.campaignId}`,
      type: "campaign.touch",
      at: iso(at),
      entityType: "campaign",
      entityId: campaign.campaignId,
      label: campaign.name,
      metrics: { touches, replies, conversions },
      dimensions: {
        status: campaign.status,
        type: campaign.type,
        audience: campaign.audience ?? "All",
      },
      links: [{ href: "/crm", label: campaign.name }],
      source: "synthetic",
    });
  }

  for (const account of accounts) {
    const at = recordTime(account.updatedAt) ?? recordTime(account.createdAt) ?? new Date();
    const score = Math.round(35 + unitFromSeed(`${account.accountId}:credit`) * 60);
    const band = score >= 75 ? "low" : score >= 55 ? "moderate" : "elevated";
    push(events, {
      id: `customer.credit_risk:${account.accountId}`,
      type: "customer.credit_risk",
      at: iso(at),
      entityType: "account",
      entityId: account.accountId,
      label: account.name,
      metrics: {
        score,
        exposure: Math.round(8_000 + unitFromSeed(`${account.accountId}:exp`) * 180_000),
        dsoDays: Math.round(22 + unitFromSeed(`${account.accountId}:dso`) * 40),
      },
      dimensions: {
        band,
        status: account.status ?? "Active",
        accountType: account.accountType ?? "Shipper",
      },
      links: [{ href: "/crm", label: account.name }],
      source: "synthetic",
    });
  }
}

function buildCarrierAiEvents(carriers: CarrierRecord[], events: AnalyticsEvent[]) {
  for (const carrier of carriers) {
    if (carrier.blacklisted) continue;
    const at = recordTime(carrier.updatedAt) ?? recordTime(carrier.createdAt) ?? new Date();
    const otd = parseMoney(carrier.otdPercentage) || 80 + unitFromSeed(carrier.carrierId) * 18;
    const claims = parseMoney(carrier.claimsRatePercentage);
    const insuranceBoost = carrier.insuranceVerified ? 4 : -6;
    const score = Math.max(
      0,
      Math.min(100, otd - claims * 1.5 + insuranceBoost + unitFromSeed(`${carrier.carrierId}:rel`) * 3),
    );
    push(events, {
      id: `carrier.reliability_score:${carrier.carrierId}`,
      type: "carrier.reliability_score",
      at: iso(at),
      entityType: "carrier",
      entityId: carrier.carrierId,
      label: carrier.companyName,
      metrics: {
        score,
        otd,
        claimsRate: claims,
        insuranceVerified: carrier.insuranceVerified ? 1 : 0,
      },
      dimensions: {
        tier: carrier.tier,
        mc: carrier.mcNumber ?? "",
      },
      links: [
        {
          href: `/carriers/${encodeURIComponent(carrier.carrierId)}`,
          label: carrier.companyName,
        },
      ],
      source: "derived",
    });
  }
}

function buildLaneProfitabilityEvents(events: AnalyticsEvent[]) {
  const marginEvents = events.filter((e) => e.type === "load.margin");
  const byLane = new Map<string, AnalyticsEvent[]>();
  for (const e of marginEvents) {
    const lane = e.dimensions?.lane ?? "UNK→UNK";
    const list = byLane.get(lane) ?? [];
    list.push(e);
    byLane.set(lane, list);
  }
  for (const [lane, list] of byLane) {
    const margin = list.reduce((s, e) => s + (e.metrics.margin ?? 0), 0);
    const miles = list.reduce((s, e) => s + (e.metrics.miles ?? 0), 0);
    const revenue = list.reduce((s, e) => s + (e.metrics.customerRate ?? 0), 0);
    const score =
      miles > 0
        ? Math.max(0, Math.min(100, 50 + (margin / miles) * 8 + unitFromSeed(lane) * 5))
        : 50;
    const latest = list.reduce((a, b) => (a.at > b.at ? a : b));
    push(events, {
      id: `lane.profitability:${lane}`,
      type: "lane.profitability",
      at: latest.at,
      entityType: "lane",
      entityId: lane,
      label: lane,
      metrics: {
        score,
        margin,
        miles,
        revenue,
        marginPerMile: miles > 0 ? margin / miles : 0,
        loads: list.length,
      },
      dimensions: {
        lane,
        zip3Origin: latest.dimensions?.zip3Origin ?? "",
        zip3Dest: latest.dimensions?.zip3Dest ?? "",
        suggestion:
          score >= 70 ? "Grow volume" : score >= 50 ? "Optimize mix" : "Reprice or exit",
      },
      links: list[0]?.links ?? [{ href: "/loads", label: "Loads" }],
      source: "derived",
    });
  }
}

function enrichFromTracking(tracking: TrackingSession[], events: AnalyticsEvent[]) {
  for (const session of tracking) {
    if (!session.loadId) continue;
    const at = recordTime(session.updatedAt) ?? new Date();
    if (session.trackingState === "exception") {
      const existing = events.some(
        (e) => e.type === "load.exception" && e.entityId === session.loadId,
      );
      if (!existing) {
        push(events, {
          id: `load.exception:track:${session.loadId}`,
          type: "load.exception",
          at: iso(at),
          entityType: "load",
          entityId: session.loadId,
          label: `Tracking exception ${session.loadId}`,
          metrics: { count: 1 },
          dimensions: {
            lane: laneKey(
              session.pickup?.city,
              session.pickup?.state,
              session.delivery?.city,
              session.delivery?.state,
            ),
            driver: session.assignedDriverName ?? "",
          },
          links: [
            { href: `/loads/${encodeURIComponent(session.loadId)}`, label: session.loadId },
            { href: "/tracking", label: "Tracking" },
          ],
          source: "derived",
        });
      }
    }
  }
}

function buildInvoiceEvents(invoices: InvoiceRecord[], events: AnalyticsEvent[]) {
  const now = Date.now();
  for (const inv of invoices) {
    if (inv.status === "ready-to-bill") continue;
    const issued = recordTime(inv.issuedAt) ?? recordTime(inv.updatedAt) ?? new Date();
    const due = recordTime(inv.dueAt);
    const ageDays = Math.max(
      0,
      Math.round((now - (due?.getTime() ?? issued.getTime())) / (24 * 60 * 60 * 1000)),
    );
    const bucket = ageDays <= 30 ? 0 : ageDays <= 60 ? 1 : ageDays <= 90 ? 2 : 3;
    const openStatuses = ["sent", "in-dispute", "factored", "sent-to-collections"];
    if (openStatuses.includes(inv.status)) {
      push(events, {
        id: `invoice.aged:${inv.invoiceId}`,
        type: "invoice.aged",
        at: iso(issued),
        entityType: "invoice",
        entityId: inv.invoiceId,
        label: `AR ${inv.invoiceId}`,
        metrics: { ageDays, openAmount: inv.total, bucket },
        dimensions: {
          customer: inv.customer,
          status: inv.status,
          loadId: inv.loadId,
        },
        links: [
          {
            href: `/accounting?invoiceId=${encodeURIComponent(inv.invoiceId)}&tab=queues`,
            label: inv.invoiceId,
          },
          {
            href: `/loads/${encodeURIComponent(inv.loadId)}`,
            label: inv.loadId,
          },
        ],
        source: "derived",
      });
    }

    if (inv.status === "factored" && (inv.factoringAdvance ?? 0) > 0) {
      push(events, {
        id: `factoring.draw:${inv.invoiceId}`,
        type: "factoring.draw",
        at: iso(recordTime(inv.updatedAt) ?? issued),
        entityType: "invoice",
        entityId: inv.invoiceId,
        label: `Factoring ${inv.invoiceId}`,
        metrics: {
          draw: inv.factoringAdvance ?? 0,
          facilityLimit: 500_000,
        },
        dimensions: {
          customer: inv.customer,
          submissionId: inv.factoringSubmissionId ?? "",
          loadId: inv.loadId,
        },
        links: [
          {
            href: `/accounting?invoiceId=${encodeURIComponent(inv.invoiceId)}&tab=factoring`,
            label: inv.factoringSubmissionId ?? inv.invoiceId,
          },
        ],
        source: "derived",
      });
    }
  }
}

export function buildAnalyticsEvents(sources: AnalyticsRawSources): AnalyticsEvent[] {
  const events: AnalyticsEvent[] = [];
  buildLoadEvents(sources.loads, events);
  buildInvoiceEvents(sources.invoices, events);
  buildQuoteEvents(sources.quotes, events);
  buildBidEvents(sources.bids, events);
  buildCrmEvents(sources.leads, sources.campaigns, sources.accounts, events);
  buildCarrierAiEvents(sources.carriers, events);
  enrichFromTracking(sources.tracking, events);
  buildLaneProfitabilityEvents(events);
  events.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  return events;
}

export async function fetchAnalyticsSources(workspaceId: string): Promise<AnalyticsRawSources> {
  const [loads, quotes, carriers, bids, accounts, leads, campaigns, invoices] =
    await Promise.allSettled([
      listAllLoadsCached(),
      listAllQuotes(),
      listAllCarriersCached(),
      listBidQuotes(workspaceId),
      listAllCrmAccountsCached(),
      listAllCrmLeadsCached(),
      listAllCrmCampaignsCached(),
      listAllInvoices(),
    ]);

  const errors: AnalyticsSourceError[] = [];
  const settle = <T,>(result: PromiseSettledResult<T[]>, source: string): T[] => {
    if (result.status === "fulfilled") return result.value;
    const message = result.reason instanceof Error ? result.reason.message : String(result.reason);
    errors.push({ source, message });
    return [];
  };

  let tracking: TrackingSession[] = [];
  try {
    tracking = getTrackingSessionsSnapshot();
  } catch {
    /* local-only store may be empty */
  }

  return {
    loads: settle(loads, "Loads"),
    quotes: settle(quotes, "Quotes"),
    carriers: settle(carriers, "Carriers"),
    bids: settle(bids, "Bids"),
    accounts: settle(accounts, "CRM Accounts"),
    leads: settle(leads, "CRM Leads"),
    campaigns: settle(campaigns, "CRM Campaigns"),
    invoices: settle(invoices, "Invoices"),
    tracking,
    errors,
  };
}

export async function fetchAnalyticsBundle(workspaceId: string): Promise<AnalyticsBundle> {
  const sources = await fetchAnalyticsSources(workspaceId);
  return {
    events: buildAnalyticsEvents(sources),
    errors: sources.errors,
    builtAt: new Date().toISOString(),
  };
}
