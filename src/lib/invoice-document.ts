/**
 * Presentation rules for the invoice document.
 *
 * Kept out of the component so they can be tested without a renderer, and reused
 * when the same document is produced server-side for emailing.
 */
import type { InvoiceRecord } from "@/lib/accounting-store";

/**
 * An amount in accounting convention: two decimals always, negatives in
 * parentheses rather than with a leading minus.
 *
 * Parentheses are not decoration. On a printed statement a leading minus is easy
 * to miss and trivial to lose to a bad fax or a photocopy; the bracket is the
 * convention every AP clerk reads, and a credit misread as a charge is a dispute.
 */
export function accountingAmount(value: number): string {
  const n = Number.isFinite(value) ? value : 0;
  const body = new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Math.abs(n));
  return n < 0 ? `(${body})` : body;
}

export type InvoiceReconciliation = {
  reconciles: boolean;
  /** Σ line items, rounded to the cent. */
  lineSum: number;
  /** `total − lineSum`, rounded to the cent. Zero when it reconciles. */
  difference: number;
};

/** Cents, as an integer, so the comparison is not itself a float comparison. */
function cents(value: number): number {
  return Math.round((Number.isFinite(value) ? value : 0) * 100);
}

/**
 * Does the stored total equal the sum of the line items?
 *
 * INV-1 from the Controller's brief, checked at the moment of presentation rather
 * than trusted. The document withholds a total it cannot justify — printing a
 * stored figure that disagrees with the lines beneath it is how a customer's AP
 * finds an error we did not.
 *
 * Compared in integer cents. Comparing the floats directly would make this check
 * a victim of the very drift it exists to catch.
 */
export function invoiceReconciliation(
  invoice: Pick<InvoiceRecord, "lines" | "total">,
): InvoiceReconciliation {
  const lineSum = invoice.lines.reduce((sum, line) => sum + cents(line.amount), 0);
  const total = cents(invoice.total);
  const diff = total - lineSum;
  return {
    reconciles: diff === 0,
    lineSum: lineSum / 100,
    difference: diff / 100,
  };
}

/** A filename a person can find later: `INV-L-1001-acme-foods.pdf`. */
export function invoiceDocumentFilename(invoice: Pick<InvoiceRecord, "invoiceId" | "customer">) {
  const slug = (invoice.customer || "customer")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  return `${invoice.invoiceId}${slug ? `-${slug}` : ""}`;
}
