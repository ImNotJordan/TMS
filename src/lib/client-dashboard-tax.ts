/**
 * The tax figure a Client portal user is allowed to see.
 *
 * ## What this is, and what it is not
 *
 * It is the amount stored on the load in Dynamo — `taxLines` when the movement
 * carries more than one jurisdiction (China VAT and a US figure on a
 * transpacific load), otherwise `taxManualAmount`. It is not recomputed here.
 *
 * It is not the brokerage's net VAT payable, not the carrier's rate, and not
 * the margin. `carrierRate` is not consulted.
 *
 * Lane fields are used only to label the regime when no stored lines exist.
 */
import {
  parseMoney,
  resolveCountry,
  type TaxConfidence,
  type TaxCountry,
} from "@/lib/tax/tax-domain";
import type { LoadTaxLine } from "@/lib/loads-store";

export type ClientTaxLine = {
  label: string;
  amount: number;
  currency: "USD" | "CNY" | "UNKNOWN";
  country: TaxCountry;
  note?: string;
};

export type ClientTaxSnapshot = {
  amount: number;
  currency: "USD" | "CNY" | "UNKNOWN";
  source: "manual" | "estimate";
  country: TaxCountry;
  regime: string;
  label: string;
  confidence: TaxConfidence;
  note?: string;
  lines: ClientTaxLine[];
};

const ESTIMATOR_SOURCE = "estimator";

export function snapshotClientLoadTax(load: {
  customerRate?: string | number;
  taxManualAmount?: string | number;
  taxCurrency?: string;
  taxManualSource?: string;
  taxManualNote?: string;
  taxLines?: LoadTaxLine[];
  pickupState?: string;
  deliveryState?: string;
}): ClientTaxSnapshot {
  const storedLines = parseStoredLines(load.taxLines);
  const stored = parseMoney(load.taxManualAmount);
  const { country, regime, label } = describeLane(load.pickupState, load.deliveryState);
  const currency = normalizeCurrency(load.taxCurrency) ?? storedLines[0]?.currency ?? currencyFor(country);
  const source =
    typeof stored === "number" && load.taxManualSource?.trim() !== ESTIMATOR_SOURCE
      ? "manual"
      : "estimate";
  const note = load.taxManualNote?.trim() || undefined;

  const lines =
    storedLines.length > 0
      ? storedLines
      : typeof stored === "number"
        ? [
            {
              label,
              amount: roundMoney(stored),
              currency,
              country,
              note,
            },
          ]
        : [];

  const amount =
    typeof stored === "number"
      ? roundMoney(stored)
      : roundMoney(lines.reduce((sum, line) => sum + (line.currency === currency ? line.amount : 0), 0));

  return {
    amount,
    currency,
    source,
    country,
    regime: storedLines.length > 1 ? "split-leg" : regime,
    label: storedLines.length > 1 ? storedLines.map((line) => line.label).join(" + ") : label,
    confidence: storedLines.length > 0 || typeof stored === "number" ? "statutory" : "indeterminate",
    note,
    lines,
  };
}

function parseStoredLines(raw: LoadTaxLine[] | undefined): ClientTaxLine[] {
  if (!Array.isArray(raw)) return [];
  const lines: ClientTaxLine[] = [];
  for (const row of raw) {
    const amount = parseMoney(row?.amount);
    if (typeof amount !== "number") continue;
    const country = row.country === "CN" || row.country === "US" ? row.country : "UNKNOWN";
    lines.push({
      label: row.label?.trim() || (country === "CN" ? "China VAT" : country === "US" ? "US freight tax" : "Tax"),
      amount: roundMoney(amount),
      currency: normalizeCurrency(row.currency) ?? currencyFor(country),
      country,
      note: row.note?.trim() || undefined,
    });
  }
  return lines;
}

function roundMoney(value: number): number {
  return Math.round((Number.isFinite(value) ? value : 0) * 100) / 100;
}

function normalizeCurrency(value: string | undefined): ClientTaxSnapshot["currency"] | undefined {
  const raw = value?.trim().toUpperCase();
  if (raw === "USD" || raw === "CNY") return raw;
  if (raw === "UNKNOWN") return "UNKNOWN";
  return undefined;
}

function currencyFor(country: TaxCountry): ClientTaxSnapshot["currency"] {
  if (country === "CN") return "CNY";
  if (country === "US") return "USD";
  return "UNKNOWN";
}

function describeLane(
  origin?: string,
  destination?: string,
): { country: TaxCountry; regime: string; label: string } {
  const originCountry = resolveCountry(origin);
  const destinationCountry = resolveCountry(destination);
  const country = originCountry !== "UNKNOWN" ? originCountry : destinationCountry;
  if (country === "CN") return { country, regime: "china-vat", label: "China VAT" };
  if (country === "US") return { country, regime: "us-no-vat", label: "US freight tax" };
  return { country: "UNKNOWN", regime: "unsupported", label: "Tax" };
}
