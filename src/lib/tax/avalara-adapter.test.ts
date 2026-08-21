import { describe, expect, it, vi } from "vitest";

import {
  AVALARA_FREIGHT_TAX_CODE,
  AVALARA_PRODUCTION_BASE,
  AVALARA_SANDBOX_BASE,
  avalaraAuthHeader,
  avalaraBaseUrl,
  buildTransactionRequest,
  callAvalara,
  parseTransactionResponse,
  pingAvalara,
  type AvalaraCredentials,
  type AvalaraQuoteInput,
} from "@/lib/tax/avalara-adapter";

const CREDENTIALS: AvalaraCredentials = {
  accountId: "2000000000",
  licenseKey: "test-license-key",
  companyCode: "TITAN",
  environment: "sandbox",
};

const INPUT: AvalaraQuoteInput = {
  amount: 2400,
  currency: "USD",
  shipFrom: { city: "Dallas", region: "TX", postalCode: "75201", country: "US" },
  shipTo: { city: "Atlanta", region: "GA", postalCode: "30303", country: "US" },
  reference: "L-2841",
  date: "2026-08-20",
};

/**
 * Shape of a real AvaTax createTransaction response, trimmed to the fields the
 * adapter reads. Recorded from the documented schema — the mapping is what these
 * tests verify, since sandbox credentials need a sales conversation.
 */
const RESPONSE_FIXTURE = {
  id: 123456789,
  code: "abc-123-txn",
  totalAmount: 2400,
  totalTaxable: 2400,
  totalTax: 198,
  lines: [
    {
      lineNumber: "1",
      taxCode: "FR020100",
      taxableAmount: 2400,
      tax: 198,
      details: [
        {
          jurisName: "GEORGIA",
          jurisdictionType: "State",
          taxName: "GA STATE TAX",
          rate: 0.04,
          tax: 96,
        },
        {
          jurisName: "FULTON",
          jurisdictionType: "County",
          taxName: "GA COUNTY TAX",
          rate: 0.03,
          tax: 72,
        },
        {
          jurisName: "ATLANTA",
          jurisdictionType: "City",
          taxName: "GA CITY TAX",
          rate: 0.0125,
          tax: 30,
        },
      ],
    },
  ],
};

describe("request building", () => {
  it("classifies the line as common-carrier freight", () => {
    const body = buildTransactionRequest(INPUT, CREDENTIALS.companyCode);
    const lines = body.lines as Record<string, unknown>[];
    expect(lines[0].taxCode).toBe(AVALARA_FREIGHT_TAX_CODE);
    expect(AVALARA_FREIGHT_TAX_CODE).toBe("FR020100");
  });

  /**
   * The single most important assertion in this file. `SalesInvoice` with
   * `commit: true` posts to the account's filing data — estimating tax on a load
   * a broker is still pricing must never do that.
   */
  it("never commits, and quotes as an order rather than an invoice", () => {
    const body = buildTransactionRequest(INPUT, CREDENTIALS.companyCode);
    expect(body.type).toBe("SalesOrder");
    expect(body.commit).toBe(false);
  });

  it("sends both endpoints as addresses so tax resolves to a rooftop", () => {
    const body = buildTransactionRequest(INPUT, CREDENTIALS.companyCode);
    const addresses = body.addresses as Record<string, Record<string, unknown>>;
    expect(addresses.shipFrom.region).toBe("TX");
    expect(addresses.shipFrom.postalCode).toBe("75201");
    expect(addresses.shipTo.region).toBe("GA");
    expect(addresses.shipTo.postalCode).toBe("30303");
  });

  it("carries the load id so a figure can be traced back", () => {
    expect(buildTransactionRequest(INPUT, "TITAN").referenceCode).toBe("L-2841");
  });

  it("uses the configured company code", () => {
    expect(buildTransactionRequest(INPUT, "OTHERCO").companyCode).toBe("OTHERCO");
  });

  it("defaults the tax point to today when no date is given", () => {
    const body = buildTransactionRequest({ ...INPUT, date: undefined }, "TITAN");
    expect(String(body.date)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("auth and environment", () => {
  it("uses HTTP Basic over accountId:licenseKey", () => {
    const header = avalaraAuthHeader(CREDENTIALS);
    expect(header.startsWith("Basic ")).toBe(true);
    expect(atob(header.slice(6))).toBe("2000000000:test-license-key");
  });

  /** Reaching production has to be deliberate — the default must be sandbox. */
  it("points at sandbox unless production is named explicitly", () => {
    expect(avalaraBaseUrl("sandbox")).toBe(AVALARA_SANDBOX_BASE);
    expect(avalaraBaseUrl("production")).toBe(AVALARA_PRODUCTION_BASE);
    expect(AVALARA_SANDBOX_BASE).toContain("sandbox");
  });
});

describe("response parsing", () => {
  it("reads the total and the per-jurisdiction breakdown", () => {
    const quote = parseTransactionResponse(RESPONSE_FIXTURE);
    expect(quote.totalTax).toBe(198);
    expect(quote.totalTaxable).toBe(2400);
    expect(quote.effectiveRate).toBeCloseTo(0.0825, 6);
    expect(quote.transactionCode).toBe("abc-123-txn");

    expect(quote.details).toHaveLength(3);
    expect(quote.details.map((d) => d.jurisdictionName)).toEqual(["GEORGIA", "FULTON", "ATLANTA"]);
    expect(quote.details[0].rate).toBe(0.04);
  });

  /**
   * A provider adding or renaming a field is routine. A load page throwing
   * because `details` arrived as null is not — so every read is defensive and
   * degrades to zero rather than to an exception.
   */
  it.each([
    ["null", null],
    ["a string", "nope"],
    ["an empty object", {}],
    ["lines that are not an array", { totalTax: 5, lines: "x" }],
    ["a line with no details", { totalTax: 5, lines: [{ lineNumber: "1" }] }],
    ["details that are null", { totalTax: 5, lines: [{ details: null }] }],
  ])("survives %s", (_label, body) => {
    const quote = parseTransactionResponse(body);
    expect(Number.isFinite(quote.totalTax)).toBe(true);
    expect(Array.isArray(quote.details)).toBe(true);
  });

  it("does not divide by zero when nothing is taxable", () => {
    expect(parseTransactionResponse({ totalTax: 0, totalTaxable: 0 }).effectiveRate).toBe(0);
  });

  it("accepts the alternate jurisdiction field names AvaTax uses", () => {
    const quote = parseTransactionResponse({
      totalTax: 10,
      totalTaxable: 100,
      lines: [{ details: [{ jurisdictionName: "TEXAS", jurisType: "State", rate: 0.1, tax: 10 }] }],
    });
    expect(quote.details[0].jurisdictionName).toBe("TEXAS");
    expect(quote.details[0].jurisdictionType).toBe("State");
  });
});

describe("callAvalara", () => {
  function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }

  it("returns a quote on success and hits the sandbox transactions endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(RESPONSE_FIXTURE));
    const result = await callAvalara(CREDENTIALS, INPUT, fetchMock as unknown as typeof fetch);

    expect(result.ok).toBe(true);
    expect(result.ok && result.totalTax).toBe(198);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${AVALARA_SANDBOX_BASE}/api/v2/transactions/create`);
    expect((init as RequestInit).method).toBe("POST");
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toContain("Basic ");
    expect(headers["X-Avalara-Client"]).toContain("TitanFreightDash");
  });

  /** A bad key and an outage need different fixes, so they get different codes. */
  it("distinguishes a rejected credential from an outage", async () => {
    const unauthorized = await callAvalara(
      CREDENTIALS,
      INPUT,
      vi.fn().mockResolvedValue(jsonResponse({}, 401)) as unknown as typeof fetch,
    );
    expect(unauthorized.ok).toBe(false);
    expect(!unauthorized.ok && unauthorized.code).toBe("unauthorized");

    const down = await callAvalara(
      CREDENTIALS,
      INPUT,
      vi.fn().mockRejectedValue(new Error("ECONNREFUSED")) as unknown as typeof fetch,
    );
    expect(!down.ok && down.code).toBe("unreachable");
  });

  it("surfaces AvaTax's own error text, which names the actual problem", async () => {
    const result = await callAvalara(
      CREDENTIALS,
      INPUT,
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse({ error: { message: "CompanyCode 'TITAN' was not found." } }, 400),
        ) as unknown as typeof fetch,
    );
    expect(!result.ok && result.code).toBe("rejected");
    expect(!result.ok && result.message).toContain("CompanyCode");
  });

  it("reports unreadable bodies rather than throwing", async () => {
    const result = await callAvalara(
      CREDENTIALS,
      INPUT,
      vi.fn().mockResolvedValue(new Response("<html>", { status: 200 })) as unknown as typeof fetch,
    );
    expect(!result.ok && result.code).toBe("malformed");
  });
});

describe("pingAvalara", () => {
  /**
   * A settings page must distinguish "a key is present" from "the key works", or
   * a typo reads as connected until the first real load.
   */
  it("only reports success when AvaTax says authenticated", async () => {
    const good = await pingAvalara(
      CREDENTIALS,
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ authenticated: true }), { status: 200 }),
        ) as unknown as typeof fetch,
    );
    expect(good.authenticated).toBe(true);

    const bad = await pingAvalara(
      CREDENTIALS,
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ authenticated: false }), { status: 200 }),
        ) as unknown as typeof fetch,
    );
    expect(bad.authenticated).toBe(false);
    expect(bad.message).toContain("not authenticated");
  });

  it("reports unreachable rather than throwing", async () => {
    const result = await pingAvalara(
      CREDENTIALS,
      vi.fn().mockRejectedValue(new Error("nope")) as unknown as typeof fetch,
    );
    expect(result.ok).toBe(false);
    expect(result.authenticated).toBe(false);
  });
});
