import * as React from "react";
import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import {
  Package,
  Gavel,
  FileSpreadsheet,
  ShieldAlert,
  DollarSign,
  Award,
  Clock3,
  AlertTriangle,
  ArrowUpRight,
  CalendarClock,
  Plus,
  CircleCheck,
  CircleAlert,
  CircleDot,
  TrendingUp,
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
import { KpiCard } from "@/components/dashboard/kpi-card";
import { RevenueChart } from "@/components/dashboard/revenue-chart";
import { LaneVolumeChart } from "@/components/dashboard/lane-volume-chart";
import { ShipmentMap } from "@/components/dashboard/shipment-map";
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
import { listAllLoads, type LoadRecord } from "@/lib/loads-store";

export const Route = createFileRoute("/")({
  beforeLoad: () => {
    if (typeof window !== "undefined" && sessionStorage.getItem("isAuthenticated") !== "true") {
      throw redirect({ to: "/landing" });
    }
  },
  head: () => ({
    meta: [
      { title: "Dashboard — Logistics Software" },
      { name: "description", content: "Live operations command center: loads, bids, quotes, risk, revenue, and tracking." },
    ],
  }),
  component: Index,
});

const ACTIVITY = [
  { who: "Jordan T.", what: "Booked load L-2841 with Bluepeak Freight", when: "2m ago", icon: CircleCheck, tone: "text-success" },
  { who: "System", what: "Risk score elevated for L-2839 (weather)", when: "12m ago", icon: CircleAlert, tone: "text-warning-foreground" },
  { who: "Priya S.", what: "Quote Q-1182 sent to Acme Foods", when: "28m ago", icon: CircleDot, tone: "text-info" },
  { who: "Marcus L.", what: "Invoice INV-7741 paid · $4,210", when: "1h ago", icon: CircleCheck, tone: "text-success" },
  { who: "System", what: "RFP-204 deadline in 6 hours", when: "2h ago", icon: AlertTriangle, tone: "text-warning-foreground" },
] as const;

const DEADLINES = [
  { label: "RFP-204 · Northstar Beverage", date: "Today · 11:59 PM", urgency: "High" },
  { label: "Bid B-882 · TransOcean", date: "Tomorrow · 9:00 AM", urgency: "Medium" },
  { label: "Quote Q-1180 · Greenfield Co.", date: "Fri · 5:00 PM", urgency: "Low" },
] as const;

const ALERTS = [
  { title: "Weather delay on I-40", desc: "3 loads in corridor flagged for re-route.", tone: "warning" as const },
  { title: "Carrier capacity below threshold", desc: "Sundial Trucking at 72% — consider backup.", tone: "destructive" as const },
  { title: "Detention risk · L-2839", desc: "Receiver dwell trending 90+ minutes.", tone: "warning" as const },
] as const;

function Index() {
  const [loads, setLoads] = React.useState<LoadRecord[] | null>(null);
  const [loadsLoading, setLoadsLoading] = React.useState(true);
  const [loadsError, setLoadsError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoadsLoading(true);
      setLoadsError(null);
      try {
        const items = await listAllLoads();
        if (!cancelled) setLoads(items);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to load loads.";
        if (!cancelled) {
          setLoadsError(message);
          setLoads([]);
        }
      } finally {
        if (!cancelled) setLoadsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const activeLoads = React.useMemo(() => {
    const list = loads ?? [];
    return [...list.filter(isActiveLoad)].sort(sortLoadsByUrgency);
  }, [loads]);

  const activeCount = activeLoads.length;

  return (
    <div>
      <PageHeader
        title="Operations Dashboard"
        description="Real-time view of loads, bids, quotes, carriers, and revenue."
        actions={
          <>
            <Button variant="outline" size="sm" className="gap-1.5">
              <CalendarClock className="h-4 w-4" /> Last 7 days
            </Button>
            <Button size="sm" className="gap-1.5">
              <Plus className="h-4 w-4" /> New Load
            </Button>
          </>
        }
      />

      <div className="space-y-6 px-4 py-6 sm:px-6 lg:px-8">
        {/* KPIs */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <KpiCard
            label="Active Loads"
            value={loadsLoading ? "…" : activeCount.toString()}
            icon={Package}
            accent="primary"
          />
          <KpiCard label="Open Bids" value="36" delta="+4.1%" trend="up" icon={Gavel} accent="info" />
          <KpiCard label="Pending Quotes" value="58" delta="-2.3%" trend="down" icon={FileSpreadsheet} accent="warning" />
          <KpiCard label="High-Risk Shipments" value="9" delta="+1.0%" trend="up" icon={ShieldAlert} accent="destructive" />
          <KpiCard label="Revenue (MTD)" value="$2.41M" delta="+8.7%" trend="up" icon={DollarSign} accent="success" />
          <KpiCard label="Carrier Score" value="92.4" delta="+1.2 pts" trend="up" icon={Award} accent="primary" />
          <KpiCard label="On-Time Delivery" value="96.8%" delta="+0.6%" trend="up" icon={Clock3} accent="success" />
          <KpiCard label="Exceptions Today" value="7" delta="-3" trend="down" icon={AlertTriangle} accent="warning" />
        </div>

        {/* Revenue + Map */}
        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-2 border-border/70 shadow-sm">
            <CardHeader className="flex flex-row items-start justify-between gap-2 pb-2">
              <div>
                <CardTitle className="text-base">Revenue vs Target</CardTitle>
                <CardDescription>Weekly performance · last 8 weeks</CardDescription>
              </div>
              <Badge variant="secondary" className="gap-1 text-success bg-success/12">
                <TrendingUp className="h-3 w-3" /> +18.2%
              </Badge>
            </CardHeader>
            <CardContent className="pt-2">
              <RevenueChart />
            </CardContent>
          </Card>

          <Card className="border-border/70 shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Live Shipments</CardTitle>
              <CardDescription>12 in transit · 3 require attention</CardDescription>
            </CardHeader>
            <CardContent>
              <ShipmentMap />
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
                  {loadsLoading
                    ? "Loading from DynamoDB…"
                    : loadsError
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
              {loadsError && (
                <div className="flex items-start gap-3 border-b border-destructive/30 bg-destructive/8 px-6 py-3 text-sm text-destructive">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <div className="flex-1">
                    <div className="font-semibold">Couldn't load loads</div>
                    <div className="mt-0.5 text-xs text-destructive/90">{loadsError}</div>
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
                    {loadsLoading && (!loads || loads.length === 0) ? (
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
                    ) : activeLoads.length === 0 ? (
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
                      activeLoads.slice(0, 12).map((l) => {
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
                {ALERTS.map((a, i) => (
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
                ))}
              </CardContent>
            </Card>

            <Card className="border-border/70 shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Upcoming Deadlines</CardTitle>
                <CardDescription>Bids, RFPs & quotes</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2.5">
                {DEADLINES.map((d) => (
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
                ))}
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Lane volume + activity + carrier perf */}
        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-2 border-border/70 shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Top Lanes by Volume</CardTitle>
              <CardDescription>Loads booked · last 30 days</CardDescription>
            </CardHeader>
            <CardContent className="pt-2">
              <LaneVolumeChart />
            </CardContent>
          </Card>

          <Card className="border-border/70 shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Carrier Performance</CardTitle>
              <CardDescription>Top 4 by score</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {[
                { name: "Bluepeak Freight", score: 96 },
                { name: "Ironline Logistics", score: 93 },
                { name: "Gulfstream Express", score: 89 },
                { name: "Sundial Trucking", score: 78 },
              ].map((c) => (
                <div key={c.name}>
                  <div className="mb-1 flex items-center justify-between text-sm">
                    <span className="font-medium">{c.name}</span>
                    <span className="tabular-nums text-muted-foreground">{c.score}</span>
                  </div>
                  <Progress value={c.score} className="h-1.5" />
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

        {/* Activity feed */}
        <Card className="border-border/70 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Recent Activity</CardTitle>
            <CardDescription>Across your operation</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-border/70">
              {ACTIVITY.map((a, i) => {
                const Icon = a.icon;
                return (
                  <li key={i} className="flex items-center gap-3 py-3">
                    <Avatar className="h-8 w-8">
                      <AvatarFallback className="bg-muted text-xs font-semibold">
                        {a.who.split(" ").map((n) => n[0]).join("").slice(0, 2)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm">
                        <span className="font-medium text-foreground">{a.who}</span>{" "}
                        <span className="text-muted-foreground">{a.what}</span>
                      </p>
                    </div>
                    <Icon className={`h-4 w-4 ${a.tone}`} />
                    <span className="text-xs text-muted-foreground tabular-nums">{a.when}</span>
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
