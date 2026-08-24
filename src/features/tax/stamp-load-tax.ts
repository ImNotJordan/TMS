/**
 * Persist the tax the broker is looking at, so the client portal cannot
 * re-invent a different one.
 *
 * Settings rates and the estimator live in the ops app. The client dashboard
 * must not re-run that math without those rates — that is how a Hawaii GET
 * figure became $0 for the shipper. The load row is the contract: whatever was
 * shown at save is what Dynamo holds, and what `/api/client/dashboard` returns.
 *
 * A non-estimator `taxManualSource` means someone typed an override. That amount
 * is kept until they clear it. An empty amount, or a previous estimator stamp,
 * is recomputed from the current rates and Settings so a price edit does not
 * leave a stale tax sitting next to a new customer rate.
 */
import { buildTaxInput, type TaxRelevantLoad } from "@/features/tax/use-load-tax";
import { estimateLoadTax, parseMoney } from "@/lib/tax/tax-domain";

/** Written when the stored figure is the estimator (including Settings rates). */
export const STORED_TAX_ESTIMATE_SOURCE = "estimator";

export type StoredLoadTax = {
  taxManualAmount: string;
  taxCurrency: string;
  taxManualSource: string;
  taxManualNote: string;
};

export type StampableLoad = TaxRelevantLoad & {
  taxManualAmount?: string;
  taxCurrency?: string;
  taxManualSource?: string;
  taxManualNote?: string;
};

function roundMoney(value: number): number {
  return Math.round((Number.isFinite(value) ? value : 0) * 100) / 100;
}

function formatMoney(value: number): string {
  return roundMoney(value).toFixed(2);
}

function isOverride(load: StampableLoad): boolean {
  const entered = parseMoney(load.taxManualAmount);
  if (typeof entered !== "number") return false;
  return load.taxManualSource?.trim() !== STORED_TAX_ESTIMATE_SOURCE;
}

/**
 * The tax fields to write on this save.
 *
 * Pure given Settings (via `buildTaxInput`) and the load. Call this immediately
 * before create/update so the payload Dynamo stores matches the preview.
 */
export function stampStoredLoadTax(load: StampableLoad): StoredLoadTax {
  if (isOverride(load)) {
    const amount = parseMoney(load.taxManualAmount) ?? 0;
    return {
      taxManualAmount: formatMoney(amount),
      taxCurrency: load.taxCurrency?.trim() || "USD",
      taxManualSource: load.taxManualSource?.trim() || "manual",
      taxManualNote: load.taxManualNote?.trim() ?? "",
    };
  }

  const estimate = estimateLoadTax(buildTaxInput(load));
  const note =
    load.taxManualNote?.trim() ||
    (estimate.usesManualRates ? "Settings rate applied at save." : "");

  return {
    taxManualAmount: formatMoney(estimate.outputTax),
    taxCurrency: estimate.currency === "UNKNOWN" ? "" : estimate.currency,
    taxManualSource: STORED_TAX_ESTIMATE_SOURCE,
    taxManualNote: note,
  };
}

export function withStoredLoadTax<T extends StampableLoad>(load: T): T {
  return { ...load, ...stampStoredLoadTax(load) };
}
