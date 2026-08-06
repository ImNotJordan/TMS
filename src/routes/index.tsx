import * as React from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  Package,
  Gavel,
  FileSpreadsheet,
  ShieldAlert,
  DollarSign,
  Award,
  FileStack,
  AlertTriangle,
  ArrowUpRight,
  Plus,
  CircleCheck,
  CircleAlert,
  CircleDot,
  TrendingUp,
  TrendingDown,
  Inbox,
} from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PageHeader } from "@/components/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { ChartSkeleton, ListSkeleton, StatCardsSkeleton } from "@/components/page-skeleton";
import { usePageReady } from "@/components/page-load-gate";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { ShipmentMap } from "@/components/dashboard/shipment-map";
import { useAuth } from "@/lib/auth";
import {
  CARRIER_LABELS,
  STATUS_LABELS,
  toneBadge,
  labelOrRaw,
  formatLane,
  formatStop,
  formatRate,
  isActiveLoad,
  sortLoadsByUrgency,
  type Tone,
} from "@/lib/loads-display";
import {
  averageCarrierScore,
  buildActivity,
  buildAlerts,
  buildDeadlines,
  buildShipmentPins,
  carrierScores,
  countExceptions,
  countOpenBids,
  countPendingQuotes,
  countRfpsInFlight,
  fetchDashboardData,
  formatMoneyCompact,
  isHighRiskLoad,
  isInTransit,
  monthRevenue,
  topLanes,
  weeklyRevenueSeries,
  type DashboardData,
} from "@/lib/dashboard-data";

const RevenueChart = React.lazy(() =>
  import("@/components/dashboard/revenue-chart").then((m) => ({ default: m.RevenueChart })),
);
const LaneVolumeChart = React.lazy(() =>
  import("@/components/dashboard/lane-volume-chart").then((m) => ({ default: m.LaneVolumeChart })),
);

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Dashboard — Logistics Software" },
      { name: "description", content: "Live operations command center: loads, bids, quotes, risk, revenue, and tracking." },
    ],
  }),
  component: DashboardPage,
});

const ACTIVITY_TONE_ICON: Record<Tone, { icon: typeof CircleDot; className: string }> = {
  success: { icon: CircleCheck, className: "text-success" },
  warning: { icon: CircleAlert, className: "text-warning-foreground" },
  destructive: { icon: AlertTriangle, className: "text-destructive" },
  info: { icon: CircleDot, className: "text-info" },
  default: { icon: CircleDot, className: "text-muted-foreground" },
};

const EMPTY_DATA: DashboardData = {
  loads: [],
  quotes: [],
  rfps: [],
  carriers: [],
  bids: [],
  errors: [],
};

export function DashboardPage() {
  const { user } = useAuth();
  const workspaceId = user?.userId ?? "_";

  const {
    data = EMPTY_DATA,
    isLoading,
    isError,
    error,
  } = useQuery({
    queryKey: ["dashboard", "overview", workspaceId],
    queryFn: () => fetchDashboardData(workspaceId),
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
  });

  usePageReady(isLoading);

  const derived = React.useMemo(() => {
    const now = new Date();
    const activeLoads = [...data.loads.filter(isActiveLoad)].sort(sortLoadsByUrgency);
    const thisMonth = monthRevenue(data.loads, now.getFullYear(), now.getMonth());
    const prevDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const prevMonth = monthRevenue(data.loads, prevDate.getFullYear(), prevDate.getMonth());
    const revenueDelta =
      prevMonth > 0 ? ((thisMonth - prevMonth) / prevMonth) * 100 : null;
    const revenueSeries = weeklyRevenueSeries(data.loads, now);
    const totalRevenue = revenueSeries.reduce((s, p) => s + p.revenue, 0);
    const totalCost = revenueSeries.reduce((s, p) => s + p.cost, 0);
    const marginPct = totalRevenue > 0 ? ((totalRevenue - totalCost) / totalRevenue) * 100 : null;
    const inTransit = data.loads.filter(isInTransit);
    const attention = data.loads.filter(
      (l) => isActiveLoad(l) && (l.loadStatus === "exception" || isHighRiskLoad(l)),
    );
    const avgScore = averageCarrierScore(data.carriers);
    return {
      activeLoads,
      highRiskCount: data.loads.filter(isHighRiskLoad).length,
      exceptionCount: countExceptions(data.loads),
      openBids: countOpenBids(data.bids),
      pendingQuotes: countPendingQuotes(data.quotes),
      rfpsInFlight: countRfpsInFlight(data.rfps),
      thisMonth,
      revenueDelta,
      revenueSeries,
      marginPct,
      lanes: topLanes(data.loads),
      carrierPerf: carrierScores(data.carriers),
      avgScore,
      alerts: buildAlerts(data.loads, data.carriers, data.rfps, now),
      deadlines: buildDeadlines(data.rfps, data.quotes, now),
      activity: buildActivity(data, now),
      pins: buildShipmentPins(data.loads),
      inTransitCount: inTransit.length,
      attentionCount: attention.length,
    };
  }, [data]);

  const activeCount = derived.activeLoads.length;
  const loadError = isError
    ? error instanceof Error
      ? error.message
      : "Failed to load dashboard data."
    : data.errors.find((e) => e.source === "Loads")?.message ?? null;
  const otherErrors = data.errors.filter((e) => e.source !== "Loads");
  const kpiValue = (v: string) => (isLoading ? "…" : v);

  return (
    <div>
      <PageHeader
        title="Operations Dashboard"
        description="Real-time view of loads, bids, quotes, carriers, and revenue."
        actions={
          <Button size="sm" className="gap-1.5" asChild>
            <Link to="/loads">
              <Plus className="h-4 w-4" /> New Load
            </Link>
          </Button>
        }
      />

      <div className="space-y-6 px-4 py-6 sm:px-6 lg:px-8">
        {otherErrors.length > 0 && (
          <div className="flex items-start gap-3 rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-sm">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning-foreground" />
            <div>
              <span className="font-medium">
                Some data sources are unavailable: {otherErrors.map((e) => e.source).join(", ")}.
              </span>{" "}
              <span className="text-muted-foreground">
                Those sections show partial data. {otherErrors[0].message}
              </span>
            </div>
          </div>
        )}

        {/* KPIs */}
        {isLoading ? (
          <StatCardsSkeleton count={8} />
        ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <KpiCard
            label="Active Loads"
            value={kpiValue(activeCount.toString())}
            icon={Package}
            accent="primary"
            to="/loads"
          />
          <KpiCard
            label="Open Bids"
            value={kpiValue(derived.openBids.toString())}
            icon={Gavel}
            accent="info"
            to="/bidding"
          />
          <KpiCard
            label="Pending Quotes"
            value={kpiValue(derived.pendingQuotes.toString())}
            icon={FileSpreadsheet}
            accent="warning"
            to="/quotes"
          />
          <KpiCard
            label="High-Risk Shipments"
            value={kpiValue(derived.highRiskCount.toString())}
            icon={ShieldAlert}
            accent="destructive"
            to="/risk"
          />
          <KpiCard
            label="Revenue (MTD)"
            value={kpiValue(formatMoneyCompact(derived.thisMonth))}
            delta={
              derived.revenueDelta != null
                ? `${derived.revenueDelta >= 0 ? "+" : ""}${derived.revenueDelta.toFixed(1)}%`
                : undefined
            }
            deltaLabel="vs last month"
            trend={derived.revenueDelta != null && derived.revenueDelta < 0 ? "down" : "up"}
            icon={DollarSign}
            accent="success"
            to="/accounting"
          />
          <KpiCard
            label="Avg Carrier Score"
            value={kpiValue(derived.avgScore != null ? derived.avgScore.toFixed(1) : "—")}
            icon={Award}
            accent="primary"
            to="/carriers"
          />
          <KpiCard
            label="RFPs In Flight"
            value={kpiValue(derived.rfpsInFlight.toString())}
            icon={FileStack}
            accent="info"
            to="/rfps"
          />
          <KpiCard
            label="Exceptions"
            value={kpiValue(derived.exceptionCount.toString())}
            icon={AlertTriangle}
            accent="warning"
            to="/tracking"
          />
        </div>
        )}

        {/* Revenue + Map */}
        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-2 border-border/70 shadow-sm">
            <CardHeader className="flex flex-row items-start justify-between gap-2 pb-2">
              <div>
                <CardTitle className="text-base">Revenue vs Carrier Cost</CardTitle>
                <CardDescription>Weekly booked revenue · last 8 weeks</CardDescription>
              </div>
              {derived.marginPct != null && (
                <Badge
                  variant="secondary"
                  className={`gap-1 ${
                    derived.marginPct >= 0
                      ? "text-success bg-success/12"
                      : "text-destructive bg-destructive/12"
                  }`}
                >
                  {derived.marginPct >= 0 ? (
                    <TrendingUp className="h-3 w-3" />
                  ) : (
                    <TrendingDown className="h-3 w-3" />
                  )}
                  {derived.marginPct.toFixed(1)}% margin
                </Badge>
              )}
            </CardHeader>
            <CardContent className="pt-2">
              {isLoading ? (
                <ChartSkeleton />
              ) : (
                <React.Suspense fallback={<ChartSkeleton />}>
                  <RevenueChart data={derived.revenueSeries} />
                </React.Suspense>
              )}
            </CardContent>
          </Card>

          <Card className="border-border/70 shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Live Shipments</CardTitle>
              <CardDescription>
                {isLoading
                  ? "Loading…"
                  : `${derived.inTransitCount} in transit · ${derived.attentionCount} require attention`}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <Skeleton className="h-[280px] w-full rounded-xl" />
              ) : (
                <ShipmentMap pins={derived.pins} />
              )}
            </CardContent>
          </Card>
        </div>

        {/* Loads table + side column */}
        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-2 border-border/70 shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between pb-3">
              <div>
                <CardTitle className="text-base">Active Loads</CardTitle>
                <CardDescription>
                  {isLoading
                    ? "Loading from DynamoDB…"
                    : loadError
                      ? "Could not refresh — showing last error below"
                      : `${activeCount} active · soonest delivery first`}
                </CardDescription>
              </div>
              <Button variant="ghost" size="sm" className="gap-1 text-primary" asChild>
                <Link to="/loads">
                  View all <ArrowUpRight className="h-4 w-4" />
                </Link>
              </Button>
            </CardHeader>
            <CardContent className="px-0 pb-0">
              {loadError && (
                <div className="flex items-start gap-3 border-b border-destructive/30 bg-destructive/8 px-6 py-3 text-sm text-destructive">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <div className="flex-1">
                    <div className="font-semibold">Couldn't load loads</div>
                    <div className="mt-0.5 text-xs text-destructive/90">{loadError}</div>
                  </div>
                </div>
              )}
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="border-border/70">
                      <TableHead className="pl-6">Load</TableHead>
                      <TableHead>Lane</TableHead>
                      <TableHead>Carrier</TableHead>
                      <TableHead>Delivery</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="pr-6 text-right">Rate</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {isLoading && data.loads.length === 0 ? (
                      Array.from({ length: 5 }).map((_, i) => (
                        <TableRow key={`skel-${i}`} className="border-border/60">
                          {Array.from({ length: 6 }).map((__, j) => (
                            <TableCell
                              key={j}
                              className={j === 0 ? "pl-6" : j === 5 ? "pr-6 text-right" : ""}
                            >
                              <span className="inline-block h-4 w-full max-w-[140px] animate-pulse rounded bg-muted" />
                            </TableCell>
                          ))}
                        </TableRow>
                      ))
                    ) : derived.activeLoads.length === 0 ? (
                      <TableRow className="border-border/60">
                        <TableCell colSpan={6} className="py-12">
                          <div className="flex flex-col items-center justify-center gap-2 text-center text-sm text-muted-foreground">
                            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-muted">
                              <Inbox className="h-5 w-5" />
                            </span>
                            <div className="font-medium text-foreground">No active loads</div>
                            <div className="text-xs">
                              Active means booked, tendered, dispatched, or in transit — not draft or
                              delivered.
                            </div>
                          </div>
                        </TableCell>
                      </TableRow>
                    ) : (
                      derived.activeLoads.slice(0, 12).map((l) => {
                        const status = l.loadStatus
                          ? (STATUS_LABELS[l.loadStatus] ?? {
                              label: l.loadStatus,
                              tone: "default" as Tone,
                            })
                          : { label: "—", tone: "default" as Tone };
                        return (
                          <TableRow key={l.loadId} className="border-border/60">
                            <TableCell className="pl-6 font-medium">
                              <Link
                                to="/loads/$loadId"
                                params={{ loadId: l.loadId }}
                                className="text-primary underline-offset-4 hover:underline"
                              >
                                {l.loadId}
                              </Link>
                            </TableCell>
                            <TableCell className="text-muted-foreground">{formatLane(l)}</TableCell>
                            <TableCell>{labelOrRaw(CARRIER_LABELS, l.assignedCarrier)}</TableCell>
                            <TableCell className="text-muted-foreground">
                              {formatStop(
                                l.deliveryDate,
                                l.deliveryAppointmentTime,
                                l.deliveryWindowStart,
                                l.deliveryWindowEnd,
                              )}
                            </TableCell>
                            <TableCell>
                              <Badge variant="outline" className={toneBadge[status.tone]}>
                                {status.label}
                              </Badge>
                            </TableCell>
                            <TableCell className="pr-6 text-right font-semibold tabular-nums">
                              {formatRate(l.customerRate)}
                            </TableCell>
                          </TableRow>
                        );
                      })
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          <div className="space-y-4">
            <Card className="border-border/70 shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Alerts & Exceptions</CardTitle>
                <CardDescription>Requires action</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {isLoading ? (
                  <ListSkeleton items={3} />
                ) : derived.alerts.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
                    No active alerts. All clear.
                  </div>
                ) : (
                  derived.alerts.map((a, i) => (
                    <div key={i} className="flex gap-3 rounded-lg border border-border/70 bg-muted/30 p-3">
                      <div
                        className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${
                          a.tone === "destructive"
                            ? "bg-destructive/15 text-destructive"
                            : "bg-warning/20 text-warning-foreground"
                        }`}
                      >
                        <AlertTriangle className="h-3.5 w-3.5" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium leading-tight text-foreground">{a.title}</p>
                        <p className="mt-0.5 text-xs text-muted-foreground">{a.desc}</p>
                      </div>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>

            <Card className="border-border/70 shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Upcoming Deadlines</CardTitle>
                <CardDescription>RFP due dates & quote pickups</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2.5">
                {isLoading ? (
                  <ListSkeleton items={3} />
                ) : derived.deadlines.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
                    No upcoming deadlines.
                  </div>
                ) : (
                  derived.deadlines.map((d) => (
                    <div key={d.label} className="flex items-start justify-between gap-2 rounded-lg p-2 hover:bg-muted/40">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{d.label}</p>
                        <p className="text-xs text-muted-foreground">{d.date}</p>
                      </div>
                      <Badge
                        variant="outline"
                        className={
                          d.urgency === "High"
                            ? toneBadge.destructive
                            : d.urgency === "Medium"
                              ? toneBadge.warning
                              : toneBadge.info
                        }
                      >
                        {d.urgency}
                      </Badge>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Lane volume + carrier perf */}
        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-2 border-border/70 shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Top Lanes by Volume</CardTitle>
              <CardDescription>All loads · grouped by pickup → delivery</CardDescription>
            </CardHeader>
            <CardContent className="pt-2">
              {isLoading ? (
                <ChartSkeleton />
              ) : (
                <React.Suspense fallback={<ChartSkeleton />}>
                  <LaneVolumeChart data={derived.lanes} />
                </React.Suspense>
              )}
            </CardContent>
          </Card>

          <Card className="border-border/70 shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Carrier Performance</CardTitle>
              <CardDescription>OTD% minus claims rate · top {Math.max(derived.carrierPerf.length, 1)}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {isLoading ? (
                <div className="space-y-4">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <div key={i} className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <Skeleton className="h-4 w-32" />
                        <Skeleton className="h-4 w-8" />
                      </div>
                      <Skeleton className="h-1.5 w-full" />
                    </div>
                  ))}
                </div>
              ) : derived.carrierPerf.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
                  No scored carriers yet — add OTD% on carrier profiles.
                </div>
              ) : (
                derived.carrierPerf.map((c) => (
                  <div key={c.name}>
                    <div className="mb-1 flex items-center justify-between text-sm">
                      <span className="font-medium">{c.name}</span>
                      <span className="tabular-nums text-muted-foreground">{c.score.toFixed(1)}</span>
                    </div>
                    <Progress value={c.score} className="h-1.5" />
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>

        {/* Activity feed */}
        <Card className="border-border/70 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Recent Activity</CardTitle>
            <CardDescription>Latest changes across loads, quotes, RFPs & carriers</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <ListSkeleton items={5} />
            ) : derived.activity.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                No recent activity yet.
              </div>
            ) : (
              <ul className="divide-y divide-border/70">
                {derived.activity.map((a, i) => {
                  const { icon: Icon, className } = ACTIVITY_TONE_ICON[a.tone];
                  return (
                    <li key={i} className="flex items-center gap-3 py-3">
                      <Avatar className="h-8 w-8">
                        <AvatarFallback className="bg-muted text-xs font-semibold">
                          {a.who.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm">
                          <span className="font-medium text-foreground">{a.who}</span>{" "}
                          <span className="text-muted-foreground">{a.what}</span>
                        </p>
                      </div>
                      <Icon className={`h-4 w-4 shrink-0 ${className}`} />
                      <span className="text-xs text-muted-foreground tabular-nums">{a.when}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
