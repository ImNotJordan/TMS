import * as React from "react";
import { createFileRoute, Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  ArrowUpRight,
  CheckCircle2,
  Clock3,
  Download,
  Filter,
  Inbox,
  Loader2,
  MapPin,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Truck,
  AlertTriangle,
  Zap,
  FilePen,
  Trash2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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
import { usePageReady } from "@/components/page-load-gate";
import { CreateTruckDialog } from "@/components/truckboard/create-truck-dialog";
import { DatSuggestionsCard } from "@/components/truckboard/dat-suggestions-card";
import {
  formatTruckDraftDestination,
  formatTruckDraftOrigin,
  formatTruckDraftSavedAt,
  listStoredTruckDrafts,
  removeStoredTruckDraft,
  type StoredTruckDraft,
} from "@/lib/truck-drafts-storage";
import { deleteTruck, listAllTrucksCached, type TruckRecord } from "@/lib/trucks-store";
import { useOperationalList } from "@/hooks/use-operational-list";
import { invalidateOperationalCounts } from "@/lib/sidebar-counts";
import { t } from "@/lib/i18n/t";

export const Route = createFileRoute("/truckboard")({
  head: () => ({
    meta: [
      { title: "TruckBoard — Logistics Software" },
      { name: "description", content: "Available trucks, capacity, and matching for open loads." },
    ],
  }),
  component: Page,
});

type Tone = "success" | "warning" | "destructive" | "info" | "default";

const EQUIPMENT_LABELS: Record<string, string> = {
  "dry-van": "Dry Van",
  reefer: "Reefer",
  flatbed: "Flatbed",
  "step-deck": "Step Deck",
  lowboy: "Lowboy / RGN",
  tanker: "Tanker",
  "power-only": "Power Only",
  hotshot: "Hotshot",
};

const TRAILER_LENGTH_LABELS: Record<string, string> = {
  "53-dry": "53'",
  "48-dry": "48'",
  "53-reefer": "53'",
  "48-flat": "48'",
  "53-flat": "53'",
  "step-deck": "Step",
  "26ft-box": "26'",
};

const STATUS_LABELS: Record<string, { label: string; tone: Tone }> = {
  active: { label: "Active", tone: "success" },
  pending: { label: "Pending", tone: "warning" },
  matched: { label: "Matched", tone: "info" },
  booked: { label: "Booked", tone: "default" },
  paused: { label: "Paused", tone: "warning" },
  expired: { label: "Expired", tone: "destructive" },
};

const toneBadge: Record<Tone, string> = {
  success: "bg-success/15 text-success border-success/20",
  warning: "bg-warning/20 text-warning-foreground border-warning/30",
  destructive: "bg-destructive/12 text-destructive border-destructive/20",
  info: "bg-info/15 text-info border-info/20",
  default: "bg-muted text-foreground border-border",
};

const toneStat: Record<Tone, string> = {
  success: "bg-success/15 text-success",
  warning: "bg-warning/20 text-warning-foreground",
  destructive: "bg-destructive/12 text-destructive",
  info: "bg-info/15 text-info",
  default: "bg-muted text-foreground",
};

function labelOrRaw(map: Record<string, string>, value?: string) {
  if (!value) return "—";
  return map[value] ?? value;
}

function formatPlace(city?: string, state?: string) {
  if (city && state) return `${city}, ${state}`;
  return city || state || "—";
}

function formatAvailability(t: TruckRecord) {
  if (t.availableNow) return "Available now";
  if (!t.availableDate) return "—";
  const d = new Date(t.availableDate);
  const datePart = Number.isNaN(d.getTime())
    ? t.availableDate
    : d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return t.availableTime ? `${datePart} · ${t.availableTime}` : datePart;
}

function formatDestination(t: TruckRecord) {
  if (t.preferredDestinationCity || t.preferredDestinationState) {
    return formatPlace(t.preferredDestinationCity, t.preferredDestinationState);
  }
  if (t.preferredDestinationRegion) {
    return t.preferredDestinationRegion.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  }
  if (t.preferredStates && t.preferredStates.length > 0) {
    return t.preferredStates.slice(0, 3).join(", ") + (t.preferredStates.length > 3 ? "…" : "");
  }
  return "Anywhere";
}

function formatEquipment(t: TruckRecord) {
  const eq = labelOrRaw(EQUIPMENT_LABELS, t.equipmentType);
  const len = t.trailerType ? (TRAILER_LENGTH_LABELS[t.trailerType] ?? "") : "";
  return len ? `${eq} · ${len}` : eq;
}

function formatAuthority(t: TruckRecord) {
  const parts = [
    t.carrierMcNumber && `MC ${t.carrierMcNumber}`,
    t.carrierDotNumber && `DOT ${t.carrierDotNumber}`,
  ].filter(Boolean);
  return parts.join(" · ") || "—";
}

function formatRate(t: TruckRecord) {
  if (!t.desiredRate) return "—";
  const n = parseFloat(t.desiredRate.replace(/[^0-9.-]/g, ""));
  if (!Number.isFinite(n)) return t.desiredRate;
  return `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function formatRatePerMile(t: TruckRecord) {
  if (!t.desiredRatePerMile) return "";
  const n = parseFloat(t.desiredRatePerMile.replace(/[^0-9.-]/g, ""));
  if (!Number.isFinite(n)) return `${t.desiredRatePerMile}/mi`;
  return `$${n.toFixed(2)}/mi`;
}

function complianceForTruck(t: TruckRecord): { label: string; tone: Tone } {
  if (t.insuranceVerified && t.authorityVerified) {
    return { label: "Verified", tone: "success" };
  }
  if (!t.insuranceVerified && !t.authorityVerified) {
    return { label: "Issues", tone: "destructive" };
  }
  return { label: "Pending", tone: "warning" };
}

function formatRelativeTime(iso?: string) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const diff = Date.now() - d.getTime();
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function initials(name?: string) {
  if (!name) return "—";
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]!.toUpperCase())
    .join(". ")
    .concat(name.split(/\s+/).length > 1 ? "." : "");
}

function Page() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const isTruckDetailPath = /^\/truckboard\/[^/]+$/.test(pathname);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [query, setQuery] = React.useState("");
  const [showDrafts, setShowDrafts] = React.useState(false);
  const [storedDrafts, setStoredDrafts] = React.useState<StoredTruckDraft[]>([]);
  const [createOpen, setCreateOpen] = React.useState(false);
  const [resumeDraft, setResumeDraft] = React.useState<StoredTruckDraft | null>(null);
  const [draftToDelete, setDraftToDelete] = React.useState<StoredTruckDraft | null>(null);
  const [truckToDelete, setTruckToDelete] = React.useState<TruckRecord | null>(null);
  const [deletingTruck, setDeletingTruck] = React.useState(false);

  const fetchList = React.useCallback(async ({ force }: { force: boolean }) => {
    const items = await listAllTrucksCached({ force });
    items.sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
    return items;
  }, []);

  const {
    items: trucks,
    loading,
    refreshing,
    error,
    setItems: setTrucks,
    setError,
    refresh: refreshTrucks,
  } = useOperationalList<TruckRecord>({
    queryKey: ["truckboard"],
    fetchList,
    enabled: !isTruckDetailPath,
  });

  usePageReady(Boolean(loading && !trucks && !isTruckDetailPath));

  const refreshStoredDrafts = React.useCallback(() => {
    setStoredDrafts(listStoredTruckDrafts());
  }, []);

  React.useEffect(() => {
    refreshStoredDrafts();
  }, [refreshStoredDrafts]);

  const filtered = React.useMemo(() => {
    if (!trucks) return [];
    const q = query.trim().toLowerCase();
    if (!q) return trucks;
    return trucks.filter((t) => {
      const hay = [
        t.truckBoardId,
        t.carrierName,
        t.carrierMcNumber,
        t.carrierDotNumber,
        formatPlace(t.currentCity, t.currentState),
        formatDestination(t),
        labelOrRaw(EQUIPMENT_LABELS, t.equipmentType),
        t.driverName,
        t.dispatcherName,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [trucks, query]);

  const datLane = React.useMemo(() => {
    const list = trucks ?? [];
    const counts = new Map<string, { city?: string; state?: string; n: number }>();
    for (const truck of list) {
      const key = `${truck.currentCity ?? ""}|${truck.currentState ?? ""}`.toLowerCase();
      if (!key.replace("|", "").trim()) continue;
      const prev = counts.get(key);
      counts.set(key, {
        city: truck.currentCity,
        state: truck.currentState,
        n: (prev?.n ?? 0) + 1,
      });
    }
    const top = [...counts.values()].sort((a, b) => b.n - a.n)[0];
    const sample = list[0];
    return {
      originCity: top?.city ?? sample?.currentCity,
      originState: top?.state ?? sample?.currentState,
      destinationCity: sample?.preferredDestinationCity,
      destinationState: sample?.preferredDestinationState,
      equipmentType: sample?.equipmentType,
    };
  }, [trucks]);

  const stats = React.useMemo(() => {
    const list = trucks ?? [];
    const available = list.filter((t) => t.postingStatus === "active" || t.availableNow).length;
    const matched = list.filter((t) => t.postingStatus === "matched").length;
    const booked = list.filter((t) => t.postingStatus === "booked").length;
    return [
      {
        label: "Available Trucks",
        value: available.toString(),
        delta: `${list.length} total`,
        tone: "success" as Tone,
        icon: Truck,
      },
      {
        label: "Posted",
        value: list.length.toString(),
        delta: "Live",
        tone: "info" as Tone,
        icon: MapPin,
      },
      {
        label: "Matched",
        value: matched.toString(),
        delta: "Pending booking",
        tone: "default" as Tone,
        icon: Clock3,
      },
      {
        label: "Booked",
        value: booked.toString(),
        delta: "Capacity used",
        tone: "success" as Tone,
        icon: CheckCircle2,
      },
    ];
  }, [trucks]);

  const openNewTruck = () => {
    setResumeDraft(null);
    setCreateOpen(true);
  };

  const openStoredDraft = (stored: StoredTruckDraft) => {
    setResumeDraft(stored);
    setCreateOpen(true);
    setShowDrafts(false);
  };

  const confirmDeleteDraft = () => {
    if (!draftToDelete) return;
    removeStoredTruckDraft(draftToDelete.id);
    refreshStoredDrafts();
    setDraftToDelete(null);
  };

  const confirmDeleteTruck = async () => {
    if (!truckToDelete) return;
    setDeletingTruck(true);
    setError(null);
    try {
      await deleteTruck(truckToDelete.truckBoardId);
      setTrucks(
        (prev) => prev?.filter((row) => row.truckBoardId !== truckToDelete.truckBoardId) ?? null,
      );
      invalidateOperationalCounts(queryClient);
      setTruckToDelete(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete truck posting.");
    } finally {
      setDeletingTruck(false);
    }
  };

  if (isTruckDetailPath) {
    return <Outlet />;
  }

  return (
    <div>
      <PageHeader
        title={t("TruckBoard")}
        description={t("Available trucks, capacity, and matching for open loads.")}
        actions={
          <>
            <Button variant="outline" size="sm" className="gap-1.5">
              <Filter className="h-4 w-4" /> {t("Filters")}
            </Button>
            <Button variant="outline" size="sm" className="gap-1.5">
              <Download className="h-4 w-4" /> {t("Export")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={() => void refreshTrucks()}
              disabled={refreshing || loading}
            >
              {refreshing ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
              Refresh
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={() => setShowDrafts((v) => !v)}
            >
              {showDrafts ? (
                <>
                  <Truck className="h-4 w-4" />
                  {t("TruckBoard")}
                </>
              ) : (
                <>
                  <FilePen className="h-4 w-4" />
                  Drafts
                  {storedDrafts.length > 0 ? (
                    <Badge variant="secondary" className="ml-0.5 h-5 min-w-5 px-1.5 tabular-nums">
                      {storedDrafts.length}
                    </Badge>
                  ) : null}
                </>
              )}
            </Button>
            <Button
              size="sm"
              className="gap-1.5 bg-gradient-to-r from-primary to-info text-primary-foreground shadow-sm shadow-primary/30 hover:opacity-95"
              onClick={openNewTruck}
            >
              <Plus className="h-4 w-4" /> {t("Post Truck")}
            </Button>
            <CreateTruckDialog
              open={createOpen}
              onOpenChange={(next) => {
                setCreateOpen(next);
                if (!next) setResumeDraft(null);
              }}
              resumeDraft={resumeDraft}
              onDraftSaved={refreshStoredDrafts}
              onCreated={() => {
                invalidateOperationalCounts(queryClient);
                refreshStoredDrafts();
                void refreshTrucks();
              }}
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

        <DatSuggestionsCard className="mt-6" lane={datLane} />

        <Card className="mt-6 border-border/70 shadow-sm">
          <CardContent className="px-0 pb-0 pt-0">
            <div className="flex flex-col gap-3 border-b border-border/70 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6">
              <div className="relative w-full sm:max-w-xs">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  className="pl-8"
                  placeholder={t("Search trucks, carriers, MC#, lanes...")}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" variant="outline" className="gap-1.5">
                  <Zap className="h-4 w-4" /> {t("Available now")}
                </Button>
                <Button size="sm" variant="outline" className="gap-1.5">
                  <Truck className="h-4 w-4" /> {t("All equipment")}
                </Button>
                <Button size="sm" variant="outline" className="gap-1.5">
                  <ShieldCheck className="h-4 w-4" /> {t("Verified only")}
                </Button>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {showDrafts
                    ? `${storedDrafts.length} saved draft${storedDrafts.length === 1 ? "" : "s"}`
                    : loading
                      ? "Loading…"
                      : `${filtered.length} of ${trucks?.length ?? 0} truck${trucks?.length === 1 ? "" : "s"}`}
                </span>
                <Button variant="ghost" size="sm" className="gap-1 text-primary">
                  {t("View all")} <ArrowUpRight className="h-4 w-4" />
                </Button>
              </div>
            </div>

            {error && (
              <div className="flex items-start gap-3 border-b border-destructive/30 bg-destructive/8 px-6 py-3 text-sm text-destructive">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <div className="flex-1">
                  <div className="font-semibold">{t("Couldn't load from DynamoDB")}</div>
                  <div className="mt-0.5 text-xs text-destructive/90">{error}</div>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void refreshTrucks()}
                  className="border-destructive/30 text-destructive hover:bg-destructive/10"
                >
                  {t("Retry")}
                </Button>
              </div>
            )}

            <div className="overflow-x-auto">
              <Table>
                {showDrafts ? (
                  <>
                    <TableHeader>
                      <TableRow className="border-border/70">
                        <TableHead className="pl-6">{t("Truck")}</TableHead>
                        <TableHead>{t("Carrier")}</TableHead>
                        <TableHead>{t("Origin")}</TableHead>
                        <TableHead>{t("Destination")}</TableHead>
                        <TableHead>{t("Step")}</TableHead>
                        <TableHead>{t("Last saved")}</TableHead>
                        <TableHead className="pr-6 text-right">{t("Actions")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {storedDrafts.length === 0 ? (
                        <TableRow className="border-border/60">
                          <TableCell colSpan={7} className="py-12">
                            <div className="flex flex-col items-center justify-center gap-2 text-center text-sm text-muted-foreground">
                              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-muted">
                                <FilePen className="h-5 w-5" />
                              </span>
                              <div className="font-medium text-foreground">
                                {t("No saved drafts")}
                              </div>
                              <div className="text-xs">
                                {t(
                                  "Start posting a truck and close the wizard — your progress is saved\r\n                                here automatically.",
                                )}
                              </div>
                            </div>
                          </TableCell>
                        </TableRow>
                      ) : (
                        storedDrafts.map((stored) => (
                          <TableRow
                            key={stored.id}
                            className="cursor-pointer border-border/60 hover:bg-muted/40"
                            onClick={() => openStoredDraft(stored)}
                          >
                            <TableCell className="pl-6 font-medium text-primary">
                              {stored.draft.truckBoardId}
                            </TableCell>
                            <TableCell>{stored.draft.carrierName || "—"}</TableCell>
                            <TableCell className="text-muted-foreground">
                              {formatTruckDraftOrigin(stored.draft)}
                            </TableCell>
                            <TableCell className="text-muted-foreground">
                              {formatTruckDraftDestination(stored.draft)}
                            </TableCell>
                            <TableCell className="tabular-nums text-muted-foreground">
                              Step {stored.step} of 8
                            </TableCell>
                            <TableCell className="tabular-nums text-muted-foreground">
                              {formatTruckDraftSavedAt(stored.savedAt)}
                            </TableCell>
                            <TableCell className="pr-6 text-right">
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-muted-foreground hover:text-destructive"
                                aria-label={`Delete draft ${stored.draft.truckBoardId}`}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setDraftToDelete(stored);
                                }}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </>
                ) : (
                  <>
                    <TableHeader>
                      <TableRow className="border-border/70">
                        <TableHead className="pl-6">{t("Status")}</TableHead>
                        <TableHead>{t("Available")}</TableHead>
                        <TableHead>{t("Origin")}</TableHead>
                        <TableHead>{t("Preferred Destination")}</TableHead>
                        <TableHead>{t("Equipment")}</TableHead>
                        <TableHead>{t("Carrier")}</TableHead>
                        <TableHead>{t("MC / DOT")}</TableHead>
                        <TableHead>{t("Driver / Dispatcher")}</TableHead>
                        <TableHead className="text-right">{t("Rate Pref.")}</TableHead>
                        <TableHead>{t("Deadhead")}</TableHead>
                        <TableHead>{t("Compliance")}</TableHead>
                        <TableHead>{t("Last Updated")}</TableHead>
                        <TableHead className="pr-6 text-right">{t("Actions")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {loading && (!trucks || trucks.length === 0) ? (
                        Array.from({ length: 5 }).map((_, i) => (
                          <TableRow key={`skel-${i}`} className="border-border/60">
                            {Array.from({ length: 13 }).map((__, j) => (
                              <TableCell
                                key={j}
                                className={j === 0 ? "pl-6" : j === 12 ? "pr-6 text-right" : ""}
                              >
                                <span className="inline-block h-4 w-full max-w-[100px] animate-pulse rounded bg-muted" />
                              </TableCell>
                            ))}
                          </TableRow>
                        ))
                      ) : filtered.length === 0 ? (
                        <TableRow className="border-border/60">
                          <TableCell colSpan={13} className="py-12">
                            <div className="flex flex-col items-center justify-center gap-2 text-center text-sm text-muted-foreground">
                              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-muted">
                                <Inbox className="h-5 w-5" />
                              </span>
                              <div className="font-medium text-foreground">
                                {trucks && trucks.length > 0
                                  ? "No trucks match your search"
                                  : "No trucks posted yet"}
                              </div>
                              <div className="text-xs">
                                {trucks && trucks.length > 0
                                  ? "Try a different keyword."
                                  : "Post a truck to see it here."}
                              </div>
                            </div>
                          </TableCell>
                        </TableRow>
                      ) : (
                        filtered.map((t) => {
                          const status = t.postingStatus
                            ? (STATUS_LABELS[t.postingStatus] ?? {
                                label: t.postingStatus,
                                tone: "default" as Tone,
                              })
                            : { label: "—", tone: "default" as Tone };
                          const compliance = complianceForTruck(t);
                          const ratePerMile = formatRatePerMile(t);
                          return (
                            <TableRow
                              key={t.truckBoardId}
                              role="link"
                              tabIndex={0}
                              className="cursor-pointer border-border/60 hover:bg-muted/35"
                              onClick={() =>
                                void navigate({
                                  to: "/truckboard/$truckBoardId",
                                  params: { truckBoardId: t.truckBoardId },
                                })
                              }
                              onKeyDown={(e) => {
                                if (e.key === "Enter" || e.key === " ") {
                                  e.preventDefault();
                                  void navigate({
                                    to: "/truckboard/$truckBoardId",
                                    params: { truckBoardId: t.truckBoardId },
                                  });
                                }
                              }}
                            >
                              <TableCell className="pl-6">
                                <Badge variant="outline" className={toneBadge[status.tone]}>
                                  {status.label}
                                </Badge>
                              </TableCell>
                              <TableCell className="tabular-nums text-muted-foreground">
                                {formatAvailability(t)}
                              </TableCell>
                              <TableCell className="font-medium">
                                {formatPlace(t.currentCity, t.currentState)}
                              </TableCell>
                              <TableCell className="text-muted-foreground">
                                {formatDestination(t)}
                              </TableCell>
                              <TableCell className="text-muted-foreground">
                                {formatEquipment(t)}
                              </TableCell>
                              <TableCell>
                                <div className="font-medium text-foreground">
                                  <Link
                                    to="/truckboard/$truckBoardId"
                                    params={{ truckBoardId: t.truckBoardId }}
                                    className="text-primary underline-offset-4 hover:underline"
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    {t.carrierName || t.truckBoardId}
                                  </Link>
                                </div>
                                <div className="text-[11px] text-muted-foreground">
                                  {t.truckBoardId}
                                </div>
                              </TableCell>
                              <TableCell className="tabular-nums text-muted-foreground">
                                {formatAuthority(t)}
                              </TableCell>
                              <TableCell>
                                <div className="text-foreground">{initials(t.driverName)}</div>
                                <div className="text-[11px] text-muted-foreground">
                                  {t.dispatcherName ? initials(t.dispatcherName) : "—"}
                                </div>
                              </TableCell>
                              <TableCell className="text-right">
                                <div className="font-semibold tabular-nums text-foreground">
                                  {formatRate(t)}
                                </div>
                                {ratePerMile && (
                                  <div className="text-[11px] tabular-nums text-muted-foreground">
                                    {ratePerMile}
                                  </div>
                                )}
                              </TableCell>
                              <TableCell className="tabular-nums text-muted-foreground">
                                {t.willingDeadheadMiles ? `${t.willingDeadheadMiles} mi` : "—"}
                              </TableCell>
                              <TableCell>
                                <Badge variant="outline" className={toneBadge[compliance.tone]}>
                                  {compliance.label}
                                </Badge>
                              </TableCell>
                              <TableCell className="tabular-nums text-muted-foreground">
                                {formatRelativeTime(t.updatedAt ?? t.createdAt)}
                              </TableCell>
                              <TableCell
                                className="pr-6 text-right"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <Button
                                  type="button"
                                  size="icon"
                                  variant="ghost"
                                  className="h-8 w-8 text-muted-foreground hover:text-destructive"
                                  aria-label={`Delete truck ${t.truckBoardId}`}
                                  onClick={() => setTruckToDelete(t)}
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </TableCell>
                            </TableRow>
                          );
                        })
                      )}
                    </TableBody>
                  </>
                )}
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>

      <AlertDialog
        open={truckToDelete !== null}
        onOpenChange={(open) => {
          if (!open && !deletingTruck) setTruckToDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("Delete truck posting?")}</AlertDialogTitle>
            <AlertDialogDescription>
              {truckToDelete ? (
                <>
                  This will permanently remove{" "}
                  <span className="font-medium text-foreground">{truckToDelete.truckBoardId}</span>
                  {truckToDelete.carrierName ? <> ({truckToDelete.carrierName})</> : null}. This
                  cannot be undone.
                </>
              ) : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletingTruck}>{t("Cancel")}</AlertDialogCancel>
            <Button
              variant="destructive"
              disabled={deletingTruck}
              onClick={() => void confirmDeleteTruck()}
            >
              {deletingTruck ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {t("Deleting…")}
                </>
              ) : (
                "Delete posting"
              )}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={draftToDelete !== null}
        onOpenChange={(open) => {
          if (!open) setDraftToDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("Delete draft?")}</AlertDialogTitle>
            <AlertDialogDescription>
              {draftToDelete ? (
                <>
                  This will permanently remove draft{" "}
                  <span className="font-medium text-foreground">
                    {draftToDelete.draft.truckBoardId}
                  </span>
                  {draftToDelete.draft.carrierName ? (
                    <> for {draftToDelete.draft.carrierName}</>
                  ) : null}
                  . This cannot be undone.
                </>
              ) : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("Cancel")}</AlertDialogCancel>
            <Button variant="destructive" onClick={confirmDeleteDraft}>
              {t("Delete draft")}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
