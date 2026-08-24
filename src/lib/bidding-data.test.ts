/**
 * Bidding pricing engine.
 *
 * These were written first as characterization tests against the old engine —
 * they described fabricated recency averages, a win rate that counted live
 * freight as lost, dead search toggles and placeholder similarity scores. Each
 * one now asserts the behaviour that replaced it, and says which defect it
 * covers so the history is not lost.
 */
import { describe, expect, it } from "vitest";

import {
  DEFAULT_SEARCH_OPTIONS,
  buildBackhaulCandidatesFromAws,
  buildHistoricalRowsFromLoads,
  buildLeverageLoadsFromAws,
  createEmptySearchCriteria,
  deriveLoadFieldOptions,
  getDisconnectedDatSnapshot,
  hasSearchableLane,
  type SearchCriteria,
  type SearchOptions,
} from "./bidding-aggregate";
import type { LoadRecord } from "./loads-store";

const DAT = getDisconnectedDatSnapshot();

function load(over: Partial<LoadRecord> = {}): LoadRecord {
  return {
    loadId: "LD-1",
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    loadStatus: "delivered",
    customer: "Acme",
    broker: "Titan",
    equipmentType: "Dry Van",
    pickupCity: "Dallas",
    pickupState: "TX",
    deliveryCity: "Atlanta",
    deliveryState: "GA",
    pickupDate: isoDaysAgo(5),
    carrierRate: "2000",
    customerRate: "2400",
    ...over,
  } as LoadRecord;
}

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

function criteria(over: Partial<SearchCriteria> = {}): SearchCriteria {
  return {
    ...createEmptySearchCriteria(),
    originCity: "Dallas",
    originState: "TX",
    destinationCity: "Atlanta",
    destinationState: "GA",
    equipmentType: "Dry Van",
    ...over,
  };
}

function options(over: Partial<SearchOptions> = {}): SearchOptions {
  return { ...DEFAULT_SEARCH_OPTIONS, ...over };
}

describe("lane matching", () => {
  it("aggregates an exact lane match into one row", () => {
    const rows = buildHistoricalRowsFromLoads(
      [load({ loadId: "A" }), load({ loadId: "B", carrierRate: "2200", customerRate: "2600" })],
      criteria(),
      options(),
      DAT,
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      loadCount: 2,
      matchType: "exact",
      historicalAvgBuy: 2100,
      historicalAvgSell: 2500,
      historicalMargin: 400,
    });
  });

  it("BID-23: a half-filled lane is refused before it costs a round trip", () => {
    // Every match rule needs both ends, so an origin-only search could only ever
    // come back empty. The page checks this instead of searching to prove it.
    expect(hasSearchableLane(criteria())).toBe(true);
    expect(hasSearchableLane(criteria({ destinationCity: "", destinationState: "" }))).toBe(false);
    expect(hasSearchableLane(criteria({ originCity: "", originState: "" }))).toBe(false);
    // Either half of a lane is enough to name it — city or state.
    expect(hasSearchableLane(criteria({ originCity: "", destinationCity: "" }))).toBe(true);
  });

  it("BID-15: adjacent-market search now reaches states similar-lane cannot", () => {
    // Both options used to call the same predicate, so ticking "adjacent"
    // widened nothing. Adjacent now means a bordering state on either end.
    const bordering = load({ loadId: "from-OK", pickupCity: "Tulsa", pickupState: "OK" });

    const similarOnly = buildHistoricalRowsFromLoads(
      [bordering],
      criteria(),
      options({ similarLaneMatch: true, adjacentMarketSearch: false }),
      DAT,
    );
    const withAdjacent = buildHistoricalRowsFromLoads(
      [bordering],
      criteria(),
      options({ similarLaneMatch: true, adjacentMarketSearch: true }),
      DAT,
    );

    expect(similarOnly).toEqual([]);
    expect(withAdjacent).toHaveLength(1);
    expect(withAdjacent[0].matchType).toBe("adjacent");
  });

  it("does not treat a non-bordering state as adjacent", () => {
    const faraway = load({ loadId: "from-ME", pickupCity: "Portland", pickupState: "ME" });

    const rows = buildHistoricalRowsFromLoads([faraway], criteria(), options(), DAT);

    expect(rows).toEqual([]);
  });

  it("orders the closest match first regardless of sample size", () => {
    // A 40-load adjacent lane used to outrank the exact lane the user asked for.
    const adjacent = Array.from({ length: 5 }, (_, i) =>
      load({ loadId: `ADJ${i}`, pickupCity: "Tulsa", pickupState: "OK" }),
    );
    const exact = load({ loadId: "EXACT" });

    const rows = buildHistoricalRowsFromLoads([...adjacent, exact], criteria(), options(), DAT);

    expect(rows[0].matchType).toBe("exact");
    expect(rows[0].loadCount).toBe(1);
    expect(rows[1].matchType).toBe("adjacent");
  });

  it("treats a blank equipment type on either side as a match", () => {
    const rows = buildHistoricalRowsFromLoads(
      [load({ equipmentType: "Reefer" })],
      criteria({ equipmentType: "" }),
      options(),
      DAT,
    );

    expect(rows).toHaveLength(1);
  });
});

describe("BID-13/14: the search option checkboxes change the result", () => {
  const loads = [
    load({ pickupDate: isoDaysAgo(3) }),
    load({ loadId: "B", pickupDate: isoDaysAgo(200) }),
  ];

  it("switching a recency window off removes that column rather than ignoring the click", () => {
    const all = buildHistoricalRowsFromLoads(loads, criteria(), options(), DAT);
    expect(all[0].last30AvgSell).not.toBeNull();

    const off = buildHistoricalRowsFromLoads(
      loads,
      criteria(),
      options({ includeLast30Days: false }),
      DAT,
    );

    expect(off[0].last30AvgSell).toBeNull();
    expect(off[0].last30AvgBuy).toBeNull();
    // The other windows are untouched.
    expect(off[0].last90AvgSell).not.toBeNull();
  });

  it("switching DAT market data off keeps DAT values out of the row", () => {
    const off = buildHistoricalRowsFromLoads(
      loads,
      criteria(),
      options({ includeDatMarketData: false }),
      DAT,
    );

    expect(off[0]).toMatchObject({
      datMarketMin: null,
      datMarketAvg: null,
      datMarketMax: null,
      datRatePerMile: null,
    });
  });
});

describe("BID-09/10: recency windows report only what they measured", () => {
  it("a lane with no loads in 30 days reports no 30-day average", () => {
    // This used to substitute the all-time average, putting a fabricated number
    // under a column labelled "Last 30-Day Avg Sell" and giving it 55% of the
    // weight in the recommended bid.
    const rows = buildHistoricalRowsFromLoads(
      [load({ pickupDate: isoDaysAgo(400) }), load({ loadId: "B", pickupDate: isoDaysAgo(300) })],
      criteria(),
      options(),
      DAT,
    );

    expect(rows[0].last30AvgSell).toBeNull();
    expect(rows[0].last60AvgSell).toBeNull();
    expect(rows[0].last90AvgSell).toBeNull();
    // With no window data and no DAT, the blend is the long baseline alone.
    expect(rows[0].recommendedBid).toBe(rows[0].historicalAvgSell);
  });

  it("an undated load is outside every window instead of inside all of them", () => {
    const rows = buildHistoricalRowsFromLoads(
      [
        load({ loadId: "recent", pickupDate: isoDaysAgo(5), customerRate: "2000" }),
        load({ loadId: "undated", pickupDate: undefined, createdAt: "", customerRate: "3000" }),
      ],
      criteria(),
      options(),
      DAT,
    );

    // Only the dated load counts toward the 30-day figure.
    expect(rows[0].last30AvgSell).toBe(2000);
    expect(rows[0].historicalAvgSell).toBe(2500);
  });
});

describe("BID-11: win rate is measured against loads that settled", () => {
  it("does not count freight that is still rolling as a loss", () => {
    const rows = buildHistoricalRowsFromLoads(
      [
        load({ loadId: "A", loadStatus: "delivered" }),
        load({ loadId: "B", loadStatus: "in_transit" }),
      ],
      criteria(),
      options(),
      DAT,
    );

    expect(rows[0].winRate).toBe(100);
    expect(rows[0].settledLoadCount).toBe(1);
    expect(rows[0].deliveredCount).toBe(1);
    expect(rows[0].cancelledCount).toBe(0);
  });

  it("counts a cancelled load against the lane", () => {
    const rows = buildHistoricalRowsFromLoads(
      [
        load({ loadId: "A", loadStatus: "delivered" }),
        load({ loadId: "B", loadStatus: "cancelled" }),
      ],
      criteria(),
      options(),
      DAT,
    );

    expect(rows[0].winRate).toBe(50);
    expect(rows[0].settledLoadCount).toBe(2);
  });

  it("reports no win rate at all when nothing has settled", () => {
    const rows = buildHistoricalRowsFromLoads(
      [load({ loadId: "A", loadStatus: "in_transit" })],
      criteria(),
      options(),
      DAT,
    );

    expect(rows[0].winRate).toBeNull();
    expect(rows[0].settledLoadCount).toBe(0);
  });

  it("does not raise the risk score just because a lane is busy", () => {
    const settled = buildHistoricalRowsFromLoads(
      [load({ loadId: "A" }), load({ loadId: "B" })],
      criteria(),
      options(),
      DAT,
    );
    const oneRolling = buildHistoricalRowsFromLoads(
      [load({ loadId: "A" }), load({ loadId: "B", loadStatus: "in_transit" })],
      criteria(),
      options(),
      DAT,
    );

    // Both lanes are 100% delivered on settled freight, so risk is unchanged.
    expect(oneRolling[0].riskScore).toBe(settled[0].riskScore);
  });
});

describe("BID-12: discarded samples are reported", () => {
  it("counts loads dropped for missing rates and discounts confidence", () => {
    const rows = buildHistoricalRowsFromLoads(
      [
        load({ loadId: "priced" }),
        load({ loadId: "no-carrier-rate", carrierRate: undefined }),
        load({ loadId: "zero-rate", customerRate: "0" }),
        load({ loadId: "tbd", customerRate: "TBD" }),
      ],
      criteria(),
      options(),
      DAT,
    );

    expect(rows[0].loadCount).toBe(1);
    expect(rows[0].droppedForMissingRates).toBe(3);
    // One usable load out of four cannot read as confidently as four out of four.
    const clean = buildHistoricalRowsFromLoads(
      [load({ loadId: "priced" })],
      criteria(),
      options(),
      DAT,
    );
    expect(rows[0].confidence).toBeLessThan(clean[0].confidence);
  });

  it("returns no rows at all when nothing in the lane carries both rates", () => {
    const rows = buildHistoricalRowsFromLoads(
      [load({ customerRate: undefined })],
      criteria(),
      options(),
      DAT,
    );

    expect(rows).toEqual([]);
  });
});

describe("BID-23: DAT values are absent, not zero, while the feed is disconnected", () => {
  it("reports null market figures rather than $0", () => {
    const rows = buildHistoricalRowsFromLoads([load()], criteria(), options(), DAT);

    expect(DAT.status).toBe("Unavailable");
    expect(rows[0]).toMatchObject({
      datMarketAvg: null,
      datMarketMin: null,
      datMarketMax: null,
      datRatePerMile: null,
    });
  });

  it("BID-01: a missing market average widens the internal signals instead of scoring zero", () => {
    const rows = buildHistoricalRowsFromLoads(
      [load({ pickupDate: isoDaysAgo(5) })],
      criteria(),
      options(),
      DAT,
    );

    // Single load: every present signal equals 2400, so the blend does too.
    // Under the old fixed weights a null DAT contributed 0 at weight 0.4 and
    // dragged this to roughly 1440.
    expect(rows[0].recommendedBid).toBe(2400);
  });

  it("falls back to a margin-only band when there is no market average", () => {
    const rows = buildHistoricalRowsFromLoads([load()], criteria(), options(), DAT);

    expect(rows[0].historicalMarginPct).toBe(16.7);
    expect(rows[0].marginBand).toBe("Strong Margin");
  });

  it("BID-02: publishes lane-derived bid bounds rather than a fixed rate band", () => {
    const cheap = buildHistoricalRowsFromLoads(
      [load({ carrierRate: "600", customerRate: "800" })],
      criteria(),
      options(),
      DAT,
    );
    const expensive = buildHistoricalRowsFromLoads(
      [load({ carrierRate: "9000", customerRate: "12000" })],
      criteria(),
      options(),
      DAT,
    );

    // The old hard-coded $1,800-$5,200 band floored the first and capped the
    // second by more than half.
    expect(cheap[0].recommendedBidCeiling).toBeLessThan(1800);
    expect(expensive[0].recommendedBidFloor).toBeGreaterThan(5200);
  });
});

describe("BID-16/17: leverage is ranked before it is truncated", () => {
  it("keeps an exact-lane match that used to be cut by array order", () => {
    const sameStateOnly = Array.from({ length: 8 }, (_, i) =>
      load({
        loadId: `S${i}`,
        loadStatus: "in_transit",
        pickupCity: "Houston",
        deliveryCity: "Macon",
      }),
    );
    const exactMatch = load({ loadId: "EXACT", loadStatus: "in_transit" });

    const rows = buildLeverageLoadsFromAws([...sameStateOnly, exactMatch], criteria(), options());

    expect(rows).toHaveLength(8);
    expect(rows[0].loadNumber).toBe("EXACT");
    expect(rows[0].matchType).toBe("exact");
  });

  it("scores similarity from lane, equipment, customer and date rather than 0 or 100", () => {
    const rows = buildLeverageLoadsFromAws(
      [
        load({ loadId: "state-match", loadStatus: "in_transit", pickupCity: "Houston" }),
        load({
          loadId: "close-match",
          loadStatus: "in_transit",
          customer: "Acme",
          pickupDate: isoDaysAgo(0),
        }),
      ],
      criteria({ customer: "Acme", pickupDate: isoDaysAgo(0) }),
      options(),
    );

    const close = rows.find((row) => row.loadNumber === "close-match")!;
    const state = rows.find((row) => row.loadNumber === "state-match")!;

    expect(close.similarityPct).toBeGreaterThan(state.similarityPct);
    // A genuine same-state match is no longer reported as 0% similar.
    expect(state.similarityPct).toBeGreaterThan(0);
  });

  it("leaves rates null rather than reporting $0 for an unpriced load", () => {
    const rows = buildLeverageLoadsFromAws(
      [load({ loadStatus: "in_transit", carrierRate: undefined, customerRate: undefined })],
      criteria(),
      options(),
    );

    expect(rows[0]).toMatchObject({ buyRate: null, sellRate: null, margin: null });
  });

  it("excludes finished and draft loads from leverage", () => {
    const rows = buildLeverageLoadsFromAws(
      [
        load({ loadId: "done", loadStatus: "delivered" }),
        load({ loadId: "draft", loadStatus: "draft" }),
        load({ loadId: "live", loadStatus: "in_transit" }),
      ],
      criteria(),
      options(),
    );

    expect(rows.map((row) => row.loadNumber)).toEqual(["live"]);
  });
});

describe("BID-18: backhaul candidates are ranked on something", () => {
  it("ranks a candidate delivering into the searched city above one merely in-state", () => {
    const rows = buildBackhaulCandidatesFromAws(
      [
        load({ loadId: "in-state", loadStatus: "in_transit", deliveryCity: "Savannah" }),
        load({ loadId: "same-city", loadStatus: "in_transit", deliveryCity: "Atlanta" }),
      ],
      criteria(),
      options(),
    );

    expect(rows[0].loadNumber).toBe("same-city");
    expect(rows[0].rankScore).toBeGreaterThan(rows[1].rankScore);
  });

  it("names where the equipment is and where it would return to", () => {
    const rows = buildBackhaulCandidatesFromAws(
      [load({ loadId: "BH", loadStatus: "in_transit", deliveryCity: "Savannah" })],
      criteria(),
      options(),
    );

    expect(rows[0].currentDeliveryMarket).toBe("Savannah, GA");
    expect(rows[0].destination).toBe("Dallas, TX");
    expect(rows[0].estimatedBackhaulValue).toBe(400);
  });

  it("returns nothing when the search has no destination state to reposition from", () => {
    const rows = buildBackhaulCandidatesFromAws(
      [load({ loadStatus: "in_transit" })],
      criteria({ destinationState: "" }),
      options(),
    );

    expect(rows).toEqual([]);
  });
});

describe("BID-23: field option derivation", () => {
  it("dedupes, trims and sorts, and normalises state casing", () => {
    const opts = deriveLoadFieldOptions([
      load({ customer: " Acme ", broker: "Titan", equipmentType: "Reefer", pickupState: "tx" }),
      load({ customer: "Acme", broker: undefined, equipmentType: "Dry Van", pickupState: "TX" }),
    ]);

    expect(opts.customers).toEqual(["Acme"]);
    expect(opts.brokers).toEqual(["Titan"]);
    expect(opts.equipmentTypes).toEqual(["Dry Van", "Reefer"]);
    // "tx" and "TX" used to be two separate options in the datalist while the
    // input upper-cased whatever was typed.
    expect(opts.states).toEqual(["GA", "TX"]);
  });
});
