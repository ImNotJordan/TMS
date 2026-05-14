import { createFileRoute } from "@tanstack/react-router";
import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  Battery,
  BellRing,
  CalendarClock,
  Camera,
  ChevronRight,
  CircleDot,
  CircleDashed,
  CloudRain,
  Compass,
  Copy,
  CheckCircle2,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  FileCheck2,
  FileText,
  FileUp,
  Flag,
  Gauge,
  Globe2,
  History,
  Layers,
  Link2,
  Loader2,
  Lock,
  Mail,
  Map as MapIcon,
  MapPin,
  Maximize2,
  MessageSquare,
  MoreHorizontal,
  Navigation,
  Paperclip,
  Phone,
  PhoneCall,
  RefreshCw,
  Route as RouteIcon,
  Send,
  Share2,
  Shield,
  ShieldAlert,
  Signal,
  Snowflake,
  Sparkles,
  Thermometer,
  Timer,
  Truck,
  User,
  Zap,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PageHeader } from "@/components/page-header";

export const Route = createFileRoute("/tracking")({
  head: () => ({
    meta: [
      { title: "Tracking — Logistics Software" },
      {
        name: "description",
        content: "Live shipment visibility, ETA prediction, and milestone alerts.",
      },
    ],
  }),
  component: Page,
});

/* ───────────────────────── Tone helpers ───────────────────────── */

const toneBadge = {
  success: "bg-success/15 text-success border-success/20",
  warning: "bg-warning/20 text-warning-foreground border-warning/30",
  destructive: "bg-destructive/12 text-destructive border-destructive/20",
  info: "bg-info/15 text-info border-info/20",
  default: "bg-muted text-foreground border-border",
} as const;

const toneStat = {
  success: "bg-success/15 text-success",
  warning: "bg-warning/20 text-warning-foreground",
  destructive: "bg-destructive/12 text-destructive",
  info: "bg-info/15 text-info",
  default: "bg-muted text-foreground",
} as const;

type Tone = keyof typeof toneBadge;

/* ───────────────────────── Mock data ───────────────────────── */

const LOAD = {
  id: "L-2841",
  customer: "Acme Foods",
  carrier: "Bluepeak Freight",
  carrierMc: "MC 887412",
  driver: "Devon Carter",
  driverInitials: "DC",
  driverPhone: "+1 (404) 555-0142",
  dispatcher: "Jamie Taylor",
  equipment: "Reefer · 53'",
  commodity: "Frozen seafood · 28 pallets",
  weight: "41,200 lbs",
  pickup: { city: "Atlanta, GA", facility: "Acme DC #4 · Dock 12", time: "May 14 · 09:00" },
  delivery: { city: "Dallas, TX", facility: "Acme Cold Hub · Dock 03", time: "May 15 · 14:00" },
  status: "In Transit",
  statusTone: "info" as Tone,
  etaUpdated: "May 15 · 13:42",
  etaOriginal: "May 15 · 14:00",
  delayMin: -18,
  milesTotal: 781,
  milesRemaining: 312,
  driveTimeRemaining: "4h 48m",
  progress: 60,
  reefer: { set: 0, current: -2, min: -4, max: 2, unit: "°F" },
  customerLink: "https://track.logistics.app/t/L-2841-9F4K",
};

const STATS = [
  {
    label: "ETA (updated)",
    value: "13:42",
    sub: "8 min early",
    icon: CalendarClock,
    tone: "success" as Tone,
  },
  {
    label: "Miles remaining",
    value: "312",
    sub: "of 781 mi",
    icon: RouteIcon,
    tone: "info" as Tone,
  },
  {
    label: "Drive time left",
    value: "4h 48m",
    sub: "HOS · 6h 10m",
    icon: Timer,
    tone: "default" as Tone,
  },
  {
    label: "Reefer temp",
    value: "−2°F",
    sub: "set −0°F · in range",
    icon: Snowflake,
    tone: "info" as Tone,
  },
];

const TIMELINE: { label: string; time?: string; state: "done" | "current" | "todo"; note?: string }[] = [
  { label: "Created", time: "May 13 · 11:04", state: "done" },
  { label: "Booked", time: "May 13 · 13:20", state: "done" },
  { label: "Dispatched", time: "May 13 · 16:48", state: "done" },
  { label: "Driver assigned", time: "May 13 · 16:51", state: "done", note: "Devon Carter" },
  { label: "En route to pickup", time: "May 14 · 07:30", state: "done" },
  { label: "Arrived at pickup", time: "May 14 · 08:42", state: "done", note: "Geofence trigger" },
  { label: "Checked in · Loading", time: "May 14 · 08:55", state: "done" },
  { label: "Loaded · Departed pickup", time: "May 14 · 10:12", state: "done" },
  { label: "In transit", time: "since 10:12", state: "current", note: "Hwy I-20 W · 62 mph" },
  { label: "Arrived at delivery", state: "todo" },
  { label: "Unloading", state: "todo" },
  { label: "Delivered · POD uploaded", state: "todo" },
  { label: "Invoiced", state: "todo" },
];

const ALERTS: { title: string; desc: string; tone: Tone; icon: typeof AlertTriangle; time: string }[] = [
  {
    title: "Detention risk · pickup",
    desc: "Driver waited 1h 17m at Acme DC #4 — flagged for billing.",
    tone: "warning",
    icon: Timer,
    time: "2h ago",
  },
  {
    title: "Weather advisory",
    desc: "Thunderstorms expected near Shreveport, LA · +25 min impact.",
    tone: "warning",
    icon: CloudRain,
    time: "32m ago",
  },
  {
    title: "ETA improved by 8 min",
    desc: "Traffic cleared on I-20 — new ETA 13:42.",
    tone: "success",
    icon: Sparkles,
    time: "9m ago",
  },
  {
    title: "GPS signal restored",
    desc: "Lost ping 04:21–04:28 in low-coverage area.",
    tone: "info",
    icon: Signal,
    time: "1h ago",
  },
];

const STOPS: {
  seq: number;
  type: "Pickup" | "Stop" | "Delivery";
  city: string;
  facility: string;
  appt: string;
  status: "Departed" | "Arrived" | "En route" | "Pending";
  tone: Tone;
  contact: string;
}[] = [
  {
    seq: 1,
    type: "Pickup",
    city: "Atlanta, GA",
    facility: "Acme DC #4 · Dock 12",
    appt: "May 14 · 09:00",
    status: "Departed",
    tone: "success",
    contact: "M. Hayes · 404-555-0190",
  },
  {
    seq: 2,
    type: "Stop",
    city: "Birmingham, AL",
    facility: "Crossdock 7",
    appt: "May 14 · 13:30",
    status: "Departed",
    tone: "success",
    contact: "R. Pollard · 205-555-0144",
  },
  {
    seq: 3,
    type: "Stop",
    city: "Shreveport, LA",
    facility: "Fuel + Rest",
    appt: "May 15 · 04:15",
    status: "En route",
    tone: "info",
    contact: "—",
  },
  {
    seq: 4,
    type: "Delivery",
    city: "Dallas, TX",
    facility: "Acme Cold Hub · Dock 03",
    appt: "May 15 · 14:00",
    status: "Pending",
    tone: "default",
    contact: "T. Nguyen · 214-555-0177",
  },
];

const DOCUMENTS: {
  name: string;
  type: "BOL" | "POD" | "Lumper" | "Photo" | "Rate Conf.";
  status: "Received" | "Pending" | "Required";
  tone: Tone;
  size?: string;
}[] = [
  { name: "Rate confirmation.pdf", type: "Rate Conf.", status: "Received", tone: "success", size: "128 KB" },
  { name: "BOL signed at Atlanta.pdf", type: "BOL", status: "Received", tone: "success", size: "412 KB" },
  { name: "Lumper receipt #4429.jpg", type: "Lumper", status: "Received", tone: "success", size: "1.2 MB" },
  { name: "Pickup dock photo.jpg", type: "Photo", status: "Received", tone: "success", size: "2.0 MB" },
  { name: "Proof of delivery", type: "POD", status: "Pending", tone: "warning" },
  { name: "Temperature log", type: "Photo", status: "Required", tone: "info" },
];

const MESSAGES: { from: "driver" | "ops" | "system"; text: string; time: string }[] = [
  { from: "ops", text: "Heads up — appt window tightens after 14:30. Push to make 14:00.", time: "08:52" },
  { from: "driver", text: "Loaded, sealed (#992141). Rolling now.", time: "10:14" },
  { from: "system", text: "Geofence: departed Atlanta pickup.", time: "10:15" },
  { from: "ops", text: "Acknowledged. Tracking link sent to Acme.", time: "10:18" },
  { from: "driver", text: "Storm cell ahead near Shreveport, slowing down.", time: "12:05" },
];

const HISTORY: { time: string; event: string; source: string; tone: Tone }[] = [
  { time: "May 15 · 12:18", event: "Speed −12 mph · weather slowdown", source: "Telematics", tone: "warning" },
  { time: "May 15 · 11:02", event: "Crossed TX state line", source: "Geofence", tone: "info" },
  { time: "May 15 · 09:40", event: "Customer notification sent · ETA updated", source: "System", tone: "info" },
  { time: "May 15 · 04:28", event: "GPS signal restored", source: "ELD", tone: "success" },
  { time: "May 14 · 22:15", event: "Driver off-duty · 10h reset", source: "HOS", tone: "default" },
  { time: "May 14 · 10:15", event: "Departed pickup · Atlanta, GA", source: "Geofence", tone: "success" },
  { time: "May 14 · 08:55", event: "Checked in · dock 12", source: "Driver app", tone: "info" },
  { time: "May 14 · 08:42", event: "Arrived at pickup", source: "Geofence", tone: "success" },
];

const ANALYTICS = [
  { label: "On-time pickup", value: "98.2%", sub: "30-day avg", tone: "success" as Tone, icon: CheckCircle2 },
  { label: "On-time delivery", value: "96.4%", sub: "30-day avg", tone: "success" as Tone, icon: Flag },
  { label: "Avg dwell", value: "1h 24m", sub: "−6m vs avg", tone: "info" as Tone, icon: Timer },
  { label: "Tracking compliance", value: "99.1%", sub: "GPS ping > 5m", tone: "success" as Tone, icon: Shield },
];

/* ───────────────────────── Map ───────────────────────── */

function LiveMap() {
  // Route points (percent coords) for an Atlanta → Dallas-ish arc
  const points: { x: number; y: number; label: string; kind: "pickup" | "stop" | "delivery" }[] = [
    { x: 86, y: 56, label: "Atlanta, GA", kind: "pickup" },
    { x: 74, y: 60, label: "Birmingham, AL", kind: "stop" },
    { x: 42, y: 68, label: "Shreveport, LA", kind: "stop" },
    { x: 18, y: 72, label: "Dallas, TX", kind: "delivery" },
  ];
  const driver = { x: 50, y: 65 };

  return (
    <div className="relative h-[420px] overflow-hidden rounded-xl border border-border bg-gradient-to-br from-sidebar/95 via-sidebar to-sidebar/90">
      {/* grid */}
      <svg className="absolute inset-0 h-full w-full opacity-30" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <pattern id="t-grid" width="36" height="36" patternUnits="userSpaceOnUse">
            <path d="M 36 0 L 0 0 0 36" fill="none" stroke="oklch(0.55 0.16 255)" strokeOpacity="0.25" strokeWidth="0.5" />
          </pattern>
          <radialGradient id="t-glow" cx="50%" cy="65%" r="50%">
            <stop offset="0%" stopColor="oklch(0.65 0.18 250)" stopOpacity="0.35" />
            <stop offset="100%" stopColor="oklch(0.65 0.18 250)" stopOpacity="0" />
          </radialGradient>
        </defs>
        <rect width="100%" height="100%" fill="url(#t-grid)" />
        <rect width="100%" height="100%" fill="url(#t-glow)" />
      </svg>

      {/* coastline silhouettes */}
      <svg className="absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none">
        <path
          d="M -2 78 Q 20 70 38 76 T 78 72 T 102 78 L 102 102 L -2 102 Z"
          fill="oklch(0.55 0.16 255 / 0.18)"
        />
        <path
          d="M -2 86 Q 30 80 55 84 T 102 82 L 102 102 L -2 102 Z"
          fill="oklch(0.55 0.16 255 / 0.10)"
        />
      </svg>

      {/* completed route */}
      <svg className="absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none">
        <path
          d={`M ${points[0].x} ${points[0].y} Q ${(points[0].x + driver.x) / 2} ${points[0].y - 6}, ${driver.x} ${driver.y}`}
          stroke="oklch(0.7 0.16 150)"
          strokeWidth="0.7"
          strokeLinecap="round"
          fill="none"
        />
        {/* remaining route (dashed) */}
        <path
          d={`M ${driver.x} ${driver.y} Q ${(driver.x + points[3].x) / 2} ${driver.y - 8}, ${points[3].x} ${points[3].y}`}
          stroke="oklch(0.65 0.18 250)"
          strokeWidth="0.7"
          strokeDasharray="1.4 1.2"
          strokeLinecap="round"
          fill="none"
        />
      </svg>

      {/* geofence around delivery */}
      <div
        className="absolute h-20 w-20 -translate-x-1/2 -translate-y-1/2 rounded-full border border-info/40 bg-info/10"
        style={{ left: `${points[3].x}%`, top: `${points[3].y}%` }}
      />

      {/* stop pins */}
      {points.map((p) => {
        const isPickup = p.kind === "pickup";
        const isDelivery = p.kind === "delivery";
        const cls = isPickup
          ? "bg-success text-success-foreground"
          : isDelivery
            ? "bg-info text-info-foreground"
            : "bg-sidebar-accent text-sidebar-accent-foreground";
        return (
          <div
            key={p.label}
            className="group absolute -translate-x-1/2 -translate-y-1/2"
            style={{ left: `${p.x}%`, top: `${p.y}%` }}
          >
            <div
              className={`flex h-7 w-7 items-center justify-center rounded-full shadow-md ring-4 ring-sidebar/70 ${cls}`}
            >
              {isPickup ? (
                <Flag className="h-3.5 w-3.5" />
              ) : isDelivery ? (
                <MapPin className="h-3.5 w-3.5" />
              ) : (
                <CircleDot className="h-3 w-3" />
              )}
            </div>
            <div className="pointer-events-none absolute left-1/2 top-full mt-1 -translate-x-1/2 whitespace-nowrap rounded-md bg-popover px-2 py-0.5 text-[10px] font-medium text-popover-foreground opacity-0 shadow-md transition-opacity group-hover:opacity-100">
              {p.label}
            </div>
          </div>
        );
      })}

      {/* live driver pin */}
      <div
        className="absolute -translate-x-1/2 -translate-y-1/2"
        style={{ left: `${driver.x}%`, top: `${driver.y}%` }}
      >
        <span className="absolute inset-0 -m-2 animate-ping rounded-full bg-primary/30" />
        <div className="relative flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-primary to-info text-primary-foreground shadow-lg ring-4 ring-sidebar/80">
          <Truck className="h-4 w-4" />
        </div>
        <div className="absolute left-1/2 top-full mt-1.5 -translate-x-1/2 whitespace-nowrap rounded-md bg-popover px-2 py-1 text-[11px] font-semibold text-popover-foreground shadow-md">
          {LOAD.driver} · 62 mph
        </div>
      </div>

      {/* Map header chips */}
      <div className="absolute left-3 top-3 flex flex-wrap items-center gap-1.5">
        <Badge className="gap-1 border-0 bg-sidebar-accent text-sidebar-accent-foreground">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success/70" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-success" />
          </span>
          Live · pinged 12s ago
        </Badge>
        <Badge variant="outline" className="border-sidebar-border bg-sidebar/60 text-sidebar-foreground">
          I-20 W · Mile 412
        </Badge>
      </div>

      {/* overlay toggles */}
      <div className="absolute right-3 top-3 flex flex-col gap-1.5">
        {[
          { icon: RouteIcon, label: "Traffic", active: true },
          { icon: CloudRain, label: "Weather", active: true },
          { icon: Layers, label: "Geofences", active: true },
          { icon: Globe2, label: "Satellite", active: false },
        ].map(({ icon: Icon, label, active }) => (
          <button
            key={label}
            type="button"
            className={`flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-medium backdrop-blur transition-colors ${
              active
                ? "bg-sidebar-accent/90 text-sidebar-accent-foreground"
                : "bg-sidebar/60 text-sidebar-foreground/70 hover:text-sidebar-foreground"
            }`}
          >
            <Icon className="h-3 w-3" />
            {label}
          </button>
        ))}
      </div>

      {/* legend + fullscreen */}
      <div className="absolute bottom-3 left-3 flex items-center gap-2 rounded-md bg-sidebar/70 px-2.5 py-1.5 text-[11px] text-sidebar-foreground backdrop-blur">
        <span className="flex items-center gap-1">
          <span className="h-2 w-3 rounded-full bg-success" /> Completed
        </span>
        <span className="text-sidebar-border">·</span>
        <span className="flex items-center gap-1">
          <span className="h-2 w-3 rounded-full bg-info" /> Remaining
        </span>
        <span className="text-sidebar-border">·</span>
        <span className="flex items-center gap-1">
          <span className="h-2 w-2 rounded-full bg-primary" /> Driver
        </span>
      </div>
      <div className="absolute bottom-3 right-3 flex items-center gap-1.5">
        <Button size="sm" variant="secondary" className="h-7 gap-1.5 bg-sidebar-accent text-sidebar-accent-foreground hover:bg-sidebar-accent/80">
          <RefreshCw className="h-3 w-3" /> Refresh
        </Button>
        <Button size="icon" variant="secondary" className="h-7 w-7 bg-sidebar-accent text-sidebar-accent-foreground hover:bg-sidebar-accent/80">
          <Maximize2 className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* progress bar overlay */}
      <div className="absolute inset-x-3 bottom-12 rounded-md bg-sidebar/70 p-2.5 backdrop-blur">
        <div className="flex items-center justify-between text-[11px] text-sidebar-foreground">
          <span className="font-medium">Atlanta, GA</span>
          <span className="text-sidebar-foreground/70">
            {LOAD.progress}% · {LOAD.milesTotal - LOAD.milesRemaining} / {LOAD.milesTotal} mi
          </span>
          <span className="font-medium">Dallas, TX</span>
        </div>
        <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-sidebar-border/60">
          <div
            className="h-full rounded-full bg-gradient-to-r from-success via-info to-primary"
            style={{ width: `${LOAD.progress}%` }}
          />
        </div>
      </div>
    </div>
  );
}

/* ───────────────────────── Sub-blocks ───────────────────────── */

function QuickActions() {
  const actions: { icon: typeof MessageSquare; label: string; primary?: boolean }[] = [
    { icon: MessageSquare, label: "Message" },
    { icon: PhoneCall, label: "Call driver" },
    { icon: Share2, label: "Share link", primary: true },
    { icon: BellRing, label: "Update status" },
    { icon: AlertTriangle, label: "Add exception" },
    { icon: Navigation, label: "Request location" },
    { icon: FileUp, label: "Upload POD" },
    { icon: Mail, label: "Notify customer" },
    { icon: CheckCircle2, label: "Mark delivered" },
  ];
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {actions.map((a) => {
        const Icon = a.icon;
        return (
          <Button
            key={a.label}
            size="sm"
            variant={a.primary ? "default" : "outline"}
            className={
              a.primary
                ? "h-8 gap-1.5 bg-gradient-to-r from-primary to-info text-primary-foreground shadow-sm shadow-primary/30 hover:opacity-95"
                : "h-8 gap-1.5"
            }
          >
            <Icon className="h-3.5 w-3.5" />
            {a.label}
          </Button>
        );
      })}
    </div>
  );
}

function LoadHero() {
  return (
    <Card className="overflow-hidden border-border/70 shadow-sm">
      <CardContent className="p-0">
        <div className="relative bg-gradient-to-r from-primary/8 via-info/8 to-transparent px-4 py-4 sm:px-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-primary to-info text-primary-foreground shadow-sm">
                <Truck className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-lg font-semibold tracking-tight text-foreground">
                    {LOAD.id}
                  </span>
                  <Badge variant="outline" className={toneBadge[LOAD.statusTone]}>
                    <span className="mr-1 flex h-1.5 w-1.5 rounded-full bg-info" />
                    {LOAD.status}
                  </Badge>
                  <Badge variant="outline" className={toneBadge.success}>
                    8 min early
                  </Badge>
                  <Badge variant="outline" className={toneBadge.warning}>
                    <CloudRain className="mr-1 h-3 w-3" /> Weather watch
                  </Badge>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                  <span className="inline-flex items-center gap-1">
                    <User className="h-3 w-3" /> {LOAD.customer}
                  </span>
                  <span>·</span>
                  <span>{LOAD.equipment}</span>
                  <span>·</span>
                  <span>{LOAD.commodity}</span>
                  <span>·</span>
                  <span>{LOAD.weight}</span>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <div className="rounded-lg border border-border/70 bg-background/60 px-3 py-2">
                <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  ETA · Dallas
                </div>
                <div className="flex items-baseline gap-1">
                  <span className="text-base font-semibold tabular-nums text-foreground">
                    May 15 · 13:42
                  </span>
                  <span className="text-[11px] text-success">−18m</span>
                </div>
              </div>
              <div className="flex items-center gap-2 rounded-lg border border-border/70 bg-background/60 px-3 py-1.5">
                <Avatar className="h-8 w-8">
                  <AvatarFallback className="bg-primary/15 text-xs font-semibold text-primary">
                    {LOAD.driverInitials}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-foreground">
                    {LOAD.driver}
                  </div>
                  <div className="truncate text-[11px] text-muted-foreground">
                    {LOAD.carrier} · {LOAD.carrierMc}
                  </div>
                </div>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7 text-muted-foreground hover:text-foreground"
                >
                  <Phone className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          </div>

          <Separator className="my-4" />

          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-1 items-stretch gap-3">
              <RoutePoint
                tone="success"
                title="Pickup · departed"
                city={LOAD.pickup.city}
                facility={LOAD.pickup.facility}
                time={LOAD.pickup.time}
              />
              <div className="hidden flex-1 items-center sm:flex">
                <div className="relative h-0.5 w-full rounded-full bg-gradient-to-r from-success via-info to-primary/40">
                  <span className="absolute -top-1.5 left-[60%] flex h-4 w-4 -translate-x-1/2 items-center justify-center rounded-full bg-background ring-2 ring-primary">
                    <Truck className="h-2.5 w-2.5 text-primary" />
                  </span>
                </div>
              </div>
              <RoutePoint
                tone="info"
                title="Delivery · upcoming"
                city={LOAD.delivery.city}
                facility={LOAD.delivery.facility}
                time={LOAD.delivery.time}
                right
              />
            </div>
          </div>

          <Separator className="my-4" />

          <QuickActions />
        </div>
      </CardContent>
    </Card>
  );
}

function RoutePoint({
  tone,
  title,
  city,
  facility,
  time,
  right,
}: {
  tone: Tone;
  title: string;
  city: string;
  facility: string;
  time: string;
  right?: boolean;
}) {
  return (
    <div className={`flex min-w-0 items-start gap-2 ${right ? "sm:text-right" : ""}`}>
      <span className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${toneStat[tone]}`}>
        {right ? <MapPin className="h-3.5 w-3.5" /> : <Flag className="h-3.5 w-3.5" />}
      </span>
      <div className="min-w-0">
        <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          {title}
        </div>
        <div className="truncate text-sm font-semibold text-foreground">{city}</div>
        <div className="truncate text-xs text-muted-foreground">{facility}</div>
        <div className="text-[11px] tabular-nums text-muted-foreground">{time}</div>
      </div>
    </div>
  );
}

function StatsStrip() {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {STATS.map((s) => {
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
                <div className="text-2xl font-semibold tabular-nums tracking-tight text-foreground">
                  {s.value}
                </div>
                <Badge variant="secondary" className={toneStat[s.tone]}>
                  {s.sub}
                </Badge>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

function DriverLocationCard() {
  const fields: { icon: typeof Compass; label: string; value: string }[] = [
    { icon: Navigation, label: "Heading", value: "W · 268°" },
    { icon: Gauge, label: "Speed", value: "62 mph" },
    { icon: Compass, label: "Coords", value: "32.5°N · 93.7°W" },
    { icon: MapPin, label: "Near", value: "Shreveport, LA" },
    { icon: RouteIcon, label: "From pickup", value: "469 mi" },
    { icon: Flag, label: "To delivery", value: "312 mi" },
    { icon: Signal, label: "Accuracy", value: "±8 m" },
    { icon: Battery, label: "Device", value: "84% · Strong" },
  ];
  return (
    <Card className="border-border/70 shadow-sm">
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/15 text-primary">
              <Navigation className="h-3.5 w-3.5" />
            </span>
            <div>
              <div className="text-sm font-semibold text-foreground">Driver location</div>
              <div className="text-[11px] text-muted-foreground">
                Last ping <span className="tabular-nums">12 seconds ago</span> · GPS
              </div>
            </div>
          </div>
          <Button size="sm" variant="outline" className="h-7 gap-1.5">
            <RefreshCw className="h-3 w-3" /> Ping
          </Button>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {fields.map((f) => {
            const Icon = f.icon;
            return (
              <div
                key={f.label}
                className="rounded-md border border-border/60 bg-background/40 px-2.5 py-2"
              >
                <div className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                  <Icon className="h-3 w-3" /> {f.label}
                </div>
                <div className="mt-0.5 text-sm font-medium tabular-nums text-foreground">
                  {f.value}
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

function ReeferCard() {
  return (
    <Card className="border-border/70 shadow-sm">
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-md bg-info/15 text-info">
              <Thermometer className="h-3.5 w-3.5" />
            </span>
            <div>
              <div className="text-sm font-semibold text-foreground">Reefer temperature</div>
              <div className="text-[11px] text-muted-foreground">
                Set −0°F · range −4°F to +2°F
              </div>
            </div>
          </div>
          <Badge variant="outline" className={toneBadge.success}>
            In range
          </Badge>
        </div>
        <div className="mt-3 flex items-baseline gap-2">
          <span className="text-3xl font-semibold tabular-nums text-foreground">−2°F</span>
          <span className="text-xs text-muted-foreground">unit running · door closed</span>
        </div>
        {/* sparkline */}
        <svg viewBox="0 0 200 50" className="mt-2 h-12 w-full">
          <defs>
            <linearGradient id="t-temp" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="oklch(0.62 0.14 230)" stopOpacity="0.45" />
              <stop offset="100%" stopColor="oklch(0.62 0.14 230)" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path
            d="M0 30 L20 28 L40 25 L60 27 L80 24 L100 26 L120 22 L140 28 L160 24 L180 27 L200 25 L200 50 L0 50 Z"
            fill="url(#t-temp)"
          />
          <path
            d="M0 30 L20 28 L40 25 L60 27 L80 24 L100 26 L120 22 L140 28 L160 24 L180 27 L200 25"
            stroke="oklch(0.62 0.14 230)"
            strokeWidth="1.5"
            fill="none"
          />
        </svg>
        <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground">
          <span>−12h</span>
          <span className="flex items-center gap-1">
            <Snowflake className="h-3 w-3 text-info" /> Compliant
          </span>
          <span>now</span>
        </div>
      </CardContent>
    </Card>
  );
}

function StopsCard() {
  return (
    <Card className="border-border/70 shadow-sm">
      <CardContent className="p-0">
        <div className="flex items-center justify-between border-b border-border/70 px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/15 text-primary">
              <RouteIcon className="h-3.5 w-3.5" />
            </span>
            <div>
              <div className="text-sm font-semibold text-foreground">Stops & geofences</div>
              <div className="text-[11px] text-muted-foreground">
                Auto check-in radius · 250 m
              </div>
            </div>
          </div>
          <Button size="sm" variant="ghost" className="h-7 gap-1 text-primary">
            Edit stops <ChevronRight className="h-3.5 w-3.5" />
          </Button>
        </div>
        <ul className="divide-y divide-border/60">
          {STOPS.map((s, i) => (
            <li key={s.seq} className="flex items-start gap-3 px-4 py-3">
              <div className="flex flex-col items-center pt-0.5">
                <span
                  className={`flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-semibold ${
                    s.status === "Pending"
                      ? "border border-dashed border-border bg-background text-muted-foreground"
                      : s.status === "En route"
                        ? "bg-info text-info-foreground"
                        : "bg-success text-success-foreground"
                  }`}
                >
                  {s.seq}
                </span>
                {i < STOPS.length - 1 && (
                  <span className="mt-1 h-7 w-px bg-border" />
                )}
              </div>
              <div className="grid flex-1 grid-cols-1 gap-1 sm:grid-cols-[1fr_auto]">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-foreground">{s.city}</span>
                    <Badge variant="outline" className={toneBadge[s.tone]}>
                      {s.type} · {s.status}
                    </Badge>
                  </div>
                  <div className="truncate text-xs text-muted-foreground">{s.facility}</div>
                  <div className="text-[11px] text-muted-foreground">
                    Contact · <span className="text-foreground/80">{s.contact}</span>
                  </div>
                </div>
                <div className="text-left sm:text-right">
                  <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    Appt
                  </div>
                  <div className="text-xs font-medium tabular-nums text-foreground">{s.appt}</div>
                  <div className="mt-1 flex items-center gap-1 sm:justify-end">
                    <Button size="sm" variant="ghost" className="h-6 px-2 text-[11px]">
                      <FileText className="mr-1 h-3 w-3" /> Docs
                    </Button>
                    <Button size="sm" variant="ghost" className="h-6 px-2 text-[11px]">
                      <CircleDashed className="mr-1 h-3 w-3" /> Override
                    </Button>
                  </div>
                </div>
              </div>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function TimelinePanel() {
  return (
    <ol className="relative space-y-3">
      {TIMELINE.map((t, i) => {
        const isLast = i === TIMELINE.length - 1;
        const isDone = t.state === "done";
        const isCurrent = t.state === "current";
        return (
          <li key={t.label} className="relative pl-7">
            {!isLast && (
              <span
                className={`absolute left-[10px] top-5 h-full w-px ${
                  isDone ? "bg-success/60" : "bg-border"
                }`}
              />
            )}
            <span
              className={`absolute left-0 top-1 flex h-5 w-5 items-center justify-center rounded-full ring-2 ${
                isDone
                  ? "bg-success text-success-foreground ring-success/30"
                  : isCurrent
                    ? "bg-primary text-primary-foreground ring-primary/30"
                    : "bg-muted text-muted-foreground ring-border"
              }`}
            >
              {isDone ? (
                <CheckCircle2 className="h-3 w-3" />
              ) : isCurrent ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <CircleDashed className="h-3 w-3" />
              )}
            </span>
            <div className="flex items-baseline justify-between gap-2">
              <span
                className={`text-sm ${
                  isCurrent
                    ? "font-semibold text-foreground"
                    : isDone
                      ? "text-foreground"
                      : "text-muted-foreground"
                }`}
              >
                {t.label}
              </span>
              <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                {t.time ?? "—"}
              </span>
            </div>
            {t.note && (
              <div className="mt-0.5 text-[11px] text-muted-foreground">{t.note}</div>
            )}
          </li>
        );
      })}
    </ol>
  );
}

function AlertsPanel() {
  return (
    <ul className="space-y-2">
      {ALERTS.map((a) => {
        const Icon = a.icon;
        return (
          <li
            key={a.title}
            className="flex items-start gap-3 rounded-lg border border-border/70 bg-background/60 p-3"
          >
            <span className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${toneStat[a.tone]}`}>
              <Icon className="h-3.5 w-3.5" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-sm font-medium text-foreground">{a.title}</span>
                <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                  {a.time}
                </span>
              </div>
              <div className="text-xs text-muted-foreground">{a.desc}</div>
              <div className="mt-1.5 flex items-center gap-1">
                <Button size="sm" variant="outline" className="h-6 px-2 text-[11px]">
                  Acknowledge
                </Button>
                <Button size="sm" variant="ghost" className="h-6 px-2 text-[11px] text-muted-foreground">
                  Snooze
                </Button>
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function CommsPanel() {
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-border/60 pb-2">
        <div className="flex items-center gap-2">
          <Avatar className="h-7 w-7">
            <AvatarFallback className="bg-primary/15 text-[11px] font-semibold text-primary">
              {LOAD.driverInitials}
            </AvatarFallback>
          </Avatar>
          <div>
            <div className="text-sm font-medium text-foreground">{LOAD.driver}</div>
            <div className="text-[11px] text-muted-foreground">
              {LOAD.driverPhone} · last seen 12s ago
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Button size="icon" variant="ghost" className="h-7 w-7">
            <Phone className="h-3.5 w-3.5" />
          </Button>
          <Button size="icon" variant="ghost" className="h-7 w-7">
            <MoreHorizontal className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
      <div className="flex-1 space-y-2 overflow-y-auto py-3">
        {MESSAGES.map((m, i) => {
          const fromOps = m.from === "ops";
          const fromSystem = m.from === "system";
          return (
            <div
              key={i}
              className={`flex ${fromOps ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[80%] rounded-lg px-3 py-1.5 text-sm ${
                  fromOps
                    ? "bg-primary text-primary-foreground"
                    : fromSystem
                      ? "border border-dashed border-border bg-muted/40 text-muted-foreground"
                      : "border border-border/70 bg-background text-foreground"
                }`}
              >
                <div className={fromSystem ? "text-[11px]" : ""}>{m.text}</div>
                <div
                  className={`mt-0.5 text-[10px] tabular-nums ${
                    fromOps ? "text-primary-foreground/70" : "text-muted-foreground"
                  }`}
                >
                  {m.time}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <div className="border-t border-border/60 pt-2">
        <div className="mb-2 flex flex-wrap gap-1">
          {["ETA check", "POD please", "Stuck at dock?", "Send location"].map((q) => (
            <button
              key={q}
              type="button"
              className="rounded-full border border-border/70 bg-background px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
            >
              {q}
            </button>
          ))}
        </div>
        <div className="relative">
          <Input className="pr-20" placeholder="Message driver, dispatcher, or customer…" />
          <div className="absolute right-1 top-1 flex items-center gap-1">
            <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground">
              <Paperclip className="h-3.5 w-3.5" />
            </Button>
            <Button size="sm" className="h-7 gap-1">
              <Send className="h-3.5 w-3.5" /> Send
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function DocumentsPanel() {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between rounded-lg border border-dashed border-border bg-muted/30 p-3">
        <div className="flex items-center gap-2">
          <FileUp className="h-4 w-4 text-primary" />
          <div>
            <div className="text-sm font-medium text-foreground">Upload documents</div>
            <div className="text-[11px] text-muted-foreground">
              POD, BOL, lumper, damage photos · PDF/JPG · max 20 MB
            </div>
          </div>
        </div>
        <Button size="sm" className="gap-1.5">
          <FileUp className="h-3.5 w-3.5" /> Upload
        </Button>
      </div>
      <ul className="space-y-1.5">
        {DOCUMENTS.map((d) => (
          <li
            key={d.name}
            className="flex items-center gap-3 rounded-lg border border-border/70 bg-background/60 p-2.5"
          >
            <span
              className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md ${toneStat[d.tone]}`}
            >
              {d.type === "Photo" ? (
                <Camera className="h-4 w-4" />
              ) : d.type === "POD" ? (
                <FileCheck2 className="h-4 w-4" />
              ) : (
                <FileText className="h-4 w-4" />
              )}
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium text-foreground">{d.name}</div>
              <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                <span>{d.type}</span>
                {d.size && (
                  <>
                    <span>·</span>
                    <span className="tabular-nums">{d.size}</span>
                  </>
                )}
              </div>
            </div>
            <Badge variant="outline" className={toneBadge[d.tone]}>
              {d.status}
            </Badge>
            <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground hover:text-foreground">
              <Eye className="h-3.5 w-3.5" />
            </Button>
            <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground hover:text-foreground">
              <Download className="h-3.5 w-3.5" />
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function CustomerLinkCard() {
  return (
    <Card className="border-border/70 shadow-sm">
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-md bg-success/15 text-success">
              <Link2 className="h-3.5 w-3.5" />
            </span>
            <div>
              <div className="text-sm font-semibold text-foreground">Customer tracking link</div>
              <div className="text-[11px] text-muted-foreground">
                Public ETA & milestones · rate / carrier hidden
              </div>
            </div>
          </div>
          <Badge variant="outline" className={toneBadge.success}>
            Active
          </Badge>
        </div>
        <div className="mt-3 flex items-center gap-2 rounded-md border border-border/70 bg-background/60 px-2.5 py-1.5">
          <Lock className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="truncate font-mono text-xs text-muted-foreground">
            {LOAD.customerLink}
          </span>
          <Button size="icon" variant="ghost" className="ml-auto h-7 w-7 text-muted-foreground">
            <Copy className="h-3.5 w-3.5" />
          </Button>
          <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground">
            <ExternalLink className="h-3.5 w-3.5" />
          </Button>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 text-[11px]">
          <Toggle icon={Eye} label="Show ETA" on />
          <Toggle icon={EyeOff} label="Hide rate" on />
          <Toggle icon={Shield} label="Password protected" on />
          <Toggle icon={Timer} label="Expires 48h" />
        </div>
        <div className="mt-3 flex items-center gap-1.5">
          <Button size="sm" className="h-7 gap-1.5 bg-gradient-to-r from-primary to-info text-primary-foreground hover:opacity-95">
            <Share2 className="h-3.5 w-3.5" /> Share with customer
          </Button>
          <Button size="sm" variant="outline" className="h-7 gap-1.5">
            <Mail className="h-3.5 w-3.5" /> Email
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function Toggle({
  icon: Icon,
  label,
  on,
}: {
  icon: typeof Eye;
  label: string;
  on?: boolean;
}) {
  return (
    <label className="flex items-center justify-between gap-2 rounded-md border border-border/60 bg-background/40 px-2 py-1.5">
      <span className="flex items-center gap-1.5 text-foreground">
        <Icon className="h-3 w-3 text-muted-foreground" />
        {label}
      </span>
      <Switch defaultChecked={on} className="scale-75" />
    </label>
  );
}

function EventsLog() {
  return (
    <Card className="border-border/70 shadow-sm">
      <CardContent className="px-0 pb-0 pt-0">
        <div className="flex flex-col gap-3 border-b border-border/70 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-md bg-muted text-foreground">
              <History className="h-3.5 w-3.5" />
            </span>
            <div>
              <div className="text-sm font-semibold text-foreground">Tracking history & events</div>
              <div className="text-[11px] text-muted-foreground">
                Geofence, ELD, telematics, and manual events
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" className="h-7 gap-1.5">
              <Activity className="h-3.5 w-3.5" /> All sources
            </Button>
            <Button size="sm" variant="outline" className="h-7 gap-1.5">
              <Download className="h-3.5 w-3.5" /> Export CSV
            </Button>
            <Button variant="ghost" size="sm" className="h-7 gap-1 text-primary">
              Full audit <ArrowUpRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="border-border/70">
                <TableHead className="pl-6">Time</TableHead>
                <TableHead>Event</TableHead>
                <TableHead>Source</TableHead>
                <TableHead className="pr-6 text-right">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {HISTORY.map((h, i) => (
                <TableRow key={i} className="border-border/60">
                  <TableCell className="pl-6 tabular-nums text-muted-foreground">
                    {h.time}
                  </TableCell>
                  <TableCell className="font-medium text-foreground">{h.event}</TableCell>
                  <TableCell className="text-muted-foreground">{h.source}</TableCell>
                  <TableCell className="pr-6 text-right">
                    <Badge variant="outline" className={toneBadge[h.tone]}>
                      {h.tone === "success"
                        ? "OK"
                        : h.tone === "warning"
                          ? "Warning"
                          : h.tone === "destructive"
                            ? "Issue"
                            : h.tone === "info"
                              ? "Info"
                              : "Logged"}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

function AnalyticsCards() {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {ANALYTICS.map((a) => {
        const Icon = a.icon;
        return (
          <Card key={a.label} className="border-border/70 shadow-sm">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {a.label}
                </div>
                <span className={`flex h-7 w-7 items-center justify-center rounded-md ${toneStat[a.tone]}`}>
                  <Icon className="h-3.5 w-3.5" />
                </span>
              </div>
              <div className="mt-2 flex items-baseline justify-between gap-2">
                <div className="text-2xl font-semibold tabular-nums tracking-tight text-foreground">
                  {a.value}
                </div>
                <Badge variant="secondary" className={toneStat[a.tone]}>
                  {a.sub}
                </Badge>
              </div>
              <Progress value={parseFloat(a.value)} className="mt-3 h-1.5" />
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

function NotesCard() {
  return (
    <Card className="border-border/70 shadow-sm">
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-md bg-warning/20 text-warning-foreground">
              <ShieldAlert className="h-3.5 w-3.5" />
            </span>
            <div>
              <div className="text-sm font-semibold text-foreground">Internal notes</div>
              <div className="text-[11px] text-muted-foreground">
                Visible to dispatch & ops · not shared with customer
              </div>
            </div>
          </div>
          <Button size="sm" variant="outline" className="h-7 gap-1.5">
            <FileText className="h-3.5 w-3.5" /> Add note
          </Button>
        </div>
        <div className="mt-3 space-y-2">
          <NoteRow
            author="Jamie Taylor"
            role="Dispatcher"
            time="2h ago"
            text="Customer flagged dock 03 as preferred for next reefer load. Update SOP."
          />
          <NoteRow
            author="Pat Singh"
            role="Ops Lead"
            time="Yesterday"
            text="Detention claim pre-approved by Acme — billing dept notified."
          />
          <NoteRow
            author="System"
            role="Auto"
            time="3d ago"
            text="ETA model recalibrated after I-20 closure events (May 12)."
          />
        </div>
      </CardContent>
    </Card>
  );
}

function NoteRow({
  author,
  role,
  time,
  text,
}: {
  author: string;
  role: string;
  time: string;
  text: string;
}) {
  return (
    <div className="flex items-start gap-2.5 rounded-lg border border-border/60 bg-background/60 p-2.5">
      <Avatar className="h-7 w-7">
        <AvatarFallback className="bg-muted text-[10px] font-semibold text-foreground">
          {author
            .split(" ")
            .map((w) => w[0])
            .join("")
            .slice(0, 2)}
        </AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-sm font-medium text-foreground">{author}</span>
          <span className="text-[11px] text-muted-foreground">{role}</span>
          <span className="ml-auto text-[11px] tabular-nums text-muted-foreground">
            {time}
          </span>
        </div>
        <div className="text-xs text-muted-foreground">{text}</div>
      </div>
    </div>
  );
}

function OpsPanel() {
  const actions: { icon: typeof Truck; label: string; tone?: Tone }[] = [
    { icon: User, label: "Assign driver" },
    { icon: Truck, label: "Reassign carrier" },
    { icon: BellRing, label: "Update status" },
    { icon: CalendarClock, label: "Override ETA" },
    { icon: AlertTriangle, label: "Add exception", tone: "warning" },
    { icon: FileText, label: "Add internal note" },
    { icon: Mail, label: "Send customer update" },
    { icon: Navigation, label: "Request location" },
    { icon: FileUp, label: "Request document" },
    { icon: CheckCircle2, label: "Mark delivered", tone: "success" },
  ];
  return (
    <Card className="border-border/70 shadow-sm">
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/15 text-primary">
              <Zap className="h-3.5 w-3.5" />
            </span>
            <div>
              <div className="text-sm font-semibold text-foreground">Operations panel</div>
              <div className="text-[11px] text-muted-foreground">
                Dispatcher & admin overrides
              </div>
            </div>
          </div>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-1.5 sm:grid-cols-2">
          {actions.map((a) => {
            const Icon = a.icon;
            return (
              <Button
                key={a.label}
                size="sm"
                variant="outline"
                className={`h-8 justify-start gap-1.5 ${a.tone ? toneStat[a.tone] : ""}`}
              >
                <Icon className="h-3.5 w-3.5" />
                {a.label}
              </Button>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

/* ───────────────────────── Page ───────────────────────── */

function Page() {
  return (
    <div>
      <PageHeader
        title="Tracking"
        description="Live shipment visibility, ETA prediction, and milestone alerts."
        actions={
          <>
            <div className="relative hidden sm:block">
              <MapIcon className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="h-8 w-64 pl-8"
                placeholder="Search load, MC#, driver, city…"
              />
            </div>
            <Button variant="outline" size="sm" className="gap-1.5">
              <Activity className="h-4 w-4" /> All active · 248
            </Button>
            <Button
              size="sm"
              className="gap-1.5 bg-gradient-to-r from-primary to-info text-primary-foreground shadow-sm shadow-primary/30 hover:opacity-95"
            >
              <Share2 className="h-4 w-4" /> Share tracking
            </Button>
          </>
        }
      />

      <div className="space-y-6 px-4 py-6 sm:px-6 lg:px-8">
        <LoadHero />
        <StatsStrip />

        {/* Main 2-column area */}
        <div className="grid gap-6 xl:grid-cols-3">
          {/* Left column — Map, driver, stops */}
          <div className="space-y-6 xl:col-span-2">
            <Card className="overflow-hidden border-border/70 shadow-sm">
              <CardContent className="p-3">
                <LiveMap />
              </CardContent>
            </Card>

            <div className="grid gap-6 lg:grid-cols-2">
              <DriverLocationCard />
              <ReeferCard />
            </div>

            <StopsCard />
          </div>

          {/* Right column — Tabs panel */}
          <div className="space-y-6">
            <Card className="border-border/70 shadow-sm">
              <CardContent className="p-4">
                <Tabs defaultValue="timeline">
                  <TabsList className="w-full">
                    <TabsTrigger value="timeline" className="flex-1 gap-1.5">
                      <Activity className="h-3.5 w-3.5" /> Timeline
                    </TabsTrigger>
                    <TabsTrigger value="alerts" className="flex-1 gap-1.5">
                      <AlertTriangle className="h-3.5 w-3.5" /> Alerts
                      <Badge variant="secondary" className={`${toneStat.warning} ml-1 h-4 px-1 text-[10px]`}>
                        2
                      </Badge>
                    </TabsTrigger>
                    <TabsTrigger value="comms" className="flex-1 gap-1.5">
                      <MessageSquare className="h-3.5 w-3.5" /> Comms
                    </TabsTrigger>
                    <TabsTrigger value="docs" className="flex-1 gap-1.5">
                      <FileText className="h-3.5 w-3.5" /> Docs
                    </TabsTrigger>
                  </TabsList>

                  <TabsContent value="timeline" className="mt-4 max-h-[640px] overflow-y-auto pr-1">
                    <TimelinePanel />
                  </TabsContent>
                  <TabsContent value="alerts" className="mt-4 max-h-[640px] overflow-y-auto pr-1">
                    <AlertsPanel />
                  </TabsContent>
                  <TabsContent value="comms" className="mt-4 h-[640px]">
                    <CommsPanel />
                  </TabsContent>
                  <TabsContent value="docs" className="mt-4 max-h-[640px] overflow-y-auto pr-1">
                    <DocumentsPanel />
                  </TabsContent>
                </Tabs>
              </CardContent>
            </Card>

            <CustomerLinkCard />
            <OpsPanel />
          </div>
        </div>

        {/* Bottom area — analytics, history, notes */}
        <AnalyticsCards />
        <div className="grid gap-6 xl:grid-cols-3">
          <div className="xl:col-span-2">
            <EventsLog />
          </div>
          <NotesCard />
        </div>
      </div>
    </div>
  );
}
