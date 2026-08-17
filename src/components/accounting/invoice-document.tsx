/**
 * The invoice as a document — what the customer actually receives.
 *
 * Until now "Generate & send invoice" set a status and saved a row. Nothing was
 * rendered and nothing was transmitted, so an invoice marked `sent` had never left
 * the building. This is the missing artifact.
 *
 * ## Print, not a PDF library
 *
 * The browser's own print-to-PDF is the output path. That is a deliberate choice
 * over adding `jspdf` or a headless renderer:
 *
 * - No new dependency, and no second layout engine to keep in step with the UI.
 * - The document is HTML, so what is printed is the same markup and the same
 *   formatting helpers as the screen — there is no separate template to drift.
 * - When emailing and the document packet arrive, this same component can be
 *   rendered server-side; a canvas-drawing PDF library could not be.
 *
 * ## Reconciliation is shown, not assumed
 *
 * Per the Controller's rule: if the line items do not sum to the stored total, the
 * document refuses to present the stored total as fact. A financial document that
 * quietly prints a number it cannot justify is worse than one that fails to print.
 */
import * as React from "react";

import type { InvoiceRecord } from "@/lib/accounting-store";
import { accountingAmount, invoiceReconciliation } from "@/lib/invoice-document";

export type InvoiceDocumentProps = {
  invoice: InvoiceRecord;
  /** The issuing brokerage. Falls back to the invoice's own remit-to block. */
  issuer?: { name?: string; address?: string };
  /** POD / BOL references that travel with the invoice packet. */
  packetRefs?: string[];
};

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="mt-0.5 text-sm text-foreground">{value}</div>
    </div>
  );
}

export function InvoiceDocument({ invoice, issuer, packetRefs = [] }: InvoiceDocumentProps) {
  const recon = invoiceReconciliation(invoice);
  const number = invoice.invoiceId;

  return (
    <article className="invoice-document mx-auto w-full max-w-[8.5in] bg-white p-10 text-black">
      <header className="flex items-start justify-between gap-8 border-b-2 border-black/80 pb-5">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">INVOICE</h1>
          <div className="mt-1 font-mono text-sm">{number}</div>
          {invoice.revisionOf ? (
            <div className="mt-1 text-xs">
              Revision {invoice.revision ?? 2} of{" "}
              <span className="font-mono">{invoice.revisionOf}</span>
              {invoice.revisionReason ? ` — ${invoice.revisionReason}` : null}
            </div>
          ) : null}
        </div>
        <div className="text-right text-sm">
          <div className="font-semibold">{issuer?.name ?? "Remit to"}</div>
          <div className="mt-0.5 whitespace-pre-line text-xs leading-relaxed">
            {issuer?.address ?? invoice.remitTo}
          </div>
        </div>
      </header>

      <section className="grid grid-cols-2 gap-6 border-b border-black/20 py-5 sm:grid-cols-4">
        <Field label="Bill to" value={invoice.customer} />
        <Field label="Load" value={<span className="font-mono">{invoice.loadId}</span>} />
        <Field label="Lane" value={invoice.lane} />
        <Field label="Terms" value={invoice.terms} />
        <Field label="Issued" value={invoice.issuedAt?.slice(0, 10) ?? "—"} />
        <Field label="Due" value={invoice.dueAt?.slice(0, 10) ?? "—"} />
        {invoice.rateConRef ? (
          <Field label="Rate confirmation" value={<span className="font-mono">{invoice.rateConRef}</span>} />
        ) : null}
        {invoice.carrier ? <Field label="Carrier" value={invoice.carrier} /> : null}
      </section>

      <table className="mt-6 w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-black/40 text-left">
            <th className="pb-2 text-[10px] font-semibold uppercase tracking-wide">Description</th>
            <th className="pb-2 text-right text-[10px] font-semibold uppercase tracking-wide">
              Amount (USD)
            </th>
          </tr>
        </thead>
        <tbody>
          {/* Every line is printed. A document that silently omits a $400
              accessorial is the exact failure this exists to prevent. */}
          {invoice.lines.map((line) => (
            <tr key={line.id} className="border-b border-black/10">
              <td className="py-2 pr-4">{line.label}</td>
              <td className="py-2 text-right font-mono tabular-nums">
                {accountingAmount(line.amount)}
              </td>
            </tr>
          ))}
          {invoice.lines.length === 0 ? (
            <tr>
              <td colSpan={2} className="py-4 text-center text-xs italic">
                This invoice has no line items.
              </td>
            </tr>
          ) : null}
        </tbody>
        <tfoot>
          <tr>
            <td className="pt-3 text-right text-xs">Subtotal</td>
            <td className="pt-3 text-right font-mono tabular-nums">
              {accountingAmount(invoice.subtotal)}
            </td>
          </tr>
          {invoice.tax ? (
            <tr>
              <td className="text-right text-xs">Tax</td>
              <td className="text-right font-mono tabular-nums">
                {accountingAmount(invoice.tax)}
              </td>
            </tr>
          ) : null}
          <tr className="border-t-2 border-black/80">
            <td className="pt-2 text-right text-sm font-bold">Total due</td>
            <td className="pt-2 text-right font-mono text-base font-bold tabular-nums">
              {recon.reconciles ? accountingAmount(invoice.total) : "—"}
            </td>
          </tr>
        </tfoot>
      </table>

      {!recon.reconciles ? (
        <p
          role="alert"
          className="mt-4 rounded border-2 border-red-700 bg-red-50 p-3 text-sm font-semibold text-red-800"
        >
          This invoice does not reconcile and cannot be issued. Line items total{" "}
          {accountingAmount(recon.lineSum)}, the stored total is{" "}
          {accountingAmount(invoice.total)}, a difference of{" "}
          {accountingAmount(recon.difference)}. The total has been withheld rather than
          printed.
        </p>
      ) : null}

      {packetRefs.length > 0 ? (
        <section className="mt-6 border-t border-black/20 pt-4">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Supporting documents
          </div>
          <ul className="mt-1 list-inside list-disc font-mono text-xs">
            {packetRefs.map((ref) => (
              <li key={ref}>{ref}</li>
            ))}
          </ul>
        </section>
      ) : null}

      <footer className="mt-8 border-t border-black/20 pt-4 text-[11px] leading-relaxed">
        <div className="whitespace-pre-line">
          <span className="font-semibold">Remit to:</span> {invoice.remitTo}
        </div>
        <div className="mt-1">
          Payment terms {invoice.terms}. Reference {number} on all remittances.
        </div>
      </footer>
    </article>
  );
}
