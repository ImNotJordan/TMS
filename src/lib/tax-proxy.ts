/**
 * Tax estimation endpoint.
 *
 *   POST /api/tax/estimate   authoritative figure for one load
 *   GET  /api/tax/status     is a provider configured, and does its key work
 *
 * ## Why this is server-side at all
 *
 * Two reasons, and the second is the important one.
 *
 * 1. **The credential.** An AvaTax key can post committed transactions to a
 *    filing account. It is not a public value, so it lives in the
 *    WorkspaceSettings `secrets` partition under that company's sort key —
 *    denied to the browser's Identity Pool role — and is read only here,
 *    exactly like the OpenAI key. A single unscoped `avalara` row would let
 *    one tenant post to another's filing account.
 *
 * 2. **The IFTA fetch.** Real fuel-tax rates come from parsing iftach.org.
 *    Doing that from the browser would be blocked by CORS, and doing it per page
 *    view would hammer a third party. Here it is fetched once and cached for the
 *    whole workspace.
 *
 * ## The provider is checked, not trusted
 *
 * A provider figure that wildly contradicts the statutory arithmetic is more
 * likely a misconfiguration — wrong company code, wrong tax code, addresses that
 * geocoded somewhere unexpected — than a discovery about tax law. So the response
 * carries both numbers and a `agreement` verdict, and the UI shows the
 * disagreement rather than silently preferring one. Silently preferring the
 * provider is how a bad company code becomes a quote.
 */
import { GetCommand } from "@aws-sdk/lib-dynamodb";

import { getAiDynamoClient, getWorkspaceSettingsTable } from "@/lib/ai/server-aws";
import { AVALARA_SECRET_SECTION, companySecretKey } from "@/lib/ai/settings-scopes";
import { requireCurrentTenantContext } from "@/lib/tenant/request-context";
import { refuseClientOnOpsApi } from "@/lib/tenant/client-scope";
import {
  logTenantDenial,
  requireCompanyId,
  tenantErrorResponse,
} from "@/lib/tenant/server-tenant-context";
import {
  callAvalara,
  pingAvalara,
  type AvalaraCredentials,
  type AvalaraQuote,
} from "@/lib/tax/avalara-adapter";
import { getIftaRates, laneDieselRate } from "@/lib/tax/ifta-rates";
import {
  estimateLoadTax,
  resolveCountry,
  type TaxEstimate,
  type TaxEstimateInput,
} from "@/lib/tax/tax-domain";
import { sanitizeManualRates } from "@/lib/tax/manual-rates";

const ESTIMATE_PATH = "/api/tax/estimate";
const STATUS_PATH = "/api/tax/status";
const MAX_BODY_BYTES = 20_000;

export function isTaxApiRequest(url: URL, method: string): boolean {
  if (method === "POST" && url.pathname === ESTIMATE_PATH) return true;
  if (method === "GET" && url.pathname === STATUS_PATH) return true;
  return false;
}

function jsonError(message: string, status: number, code?: string) {
  return Response.json({ error: message, code }, { status });
}

/* ------------------------------------------------------------------ *
 * Credentials
 * ------------------------------------------------------------------ */

type StoredAvalara = {
  accountId?: unknown;
  licenseKey?: unknown;
  companyCode?: unknown;
  environment?: unknown;
  enabled?: unknown;
};

/**
 * Read the AvaTax credential from the server-only partition.
 *
 * Returns `null` for "not configured", which is a normal state and not an error —
 * the built-in estimator answers on its own.
 */
async function loadAvalaraCredentials(
  request: Request,
  companyId: string,
): Promise<AvalaraCredentials | null> {
  const client = await getAiDynamoClient(request);
  const out = (await client.send(
    new GetCommand({
      TableName: getWorkspaceSettingsTable(),
      Key: companySecretKey(companyId, AVALARA_SECRET_SECTION),
    }) as never,
  )) as { Item?: { data?: StoredAvalara } };

  const data = out.Item?.data;
  if (!data) return null;
  if (data.enabled === false) return null;

  const accountId = typeof data.accountId === "string" ? data.accountId.trim() : "";
  const licenseKey = typeof data.licenseKey === "string" ? data.licenseKey.trim() : "";
  if (!accountId || !licenseKey) return null;

  return {
    accountId,
    licenseKey,
    companyCode: (typeof data.companyCode === "string" && data.companyCode.trim()) || "DEFAULT",
    // Defaults to sandbox. Reaching production must be a deliberate act, because
    // the difference is whether a mistake touches a real filing account.
    environment: data.environment === "production" ? "production" : "sandbox",
  };
}

/* ------------------------------------------------------------------ *
 * Payload
 * ------------------------------------------------------------------ */

type EstimateBody = {
  input?: Partial<TaxEstimateInput> & {
    originZip?: string;
    originCity?: string;
    destinationZip?: string;
    destinationCity?: string;
    loadId?: string;
  };
};

async function readBody(request: Request): Promise<EstimateBody | Response> {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    return jsonError("Request body too large.", 413, "payload_too_large");
  }
  try {
    const parsed = (await request.json()) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return jsonError("Expected a JSON object.", 400, "invalid_payload");
    }
    return parsed as EstimateBody;
  } catch {
    return jsonError("Invalid JSON body.", 400, "invalid_payload");
  }
}

function positiveNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

/* ------------------------------------------------------------------ *
 * Response shape
 * ------------------------------------------------------------------ */

export type TaxSource = "internal" | "avalara";

export type ProviderComparison =
  /** Provider and statute agree within tolerance. */
  | "agrees"
  /** They differ materially — surfaced, never silently resolved. */
  | "disagrees"
  /** No provider ran. */
  | "not-checked";

export type TaxEstimateResponse = {
  /** Always present. The statutory arithmetic. */
  estimate: TaxEstimate;
  /** Which figure the UI should lead with. */
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
  /** True when the fuel-tax figure used real per-jurisdiction rates. */
  fuelRatesLive: boolean;
  fuelRateQuarter?: string;
};

/**
 * Materiality threshold for the provider-vs-statute comparison.
 *
 * Cents of rounding are noise. A provider saying $180 where the statute says
 * zero is a configuration problem worth a human looking at, so the bar is both
 * absolute and relative — a small load should not trip on a $5 difference, and a
 * large one should not hide a 30% one.
 */
function comparesWithin(providerTax: number, internalTax: number): boolean {
  const delta = Math.abs(providerTax - internalTax);
  if (delta <= 1) return true;
  const base = Math.max(providerTax, internalTax);
  return base > 0 && delta / base <= 0.05;
}

/* ------------------------------------------------------------------ *
 * Handler
 * ------------------------------------------------------------------ */

export async function handleTaxApiRequest(request: Request): Promise<Response> {
  const url = new URL(request.url);

  let ctx;
  try {
    ctx = await requireCurrentTenantContext(request);
  } catch (err) {
    return tenantErrorResponse(err) ?? jsonError("Sign in required.", 401, "not_authenticated");
  }

  const refused = refuseClientOnOpsApi(ctx, url.pathname);
  if (refused) return refused;

  let companyId: string;
  try {
    companyId = requireCompanyId(ctx);
  } catch (err) {
    return tenantErrorResponse(err) ?? jsonError("Sign in required.", 401, "not_authenticated");
  }

  try {
    if (url.pathname === STATUS_PATH) {
      const credentials = await loadAvalaraCredentials(request, companyId);
      if (!credentials) {
        return Response.json({
          configured: false,
          provider: null,
          message:
            "No tax provider connected. The built-in estimator is handling China VAT and US " +
            "interstate determination on its own.",
        });
      }
      const ping = await pingAvalara(credentials);
      return Response.json({
        configured: true,
        provider: "avalara",
        environment: credentials.environment,
        authenticated: ping.authenticated,
        message: ping.message,
      });
    }

    // ---- POST /api/tax/estimate ----
    const body = await readBody(request);
    if (body instanceof Response) return body;
    const input = body.input ?? {};

    // The statutory arithmetic runs unconditionally. It is the baseline the
    // provider is checked against, and the answer if the provider is absent.
    const estimateInput: TaxEstimateInput = {
      ...input,
      customerRate: positiveNumber(input.customerRate) ?? 0,
      // Re-derived from the body rather than trusted as-is: the domain multiplies
      // revenue by these, and a non-finite rate would propagate into every total
      // without erroring.
      manualRates: sanitizeManualRates(input.manualRates),
    } as TaxEstimateInput;

    // ---- Real fuel-tax rates ------------------------------------------------
    let fuelRatesLive = false;
    let fuelRateQuarter: string | undefined;
    const originCountry = resolveCountry(input.originRegion, input.originCountry);

    if (originCountry === "US" && (input.distanceMiles ?? 0) > 0) {
      const table = await getIftaRates();
      if (table) {
        const lane = laneDieselRate(table, input.originRegion ?? "", input.destinationRegion ?? "");
        if (lane) {
          estimateInput.iftaRateOverride = lane.rate;
          estimateInput.iftaRateSource = `IFTA ${table.quarter} · ${lane.jurisdictions.join(", ")} · ${lane.assumption}`;
          fuelRatesLive = true;
          fuelRateQuarter = table.quarter;
        }
      }
    }

    const estimate = estimateLoadTax(estimateInput);

    // ---- Provider -----------------------------------------------------------
    const credentials = await loadAvalaraCredentials(request, companyId);
    if (!credentials) {
      return Response.json({
        estimate,
        source: "internal",
        agreement: "not-checked",
        fuelRatesLive,
        fuelRateQuarter,
      } satisfies TaxEstimateResponse);
    }

    // Only asked for the case it can actually answer better than statute: a US
    // sales-tax determination. Paying per transaction to be told China's rate is
    // 9% would be spending money to learn the law.
    if (originCountry !== "US") {
      return Response.json({
        estimate,
        source: "internal",
        agreement: "not-checked",
        fuelRatesLive,
        fuelRateQuarter,
      } satisfies TaxEstimateResponse);
    }

    const quote = await callAvalara(credentials, {
      amount:
        (positiveNumber(input.customerRate) ?? 0) +
        (positiveNumber(input.fuelSurcharge) ?? 0) +
        (positiveNumber(input.accessorialCharges) ?? 0),
      currency: "USD",
      shipFrom: {
        line1: undefined,
        city: input.originCity,
        region: input.originRegion,
        postalCode: input.originZip,
        country: "US",
      },
      shipTo: {
        line1: undefined,
        city: input.destinationCity,
        region: input.destinationRegion,
        postalCode: input.destinationZip,
        country: "US",
      },
      reference: input.loadId ?? "estimate",
    });

    if (!quote.ok) {
      // A provider failure must not blank the figure. The statutory estimate
      // stands and the error is reported alongside it.
      if (quote.code === "unauthorized") {
        logTenantDenial(ctx, "AvaTax rejected the workspace credentials", url.pathname);
      }
      return Response.json({
        estimate,
        source: "internal",
        providerError: quote.message,
        agreement: "not-checked",
        fuelRatesLive,
        fuelRateQuarter,
      } satisfies TaxEstimateResponse);
    }

    const provider = quote as { ok: true } & AvalaraQuote;
    const agreement: ProviderComparison = comparesWithin(provider.totalTax, estimate.outputTax)
      ? "agrees"
      : "disagrees";

    return Response.json({
      estimate,
      // The provider leads for US sales tax — that is what it is for — but the
      // statutory estimate travels with it so a disagreement is visible.
      source: "avalara",
      provider: {
        id: "avalara",
        totalTax: provider.totalTax,
        effectiveRate: provider.effectiveRate,
        jurisdictions: provider.details.map((detail) => ({
          name: detail.jurisdictionName,
          type: detail.jurisdictionType,
          rate: detail.rate,
          tax: detail.tax,
        })),
        transactionCode: provider.transactionCode,
      },
      agreement,
      fuelRatesLive,
      fuelRateQuarter,
    } satisfies TaxEstimateResponse);
  } catch (err) {
    console.error("[tax] request failed", err instanceof Error ? err.message : err);
    return jsonError("Could not complete the tax estimate.", 502, "error");
  }
}
