import * as React from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Copy,
  FileSpreadsheet,
  Filter,
  Link2,
  Loader2,
  PencilLine,
  Plus,
  RouteIcon,
  Search,
  Send,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

import { PageHeader } from "@/components/page-header";
import { useAuth } from "@/lib/auth";
import {
  auditActorFromAuth,
  recordAdminAuditLog,
} from "@/lib/admin-audit-store";
import { createLoad } from "@/lib/loads-store";
import {
  createQuote,
  deleteQuote,
  listAllQuotesCached,
  QUOTE_STATUS_VALUES,
  totalRate,
  updateQuote,
  type QuoteRecord,
  type QuoteStatus,
} from "@/lib/quotes-store";
import { useOperationalList } from "@/hooks/use-operational-list";
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
import { Skeleton } from "@/components/ui/skeleton";
import { usePageReady } from "@/components/page-load-gate";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";

export const Route = createFileRoute("/quotes")({
  head: () => ({
    meta: [
      { title: "Quotes — Logistics Software" },
      { name: "description", content: "Customer quotes, pricing rules, and approval workflows." },
    ],
  }),
  component: Page,
});

const FIELDS = [
  "Customer",
  "Lane",
  "Stops",
  "Equipment",
  "Dates",
  "Rate components (base, fuel, accessorials)",
  "Risk score",
  "AI notes",
];

const ACTIONS = [
  { label: "Convert to Load(s)", icon: RouteIcon },
  { label: "Duplicate", icon: Copy },
  { label: "Approve route", icon: ShieldCheck },
  { label: "Send to customer (email/portal)", icon: Send },
  { label: "Attach routing guide", icon: Link2 },
];

const ACCEPTANCE = [
  "Conversion to loads preserves all pricing.",
  "Conversion generates unique load IDs.",
  "Conversion writes an audit trail entry.",
];

const statusTone: Record<QuoteStatus, string> = {
  Draft: "border-border bg-muted text-muted-foreground",
  Pending: "border-warning/40 bg-warning/20 text-warning-foreground",
  Sent: "border-info/40 bg-info/15 text-info",
  Accepted: "border-success/40 bg-success/15 text-success",
  Rejected: "border-destructive/30 bg-destructive/10 text-destructive",
  Expired: "border-border bg-muted text-muted-foreground",
  Converted: "border-primary/30 bg-primary/10 text-primary",
};

function money(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value || 0);
}

function riskTone(score: number) {
  if (score <= 25) return "border-success/40 bg-success/15 text-success";
  if (score <= 45) return "border-warning/40 bg-warning/20 text-warning-foreground";
  return "border-destructive/30 bg-destructive/10 text-destructive";
}

function generateLoadId() {
  const n = Math.floor(2800 + Math.random() * 999);
  return `L-${n}`;
}

type QuoteFormState = {
  customer: string;
  origin: string;
  destination: string;
  stops: string;
  equipment: string;
  pickupDate: string;
  deliveryDate: string;
  baseRate: string;
  fuelSurcharge: string;
  accessorials: string;
  riskScore: string;
  aiNotes: string;
  status: QuoteStatus;
  owner: string;
};

function rowToForm(row: QuoteRecord): QuoteFormState {
  return {
    customer: row.customer,
    origin: row.origin,
    destination: row.destination,
    stops: row.stops,
    equipment: row.equipment,
    pickupDate: row.pickupDate,
    deliveryDate: row.deliveryDate,
    baseRate: String(row.baseRate),
    fuelSurcharge: String(row.fuelSurcharge),
    accessorials: String(row.accessorials),
    riskScore: String(row.riskScore),
    aiNotes: row.aiNotes,
    status: row.status,
    owner: row.owner,
  };
}

function emptyForm(defaultOwner: string): QuoteFormState {
  return {
    customer: "",
    origin: "",
    destination: "",
    stops: "0",
    equipment: "Dry Van",
    pickupDate: "",
    deliveryDate: "",
    baseRate: "0",
    fuelSurcharge: "0",
    accessorials: "0",
    riskScore: "0",
    aiNotes: "",
    status: "Draft",
    owner: defaultOwner,
  };
}

function StatTile({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "default" | "success" | "warning" | "info";
}) {
  const toneClass = {
    default: "bg-muted text-foreground",
    success: "bg-success/15 text-success",
    warning: "bg-warning/20 text-warning-foreground",
    info: "bg-info/15 text-info",
  } as const;
  return (
    <Card className="border-border/70 shadow-sm">
      <CardContent className="p-4">
        <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </div>
        <div className="mt-2 flex items-baseline justify-between">
          <div className="text-2xl font-semibold tracking-tight text-foreground">{value}</div>
          <Badge variant="secondary" className={toneClass[tone]}>
            Live
          </Badge>
        </div>
      </CardContent>
    </Card>
  );
}

function QuotesFeatureSpec() {
  return (
    <Card className="border-border/70 shadow-sm">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Quotes — Feature Spec</CardTitle>
        <CardDescription>
          Purpose: Price proposals that can convert to one or many loads.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Fields
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {FIELDS.map((field) => (
              <Badge
                key={field}
                variant="outline"
                className="border-border/70 bg-muted text-foreground"
              >
                {field}
              </Badge>
            ))}
          </div>
        </div>

        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Actions
          </p>
          <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {ACTIONS.map(({ label, icon: Icon }) => (
              <div
                key={label}
                className="flex items-center gap-2 rounded-md border border-border/70 px-2.5 py-1.5 text-sm text-muted-foreground"
              >
                <Icon className="h-4 w-4 text-primary" />
                {label}
              </div>
            ))}
          </div>
        </div>

        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Acceptance
          </p>
          <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {ACCEPTANCE.map((text) => (
              <Badge
                key={text}
                variant="outline"
                className="justify-start border-success/40 bg-success/15 text-success"
              >
                {text}
              </Badge>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function Page() {
  const { user } = useAuth();
  const defaultOwner = user?.name ?? user?.email ?? "Unassigned";
  const actor = React.useMemo(() => auditActorFromAuth(user), [user]);

  const [formOpen, setFormOpen] = React.useState(false);
  const [formMode, setFormMode] = React.useState<"create" | "edit">("create");
  const [editingQuoteId, setEditingQuoteId] = React.useState<string | null>(null);
  const [formBusy, setFormBusy] = React.useState(false);
  const [form, setForm] = React.useState<QuoteFormState>(() => emptyForm(defaultOwner));

  const [deleteTarget, setDeleteTarget] = React.useState<QuoteRecord | null>(null);
  const [deleteBusy, setDeleteBusy] = React.useState(false);
  const [rowBusyId, setRowBusyId] = React.useState<string | null>(null);

  const [search, setSearch] = React.useState("");
  const [statusFilter, setStatusFilter] = React.useState("all");
  const typed = search.trim().toLowerCase();

  const fetchList = React.useCallback(async ({ force }: { force: boolean }) => {
    const items = await listAllQuotesCached({ force });
    return items.sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
  }, []);

  const {
    items,
    loading: loadingRows,
    refreshing: refreshingRows,
    error: syncError,
    setItems,
    setError: setSyncError,
    refresh: refreshQuotes,
  } = useOperationalList<QuoteRecord>({
    queryKey: ["quotes"],
    fetchList,
    errorMessage: "Failed to load quotes from AWS.",
  });

  const rows = items ?? [];
  const setRows = React.useCallback(
    (updater: React.SetStateAction<QuoteRecord[]>) => {
      setItems((prev) => {
        const current = prev ?? [];
        return typeof updater === "function" ? updater(current) : updater;
      });
    },
    [setItems],
  );

  React.useEffect(() => {
    setForm((prev) => (prev.owner.trim() ? prev : { ...prev, owner: defaultOwner }));
  }, [defaultOwner]);

  const filtered = React.useMemo(() => {
    return rows.filter((row) => {
      const statusMatch = statusFilter === "all" || row.status === statusFilter;
      const queryMatch =
        !typed ||
        [row.quoteId, row.customer, row.origin, row.destination, row.owner, row.status]
          .join(" ")
          .toLowerCase()
          .includes(typed);
      return statusMatch && queryMatch;
    });
  }, [rows, statusFilter, typed]);

  const stats = React.useMemo(() => {
    const pending = rows.filter((r) => r.status === "Pending" || r.status === "Draft").length;
    const sent = rows.filter((r) => r.status === "Sent").length;
    const accepted = rows.filter((r) => r.status === "Accepted" || r.status === "Converted").length;
    return { pending, sent, accepted, total: rows.length };
  }, [rows]);

  const openCreateForm = React.useCallback(() => {
    setFormMode("create");
    setEditingQuoteId(null);
    setForm(emptyForm(defaultOwner));
    setFormOpen(true);
  }, [defaultOwner]);

  const openEditForm = React.useCallback((row: QuoteRecord) => {
    setFormMode("edit");
    setEditingQuoteId(row.quoteId);
    setForm(rowToForm(row));
    setFormOpen(true);
  }, []);

  const submitForm = React.useCallback(async () => {
    const customer = form.customer.trim();
    const origin = form.origin.trim();
    const destination = form.destination.trim();
    const owner = form.owner.trim();
    if (!customer || !origin || !destination || !owner) {
      setSyncError("Customer, origin, destination, and owner are required.");
      return;
    }

    setFormBusy(true);
    setSyncError(null);
    try {
      const payload = {
        customer,
        origin,
        destination,
        stops: form.stops.trim(),
        equipment: form.equipment,
        pickupDate: form.pickupDate.trim(),
        deliveryDate: form.deliveryDate.trim(),
        baseRate: Number.parseFloat(form.baseRate) || 0,
        fuelSurcharge: Number.parseFloat(form.fuelSurcharge) || 0,
        accessorials: Number.parseFloat(form.accessorials) || 0,
        riskScore: Math.min(100, Math.max(0, Number.parseInt(form.riskScore, 10) || 0)),
        aiNotes: form.aiNotes.trim(),
        status: form.status,
        owner,
      };

      if (formMode === "edit" && editingQuoteId) {
        const current = rows.find((row) => row.quoteId === editingQuoteId);
        if (!current) throw new Error("Quote record not found.");
        const updated = await updateQuote({ ...current, ...payload });
        setRows((prev) => prev.map((row) => (row.quoteId === editingQuoteId ? updated : row)));
      } else {
        const created = await createQuote({
          quoteId: "",
          ...payload,
          createdBy: user?.userId,
        });
        setRows((prev) => [created, ...prev]);
      }
      setFormOpen(false);
      setEditingQuoteId(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to save quote.";
      setSyncError(message);
    } finally {
      setFormBusy(false);
    }
  }, [editingQuoteId, form, formMode, rows, user?.userId]);

  const handleDelete = React.useCallback(async () => {
    if (!deleteTarget) return;
    setDeleteBusy(true);
    setSyncError(null);
    try {
      await deleteQuote(deleteTarget.quoteId);
      setRows((prev) => prev.filter((row) => row.quoteId !== deleteTarget.quoteId));
      setDeleteTarget(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to delete quote.";
      setSyncError(message);
    } finally {
      setDeleteBusy(false);
    }
  }, [deleteTarget]);

  const duplicateQuote = React.useCallback(
    async (row: QuoteRecord) => {
      setRowBusyId(row.quoteId);
      setSyncError(null);
      try {
        const created = await createQuote({
          quoteId: "",
          customer: row.customer,
          origin: row.origin,
          destination: row.destination,
          stops: row.stops,
          equipment: row.equipment,
          pickupDate: row.pickupDate,
          deliveryDate: row.deliveryDate,
          baseRate: row.baseRate,
          fuelSurcharge: row.fuelSurcharge,
          accessorials: row.accessorials,
          riskScore: row.riskScore,
          aiNotes: row.aiNotes,
          status: "Draft",
          owner: row.owner,
          createdBy: user?.userId,
        });
        setRows((prev) => [created, ...prev]);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to duplicate quote.";
        setSyncError(message);
      } finally {
        setRowBusyId(null);
      }
    },
    [user?.userId],
  );

  const saveRowUpdate = React.useCallback(async (row: QuoteRecord, patch: Partial<QuoteRecord>) => {
    setRowBusyId(row.quoteId);
    setSyncError(null);
    try {
      const updated = await updateQuote({ ...row, ...patch });
      setRows((prev) => prev.map((item) => (item.quoteId === row.quoteId ? updated : item)));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to update quote.";
      setSyncError(message);
    } finally {
      setRowBusyId(null);
    }
  }, []);

  const convertToLoads = React.useCallback(
    async (row: QuoteRecord) => {
      setRowBusyId(row.quoteId);
      setSyncError(null);
      try {
        const stopCount = Math.max(1, Number.parseInt(row.stops, 10) || 1);
        const createdLoadIds: string[] = [];
        for (let i = 0; i < stopCount; i += 1) {
          const loadId = generateLoadId();
          await createLoad({
            loadId,
            loadType: "FTL",
            loadStatus: "Booked",
            customer: row.customer,
            pickupCity: row.origin,
            deliveryCity: row.destination,
            equipmentType: row.equipment,
            pickupDate: row.pickupDate,
            deliveryDate: row.deliveryDate,
            customerRate: String(totalRate(row)),
            linehaulRate: String(row.baseRate),
            fuelSurcharge: String(row.fuelSurcharge),
            accessorialCharges: String(row.accessorials),
            internalNotes: `Converted from quote ${row.quoteId}. ${row.aiNotes}`.trim(),
            createdBy: user?.userId,
          });
          createdLoadIds.push(loadId);
        }

        const updated = await updateQuote({
          ...row,
          status: "Converted",
          convertedLoadIds: [...row.convertedLoadIds, ...createdLoadIds],
        });
        setRows((prev) => prev.map((item) => (item.quoteId === row.quoteId ? updated : item)));

        await recordAdminAuditLog({
          actor,
          action: "Convert Quote to Load(s)",
          module: "Quotes",
          record: row.quoteId,
          details: `Converted ${row.quoteId} (${row.customer}, ${row.origin} → ${row.destination}) into ${createdLoadIds.length} load(s): ${createdLoadIds.join(", ")}. Pricing preserved: base ${money(row.baseRate)}, fuel ${money(row.fuelSurcharge)}, accessorials ${money(row.accessorials)}.`,
        });

        const firstId = createdLoadIds[0];
        toast.success(
          createdLoadIds.length === 1
            ? `Created load ${firstId}`
            : `Created ${createdLoadIds.length} loads`,
          firstId
            ? {
                action: {
                  label: "Open load",
                  onClick: () => {
                    window.location.assign(`/loads/${firstId}`);
                  },
                },
              }
            : undefined,
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to convert quote to loads.";
        setSyncError(message);
      } finally {
        setRowBusyId(null);
      }
    },
    [actor, user?.userId],
  );

  usePageReady(Boolean(loadingRows && rows.length === 0));

  return (
    <div>
      <PageHeader
        title="Quotes"
        description="Customer quotes, pricing rules, and approval workflows."
        actions={
          <>
            <Button variant="outline" size="sm" className="gap-1.5">
              <Filter className="h-4 w-4" /> Filters
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={() => void refreshQuotes()}
              disabled={refreshingRows || loadingRows}
            >
              {refreshingRows ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Refresh
            </Button>
            <Button size="sm" className="gap-1.5" onClick={openCreateForm}>
              <Plus className="h-4 w-4" /> New Quote
            </Button>
          </>
        }
      />

      <div className="space-y-6 px-4 py-6 sm:px-6 lg:px-8">
        {syncError ? (
          <Card className="border-destructive/30 bg-destructive/8 shadow-sm">
            <CardContent className="p-4 text-sm text-destructive">{syncError}</CardContent>
          </Card>
        ) : null}

        {loadingRows ? null : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatTile label="Pending" value={`${stats.pending}`} tone="warning" />
            <StatTile label="Sent" value={`${stats.sent}`} tone="info" />
            <StatTile label="Accepted / Converted" value={`${stats.accepted}`} tone="success" />
            <StatTile label="Total Quotes" value={`${stats.total}`} tone="default" />
          </div>
        )}

        <Card className="border-border/70 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Quotes</CardTitle>
            <CardDescription>Connected to AWS DynamoDB — live customer quotes.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr),200px]">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  className="pl-8"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search quote ID, customer, lane, owner, status..."
                />
              </div>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  {QUOTE_STATUS_VALUES.map((status) => (
                    <SelectItem key={status} value={status}>
                      {status}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="overflow-x-auto rounded-lg border border-border/70">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Quote ID</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead>Lane</TableHead>
                    <TableHead>Stops</TableHead>
                    <TableHead>Equipment</TableHead>
                    <TableHead>Dates</TableHead>
                    <TableHead>Rate</TableHead>
                    <TableHead>Risk</TableHead>
                    <TableHead>AI Notes</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loadingRows ? (
                    Array.from({ length: 6 }).map((_, i) => (
                      <TableRow key={`skel-${i}`}>
                        {Array.from({ length: 11 }).map((__, j) => (
                          <TableCell key={j}>
                            <Skeleton className="h-4 w-full max-w-[110px]" />
                          </TableCell>
                        ))}
                      </TableRow>
                    ))
                  ) : filtered.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={11} className="py-8 text-center text-sm text-muted-foreground">
                        No quotes found.
                      </TableCell>
                    </TableRow>
                  ) : (
                    filtered.map((row) => {
                      const busy = rowBusyId === row.quoteId;
                      return (
                        <TableRow key={row.quoteId}>
                          <TableCell className="font-medium text-primary">{row.quoteId}</TableCell>
                          <TableCell>{row.customer}</TableCell>
                          <TableCell className="text-xs">
                            {row.origin} → {row.destination}
                          </TableCell>
                          <TableCell>{row.stops || "0"}</TableCell>
                          <TableCell>{row.equipment}</TableCell>
                          <TableCell className="text-xs tabular-nums">
                            {row.pickupDate || "—"} / {row.deliveryDate || "—"}
                          </TableCell>
                          <TableCell className="text-xs">
                            {money(totalRate(row))}
                            <div className="text-muted-foreground">
                              base {money(row.baseRate)} · fuel {money(row.fuelSurcharge)} · acc{" "}
                              {money(row.accessorials)}
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className={riskTone(row.riskScore)}>
                              {row.riskScore}
                            </Badge>
                          </TableCell>
                          <TableCell className="max-w-[200px] truncate text-xs text-muted-foreground">
                            {row.aiNotes || "—"}
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className={statusTone[row.status]}>
                              {row.status}
                            </Badge>
                            {row.routeApproved ? (
                              <div className="mt-1 text-[10px] text-success">Route approved</div>
                            ) : null}
                            {row.routingGuideAttached ? (
                              <div className="text-[10px] text-info">Routing guide attached</div>
                            ) : null}
                            {row.convertedLoadIds.length > 0 ? (
                              <div className="mt-1 flex flex-wrap gap-1 text-[10px] text-muted-foreground">
                                Loads:{" "}
                                {row.convertedLoadIds.map((id, idx) => (
                                  <span key={id}>
                                    {idx > 0 ? ", " : null}
                                    <Link
                                      to="/loads/$loadId"
                                      params={{ loadId: id }}
                                      className="font-medium text-primary underline-offset-2 hover:underline"
                                    >
                                      {id}
                                    </Link>
                                  </span>
                                ))}
                              </div>
                            ) : null}
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-wrap gap-1">
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={busy || row.status === "Converted"}
                                onClick={() => void convertToLoads(row)}
                              >
                                <RouteIcon className="mr-1 h-3.5 w-3.5" />
                                Convert to Load(s)
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={busy}
                                onClick={() => void duplicateQuote(row)}
                              >
                                <Copy className="mr-1 h-3.5 w-3.5" />
                                Duplicate
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={busy}
                                onClick={() => void saveRowUpdate(row, { routeApproved: true })}
                              >
                                <ShieldCheck className="mr-1 h-3.5 w-3.5" />
                                Approve route
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={busy}
                                onClick={() => void saveRowUpdate(row, { status: "Sent" })}
                              >
                                <Send className="mr-1 h-3.5 w-3.5" />
                                Send to customer
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={busy}
                                onClick={() =>
                                  void saveRowUpdate(row, { routingGuideAttached: true })
                                }
                              >
                                <Link2 className="mr-1 h-3.5 w-3.5" />
                                Attach routing guide
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={busy}
                                onClick={() => openEditForm(row)}
                              >
                                <PencilLine className="mr-1 h-3.5 w-3.5" />
                                Edit
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                className="text-destructive"
                                disabled={busy}
                                onClick={() => setDeleteTarget(row)}
                              >
                                <Trash2 className="mr-1 h-3.5 w-3.5" />
                                Delete
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

        <QuotesFeatureSpec />
      </div>

      <Dialog
        open={formOpen}
        onOpenChange={(open) => {
          setFormOpen(open);
          if (!open) setEditingQuoteId(null);
        }}
      >
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{formMode === "create" ? "Create Quote" : "Edit Quote"}</DialogTitle>
            <DialogDescription>
              This form writes directly to AWS DynamoDB (
              {formMode === "create" ? "create" : "update"}).
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 py-1 sm:grid-cols-2">
            <div>
              <label className="text-xs font-medium text-muted-foreground">Customer</label>
              <Input
                value={form.customer}
                onChange={(e) => setForm((prev) => ({ ...prev, customer: e.target.value }))}
                placeholder="Customer name"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Equipment</label>
              <Input
                value={form.equipment}
                onChange={(e) => setForm((prev) => ({ ...prev, equipment: e.target.value }))}
                placeholder="Dry Van"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Origin</label>
              <Input
                value={form.origin}
                onChange={(e) => setForm((prev) => ({ ...prev, origin: e.target.value }))}
                placeholder="Chicago, IL"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Destination</label>
              <Input
                value={form.destination}
                onChange={(e) => setForm((prev) => ({ ...prev, destination: e.target.value }))}
                placeholder="Dallas, TX"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Stops</label>
              <Input
                type="number"
                min={0}
                value={form.stops}
                onChange={(e) => setForm((prev) => ({ ...prev, stops: e.target.value }))}
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Status</label>
              <Select
                value={form.status}
                onValueChange={(value) =>
                  setForm((prev) => ({ ...prev, status: value as QuoteStatus }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {QUOTE_STATUS_VALUES.map((status) => (
                    <SelectItem key={status} value={status}>
                      {status}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Pickup Date</label>
              <Input
                value={form.pickupDate}
                onChange={(e) => setForm((prev) => ({ ...prev, pickupDate: e.target.value }))}
                placeholder="Jul 15, 2026"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Delivery Date</label>
              <Input
                value={form.deliveryDate}
                onChange={(e) => setForm((prev) => ({ ...prev, deliveryDate: e.target.value }))}
                placeholder="Jul 17, 2026"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Base Rate</label>
              <Input
                type="number"
                value={form.baseRate}
                onChange={(e) => setForm((prev) => ({ ...prev, baseRate: e.target.value }))}
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Fuel Surcharge</label>
              <Input
                type="number"
                value={form.fuelSurcharge}
                onChange={(e) => setForm((prev) => ({ ...prev, fuelSurcharge: e.target.value }))}
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Accessorials</label>
              <Input
                type="number"
                value={form.accessorials}
                onChange={(e) => setForm((prev) => ({ ...prev, accessorials: e.target.value }))}
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Risk Score</label>
              <Input
                type="number"
                min={0}
                max={100}
                value={form.riskScore}
                onChange={(e) => setForm((prev) => ({ ...prev, riskScore: e.target.value }))}
              />
            </div>
            <div className="sm:col-span-2">
              <label className="text-xs font-medium text-muted-foreground">AI Notes</label>
              <Textarea
                rows={3}
                value={form.aiNotes}
                onChange={(e) => setForm((prev) => ({ ...prev, aiNotes: e.target.value }))}
                placeholder="AI pricing rationale and lane observations"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="text-xs font-medium text-muted-foreground">Owner</label>
              <Input
                value={form.owner}
                onChange={(e) => setForm((prev) => ({ ...prev, owner: e.target.value }))}
                placeholder="Owner"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" disabled={formBusy} onClick={() => setFormOpen(false)}>
              Cancel
            </Button>
            <Button disabled={formBusy} onClick={() => void submitForm()}>
              {formBusy ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Saving...
                </>
              ) : formMode === "create" ? (
                "Create Quote"
              ) : (
                "Save Changes"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(deleteTarget)} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Quote?</DialogTitle>
            <DialogDescription>
              {deleteTarget
                ? `This will permanently remove ${deleteTarget.quoteId} (${deleteTarget.customer}) from AWS DynamoDB.`
                : "This action cannot be undone."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" disabled={deleteBusy} onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button variant="destructive" disabled={deleteBusy} onClick={() => void handleDelete()}>
              {deleteBusy ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Deleting...
                </>
              ) : (
                "Delete"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
