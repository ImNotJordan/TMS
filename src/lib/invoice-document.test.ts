import { describe, expect, it } from "vitest";

import type { InvoiceRecord } from "./accounting-store";
import {
  accountingAmount,
  invoiceDocumentFilename,
  invoiceReconciliation,
} from "./invoice-document";

function invoice(over: Partial<InvoiceRecord> = {}): InvoiceRecord {
  return {
    invoiceId: "INV-L-1001",
    loadId: "L-1001",
    customer: "Acme Foods",
    lane: "Dallas, TX → Memphis, TN",
    status: "sent",
    lines: [
      { id: "linehaul", kind: "linehaul", label: "Linehaul", amount: 2850 },
      { id: "fuel", kind: "fuel", label: "Fuel surcharge", amount: 415.5 },
    ],
    subtotal: 3265.5,
    tax: 0,
    total: 3265.5,
    remitTo: "Titan Freight LLC",
    terms: "Net 30",
    podOnFile: true,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    ...over,
  } as InvoiceRecord;
}

describe("accountingAmount", () => {
  it("always shows two decimals", () => {
    expect(accountingAmount(2850)).toBe("2,850.00");
    expect(accountingAmount(0)).toBe("0.00");
    expect(accountingAmount(0.5)).toBe("0.50");
  });

  it("puts negatives in parentheses, not behind a minus sign", () => {
    // A leading minus is easy to lose to a fax or a photocopy; the bracket is what
    // an AP clerk reads. A credit misread as a charge is a dispute.
    expect(accountingAmount(-150)).toBe("(150.00)");
    expect(accountingAmount(-1250.5)).toBe("(1,250.50)");
  });

  it("does not render NaN onto a financial document", () => {
    expect(accountingAmount(Number.NaN)).toBe("0.00");
    expect(accountingAmount(Infinity)).toBe("0.00");
  });
});

describe("invoiceReconciliation — INV-1 checked at presentation", () => {
  it("reconciles when the lines sum to the total", () => {
    const r = invoiceReconciliation(invoice());
    expect(r.reconciles).toBe(true);
    expect(r.lineSum).toBe(3265.5);
    expect(r.difference).toBe(0);
  });

  it("catches a one-cent discrepancy", () => {
    // The variance an AP system rejects an invoice over, and the one the UI used
    // to hide by rendering at zero decimal places.
    const r = invoiceReconciliation(invoice({ total: 3265.51 }));
    expect(r.reconciles).toBe(false);
    expect(r.difference).toBe(0.01);
  });

  it("compares in integer cents, so float drift cannot defeat the check", () => {
    // 0.1 + 0.2 !== 0.3 in binary floating point. Comparing the floats directly
    // would make this check a victim of the drift it exists to catch.
    const r = invoiceReconciliation(
      invoice({
        lines: [
          { id: "a", kind: "linehaul", label: "a", amount: 0.1 },
          { id: "b", kind: "fuel", label: "b", amount: 0.2 },
        ],
        total: 0.3,
      }),
    );
    expect(r.reconciles).toBe(true);
  });

  it("does not reconcile an empty invoice with a non-zero total", () => {
    const r = invoiceReconciliation(invoice({ lines: [], total: 3265.5 }));
    expect(r.reconciles).toBe(false);
    expect(r.lineSum).toBe(0);
  });

  it("handles credits, which reduce the sum", () => {
    const r = invoiceReconciliation(
      invoice({
        lines: [
          { id: "linehaul", kind: "linehaul", label: "Linehaul", amount: 2400 },
          { id: "credit", kind: "credit", label: "Credit", amount: -150 },
        ],
        total: 2250,
      }),
    );
    expect(r.reconciles).toBe(true);
  });
});

describe("invoiceDocumentFilename", () => {
  it("produces something a person can find later", () => {
    expect(invoiceDocumentFilename(invoice())).toBe("INV-L-1001-acme-foods");
  });

  it("survives a customer name that is punctuation", () => {
    expect(invoiceDocumentFilename(invoice({ customer: "!!!" }))).toBe("INV-L-1001");
    expect(invoiceDocumentFilename(invoice({ customer: "" }))).toBe("INV-L-1001-customer");
  });
});
