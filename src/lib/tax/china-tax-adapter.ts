/**
 * China tax API adapter — invoice verification (发票查验).
 *
 * ## What a China tax API is actually for
 *
 * Not the rate. China's VAT rates are statutory — 9% transportation, 6%
 * logistics auxiliary, 3% small-scale levy — and no API knows them better than
 * the statute does. `tax-domain` already computes that arithmetic exactly.
 *
 * What an API can tell you, and statute cannot, is whether a *specific invoice
 * is real*. That matters here more than anywhere else in the app, because the
 * single largest driver of tax cost on a brokered Chinese load is whether the
 * carrier issued a valid special VAT invoice (增值税专用发票). With one, a
 * ¥10,000 / ¥8,000 load costs about ¥185 in tax. Without, ¥925. Today that is a
 * workspace *setting* — an assumption. Verification turns it into a fact, per
 * invoice, against the State Taxation Administration's own records.
 *
 * That is why this adapter verifies rather than calculates.
 *
 * ## Why a provider and not the STA directly
 *
 * The STA's national verification platform (inv-veri.chinatax.gov.cn) is a
 * captcha-gated web form with no public API. Every option below wraps it. There
 * is no first-party endpoint to integrate against.
 *
 * ## Two auth styles, because that is what the market offers
 *
 * `aliyun-market` uses a single `APPCODE` header — self-serve, buy it on the
 * Alibaba Cloud marketplace, no Chinese entity needed beyond an Aliyun account.
 * `juhe` passes a key as a query parameter. Both are simple enough to implement
 * correctly without credentials; the signed-request providers (Tencent's
 * TC3-HMAC-SHA256, Baidu's OAuth token exchange) are deliberately left out
 * rather than implemented blind.
 */

export type ChinaTaxProviderId = "aliyun-market" | "juhe" | "custom";

export type ChinaTaxCredentials = {
  provider: ChinaTaxProviderId;
  /** APPCODE, or the provider's key. */
  apiKey: string;
  /** Required for `custom`; overrides the preset endpoint otherwise. */
  endpoint?: string;
};

/**
 * The six elements the STA platform requires.
 *
 * Fewer will not verify: the tax authority deliberately requires details only
 * the holder of the physical or digital invoice can supply, so the API cannot be
 * used to enumerate invoices.
 */
export type InvoiceVerificationRequest = {
  /** 发票代码 — blank on fully-digital invoices, which carry only a number. */
  invoiceCode?: string;
  /** 发票号码 */
  invoiceNumber: string;
  /** 开票日期, YYYY-MM-DD or YYYYMMDD depending on provider. */
  invoiceDate: string;
  /** 校验码 — last 6 digits, for general invoices. */
  checkCode?: string;
  /** 不含税金额 — required for special VAT invoices instead of the check code. */
  amountExcludingTax?: string;
  /** 发票种类, provider-specific coding. */
  invoiceType?: string;
};

export type VerifiedInvoice = {
  /** The authority's verdict. `unknown` when the provider answered but was unclear. */
  status: "valid" | "invalid" | "not-found" | "unknown";
  /**
   * True only for 增值税专用发票 — the type that carries an input credit.
   * A valid *general* invoice (普通发票) is a real invoice that credits nothing,
   * and conflating the two is how a broker overstates its recoverable VAT.
   */
  isSpecialVatInvoice: boolean;
  sellerName?: string;
  buyerName?: string;
  totalAmount?: number;
  taxAmount?: number;
  amountExcludingTax?: number;
  invoiceDate?: string;
  /** Provider's own message, surfaced verbatim — it names the actual problem. */
  message: string;
  provider: ChinaTaxProviderId;
};

export type ChinaTaxFailure = {
  ok: false;
  code: "unauthorized" | "quota" | "rejected" | "unreachable" | "malformed" | "not-configured";
  message: string;
};

export type ChinaTaxResult = ({ ok: true } & VerifiedInvoice) | ChinaTaxFailure;

/** Endpoints the presets point at. Overridable, because marketplace paths change. */
export const CHINA_TAX_ENDPOINTS: Record<Exclude<ChinaTaxProviderId, "custom">, string> = {
  "aliyun-market": "https://fpcy.market.alicloudapi.com/invoice/query",
  // https, not the http form Juhe also documents: the key travels in the query
  // string here, so clear text would put a metered credential on the wire.
  juhe: "https://v.juhe.cn/invoice/query",
};

const REQUEST_TIMEOUT_MS = 8_000;

/* ------------------------------------------------------------------ *
 * Pure: invoice type classification
 * ------------------------------------------------------------------ */

/**
 * Does this invoice type carry an input VAT credit?
 *
 * Only the special VAT invoice does. The check is on the Chinese type name
 * because that is what every provider returns, and matching on 专用 is more
 * durable than matching a numeric code that differs per vendor.
 *
 * `电子发票（增值税专用发票）` — the fully-digital special invoice mandatory since
 * December 2024 — also matches, which is the point.
 */
export function carriesInputCredit(invoiceTypeName: string | undefined): boolean {
  if (!invoiceTypeName) return false;
  const name = invoiceTypeName.trim();
  if (!name) return false;
  // 专用发票 in any wrapper. Excludes 普通发票, 卷式发票, 电子普通发票.
  if (name.includes("专用")) return true;
  // Some providers return the English form.
  return /special\s*vat/i.test(name);
}

/* ------------------------------------------------------------------ *
 * Pure: request
 * ------------------------------------------------------------------ */

export function buildVerificationUrl(
  credentials: ChinaTaxCredentials,
  request: InvoiceVerificationRequest,
): { url: string; headers: Record<string, string> } {
  const endpoint =
    credentials.endpoint?.trim() ||
    (credentials.provider === "custom"
      ? ""
      : CHINA_TAX_ENDPOINTS[credentials.provider as Exclude<ChinaTaxProviderId, "custom">]);

  const params = new URLSearchParams();
  if (request.invoiceCode) params.set("fpdm", request.invoiceCode);
  params.set("fphm", request.invoiceNumber);
  params.set("kprq", request.invoiceDate.replace(/-/g, ""));
  if (request.checkCode) params.set("jym", request.checkCode);
  if (request.amountExcludingTax) params.set("kjje", request.amountExcludingTax);
  if (request.invoiceType) params.set("fplx", request.invoiceType);

  if (credentials.provider === "juhe") {
    // Juhe takes the key as a query parameter rather than a header.
    params.set("key", credentials.apiKey);
    return { url: `${endpoint}?${params.toString()}`, headers: { Accept: "application/json" } };
  }

  return {
    url: `${endpoint}?${params.toString()}`,
    headers: {
      // Alibaba Cloud marketplace scheme. The space after APPCODE is required.
      Authorization: `APPCODE ${credentials.apiKey}`,
      Accept: "application/json",
    },
  };
}

/* ------------------------------------------------------------------ *
 * Pure: response
 * ------------------------------------------------------------------ */

function num(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value.replace(/[^0-9.-]/g, ""));
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/**
 * Normalize whichever shape a provider returns.
 *
 * Chinese invoice APIs are not standardized: field names arrive as pinyin
 * abbreviations (`xfmc`, `gfmc`, `jshj`), as full pinyin, or occasionally in
 * English, and the payload may be nested under `result`, `data`, or neither.
 * Rather than one adapter per vendor, this reads a union of the names actually
 * used and reports `unknown` when it cannot tell — which the caller treats as
 * "not verified" rather than "invalid".
 */
export function parseVerificationResponse(
  body: unknown,
  provider: ChinaTaxProviderId,
): VerifiedInvoice {
  const root = (body ?? {}) as Record<string, unknown>;
  const payload = ((root.result ?? root.data ?? root) || {}) as Record<string, unknown>;

  const typeName =
    str(payload.fplx_name) ??
    str(payload.invoiceTypeName) ??
    str(payload.fplxName) ??
    str(payload.fplx) ??
    str(payload.invoiceType);

  // Providers signal success in several ways. Absence of a positive signal is
  // treated as unknown, never as valid.
  const errorCode = root.error_code ?? root.errorCode ?? root.code;
  const explicitlyOk =
    errorCode === 0 || errorCode === "0" || root.success === true || payload.status === "1";

  const notFound =
    /查无此票|not\s*found|无此发票/i.test(String(root.reason ?? root.message ?? "")) ||
    payload.status === "0";

  let status: VerifiedInvoice["status"] = "unknown";
  if (notFound) status = "not-found";
  else if (explicitlyOk) status = "valid";
  else if (errorCode !== undefined && errorCode !== 0 && errorCode !== "0") status = "invalid";

  return {
    status,
    // Only asserted on a positive verdict: an unverified invoice must never be
    // reported as credit-bearing, because that would overstate recoverable VAT.
    isSpecialVatInvoice: status === "valid" && carriesInputCredit(typeName),
    sellerName: str(payload.xfmc) ?? str(payload.sellerName) ?? str(payload.saleName),
    buyerName: str(payload.gfmc) ?? str(payload.buyerName) ?? str(payload.purchaserName),
    totalAmount: num(payload.jshj) ?? num(payload.totalAmount),
    taxAmount: num(payload.se) ?? num(payload.taxAmount) ?? num(payload.totalTax),
    amountExcludingTax: num(payload.je) ?? num(payload.amountExcludingTax) ?? num(payload.kjje),
    invoiceDate: str(payload.kprq) ?? str(payload.invoiceDate),
    message:
      str(root.reason) ??
      str(root.message) ??
      (status === "valid"
        ? "Invoice verified against tax authority records."
        : "No verdict returned."),
    provider,
  };
}

/* ------------------------------------------------------------------ *
 * Network
 * ------------------------------------------------------------------ */

export async function verifyChineseInvoice(
  credentials: ChinaTaxCredentials,
  request: InvoiceVerificationRequest,
  fetchImpl: typeof fetch = fetch,
): Promise<ChinaTaxResult> {
  if (!credentials.apiKey.trim()) {
    return { ok: false, code: "not-configured", message: "No China tax API key configured." };
  }
  const { url, headers } = buildVerificationUrl(credentials, request);
  if (!url || url.startsWith("?")) {
    return {
      ok: false,
      code: "not-configured",
      message: "No endpoint configured for the custom China tax provider.",
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetchImpl(url, { headers, signal: controller.signal });
  } catch (err) {
    return {
      ok: false,
      code: "unreachable",
      message:
        err instanceof Error && err.name === "AbortError"
          ? `The invoice verification API did not respond within ${REQUEST_TIMEOUT_MS}ms.`
          : "Could not reach the invoice verification API.",
    };
  } finally {
    clearTimeout(timer);
  }

  if (response.status === 401 || response.status === 403) {
    return {
      ok: false,
      code: "unauthorized",
      message:
        "The invoice verification API rejected the key. Check it in Settings → Integrations.",
    };
  }
  if (response.status === 429) {
    // Worth its own code: these APIs cap queries per invoice per day, so this is
    // a wait-and-retry rather than a misconfiguration.
    return {
      ok: false,
      code: "quota",
      message:
        "Verification quota exhausted. These APIs cap queries per invoice per day — try again later.",
    };
  }

  const parsed = (await response.json().catch(() => null)) as unknown;
  if (!parsed || typeof parsed !== "object") {
    return {
      ok: false,
      code: "malformed",
      message: "The invoice verification API returned an unreadable response.",
    };
  }
  if (!response.ok) {
    return {
      ok: false,
      code: "rejected",
      message:
        str((parsed as Record<string, unknown>).reason) ??
        `The verification API returned HTTP ${response.status}.`,
    };
  }

  return { ok: true, ...parseVerificationResponse(parsed, credentials.provider) };
}
