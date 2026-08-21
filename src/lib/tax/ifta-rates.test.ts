import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  IFTA_MATRIX_URL,
  getIftaRates,
  laneDieselRate,
  parseIftaMatrix,
  peekIftaCache,
  resetIftaCacheForTests,
} from "@/lib/tax/ifta-rates";

/**
 * A matrix row as iftach.org renders it: jurisdiction name, two-letter code,
 * then rate columns. Enough US jurisdictions to clear the plausibility floor.
 */
function matrixHtml(
  rows: { name: string; code: string; diesel: string; extra?: string }[],
  quarter = "3rd Quarter 2026",
): string {
  const body = rows
    .map(
      (row) =>
        `<tr><td>${row.name}</td><td>${row.code}</td><td>${row.diesel}</td>` +
        `<td>${row.extra ?? row.diesel}</td></tr>`,
    )
    .join("");
  return `<html><body><h1>IFTA TAX MATRIX ${quarter}</h1><table>${body}</table></body></html>`;
}

const US_STATES = [
  "AL",
  "AK",
  "AZ",
  "AR",
  "CA",
  "CO",
  "CT",
  "DE",
  "FL",
  "GA",
  "HI",
  "ID",
  "IL",
  "IN",
  "IA",
  "KS",
  "KY",
  "LA",
  "ME",
  "MD",
  "MA",
  "MI",
  "MN",
  "MS",
  "MO",
  "MT",
  "NE",
  "NV",
  "NH",
  "NJ",
  "NM",
  "NY",
  "NC",
  "ND",
  "OH",
  "OK",
  "OR",
  "PA",
  "RI",
  "SC",
  "SD",
  "TN",
  "TX",
  "UT",
  "VT",
  "VA",
  "WA",
  "WV",
  "WI",
  "WY",
];

/** A full-looking matrix: 47 US states plus two Canadian provinces. */
function fullMatrix(overrides: Record<string, string> = {}): string {
  const rows = US_STATES.map((code, index) => ({
    name: `State ${code}`,
    code,
    diesel: overrides[code] ?? (0.2 + index * 0.01).toFixed(4),
  }));
  rows.push({ name: "Alberta", code: "AB", diesel: "0.1300" });
  rows.push({ name: "British Columbia", code: "BC", diesel: "0.1500" });
  return matrixHtml(rows);
}

beforeEach(() => {
  resetIftaCacheForTests();
});

describe("parseIftaMatrix", () => {
  it("reads the quarter label and the per-jurisdiction rates", () => {
    const table = parseIftaMatrix(fullMatrix({ TX: "0.2000", GA: "0.3260" }));
    expect(table).not.toBeNull();
    expect(table!.quarter).toBe("3rd Quarter 2026");
    expect(table!.rates.TX.diesel).toBe(0.2);
    expect(table!.rates.GA.diesel).toBe(0.326);
    expect(table!.source).toBe(IFTA_MATRIX_URL);
  });

  it("marks Canadian jurisdictions as CAD, since their rates are not comparable", () => {
    const table = parseIftaMatrix(fullMatrix());
    expect(table!.rates.AB.currency).toBe("CAD");
    expect(table!.rates.TX.currency).toBe("USD");
  });

  /**
   * The failure mode this guards is the expensive one: the page gains a column,
   * an index-based parser reads gasoline or a surcharge as diesel, and freight
   * gets priced off the wrong number silently. Rejecting an implausible table is
   * better than trusting a misaligned one.
   */
  it("rejects a table whose numbers are outside published bounds", () => {
    const rows = US_STATES.map((code) => ({ name: `State ${code}`, code, diesel: "45.0000" }));
    expect(parseIftaMatrix(matrixHtml(rows))).toBeNull();
  });

  it("rejects a partial table rather than returning half the jurisdictions", () => {
    const rows = US_STATES.slice(0, 10).map((code) => ({
      name: `State ${code}`,
      code,
      diesel: "0.2500",
    }));
    expect(parseIftaMatrix(matrixHtml(rows))).toBeNull();
  });

  it("rejects an empty or truncated page", () => {
    expect(parseIftaMatrix("")).toBeNull();
    expect(parseIftaMatrix("<html></html>")).toBeNull();
  });

  it("skips a row with no plausible rate instead of aborting the parse", () => {
    const rows = US_STATES.map((code) => ({ name: `State ${code}`, code, diesel: "0.2500" }));
    rows.push({ name: "Broken", code: "ZZ", diesel: "n/a" });
    const table = parseIftaMatrix(matrixHtml(rows));
    expect(table).not.toBeNull();
    expect(table!.rates.ZZ).toBeUndefined();
    expect(table!.rates.TX.diesel).toBe(0.25);
  });

  it("tolerates dollar signs and nbsp padding", () => {
    const rows = US_STATES.map((code) => ({
      name: `State ${code}`,
      code,
      diesel: "&nbsp;$0.2900&nbsp;",
    }));
    const table = parseIftaMatrix(matrixHtml(rows));
    expect(table!.rates.TX.diesel).toBe(0.29);
  });

  it("does not let one row's numbers leak into the next", () => {
    const rows = US_STATES.map((code, i) => ({
      name: `State ${code}`,
      code,
      diesel: (0.2 + i * 0.01).toFixed(4),
    }));
    const table = parseIftaMatrix(matrixHtml(rows));
    expect(table!.rates[US_STATES[0]].diesel).toBe(0.2);
    expect(table!.rates[US_STATES[1]].diesel).toBe(0.21);
  });
});

describe("getIftaRates", () => {
  it("fetches, parses and caches", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(fullMatrix(), { status: 200 }));
    const first = await getIftaRates(fetchMock as unknown as typeof fetch);
    expect(first).not.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Second call is served from cache — a load page must never wait on iftach.org.
    const second = await getIftaRates(fetchMock as unknown as typeof fetch);
    expect(second).toBe(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(peekIftaCache()).not.toBeNull();
  });

  /** Failing soft is the whole design: a third party being down is not an error here. */
  it("returns null on a failed fetch, without throwing", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("ENOTFOUND"));
    await expect(getIftaRates(fetchMock as unknown as typeof fetch)).resolves.toBeNull();
  });

  it("returns null on a non-200 and does not cache the failure", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("nope", { status: 503 }));
    await expect(getIftaRates(fetchMock as unknown as typeof fetch)).resolves.toBeNull();
    expect(peekIftaCache()).toBeNull();
  });

  it("does not cache an unparseable page", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("<html>junk</html>", { status: 200 }));
    await expect(getIftaRates(fetchMock as unknown as typeof fetch)).resolves.toBeNull();
    expect(peekIftaCache()).toBeNull();
  });

  it("deduplicates concurrent cold-cache callers into one request", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(
        () =>
          new Promise((resolve) =>
            setTimeout(() => resolve(new Response(fullMatrix(), { status: 200 })), 10),
          ),
      );
    const results = await Promise.all([
      getIftaRates(fetchMock as unknown as typeof fetch),
      getIftaRates(fetchMock as unknown as typeof fetch),
      getIftaRates(fetchMock as unknown as typeof fetch),
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(results[0]).toBe(results[2]);
  });
});

describe("laneDieselRate", () => {
  it("averages the two endpoint jurisdictions and names the assumption", () => {
    const table = parseIftaMatrix(fullMatrix({ TX: "0.2000", GA: "0.4000" }))!;
    const lane = laneDieselRate(table, "TX", "GA");
    expect(lane).not.toBeNull();
    expect(lane!.rate).toBeCloseTo(0.3, 6);
    expect(lane!.jurisdictions).toEqual(["TX", "GA"]);
    expect(lane!.assumption).toContain("split evenly");
  });

  it("falls back to the one known endpoint and says so", () => {
    const table = parseIftaMatrix(fullMatrix({ TX: "0.2000" }))!;
    const lane = laneDieselRate(table, "TX", "ZZ");
    expect(lane!.rate).toBeCloseTo(0.2, 6);
    expect(lane!.assumption).toContain("Only one endpoint");
  });

  it("returns null when neither endpoint is a known US jurisdiction", () => {
    const table = parseIftaMatrix(fullMatrix())!;
    expect(laneDieselRate(table, "ZZ", "QQ")).toBeNull();
  });

  /** A CAD rate applied to a USD load would be wrong by roughly the exchange rate. */
  it("ignores Canadian jurisdictions, whose rates are in CAD", () => {
    const table = parseIftaMatrix(fullMatrix())!;
    expect(laneDieselRate(table, "AB", "BC")).toBeNull();
  });

  it("is case and whitespace tolerant", () => {
    const table = parseIftaMatrix(fullMatrix({ TX: "0.2000" }))!;
    expect(laneDieselRate(table, " tx ", "ZZ")!.rate).toBeCloseTo(0.2, 6);
  });
});
