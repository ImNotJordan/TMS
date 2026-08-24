import * as React from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  AlertTriangle,
  Banknote,
  Building2,
  CheckCircle2,
  ClipboardList,
  FileText,
  FileWarning,
  Loader2,
  MapPin,
  Receipt,
  RefreshCw,
  Scale,
  Search,
  Send,
  Sparkles,
  Wallet,
} from "lucide-react";
import { toast } from "sonner";

import { PageHeader } from "@/components/page-header";
import { usePageReady } from "@/components/page-load-gate";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  buildAccountingSnapshot,
  computeDsoDays,
  generateInvoiceFromReady,
  handoffToCollections,
  INVOICE_QUEUES,
  markInvoiceDisputed,
  money,
  moneyExact,
  reconcileFactoringAdvance,
  submitInvoiceToFactoring,
  totalsFromLines,
  type AccountingSnapshot,
  type InvoiceQueue,
  type InvoiceRecord,
} from "@/lib/accounting-store";
import { listAllLoadsCached } from "@/lib/loads-store";
import { cn } from "@/lib/utils";
import { t } from "@/lib/i18n/t";

const ACCOUNTING_TABS = ["queues", "builder", "factoring", "collections", "payouts"] as const;

type AccountingTab = (typeof ACCOUNTING_TABS)[number];

type AccountingSearch = {
  tab?: AccountingTab;
  queue?: InvoiceQueue;
  loadId?: string;
  invoiceId?: string;
};

export const Route = createFileRoute("/accounting")({
  validateSearch: (search: Record<string, unknown>): AccountingSearch => {
    const tabRaw = typeof search.tab === "string" ? search.tab.trim() : undefined;
    const tab = ACCOUNTING_TABS.includes(tabRaw as AccountingTab)
      ? (tabRaw as AccountingTab)
      : undefined;
    const queueRaw = typeof search.queue === "string" ? search.queue.trim() : undefined;
    const queue = INVOICE_QUEUES.some((q) => q.id === queueRaw)
      ? (queueRaw as InvoiceQueue)
      : undefined;
    const loadId =
      typeof search.loadId === "string" && search.loadId.trim() ? search.loadId.trim() : undefined;
    const invoiceId =
      typeof search.invoiceId === "string" && search.invoiceId.trim()
        ? search.invoiceId.trim()
        : undefined;
    return { tab, queue, loadId, invoiceId };
  },
  head: () => ({
    meta: [
      { title: "Accounting — Logistics Software" },
      {
        name: "description",
        content:
          "Invoicing queues, invoice builder, factoring, collections AI, and carrier payouts.",
      },
    ],
  }),
  component: Page,
});

const queueTone: Record<InvoiceQueue, string> = {
  "ready-to-bill": "border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-300",
  sent: "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300",
  "in-dispute": "border-destructive/30 bg-destructive/10 text-destructive",
  factored: "border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-300",
  "sent-to-collections":
    "border-orange-500/30 bg-orange-500/10 text-orange-800 dark:text-orange-300",
};

function prettyDate(iso?: string) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function Page() {
  const navigate = Route.useNavigate();
  const search = Route.useSearch();
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [snapshot, setSnapshot] = React.useState<AccountingSnapshot | null>(null);
  const [query, setQuery] = React.useState("");
  const [builderInvoice, setBuilderInvoice] = React.useState<InvoiceRecord | null>(null);
  const [disputeOpen, setDisputeOpen] = React.useState<InvoiceRecord | null>(null);
  const [disputeReason, setDisputeReason] = React.useState("");

  const activeTab: AccountingTab = search.tab ?? "queues";
  const activeQueue: InvoiceQueue = search.queue ?? "ready-to-bill";

  usePageReady(loading);

  const refresh = React.useCallback(async (force = false) => {
    setLoading(true);
    setError(null);
    try {
      const loads = await listAllLoadsCached({ force });
      setSnapshot(await buildAccountingSnapshot(loads));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load accounting data.");
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void refresh(true);
  }, [refresh]);

  React.useEffect(() => {
    if (!snapshot || !search.loadId) return;
    const match = snapshot.invoices.find((i) => i.loadId === search.loadId);
    if (!match) return;
    setBuilderInvoice(match);
    const preferBuilder = (search.tab ?? "builder") !== "queues";
    void navigate({
      search: (prev) => ({
        ...prev,
        loadId: undefined,
        invoiceId: match.invoiceId,
        queue: match.status,
        tab: preferBuilder ? "builder" : "queues",
      }),
      replace: true,
    });
  }, [snapshot, search.loadId, search.tab, navigate]);

  const setTab = (tab: AccountingTab) => {
    void navigate({ search: (prev) => ({ ...prev, tab }), replace: true });
  };

  const setQueue = (queue: InvoiceQueue) => {
    void navigate({ search: (prev) => ({ ...prev, tab: "queues", queue }), replace: true });
  };

  const filtered = React.useMemo(() => {
    const rows = snapshot?.invoices.filter((i) => i.status === activeQueue) ?? [];
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (i) =>
        i.invoiceId.toLowerCase().includes(q) ||
        i.loadId.toLowerCase().includes(q) ||
        i.customer.toLowerCase().includes(q) ||
        i.lane.toLowerCase().includes(q),
    );
  }, [snapshot, activeQueue, query]);

  const applySnapshotInvoice = (next: InvoiceRecord) => {
    setSnapshot((prev) => {
      if (!prev) return prev;
      const invoices = prev.invoices.map((i) => (i.invoiceId === next.invoiceId ? next : i));
      return { ...prev, ...buildAccountingSnapshotFromInvoices(invoices, prev) };
    });
  };

  return (
    <div>
      <PageHeader
        title={t("Accounting & Invoicing")}
        description={t(
          "Ready-to-bill queues, invoice builder, factoring, collections AI, and carrier payouts — POD required before invoice.",
        )}
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={() => void refresh(true)}
            >
              <RefreshCw className="h-4 w-4" /> {t("Refresh")}
            </Button>
            <Button
              size="sm"
              className="gap-1.5"
              onClick={() => {
                const ready = snapshot?.invoices.find((i) => i.status === "ready-to-bill");
                if (!ready) {
                  toast.message("Nothing ready to bill", {
                    description: "Complete a load with POD uploaded first.",
                  });
                  return;
                }
                setBuilderInvoice(ready);
                setTab("builder");
              }}
            >
              <Receipt className="h-4 w-4" /> {t("Open invoice builder")}
            </Button>
          </>
        }
      />

      <div className="space-y-6 px-4 py-5 sm:px-6 lg:px-8">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <Kpi
            label={t("Ready to bill")}
            value={loading ? "—" : String(snapshot?.readyToBillCount ?? 0)}
            hint={t("Has POD · not invoiced")}
            tone="warning"
          />
          <Kpi
            label={t("AR open")}
            value={loading ? "—" : money(snapshot?.arOpen ?? 0)}
            hint={t("Sent · dispute · factored")}
            tone="info"
          />
          <Kpi
            label={t("Overdue")}
            value={loading ? "—" : money(snapshot?.overdue ?? 0)}
            hint={t("Past due · collections AI")}
            tone="warning"
          />
          <Kpi
            label="DSO"
            value={loading ? "—" : `${snapshot?.dsoDays ?? 0}d`}
            hint={t("Computed daily from AR / sales")}
            tone="default"
          />
          <Kpi
            label={t("Factor advances")}
            value={loading ? "—" : money(snapshot?.factoredAdvance ?? 0)}
            hint={t("Submitted · pending reconcile")}
            tone="success"
          />
        </div>

        {error ? (
          <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        ) : null}

        <Tabs value={activeTab} onValueChange={(v) => setTab(v as AccountingTab)}>
          <TabsList className="grid h-auto w-full grid-cols-2 gap-1 sm:grid-cols-5">
            <TabsTrigger value="queues" className="gap-1.5 text-xs sm:text-sm">
              <ClipboardList className="h-3.5 w-3.5" /> {t("Queues")}
            </TabsTrigger>
            <TabsTrigger value="builder" className="gap-1.5 text-xs sm:text-sm">
              <Receipt className="h-3.5 w-3.5" /> {t("Builder")}
            </TabsTrigger>
            <TabsTrigger value="factoring" className="gap-1.5 text-xs sm:text-sm">
              <Building2 className="h-3.5 w-3.5" /> {t("Factoring")}
            </TabsTrigger>
            <TabsTrigger value="collections" className="gap-1.5 text-xs sm:text-sm">
              <Scale className="h-3.5 w-3.5" /> {t("Collections AI")}
            </TabsTrigger>
            <TabsTrigger value="payouts" className="gap-1.5 text-xs sm:text-sm">
              <Banknote className="h-3.5 w-3.5" /> {t("Payouts")}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="queues" className="mt-4 space-y-4">
            <div className="flex flex-wrap gap-2">
              {INVOICE_QUEUES.map((q) => {
                const count = snapshot?.invoices.filter((i) => i.status === q.id).length ?? 0;
                return (
                  <button
                    key={q.id}
                    type="button"
                    onClick={() => setQueue(q.id)}
                    className={cn(
                      "rounded-xl border px-3 py-2 text-left transition-colors",
                      activeQueue === q.id
                        ? "border-primary/40 bg-primary/10 shadow-sm"
                        : "border-border/70 bg-card hover:bg-muted/40",
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-foreground">{q.label}</span>
                      <Badge variant="outline" className="h-5 px-1.5 text-[10px]">
                        {loading ? "…" : count}
                      </Badge>
                    </div>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">{q.hint}</p>
                  </button>
                );
              })}
            </div>

            <div className="relative max-w-md">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pl-8"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t("Search invoice, load, customer…")}
              />
            </div>

            <Card className="border-border/70 shadow-sm">
              <CardContent className="p-0">
                {loading ? (
                  <div className="space-y-2 p-4">
                    {Array.from({ length: 5 }).map((_, i) => (
                      <Skeleton key={i} className="h-12 w-full" />
                    ))}
                  </div>
                ) : filtered.length === 0 ? (
                  <div className="flex flex-col items-center gap-2 px-6 py-14 text-center">
                    <Wallet className="h-8 w-8 text-muted-foreground" />
                    <p className="text-sm font-medium text-foreground">
                      {t("No invoices in this queue")}
                    </p>
                    <p className="max-w-sm text-xs text-muted-foreground">
                      {activeQueue === "ready-to-bill"
                        ? "Loads appear here only after POD is on file (acceptance rule)."
                        : "Move invoices here from the builder, factoring, or collections AI."}
                    </p>
                  </div>
                ) : (
                  <ul className="divide-y divide-border/60">
                    {filtered.map((inv) => (
                      <li
                        key={inv.invoiceId}
                        className={cn(
                          "flex flex-wrap items-center gap-3 px-4 py-3 hover:bg-muted/30",
                          search.invoiceId === inv.invoiceId &&
                            "bg-primary/5 ring-1 ring-inset ring-primary/20",
                        )}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-mono text-sm font-semibold text-foreground">
                              {inv.invoiceId}
                            </span>
                            <Badge variant="outline" className={queueTone[inv.status]}>
                              {INVOICE_QUEUES.find((q) => q.id === inv.status)?.label}
                            </Badge>
                            {inv.podOnFile ? (
                              <Badge
                                variant="outline"
                                className="border-success/30 bg-success/10 text-success"
                              >
                                POD
                              </Badge>
                            ) : (
                              <Badge
                                variant="outline"
                                className="border-destructive/30 bg-destructive/10 text-destructive"
                              >
                                {t("Missing POD")}
                              </Badge>
                            )}
                          </div>
                          <p className="mt-0.5 truncate text-xs text-muted-foreground">
                            {inv.loadId} · {inv.customer} · {inv.lane}
                            {inv.factoringSubmissionId
                              ? ` · Factor ${inv.factoringSubmissionId}`
                              : ""}
                          </p>
                        </div>
                        <div className="text-right">
                          <div className="text-sm font-semibold tabular-nums">
                            {moneyExact(inv.total)}
                          </div>
                          <div className="text-[11px] text-muted-foreground">
                            {inv.issuedAt ? `Due ${prettyDate(inv.dueAt)}` : inv.terms}
                          </div>
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Button size="sm" variant="ghost" className="h-8 px-2" asChild>
                            <Link to="/loads/$loadId" params={{ loadId: inv.loadId }}>
                              {t("Load")}
                            </Link>
                          </Button>
                          <Button size="sm" variant="ghost" className="h-8 px-2" asChild>
                            <Link to="/tracking" search={{ loadId: inv.loadId }}>
                              <MapPin className="mr-1 h-3.5 w-3.5" /> {t("Track")}
                            </Link>
                          </Button>
                          <Button size="sm" variant="ghost" className="h-8 px-2" asChild>
                            {/* The document the customer receives. Opens standalone so
                                the browser prints the invoice and nothing else. */}
                            <Link
                              to="/invoices/$invoiceId/print"
                              params={{ invoiceId: inv.invoiceId }}
                              target="_blank"
                            >
                              <FileText className="mr-1 h-3.5 w-3.5" /> {t("Invoice")}
                            </Link>
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setBuilderInvoice(inv);
                              setTab("builder");
                            }}
                          >
                            {t("Open")}
                          </Button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="builder" className="mt-4">
            <InvoiceBuilderPanel
              invoice={builderInvoice}
              readyList={snapshot?.invoices.filter((i) => i.status === "ready-to-bill") ?? []}
              loading={loading}
              onSelect={setBuilderInvoice}
              onGenerated={(next) => {
                applySnapshotInvoice(next);
                setBuilderInvoice(next);
                toast.success("Invoice generated", {
                  description: `${next.invoiceId} sent · factoring id ready when submitted`,
                });
                setQueue("sent");
              }}
            />
          </TabsContent>

          <TabsContent value="factoring" className="mt-4 space-y-4">
            <Card className="border-border/70 shadow-sm">
              <CardHeader className="pb-3">
                <CardTitle className="text-base">{t("Factoring integration")}</CardTitle>
                <CardDescription>
                  {t(
                    "Submit via API/EDI, capture submission id, receive advance status, reconcile.",
                  )}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {(
                  snapshot?.invoices.filter((i) =>
                    ["sent", "factored", "in-dispute"].includes(i.status),
                  ) ?? []
                ).length === 0 && !loading ? (
                  <p className="py-8 text-center text-sm text-muted-foreground">
                    {t("Generate an invoice first, then submit it to your factor.")}
                  </p>
                ) : loading ? (
                  <Skeleton className="h-24 w-full" />
                ) : (
                  (
                    snapshot?.invoices.filter((i) =>
                      ["sent", "factored", "in-dispute"].includes(i.status),
                    ) ?? []
                  ).map((inv) => (
                    <div
                      key={inv.invoiceId}
                      className="flex flex-wrap items-center gap-3 rounded-xl border border-border/70 bg-background/60 p-3"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-semibold">{inv.invoiceId}</div>
                        <div className="text-xs text-muted-foreground">
                          {inv.customer} · {moneyExact(inv.total)}
                          {inv.factoringSubmissionId
                            ? ` · ID ${inv.factoringSubmissionId} · ${inv.factoringStatus}`
                            : " · Not submitted"}
                        </div>
                      </div>
                      {inv.status !== "factored" ? (
                        <Button
                          size="sm"
                          className="gap-1.5"
                          onClick={() => {
                            void (async () => {
                              try {
                                const next = await submitInvoiceToFactoring(inv);
                                applySnapshotInvoice(next);
                                toast.success("Submitted to factor", {
                                  description: `Submission id ${next.factoringSubmissionId}`,
                                });
                              } catch (err) {
                                toast.error("Factoring failed", {
                                  description: err instanceof Error ? err.message : "Try again",
                                });
                              }
                            })();
                          }}
                        >
                          <Send className="h-3.5 w-3.5" /> {t("Submit API/EDI")}
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={inv.factoringStatus === "advanced"}
                          onClick={() => {
                            void (async () => {
                              try {
                                const next = await reconcileFactoringAdvance(inv);
                                applySnapshotInvoice(next);
                                toast.success("Advance reconciled", {
                                  description: moneyExact(next.factoringAdvance ?? 0),
                                });
                              } catch (err) {
                                toast.error("Reconcile failed", {
                                  description: err instanceof Error ? err.message : "Try again",
                                });
                              }
                            })();
                          }}
                        >
                          {inv.factoringStatus === "advanced" ? "Advanced" : "Reconcile advance"}
                        </Button>
                      )}
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="collections" className="mt-4 space-y-4">
            <div className="grid gap-4 lg:grid-cols-5">
              <Card className="border-border/70 shadow-sm lg:col-span-2">
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Sparkles className="h-4 w-4 text-primary" /> {t("Sequence rules")}
                  </CardTitle>
                  <CardDescription>
                    {t("Escalations run daily against DSO / aging.")}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-2">
                  {(snapshot?.collectionsRules ?? []).map((rule) => (
                    <div
                      key={rule.id}
                      className="rounded-lg border border-border/70 bg-muted/20 px-3 py-2"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium">{rule.name}</span>
                        <Badge variant="outline" className="text-[10px]">
                          +{rule.daysPastDue}d · {rule.channel}
                        </Badge>
                      </div>
                      <p className="mt-0.5 text-xs text-muted-foreground">{rule.action}</p>
                    </div>
                  ))}
                </CardContent>
              </Card>

              <Card className="border-border/70 shadow-sm lg:col-span-3">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">{t("Dispute capture & handoff")}</CardTitle>
                  <CardDescription>
                    {t(
                      "Capture disputes, then auto-handoff aged balances to a collections partner.",
                    )}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-2">
                  {(
                    snapshot?.invoices.filter((i) =>
                      ["sent", "in-dispute", "sent-to-collections", "factored"].includes(i.status),
                    ) ?? []
                  ).map((inv) => (
                    <div
                      key={inv.invoiceId}
                      className="flex flex-wrap items-center gap-2 rounded-xl border border-border/70 p-3"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-semibold">{inv.invoiceId}</div>
                        <div className="text-xs text-muted-foreground">
                          {inv.customer} · {moneyExact(inv.total)}
                          {inv.disputeReason ? ` · ${inv.disputeReason}` : ""}
                          {inv.collectionsPartner ? ` · Partner: ${inv.collectionsPartner}` : ""}
                        </div>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-1.5"
                        onClick={() => {
                          setDisputeReason("");
                          setDisputeOpen(inv);
                        }}
                      >
                        <AlertTriangle className="h-3.5 w-3.5" /> {t("Dispute")}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          void (async () => {
                            try {
                              const next = await handoffToCollections(inv);
                              applySnapshotInvoice(next);
                              toast.success("Sent to collections", {
                                description: next.collectionsPartner,
                              });
                            } catch (err) {
                              toast.error("Handoff failed", {
                                description: err instanceof Error ? err.message : "Try again",
                              });
                            }
                          })();
                        }}
                      >
                        {t("Handoff partner")}
                      </Button>
                    </div>
                  ))}
                  {!loading &&
                  (snapshot?.invoices.filter((i) =>
                    ["sent", "in-dispute", "sent-to-collections", "factored"].includes(i.status),
                  ).length ?? 0) === 0 ? (
                    <p className="py-6 text-center text-sm text-muted-foreground">
                      {t("No aged invoices yet.")}
                    </p>
                  ) : null}
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="payouts" className="mt-4 space-y-4">
            <Card className="border-border/70 shadow-sm">
              <CardHeader className="pb-3">
                <CardTitle className="text-base">{t("Carrier payables")}</CardTitle>
                <CardDescription>
                  {t("Not implemented — no settlement model exists yet.")}
                </CardDescription>
              </CardHeader>
              <CardContent>
                {/*
                  This panel previously listed payables generated from the array
                  index: whether a carrier had been paid, when payment was due,
                  whether quick-pay applied, and the YTD figure that would feed a
                  1099 were all placeholders. A "Schedule quick-pay" button mutated
                  React state and toasted success while persisting nothing.

                  It is deliberately empty rather than approximated. A money screen
                  that reports plausible untruths is worse than one that reports
                  nothing, because only the second prompts anyone to ask.
                */}
                <div className="rounded-xl border border-dashed border-border/70 px-4 py-10 text-center">
                  <p className="text-sm font-medium text-foreground">
                    {t("Carrier settlements are not built yet")}
                  </p>
                  <p className="mx-auto mt-1.5 max-w-md text-xs text-muted-foreground">
                    {t(
                      "Paying a carrier needs a settlement record, deductions, compliance and factoring\r\n                    gates, and an approval step. None of those exist, so nothing is shown here.\r\n                    Carrier rates are on the load record.",
                    )}
                  </p>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        <AcceptanceStrip />
      </div>

      <Dialog open={!!disputeOpen} onOpenChange={(open) => !open && setDisputeOpen(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("Capture dispute")}</DialogTitle>
            <DialogDescription>
              {disputeOpen?.invoiceId} · freeze factoring and route to dispute workflow.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={disputeReason}
            onChange={(e) => setDisputeReason(e.target.value)}
            placeholder={t("Accessorial denied, short pay, POD quality…")}
            rows={4}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setDisputeOpen(null)}>
              {t("Cancel")}
            </Button>
            <Button
              onClick={() => {
                if (!disputeOpen) return;
                void (async () => {
                  try {
                    const next = await markInvoiceDisputed(disputeOpen, disputeReason);
                    applySnapshotInvoice(next);
                    setDisputeOpen(null);
                    toast.success("Dispute captured");
                    setQueue("in-dispute");
                  } catch (err) {
                    toast.error("Could not save dispute", {
                      description: err instanceof Error ? err.message : "Try again",
                    });
                  }
                })();
              }}
            >
              {t("Save dispute")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function buildAccountingSnapshotFromInvoices(
  invoices: InvoiceRecord[],
  prev: AccountingSnapshot,
): Partial<AccountingSnapshot> {
  return {
    invoices,
    dsoDays: computeDsoDays(invoices),
    arOpen: invoices
      .filter((i) => ["sent", "in-dispute", "factored"].includes(i.status))
      .reduce((s, i) => s + i.total, 0),
    overdue: invoices
      .filter((i) => i.status === "sent" && i.dueAt && Date.parse(i.dueAt) < Date.now())
      .reduce((s, i) => s + i.total, 0),
    factoredAdvance: invoices
      .filter((i) => i.status === "factored")
      .reduce((s, i) => s + (i.factoringAdvance ?? 0), 0),
    readyToBillCount: invoices.filter((i) => i.status === "ready-to-bill").length,
    payables: prev.payables,
    collectionsRules: prev.collectionsRules,
  };
}

function Kpi({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint: string;
  tone: "default" | "info" | "warning" | "success";
}) {
  const toneClass =
    tone === "warning"
      ? "from-amber-500/10 to-transparent"
      : tone === "info"
        ? "from-sky-500/10 to-transparent"
        : tone === "success"
          ? "from-emerald-500/10 to-transparent"
          : "from-muted/40 to-transparent";
  return (
    <Card className={cn("overflow-hidden border-border/70 bg-gradient-to-br shadow-sm", toneClass)}>
      <CardContent className="p-4">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {label}
        </p>
        <p className="mt-1 text-2xl font-semibold tracking-tight tabular-nums text-foreground">
          {value}
        </p>
        <p className="mt-1 text-[11px] text-muted-foreground">{hint}</p>
      </CardContent>
    </Card>
  );
}

function AcceptanceStrip() {
  return (
    <div className="rounded-xl border border-border/70 bg-muted/20 px-4 py-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {t("Acceptance")}
      </p>
      <ul className="mt-2 grid gap-1.5 text-xs text-muted-foreground sm:grid-cols-3">
        <li className="inline-flex items-start gap-1.5">
          <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" />
          {t("Invoice generated only with required docs (POD)")}
        </li>
        <li className="inline-flex items-start gap-1.5">
          <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" />
          {t("Factoring submission id captured on submit")}
        </li>
        <li className="inline-flex items-start gap-1.5">
          <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" />
          {t("DSO computed from AR / trailing sales")}
        </li>
      </ul>
    </div>
  );
}

function InvoiceBuilderPanel({
  invoice,
  readyList,
  loading,
  onSelect,
  onGenerated,
}: {
  invoice: InvoiceRecord | null;
  readyList: InvoiceRecord[];
  loading: boolean;
  onSelect: (inv: InvoiceRecord) => void;
  onGenerated: (inv: InvoiceRecord) => void;
}) {
  const [lines, setLines] = React.useState(invoice?.lines ?? []);
  const [remitTo, setRemitTo] = React.useState(invoice?.remitTo ?? "");
  const [terms, setTerms] = React.useState(invoice?.terms ?? "Net 30");
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (!invoice) return;
    setLines(invoice.lines);
    setRemitTo(invoice.remitTo);
    setTerms(invoice.terms);
  }, [invoice?.invoiceId]);

  const totals = totalsFromLines(lines);

  if (loading) {
    return <Skeleton className="h-64 w-full rounded-xl" />;
  }

  if (!invoice) {
    return (
      <Card className="border-border/70 shadow-sm">
        <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
          <FileWarning className="h-8 w-8 text-muted-foreground" />
          <p className="text-sm font-medium">{t("Select a ready-to-bill load")}</p>
          <div className="flex flex-wrap justify-center gap-2">
            {readyList.slice(0, 6).map((inv) => (
              <Button key={inv.invoiceId} size="sm" variant="outline" onClick={() => onSelect(inv)}>
                {inv.loadId}
              </Button>
            ))}
          </div>
          {readyList.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              {t("No POD-backed loads waiting — finish Tracking close-out first.")}
            </p>
          ) : null}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-5">
      <Card className="border-border/70 shadow-sm lg:col-span-3">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">{t("Invoice builder")}</CardTitle>
          <CardDescription>
            {t("Pulls rate con + accessorials + fuel; taxes; remit-to. POD gate enforced.")}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2 text-xs">
            <Badge variant="outline">{invoice.loadId}</Badge>
            <Badge variant="outline">{invoice.customer}</Badge>
            <Badge variant="outline">{invoice.rateConRef}</Badge>
            {invoice.podOnFile ? (
              <Badge variant="outline" className="border-success/30 bg-success/10 text-success">
                {t("POD on file")}
              </Badge>
            ) : (
              <Badge variant="outline" className="border-destructive/30 text-destructive">
                {t("POD missing")}
              </Badge>
            )}
          </div>

          <div className="space-y-2">
            {lines.map((line) => (
              <div key={line.id} className="grid grid-cols-[1fr_8rem] items-center gap-2">
                <Label className="text-xs text-muted-foreground">{line.label}</Label>
                <Input
                  type="number"
                  step="0.01"
                  className="h-8 text-right tabular-nums"
                  value={line.amount}
                  disabled={invoice.status !== "ready-to-bill"}
                  onChange={(e) => {
                    const amount = Number(e.target.value);
                    setLines((prev) =>
                      prev.map((l) =>
                        l.id === line.id
                          ? { ...l, amount: Number.isFinite(amount) ? amount : 0 }
                          : l,
                      ),
                    );
                  }}
                />
              </div>
            ))}
            {invoice.status === "ready-to-bill" && !lines.some((l) => l.kind === "tax") ? (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-8 px-2 text-xs text-muted-foreground"
                onClick={() =>
                  setLines((prev) => [...prev, { id: "tax", kind: "tax", label: "Tax", amount: 0 }])
                }
              >
                {t("+ Add tax line")}
              </Button>
            ) : null}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-xs">{t("Remit-to")}</Label>
              <Textarea
                value={remitTo}
                disabled={invoice.status !== "ready-to-bill"}
                onChange={(e) => setRemitTo(e.target.value)}
                rows={2}
                className="text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">{t("Payment terms")}</Label>
              <Input
                value={terms}
                disabled={invoice.status !== "ready-to-bill"}
                onChange={(e) => setTerms(e.target.value)}
              />
              <p className="text-[11px] text-muted-foreground">{invoice.lane}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="border-border/70 bg-gradient-to-b from-card to-muted/20 shadow-sm lg:col-span-2">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">{t("Summary")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Row label={t("Subtotal")} value={moneyExact(totals.subtotal)} />
          <Row label={t("Tax")} value={moneyExact(totals.tax)} />
          <div className="border-t border-border/70 pt-2">
            <Row label={t("Total")} value={moneyExact(totals.total)} strong />
          </div>
          <Button
            className="mt-2 w-full gap-1.5"
            disabled={busy || invoice.status !== "ready-to-bill" || !invoice.podOnFile}
            onClick={() => {
              setBusy(true);
              void (async () => {
                try {
                  const next = await generateInvoiceFromReady(invoice, { lines, remitTo, terms });
                  onGenerated(next);
                } catch (err) {
                  toast.error("Cannot generate invoice", {
                    description: err instanceof Error ? err.message : "POD required",
                  });
                } finally {
                  setBusy(false);
                }
              })();
            }}
          >
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <CheckCircle2 className="h-4 w-4" />
            )}
            {invoice.status === "ready-to-bill" ? "Generate & send invoice" : "Already generated"}
          </Button>
          {!invoice.podOnFile ? (
            <p className="text-center text-[11px] text-destructive">
              {t("Acceptance: invoice blocked until POD is on file.")}
            </p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn("tabular-nums", strong && "text-lg font-semibold text-foreground")}>
        {value}
      </span>
    </div>
  );
}
