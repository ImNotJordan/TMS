/**
 * Manual tax rates, set once in Settings and applied to every load.
 *
 * ## Why this exists
 *
 * The estimator deliberately refuses to invent rates. For a US state that does
 * reach transportation with its sales tax, it names the exposure and returns
 * `indeterminate` rather than guessing a combined state-plus-local percentage —
 * there are thousands of jurisdictions and a wrong one is worse than a blank.
 *
 * That refusal is correct, and it leaves a hole: the operator often *does* know
 * the rate, because they looked it up. This module is how that knowledge gets
 * into the system — entered once as a company-level fact, the same way fleet MPG
 * and taxpayer status already are, rather than retyped on every load.
 *
 * ## Why rates and not amounts
 *
 * A per-load tax *amount* also exists (see `LOAD_TAX_FIELDS`) and is the right
 * tool for a one-off. It is the wrong tool for a standing rate: an amount typed
 * in Settings would be the same tax on a $900 load and a $9,000 one. A rate
 * scales, which is what applying it during load building requires.
 *
 * ## Why parsing is strict
 *
 * `"9"` means 9%, not 900% and not 0.09. The hazard is the operator who types
 * `0.09` meaning nine percent: taken at face value that is nine *hundredths* of
 * a percent, understating tax roughly a hundredfold, and the resulting figure is
 * small but plausible enough to go unnoticed for months. So values are range-
 * checked and a suspected fraction is rejected with an explanation rather than
 * silently applied.
 */

/** Rates as decimal fractions — `0.0825`, never `8.25`. */
export type ManualTaxRates = {
  /**
   * Off means every field here is ignored. Separate from clearing the fields so
   * the numbers survive being switched off and back on.
   */
  enabled: boolean;
  /** US transportation sales-tax rate. Applied only to intrastate movements. */
  usTransportRate?: number;
  /** Replaces the statutory China VAT output rate. */
  chinaVatRate?: number;
  /** Replaces the tier-derived surcharge total. Levied on VAT payable. */
  chinaSurchargeRate?: number;
  /** IFTA diesel rate, USD per gallon. */
  iftaRateUsdPerGallon?: number;
  /** Where the figures came from. Rendered verbatim, never translated. */
  source?: string;
  /** As-of date, `YYYY-MM-DD`. A rate with no date cannot be judged stale. */
  asOf?: string;
};

export type RateProblemCode =
  | "not_a_number"
  | "negative"
  | "above_maximum"
  | "looks_like_a_fraction";

export type RateParse =
  | { ok: true; value: number | undefined }
  | { ok: false; code: RateProblemCode; message: string };

/**
 * Percent fields whose value is below this are almost certainly a fraction
 * typed where a percent was asked for.
 *
 * No real combined sales-tax or VAT rate sits under half a percent, so the
 * false-positive cost is nil and the false-negative cost is a tax figure wrong
 * by two orders of magnitude.
 */
const SUSPECTED_FRACTION_BELOW_PERCENT = 0.5;

/**
 * Parse a percent entered as a percent.
 *
 * Empty is `undefined` — "not set". Zero is `0` — "I checked, and it is exempt".
 * Those are different answers and the caller must be able to tell them apart,
 * which is why this does not collapse both to a falsy number.
 */
export function parsePercentRate(raw: string | undefined | null, maxPercent: number): RateParse {
  const text = (raw ?? "").trim().replace(/%$/, "").trim();
  if (text === "") return { ok: true, value: undefined };

  const percent = Number(text);
  if (!Number.isFinite(percent)) {
    return { ok: false, code: "not_a_number", message: `"${text}" is not a number.` };
  }
  if (percent < 0) {
    return { ok: false, code: "negative", message: "A tax rate cannot be negative." };
  }
  if (percent > maxPercent) {
    return {
      ok: false,
      code: "above_maximum",
      message: `${percent}% is above the ${maxPercent}% ceiling for this field. Enter a percent, not a multiplier.`,
    };
  }
  if (percent > 0 && percent < SUSPECTED_FRACTION_BELOW_PERCENT) {
    return {
      ok: false,
      code: "looks_like_a_fraction",
      message: `Enter ${percent * 100} for ${percent * 100}%, not ${percent}. This field takes a percent.`,
    };
  }
  // Rounded to a ten-thousandth of a percent: enough for any published rate, and
  // it keeps float noise out of every downstream line item.
  return { ok: true, value: Math.round((percent / 100) * 1e6) / 1e6 };
}

/**
 * Plausibility band for a per-gallon fuel tax rate.
 *
 * Matches the band `ifta-rates.ts` applies to the published matrix, so a
 * hand-entered rate is held to the same standard as a parsed one. Real US
 * jurisdiction rates span roughly $0.19–$0.97.
 */
const IFTA_MIN_USD_PER_GALLON = 0.05;
const IFTA_MAX_USD_PER_GALLON = 2.0;

export function parseFuelRate(raw: string | undefined | null): RateParse {
  const text = (raw ?? "").trim().replace(/^\$/, "").trim();
  if (text === "") return { ok: true, value: undefined };

  const rate = Number(text);
  if (!Number.isFinite(rate)) {
    return { ok: false, code: "not_a_number", message: `"${text}" is not a number.` };
  }
  if (rate < 0) {
    return { ok: false, code: "negative", message: "A fuel tax rate cannot be negative." };
  }
  if (rate > 0 && rate < IFTA_MIN_USD_PER_GALLON) {
    return {
      ok: false,
      code: "looks_like_a_fraction",
      message: `$${rate}/gal is below every published IFTA rate. Enter dollars per gallon, e.g. 0.34.`,
    };
  }
  if (rate > IFTA_MAX_USD_PER_GALLON) {
    return {
      ok: false,
      code: "above_maximum",
      message: `$${rate}/gal is above every published IFTA rate. Enter dollars per gallon, e.g. 0.34.`,
    };
  }
  // Zero becomes "not set" rather than a zero rate: no IFTA jurisdiction taxes
  // diesel at nothing, so a zero here is a cleared field typed as a number.
  return { ok: true, value: rate === 0 ? undefined : Math.round(rate * 1e4) / 1e4 };
}

/** Ceilings, each a little above the highest rate the jurisdiction actually levies. */
export const RATE_CEILINGS = {
  /** Highest US combined state+local is around 11.5%. */
  usTransport: 20,
  /** China's top VAT rate is 13%. */
  chinaVat: 30,
  /** Statutory surcharge total is 12% (7 + 3 + 2). */
  chinaSurcharge: 30,
} as const;

export type ManualRateProblem = { field: string; message: string };

/** What Settings stores, before parsing. All strings, as the settings store holds. */
export type ManualRateSettings = {
  enabled: boolean;
  usTransportPercent?: string;
  chinaVatPercent?: string;
  chinaSurchargePercent?: string;
  iftaUsdPerGallon?: string;
  source?: string;
  asOf?: string;
};

/**
 * Parse the stored strings into rates, collecting every problem rather than
 * failing on the first.
 *
 * A bad field is *dropped*, not defaulted — so one mistyped rate degrades that
 * one rate back to the built-in behaviour instead of poisoning the others or
 * silently substituting a number nobody entered.
 */
export function resolveManualRates(settings: ManualRateSettings): {
  rates: ManualTaxRates;
  problems: ManualRateProblem[];
} {
  const problems: ManualRateProblem[] = [];

  const percent = (field: string, raw: string | undefined, max: number) => {
    const parsed = parsePercentRate(raw, max);
    if (!parsed.ok) {
      problems.push({ field, message: parsed.message });
      return undefined;
    }
    return parsed.value;
  };

  const fuel = parseFuelRate(settings.iftaUsdPerGallon);
  if (!fuel.ok) problems.push({ field: "iftaUsdPerGallon", message: fuel.message });

  return {
    rates: {
      enabled: settings.enabled,
      usTransportRate: percent(
        "usTransportPercent",
        settings.usTransportPercent,
        RATE_CEILINGS.usTransport,
      ),
      chinaVatRate: percent("chinaVatPercent", settings.chinaVatPercent, RATE_CEILINGS.chinaVat),
      chinaSurchargeRate: percent(
        "chinaSurchargePercent",
        settings.chinaSurchargePercent,
        RATE_CEILINGS.chinaSurcharge,
      ),
      iftaRateUsdPerGallon: fuel.ok ? fuel.value : undefined,
      source: settings.source?.trim() || undefined,
      asOf: settings.asOf?.trim() || undefined,
    },
    problems,
  };
}

/**
 * Is any rate actually set?
 *
 * `enabled` alone does not mean the operator supplied anything, and a panel that
 * announces "manual rates in use" when every field is blank is worse than
 * silent.
 */
export function hasAnyManualRate(rates: ManualTaxRates | undefined): boolean {
  if (!rates?.enabled) return false;
  return (
    rates.usTransportRate !== undefined ||
    rates.chinaVatRate !== undefined ||
    rates.chinaSurchargeRate !== undefined ||
    rates.iftaRateUsdPerGallon !== undefined
  );
}

/**
 * Provenance suffix for a note, e.g. `"Avalara lookup, as of 2026-08-01"`.
 *
 * Built here so every note citing a manual rate cites it the same way, and so a
 * rate with neither source nor date still reads honestly rather than implying
 * one was recorded.
 */
export function manualRateProvenance(rates: ManualTaxRates): string {
  const parts = [rates.source, rates.asOf ? `as of ${rates.asOf}` : undefined].filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : "no source recorded";
}

/* ------------------------------------------------------------------ *
 * Untrusted input
 * ------------------------------------------------------------------ */

/** Fractions, so the percent ceilings above divided by 100. */
function boundedFraction(value: unknown, maxPercent: number): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  if (value < 0 || value > maxPercent / 100) return undefined;
  return value;
}

function shortString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  // Capped because it is rendered verbatim in a note; a caller is not given a
  // free-text channel of unbounded length into every tax figure.
  const text = value.trim().slice(0, 200);
  return text || undefined;
}

/**
 * Sanitize manual rates arriving over the wire.
 *
 * The estimate endpoint takes its whole input from the request body, the same as
 * taxpayer status and fleet MPG already do — so this crosses no new trust
 * boundary. What it does prevent is a non-finite or absurd rate reaching the
 * arithmetic: the domain multiplies revenue by this number, and `NaN` there
 * propagates into every total silently rather than failing loudly.
 *
 * Out-of-range values are dropped, not clamped. Clamping would answer a question
 * nobody asked with a number nobody supplied.
 */
export function sanitizeManualRates(value: unknown): ManualTaxRates | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  if (raw.enabled !== true) return undefined;

  const fuel = raw.iftaRateUsdPerGallon;
  const fuelRate =
    typeof fuel === "number" &&
    Number.isFinite(fuel) &&
    fuel >= IFTA_MIN_USD_PER_GALLON &&
    fuel <= IFTA_MAX_USD_PER_GALLON
      ? fuel
      : undefined;

  return {
    enabled: true,
    usTransportRate: boundedFraction(raw.usTransportRate, RATE_CEILINGS.usTransport),
    chinaVatRate: boundedFraction(raw.chinaVatRate, RATE_CEILINGS.chinaVat),
    chinaSurchargeRate: boundedFraction(raw.chinaSurchargeRate, RATE_CEILINGS.chinaSurcharge),
    iftaRateUsdPerGallon: fuelRate,
    source: shortString(raw.source),
    asOf: shortString(raw.asOf),
  };
}
