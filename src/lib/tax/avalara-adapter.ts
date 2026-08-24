/**
 * Avalara AvaTax adapter — authoritative US sales tax for a freight charge.
 *
 * ## Why Avalara and not Stripe Tax
 *
 * Checked before writing this: Stripe Tax's published tax-code list has **no
 * code for shipping, freight or transportation**. The closest is
 * `txcd_20030000` "General services", which is itself a guess about how a state
 * treats freight — exactly the thing we are trying to stop doing. Avalara
 * publishes `FR020100`, "shipping only, common carrier, FOB destination", which
 * is the actual classification for brokered truckload freight.
 *
 * So for this domain Avalara is not merely the broader product, it is the only
 * one of the two that can express the question.
 *
 * ## Split into pure and impure on purpose
 *
 * `buildTransactionRequest` and `parseTransactionResponse` are pure and unit
 * tested against recorded response shapes. `callAvalara` is the only part that
 * touches the network. That division is what makes an integration nobody can
 * get sandbox credentials for still reviewable: the mapping is verified, and only
 * the transport is unproven.
 *
 * ## Not committed
 *
 * Every request sets `commit: false` and type `SalesOrder` rather than
 * `SalesInvoice`. A committed transaction becomes part of the account's filing
 * data — estimating tax on a load a broker is still pricing must not post
 * anything to a return. Committing is a deliberate later step tied to invoicing,
 * not to quoting.
 */

/** Avalara's classification for common-carrier freight, FOB destination. */
export const AVALARA_FREIGHT_TAX_CODE = "FR020100";

export const AVALARA_SANDBOX_BASE = "https://sandbox-rest.avatax.com";
export const AVALARA_PRODUCTION_BASE = "https://rest.avatax.com";

export type AvalaraCredentials = {
  /** Account id, or username for a user-credential pair. */
  accountId: string;
  /** License key, or password. */
  licenseKey: string;
  /** Company code configured in the AvaTax account. */
  companyCode: string;
  /** Sandbox until someone deliberately switches it. */
  environment: "sandbox" | "production";
};

export type AvalaraAddress = {
  line1?: string;
  city?: string;
  /** State or province code. */
  region?: string;
  postalCode?: string;
  /** ISO-2. */
  country: string;
};

export type AvalaraQuoteInput = {
  /** Freight charge being taxed, in `currency`. */
  amount: number;
  currency: string;
  shipFrom: AvalaraAddress;
  shipTo: AvalaraAddress;
  /** Load id — carried through so a figure can be traced back. */
  reference: string;
  /** ISO date the tax point falls on. Defaults to today, UTC. */
  date?: string;
  customerCode?: string;
};

export type AvalaraTaxDetail = {
  jurisdictionName: string;
  jurisdictionType: string;
  rate: number;
  tax: number;
  taxName: string;
};

export type AvalaraQuote = {
  totalTax: number;
  totalTaxable: number;
  /** Blended effective rate the provider actually applied. */
  effectiveRate: number;
  details: AvalaraTaxDetail[];
  /** Avalara's own transaction code, for support conversations. */
  transactionCode?: string;
};

/* ------------------------------------------------------------------ *
 * Pure: request
 * ------------------------------------------------------------------ */

export function avalaraBaseUrl(environment: AvalaraCredentials["environment"]): string {
  return environment === "production" ? AVALARA_PRODUCTION_BASE : AVALARA_SANDBOX_BASE;
}

/**
 * HTTP Basic, per AvaTax's documented scheme — `accountId:licenseKey`.
 *
 * `btoa` rather than Buffer: this runs in a Cloudflare Worker, where Buffer is
 * not guaranteed to exist.
 */
export function avalaraAuthHeader(credentials: AvalaraCredentials): string {
  const raw = `${credentials.accountId}:${credentials.licenseKey}`;
  return `Basic ${btoa(raw)}`;
}

export function buildTransactionRequest(
  input: AvalaraQuoteInput,
  companyCode: string,
): Record<string, unknown> {
  return {
    // SalesOrder, never SalesInvoice: an order is a quote and is not filed.
    type: "SalesOrder",
    companyCode,
    date: input.date ?? new Date().toISOString().slice(0, 10),
    customerCode: input.customerCode ?? "TITAN-FREIGHT-ESTIMATE",
    // Explicit, though SalesOrder is uncommittable anyway. Belt and braces on
    // the one flag whose default changing would post to a filing account.
    commit: false,
    currencyCode: input.currency,
    addresses: {
      shipFrom: input.shipFrom,
      shipTo: input.shipTo,
    },
    lines: [
      {
        number: "1",
        quantity: 1,
        amount: input.amount,
        taxCode: AVALARA_FREIGHT_TAX_CODE,
        description: "Freight transportation charge",
      },
    ],
    referenceCode: input.reference,
  };
}

/* ------------------------------------------------------------------ *
 * Pure: response
 * ------------------------------------------------------------------ */

type RawAvalaraResponse = {
  totalTax?: unknown;
  totalTaxable?: unknown;
  code?: unknown;
  lines?: unknown;
};

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/**
 * Map AvaTax's response onto our shape.
 *
 * Defensive throughout. A tax provider adding a field is routine; a page
 * throwing because `taxDetails` arrived as null is not. Anything unreadable
 * becomes zero and the caller sees a zero-tax quote rather than a crash — which
 * is also why the proxy compares the provider figure against the internal
 * estimate before trusting it.
 */
export function parseTransactionResponse(body: unknown): AvalaraQuote {
  const raw = (body ?? {}) as RawAvalaraResponse;
  const totalTax = num(raw.totalTax);
  const totalTaxable = num(raw.totalTaxable);

  const details: AvalaraTaxDetail[] = [];
  const lines = Array.isArray(raw.lines) ? raw.lines : [];
  for (const line of lines) {
    const taxDetails = (line as { details?: unknown })?.details;
    if (!Array.isArray(taxDetails)) continue;
    for (const detail of taxDetails) {
      const entry = detail as Record<string, unknown>;
      details.push({
        jurisdictionName: str(entry.jurisName) || str(entry.jurisdictionName) || "Unknown",
        jurisdictionType: str(entry.jurisdictionType) || str(entry.jurisType) || "",
        rate: num(entry.rate),
        tax: num(entry.tax),
        taxName: str(entry.taxName),
      });
    }
  }

  return {
    totalTax,
    totalTaxable,
    effectiveRate: totalTaxable > 0 ? totalTax / totalTaxable : 0,
    details,
    transactionCode: str(raw.code) || undefined,
  };
}

/* ------------------------------------------------------------------ *
 * Network
 * ------------------------------------------------------------------ */

export type AvalaraFailure = {
  ok: false;
  /** Distinguishes "your key is wrong" from "Avalara is down" — different fixes. */
  code: "unauthorized" | "rejected" | "unreachable" | "malformed";
  message: string;
  status?: number;
};

export type AvalaraResult = ({ ok: true } & AvalaraQuote) | AvalaraFailure;

/** Beyond this, a pricing screen should fall back rather than keep waiting. */
const REQUEST_TIMEOUT_MS = 6_000;

export async function callAvalara(
  credentials: AvalaraCredentials,
  input: AvalaraQuoteInput,
  fetchImpl: typeof fetch = fetch,
): Promise<AvalaraResult> {
  const url = `${avalaraBaseUrl(credentials.environment)}/api/v2/transactions/create`;
  const body = buildTransactionRequest(input, credentials.companyCode);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: "POST",
      headers: {
        Authorization: avalaraAuthHeader(credentials),
        "Content-Type": "application/json",
        Accept: "application/json",
        // Avalara asks integrators to identify themselves; it is how they
        // attribute traffic when you call support about a discrepancy.
        "X-Avalara-Client": "TitanFreightDash;1.0;TypeScript;;",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    return {
      ok: false,
      code: "unreachable",
      message:
        err instanceof Error && err.name === "AbortError"
          ? `AvaTax did not respond within ${REQUEST_TIMEOUT_MS}ms.`
          : "Could not reach AvaTax.",
    };
  } finally {
    clearTimeout(timer);
  }

  if (response.status === 401 || response.status === 403) {
    return {
      ok: false,
      code: "unauthorized",
      status: response.status,
      message:
        "AvaTax rejected the credentials. Check the account id, license key and environment " +
        "in Settings → Integrations.",
    };
  }

  const parsed = (await response.json().catch(() => null)) as unknown;

  if (!response.ok) {
    // Avalara returns a structured error; surface its text because it names the
    // actual problem (an unknown company code, a malformed address).
    const detail =
      (parsed as { error?: { message?: string } })?.error?.message ??
      `AvaTax returned HTTP ${response.status}.`;
    return { ok: false, code: "rejected", status: response.status, message: detail };
  }

  if (!parsed || typeof parsed !== "object") {
    return { ok: false, code: "malformed", message: "AvaTax returned an unreadable response." };
  }

  return { ok: true, ...parseTransactionResponse(parsed) };
}

/**
 * Cheapest call that proves a credential works.
 *
 * `GET /utilities/ping` is authenticated and returns `authenticated: true` only
 * when the credentials resolve, so it distinguishes "key is valid" from "key is
 * present" — which a settings page must do, or a typo reads as connected until
 * the first real load.
 */
export async function pingAvalara(
  credentials: AvalaraCredentials,
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: boolean; authenticated: boolean; message: string }> {
  const url = `${avalaraBaseUrl(credentials.environment)}/api/v2/utilities/ping`;
  try {
    const response = await fetchImpl(url, {
      headers: {
        Authorization: avalaraAuthHeader(credentials),
        Accept: "application/json",
        "X-Avalara-Client": "TitanFreightDash;1.0;TypeScript;;",
      },
    });
    const body = (await response.json().catch(() => null)) as { authenticated?: unknown } | null;
    const authenticated = body?.authenticated === true;
    return {
      ok: response.ok,
      authenticated,
      message: authenticated
        ? "AvaTax credentials verified."
        : `AvaTax reached but not authenticated (HTTP ${response.status}).`,
    };
  } catch {
    return { ok: false, authenticated: false, message: "Could not reach AvaTax." };
  }
}
