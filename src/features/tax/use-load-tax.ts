/**
 * Turn a load (or an in-progress load draft) into a tax estimate.
 *
 * The mapping is the interesting part, not the arithmetic. `LoadRecord` stores
 * money as strings and has no country column, so this is where the messy real
 * shape of a stored load meets a function that wants numbers and jurisdictions.
 *
 * Deliberately reads the *draft* as well as the saved record, so the figure moves
 * while a broker is still typing rates. A tax number that only appears after
 * saving is a number nobody prices with.
 */
import * as React from "react";

import { getAppSettingBool, getAppSettingString } from "@/lib/app-settings-store";
import { useAuth } from "@/lib/auth";
import { useRbac } from "@/hooks/use-rbac";
import { strictRole } from "@/lib/tenant/strict-role";
import {
  estimateLoadTax,
  parseMoney,
  type ChinaServiceKind,
  type ChinaTaxpayerKind,
  type TaxEstimate,
  type TaxEstimateInput,
} from "@/lib/tax/tax-domain";
import type { ChinaSurchargeTier } from "@/lib/tax/tax-rates";
import { resolveManualRates } from "@/lib/tax/manual-rates";
import {
  fetchTaxEstimate,
  type ProviderComparison,
  type TaxEstimateResponse,
  type TaxSource,
} from "@/lib/tax/tax-client";

/** The subset of a load the estimator needs. Accepts a record or a form draft. */
export type TaxRelevantLoad = {
  loadId?: string;
  pickupCity?: string;
  pickupZip?: string;
  deliveryCity?: string;
  deliveryZip?: string;
  customerRate?: string | number;
  carrierRate?: string | number;
  fuelSurcharge?: string | number;
  accessorialCharges?: string | number;
  detentionRate?: string | number;
  lumperFee?: string | number;
  pickupState?: string;
  deliveryState?: string;
};

/**
 * Accessorials that are billed to the customer and therefore taxed with the
 * freight.
 *
 * `detentionRate` is deliberately excluded: it is a *rate* per hour, not an
 * amount, so adding it to revenue would tax a number that was never billed.
 * That distinction is easy to miss because the field sits next to the fees.
 */
function billedAccessorials(load: TaxRelevantLoad): number | undefined {
  const parts = [parseMoney(load.accessorialCharges), parseMoney(load.lumperFee)].filter(
    (value): value is number => typeof value === "number",
  );
  if (parts.length === 0) return undefined;
  return parts.reduce((sum, value) => sum + value, 0);
}

function asTaxpayerKind(value: string): ChinaTaxpayerKind {
  return value === "smallScale" ? "smallScale" : "general";
}

function asServiceKind(value: string): ChinaServiceKind {
  return value === "logisticsAuxiliary" ? "logisticsAuxiliary" : "transportation";
}

function asSurchargeTier(value: string): ChinaSurchargeTier {
  return value === "county" || value === "other" ? value : "city";
}

export type UseLoadTaxOptions = {
  /** Lane distance, when the caller has it — from a route lookup, usually. */
  distanceMiles?: number;
};

/**
 * Manual rates as stored, parsed into fractions.
 *
 * Exported with the problem list intact so Settings can show what it rejected.
 * `buildTaxInput` takes only `.rates` — a rate that failed validation is absent
 * rather than defaulted, so one mistyped field degrades that field to the
 * built-in behaviour instead of quietly substituting a number nobody entered.
 */
export function readManualRateSettings(): ReturnType<typeof resolveManualRates> {
  return resolveManualRates({
    enabled: getAppSettingBool("tax_manual_rates_enabled", false),
    usTransportPercent: getAppSettingString("tax_manual_us_transport_percent", ""),
    chinaVatPercent: getAppSettingString("tax_manual_cn_vat_percent", ""),
    chinaSurchargePercent: getAppSettingString("tax_manual_cn_surcharge_percent", ""),
    iftaUsdPerGallon: getAppSettingString("tax_manual_ifta_usd_per_gallon", ""),
    source: getAppSettingString("tax_manual_rate_source", ""),
    asOf: getAppSettingString("tax_manual_rate_as_of", ""),
  });
}

/**
 * Workspace tax posture, read from app settings.
 *
 * These are company-level facts — whether you are a general VAT taxpayer,
 * whether your contracts are written tax-inclusive — not per-load ones, so they
 * belong in Settings rather than on every load form.
 */
export function readTaxSettings(): Pick<
  TaxEstimateInput,
  | "chinaTaxpayerKind"
  | "chinaServiceKind"
  | "amountsIncludeVat"
  | "carrierIssuesSpecialVatInvoice"
  | "chinaSurchargeTier"
  | "truckMilesPerGallon"
  | "manualRates"
> {
  const mpg = Number(getAppSettingString("tax_truck_mpg", ""));
  return {
    manualRates: readManualRateSettings().rates,
    chinaTaxpayerKind: asTaxpayerKind(getAppSettingString("tax_cn_taxpayer_kind", "general")),
    chinaServiceKind: asServiceKind(getAppSettingString("tax_cn_service_kind", "transportation")),
    amountsIncludeVat: getAppSettingBool("tax_cn_amounts_include_vat", true),
    carrierIssuesSpecialVatInvoice: getAppSettingBool("tax_cn_carrier_special_invoice", true),
    chinaSurchargeTier: asSurchargeTier(getAppSettingString("tax_cn_surcharge_tier", "city")),
    truckMilesPerGallon: Number.isFinite(mpg) && mpg > 0 ? mpg : undefined,
  };
}

export function buildTaxInput(
  load: TaxRelevantLoad,
  options?: UseLoadTaxOptions,
): TaxEstimateInput {
  return {
    // Zero rather than undefined: a load with no rate entered yet is a real
    // state, and the estimator should answer "no tax" for it rather than NaN.
    customerRate: parseMoney(load.customerRate) ?? 0,
    carrierRate: parseMoney(load.carrierRate),
    fuelSurcharge: parseMoney(load.fuelSurcharge),
    accessorialCharges: billedAccessorials(load),
    originRegion: load.pickupState,
    destinationRegion: load.deliveryState,
    distanceMiles: options?.distanceMiles,
    ...readTaxSettings(),
  };
}

/** Gross billed to the customer — the denominator for the effective rate. */
export function grossRevenueOf(load: TaxRelevantLoad): number {
  return (
    (parseMoney(load.customerRate) ?? 0) +
    (parseMoney(load.fuelSurcharge) ?? 0) +
    (billedAccessorials(load) ?? 0)
  );
}

export function useLoadTax(
  load: TaxRelevantLoad,
  options?: UseLoadTaxOptions,
): { estimate: TaxEstimate; grossRevenue: number } {
  const distanceMiles = options?.distanceMiles;

  // Keyed on the fields that actually move the figure. Recomputing on every
  // keystroke elsewhere in a 7-step load form would be wasted work, and the
  // estimator is pure so memoizing is safe.
  return React.useMemo(() => {
    return {
      estimate: estimateLoadTax(buildTaxInput(load, { distanceMiles })),
      grossRevenue: grossRevenueOf(load),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- narrow deps by value, not identity
  }, [
    load.customerRate,
    load.carrierRate,
    load.fuelSurcharge,
    load.accessorialCharges,
    load.lumperFee,
    load.pickupState,
    load.deliveryState,
    distanceMiles,
  ]);
}

/* ------------------------------------------------------------------ *
 * Authoritative estimate
 * ------------------------------------------------------------------ */

export type AuthoritativeTax = {
  estimate: ReturnType<typeof estimateLoadTax>;
  grossRevenue: number;
  /** Which engine produced the figure on screen. */
  source: TaxSource;
  provider?: TaxEstimateResponse["provider"];
  providerError?: string;
  agreement: ProviderComparison;
  /** True when the fuel-tax line used published per-jurisdiction rates. */
  fuelRatesLive: boolean;
  fuelRateQuarter?: string;
  /** A server lookup is in flight; the figure shown is the local one. */
  resolving: boolean;
};

/**
 * Debounce before asking the server.
 *
 * The review step re-renders on every keystroke in a seven-step form, and both
 * the AvaTax call and the IFTA fetch cost real money or real goodwill. Settling
 * first is the difference between one request per priced load and one per
 * character.
 */
const SETTLE_MS = 600;

/**
 * The statutory estimate immediately, then the authoritative one when it lands.
 *
 * Falls back silently: if the server is unreachable or no provider is configured,
 * the locally computed figure stands and `source` stays `internal`. The panel
 * labels which it is showing, so "we could not reach the provider" never looks
 * like "there is no tax".
 */
export function useAuthoritativeLoadTax(
  load: TaxRelevantLoad,
  options?: UseLoadTaxOptions,
): AuthoritativeTax {
  const local = useLoadTax(load, options);
  const [remote, setRemote] = React.useState<TaxEstimateResponse | null>(null);
  const [resolving, setResolving] = React.useState(false);

  // Serialized so the effect fires on value changes rather than on the identity
  // of a freshly-spread draft object.
  const requestKey = JSON.stringify({
    customerRate: load.customerRate,
    carrierRate: load.carrierRate,
    fuelSurcharge: load.fuelSurcharge,
    accessorialCharges: load.accessorialCharges,
    lumperFee: load.lumperFee,
    pickupState: load.pickupState,
    pickupZip: load.pickupZip,
    deliveryState: load.deliveryState,
    deliveryZip: load.deliveryZip,
    distanceMiles: options?.distanceMiles,
  });

  React.useEffect(() => {
    // Nothing priced yet — no point spending a provider transaction on a zero.
    if (!(parseMoney(load.customerRate) ?? 0)) {
      setRemote(null);
      return;
    }

    let cancelled = false;
    setResolving(true);
    const timer = window.setTimeout(() => {
      void fetchTaxEstimate({
        ...buildTaxInput(load, options),
        originCity: load.pickupCity,
        originZip: load.pickupZip,
        destinationCity: load.deliveryCity,
        destinationZip: load.deliveryZip,
        loadId: load.loadId,
      })
        .then((response) => {
          if (!cancelled) setRemote(response);
        })
        .catch(() => {
          if (!cancelled) setRemote(null);
        })
        .finally(() => {
          if (!cancelled) setResolving(false);
        });
    }, SETTLE_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      setResolving(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by value
  }, [requestKey]);

  if (!remote) {
    return {
      ...local,
      source: "internal",
      agreement: "not-checked",
      fuelRatesLive: false,
      resolving,
    };
  }

  return {
    // The server's estimate supersedes the local one: it is the same arithmetic
    // plus real IFTA rates, so it is never worse.
    estimate: remote.estimate,
    grossRevenue: local.grossRevenue,
    source: remote.source,
    provider: remote.provider,
    providerError: remote.providerError,
    agreement: remote.agreement,
    fuelRatesLive: remote.fuelRatesLive,
    fuelRateQuarter: remote.fuelRateQuarter,
    resolving,
  };
}

/* ------------------------------------------------------------------ *
 * Who may enter a tax figure
 * ------------------------------------------------------------------ */

/**
 * Client mirror of `LOAD_TAX_SETTERS`.
 *
 * Pricers plus Accounting — wider than the rate gate, because whoever does the
 * books is exactly who reads a VAT calculator, and narrower than
 * `LOAD_WRITERS`, because a dispatcher moving a truck has no business restating
 * what the load owes.
 *
 * A courtesy, not the boundary: `checkLoadUpdate` re-decides this server-side
 * from the token's role. An unknown role defers to the server rather than
 * greying out a control a group-assigned Accountant is entitled to use.
 */
const TAX_SETTER_ROLES: ReadonlySet<string> = new Set([
  "Organization Owner",
  "Admin",
  "SuperAdmin",
  "Operations Manager",
  "Broker",
  "Accounting",
]);

export function useTaxOverrideAccess(): { canSetTax: boolean; denyReason: string | null } {
  const { user } = useAuth();
  const { permissions, canMutate, loading } = useRbac();

  const role = React.useMemo(
    () =>
      strictRole(user?.attributes?.["custom:role"]) ??
      strictRole(permissions.role as string | undefined),
    [permissions.role, user?.attributes],
  );

  const canMutateLoads = canMutate("Loads");
  if (loading) return { canSetTax: true, denyReason: null };

  if (!canMutateLoads) {
    return {
      canSetTax: false,
      denyReason:
        "Your access to Loads is read-only. Ask an admin to update Role & Access → Module Permissions.",
    };
  }
  if (role === null) return { canSetTax: true, denyReason: null };
  if (TAX_SETTER_ROLES.has(role)) return { canSetTax: true, denyReason: null };

  return {
    canSetTax: false,
    denyReason: `${role} cannot set the tax figure on a load. Accounting, Broker, Operations Manager or an admin can.`,
  };
}
