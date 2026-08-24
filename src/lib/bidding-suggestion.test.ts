/**
 * Risk evaluation and bid suggestion.
 *
 * This logic used to live inside `bidding-page.tsx` where nothing could reach
 * it without rendering the page — which is how it shipped recommending a sell
 * rate below its own recommended buy rate. The first two suites here are that
 * defect, expressed as arithmetic.
 */
import { describe, expect, it } from "vitest";

import {
  MINIMUM_MARGIN_PCT,
  buildAiSuggestion,
  evaluateRiskDeterministic,
  toRiskLevel,
} from "./bidding-suggestion";
import {
  buildHistoricalRowsFromLoads,
  createEmptySearchCriteria,
  getDisconnectedDatSnapshot,
  DEFAULT_SEARCH_OPTIONS,
  type DatSnapshot,
  type HistoricalResultRow,
} from "./bidding-aggregate";
import type { LoadRecord } from "./loads-store";

const DISCONNECTED_DAT = getDisconnectedDatSnapshot();

const CONNECTED_DAT: DatSnapshot = {
  status: "Live",
  marketMinimum: 2200,
  marketAverage: 2500,
  marketMaximum: 2900,
  ratePerMile: 2.4,
  fuelEstimate: 0.55,
  capacityIndicator: 61,
  confidence: 88,
  dataWindow: "Last 15 days",
  lastRefreshed: "2026-08-18 09:00 ET",
  sourceStatus: "OK",
};

const MODEL = {
  id: "RM-lane-pricing",
  version: "v3.2",
  weights: {
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
  },
};

/** Build a real row through the aggregator rather than hand-writing one. */
function laneRow(buy: number, sell: number, dat = DISCONNECTED_DAT): HistoricalResultRow {
  const loads: LoadRecord[] = [
    {
      loadId: "LD-1",
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-01T00:00:00.000Z",
      loadStatus: "delivered",
      equipmentType: "Dry Van",
      pickupCity: "Dallas",
      pickupState: "TX",
      deliveryCity: "Atlanta",
      deliveryState: "GA",
      pickupDate: new Date().toISOString().slice(0, 10),
      carrierRate: String(buy),
      customerRate: String(sell),
    } as LoadRecord,
  ];

  const criteria = {
    ...createEmptySearchCriteria(),
    originCity: "Dallas",
    originState: "TX",
    destinationCity: "Atlanta",
    destinationState: "GA",
    equipmentType: "Dry Van",
  };

  const rows = buildHistoricalRowsFromLoads(loads, criteria, DEFAULT_SEARCH_OPTIONS, dat);
  if (!rows[0]) throw new Error("fixture produced no row");
  return rows[0];
}

function suggest(row: HistoricalResultRow, dat: DatSnapshot, leverageCount = 0) {
  const risk = evaluateRiskDeterministic({ row, dat, model: MODEL, leverageCount });
  return buildAiSuggestion({ row, risk, dat, leverageCount, backhaulCount: 0 });
}

describe("BID-01: a suggestion never prices below cost", () => {
  it("keeps sell above buy on the exact lane that used to quote a loss", () => {
    // The reported case: $2,500 average sell, $2,100 average buy, DAT
    // disconnected. The old blend multiplied a 0 market average by 0.4, clamped
    // the result to a hard $1,800 floor, and returned a $2,097 buy against it —
    // a target margin of -$297, pre-filled into the bid field.
    const suggestion = suggest(laneRow(2100, 2500), DISCONNECTED_DAT);

    expect(suggestion.recommendedSellRate).toBeGreaterThan(suggestion.recommendedBuyRate);
    expect(suggestion.targetMargin).toBeGreaterThan(0);
    expect(suggestion.marginPercentage).toBeGreaterThanOrEqual(MINIMUM_MARGIN_PCT - 0.1);
  });

  it("holds the margin floor across a wide range of lanes", () => {
    const lanes: Array<[number, number]> = [
      [500, 560],
      [900, 1000],
      [2100, 2500],
      [4000, 4300],
      [9000, 12000],
      [2400, 2450],
    ];

    for (const [buy, sell] of lanes) {
      for (const dat of [DISCONNECTED_DAT, CONNECTED_DAT]) {
        for (const leverage of [0, 3, 9]) {
          const suggestion = suggest(laneRow(buy, sell, dat), dat, leverage);
          expect(
            suggestion.targetMargin,
            `lane ${buy}/${sell}, dat ${dat.status}, leverage ${leverage}`,
          ).toBeGreaterThan(0);
          expect(suggestion.suggestedBidLow).toBeGreaterThanOrEqual(
            Math.round(suggestion.recommendedBuyRate / (1 - MINIMUM_MARGIN_PCT / 100)),
          );
        }
      }
    }
  });

  it("says so when the market signal was below cost and the floor took over", () => {
    // Heavy leverage pushes the market-derived sell down hardest.
    const suggestion = suggest(laneRow(2400, 2450), DISCONNECTED_DAT, 9);

    expect(suggestion.marginFloorApplied).toBe(true);
    expect(suggestion.guardrails[0]).toContain("below cost");
    expect(suggestion.suggestedStrategy).toContain("margin floor");
  });

  it("does not claim the floor was applied on a healthy lane", () => {
    const suggestion = suggest(laneRow(2000, 2600), CONNECTED_DAT);

    expect(suggestion.marginFloorApplied).toBe(false);
  });
});

describe("BID-02: rates are bounded by the lane, not by a fixed band", () => {
  it("does not floor a cheap lane up to $1,800", () => {
    const suggestion = suggest(laneRow(600, 800), DISCONNECTED_DAT);

    expect(suggestion.recommendedSellRate).toBeLessThan(1800);
    expect(suggestion.recommendedSellRate).toBeGreaterThan(600);
  });

  it("does not cap an expensive lane down to $5,200", () => {
    const suggestion = suggest(laneRow(9000, 12000), DISCONNECTED_DAT);

    // The old clamp turned this into a 57% underquote.
    expect(suggestion.recommendedSellRate).toBeGreaterThan(9000);
  });
});

describe("risk model inputs", () => {
  it("drops the inputs a disconnected DAT cannot supply instead of inventing them", () => {
    const row = laneRow(2100, 2500);
    const risk = evaluateRiskDeterministic({
      row,
      dat: DISCONNECTED_DAT,
      model: MODEL,
      leverageCount: 2,
    });

    expect(risk.unavailableInputs).toEqual(
      expect.arrayContaining(["Fuel Index", "DAT Spread", "Equipment Tightness"]),
    );
    expect(risk.inputValues).not.toHaveProperty("fuelIndex");
    expect(risk.inputValues).not.toHaveProperty("datSpread");
    expect(risk.inputValues).not.toHaveProperty("equipmentTightness");
    expect(risk.reasonCodes.join(" ")).toContain("model input");
  });

  it("uses every input when DAT is connected", () => {
    const row = laneRow(2100, 2500, CONNECTED_DAT);
    const risk = evaluateRiskDeterministic({
      row,
      dat: CONNECTED_DAT,
      model: MODEL,
      leverageCount: 2,
    });

    expect(risk.unavailableInputs).toEqual([]);
    expect(Object.keys(risk.inputValues)).toHaveLength(11);
  });

  it("does not bias the score low just because inputs were missing", () => {
    // Zeroed DAT inputs used to enter the model clamped to their lower bounds
    // and push the score down roughly 12 points on numbers nobody measured.
    const disconnected = evaluateRiskDeterministic({
      row: laneRow(2100, 2500),
      dat: DISCONNECTED_DAT,
      model: MODEL,
      leverageCount: 2,
    });
    const connected = evaluateRiskDeterministic({
      row: laneRow(2100, 2500, CONNECTED_DAT),
      dat: CONNECTED_DAT,
      model: MODEL,
      leverageCount: 2,
    });

    expect(Math.abs(disconnected.outputRiskPct - connected.outputRiskPct)).toBeLessThan(20);
  });

  it("omits a win-rate input when no load on the lane has settled", () => {
    const loads: LoadRecord[] = [
      {
        loadId: "LD-1",
        createdAt: "2026-08-01T00:00:00.000Z",
        updatedAt: "2026-08-01T00:00:00.000Z",
        loadStatus: "in_transit",
        equipmentType: "Dry Van",
        pickupCity: "Dallas",
        pickupState: "TX",
        deliveryCity: "Atlanta",
        deliveryState: "GA",
        pickupDate: new Date().toISOString().slice(0, 10),
        carrierRate: "2100",
        customerRate: "2500",
      } as LoadRecord,
    ];
    const row = buildHistoricalRowsFromLoads(
      loads,
      {
        ...createEmptySearchCriteria(),
        originCity: "Dallas",
        originState: "TX",
        destinationCity: "Atlanta",
        destinationState: "GA",
      },
      DEFAULT_SEARCH_OPTIONS,
      DISCONNECTED_DAT,
    )[0];

    const risk = evaluateRiskDeterministic({
      row,
      dat: DISCONNECTED_DAT,
      model: MODEL,
      leverageCount: 0,
    });

    expect(row.winRate).toBeNull();
    expect(risk.unavailableInputs).toContain("Historical Win Rate");
    expect(risk.reasonCodes).toContain("No settled loads to score win rate");
  });

  it("is deterministic: the same inputs produce the same signature", () => {
    const row = laneRow(2100, 2500);
    const a = evaluateRiskDeterministic({
      row,
      dat: DISCONNECTED_DAT,
      model: MODEL,
      leverageCount: 1,
    });
    const b = evaluateRiskDeterministic({
      row,
      dat: DISCONNECTED_DAT,
      model: MODEL,
      leverageCount: 1,
    });
    const c = evaluateRiskDeterministic({
      row,
      dat: DISCONNECTED_DAT,
      model: MODEL,
      leverageCount: 4,
    });

    expect(a.deterministicSignature).toBe(b.deterministicSignature);
    expect(a.deterministicSignature).not.toBe(c.deterministicSignature);
  });

  it("keeps the score inside its published range", () => {
    for (const [buy, sell] of [
      [100, 100_000],
      [50_000, 51_000],
      [1, 2],
    ] as Array<[number, number]>) {
      const risk = evaluateRiskDeterministic({
        row: laneRow(buy, sell),
        dat: DISCONNECTED_DAT,
        model: MODEL,
        leverageCount: 0,
      });
      expect(risk.outputRiskPct).toBeGreaterThanOrEqual(3);
      expect(risk.outputRiskPct).toBeLessThanOrEqual(99);
      expect(risk.riskLevel).toBe(toRiskLevel(risk.outputRiskPct));
    }
  });
});

describe("confidence reflects what the suggestion actually knew", () => {
  it("scores lower with a disconnected feed than with a live one", () => {
    const disconnected = suggest(laneRow(2100, 2500), DISCONNECTED_DAT);
    const connected = suggest(laneRow(2100, 2500, CONNECTED_DAT), CONNECTED_DAT);

    expect(disconnected.confidenceScore).toBeLessThan(connected.confidenceScore);
  });

  it("tells the desk it is pricing without market data", () => {
    const suggestion = suggest(laneRow(2100, 2500), DISCONNECTED_DAT);

    expect(suggestion.guardrails.join(" ")).toContain("DAT RateView is not connected");
    expect(suggestion.notes).toContain("DAT market data unavailable");
  });
});
