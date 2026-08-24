import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";
import { AlertTriangle, BarChart3, Database, Download, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { AiPanel } from "@/components/analytics/ai-panel";
import {
  BiddingPanel,
  FinancePanel,
  OpsPanel,
  OverviewPanel,
  SalesPanel,
} from "@/components/analytics/domain-panels";
import { DrillThroughSheet } from "@/components/analytics/drill-through-sheet";
import { PageHeader } from "@/components/page-header";
import { ChartSkeleton, StatCardsSkeleton } from "@/components/page-skeleton";
import { usePageReady } from "@/components/page-load-gate";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ANALYTICS_PERIODS, useAnalytics } from "@/hooks/use-analytics";
import type { AnalyticsEvent, AnalyticsPeriod } from "@/lib/analytics-events";
import type { AnalyticsKpi, ScorecardRow } from "@/lib/analytics-kpis";
import { cn } from "@/lib/utils";
import { t } from "@/lib/i18n/t";

export const Route = createFileRoute("/analytics")({
  head: () => ({
    meta: [
      { title: "Analytics — Logistics Software" },
      {
        name: "description",
        content:
          "Ops, finance, sales, bidding, and AI analytics with event-table KPIs and drill-through.",
      },
    ],
  }),
  component: AnalyticsPage,
});

const TABS = [
  { value: "overview", label: "Overview", group: "core" },
  { value: "ops", label: "Ops", group: "core" },
  { value: "finance", label: "Finance", group: "core" },
  { value: "sales", label: "Sales", group: "growth" },
  { value: "bidding", label: "Bidding", group: "growth" },
  { value: "ai", label: "AI Insights", group: "ai" },
] as const;

type TabId = (typeof TABS)[number]["value"];

function AnalyticsPage() {
  const [period, setPeriod] = React.useState<AnalyticsPeriod>("30d");
  const [tab, setTab] = React.useState<TabId>("overview");
  const {
    snapshot,
    isLoading,
    isError,
    error,
    refetch,
    isFetching,
    eventCount,
    builtAt,
    sourceErrors,
    drillEventsForKpi,
    drillEventsByIds,
    periodEvents,
  } = useAnalytics(period);

  usePageReady(isLoading);

  const [drillOpen, setDrillOpen] = React.useState(false);
  const [drillTitle, setDrillTitle] = React.useState("");
  const [drillDescription, setDrillDescription] = React.useState<string | undefined>();
  const [drillEvents, setDrillEvents] = React.useState<AnalyticsEvent[]>([]);

  const openDrill = React.useCallback(
    (title: string, events: AnalyticsEvent[], description?: string) => {
      setDrillTitle(title);
      setDrillDescription(description);
      setDrillEvents(events);
      setDrillOpen(true);
    },
    [],
  );

  const onKpi = React.useCallback(
    (kpi: AnalyticsKpi) => {
      openDrill(kpi.label, drillEventsForKpi(kpi), kpi.description);
    },
    [drillEventsForKpi, openDrill],
  );

  const onScorecard = React.useCallback(
    (row: ScorecardRow, title: string) => {
      const events =
        row.eventIds.length > 0
          ? drillEventsByIds(row.eventIds)
          : periodEvents.filter(
              (e) =>
                e.type === "bid.submitted" ||
                e.type === "bid.won" ||
                e.type === "backhaul.matched" ||
                e.type === "bid.dat_spread",
            );
      openDrill(`${title}: ${row.name}`, events, row.meta);
    },
    [drillEventsByIds, openDrill, periodEvents],
  );

  const exportCsv = React.useCallback(() => {
    if (periodEvents.length === 0) {
      toast.message("Nothing to export", { description: "No events in this period." });
      return;
    }
    const header = ["id", "type", "at", "entityType", "entityId", "label", "source"];
    const lines = [
      header.join(","),
      ...periodEvents.map((e) =>
        [e.id, e.type, e.at, e.entityType, e.entityId, JSON.stringify(e.label), e.source].join(","),
      ),
    ];
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `analytics-events-${period}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Exported event table", { description: `${periodEvents.length} rows` });
  }, [period, periodEvents]);

  return (
    <div>
      <PageHeader
        title={t("Analytics")}
        description={t(
          "Ops, finance, sales, bidding, and AI — KPIs reproducible from event tables with drill-through to records.",
        )}
        actions={
          <>
            <div className="inline-flex rounded-lg border border-border/70 bg-muted/40 p-0.5">
              {ANALYTICS_PERIODS.map((p) => (
                <button
                  key={p.value}
                  type="button"
                  onClick={() => setPeriod(p.value)}
                  className={cn(
                    "rounded-md px-2.5 py-1.5 text-xs font-semibold transition-colors",
                    period === p.value
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={() => void refetch()}
              disabled={isFetching}
            >
              <RefreshCw className={cn("h-4 w-4", isFetching && "animate-spin")} />
              {t("Refresh")}
            </Button>
            <Button variant="outline" size="sm" className="gap-1.5" onClick={exportCsv}>
              <Download className="h-4 w-4" />
              {t("Export")}
            </Button>
          </>
        }
      />

      <div className="px-4 py-5 sm:px-6 lg:px-8">
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <Badge variant="secondary" className="gap-1.5 font-normal">
            <Database className="h-3.5 w-3.5" />
            {eventCount.toLocaleString()} events · {period.toUpperCase()}
          </Badge>
          {builtAt && (
            <span className="text-xs text-muted-foreground">
              Built {new Date(builtAt).toLocaleTimeString()}
            </span>
          )}
          {sourceErrors.length > 0 && (
            <Badge variant="outline" className="gap-1 border-warning/40 text-warning-foreground">
              <AlertTriangle className="h-3.5 w-3.5" />
              {sourceErrors.length} source warning{sourceErrors.length === 1 ? "" : "s"}
            </Badge>
          )}
        </div>

        {isLoading && !snapshot ? (
          <div className="space-y-4">
            <StatCardsSkeleton count={4} />
            <ChartSkeleton />
          </div>
        ) : isError ? (
          <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-destructive/30 bg-destructive/5 py-16 text-center">
            <BarChart3 className="h-8 w-8 text-destructive" />
            <div>
              <h3 className="font-semibold text-foreground">{t("Could not load analytics")}</h3>
              <p className="mt-1 max-w-md text-sm text-muted-foreground">
                {error instanceof Error ? error.message : "Unknown error"}
              </p>
            </div>
            <Button size="sm" onClick={() => void refetch()}>
              {t("Retry")}
            </Button>
          </div>
        ) : snapshot ? (
          <Tabs value={tab} onValueChange={(v) => setTab(v as TabId)} className="space-y-5">
            <div className="overflow-x-auto">
              <TabsList className="inline-flex h-auto w-max min-w-full gap-0.5 bg-transparent p-0 sm:min-w-0">
                {TABS.map((item, index) => {
                  const showDivider = index > 0 && TABS[index - 1]!.group !== item.group;
                  return (
                    <React.Fragment key={item.value}>
                      {showDivider && (
                        <span className="mx-1 hidden h-6 w-px self-center bg-border sm:block" />
                      )}
                      <TabsTrigger
                        value={item.value}
                        className="rounded-lg px-3 py-2 text-xs data-[state=active]:bg-muted data-[state=active]:shadow-none sm:text-sm"
                      >
                        {item.label}
                      </TabsTrigger>
                    </React.Fragment>
                  );
                })}
              </TabsList>
            </div>

            <TabsContent value="overview" className="mt-0 outline-none">
              <OverviewPanel domain={snapshot.overview} onKpi={onKpi} onScorecard={onScorecard} />
            </TabsContent>
            <TabsContent value="ops" className="mt-0 outline-none">
              <OpsPanel domain={snapshot.ops} onKpi={onKpi} onScorecard={onScorecard} />
            </TabsContent>
            <TabsContent value="finance" className="mt-0 outline-none">
              <FinancePanel domain={snapshot.finance} onKpi={onKpi} onScorecard={onScorecard} />
            </TabsContent>
            <TabsContent value="sales" className="mt-0 outline-none">
              <SalesPanel domain={snapshot.sales} onKpi={onKpi} onScorecard={onScorecard} />
            </TabsContent>
            <TabsContent value="bidding" className="mt-0 outline-none">
              <BiddingPanel domain={snapshot.bidding} onKpi={onKpi} onScorecard={onScorecard} />
            </TabsContent>
            <TabsContent value="ai" className="mt-0 outline-none">
              <AiPanel
                reliability={snapshot.ai.reliability}
                lanes={snapshot.ai.lanes}
                credit={snapshot.ai.credit}
                kpis={snapshot.ai.kpis}
                onKpi={onKpi}
                onScorecard={onScorecard}
              />
            </TabsContent>
          </Tabs>
        ) : null}
      </div>

      <DrillThroughSheet
        open={drillOpen}
        onOpenChange={setDrillOpen}
        title={drillTitle}
        description={drillDescription}
        events={drillEvents}
      />
    </div>
  );
}
