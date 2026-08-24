/**
 * Client transport for `/api/tax`.
 *
 * The server is asked for the authoritative figure; the local estimator still
 * runs first so the panel has something to show while the request is in flight.
 * That ordering matters on a pricing screen — a number that appears after a
 * round trip is a number people stop waiting for.
 */
import { sendResourceRequest, ResourceApiError } from "@/lib/api/resource-client";
import type { TaxEstimate, TaxEstimateInput } from "@/lib/tax/tax-domain";

export type TaxSource = "internal" | "avalara";

export type ProviderComparison = "agrees" | "disagrees" | "not-checked";

export type TaxEstimateResponse = {
  estimate: TaxEstimate;
  source: TaxSource;
  provider?: {
    id: "avalara";
    totalTax: number;
    effectiveRate: number;
    jurisdictions: { name: string; type: string; rate: number; tax: number }[];
    transactionCode?: string;
  };
  providerError?: string;
  agreement: ProviderComparison;
  /** True when the fuel-tax line used published per-jurisdiction rates. */
  fuelRatesLive: boolean;
  fuelRateQuarter?: string;
};

export type TaxProviderStatus = {
  configured: boolean;
  provider: "avalara" | null;
  environment?: "sandbox" | "production";
  authenticated?: boolean;
  message: string;
};

/** Address detail the server needs for a rooftop determination. */
export type TaxEstimateRequest = Partial<TaxEstimateInput> & {
  originCity?: string;
  originZip?: string;
  destinationCity?: string;
  destinationZip?: string;
  loadId?: string;
};

export async function fetchTaxEstimate(
  input: TaxEstimateRequest,
): Promise<TaxEstimateResponse | null> {
  try {
    return await sendResourceRequest<TaxEstimateResponse>("/api/tax/estimate", {
      method: "POST",
      body: { input },
    });
  } catch (err) {
    // A failed lookup must never blank the panel — the caller keeps the locally
    // computed statutory estimate. Rethrown only for the company-assignment
    // case, which is a prompt rather than a failure.
    if (err instanceof ResourceApiError && err.needsCompany) throw err;
    return null;
  }
}

export async function fetchTaxProviderStatus(): Promise<TaxProviderStatus | null> {
  try {
    return await sendResourceRequest<TaxProviderStatus>("/api/tax/status");
  } catch {
    return null;
  }
}
