/**
 * The printable invoice: `/invoices/<invoiceId>/print`.
 *
 * A standalone page rather than a modal so the browser prints the document and
 * nothing else — no sidebar, no nav, no dialog chrome to fight with a print
 * stylesheet. "Save as PDF" in the print dialog produces the file to send.
 *
 * Deliberately a plain route with its own URL: it can be linked from a load, an
 * email, or a support ticket, and it is the same markup a server-side renderer
 * would use when emailing arrives.
 */
import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Loader2, Printer } from "lucide-react";

import { InvoiceDocument } from "@/components/accounting/invoice-document";
import { Button } from "@/components/ui/button";
import { getInvoiceById, type InvoiceRecord } from "@/lib/accounting-store";
import { invoiceDocumentFilename } from "@/lib/invoice-document";

export const Route = createFileRoute("/invoices/$invoiceId/print")({
  head: () => ({ meta: [{ title: "Invoice" }] }),
  component: Page,
});

function Page() {
  const { invoiceId } = Route.useParams();
  const [invoice, setInvoice] = React.useState<InvoiceRecord | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const found = await getInvoiceById(invoiceId);
        if (cancelled) return;
        if (!found) setError(`No invoice ${invoiceId}.`);
        setInvoice(found);
      } catch (err) {
        if (!cancelled)
          setError(err instanceof Error ? err.message : "Could not load the invoice.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [invoiceId]);

  // The print dialog names the file after the document title, so set it to
  // something a person can find again rather than "localhost".
  React.useEffect(() => {
    if (!invoice) return;
    const previous = document.title;
    document.title = invoiceDocumentFilename(invoice);
    return () => {
      document.title = previous;
    };
  }, [invoice]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !invoice) {
    return (
      <div className="mx-auto max-w-md p-10 text-center">
        <p className="text-sm font-medium">{error ?? "Invoice not found."}</p>
      </div>
    );
  }

  const packetRefs = [
    invoice.rateConRef,
    invoice.podOnFile ? `POD on file · ${invoice.loadId}` : null,
  ].filter((v): v is string => Boolean(v));

  return (
    <div className="min-h-screen bg-muted/40 py-8">
      {/* print:hidden — the toolbar is for the screen; the sheet is the document. */}
      <div className="mx-auto mb-4 flex max-w-[8.5in] items-center justify-between px-2 print:hidden">
        <div className="text-sm text-muted-foreground">
          Use your browser's <strong>Save as PDF</strong> to produce the file.
        </div>
        <Button size="sm" onClick={() => window.print()} className="gap-1.5">
          <Printer className="h-4 w-4" /> Print / Save as PDF
        </Button>
      </div>

      <div className="mx-auto max-w-[8.5in] shadow-lg print:max-w-none print:shadow-none">
        <InvoiceDocument invoice={invoice} packetRefs={packetRefs} />
      </div>
    </div>
  );
}
