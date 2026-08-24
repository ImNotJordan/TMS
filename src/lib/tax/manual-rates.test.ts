import { describe, expect, it } from "vitest";

import {
  RATE_CEILINGS,
  hasAnyManualRate,
  manualRateProvenance,
  parseFuelRate,
  parsePercentRate,
  resolveManualRates,
  sanitizeManualRates,
} from "./manual-rates";

describe("parsePercentRate", () => {
  it("reads a percent as a percent", () => {
    expect(parsePercentRate("8.25", 20)).toEqual({ ok: true, value: 0.0825 });
    expect(parsePercentRate("9", 30)).toEqual({ ok: true, value: 0.09 });
    expect(parsePercentRate("  6 ", 30)).toEqual({ ok: true, value: 0.06 });
    expect(parsePercentRate("8.25%", 20)).toEqual({ ok: true, value: 0.0825 });
  });

  /**
   * Blank and zero are different answers. Blank is "not set" and falls back to
   * the built-in behaviour; zero is "I checked, and this state exempts freight".
   * Collapsing both to a falsy number would make a deliberate exemption
   * indistinguishable from never having looked.
   */
  it("distinguishes blank from zero", () => {
    expect(parsePercentRate("", 20)).toEqual({ ok: true, value: undefined });
    expect(parsePercentRate("   ", 20)).toEqual({ ok: true, value: undefined });
    expect(parsePercentRate(null, 20)).toEqual({ ok: true, value: undefined });
    expect(parsePercentRate("0", 20)).toEqual({ ok: true, value: 0 });
  });

  /**
   * The expensive mistake. Someone means 9% and types the fraction. Taken at
   * face value that is 0.09% — tax understated roughly a hundredfold, and the
   * resulting figure is small but plausible enough to survive a review.
   */
  it("rejects a fraction typed where a percent was asked for", () => {
    const result = parsePercentRate("0.09", 30);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.code).toBe("looks_like_a_fraction");
    expect(!result.ok && result.message).toContain("9");
  });

  it("rejects a rate above the field ceiling", () => {
    const result = parsePercentRate("900", 30);
    expect(!result.ok && result.code).toBe("above_maximum");
  });

  it("rejects a negative rate and junk", () => {
    expect(!parsePercentRate("-5", 30).ok).toBe(true);
    expect(!parsePercentRate("abc", 30).ok).toBe(true);
  });

  it("accepts the real ceiling values themselves", () => {
    expect(parsePercentRate("13", RATE_CEILINGS.chinaVat)).toEqual({ ok: true, value: 0.13 });
    expect(parsePercentRate("11.5", RATE_CEILINGS.usTransport)).toEqual({ ok: true, value: 0.115 });
  });
});

describe("parseFuelRate", () => {
  it("reads dollars per gallon", () => {
    expect(parseFuelRate("0.34")).toEqual({ ok: true, value: 0.34 });
    expect(parseFuelRate("$0.585")).toEqual({ ok: true, value: 0.585 });
  });

  it("rejects rates outside every published IFTA rate", () => {
    expect(!parseFuelRate("0.001").ok).toBe(true);
    expect(!parseFuelRate("34").ok).toBe(true);
  });

  /** No jurisdiction taxes diesel at nothing, so a zero here is a cleared field. */
  it("treats zero as not set rather than a zero rate", () => {
    expect(parseFuelRate("0")).toEqual({ ok: true, value: undefined });
    expect(parseFuelRate("")).toEqual({ ok: true, value: undefined });
  });
});

describe("resolveManualRates", () => {
  it("parses a full set", () => {
    const { rates, problems } = resolveManualRates({
      enabled: true,
      usTransportPercent: "8.25",
      chinaVatPercent: "9",
      chinaSurchargePercent: "12",
      iftaUsdPerGallon: "0.34",
      source: " Avalara lookup ",
      asOf: "2026-08-20",
    });
    expect(problems).toEqual([]);
    expect(rates).toEqual({
      enabled: true,
      usTransportRate: 0.0825,
      chinaVatRate: 0.09,
      chinaSurchargeRate: 0.12,
      iftaRateUsdPerGallon: 0.34,
      source: "Avalara lookup",
      asOf: "2026-08-20",
    });
  });

  /**
   * One bad field must not take the others down with it, and must not be
   * silently replaced by a default — a defaulted rate is a number nobody
   * entered, presented as one somebody did.
   */
  it("drops only the field that failed, and reports it", () => {
    const { rates, problems } = resolveManualRates({
      enabled: true,
      usTransportPercent: "0.0825",
      chinaVatPercent: "9",
    });
    expect(rates.usTransportRate).toBeUndefined();
    expect(rates.chinaVatRate).toBe(0.09);
    expect(problems).toHaveLength(1);
    expect(problems[0]?.field).toBe("usTransportPercent");
  });

  it("collects every problem rather than stopping at the first", () => {
    const { problems } = resolveManualRates({
      enabled: true,
      usTransportPercent: "999",
      chinaVatPercent: "-1",
      iftaUsdPerGallon: "50",
    });
    expect(problems.map((p) => p.field).sort()).toEqual([
      "chinaVatPercent",
      "iftaUsdPerGallon",
      "usTransportPercent",
    ]);
  });
});

describe("hasAnyManualRate", () => {
  /** A panel announcing "manual rates in use" with every field blank is worse than silent. */
  it("is false when enabled but nothing is set", () => {
    expect(hasAnyManualRate({ enabled: true })).toBe(false);
    expect(hasAnyManualRate({ enabled: true, source: "somewhere" })).toBe(false);
  });

  it("is false when rates are set but switched off", () => {
    expect(hasAnyManualRate({ enabled: false, usTransportRate: 0.0825 })).toBe(false);
  });

  it("is true for a set rate, including a deliberate zero", () => {
    expect(hasAnyManualRate({ enabled: true, usTransportRate: 0 })).toBe(true);
    expect(hasAnyManualRate({ enabled: true, iftaRateUsdPerGallon: 0.34 })).toBe(true);
  });

  it("is false for undefined", () => {
    expect(hasAnyManualRate(undefined)).toBe(false);
  });
});

describe("manualRateProvenance", () => {
  it("joins source and date", () => {
    expect(manualRateProvenance({ enabled: true, source: "Avalara", asOf: "2026-08-20" })).toBe(
      "Avalara, as of 2026-08-20",
    );
  });

  /** Reads honestly rather than implying a source was recorded. */
  it("says so when nothing was recorded", () => {
    expect(manualRateProvenance({ enabled: true })).toBe("no source recorded");
  });
});

describe("sanitizeManualRates", () => {
  it("passes a plausible payload through", () => {
    expect(
      sanitizeManualRates({
        enabled: true,
        usTransportRate: 0.0825,
        iftaRateUsdPerGallon: 0.34,
        source: "Avalara",
      }),
    ).toMatchObject({ enabled: true, usTransportRate: 0.0825, iftaRateUsdPerGallon: 0.34 });
  });

  it("returns undefined for anything not an enabled object", () => {
    for (const value of [null, undefined, "x", 5, [], {}, { enabled: false }, { enabled: "yes" }]) {
      expect(sanitizeManualRates(value), JSON.stringify(value) ?? "undefined").toBeUndefined();
    }
  });

  /**
   * The reason this exists. The domain multiplies revenue by these numbers, and
   * a non-finite rate propagates into every total without throwing — a NaN total
   * renders as a blank or a dash, not as an error anyone chases.
   */
  it("drops non-finite and absurd rates instead of letting NaN reach the arithmetic", () => {
    const result = sanitizeManualRates({
      enabled: true,
      usTransportRate: Number.NaN,
      chinaVatRate: Number.POSITIVE_INFINITY,
      chinaSurchargeRate: 1e308,
      iftaRateUsdPerGallon: -1,
    });
    expect(result).toEqual({
      enabled: true,
      usTransportRate: undefined,
      chinaVatRate: undefined,
      chinaSurchargeRate: undefined,
      iftaRateUsdPerGallon: undefined,
      source: undefined,
      asOf: undefined,
    });
  });

  /** Dropped, not clamped: clamping answers a question nobody asked. */
  it("drops an out-of-range rate rather than clamping it to the ceiling", () => {
    const result = sanitizeManualRates({ enabled: true, usTransportRate: 0.95 });
    expect(result?.usTransportRate).toBeUndefined();
  });

  it("rejects a string rate rather than coercing it", () => {
    expect(
      sanitizeManualRates({ enabled: true, usTransportRate: "0.0825" })?.usTransportRate,
    ).toBeUndefined();
  });

  it("caps the free-text fields it renders verbatim", () => {
    const result = sanitizeManualRates({ enabled: true, source: "x".repeat(5000) });
    expect(result?.source?.length).toBe(200);
  });
});
