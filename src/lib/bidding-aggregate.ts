/**
 * Bidding pricing engine — pure aggregation over loads.
 *
 * Deliberately free of side-effectful imports (`LoadRecord` arrives as a type
 * only) so both the browser and the search endpoint in
 * `bidding-search-proxy.ts` can run it. `bidding-data.ts` is the browser-facing
 * wrapper that adds fetching and feature flags on top.
 *
 * ## Why so much of this returns `null`
 *
 * The rule here is that a number on a pricing screen must be a number this
 * module actually computed. Where the input is missing — no loads in the 30-day
 * window, no settled loads to score a win rate against, DAT not connected — the
 * aggregate is `null` and the UI renders an em dash. It used to substitute the
 * all-time average for an empty window and hard-zero for a disconnected DAT,
 * which put fabricated figures under labels like "Last 30-Day Avg Sell" and
 * "DAT Market Average", and then fed them into the recommended bid.
 *
 * The same rule drives `recommendedBid`: the blend is re-normalised over the
 * signals that are present, so a missing input widens the weight of the others
 * rather than silently contributing zero.
 */
import type { LoadRecord } from "./loads-store";

export type DatStatus = "Live" | "Refreshing" | "Stale" | "Unavailable" | "API Error";

export type DatSnapshot = {
  status: DatStatus;
  /** `null` whenever RateView is not connected — never 0-as-unknown. */
  marketMinimum: number | null;
  marketAverage: number | null;
  marketMaximum: number | null;
  ratePerMile: number | null;
  fuelEstimate: number | null;
  capacityIndicator: number | null;
  confidence: number | null;
  dataWindow: string;
  lastRefreshed: string;
  sourceStatus: string;
};

export type MarginBand =
  | "Low Margin"
  | "Healthy Margin"
  | "Strong Margin"
  | "Aggressive Bid"
  | "Conservative Bid"
  | "Below Market"
  | "At Market"
  | "Above Market";

/** How a load qualified for the search, narrowest first. */
export type LaneMatchType = "exact" | "similar" | "adjacent";

export type SearchCriteria = {
  originCity: string;
  originState: string;
  originZip5: string;
  originZip3: string;
  destinationCity: string;
  destinationState: string;
  destinationZip5: string;
  destinationZip3: string;
  equipmentType: string;
  pickupDate: string;
  deliveryDate: string;
  weight: number;
  commodity: string;
  customer: string;
  broker: string;
  referenceId: string;
  rfpId: string;
  quoteId: string;
  loadId: string;
  marketArea: string;
  radiusMiles: number;
};

export type SearchOptions = {
  exactLaneMatch: boolean;
  similarLaneMatch: boolean;
  adjacentMarketSearch: boolean;
  includeBackhaulCandidates: boolean;
  includeActiveLoads: boolean;
  includeDatMarketData: boolean;
  includeLast30Days: boolean;
  includeLast60Days: boolean;
  includeLast90Days: boolean;
};

export type HistoricalResultRow = {
  id: string;
  lane: string;
  matchType: LaneMatchType;
  equipment: string;
  historicalAvgBuy: number;
  historicalAvgSell: number;
  historicalMargin: number;
  historicalMarginPct: number;
  standardDeviation: number;
  /** Delivered ÷ settled. `null` when nothing on this lane has settled yet. */
  winRate: number | null;
  settledLoadCount: number;
  deliveredCount: number;
  cancelledCount: number;
  /** `null` when the window is empty or the caller switched that window off. */
  last30AvgBuy: number | null;
  last30AvgSell: number | null;
  last60AvgBuy: number | null;
  last60AvgSell: number | null;
  last90AvgBuy: number | null;
  last90AvgSell: number | null;
  datMarketMin: number | null;
  datMarketAvg: number | null;
  datMarketMax: number | null;
  datRatePerMile: number | null;
  marginBand: MarginBand;
  riskScore: number;
  similarActiveLoads: number;
  confidence: number;
  recommendedBid: number;
  /** Lane-derived bounds for a sane bid — not a hard-coded rate band. */
  recommendedBidFloor: number;
  recommendedBidCeiling: number;
  loadCount: number;
  /** Comparable loads discarded because a rate was missing or unparseable. */
  droppedForMissingRates: number;
};

export type LeverageLoad = {
  loadNumber: string;
  customer: string;
  origin: string;
  destination: string;
  equipment: string;
  pickupDate: string;
  deliveryDate: string;
  currentStatus: string;
  buyRate: number | null;
  sellRate: number | null;
  margin: number | null;
  assignedCarrier: string;
  /** Composite lane/equipment/date/customer score, 0-100. */
  similarityPct: number;
  matchType: LaneMatchType;
};

export type BackhaulCandidate = {
  loadNumber: string;
  currentDeliveryMarket: string;
  destination: string;
  equipment: string;
  availableDate: string;
  similarityPct: number;
  estimatedBackhaulValue: number | null;
  suggestedCarrier: string;
  rankScore: number;
};

export const DAT_NOT_CONNECTED_MESSAGE =
  "DAT RateView API is not yet connected. Configure credentials in Settings > Integrations.";

export const AI_NOT_CONNECTED_MESSAGE =
  "AI bid suggestions are not yet connected. Enable the AI Bidding Copilot integration in Settings.";

/**
 * Land-border adjacency, used by the "adjacent market search" option.
 *
 * Without this the option called `similarLaneMatch` under a different name, so
 * ticking it widened nothing. A border table is coarse next to a real market
 * grid, but it is deterministic, needs no external data, and means the control
 * does what it says.
 */
const ADJACENT_STATES: Record<string, string[]> = {
  AL: ["FL", "GA", "MS", "TN"],
  AR: ["LA", "MO", "MS", "OK", "TN", "TX"],
  AZ: ["CA", "CO", "NM", "NV", "UT"],
  CA: ["AZ", "NV", "OR"],
  CO: ["AZ", "KS", "NE", "NM", "OK", "UT", "WY"],
  CT: ["MA", "NY", "RI"],
  DC: ["MD", "VA"],
  DE: ["MD", "NJ", "PA"],
  FL: ["AL", "GA"],
  GA: ["AL", "FL", "NC", "SC", "TN"],
  IA: ["IL", "MN", "MO", "NE", "SD", "WI"],
  ID: ["MT", "NV", "OR", "UT", "WA", "WY"],
  IL: ["IA", "IN", "KY", "MO", "WI"],
  IN: ["IL", "KY", "MI", "OH"],
  KS: ["CO", "MO", "NE", "OK"],
  KY: ["IL", "IN", "MO", "OH", "TN", "VA", "WV"],
  LA: ["AR", "MS", "TX"],
  MA: ["CT", "NH", "NY", "RI", "VT"],
  MD: ["DC", "DE", "PA", "VA", "WV"],
  ME: ["NH"],
  MI: ["IN", "OH", "WI"],
  MN: ["IA", "ND", "SD", "WI"],
  MO: ["AR", "IA", "IL", "KS", "KY", "NE", "OK", "TN"],
  MS: ["AL", "AR", "LA", "TN"],
  MT: ["ID", "ND", "SD", "WY"],
  NC: ["GA", "SC", "TN", "VA"],
  ND: ["MN", "MT", "SD"],
  NE: ["CO", "IA", "KS", "MO", "SD", "WY"],
  NH: ["MA", "ME", "VT"],
  NJ: ["DE", "NY", "PA"],
  NM: ["AZ", "CO", "OK", "TX", "UT"],
  NV: ["AZ", "CA", "ID", "OR", "UT"],
  NY: ["CT", "MA", "NJ", "PA", "VT"],
  OH: ["IN", "KY", "MI", "PA", "WV"],
  OK: ["AR", "CO", "KS", "MO", "NM", "TX"],
  OR: ["CA", "ID", "NV", "WA"],
  PA: ["DE", "MD", "NJ", "NY", "OH", "WV"],
  RI: ["CT", "MA"],
  SC: ["GA", "NC"],
  SD: ["IA", "MN", "MT", "ND", "NE", "WY"],
  TN: ["AL", "AR", "GA", "KY", "MO", "MS", "NC", "VA"],
  TX: ["AR", "LA", "NM", "OK"],
  UT: ["AZ", "CO", "ID", "NM", "NV", "WY"],
  VA: ["DC", "KY", "MD", "NC", "TN", "WV"],
  VT: ["MA", "NH", "NY"],
  WA: ["ID", "OR"],
  WI: ["IA", "IL", "MI", "MN"],
  WV: ["KY", "MD", "OH", "PA", "VA"],
  WY: ["CO", "ID", "MT", "NE", "SD", "UT"],
};

/** Statuses that mean the load reached a commercial conclusion. */
const DELIVERED_STATUSES = new Set(["delivered", "completed", "invoiced", "paid"]);
const CANCELLED_STATUSES = new Set(["cancelled", "canceled", "rejected", "lost"]);
const NON_ACTIVE_STATUSES = new Set(["draft", ...DELIVERED_STATUSES, ...CANCELLED_STATUSES]);

export function createEmptySearchCriteria(): SearchCriteria {
  return {
    originCity: "",
    originState: "",
    originZip5: "",
    originZip3: "",
    destinationCity: "",
    destinationState: "",
    destinationZip5: "",
    destinationZip3: "",
    equipmentType: "",
    pickupDate: "",
    deliveryDate: "",
    weight: 0,
    commodity: "",
    customer: "",
    broker: "",
    referenceId: "",
    rfpId: "",
    quoteId: "",
    loadId: "",
    marketArea: "",
    radiusMiles: 75,
  };
}

/**
 * True when the criteria name a lane both predicates can actually use.
 *
 * Every match rule needs an origin *and* a destination, so a half-filled form
 * can only ever return nothing. The page uses this to keep the search button
 * from spending a round trip to prove that.
 */
export function hasSearchableLane(criteria: SearchCriteria): boolean {
  const origin = norm(criteria.originCity) || norm(criteria.originState);
  const destination = norm(criteria.destinationCity) || norm(criteria.destinationState);
  return Boolean(origin && destination);
}

export function deriveLoadFieldOptions(loads: LoadRecord[]) {
  const uniqueSorted = (values: Array<string | undefined>) =>
    [
      ...new Set(
        values.map((value) => value?.trim()).filter((value): value is string => Boolean(value)),
      ),
    ].sort((a, b) => a.localeCompare(b));

  // States are matched case-insensitively and the inputs upper-case what is
  // typed, so the option list has to be upper-cased too or "tx" and "TX" both
  // show up as separate choices.
  const uniqueStates = (values: Array<string | undefined>) =>
    [
      ...new Set(
        values
          .map((value) => value?.trim().toUpperCase())
          .filter((value): value is string => Boolean(value)),
      ),
    ].sort((a, b) => a.localeCompare(b));

  return {
    customers: uniqueSorted(loads.map((load) => load.customer)),
    brokers: uniqueSorted(loads.map((load) => load.broker)),
    states: uniqueStates([
      ...loads.map((load) => load.pickupState),
      ...loads.map((load) => load.deliveryState),
    ]),
    equipmentTypes: uniqueSorted(loads.map((load) => load.equipmentType)),
  };
}

export const DEFAULT_SEARCH_OPTIONS: SearchOptions = {
  exactLaneMatch: true,
  similarLaneMatch: true,
  adjacentMarketSearch: true,
  includeBackhaulCandidates: true,
  includeActiveLoads: true,
  includeDatMarketData: true,
  includeLast30Days: true,
  includeLast60Days: true,
  includeLast90Days: true,
};

export function getDisconnectedDatSnapshot(): DatSnapshot {
  return {
    status: "Unavailable",
    marketMinimum: null,
    marketAverage: null,
    marketMaximum: null,
    ratePerMile: null,
    fuelEstimate: null,
    capacityIndicator: null,
    confidence: null,
    dataWindow: "—",
    lastRefreshed: "—",
    sourceStatus: DAT_NOT_CONNECTED_MESSAGE,
  };
}

function norm(value?: string) {
  return (value ?? "").trim().toLowerCase();
}

function normState(value?: string) {
  return (value ?? "").trim().toUpperCase();
}

function parseRate(value?: string): number | null {
  if (!value?.trim()) return null;
  const n = Number.parseFloat(value.replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}

function loadDate(load: LoadRecord): Date | null {
  const raw = load.pickupDate ?? load.createdAt;
  if (!raw) return null;
  const date = new Date(`${raw.slice(0, 10)}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function daysAgo(days: number) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date;
}

/**
 * A load with no usable date is *outside* every window.
 *
 * It used to return true, which put undated loads inside the 30-, 60- and
 * 90-day buckets at once and let them drive a "last 30 days" average.
 */
function inWindow(load: LoadRecord, days: number) {
  const date = loadDate(load);
  if (!date) return false;
  return date >= daysAgo(days);
}

function equipmentMatches(load: LoadRecord, criteria: SearchCriteria) {
  const loadEq = norm(load.equipmentType);
  const searchEq = norm(criteria.equipmentType);
  if (!loadEq || !searchEq) return true;
  return loadEq === searchEq;
}

function exactLaneMatch(load: LoadRecord, criteria: SearchCriteria) {
  return (
    norm(load.pickupCity) === norm(criteria.originCity) &&
    norm(load.pickupState) === norm(criteria.originState) &&
    norm(load.deliveryCity) === norm(criteria.destinationCity) &&
    norm(load.deliveryState) === norm(criteria.destinationState)
  );
}

function similarLaneMatch(load: LoadRecord, criteria: SearchCriteria) {
  const originState = normState(criteria.originState);
  const destinationState = normState(criteria.destinationState);
  if (!originState || !destinationState) return false;
  return (
    normState(load.pickupState) === originState &&
    normState(load.deliveryState) === destinationState
  );
}

function statesWithin(state: string): Set<string> {
  const key = normState(state);
  return new Set([key, ...(ADJACENT_STATES[key] ?? [])]);
}

/** Same lane, or either end in a state that borders the searched one. */
function adjacentMarketMatch(load: LoadRecord, criteria: SearchCriteria) {
  const originState = normState(criteria.originState);
  const destinationState = normState(criteria.destinationState);
  if (!originState || !destinationState) return false;
  return (
    statesWithin(originState).has(normState(load.pickupState)) &&
    statesWithin(destinationState).has(normState(load.deliveryState))
  );
}

/** The narrowest rule this load satisfies, or `null` if it is out of scope. */
function classifyMatch(
  load: LoadRecord,
  criteria: SearchCriteria,
  options: SearchOptions,
): LaneMatchType | null {
  if (options.exactLaneMatch && exactLaneMatch(load, criteria)) return "exact";
  if (options.similarLaneMatch && similarLaneMatch(load, criteria)) return "similar";
  if (options.adjacentMarketSearch && adjacentMarketMatch(load, criteria)) return "adjacent";
  return null;
}

function laneKey(load: LoadRecord) {
  return `${load.pickupCity ?? ""}|${load.pickupState ?? ""}|${load.deliveryCity ?? ""}|${load.deliveryState ?? ""}|${load.equipmentType ?? ""}`;
}

function laneLabel(load: LoadRecord, suffix?: string) {
  const base = `${load.pickupCity ?? "—"}, ${load.pickupState ?? "—"} to ${load.deliveryCity ?? "—"}, ${load.deliveryState ?? "—"}`;
  return suffix ? `${base} (${suffix})` : base;
}

function isActiveLoad(load: LoadRecord) {
  const status = norm(load.loadStatus);
  return status.length > 0 && !NON_ACTIVE_STATUSES.has(status);
}

function isDelivered(load: LoadRecord) {
  return DELIVERED_STATUSES.has(norm(load.loadStatus));
}

function isCancelled(load: LoadRecord) {
  return CANCELLED_STATUSES.has(norm(load.loadStatus));
}

function mean(values: number[]) {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** `null` rather than 0 for an empty set, so callers cannot print a fake average. */
function meanOrNull(values: number[]): number | null {
  if (values.length === 0) return null;
  return Math.round(mean(values));
}

function stdDev(values: number[]) {
  if (values.length <= 1) return 0;
  const avg = mean(values);
  const variance = values.reduce((sum, value) => sum + (value - avg) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

function deriveMarginBand(
  recommendedBid: number,
  marketAverage: number | null,
  marginPct: number,
): MarginBand {
  if (marketAverage == null || marketAverage <= 0) {
    if (marginPct >= 16) return "Strong Margin";
    if (marginPct >= 10) return "Healthy Margin";
    if (marginPct >= 6) return "Low Margin";
    return "Conservative Bid";
  }
  const delta = recommendedBid - marketAverage;
  if (delta > 180) return "Above Market";
  if (delta < -180) return "Below Market";
  if (marginPct >= 16) return "Strong Margin";
  if (marginPct >= 10) return "Healthy Margin";
  if (marginPct >= 6) return "Low Margin";
  if (delta > 60) return "Aggressive Bid";
  return "At Market";
}

type PricedLoad = { load: LoadRecord; buy: number; sell: number; margin: number };

function pricedLoads(loads: LoadRecord[]): { rows: PricedLoad[]; dropped: number } {
  const rows: PricedLoad[] = [];
  let dropped = 0;

  for (const load of loads) {
    const buy = parseRate(load.carrierRate);
    const sell = parseRate(load.customerRate);
    if (buy == null || sell == null) {
      dropped += 1;
      continue;
    }
    rows.push({ load, buy, sell, margin: sell - buy });
  }

  return { rows, dropped };
}

function filterLoadsForSearch(
  loads: LoadRecord[],
  criteria: SearchCriteria,
  options: SearchOptions,
): Array<{ load: LoadRecord; matchType: LaneMatchType }> {
  const matched: Array<{ load: LoadRecord; matchType: LaneMatchType }> = [];
  for (const load of loads) {
    if (!equipmentMatches(load, criteria)) continue;
    const matchType = classifyMatch(load, criteria, options);
    if (matchType) matched.push({ load, matchType });
  }
  return matched;
}

/**
 * Blend the sell-side signals that are actually present.
 *
 * Weights are re-normalised over whatever survives, so a disconnected DAT feed
 * widens the internal signals instead of multiplying a missing market average
 * by 0.4 and dragging the recommendation down by that much.
 */
function blendRecommendedBid(inputs: Array<{ value: number | null; weight: number }>): number {
  const present = inputs.filter(
    (input): input is { value: number; weight: number } => input.value != null && input.value > 0,
  );
  if (present.length === 0) return 0;
  const totalWeight = present.reduce((sum, input) => sum + input.weight, 0);
  if (totalWeight <= 0) return 0;
  return Math.round(
    present.reduce((sum, input) => sum + input.value * input.weight, 0) / totalWeight,
  );
}

function aggregateGroup(args: {
  key: string;
  label: string;
  matchType: LaneMatchType;
  rows: PricedLoad[];
  dropped: number;
  dat: DatSnapshot;
  options: SearchOptions;
  similarActiveCount: number;
}): HistoricalResultRow {
  const { key, label, matchType, rows, dropped, dat, options, similarActiveCount } = args;

  const buys = rows.map((row) => row.buy);
  const sells = rows.map((row) => row.sell);
  const margins = rows.map((row) => row.margin);
  const historicalAvgBuy = Math.round(mean(buys));
  const historicalAvgSell = Math.round(mean(sells));
  const historicalMargin = Math.round(mean(margins));
  const historicalMarginPct =
    historicalAvgSell > 0 ? Number(((historicalMargin / historicalAvgSell) * 100).toFixed(1)) : 0;

  // A win rate is only meaningful against loads that reached a conclusion.
  // Counting live freight in the denominator reported every rolling load as a
  // loss and pushed the lane's risk score up for being busy.
  const deliveredCount = rows.filter(({ load }) => isDelivered(load)).length;
  const cancelledCount = rows.filter(({ load }) => isCancelled(load)).length;
  const settledLoadCount = deliveredCount + cancelledCount;
  const winRate =
    settledLoadCount > 0 ? Number(((deliveredCount / settledLoadCount) * 100).toFixed(1)) : null;

  const windowAverages = (days: number, enabled: boolean) => {
    if (!enabled) return { buy: null, sell: null };
    const inRange = rows.filter(({ load }) => inWindow(load, days));
    return {
      buy: meanOrNull(inRange.map((row) => row.buy)),
      sell: meanOrNull(inRange.map((row) => row.sell)),
    };
  };

  const w30 = windowAverages(30, options.includeLast30Days);
  const w60 = windowAverages(60, options.includeLast60Days);
  const w90 = windowAverages(90, options.includeLast90Days);

  const useDat = options.includeDatMarketData;
  const datMarketMin = useDat ? dat.marketMinimum : null;
  const datMarketAvg = useDat ? dat.marketAverage : null;
  const datMarketMax = useDat ? dat.marketMaximum : null;
  const datRatePerMile = useDat ? dat.ratePerMile : null;

  // Recency first, then the long baseline, then the market — each dropping out
  // of the blend entirely when it has nothing to say.
  const recommendedBid = blendRecommendedBid([
    { value: w30.sell, weight: 0.4 },
    { value: w90.sell, weight: 0.15 },
    { value: historicalAvgSell, weight: 0.3 },
    { value: datMarketAvg, weight: 0.15 },
  ]);

  const spread = Math.round(stdDev(sells));
  // Bounds come from this lane's own dispersion. The old fixed $1,800-$5,200
  // band floored cheap lanes and capped expensive ones by up to half.
  const recommendedBidFloor = Math.max(
    historicalAvgBuy,
    Math.round(historicalAvgSell - 3 * spread),
  );
  const recommendedBidCeiling = Math.round(historicalAvgSell + 3 * spread) || historicalAvgSell;

  const marginBand = deriveMarginBand(recommendedBid, datMarketAvg, historicalMarginPct);

  // Confidence tracks the sample we kept *and* what we had to throw away, so a
  // lane assembled from one usable load out of twelve cannot read as confident.
  const sampleQuality = rows.length + dropped > 0 ? rows.length / (rows.length + dropped) : 1;
  const confidence = Math.round(Math.min(96, Math.max(20, (40 + rows.length * 4) * sampleQuality)));

  const riskFromWinRate = winRate == null ? 0 : winRate * 0.45;
  const riskScore = Math.round(
    Math.min(96, Math.max(12, 100 - riskFromWinRate + historicalMarginPct * 1.2)),
  );

  return {
    id: key,
    lane: label,
    matchType,
    equipment: rows[0]?.load.equipmentType ?? "—",
    historicalAvgBuy,
    historicalAvgSell,
    historicalMargin,
    historicalMarginPct,
    standardDeviation: spread,
    winRate,
    settledLoadCount,
    deliveredCount,
    cancelledCount,
    last30AvgBuy: w30.buy,
    last30AvgSell: w30.sell,
    last60AvgBuy: w60.buy,
    last60AvgSell: w60.sell,
    last90AvgBuy: w90.buy,
    last90AvgSell: w90.sell,
    datMarketMin,
    datMarketAvg,
    datMarketMax,
    datRatePerMile,
    marginBand,
    riskScore,
    similarActiveLoads: similarActiveCount,
    confidence,
    recommendedBid,
    recommendedBidFloor,
    recommendedBidCeiling,
    loadCount: rows.length,
    droppedForMissingRates: dropped,
  };
}

const MATCH_RANK: Record<LaneMatchType, number> = { exact: 0, similar: 1, adjacent: 2 };

export function buildHistoricalRowsFromLoads(
  loads: LoadRecord[],
  criteria: SearchCriteria,
  options: SearchOptions,
  dat: DatSnapshot,
): HistoricalResultRow[] {
  const matched = filterLoadsForSearch(loads, criteria, options);
  if (matched.length === 0) return [];

  const activeCount = matched.filter((entry) => isActiveLoad(entry.load)).length;

  const groups = new Map<
    string,
    { rows: PricedLoad[]; dropped: number; matchType: LaneMatchType; sample: LoadRecord }
  >();

  for (const { load, matchType } of matched) {
    const key = laneKey(load);
    const bucket = groups.get(key) ?? { rows: [], dropped: 0, matchType, sample: load };
    const { rows, dropped } = pricedLoads([load]);
    bucket.rows.push(...rows);
    bucket.dropped += dropped;
    // Keep the narrowest classification any load in the group earned.
    if (MATCH_RANK[matchType] < MATCH_RANK[bucket.matchType]) bucket.matchType = matchType;
    groups.set(key, bucket);
  }

  const rows = Array.from(groups.entries())
    .filter(([, group]) => group.rows.length > 0)
    .map(([key, group]) =>
      aggregateGroup({
        key,
        label: laneLabel(group.sample, MATCH_LABEL[group.matchType]),
        matchType: group.matchType,
        rows: group.rows,
        dropped: group.dropped,
        dat,
        options,
        similarActiveCount: activeCount,
      }),
    );

  // Closest match first, then the deepest sample — the old sort put a
  // 40-load adjacent lane above the exact lane the user asked for.
  return rows.sort(
    (a, b) => MATCH_RANK[a.matchType] - MATCH_RANK[b.matchType] || b.loadCount - a.loadCount,
  );
}

const MATCH_LABEL: Record<LaneMatchType, string> = {
  exact: "Exact lane",
  similar: "Same states",
  adjacent: "Adjacent market",
};

/** Days between two loads' pickup dates, or `null` when either is unknown. */
function dayGap(load: LoadRecord, criteriaDate: string): number | null {
  if (!criteriaDate) return null;
  const target = new Date(`${criteriaDate.slice(0, 10)}T00:00:00`);
  const actual = loadDate(load);
  if (!actual || Number.isNaN(target.getTime())) return null;
  return Math.abs(actual.getTime() - target.getTime()) / 86_400_000;
}

/**
 * Composite 0-100 similarity: lane closeness dominates, with equipment, pickup
 * proximity and customer overlap as modifiers. Previously this was
 * `exact ? 100 : 0`, which made the leverage list unsortable and printed a
 * hard 0% next to loads that were a genuine match on everything but city.
 */
function leverageSimilarity(
  load: LoadRecord,
  criteria: SearchCriteria,
  matchType: LaneMatchType,
): number {
  let score = matchType === "exact" ? 70 : matchType === "similar" ? 45 : 25;

  if (norm(load.equipmentType) && norm(load.equipmentType) === norm(criteria.equipmentType)) {
    score += 12;
  }
  if (norm(load.customer) && norm(load.customer) === norm(criteria.customer)) {
    score += 10;
  }

  const gap = dayGap(load, criteria.pickupDate);
  if (gap != null) {
    if (gap <= 2) score += 8;
    else if (gap <= 7) score += 5;
    else if (gap > 30) score -= 5;
  }

  return Math.round(Math.min(100, Math.max(0, score)));
}

export function buildLeverageLoadsFromAws(
  loads: LoadRecord[],
  criteria: SearchCriteria,
  options: SearchOptions,
): LeverageLoad[] {
  if (!options.includeActiveLoads) return [];

  const candidates: Array<{ load: LoadRecord; matchType: LaneMatchType; score: number }> = [];

  for (const load of loads) {
    if (!isActiveLoad(load)) continue;
    if (!equipmentMatches(load, criteria)) continue;
    const matchType = classifyMatch(load, criteria, options);
    if (!matchType) continue;
    candidates.push({ load, matchType, score: leverageSimilarity(load, criteria, matchType) });
  }

  // Rank before truncating. Slicing first meant an exact-lane match sitting at
  // index 9 was dropped in favour of eight weaker state-level matches.
  return candidates
    .sort((a, b) => b.score - a.score || MATCH_RANK[a.matchType] - MATCH_RANK[b.matchType])
    .slice(0, 8)
    .map(({ load, matchType, score }) => {
      const buy = parseRate(load.carrierRate);
      const sell = parseRate(load.customerRate);
      return {
        loadNumber: load.loadId,
        customer: load.customer ?? "—",
        origin: `${load.pickupCity ?? "—"}, ${load.pickupState ?? "—"}`,
        destination: `${load.deliveryCity ?? "—"}, ${load.deliveryState ?? "—"}`,
        equipment: load.equipmentType ?? criteria.equipmentType,
        pickupDate: load.pickupDate ?? "—",
        deliveryDate: load.deliveryDate ?? "—",
        currentStatus: load.loadStatus ?? "Active",
        buyRate: buy,
        sellRate: sell,
        margin: buy != null && sell != null ? sell - buy : null,
        assignedCarrier: load.assignedCarrier ?? "Unassigned",
        similarityPct: score,
        matchType,
      };
    });
}

export function buildBackhaulCandidatesFromAws(
  loads: LoadRecord[],
  criteria: SearchCriteria,
  options: SearchOptions,
): BackhaulCandidate[] {
  if (!options.includeBackhaulCandidates) return [];

  const destinationState = normState(criteria.destinationState);
  if (!destinationState) return [];

  // A backhaul candidate is a load that leaves equipment near where this one
  // ends. Same delivery city as the searched destination is the strong case;
  // same state is the weak one.
  const candidates = loads
    .filter(isActiveLoad)
    .filter((load) => equipmentMatches(load, criteria))
    .filter((load) => normState(load.deliveryState) === destinationState)
    .map((load) => {
      const sameCity =
        norm(load.deliveryCity) !== "" &&
        norm(load.deliveryCity) === norm(criteria.destinationCity);
      const sell = parseRate(load.customerRate);
      const buy = parseRate(load.carrierRate);
      const value = sell != null && buy != null ? Math.max(0, sell - buy) : null;

      let score = sameCity ? 70 : 40;
      if (norm(load.equipmentType) && norm(load.equipmentType) === norm(criteria.equipmentType)) {
        score += 15;
      }
      const gap = dayGap(load, criteria.deliveryDate);
      if (gap != null && gap <= 3) score += 10;

      return {
        loadNumber: load.loadId,
        currentDeliveryMarket: `${load.deliveryCity ?? "—"}, ${load.deliveryState ?? "—"}`,
        destination: `${criteria.originCity || "—"}, ${criteria.originState || "—"}`,
        equipment: load.equipmentType ?? criteria.equipmentType,
        availableDate: load.deliveryDate ?? criteria.deliveryDate ?? "—",
        similarityPct: Math.min(100, score),
        estimatedBackhaulValue: value,
        suggestedCarrier: load.assignedCarrier ?? "Unassigned",
        rankScore: Math.min(100, score),
      };
    });

  return candidates.sort((a, b) => b.rankScore - a.rankScore).slice(0, 5);
}
