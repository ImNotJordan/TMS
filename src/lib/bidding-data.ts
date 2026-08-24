/**
 * Browser-facing bidding data access.
 *
 * The aggregation itself lives in `bidding-aggregate.ts`, which is pure and
 * shared with the server. This module is what the page talks to: feature flags,
 * the DAT snapshot, risk models, and the lane search — which now runs on the
 * server rather than by pulling the company's whole loads table into the tab.
 */
import { isAiBiddingCopilotEnabled } from "./integrations-config";
import { listRiskModelsCached, type RiskModelRecord } from "./risk-models-store";
import { getDisconnectedDatSnapshot, type DatSnapshot } from "./bidding-aggregate";
import { fetchAuthSession } from "aws-amplify/auth";
import type {
  BackhaulCandidate,
  HistoricalResultRow,
  LeverageLoad,
  SearchCriteria,
  SearchOptions,
} from "./bidding-aggregate";

export {
  AI_NOT_CONNECTED_MESSAGE,
  DAT_NOT_CONNECTED_MESSAGE,
  DEFAULT_SEARCH_OPTIONS,
  buildBackhaulCandidatesFromAws,
  buildHistoricalRowsFromLoads,
  buildLeverageLoadsFromAws,
  createEmptySearchCriteria,
  deriveLoadFieldOptions,
  getDisconnectedDatSnapshot,
  hasSearchableLane,
} from "./bidding-aggregate";

export type {
  BackhaulCandidate,
  DatSnapshot,
  DatStatus,
  HistoricalResultRow,
  LaneMatchType,
  LeverageLoad,
  MarginBand,
  SearchCriteria,
  SearchOptions,
} from "./bidding-aggregate";

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

const SEARCH_PATH = "/api/bidding/search";
const FIELD_OPTIONS_PATH = "/api/bidding/field-options";

export function isDatApiConnected() {
  return import.meta.env.VITE_DAT_API_ENABLED === "true";
}

export function isAiBidConnected() {
  if (import.meta.env.VITE_AI_BID_API_ENABLED === "true") return true;
  return isAiBiddingCopilotEnabled();
}

export function getDatSnapshotForBidding(): DatSnapshot {
  // Both branches are the disconnected snapshot until the RateView proxy
  // exists. Deliberately not zeros: nothing downstream should read an
  // unimplemented integration as "the market is worth $0".
  return getDisconnectedDatSnapshot();
}

async function authHeaders(): Promise<Record<string, string>> {
  try {
    const session = await fetchAuthSession();
    const token = session.tokens?.idToken?.toString();
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch {
    return {};
  }
}

export type BiddingSearchResponse = {
  results: HistoricalResultRow[];
  similarActiveLoads: LeverageLoad[];
  backhaulCandidates: BackhaulCandidate[];
  /** How many company loads the server considered, for the result summary. */
  loadsConsidered: number;
  matchedLoads: number;
};

export type BiddingFieldOptions = {
  customers: string[];
  brokers: string[];
  states: string[];
  equipmentTypes: string[];
};

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(path, {
    method: "POST",
    headers: { ...(await authHeaders()), "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const parsed = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(parsed?.error ?? `Bidding search failed (HTTP ${response.status}).`);
  }
  return (await response.json()) as T;
}

/**
 * Run a lane search on the server.
 *
 * This used to be `fetchBiddingLoads()` followed by client-side aggregation,
 * which meant every search shipped the company's entire loads table to the
 * browser — 17MB at 50,000 loads — to produce a handful of aggregate rows.
 */
export async function searchBiddingLanes(
  criteria: SearchCriteria,
  options: SearchOptions,
): Promise<BiddingSearchResponse> {
  return postJson<BiddingSearchResponse>(SEARCH_PATH, { criteria, options });
}

/** Distinct customers, brokers, states and equipment types for the datalists. */
export async function fetchBiddingFieldOptions(): Promise<BiddingFieldOptions> {
  const response = await fetch(FIELD_OPTIONS_PATH, { headers: await authHeaders() });
  if (!response.ok) {
    throw new Error(`Could not load search options (HTTP ${response.status}).`);
  }
  return (await response.json()) as BiddingFieldOptions;
}

export async function fetchBiddingRiskModels(options?: {
  force?: boolean;
}): Promise<RiskModelOption[]> {
  try {
    const remote = await listRiskModelsCached({ force: options?.force });
    return remote.map(mapRiskModelRecord);
  } catch (err) {
    console.warn("[bidding] Could not load risk models from AWS", err);
    return [];
  }
}

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
