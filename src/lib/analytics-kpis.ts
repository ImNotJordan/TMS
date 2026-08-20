import {
  filterEventsByPeriod,
  type AnalyticsEvent,
  type AnalyticsEventType,
  type AnalyticsPeriod,
} from "./analytics-events";
import { formatMoneyCompact } from "./dashboard-data";

export type KpiTone = "default" | "success" | "warning" | "destructive" | "info";

export type AnalyticsKpi = {
  id: string;
  label: string;
  value: string;
  delta?: string;
  deltaLabel?: string;
  trend?: "up" | "down" | "flat";
  tone?: KpiTone;
  /** Event types that contribute to this KPI (for drill-through). */
  eventTypes: AnalyticsEventType[];
  description?: string;
};

export type SeriesPoint = { label: string; value: number; secondary?: number };

export type ScorecardRow = {
  id: string;
  name: string;
  score: number;
  meta?: string;
  href?: string;
  eventIds: string[];
};

export type DomainAnalytics = {
  kpis: AnalyticsKpi[];
  series: SeriesPoint[];
  seriesLabel: string;
  secondarySeriesLabel?: string;
  scorecard: ScorecardRow[];
  scorecardTitle: string;
};

export type AnalyticsSnapshot = {
  period: AnalyticsPeriod;
  eventCount: number;
  overview: DomainAnalytics;
  ops: DomainAnalytics;
  finance: DomainAnalytics;
  sales: DomainAnalytics;
  bidding: DomainAnalytics;
  ai: {
    reliability: ScorecardRow[];
    lanes: ScorecardRow[];
    credit: ScorecardRow[];
    kpis: AnalyticsKpi[];
  };
};

function avg(nums: number[]): number | null {
  if (nums.length === 0) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function pct(n: number | null, digits = 1): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${n.toFixed(digits)}%`;
}

function num(n: number | null, digits = 1): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toFixed(digits);
}

function ofType(events: AnalyticsEvent[], ...types: AnalyticsEventType[]) {
  const set = new Set(types);
  return events.filter((e) => set.has(e.type));
}

function weeklyBuckets(events: AnalyticsEvent[], metricKey: string, weeks = 8): SeriesPoint[] {
  const now = new Date();
  const weekStart = new Date(now);
  weekStart.setHours(0, 0, 0, 0);
  weekStart.setDate(weekStart.getDate() - weekStart.getDay());
  const starts: number[] = [];
  const buckets: SeriesPoint[] = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const start = new Date(weekStart);
    start.setDate(start.getDate() - i * 7);
    starts.push(start.getTime());
    buckets.push({
      label: start.toLocaleDateString(undefined, { month: "short", day: "numeric" }),
      value: 0,
    });
  }
  const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
  for (const e of events) {
    const t = new Date(e.at).getTime();
    if (!Number.isFinite(t)) continue;
    for (let i = 0; i < starts.length; i++) {
      if (t >= starts[i]! && t < starts[i]! + WEEK_MS) {
        buckets[i]!.value += e.metrics[metricKey] ?? 0;
        break;
      }
    }
  }
  return buckets;
}

function dualWeekly(
  events: AnalyticsEvent[],
  primaryKey: string,
  secondaryKey: string,
  weeks = 8,
): SeriesPoint[] {
  const primary = weeklyBuckets(events, primaryKey, weeks);
  const secondary = weeklyBuckets(events, secondaryKey, weeks);
  return primary.map((p, i) => ({
    ...p,
    secondary: secondary[i]?.value ?? 0,
  }));
}

function hrefFromEvent(e: AnalyticsEvent): string | undefined {
  return e.links[0]?.href;
}

export function eventsForKpi(
  events: AnalyticsEvent[],
  kpi: Pick<AnalyticsKpi, "eventTypes">,
): AnalyticsEvent[] {
  return ofType(events, ...kpi.eventTypes);
}

export function computeAnalyticsSnapshot(
  allEvents: AnalyticsEvent[],
  period: AnalyticsPeriod,
): AnalyticsSnapshot {
  const events = filterEventsByPeriod(allEvents, period);

  // ---- Ops ----
  const covered = ofType(events, "load.covered");
  const delivered = ofType(events, "load.delivered");
  const exceptions = ofType(events, "load.exception");
  const dwell = ofType(events, "load.dwell");
  const otd = ofType(events, "load.otd");
  const ota = ofType(events, "load.ota");
  const reliability = ofType(events, "carrier.reliability_score");

  const coverHours = avg(covered.map((e) => e.metrics.coverHours ?? 0));
  const otdRate = avg(otd.map((e) => e.metrics.onTime ?? 0));
  const otaRate = avg(ota.map((e) => e.metrics.onTimeAppt ?? 0));
  const dwellHours = avg(dwell.map((e) => e.metrics.dwellHours ?? 0));
  const exceptionRate =
    covered.length + delivered.length + exceptions.length > 0
      ? exceptions.length / Math.max(1, covered.length + delivered.length)
      : null;

  const opsScorecard: ScorecardRow[] = [...reliability]
    .sort((a, b) => (b.metrics.score ?? 0) - (a.metrics.score ?? 0))
    .slice(0, 8)
    .map((e) => ({
      id: e.id,
      name: e.label,
      score: Math.round(e.metrics.score ?? 0),
      meta: `OTD ${num(e.metrics.otd, 0)}% · Claims ${num(e.metrics.claimsRate, 1)}%`,
      href: hrefFromEvent(e),
      eventIds: [e.id],
    }));

  const opsSeries = (() => {
    const ex = weeklyBuckets(
      exceptions.map((e) => ({ ...e, metrics: { value: 1 } })),
      "value",
    );
    const del = weeklyBuckets(
      delivered.map((e) => ({ ...e, metrics: { value: 1 } })),
      "value",
    );
    return ex.map((p, i) => ({ ...p, secondary: del[i]?.value ?? 0 }));
  })();

  const ops: DomainAnalytics = {
    kpis: [
      {
        id: "ops.ttc",
        label: "Time-to-cover",
        value: coverHours == null ? "—" : `${num(coverHours, 1)}h`,
        deltaLabel: "avg hours to cover",
        tone: coverHours != null && coverHours <= 12 ? "success" : "warning",
        eventTypes: ["load.covered"],
        description: "Average hours from create to covered.",
      },
      {
        id: "ops.otd",
        label: "OTD",
        value: pct((otdRate ?? 0) * 100),
        trend: (otdRate ?? 0) >= 0.9 ? "up" : "down",
        tone: (otdRate ?? 0) >= 0.9 ? "success" : "warning",
        eventTypes: ["load.otd", "load.delivered"],
      },
      {
        id: "ops.ota",
        label: "OTA",
        value: pct((otaRate ?? 0) * 100),
        trend: (otaRate ?? 0) >= 0.85 ? "up" : "down",
        tone: "info",
        eventTypes: ["load.ota", "load.delivered"],
      },
      {
        id: "ops.dwell",
        label: "Avg dwell",
        value: dwellHours == null ? "—" : `${num(dwellHours, 1)}h`,
        tone: dwellHours != null && dwellHours > 8 ? "warning" : "default",
        eventTypes: ["load.dwell"],
      },
      {
        id: "ops.exceptions",
        label: "Exception rate",
        value: pct((exceptionRate ?? 0) * 100),
        tone: (exceptionRate ?? 0) > 0.08 ? "destructive" : "success",
        eventTypes: ["load.exception"],
      },
    ],
    series: opsSeries,
    seriesLabel: "Exceptions",
    secondarySeriesLabel: "Deliveries",
    scorecard: opsScorecard,
    scorecardTitle: "Carrier scorecards",
  };

  // ---- Finance ----
  const margins = ofType(events, "load.margin");
  const aged = ofType(events, "invoice.aged");
  const factoring = ofType(events, "factoring.draw");
  const totalMargin = margins.reduce((s, e) => s + (e.metrics.margin ?? 0), 0);
  const totalMiles = margins.reduce((s, e) => s + (e.metrics.miles ?? 0), 0);
  const totalRevenue = margins.reduce((s, e) => s + (e.metrics.customerRate ?? 0), 0);
  const marginPct = totalRevenue > 0 ? (totalMargin / totalRevenue) * 100 : null;
  const marginPerMile = totalMiles > 0 ? totalMargin / totalMiles : null;
  const MARGIN_TARGET = 18;
  const openAr = aged.reduce((s, e) => s + (e.metrics.openAmount ?? 0), 0);
  const dso =
    aged.length > 0
      ? aged.reduce((s, e) => s + (e.metrics.ageDays ?? 0) * (e.metrics.openAmount ?? 0), 0) /
        Math.max(1, openAr)
      : null;
  const agedBuckets = [0, 0, 0, 0];
  for (const e of aged) {
    const b = Math.min(3, Math.max(0, Math.round(e.metrics.bucket ?? 0)));
    agedBuckets[b]! += e.metrics.openAmount ?? 0;
  }
  const factorDraw = factoring.reduce((s, e) => s + (e.metrics.draw ?? 0), 0);
  const factorLimit = factoring[0]?.metrics.facilityLimit ?? 500_000;
  const factorUtil = factorLimit > 0 ? (factorDraw / factorLimit) * 100 : null;

  const finance: DomainAnalytics = {
    kpis: [
      {
        id: "fin.mpm",
        label: "Margin / mi",
        value: marginPerMile == null ? "—" : `$${num(marginPerMile, 2)}`,
        tone: marginPerMile != null && marginPerMile >= 0.8 ? "success" : "warning",
        eventTypes: ["load.margin"],
      },
      {
        id: "fin.margin",
        label: "Margin vs target",
        value: marginPct == null ? "—" : `${num(marginPct, 1)}% / ${MARGIN_TARGET}%`,
        delta:
          marginPct == null
            ? undefined
            : `${marginPct >= MARGIN_TARGET ? "+" : ""}${num(marginPct - MARGIN_TARGET, 1)} pts`,
        trend: marginPct != null && marginPct >= MARGIN_TARGET ? "up" : "down",
        tone: marginPct != null && marginPct >= MARGIN_TARGET ? "success" : "warning",
        eventTypes: ["load.margin"],
      },
      {
        id: "fin.dso",
        label: "DSO",
        value: dso == null ? "—" : `${num(dso, 0)} days`,
        tone: dso != null && dso > 45 ? "warning" : "default",
        eventTypes: ["invoice.aged"],
      },
      {
        id: "fin.ar",
        label: "Aged AR",
        value: formatMoneyCompact(openAr),
        eventTypes: ["invoice.aged"],
        description: "Open receivables across aging buckets.",
      },
      {
        id: "fin.factor",
        label: "Factoring util.",
        value: pct(factorUtil),
        tone: (factorUtil ?? 0) > 70 ? "warning" : "info",
        eventTypes: ["factoring.draw"],
      },
    ],
    series: dualWeekly(margins, "margin", "customerRate"),
    seriesLabel: "Margin",
    secondarySeriesLabel: "Revenue",
    scorecard: [
      {
        id: "ar0",
        name: "0–30 days",
        score: agedBuckets[0]!,
        meta: formatMoneyCompact(agedBuckets[0]!),
        eventIds: aged.filter((e) => e.metrics.bucket === 0).map((e) => e.id),
      },
      {
        id: "ar1",
        name: "31–60 days",
        score: agedBuckets[1]!,
        meta: formatMoneyCompact(agedBuckets[1]!),
        eventIds: aged.filter((e) => e.metrics.bucket === 1).map((e) => e.id),
      },
      {
        id: "ar2",
        name: "61–90 days",
        score: agedBuckets[2]!,
        meta: formatMoneyCompact(agedBuckets[2]!),
        eventIds: aged.filter((e) => e.metrics.bucket === 2).map((e) => e.id),
      },
      {
        id: "ar3",
        name: "90+ days",
        score: agedBuckets[3]!,
        meta: formatMoneyCompact(agedBuckets[3]!),
        eventIds: aged.filter((e) => e.metrics.bucket === 3).map((e) => e.id),
      },
    ].map((r) => ({ ...r, score: Math.round(r.score) })),
    scorecardTitle: "Aged AR buckets",
  };

  // ---- Sales ----
  const won = ofType(events, "quote.won");
  const lost = ofType(events, "quote.lost");
  const stages = ofType(events, "crm.stage_move");
  const campaigns = ofType(events, "campaign.touch");
  const decided = won.length + lost.length;
  const hitRate = decided > 0 ? won.length / decided : null;
  const velocity = avg(stages.map((e) => e.metrics.velocityDays ?? 0));
  const campaignTouches = campaigns.reduce((s, e) => s + (e.metrics.touches ?? 0), 0);
  const campaignConv = campaigns.reduce((s, e) => s + (e.metrics.conversions ?? 0), 0);
  const campaignRate = campaignTouches > 0 ? (campaignConv / campaignTouches) * 100 : null;

  const sales: DomainAnalytics = {
    kpis: [
      {
        id: "sales.hit",
        label: "Hit rate",
        value: pct((hitRate ?? 0) * 100),
        tone: (hitRate ?? 0) >= 0.35 ? "success" : "warning",
        eventTypes: ["quote.won", "quote.lost"],
      },
      {
        id: "sales.velocity",
        label: "Pipeline velocity",
        value: velocity == null ? "—" : `${num(velocity, 0)} days`,
        eventTypes: ["crm.stage_move"],
        description: "Average days between stage moves.",
      },
      {
        id: "sales.campaign",
        label: "Campaign conv.",
        value: pct(campaignRate),
        eventTypes: ["campaign.touch"],
      },
      {
        id: "sales.won",
        label: "Won quotes",
        value: String(won.length),
        eventTypes: ["quote.won"],
      },
    ],
    series: (() => {
      const w = weeklyBuckets(
        won.map((e) => ({ ...e, metrics: { value: 1 } })),
        "value",
      );
      const l = weeklyBuckets(
        lost.map((e) => ({ ...e, metrics: { value: 1 } })),
        "value",
      );
      return w.map((p, i) => ({ ...p, secondary: l[i]?.value ?? 0 }));
    })(),
    seriesLabel: "Won",
    secondarySeriesLabel: "Lost",
    scorecard: campaigns
      .slice()
      .sort((a, b) => (b.metrics.conversions ?? 0) - (a.metrics.conversions ?? 0))
      .slice(0, 8)
      .map((e) => ({
        id: e.id,
        name: e.label,
        score:
          Math.round(((e.metrics.conversions ?? 0) / Math.max(1, e.metrics.touches ?? 1)) * 1000) /
          10,
        meta: `${e.metrics.touches ?? 0} touches · ${e.metrics.conversions ?? 0} conv.`,
        href: hrefFromEvent(e),
        eventIds: [e.id],
      })),
    scorecardTitle: "Campaign performance",
  };

  // ---- Bidding ----
  const submitted = ofType(events, "bid.submitted");
  const bidWon = ofType(events, "bid.won");
  const spreads = ofType(events, "bid.dat_spread");
  const backhauls = ofType(events, "backhaul.matched");
  const bidWinRate = submitted.length > 0 ? bidWon.length / submitted.length : null;
  const avgSpread = avg(spreads.map((e) => e.metrics.spread ?? 0));
  const backhaulSuccess =
    submitted.length > 0 ? backhauls.length / Math.max(1, submitted.length) : null;

  const byZip = new Map<string, { wins: number; total: number; eventIds: string[] }>();
  for (const e of submitted) {
    const z = e.dimensions?.zip3 ?? "000";
    const row = byZip.get(z) ?? { wins: 0, total: 0, eventIds: [] };
    row.total += 1;
    row.eventIds.push(e.id);
    byZip.set(z, row);
  }
  for (const e of bidWon) {
    const z = e.dimensions?.zip3 ?? "000";
    const row = byZip.get(z) ?? { wins: 0, total: 0, eventIds: [] };
    row.wins += 1;
    row.eventIds.push(e.id);
    byZip.set(z, row);
  }

  const bidding: DomainAnalytics = {
    kpis: [
      {
        id: "bid.spread",
        label: "Hist. vs DAT spread",
        value: avgSpread == null ? "—" : `$${num(avgSpread, 0)}`,
        tone: (avgSpread ?? 0) >= 0 ? "success" : "warning",
        eventTypes: ["bid.dat_spread"],
      },
      {
        id: "bid.win",
        label: "Win rate",
        value: pct((bidWinRate ?? 0) * 100),
        eventTypes: ["bid.submitted", "bid.won"],
      },
      {
        id: "bid.backhaul",
        label: "Backhaul success",
        value: pct((backhaulSuccess ?? 0) * 100),
        eventTypes: ["backhaul.matched"],
      },
      {
        id: "bid.volume",
        label: "Bids submitted",
        value: String(submitted.length),
        eventTypes: ["bid.submitted"],
      },
    ],
    series: dualWeekly(spreads, "spread", "datRate"),
    seriesLabel: "Spread vs DAT",
    secondarySeriesLabel: "DAT rate",
    scorecard: [...byZip.entries()]
      .map(([zip, row]) => ({
        id: `zip-${zip}`,
        name: `ZIP3 ${zip}`,
        score: row.total > 0 ? Math.round((row.wins / row.total) * 1000) / 10 : 0,
        meta: `${row.wins}/${row.total} wins`,
        href: "/bidding",
        eventIds: row.eventIds,
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 8),
    scorecardTitle: "Win rate by ZIP3",
  };

  // ---- AI ----
  const lanes = ofType(events, "lane.profitability");
  const credit = ofType(events, "customer.credit_risk");
  const aiKpis: AnalyticsKpi[] = [
    {
      id: "ai.rel",
      label: "Avg reliability",
      value: (() => {
        const a = avg(reliability.map((e) => e.metrics.score ?? 0));
        return a == null ? "—" : num(a, 1);
      })(),
      eventTypes: ["carrier.reliability_score"],
      tone: "info",
    },
    {
      id: "ai.lane",
      label: "Lane scores",
      value: String(lanes.length),
      eventTypes: ["lane.profitability"],
    },
    {
      id: "ai.credit",
      label: "Credit watchlist",
      value: String(credit.filter((e) => (e.metrics.score ?? 100) < 55).length),
      eventTypes: ["customer.credit_risk"],
      tone: "warning",
    },
  ];

  const ai = {
    reliability: opsScorecard,
    lanes: lanes
      .slice()
      .sort((a, b) => (b.metrics.score ?? 0) - (a.metrics.score ?? 0))
      .slice(0, 10)
      .map((e) => ({
        id: e.id,
        name: e.label,
        score: Math.round(e.metrics.score ?? 0),
        meta: `${formatMoneyCompact(e.metrics.margin ?? 0)} margin · $${num(e.metrics.marginPerMile, 2)}/mi · ${e.dimensions?.suggestion ?? ""}`,
        href: "/loads",
        eventIds: [e.id],
      })),
    credit: credit
      .slice()
      .sort((a, b) => (a.metrics.score ?? 0) - (b.metrics.score ?? 0))
      .slice(0, 10)
      .map((e) => ({
        id: e.id,
        name: e.label,
        score: Math.round(e.metrics.score ?? 0),
        meta: `${e.dimensions?.band ?? "—"} · Exposure ${formatMoneyCompact(e.metrics.exposure ?? 0)} · DSO ${num(e.metrics.dsoDays, 0)}d`,
        href: hrefFromEvent(e),
        eventIds: [e.id],
      })),
    kpis: aiKpis,
  };

  // ---- Overview ----
  const overview: DomainAnalytics = {
    kpis: [
      ops.kpis[1]!, // OTD
      finance.kpis[1]!, // margin vs target
      sales.kpis[0]!, // hit rate
      bidding.kpis[1]!, // bid win
      ops.kpis[4]!, // exceptions
      finance.kpis[0]!, // margin/mi
    ],
    series: dualWeekly(margins, "customerRate", "margin"),
    seriesLabel: "Revenue",
    secondarySeriesLabel: "Margin",
    scorecard: [
      ...exceptions.slice(0, 6).map((e) => ({
        id: e.id,
        name: e.label,
        score: 0,
        meta: e.dimensions?.lane ?? e.at.slice(0, 10),
        href: hrefFromEvent(e),
        eventIds: [e.id],
      })),
    ],
    scorecardTitle: "Top exceptions",
  };

  return {
    period,
    eventCount: events.length,
    overview,
    ops,
    finance,
    sales,
    bidding,
    ai,
  };
}

/** Deterministic backhaul what-if scorer for the Load Optimization Copilot. */
export function scoreBackhaulWhatIf(input: {
  origin: string;
  destination: string;
  emptyMiles: number;
  equipment?: string;
}): {
  uplift: number;
  fillProbability: number;
  recommendedBid: number;
  notes: string[];
} {
  const seed = `${input.origin}|${input.destination}|${input.emptyMiles}|${input.equipment ?? "van"}`;
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const u = ((h >>> 0) % 10_000) / 10_000;
  const emptyPenalty = Math.max(0, input.emptyMiles - 50) * 1.15;
  const baseUplift = 420 + u * 880;
  const uplift = Math.max(80, Math.round(baseUplift - emptyPenalty));
  const fillProbability = Math.max(0.18, Math.min(0.92, 0.78 - input.emptyMiles / 900 + u * 0.08));
  const recommendedBid = Math.round(1800 + u * 1400 + input.emptyMiles * 0.9);
  const notes = [
    fillProbability >= 0.6
      ? "Strong backhaul density on this corridor."
      : "Sparse return market — consider waiting 4–6h for a better match.",
    input.emptyMiles > 150
      ? "Empty miles are high; prioritize ZIP3 clusters near destination."
      : "Empty miles are within network design targets.",
    `Equipment ${input.equipment || "Dry Van"}: ${u > 0.5 ? "balanced supply" : "tight capacity"} in dest market.`,
  ];
  return { uplift, fillProbability, recommendedBid, notes };
}
