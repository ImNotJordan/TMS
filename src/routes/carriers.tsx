import * as React from "react";
import { createFileRoute, Link, Outlet, useRouterState } from "@tanstack/react-router";
import {
  AlertTriangle,
  Ban,
  Building2,
  Download,
  Filter,
  Inbox,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  ShieldAlert,
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
import { CreateCarrierDialog } from "@/components/carriers/create-carrier-dialog";
import { CarrierActionsMenu } from "@/components/carriers/carrier-actions-menu";
import {
  INSURANCE_STATUS_LABELS,
  PORTAL_STATUS_LABELS,
  TIER_LABELS,
  formatEquipmentTypes,
  formatLanesServed,
  insuranceStatus,
  toneBadge,
  toneStat,
  type Tone,
} from "@/lib/carriers-display";
import { deleteCarrier, listAllCarriersCached, type CarrierRecord } from "@/lib/carriers-store";
import { useProfileSection } from "@/hooks/use-profile-section";
import { useOperationalList } from "@/hooks/use-operational-list";
import { t } from "@/lib/i18n/t";

export const Route = createFileRoute("/carriers")({
  head: () => ({
    meta: [
      { title: "Carriers / Brokers — Logistics Software" },
      {
        name: "description",
        content: "Carrier and broker network with scorecards, contracts, and contacts.",
      },
    ],
  }),
  component: Page,
});

function Page() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const isCarrierDetailPath = /^\/carriers\/[^/]+$/.test(pathname);

  const permissions = useProfileSection<{ role?: string }>("permissions", {});
  const role = permissions.data.role;

  const [query, setQuery] = React.useState("");
  const [createOpen, setCreateOpen] = React.useState(false);
  const [carrierToDelete, setCarrierToDelete] = React.useState<CarrierRecord | null>(null);
  const [deleting, setDeleting] = React.useState(false);

  const fetchList = React.useCallback(async ({ force }: { force: boolean }) => {
    const items = await listAllCarriersCached({ force });
    items.sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
    return items;
  }, []);

  const {
    items: carriers,
    loading,
    refreshing,
    error,
    setItems: setCarriers,
    setError,
    refresh: refreshCarriers,
  } = useOperationalList<CarrierRecord>({
    queryKey: ["carriers"],
    fetchList,
    enabled: !isCarrierDetailPath,
    errorMessage: "Failed to load carriers.",
  });

  usePageReady(Boolean(loading && !carriers && !isCarrierDetailPath));

  const filtered = React.useMemo(() => {
    if (!carriers) return [];
    const q = query.trim().toLowerCase();
    if (!q) return carriers;
    return carriers.filter((c) => {
      const hay = [c.carrierId, c.companyName, c.mcNumber, c.dotNumber, c.hqCity, c.hqState]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [carriers, query]);

  const stats = React.useMemo(() => {
    const list = carriers ?? [];
    const active = list.filter((c) => !c.blacklisted).length;
    const insuranceExpiring = list.filter((c) => {
      const status = insuranceStatus(c);
      return status === "expired" || status === "expiring-soon";
    }).length;
    const blacklisted = list.filter((c) => c.blacklisted).length;
    const topTier = list.filter((c) => c.tier === "core" || c.tier === "strategic").length;
    return [
      {
        label: "Active Carriers",
        value: active.toString(),
        delta: `${list.length} total`,
        tone: "info" as Tone,
        icon: Building2,
      },
      {
        label: "Insurance Expiring",
        value: insuranceExpiring.toString(),
        delta: "≤30 days or expired",
        tone: "warning" as Tone,
        icon: ShieldAlert,
      },
      {
        label: "Blacklisted",
        value: blacklisted.toString(),
        delta: "Blocked from tenders",
        tone: "destructive" as Tone,
        icon: Ban,
      },
      {
        label: "Top Tier",
        value: topTier.toString(),
        delta: "Core + Strategic",
        tone: "success" as Tone,
        icon: Building2,
      },
    ];
  }, [carriers]);

  const confirmDelete = async () => {
    if (!carrierToDelete) return;
    setDeleting(true);
    setError(null);
    try {
      await deleteCarrier(carrierToDelete.carrierId);
      setCarriers(
        (prev) => prev?.filter((row) => row.carrierId !== carrierToDelete.carrierId) ?? null,
      );
      setCarrierToDelete(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete carrier.");
    } finally {
      setDeleting(false);
    }
  };

  const applyUpdated = (updated: CarrierRecord) => {
    setCarriers((prev) =>
      prev ? prev.map((row) => (row.carrierId === updated.carrierId ? updated : row)) : prev,
    );
  };

  if (isCarrierDetailPath) {
    return <Outlet />;
  }

  return (
    <div>
      <PageHeader
        title={t("Carriers / Brokers")}
        description={t("Carrier and broker network with scorecards, contracts, and contacts.")}
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
              onClick={() => void refreshCarriers()}
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
              size="sm"
              className="gap-1.5 bg-gradient-to-r from-primary to-info text-primary-foreground shadow-sm shadow-primary/30 hover:opacity-95"
              onClick={() => setCreateOpen(true)}
            >
              <Plus className="h-4 w-4" /> {t("New Carrier")}
            </Button>
            <CreateCarrierDialog
              open={createOpen}
              onOpenChange={setCreateOpen}
              onCreated={() => void refreshCarriers()}
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
                  placeholder={t("Search carriers, MC/DOT, city...")}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>
              <span className="text-xs text-muted-foreground tabular-nums">
                {loading ? "Loading…" : `${filtered.length} of ${carriers?.length ?? 0} carriers`}
              </span>
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
                  onClick={() => void refreshCarriers()}
                  className="border-destructive/30 text-destructive hover:bg-destructive/10"
                >
                  {t("Retry")}
                </Button>
              </div>
            )}

            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="border-border/70">
                    <TableHead className="pl-6">{t("Company")}</TableHead>
                    <TableHead>{t("Tier")}</TableHead>
                    <TableHead>{t("Equipment")}</TableHead>
                    <TableHead>{t("Lanes")}</TableHead>
                    <TableHead>OTD</TableHead>
                    <TableHead>{t("Insurance")}</TableHead>
                    <TableHead>{t("Portal")}</TableHead>
                    <TableHead className="pr-6 text-right">{t("Actions")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading && (!carriers || carriers.length === 0) ? (
                    Array.from({ length: 5 }).map((_, i) => (
                      <TableRow key={`skel-${i}`} className="border-border/60">
                        {Array.from({ length: 8 }).map((__, j) => (
                          <TableCell
                            key={j}
                            className={j === 0 ? "pl-6" : j === 7 ? "pr-6 text-right" : ""}
                          >
                            <span className="inline-block h-4 w-full max-w-[120px] animate-pulse rounded bg-muted" />
                          </TableCell>
                        ))}
                      </TableRow>
                    ))
                  ) : filtered.length === 0 ? (
                    <TableRow className="border-border/60">
                      <TableCell colSpan={8} className="py-12">
                        <div className="flex flex-col items-center justify-center gap-2 text-center text-sm text-muted-foreground">
                          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-muted">
                            <Inbox className="h-5 w-5" />
                          </span>
                          <div className="font-medium text-foreground">
                            {carriers && carriers.length > 0
                              ? "No carriers match your search"
                              : "No carriers yet"}
                          </div>
                          <div className="text-xs">
                            {carriers && carriers.length > 0
                              ? "Try a different keyword."
                              : "Add your first carrier or broker to see it here."}
                          </div>
                        </div>
                      </TableCell>
                    </TableRow>
                  ) : (
                    filtered.map((c) => {
                      const tier = TIER_LABELS[c.tier];
                      const portal = PORTAL_STATUS_LABELS[c.portalInviteStatus];
                      const insurance = insuranceStatus(c);
                      const insuranceLabel = INSURANCE_STATUS_LABELS[insurance];
                      return (
                        <TableRow key={c.carrierId} className="border-border/60">
                          <TableCell className="pl-6">
                            <Link
                              to="/carriers/$carrierId"
                              params={{ carrierId: c.carrierId }}
                              className="font-medium text-primary underline-offset-4 hover:underline"
                            >
                              {c.companyName}
                            </Link>
                            <div className="text-xs text-muted-foreground">
                              {c.carrierKind === "broker" ? "Broker" : "Carrier"} · {c.carrierId}
                              {c.blacklisted ? (
                                <Badge
                                  variant="outline"
                                  className={`ml-2 ${toneBadge.destructive}`}
                                >
                                  {t("Blacklisted")}
                                </Badge>
                              ) : null}
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className={toneBadge[tier.tone]}>
                              {tier.label}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {formatEquipmentTypes(c.equipmentTypes)}
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {formatLanesServed(c.lanesServed)}
                          </TableCell>
                          <TableCell className="tabular-nums text-muted-foreground">
                            {c.otdPercentage ? `${c.otdPercentage}%` : "—"}
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className={toneBadge[insuranceLabel.tone]}>
                              {insuranceLabel.label}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className={toneBadge[portal.tone]}>
                              {portal.label}
                            </Badge>
                          </TableCell>
                          <TableCell className="pr-6 text-right">
                            <div className="flex items-center justify-end gap-1">
                              <CarrierActionsMenu
                                carrier={c}
                                role={role}
                                onChanged={applyUpdated}
                              />
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-muted-foreground hover:text-destructive"
                                aria-label={`Delete ${c.companyName}`}
                                onClick={() => setCarrierToDelete(c)}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
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

      <AlertDialog
        open={carrierToDelete !== null}
        onOpenChange={(open) => {
          if (!open && !deleting) setCarrierToDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("Delete carrier?")}</AlertDialogTitle>
            <AlertDialogDescription>
              {carrierToDelete ? (
                <>
                  This will permanently remove{" "}
                  <span className="font-medium text-foreground">{carrierToDelete.companyName}</span>{" "}
                  ({carrierToDelete.carrierId}). This cannot be undone.
                </>
              ) : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>{t("Cancel")}</AlertDialogCancel>
            <Button variant="destructive" disabled={deleting} onClick={() => void confirmDelete()}>
              {deleting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {t("Deleting…")}
                </>
              ) : (
                "Delete carrier"
              )}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
