import * as React from "react";
import { createFileRoute, Link, Outlet, useRouterState } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  Package,
  Filter,
  Download,
  Plus,
  Search,
  ArrowUpRight,
  Truck,
  MapPin,
  Clock3,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  RefreshCw,
  Inbox,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PageHeader } from "@/components/page-header";
import { CreateLoadDialog } from "@/components/loads/create-load-dialog";
import {
  CUSTOMER_LABELS,
  CARRIER_LABELS,
  EQUIPMENT_LABELS,
  STATUS_LABELS,
  toneBadge,
  toneStat,
  labelOrRaw,
  formatLane,
  formatStop,
  formatRate,
  isActiveLoad,
  type Tone,
} from "@/lib/loads-display";
import { listAllLoads, type LoadRecord } from "@/lib/loads-store";
import { invalidateOperationalCounts } from "@/lib/sidebar-counts";

export const Route = createFileRoute("/loads")({
  head: () => ({
    meta: [
      { title: "Loads — Logistics Software" },
      {
        name: "description",
        content: "Manage every load — from booking and dispatch to delivery and POD.",
      },
    ],
  }),
  component: Page,
});

function Page() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const isLoadDetailPath = /^\/loads\/[^/]+$/.test(pathname);
  const queryClient = useQueryClient();

  const [loads, setLoads] = React.useState<LoadRecord[] | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [refreshing, setRefreshing] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [query, setQuery] = React.useState("");

  const fetchLoads = React.useCallback(async (mode: "initial" | "refresh" = "refresh") => {
    if (mode === "initial") setLoading(true);
    else setRefreshing(true);
    setError(null);
    try {
      const items = await listAllLoads();
      items.sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
      setLoads(items);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load.";
      setError(message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  React.useEffect(() => {
    if (isLoadDetailPath) return;
    void fetchLoads("initial");
  }, [fetchLoads, isLoadDetailPath]);

  const filtered = React.useMemo(() => {
    if (!loads) return [];
    const q = query.trim().toLowerCase();
    if (!q) return loads;
    return loads.filter((l) => {
      const hay = [
        l.loadId,
        labelOrRaw(CUSTOMER_LABELS, l.customer),
        formatLane(l),
        labelOrRaw(CARRIER_LABELS, l.assignedCarrier),
        labelOrRaw(EQUIPMENT_LABELS, l.equipmentType),
        l.commodityDescription,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [loads, query]);

  const stats = React.useMemo(() => {
    const list = loads ?? [];
    const active = list.filter(isActiveLoad).length;
    const today = new Date().toISOString().slice(0, 10);
    const bookedToday = list.filter((l) => (l.createdAt ?? "").slice(0, 10) === today).length;
    const delivered = list.filter((l) => l.loadStatus === "delivered").length;
    const drafts = list.filter((l) => l.loadStatus === "draft").length;
    return [
      {
        label: "Active",
        value: active.toString(),
        delta: `${list.length} total`,
        tone: "info" as Tone,
        icon: Package,
      },
      {
        label: "Booked Today",
        value: bookedToday.toString(),
        delta: "Created today",
        tone: "default" as Tone,
        icon: Truck,
      },
      {
        label: "Delivered",
        value: delivered.toString(),
        delta: "All-time",
        tone: "success" as Tone,
        icon: CheckCircle2,
      },
      {
        label: "Drafts",
        value: drafts.toString(),
        delta: "Needs booking",
        tone: "warning" as Tone,
        icon: AlertTriangle,
      },
    ];
  }, [loads]);

  if (isLoadDetailPath) {
    return <Outlet />;
  }

  return (
    <div>
      <PageHeader
        title="Loads"
        description="Manage every load — from booking and dispatch to delivery and POD."
        actions={
          <>
            <Button variant="outline" size="sm" className="gap-1.5">
              <Filter className="h-4 w-4" /> Filters
            </Button>
            <Button variant="outline" size="sm" className="gap-1.5">
              <Download className="h-4 w-4" /> Export
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={() => void fetchLoads("refresh")}
              disabled={refreshing || loading}
            >
              {refreshing ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
              Refresh
            </Button>
            <CreateLoadDialog
              onCreated={() => {
                invalidateOperationalCounts(queryClient);
                void fetchLoads("refresh");
              }}
              trigger={
                <Button
                  size="sm"
                  className="gap-1.5 bg-gradient-to-r from-primary to-info text-primary-foreground shadow-sm shadow-primary/30 hover:opacity-95"
                >
                  <Plus className="h-4 w-4" /> New Load
                </Button>
              }
            />
          </>
        }
      />
      <div className="px-4 py-6 sm:px-6 lg:px-8">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {stats.map((s) => {
            const Icon = s.icon;
            return (
              <Card key={s.label} className="border-border/70 shadow-sm">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      {s.label}
                    </div>
                    <span
                      className={`flex h-7 w-7 items-center justify-center rounded-md ${toneStat[s.tone]}`}
                    >
                      <Icon className="h-3.5 w-3.5" />
                    </span>
                  </div>
                  <div className="mt-2 flex items-baseline justify-between gap-2">
                    <div className="text-2xl font-semibold tracking-tight text-foreground">
                      {loading ? (
                        <span className="inline-block h-7 w-10 animate-pulse rounded bg-muted" />
                      ) : (
                        s.value
                      )}
                    </div>
                    <Badge variant="secondary" className={toneStat[s.tone]}>
                      {s.delta}
                    </Badge>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>

        <Card className="mt-6 border-border/70 shadow-sm">
          <CardContent className="px-0 pb-0 pt-0">
            <div className="flex flex-col gap-3 border-b border-border/70 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6">
              <div className="relative w-full sm:max-w-xs">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  className="pl-8"
                  placeholder="Search loads, customers, lanes..."
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" variant="outline" className="gap-1.5">
                  <Clock3 className="h-4 w-4" /> Last 7 days
                </Button>
                <Button size="sm" variant="outline" className="gap-1.5">
                  <MapPin className="h-4 w-4" /> All lanes
                </Button>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {loading
                    ? "Loading…"
                    : `${filtered.length} of ${loads?.length ?? 0} load${loads?.length === 1 ? "" : "s"}`}
                </span>
                <Button variant="ghost" size="sm" className="gap-1 text-primary">
                  View all <ArrowUpRight className="h-4 w-4" />
                </Button>
              </div>
            </div>

            {error && (
              <div className="flex items-start gap-3 border-b border-destructive/30 bg-destructive/8 px-6 py-3 text-sm text-destructive">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <div className="flex-1">
                  <div className="font-semibold">Couldn't load from DynamoDB</div>
                  <div className="mt-0.5 text-xs text-destructive/90">{error}</div>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void fetchLoads("refresh")}
                  className="border-destructive/30 text-destructive hover:bg-destructive/10"
                >
                  Retry
                </Button>
              </div>
            )}

            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="border-border/70">
                    <TableHead className="pl-6">Load</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead>Lane</TableHead>
                    <TableHead>Pickup</TableHead>
                    <TableHead>Delivery</TableHead>
                    <TableHead>Carrier</TableHead>
                    <TableHead>Equipment</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="pr-6 text-right">Rate</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading && (!loads || loads.length === 0) ? (
                    Array.from({ length: 5 }).map((_, i) => (
                      <TableRow key={`skel-${i}`} className="border-border/60">
                        {Array.from({ length: 9 }).map((__, j) => (
                          <TableCell
                            key={j}
                            className={j === 0 ? "pl-6" : j === 8 ? "pr-6 text-right" : ""}
                          >
                            <span className="inline-block h-4 w-full max-w-[140px] animate-pulse rounded bg-muted" />
                          </TableCell>
                        ))}
                      </TableRow>
                    ))
                  ) : filtered.length === 0 ? (
                    <TableRow className="border-border/60">
                      <TableCell colSpan={9} className="py-12">
                        <div className="flex flex-col items-center justify-center gap-2 text-center text-sm text-muted-foreground">
                          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-muted">
                            <Inbox className="h-5 w-5" />
                          </span>
                          <div className="font-medium text-foreground">
                            {loads && loads.length > 0
                              ? "No loads match your search"
                              : "No loads yet"}
                          </div>
                          <div className="text-xs">
                            {loads && loads.length > 0
                              ? "Try a different keyword."
                              : "Create your first load to see it here."}
                          </div>
                        </div>
                      </TableCell>
                    </TableRow>
                  ) : (
                    filtered.map((r) => {
                      const status = r.loadStatus
                        ? (STATUS_LABELS[r.loadStatus] ?? {
                            label: r.loadStatus,
                            tone: "default" as Tone,
                          })
                        : { label: "—", tone: "default" as Tone };
                      return (
                        <TableRow key={r.loadId} className="border-border/60">
                          <TableCell className="pl-6 font-medium">
                            <Link
                              to="/loads/$loadId"
                              params={{ loadId: r.loadId }}
                              className="text-primary underline-offset-4 hover:underline"
                            >
                              {r.loadId}
                            </Link>
                          </TableCell>
                          <TableCell>{labelOrRaw(CUSTOMER_LABELS, r.customer)}</TableCell>
                          <TableCell className="text-muted-foreground">{formatLane(r)}</TableCell>
                          <TableCell className="tabular-nums text-muted-foreground">
                            {formatStop(
                              r.pickupDate,
                              r.pickupAppointmentTime,
                              r.pickupWindowStart,
                              r.pickupWindowEnd,
                            )}
                          </TableCell>
                          <TableCell className="tabular-nums text-muted-foreground">
                            {formatStop(
                              r.deliveryDate,
                              r.deliveryAppointmentTime,
                              r.deliveryWindowStart,
                              r.deliveryWindowEnd,
                            )}
                          </TableCell>
                          <TableCell>{labelOrRaw(CARRIER_LABELS, r.assignedCarrier)}</TableCell>
                          <TableCell className="text-muted-foreground">
                            {labelOrRaw(EQUIPMENT_LABELS, r.equipmentType)}
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className={toneBadge[status.tone]}>
                              {status.label}
                            </Badge>
                          </TableCell>
                          <TableCell className="pr-6 text-right font-semibold tabular-nums">
                            {formatRate(r.customerRate)}
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
      </div>
    </div>
  );
}
