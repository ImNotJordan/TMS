/**
 * Deterministic risk evaluation and bid suggestion.
 *
 * Lifted out of `bidding-page.tsx` so it can be tested directly — it decides
 * what the desk quotes, and it was previously reachable only by rendering the
 * page.
 *
 * ## Two rules hold this together
 *
 * **A missing input is dropped, never zeroed.** Risk weights and the sell-rate
 * blend are re-normalised over the signals that are present. With DAT
 * disconnected the old code multiplied a 0 market average by 0.4 and clamped
 * the result to a hard-coded $1,800 floor, which produced a recommended sell
 * *below* the recommended buy — a pre-filled losing quote, complete with a
 * confidence score.
 *
 * **A suggestion never prices below cost.** The sell rate is held at or above a
 * minimum margin over the recommended buy, and says so when it had to be.
 */
// From the pure module, not `bidding-data`: this must stay importable without
// dragging Amplify and the fetch layer along with it.
import type { DatSnapshot, HistoricalResultRow } from "./bidding-aggregate";

export type RiskLevel = "Low Risk" | "Medium Risk" | "High Risk" | "Critical Risk";
export type ConfidenceLevel = "Low Confidence" | "Medium Confidence" | "High Confidence";

export type RiskFactor = {
  name: string;
  value: number;
  weight: number;
  contribution: number;
  direction: "Positive" | "Negative";
};

export type RiskEvaluation = {
  outputRiskPct: number;
  riskLevel: RiskLevel;
  reasonCodes: string[];
  topContributingFactors: RiskFactor[];
  /** Model inputs the data could not supply, so the UI can say which. */
  unavailableInputs: string[];
  modelVersion: string;
  evaluationTimestamp: string;
  inputValues: Record<string, number>;
  deterministicSignature: string;
};

export type AiSuggestion = {
  suggestedBidLow: number;
  suggestedBidHigh: number;
  recommendedSellRate: number;
  recommendedBuyRate: number;
  targetMargin: number;
  marginPercentage: number;
  /** True when the sell rate was raised to hold the minimum margin. */
  marginFloorApplied: boolean;
  confidenceScore: number;
  confidenceLevel: ConfidenceLevel;
  guardrails: string[];
  notes: string;
  keyDrivers: string[];
  suggestedStrategy: string;
  customerFacingNote: string;
  internalPricingNote: string;
  whySuggestionRows: Array<{ label: string; value: string }>;
};

/** Floor on gross margin. A suggestion that cannot clear this is not offered. */
export const MINIMUM_MARGIN_PCT = 8;

export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function hash32(text: string) {
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash << 5) - hash + text.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

export function titleCase(value: string) {
  return value
    .replace(/([A-Z])/g, " $1")
    .replace(/[_-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

export function toRiskLevel(score: number): RiskLevel {
  if (score < 35) return "Low Risk";
  if (score < 60) return "Medium Risk";
  if (score < 80) return "High Risk";
  return "Critical Risk";
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

function money(value: number | null): string {
  return value == null ? "—" : formatCurrency(value);
}

function nowStamp() {
  const now = new Date();
  const pad = (value: number) => value.toString().padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())} ET`;
}

/**
 * Build the model inputs, leaving out anything the data cannot support.
 *
 * Every value here used to be produced unconditionally: a disconnected DAT feed
 * became `fuelIndex: 20`, `equipmentTightness: 10` and a `datSpread` pinned to
 * its lower bound, which pushed the risk score down roughly 12 points on
 * numbers nobody measured.
 */
function buildRiskInputs(
  row: HistoricalResultRow,
  dat: DatSnapshot,
  leverageCount: number,
): { values: Record<string, number>; unavailable: string[] } {
  const values: Record<string, number> = {};
  const unavailable: string[] = [];

  const add = (name: string, value: number | null, label: string) => {
    if (value == null || !Number.isFinite(value)) unavailable.push(label);
    else values[name] = value;
  };

  add(
    "fuelIndex",
    dat.fuelEstimate == null ? null : clamp(dat.fuelEstimate * 100, 20, 95),
    "Fuel Index",
  );
  values.seasonality = clamp(60 + (hash32(row.lane) % 30), 20, 95);

  const volatilityBase =
    row.historicalAvgBuy > 0 ? row.standardDeviation / row.historicalAvgBuy : null;
  add(
    "marketVolatility",
    volatilityBase == null ? null : clamp(volatilityBase * 1000, 10, 95),
    "Market Volatility",
  );

  const laneBase = row.historicalAvgSell > 0 ? row.standardDeviation / row.historicalAvgSell : null;
  add("laneVolatility", laneBase == null ? null : clamp(laneBase * 1000, 8, 90), "Lane Volatility");

  add(
    "datSpread",
    dat.marketAverage == null
      ? null
      : clamp(clamp((dat.marketAverage - row.historicalAvgBuy) / 10, -25, 40) + 50, 0, 100),
    "DAT Spread",
  );

  add(
    "carrierReliability",
    row.winRate == null ? null : clamp(row.winRate + 15, 20, 97),
    "Carrier Reliability",
  );
  values.weatherRisk = clamp(38 + (hash32(row.id) % 34), 10, 95);
  values.dwellAverage = clamp(30 + (hash32(row.equipment) % 40), 8, 90);
  add(
    "historicalWinRate",
    row.winRate == null ? null : clamp(row.winRate, 5, 96),
    "Historical Win Rate",
  );
  values.activeLoadLeverage = clamp(42 + leverageCount * 7, 5, 95);
  add(
    "equipmentTightness",
    dat.capacityIndicator == null ? null : clamp(dat.capacityIndicator, 10, 99),
    "Equipment Tightness",
  );

  return { values, unavailable };
}

export function evaluateRiskDeterministic(args: {
  row: HistoricalResultRow;
  dat: DatSnapshot;
  model: { id: string; version: string; weights: Record<string, number> };
  leverageCount: number;
}): RiskEvaluation {
  const { row, dat, model, leverageCount } = args;
  const { values: inputValues, unavailable } = buildRiskInputs(row, dat, leverageCount);

  const applicable = Object.entries(model.weights).filter(([name]) => name in inputValues);

  // Re-normalise over the weights we can actually evaluate, so dropping an
  // input redistributes its influence instead of quietly removing it from the
  // score and biasing the result low.
  const totalAbsWeight = applicable.reduce((sum, [, weight]) => sum + Math.abs(weight), 0);
  const modelAbsWeight = Object.values(model.weights).reduce(
    (sum, weight) => sum + Math.abs(weight),
    0,
  );
  const scale = totalAbsWeight > 0 ? modelAbsWeight / totalAbsWeight : 1;

  const topContributingFactors: RiskFactor[] = applicable
    .map(([name, weight]) => {
      const value = inputValues[name];
      const contribution = (value - 50) * weight * scale;
      return {
        name: titleCase(name),
        value,
        weight,
        contribution,
        direction: contribution >= 0 ? ("Positive" as const) : ("Negative" as const),
      };
    })
    .sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));

  const baseScore = 50 + topContributingFactors.reduce((acc, item) => acc + item.contribution, 0);
  const outputRiskPct = Math.round(clamp(baseScore, 3, 99));
  const riskLevel = toRiskLevel(outputRiskPct);
  const reasonCodes = buildReasonCodes({ outputRiskPct, dat, row, leverageCount, unavailable });
  const signature = hash32(
    JSON.stringify({ inputValues, modelId: model.id, modelVersion: model.version, lane: row.lane }),
  )
    .toString(16)
    .toUpperCase();

  return {
    outputRiskPct,
    riskLevel,
    reasonCodes,
    topContributingFactors: topContributingFactors.slice(0, 6),
    unavailableInputs: unavailable,
    modelVersion: model.version,
    evaluationTimestamp: nowStamp(),
    inputValues,
    deterministicSignature: `SIG-${signature}`,
  };
}

function buildReasonCodes(args: {
  outputRiskPct: number;
  dat: DatSnapshot;
  row: HistoricalResultRow;
  leverageCount: number;
  unavailable: string[];
}): string[] {
  const reasons: string[] = [];
  const { outputRiskPct, dat, row, leverageCount, unavailable } = args;

  if (row.standardDeviation > 105) reasons.push("High market volatility");
  if (row.winRate != null && row.winRate < 54) reasons.push("Weak historical win rate");
  if (row.winRate == null) reasons.push("No settled loads to score win rate");
  if (dat.marketAverage != null && dat.marketAverage > row.historicalAvgBuy + 240) {
    reasons.push("DAT average above target buy rate");
  }
  if (dat.capacityIndicator != null && dat.capacityIndicator > 72) {
    reasons.push("Tight capacity on origin market");
  }
  if (dat.fuelEstimate != null && dat.fuelEstimate > 0.62)
    reasons.push("Fuel index trending upward");
  if (leverageCount < 2) reasons.push("Limited active-load leverage");
  if (row.winRate != null && row.winRate > 68)
    reasons.push("Strong carrier reliability offsets risk");
  if (outputRiskPct > 76) reasons.push("Seasonality increases rate pressure");
  if (row.droppedForMissingRates > row.loadCount) reasons.push("Most comparable loads lack rates");
  if (unavailable.length > 0) reasons.push(`Scored without ${unavailable.length} model input(s)`);

  return reasons.slice(0, 6);
}

export function buildAiSuggestion(args: {
  row: HistoricalResultRow;
  risk: RiskEvaluation;
  dat: DatSnapshot;
  leverageCount: number;
  backhaulCount: number;
}): AiSuggestion {
  const { row, risk, dat, leverageCount, backhaulCount } = args;

  const riskPenalty = (risk.outputRiskPct - 50) * 3.2;
  const leverageOffset = leverageCount * 22 + backhaulCount * 16;

  // Buy side first: it sets the floor everything else has to clear.
  const buyCeiling = Math.max(row.historicalAvgBuy, row.recommendedBidCeiling);
  const recommendedBuyRate = Math.round(
    clamp(
      row.historicalAvgBuy + riskPenalty * 0.4 - leverageOffset * 0.45,
      Math.max(1, Math.round(row.historicalAvgBuy * 0.6)),
      buyCeiling,
    ),
  );

  // `row.recommendedBid` is already blended over the signals that exist, so a
  // disconnected DAT feed never enters here as a zero.
  const marketSell = clamp(
    row.recommendedBid + riskPenalty - leverageOffset * 0.2,
    row.recommendedBidFloor,
    row.recommendedBidCeiling,
  );
  // Margin is measured on the sell rate, so the floor is a division, not a
  // markup: buy × 1.08 leaves 7.4% margin, not 8%.
  const minimumSell = Math.round(recommendedBuyRate / (1 - MINIMUM_MARGIN_PCT / 100));
  const marginFloorApplied = marketSell < minimumSell;
  const recommendedSellRate = Math.round(Math.max(marketSell, minimumSell));

  const targetMargin = recommendedSellRate - recommendedBuyRate;
  const marginPercentage = (targetMargin / Math.max(recommendedSellRate, 1)) * 100;

  const datGap =
    dat.marketAverage == null ? 0 : Math.abs(dat.marketAverage - row.historicalAvgSell) / 30;
  const missingInputPenalty = risk.unavailableInputs.length * 4;
  const confidenceScore = Math.round(
    clamp(
      88 -
        datGap -
        missingInputPenalty -
        Math.max(0, risk.outputRiskPct - 55) * 0.45 +
        leverageCount * 2.5,
      20,
      97,
    ),
  );
  const confidenceLevel: ConfidenceLevel =
    confidenceScore >= 78
      ? "High Confidence"
      : confidenceScore >= 56
        ? "Medium Confidence"
        : "Low Confidence";

  const spread = Math.max(60, Math.round(row.standardDeviation * 0.5));
  const suggestedBidLow = Math.max(minimumSell, recommendedSellRate - spread);
  const suggestedBidHigh = recommendedSellRate + Math.round(spread * 0.7);

  const guardrails = [
    `Do not bid below ${formatCurrency(minimumSell)} — that is the ${MINIMUM_MARGIN_PCT}% margin floor over the recommended buy.`,
    `Require manager approval if margin drops below ${Math.max(5, Math.round(marginPercentage - 3))}%.`,
    dat.status === "Unavailable"
      ? "DAT RateView is not connected: this bid is priced from internal history only."
      : dat.status === "Stale"
        ? "DAT stale data warning: refresh before final quote release."
        : "Escalate if DAT market average moves above current snapshot by 4%+.",
    risk.riskLevel === "High Risk" || risk.riskLevel === "Critical Risk"
      ? "High risk warning: require approval and mitigation notes."
      : "Proceed with standard approval workflow unless capacity tightens.",
    `Maximum buy rate allowed ${formatCurrency(Math.round(recommendedSellRate * (1 - MINIMUM_MARGIN_PCT / 100)))}.`,
  ];

  if (marginFloorApplied) {
    guardrails.unshift(
      `Market signals priced this lane below cost — the sell rate was raised to hold a ${MINIMUM_MARGIN_PCT}% margin. Verify the buy side before sending.`,
    );
  }

  const winRateText =
    row.winRate == null ? "no settled loads yet" : `${row.winRate.toFixed(1)}% win rate`;
  const notes =
    `Priced from ${row.loadCount} comparable load${row.loadCount === 1 ? "" : "s"} (${winRateText})` +
    `${row.droppedForMissingRates > 0 ? `, ${row.droppedForMissingRates} skipped for missing rates` : ""}. ` +
    `${dat.marketAverage == null ? "DAT market data unavailable" : `DAT average ${formatCurrency(dat.marketAverage)}`}; ` +
    `leverage includes ${leverageCount} similar active load${leverageCount === 1 ? "" : "s"} and ${backhaulCount} backhaul option${backhaulCount === 1 ? "" : "s"}.`;

  const keyDrivers = [
    `Internal historical avg sell ${formatCurrency(row.historicalAvgSell)}`,
    `DAT market avg ${money(dat.marketAverage)}`,
    `Risk score ${risk.outputRiskPct}% (${risk.riskLevel})`,
    `Leverage loads ${leverageCount}`,
    `Backhaul opportunities ${backhaulCount}`,
    row.winRate == null ? "Win rate not yet measurable" : `Win rate ${row.winRate.toFixed(1)}%`,
  ];

  const suggestedStrategy = marginFloorApplied
    ? "Hold the margin floor: this lane does not support an aggressive bid on current data."
    : risk.riskLevel === "Critical Risk"
      ? "Conservative bid posture with pre-approval and tighter buy-side controls."
      : risk.riskLevel === "High Risk"
        ? "Balanced bid with guardrails, carrier confirmation, and active DAT monitoring."
        : "Competitive bid posture leveraging backhaul and customer history.";

  const whySuggestionRows = [
    { label: "Internal historical average", value: formatCurrency(row.historicalAvgSell) },
    { label: "Blended lane recommendation", value: formatCurrency(row.recommendedBid) },
    { label: "DAT market average", value: money(dat.marketAverage) },
    {
      label: "Last 30/60/90 trend",
      value: `${money(row.last30AvgSell)} / ${money(row.last60AvgSell)} / ${money(row.last90AvgSell)}`,
    },
    {
      label: "Win-rate trend",
      value:
        row.winRate == null ? "—" : `${row.winRate.toFixed(1)}% of ${row.settledLoadCount} settled`,
    },
    { label: "Active load leverage", value: `${leverageCount} similar loads` },
    { label: "Backhaul opportunities", value: `${backhaulCount} candidates` },
    { label: "Risk score", value: `${risk.outputRiskPct}% (${risk.riskLevel})` },
    {
      label: "Margin target",
      value: `${formatCurrency(targetMargin)} / ${marginPercentage.toFixed(1)}%`,
    },
    {
      label: "Sample quality",
      value: `${row.loadCount} priced, ${row.droppedForMissingRates} skipped`,
    },
  ];

  return {
    suggestedBidLow,
    suggestedBidHigh,
    recommendedSellRate,
    recommendedBuyRate,
    targetMargin,
    marginPercentage,
    marginFloorApplied,
    confidenceScore,
    confidenceLevel,
    guardrails,
    notes,
    keyDrivers,
    suggestedStrategy,
    customerFacingNote:
      "We can support this lane with aligned market pricing and secure capacity within your pickup window.",
    internalPricingNote: `Model ${risk.modelVersion} used with deterministic signature ${risk.deterministicSignature}.`,
    whySuggestionRows,
  };
}
