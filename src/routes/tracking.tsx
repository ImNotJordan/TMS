import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";
import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  CheckCircle2,
  Clock3,
  Copy,
  Download,
  ExternalLink,
  FileText,
  FileUp,
  Filter,
  Globe2,
  MapPin,
  MessageSquare,
  Navigation,
  RefreshCw,
  Search,
  Send,
  Share2,
  Shield,
  Siren,
  Truck,
  User,
  UserCheck,
  XCircle,
  Zap,
} from "lucide-react";

import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { listAllLoads, type LoadRecord } from "@/lib/loads-store";
import {
  applyDriverAction,
  DRIVER_ACTION_LABELS,
  getDriverAssignedLoads,
  getNextDriverActions,
  getTrackingSessionsSnapshot,
  reportTrackingException,
  sendTrackingMessage,
  subscribeTrackingSessions,
  syncTrackingSessionForLoad,
  TRACKING_STATE_LABELS,
  type TrackingSession,
  type TrackingState,
} from "@/lib/tracking-workflow-store";

export const Route = createFileRoute("/tracking")({
  head: () => ({
    meta: [
      { title: "Tracking — Logistics Software" },
      {
        name: "description",
        content:
          "Live load tracking with driver workflow, GPS progression, geofences, and POD flow.",
      },
    ],
  }),
  component: Page,
});

const toneBadge = {
  success: "bg-success/15 text-success border-success/20",
  warning: "bg-warning/20 text-warning-foreground border-warning/30",
  destructive: "bg-destructive/12 text-destructive border-destructive/20",
  info: "bg-info/15 text-info border-info/20",
  default: "bg-muted text-foreground border-border",
} as const;

function stateTone(state: TrackingState): keyof typeof toneBadge {
  if (["completed", "pod-uploaded", "delivered"].includes(state)) return "success";
  if (["at-pickup", "at-delivery", "waiting-driver"].includes(state)) return "warning";
  if (state === "exception") return "destructive";
  if (["driver-accepted", "en-route-pickup", "in-transit"].includes(state)) return "info";
  return "default";
}

function prettyTime(iso?: string | null) {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function matchSession(session: TrackingSession, query: string) {
  if (!query.trim()) return true;
  const q = query.toLowerCase();
  const hay = [
    session.loadId,
    session.assignedDriverName,
    session.customer,
    session.carrier,
    session.pickup.city,
    session.delivery.city,
    session.trackingState,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return hay.includes(q);
}

function Page() {
  const [loads, setLoads] = React.useState<LoadRecord[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [query, setQuery] = React.useState("");
  const [selectedLoadId, setSelectedLoadId] = React.useState<string | null>(null);
  const [driverId, setDriverId] = React.useState("d-101");
  const [messageText, setMessageText] = React.useState("");
  const sessions = React.useSyncExternalStore(
    subscribeTrackingSessions,
    getTrackingSessionsSnapshot,
    () => [],
  );

  const fetchLoads = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const all = await listAllLoads();
      all.sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
      setLoads(all);
      for (const load of all) {
        syncTrackingSessionForLoad(load, "Dispatcher");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load tracking data.");
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void fetchLoads();
  }, [fetchLoads]);

  const filteredSessions = React.useMemo(
    () => sessions.filter((s) => matchSession(s, query)),
    [sessions, query],
  );

  React.useEffect(() => {
    if (!filteredSessions.length) {
      setSelectedLoadId(null);
      return;
    }
    if (selectedLoadId && !filteredSessions.some((s) => s.loadId === selectedLoadId)) {
      setSelectedLoadId(null);
    }
  }, [filteredSessions, selectedLoadId]);

  const selected = React.useMemo(
    () => filteredSessions.find((s) => s.loadId === selectedLoadId) ?? null,
    [filteredSessions, selectedLoadId],
  );

  const driverAssigned = getDriverAssignedLoads(driverId);

  const counts = React.useMemo(() => {
    const all = sessions;
    return {
      total: all.length,
      waiting: all.filter((s) => s.trackingState === "waiting-driver").length,
      active: all.filter((s) =>
        ["driver-accepted", "en-route-pickup", "at-pickup", "in-transit", "at-delivery"].includes(
          s.trackingState,
        ),
      ).length,
      exception: all.filter((s) => s.trackingState === "exception").length,
      completed: all.filter((s) => s.trackingState === "completed").length,
    };
  }, [sessions]);

  const performAction = (action: Parameters<typeof applyDriverAction>[1], notes?: string) => {
    if (!selected) return;
    applyDriverAction(selected.loadId, action, {
      user: selected.assignedDriverName,
      source: "driver-app",
      notes,
    });
  };

  const sendMessage = () => {
    if (!selected || !messageText.trim()) return;
    sendTrackingMessage(selected.loadId, "ops", messageText);
    setMessageText("");
  };

  return (
    <div>
      <PageHeader
        title="Tracking"
        description="Driver assignment, acceptance workflow, live progress, and delivery proof in one command center."
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={() => void fetchLoads()}
            >
              <RefreshCw className="h-4 w-4" /> Refresh
            </Button>
            <Button variant="outline" size="sm" className="gap-1.5">
              <Share2 className="h-4 w-4" /> Share tracking
            </Button>
            <Button
              size="sm"
              className="gap-1.5 bg-gradient-to-r from-primary to-info text-primary-foreground shadow-sm shadow-primary/30 hover:opacity-95"
            >
              <Download className="h-4 w-4" /> Export activity
            </Button>
          </>
        }
      />

      <div className="space-y-6 px-4 py-6 sm:px-6 lg:px-8">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <Metric label="Tracked Loads" value={String(counts.total)} tone="default" icon={Truck} />
          <Metric
            label="Waiting Driver"
            value={String(counts.waiting)}
            tone="warning"
            icon={Clock3}
          />
          <Metric
            label="Active Sessions"
            value={String(counts.active)}
            tone="info"
            icon={Navigation}
          />
          <Metric
            label="Completed"
            value={String(counts.completed)}
            tone="success"
            icon={CheckCircle2}
          />
          <Metric
            label="Exceptions"
            value={String(counts.exception)}
            tone="destructive"
            icon={Siren}
          />
        </div>

        <div className="grid gap-6 xl:grid-cols-[360px_minmax(0,1fr)]">
          <div className="space-y-6">
            <Card className="border-border/70 shadow-sm">
              <CardContent className="space-y-3 p-4">
                <div className="text-sm font-semibold text-foreground">Driver Portal</div>
                <div className="text-xs text-muted-foreground">Assigned loads for driver ID</div>
                <Input
                  value={driverId}
                  onChange={(e) => setDriverId(e.target.value)}
                  placeholder="Driver ID (e.g. d-101)"
                />
                <div className="space-y-2">
                  {driverAssigned.length === 0 ? (
                    <div className="rounded-md border border-border/70 bg-muted/30 p-2 text-xs text-muted-foreground">
                      No assigned loads for this driver.
                    </div>
                  ) : (
                    driverAssigned.map((s) => (
                      <button
                        key={s.loadId}
                        type="button"
                        onClick={() => setSelectedLoadId(s.loadId)}
                        className="w-full rounded-md border border-border/70 bg-background/60 p-2 text-left hover:bg-muted/30"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="text-sm font-medium text-foreground">{s.loadId}</div>
                          <Badge
                            variant="outline"
                            className={toneBadge[stateTone(s.trackingState)]}
                          >
                            {TRACKING_STATE_LABELS[s.trackingState]}
                          </Badge>
                        </div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          {s.pickup.city}, {s.pickup.state} → {s.delivery.city}, {s.delivery.state}
                        </div>
                      </button>
                    ))
                  )}
                </div>
              </CardContent>
            </Card>

            <Card className="border-border/70 shadow-sm">
              <CardContent className="space-y-3 p-4">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-semibold text-foreground">Tracking Sessions</div>
                  <Badge variant="outline">{filteredSessions.length}</Badge>
                </div>
                <div className="relative">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    className="pl-8"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search load, driver, city…"
                  />
                </div>
                {loading && <div className="text-xs text-muted-foreground">Loading sessions…</div>}
                {error && (
                  <div className="rounded-md border border-destructive/30 bg-destructive/10 p-2 text-xs text-destructive">
                    {error}
                  </div>
                )}
                <div className="max-h-[560px] overflow-auto rounded-md border border-border/70">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Load</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Driver</TableHead>
                        <TableHead>Route</TableHead>
                        <TableHead className="text-right">Updated</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredSessions.length === 0 ? (
                        <TableRow>
                          <TableCell
                            colSpan={5}
                            className="py-6 text-center text-xs text-muted-foreground"
                          >
                            No tracking sessions found.
                          </TableCell>
                        </TableRow>
                      ) : (
                        filteredSessions.map((s) => (
                          <TableRow
                            key={s.loadId}
                            onClick={() => setSelectedLoadId(s.loadId)}
                            data-state={selected?.loadId === s.loadId ? "selected" : undefined}
                            className="cursor-pointer"
                          >
                            <TableCell className="font-semibold">{s.loadId}</TableCell>
                            <TableCell>
                              <Badge
                                variant="outline"
                                className={toneBadge[stateTone(s.trackingState)]}
                              >
                                {TRACKING_STATE_LABELS[s.trackingState]}
                              </Badge>
                            </TableCell>
                            <TableCell>{s.assignedDriverName}</TableCell>
                            <TableCell className="text-muted-foreground">
                              {s.pickup.city}
                              {" -> "}
                              {s.delivery.city}
                            </TableCell>
                            <TableCell className="text-right text-muted-foreground">
                              {prettyTime(s.updatedAt)}
                            </TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          </div>

          {selected ? (
            <div className="space-y-6">
              <Card className="border-border/70 shadow-sm">
                <CardContent className="space-y-4 p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <h2 className="text-xl font-semibold tracking-tight text-foreground">
                          {selected.loadId}
                        </h2>
                        <Badge
                          variant="outline"
                          className={toneBadge[stateTone(selected.trackingState)]}
                        >
                          {TRACKING_STATE_LABELS[selected.trackingState]}
                        </Badge>
                      </div>
                      <div className="mt-1 text-sm text-muted-foreground">
                        {selected.pickup.city}, {selected.pickup.state} → {selected.delivery.city},{" "}
                        {selected.delivery.state}
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        Driver: {selected.assignedDriverName} · Customer: {selected.customer ?? "—"}{" "}
                        · Carrier: {selected.carrier ?? "—"}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-xs uppercase tracking-wide text-muted-foreground">
                        ETA
                      </div>
                      <div className="text-lg font-semibold tabular-nums text-foreground">
                        {prettyTime(selected.eta)}
                      </div>
                      <div className="text-[11px] text-muted-foreground">
                        Last GPS ping {prettyTime(selected.gps.lastPingAt)}
                      </div>
                    </div>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <Fact
                      label="Route Progress"
                      value={`${Math.round(selected.routeProgressPct)}%`}
                    />
                    <Fact label="Miles Remaining" value={String(selected.milesRemaining)} />
                    <Fact label="Speed" value={`${selected.gps.speedMph} mph`} />
                    <Fact
                      label="GPS Location"
                      value={`${selected.gps.location.city ?? "In transit"}${selected.gps.location.state ? `, ${selected.gps.location.state}` : ""}`}
                    />
                  </div>

                  <Progress value={selected.routeProgressPct} className="h-2" />
                  <div className="rounded-xl border border-border/70 bg-gradient-to-br from-muted/25 via-card to-info/10 p-4">
                    <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Live Route + Geofences
                    </div>
                    <div className="mt-2 flex flex-wrap gap-4 text-sm text-foreground">
                      <span className="inline-flex items-center gap-1">
                        <MapPin className="h-4 w-4 text-info" /> Pickup: {selected.pickup.facility}
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <MapPin className="h-4 w-4 text-primary" /> Delivery:{" "}
                        {selected.delivery.facility}
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <Navigation className="h-4 w-4 text-success" />{" "}
                        {selected.gps.location.lat.toFixed(3)},{" "}
                        {selected.gps.location.lng.toFixed(3)}
                      </span>
                    </div>
                    <div className="mt-3 grid gap-2 sm:grid-cols-2 text-xs">
                      <div className="rounded-md border border-border/70 bg-background/60 p-2">
                        Pickup geofence:{" "}
                        {selected.geofence.pickupArrivedAt
                          ? `Arrived ${prettyTime(selected.geofence.pickupArrivedAt)}`
                          : "Pending"}
                      </div>
                      <div className="rounded-md border border-border/70 bg-background/60 p-2">
                        Delivery geofence:{" "}
                        {selected.geofence.deliveryArrivedAt
                          ? `Arrived ${prettyTime(selected.geofence.deliveryArrivedAt)}`
                          : "Pending"}
                      </div>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div className="text-sm font-semibold text-foreground">Driver Actions</div>
                    <div className="flex flex-wrap gap-2">
                      {getNextDriverActions(selected.trackingState).map((action) => (
                        <Button
                          key={action}
                          size="sm"
                          variant="outline"
                          className="gap-1.5"
                          onClick={() => performAction(action)}
                        >
                          <Zap className="h-3.5 w-3.5" /> {DRIVER_ACTION_LABELS[action]}
                        </Button>
                      ))}
                      {selected.trackingState === "waiting-driver" && (
                        <>
                          <Button
                            size="sm"
                            className="gap-1.5 bg-success text-success-foreground hover:bg-success/90"
                            onClick={() =>
                              performAction("accept-load", "Driver accepted in portal.")
                            }
                          >
                            <UserCheck className="h-3.5 w-3.5" /> Accept Load
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="gap-1.5 text-destructive hover:bg-destructive/10"
                            onClick={() =>
                              performAction("decline-load", "Driver declined assignment.")
                            }
                          >
                            <XCircle className="h-3.5 w-3.5" /> Decline Load
                          </Button>
                        </>
                      )}
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-1.5 text-warning-foreground"
                        onClick={() =>
                          reportTrackingException(
                            selected.loadId,
                            "Manual exception reported by dispatch.",
                            "Dispatcher",
                          )
                        }
                      >
                        <AlertTriangle className="h-3.5 w-3.5" /> Report Exception
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="border-border/70 shadow-sm">
                <CardContent className="p-4">
                  <Tabs defaultValue="timeline">
                    <TabsList className="w-full">
                      <TabsTrigger value="timeline" className="flex-1 gap-1.5">
                        <Activity className="h-3.5 w-3.5" /> Timeline
                      </TabsTrigger>
                      <TabsTrigger value="alerts" className="flex-1 gap-1.5">
                        <Siren className="h-3.5 w-3.5" /> Alerts
                      </TabsTrigger>
                      <TabsTrigger value="messages" className="flex-1 gap-1.5">
                        <MessageSquare className="h-3.5 w-3.5" /> Messages
                      </TabsTrigger>
                      <TabsTrigger value="documents" className="flex-1 gap-1.5">
                        <FileText className="h-3.5 w-3.5" /> Documents
                      </TabsTrigger>
                      <TabsTrigger value="history" className="flex-1 gap-1.5">
                        <Shield className="h-3.5 w-3.5" /> History
                      </TabsTrigger>
                    </TabsList>

                    <TabsContent
                      value="timeline"
                      className="mt-4 max-h-[520px] space-y-2 overflow-y-auto pr-1"
                    >
                      {selected.timeline.map((event) => (
                        <div
                          key={event.id}
                          className="rounded-md border border-border/70 bg-background/60 p-3"
                        >
                          <div className="flex items-center justify-between gap-3">
                            <div className="text-sm font-medium text-foreground">
                              {event.action === "driver-assigned"
                                ? "Driver Assigned"
                                : event.action === "exception-reported"
                                  ? "Exception Reported"
                                  : event.action === "auto-completed"
                                    ? "Tracking Completed"
                                    : DRIVER_ACTION_LABELS[event.action]}
                            </div>
                            <Badge variant="outline" className={toneBadge[stateTone(event.state)]}>
                              {TRACKING_STATE_LABELS[event.state]}
                            </Badge>
                          </div>
                          <div className="mt-1 text-xs text-muted-foreground">
                            {prettyTime(event.timestamp)} · {event.user} · {event.source}
                          </div>
                          <div className="mt-1 text-xs text-muted-foreground">
                            {(event.location.label ??
                              [event.location.city, event.location.state]
                                .filter(Boolean)
                                .join(", ")) ||
                              `${event.location.lat.toFixed(3)}, ${event.location.lng.toFixed(3)}`}
                          </div>
                          {event.notes && (
                            <div className="mt-2 text-sm text-foreground">{event.notes}</div>
                          )}
                        </div>
                      ))}
                    </TabsContent>

                    <TabsContent value="alerts" className="mt-4 space-y-2">
                      {selected.alerts.length === 0 ? (
                        <div className="rounded-md border border-border/70 bg-muted/30 p-3 text-sm text-muted-foreground">
                          No active alerts.
                        </div>
                      ) : (
                        selected.alerts.map((alert) => (
                          <div
                            key={alert.id}
                            className="rounded-md border border-border/70 bg-background/60 p-3"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <div className="text-sm font-medium text-foreground">
                                {alert.title}
                              </div>
                              <Badge variant="outline" className={toneBadge[alert.tone]}>
                                {alert.tone}
                              </Badge>
                            </div>
                            <div className="mt-1 text-xs text-muted-foreground">
                              {prettyTime(alert.timestamp)}
                            </div>
                            <div className="mt-1 text-sm text-foreground">{alert.detail}</div>
                          </div>
                        ))
                      )}
                    </TabsContent>

                    <TabsContent value="messages" className="mt-4 space-y-3">
                      <div className="max-h-[380px] space-y-2 overflow-y-auto pr-1">
                        {selected.messages.map((message) => (
                          <div
                            key={message.id}
                            className="rounded-md border border-border/70 bg-background/60 p-3"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <Badge
                                variant="outline"
                                className={
                                  toneBadge[
                                    message.from === "system"
                                      ? "info"
                                      : message.from === "driver"
                                        ? "warning"
                                        : "default"
                                  ]
                                }
                              >
                                {message.from}
                              </Badge>
                              <div className="text-xs text-muted-foreground">
                                {prettyTime(message.timestamp)}
                              </div>
                            </div>
                            <div className="mt-1 text-sm text-foreground">{message.text}</div>
                          </div>
                        ))}
                      </div>
                      <div className="flex gap-2">
                        <Input
                          value={messageText}
                          onChange={(e) => setMessageText(e.target.value)}
                          placeholder="Message driver, dispatcher, or customer…"
                        />
                        <Button className="gap-1.5" onClick={sendMessage}>
                          <Send className="h-4 w-4" /> Send
                        </Button>
                      </div>
                    </TabsContent>

                    <TabsContent value="documents" className="mt-4 space-y-2">
                      <div className="flex flex-wrap gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          className="gap-1.5"
                          onClick={() => performAction("upload-pod", "POD uploaded by driver app.")}
                        >
                          <FileUp className="h-3.5 w-3.5" /> Upload POD
                        </Button>
                        <Button size="sm" variant="outline" className="gap-1.5">
                          <Download className="h-3.5 w-3.5" /> Download packet
                        </Button>
                      </div>
                      {selected.documents.map((doc) => (
                        <div
                          key={doc.id}
                          className="flex items-center justify-between gap-2 rounded-md border border-border/70 bg-background/60 p-3"
                        >
                          <div>
                            <div className="text-sm font-medium text-foreground">{doc.name}</div>
                            <div className="text-xs text-muted-foreground">
                              {doc.type} ·{" "}
                              {doc.uploadedAt
                                ? `uploaded ${prettyTime(doc.uploadedAt)}`
                                : "not uploaded"}
                            </div>
                          </div>
                          <Badge
                            variant="outline"
                            className={
                              toneBadge[
                                doc.status === "Received"
                                  ? "success"
                                  : doc.status === "Pending"
                                    ? "warning"
                                    : "info"
                              ]
                            }
                          >
                            {doc.status}
                          </Badge>
                        </div>
                      ))}
                    </TabsContent>

                    <TabsContent value="history" className="mt-4 space-y-2">
                      {selected.timeline
                        .slice()
                        .reverse()
                        .map((event) => (
                          <div
                            key={`h-${event.id}`}
                            className="rounded-md border border-border/70 bg-muted/20 p-3"
                          >
                            <div className="flex items-center justify-between">
                              <div className="text-sm font-medium text-foreground">
                                {prettyTime(event.timestamp)}
                              </div>
                              <div className="text-xs text-muted-foreground">{event.source}</div>
                            </div>
                            <div className="mt-1 text-xs text-muted-foreground">
                              {event.user} · {TRACKING_STATE_LABELS[event.state]}
                            </div>
                          </div>
                        ))}
                    </TabsContent>
                  </Tabs>
                </CardContent>
              </Card>

              <Card className="border-border/70 shadow-sm">
                <CardContent className="space-y-3 p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-sm font-semibold text-foreground">
                        Customer Tracking Link
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Shareable read-only tracking experience
                      </div>
                    </div>
                    <Badge variant="outline" className={toneBadge.success}>
                      Active
                    </Badge>
                  </div>
                  <div className="flex items-center gap-2 rounded-md border border-border/70 bg-background/60 px-2 py-1.5">
                    <Globe2 className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="truncate font-mono text-xs text-muted-foreground">
                      {selected.customerTrackingLink}
                    </span>
                    <Button size="icon" variant="ghost" className="ml-auto h-7 w-7">
                      <Copy className="h-3.5 w-3.5" />
                    </Button>
                    <Button size="icon" variant="ghost" className="h-7 w-7">
                      <ExternalLink className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Includes live state, route progress, ETA, and timeline while hiding internal
                    pricing.
                  </div>
                </CardContent>
              </Card>
            </div>
          ) : (
            <Card className="border-border/70 shadow-sm">
              <CardContent className="p-8 text-center text-muted-foreground">
                Select a row in the Tracking Sessions table to view full details.
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

function Metric({
  label,
  value,
  tone,
  icon: Icon,
}: {
  label: string;
  value: string;
  tone: keyof typeof toneBadge;
  icon: typeof Truck;
}) {
  return (
    <Card className="border-border/70 shadow-sm">
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {label}
          </div>
          <span
            className={`flex h-7 w-7 items-center justify-center rounded-md ${toneBadge[tone]}`}
          >
            <Icon className="h-3.5 w-3.5" />
          </span>
        </div>
        <div className="mt-2 text-2xl font-semibold tracking-tight text-foreground">{value}</div>
      </CardContent>
    </Card>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border/70 bg-background/60 p-2.5">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 text-sm font-semibold tabular-nums text-foreground">{value}</div>
    </div>
  );
}
