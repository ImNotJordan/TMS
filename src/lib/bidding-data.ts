import { isAiBiddingCopilotEnabled } from "./integrations-config";
import { listAllLoadsCached, type LoadRecord } from "./loads-store";
import { listFingerprint } from "./operational-data-cache";
import { listRiskModelsCached, type RiskModelRecord } from "./risk-models-store";

export type DatStatus = "Live" | "Refreshing" | "Stale" | "Unavailable" | "API Error";

export type DatSnapshot = {
  status: DatStatus;
  marketMinimum: number;
  marketAverage: number;
  marketMaximum: number;
  ratePerMile: number;
  fuelEstimate: number;
  capacityIndicator: number;
  confidence: number;
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
  equipment: string;
  historicalAvgBuy: number;
  historicalAvgSell: number;
  historicalMargin: number;
  historicalMarginPct: number;
  standardDeviation: number;
  winRate: number;
  last30AvgBuy: number;
  last30AvgSell: number;
  last60AvgBuy: number;
  last60AvgSell: number;
  last90AvgBuy: number;
  last90AvgSell: number;
  datMarketMin: number;
  datMarketAvg: number;
  datMarketMax: number;
  datRatePerMile: number;
  marginBand: MarginBand;
  riskScore: number;
  similarActiveLoads: number;
  confidence: number;
  recommendedBid: number;
  loadCount: number;
  acceptedQuoteCount: number;
  lostQuoteCount: number;
  similarLaneAverage: number;
  sameCustomerAverage: number;
  sameEquipmentAverage: number;
  minimumAcceptableMargin: number;
  targetMargin: number;
  stretchMargin: number;
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
  buyRate: number;
  sellRate: number;
  margin: number;
  assignedCarrier: string;
  similarityPct: number;
  distanceFromLane: number;
};

export type BackhaulCandidate = {
  loadNumber: string;
  currentDeliveryMarket: string;
  candidatePickupMarket: string;
  destination: string;
  equipment: string;
  availableDate: string;
  deadheadMiles: number;
  similarityPct: number;
  estimatedBackhaulValue: number;
  suggestedCarrier: string;
  rankScore: number;
};

export type RiskModelOption = {
  id: string;
  name: string;
  version: string;
  owner: string;
  lastPublished: string;
  riskType: string;
  inputsRequired: string[];
  weights: Record<string, number>;
};

export const DAT_NOT_CONNECTED_MESSAGE =
  "DAT RateView API is not yet connected. Configure credentials in Settings > Integrations.";

export const AI_NOT_CONNECTED_MESSAGE =
  "AI bid suggestions are not yet connected. Enable the AI Bidding Copilot integration in Settings.";

const DEFAULT_RISK_WEIGHTS: Record<string, number> = {
  fuelIndex: 0.08,
  seasonality: 0.1,
  marketVolatility: 0.18,
  laneVolatility: 0.14,
  datSpread: 0.13,
  carrierReliability: -0.12,
  weatherRisk: 0.1,
  dwellAverage: 0.07,
  historicalWinRate: -0.08,
  activeLoadLeverage: -0.06,
  equipmentTightness: 0.16,
};

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

export function deriveLoadFieldOptions(loads: LoadRecord[]) {
  const uniqueSorted = (values: Array<string | undefined>) =>
    [...new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value)))].sort(
      (a, b) => a.localeCompare(b),
    );

  return {
    customers: uniqueSorted(loads.map((load) => load.customer)),
    brokers: uniqueSorted(loads.map((load) => load.broker)),
    states: uniqueSorted([...loads.map((load) => load.pickupState), ...loads.map((load) => load.deliveryState)]),
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

export function isDatApiConnected() {
  return import.meta.env.VITE_DAT_API_ENABLED === "true";
}

export function isAiBidConnected() {
  if (import.meta.env.VITE_AI_BID_API_ENABLED === "true") return true;
  return isAiBiddingCopilotEnabled();
}

export function getDisconnectedDatSnapshot(): DatSnapshot {
  return {
    status: "Unavailable",
    marketMinimum: 0,
    marketAverage: 0,
    marketMaximum: 0,
    ratePerMile: 0,
    fuelEstimate: 0,
    capacityIndicator: 0,
    confidence: 0,
    dataWindow: "—",
    lastRefreshed: "—",
    sourceStatus: DAT_NOT_CONNECTED_MESSAGE,
  };
}

export function getDatSnapshotForBidding(): DatSnapshot {
  if (isDatApiConnected()) {
    // Placeholder until DAT RateView proxy is implemented.
    return getDisconnectedDatSnapshot();
  }
  return getDisconnectedDatSnapshot();
}

export async function fetchBiddingLoads(options?: { force?: boolean }): Promise<LoadRecord[]> {
  return listAllLoadsCached({ force: options?.force });
}

export function getBiddingLoadsFingerprint(loads: LoadRecord[]): string {
  return listFingerprint(loads, (load) => load.loadId);
}

export async function fetchBiddingRiskModels(options?: { force?: boolean }): Promise<RiskModelOption[]> {
  try {
    const remote = await listRiskModelsCached({ force: options?.force });
    return remote.map(mapRiskModelRecord);
  } catch (err) {
    console.warn("[bidding] Could not load risk models from AWS", err);
    return [];
  }
}

const DEFAULT_RISK_INPUTS = [
  "Fuel Index",
  "Seasonality",
  "Market Volatility",
  "Lane Volatility",
  "DAT Spread",
  "Carrier Reliability",
  "Weather Risk",
  "Dwell Average",
  "Historical Win Rate",
  "Active Load Leverage",
  "Equipment Tightness",
];

function mapRiskModelRecord(record: RiskModelRecord): RiskModelOption {
  const weights =
    record.weights && typeof record.weights === "object" && !Array.isArray(record.weights)
      ? (record.weights as Record<string, number>)
      : DEFAULT_RISK_WEIGHTS;
  const inputVariables = Array.isArray(record.inputVariables)
    ? (record.inputVariables as string[])
    : DEFAULT_RISK_INPUTS;

  return {
    id: record.id,
    name: String(record.modelName ?? record.name ?? record.id),
    version: String(record.version ?? "v1.0"),
    owner: String(record.owner ?? "—"),
    lastPublished: String(record.lastPublished ?? record.lastModified ?? "—"),
    riskType: String(record.riskType ?? "Lane Pricing"),
    inputsRequired: inputVariables,
    weights,
  };
}

function norm(value?: string) {
  return (value ?? "").trim().toLowerCase();
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

function inWindow(load: LoadRecord, days: number) {
  const date = loadDate(load);
  if (!date) return true;
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
  return (
    norm(load.pickupState) === norm(criteria.originState) &&
    norm(load.deliveryState) === norm(criteria.destinationState)
  );
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
  return status.length > 0 && !["draft", "delivered", "completed", "cancelled"].includes(status);
}

function mean(values: number[]) {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function stdDev(values: number[]) {
  if (values.length <= 1) return 0;
  const avg = mean(values);
  const variance = values.reduce((sum, value) => sum + (value - avg) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

function deriveMarginBand(
  recommendedBid: number,
  marketAverage: number,
  marginPct: number,
): MarginBand {
  if (marketAverage <= 0) {
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

function pricedLoads(loads: LoadRecord[]) {
  return loads
    .map((load) => {
      const buy = parseRate(load.carrierRate);
      const sell = parseRate(load.customerRate);
      if (buy == null || sell == null) return null;
      return { load, buy, sell, margin: sell - buy };
    })
    .filter((row): row is NonNullable<typeof row> => row != null);
}

function filterLoadsForSearch(loads: LoadRecord[], criteria: SearchCriteria, options: SearchOptions) {
  return loads.filter((load) => {
    if (!equipmentMatches(load, criteria)) return false;
    if (options.exactLaneMatch && exactLaneMatch(load, criteria)) return true;
    if (options.similarLaneMatch && similarLaneMatch(load, criteria)) return true;
    if (options.adjacentMarketSearch && similarLaneMatch(load, criteria)) return true;
    return false;
  });
}

function aggregateGroup(
  key: string,
  label: string,
  rows: ReturnType<typeof pricedLoads>,
  dat: DatSnapshot,
  similarActiveCount: number,
): HistoricalResultRow {
  const buys = rows.map((row) => row.buy);
  const sells = rows.map((row) => row.sell);
  const margins = rows.map((row) => row.margin);
  const historicalAvgBuy = Math.round(mean(buys));
  const historicalAvgSell = Math.round(mean(sells));
  const historicalMargin = Math.round(mean(margins));
  const historicalMarginPct =
    historicalAvgSell > 0 ? Number(((historicalMargin / historicalAvgSell) * 100).toFixed(1)) : 0;
  const delivered = rows.filter(({ load }) => norm(load.loadStatus) === "delivered").length;
  const winRate = rows.length > 0 ? Number(((delivered / rows.length) * 100).toFixed(1)) : 0;

  const last30 = rows.filter(({ load }) => inWindow(load, 30));
  const last60 = rows.filter(({ load }) => inWindow(load, 60));
  const last90 = rows.filter(({ load }) => inWindow(load, 90));

  const last30AvgBuy = Math.round(mean(last30.map((row) => row.buy)) || historicalAvgBuy);
  const last30AvgSell = Math.round(mean(last30.map((row) => row.sell)) || historicalAvgSell);
  const last60AvgBuy = Math.round(mean(last60.map((row) => row.buy)) || historicalAvgBuy);
  const last60AvgSell = Math.round(mean(last60.map((row) => row.sell)) || historicalAvgSell);
  const last90AvgBuy = Math.round(mean(last90.map((row) => row.buy)) || historicalAvgBuy);
  const last90AvgSell = Math.round(mean(last90.map((row) => row.sell)) || historicalAvgSell);

  const recommendedBid = Math.round(last30AvgSell * 0.55 + historicalAvgSell * 0.45);
  const marginBand = deriveMarginBand(recommendedBid, dat.marketAverage, historicalMarginPct);

  return {
    id: key,
    lane: label,
    equipment: rows[0]?.load.equipmentType ?? "—",
    historicalAvgBuy,
    historicalAvgSell,
    historicalMargin,
    historicalMarginPct,
    standardDeviation: Math.round(stdDev(sells)),
    winRate,
    last30AvgBuy,
    last30AvgSell,
    last60AvgBuy,
    last60AvgSell,
    last90AvgBuy,
    last90AvgSell,
    datMarketMin: dat.marketMinimum,
    datMarketAvg: dat.marketAverage,
    datMarketMax: dat.marketMaximum,
    datRatePerMile: dat.ratePerMile,
    marginBand,
    riskScore: Math.round(Math.min(96, Math.max(12, 100 - winRate * 0.45 + historicalMarginPct * 1.2))),
    similarActiveLoads: similarActiveCount,
    confidence: Math.min(96, Math.max(35, 40 + rows.length * 4)),
    recommendedBid,
    loadCount: rows.length,
    acceptedQuoteCount: delivered,
    lostQuoteCount: Math.max(0, rows.length - delivered),
    similarLaneAverage: historicalAvgSell,
    sameCustomerAverage: historicalAvgSell,
    sameEquipmentAverage: historicalAvgSell,
    minimumAcceptableMargin: Math.round(historicalAvgSell * 0.09),
    targetMargin: Math.round(historicalAvgSell * 0.14),
    stretchMargin: Math.round(historicalAvgSell * 0.18),
  };
}

export function buildHistoricalRowsFromLoads(
  loads: LoadRecord[],
  criteria: SearchCriteria,
  options: SearchOptions,
  dat: DatSnapshot,
): HistoricalResultRow[] {
  const matched = filterLoadsForSearch(loads, criteria, options);
  const priced = pricedLoads(matched);
  if (priced.length === 0) return [];

  const activeCount = matched.filter(isActiveLoad).length;
  const groups = new Map<string, ReturnType<typeof pricedLoads>>();

  for (const row of priced) {
    const key = laneKey(row.load);
    const bucket = groups.get(key) ?? [];
    bucket.push(row);
    groups.set(key, bucket);
  }

  const rows = Array.from(groups.entries()).map(([key, groupRows], index) => {
    const suffix = index === 0 ? "Primary" : `Similar ${index}`;
    return aggregateGroup(key, laneLabel(groupRows[0].load, suffix), groupRows, dat, activeCount);
  });

  return rows.sort((a, b) => b.loadCount - a.loadCount);
}

export function buildLeverageLoadsFromAws(
  loads: LoadRecord[],
  criteria: SearchCriteria,
  options: SearchOptions,
): LeverageLoad[] {
  if (!options.includeActiveLoads) return [];

  return loads
    .filter(isActiveLoad)
    .filter((load) => equipmentMatches(load, criteria))
    .filter((load) => similarLaneMatch(load, criteria) || exactLaneMatch(load, criteria))
    .slice(0, 8)
    .map((load) => {
      const buy = parseRate(load.carrierRate) ?? 0;
      const sell = parseRate(load.customerRate) ?? 0;
      const exact = exactLaneMatch(load, criteria);
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
        margin: sell - buy,
        assignedCarrier: load.assignedCarrier ?? "Unassigned",
        similarityPct: exact ? 100 : 0,
        distanceFromLane: 0,
      };
    });
}

export function buildBackhaulCandidatesFromAws(
  loads: LoadRecord[],
  criteria: SearchCriteria,
  options: SearchOptions,
): BackhaulCandidate[] {
  if (!options.includeBackhaulCandidates) return [];

  return loads
    .filter(isActiveLoad)
    .filter((load) => equipmentMatches(load, criteria))
    .filter((load) => norm(load.deliveryState) === norm(criteria.destinationState))
    .slice(0, 5)
    .map((load) => {
      const sell = parseRate(load.customerRate) ?? 0;
      const buy = parseRate(load.carrierRate) ?? 0;
      return {
        loadNumber: load.loadId,
        currentDeliveryMarket: `${load.deliveryCity ?? "—"}, ${load.deliveryState ?? "—"}`,
        candidatePickupMarket: `${load.deliveryCity ?? "—"}, ${load.deliveryState ?? "—"}`,
        destination: `${criteria.originCity}, ${criteria.originState}`,
        equipment: load.equipmentType ?? criteria.equipmentType,
        availableDate: load.deliveryDate ?? criteria.deliveryDate,
        deadheadMiles: 0,
        similarityPct: 0,
        estimatedBackhaulValue: Math.max(0, sell - buy),
        suggestedCarrier: load.assignedCarrier ?? "Unassigned",
        rankScore: Math.max(0, sell - buy),
      };
    });
}
