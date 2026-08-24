import { describe, expect, it, vi } from "vitest";

import {
  CHINA_TAX_ENDPOINTS,
  buildVerificationUrl,
  carriesInputCredit,
  parseVerificationResponse,
  verifyChineseInvoice,
  type ChinaTaxCredentials,
  type InvoiceVerificationRequest,
} from "@/lib/tax/china-tax-adapter";

const ALIYUN: ChinaTaxCredentials = { provider: "aliyun-market", apiKey: "APPCODE123" };
const JUHE: ChinaTaxCredentials = { provider: "juhe", apiKey: "juhekey" };

const REQUEST: InvoiceVerificationRequest = {
  invoiceCode: "011001900111",
  invoiceNumber: "12345678",
  invoiceDate: "2026-07-15",
  amountExcludingTax: "8000.00",
  invoiceType: "special",
};

describe("carriesInputCredit", () => {
  /**
   * The distinction the whole integration exists to make. A *valid* general
   * invoice is a real invoice that credits nothing — treating it as creditable
   * would overstate recoverable VAT by the full 9%.
   */
  it("is true only for a special VAT invoice", () => {
    expect(carriesInputCredit("增值税专用发票")).toBe(true);
    expect(carriesInputCredit("电子发票（增值税专用发票）")).toBe(true);
    expect(carriesInputCredit("Special VAT Invoice")).toBe(true);

    expect(carriesInputCredit("增值税普通发票")).toBe(false);
    expect(carriesInputCredit("电子发票（普通发票）")).toBe(false);
    expect(carriesInputCredit("增值税电子普通发票")).toBe(false);
    expect(carriesInputCredit("卷式发票")).toBe(false);
  });

  it("is false for absent or empty input rather than defaulting true", () => {
    expect(carriesInputCredit(undefined)).toBe(false);
    expect(carriesInputCredit("")).toBe(false);
    expect(carriesInputCredit("   ")).toBe(false);
  });
});

describe("buildVerificationUrl", () => {
  it("sends the STA's element names and strips date separators", () => {
    const { url } = buildVerificationUrl(ALIYUN, REQUEST);
    const params = new URL(url).searchParams;
    expect(params.get("fpdm")).toBe("011001900111");
    expect(params.get("fphm")).toBe("12345678");
    expect(params.get("kprq")).toBe("20260715");
    expect(params.get("kjje")).toBe("8000.00");
  });

  it("uses the APPCODE header for the Alibaba Cloud marketplace", () => {
    const { url, headers } = buildVerificationUrl(ALIYUN, REQUEST);
    expect(url.startsWith(CHINA_TAX_ENDPOINTS["aliyun-market"])).toBe(true);
    expect(headers.Authorization).toBe("APPCODE APPCODE123");
    // The key must not also leak into the query string.
    expect(new URL(url).searchParams.get("key")).toBeNull();
  });

  it("passes the key as a query parameter for Juhe, and never as a header", () => {
    const { url, headers } = buildVerificationUrl(JUHE, REQUEST);
    expect(new URL(url).searchParams.get("key")).toBe("juhekey");
    expect(headers.Authorization).toBeUndefined();
  });

  /** A key in a query string over http would be readable in transit. */
  it("uses https for every preset endpoint", () => {
    for (const endpoint of Object.values(CHINA_TAX_ENDPOINTS)) {
      expect(endpoint.startsWith("https://"), endpoint).toBe(true);
    }
  });

  it("omits the invoice code for a fully-digital invoice, which has none", () => {
    const { url } = buildVerificationUrl(ALIYUN, { ...REQUEST, invoiceCode: undefined });
    expect(new URL(url).searchParams.has("fpdm")).toBe(false);
    expect(new URL(url).searchParams.get("fphm")).toBe("12345678");
  });

  it("honours a custom endpoint override", () => {
    const { url } = buildVerificationUrl(
      { provider: "custom", apiKey: "k", endpoint: "https://tax.example.com/verify" },
      REQUEST,
    );
    expect(url.startsWith("https://tax.example.com/verify?")).toBe(true);
  });
});

describe("parseVerificationResponse", () => {
  it("reads a Juhe-style success envelope", () => {
    const result = parseVerificationResponse(
      {
        error_code: 0,
        reason: "查询成功",
        result: {
          fplx_name: "增值税专用发票",
          xfmc: "上海某物流有限公司",
          gfmc: "深圳某贸易有限公司",
          jshj: "8720.00",
          se: "720.00",
          je: "8000.00",
          kprq: "20260715",
        },
      },
      "juhe",
    );

    expect(result.status).toBe("valid");
    expect(result.isSpecialVatInvoice).toBe(true);
    expect(result.sellerName).toBe("上海某物流有限公司");
    expect(result.taxAmount).toBe(720);
    expect(result.amountExcludingTax).toBe(8000);
    expect(result.provider).toBe("juhe");
  });

  it("marks a valid general invoice as valid but not creditable", () => {
    const result = parseVerificationResponse(
      { error_code: 0, result: { fplx_name: "增值税普通发票", je: "8000.00" } },
      "aliyun-market",
    );
    expect(result.status).toBe("valid");
    expect(result.isSpecialVatInvoice).toBe(false);
  });

  it("recognizes a not-found verdict", () => {
    const result = parseVerificationResponse({ error_code: 1, reason: "查无此票" }, "juhe");
    expect(result.status).toBe("not-found");
    expect(result.isSpecialVatInvoice).toBe(false);
  });

  /**
   * The failure that would cost money: an unclear response must never read as
   * creditable, because that overstates the input credit and understates tax.
   */
  it("never claims creditability on an unclear response", () => {
    for (const body of [
      null,
      {},
      "nope",
      { result: {} },
      { data: { fplx_name: "增值税专用发票" } },
    ]) {
      const result = parseVerificationResponse(body, "aliyun-market");
      if (result.status !== "valid") {
        expect(result.isSpecialVatInvoice, JSON.stringify(body)).toBe(false);
      }
    }
  });

  it("reports unknown rather than valid when nothing signals success", () => {
    expect(
      parseVerificationResponse({ result: { fplx_name: "增值税专用发票" } }, "juhe").status,
    ).toBe("unknown");
  });

  it("accepts a flat payload with no result wrapper", () => {
    const result = parseVerificationResponse(
      { success: true, invoiceTypeName: "增值税专用发票", sellerName: "ACME", totalAmount: 100 },
      "custom",
    );
    expect(result.status).toBe("valid");
    expect(result.isSpecialVatInvoice).toBe(true);
    expect(result.sellerName).toBe("ACME");
  });
});

describe("verifyChineseInvoice", () => {
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });

  it("refuses to call without a key", async () => {
    const result = await verifyChineseInvoice(
      { provider: "aliyun-market", apiKey: "  " },
      REQUEST,
      vi.fn() as unknown as typeof fetch,
    );
    expect(result.ok).toBe(false);
    expect(!result.ok && result.code).toBe("not-configured");
  });

  it("refuses a custom provider with no endpoint", async () => {
    const result = await verifyChineseInvoice(
      { provider: "custom", apiKey: "k" },
      REQUEST,
      vi.fn() as unknown as typeof fetch,
    );
    expect(!result.ok && result.code).toBe("not-configured");
  });

  it("returns a verdict on success", async () => {
    const result = await verifyChineseInvoice(
      ALIYUN,
      REQUEST,
      vi
        .fn()
        .mockResolvedValue(
          json({ error_code: 0, result: { fplx_name: "增值税专用发票" } }),
        ) as unknown as typeof fetch,
    );
    expect(result.ok).toBe(true);
    expect(result.ok && result.isSpecialVatInvoice).toBe(true);
  });

  /**
   * Quota gets its own code because the fix is different: these APIs cap queries
   * per invoice per day, so it is wait-and-retry rather than reconfigure.
   */
  it("distinguishes a bad key, exhausted quota, and an outage", async () => {
    const unauthorized = await verifyChineseInvoice(
      ALIYUN,
      REQUEST,
      vi.fn().mockResolvedValue(json({}, 403)) as unknown as typeof fetch,
    );
    expect(!unauthorized.ok && unauthorized.code).toBe("unauthorized");

    const quota = await verifyChineseInvoice(
      ALIYUN,
      REQUEST,
      vi.fn().mockResolvedValue(json({}, 429)) as unknown as typeof fetch,
    );
    expect(!quota.ok && quota.code).toBe("quota");

    const down = await verifyChineseInvoice(
      ALIYUN,
      REQUEST,
      vi.fn().mockRejectedValue(new Error("ETIMEDOUT")) as unknown as typeof fetch,
    );
    expect(!down.ok && down.code).toBe("unreachable");
  });

  it("reports an unreadable body rather than throwing", async () => {
    const result = await verifyChineseInvoice(
      ALIYUN,
      REQUEST,
      vi.fn().mockResolvedValue(new Response("<html>", { status: 200 })) as unknown as typeof fetch,
    );
    expect(!result.ok && result.code).toBe("malformed");
  });
});
