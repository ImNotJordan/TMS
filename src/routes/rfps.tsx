import * as React from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Download,
  FileCheck2,
  FileOutput,
  FileSpreadsheet,
  Filter,
  Link2,
  Loader2,
  PencilLine,
  PlayCircle,
  Save,
  Search,
  ShieldCheck,
  Sparkles,
  Trash2,
  UploadCloud,
  Wand2,
} from "lucide-react";

import { PageHeader } from "@/components/page-header";
import { useAuth } from "@/lib/auth";
import { isWorkspaceAiEnabled } from "@/lib/integrations-config";
import { createQuote } from "@/lib/quotes-store";
import { createRfp, deleteRfp, listAllRfps, updateRfp, type RfpRecord } from "@/lib/rfps-store";
import { toast } from "sonner";
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
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/rfps")({
  head: () => ({
    meta: [
      { title: "RFPs - Logistics Software" },
      {
        name: "description",
        content:
          "Upload, normalize, price, analyze, approve, and convert customer RFP lane files into quotes.",
      },
    ],
  }),
  component: Page,
});

const STATUSES = [
  "Draft",
  "Uploaded",
  "Mapping Required",
  "Normalized",
  "Pricing",
  "Ready for Review",
  "Approval Pending",
  "Approved",
  "Quotes Created",
  "Exported",
  "Submitted",
  "Archived",
] as const;

type RfpStatus = (typeof STATUSES)[number];
type NetworkFit = "Strong Fit" | "Good Fit" | "Moderate Fit" | "Weak Fit" | "Poor Fit" | "No Fit";

type RfpRow = {
  rfpId: string;
  rfpName: string;
  customer: string;
  fileType: "XLSX" | "XLS" | "CSV";
  laneCount: number;
  status: RfpStatus;
  pricingProgress: number;
  owner: string;
  approver: string;
  uploadDate: string;
  lastModified: string;
  dueDate: string;
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
};

type PricingLane = {
  laneId: string;
  origin: string;
  destination: string;
  equipment: string;
  frequency: string;
  startDate: string;
  histBuy30: number;
  histSell30: number;
  histBuy60: number;
  histSell60: number;
  histBuy90: number;
  histSell90: number;
  suggestedBuy: number;
  suggestedSell: number;
  marginUsd: number;
  marginPct: number;
  similarity: number;
  geographyMatch: number;
  equipmentMatch: number;
  dowMatch: number;
  dwellMatch: number;
  seasonalityMatch: number;
  carrierMatch: number;
  confidence: number;
  matchedHistorical: number;
  matchedActive: number;
  backhaul: number;
  networkFit: NetworkFit;
  riskScore: number;
  approvalStatus: "Pending Approval" | "Approved" | "Changes Requested";
  why: string;
};

const statusTone: Record<RfpStatus, string> = {
  Draft: "border-border bg-muted text-muted-foreground",
  Uploaded: "border-info/40 bg-info/15 text-info",
  "Mapping Required": "border-warning/40 bg-warning/20 text-warning-foreground",
  Normalized: "border-info/40 bg-info/15 text-info",
  Pricing: "border-primary/30 bg-primary/10 text-primary",
  "Ready for Review": "border-info/40 bg-info/15 text-info",
  "Approval Pending": "border-warning/40 bg-warning/20 text-warning-foreground",
  Approved: "border-success/40 bg-success/15 text-success",
  "Quotes Created": "border-success/40 bg-success/15 text-success",
  Exported: "border-primary/30 bg-primary/10 text-primary",
  Submitted: "border-success/40 bg-success/15 text-success",
  Archived: "border-border bg-muted text-muted-foreground",
};

function money(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

function networkFitTone(fit: NetworkFit) {
  if (fit === "Strong Fit") return "border-success/40 bg-success/15 text-success";
  if (fit === "Good Fit") return "border-info/40 bg-info/15 text-info";
  if (fit === "Moderate Fit") return "border-warning/40 bg-warning/20 text-warning-foreground";
  if (fit === "Weak Fit") return "border-warning/40 bg-warning/20 text-warning-foreground";
  return "border-destructive/30 bg-destructive/10 text-destructive";
}

function riskTone(score: number) {
  if (score <= 25) return "border-success/40 bg-success/15 text-success";
  if (score <= 45) return "border-warning/40 bg-warning/20 text-warning-foreground";
  return "border-destructive/30 bg-destructive/10 text-destructive";
}

function formatDisplayDate(date: Date): string {
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatDisplayDateTime(date: Date): string {
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function mapRecordToRow(record: RfpRecord): RfpRow {
  return {
    rfpId: record.rfpId,
    rfpName: record.rfpName,
    customer: record.customer,
    fileType: record.fileType,
    laneCount: record.laneCount,
    status: record.status,
    pricingProgress: record.pricingProgress,
    owner: record.owner,
    approver: record.approver,
    uploadDate: record.uploadDate || formatDisplayDate(new Date(record.createdAt)),
    lastModified: record.lastModified || formatDisplayDateTime(new Date(record.updatedAt)),
    dueDate: record.dueDate,
    createdBy: record.createdBy,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

function mapRowToRecord(row: RfpRow): RfpRecord {
  return {
    rfpId: row.rfpId,
    rfpName: row.rfpName,
    customer: row.customer,
    fileType: row.fileType,
    laneCount: row.laneCount,
    status: row.status,
    pricingProgress: row.pricingProgress,
    owner: row.owner,
    approver: row.approver,
    uploadDate: row.uploadDate,
    lastModified: row.lastModified,
    dueDate: row.dueDate,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

type RfpFormState = {
  rfpName: string;
  customer: string;
  fileType: RfpRow["fileType"];
  laneCount: string;
  status: RfpStatus;
  pricingProgress: string;
  owner: string;
  approver: string;
  dueDate: string;
};

function rowToForm(row: RfpRow): RfpFormState {
  return {
    rfpName: row.rfpName,
    customer: row.customer,
    fileType: row.fileType,
    laneCount: String(row.laneCount),
    status: row.status,
    pricingProgress: String(row.pricingProgress),
    owner: row.owner,
    approver: row.approver,
    dueDate: row.dueDate,
  };
}

function emptyForm(defaultOwner: string): RfpFormState {
  return {
    rfpName: "",
    customer: "",
    fileType: "XLSX",
    laneCount: "0",
    status: "Draft",
    pricingProgress: "0",
    owner: defaultOwner,
    approver: "",
    dueDate: "",
  };
}

function EmptyTableRow({ colSpan, message }: { colSpan: number; message: string }) {
  return (
    <TableRow>
      <TableCell colSpan={colSpan} className="py-8 text-center text-sm text-muted-foreground">
        {message}
      </TableCell>
    </TableRow>
  );
}

function WorkspaceEmptyCard({ title, description }: { title: string; description: string }) {
  return (
    <Card className="border-dashed border-border/70 shadow-none">
      <CardContent className="p-8 text-center">
        <div className="text-sm font-medium">{title}</div>
        <div className="mt-1 text-xs text-muted-foreground">{description}</div>
      </CardContent>
    </Card>
  );
}

function Page() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const defaultOwner = user?.name ?? user?.email ?? "Unassigned";

  const [rfpRows, setRfpRows] = React.useState<RfpRow[]>([]);
  const [workspaceRfpId, setWorkspaceRfpId] = React.useState<string | null>(null);
  const [loadingRows, setLoadingRows] = React.useState(true);
  const [refreshingRows, setRefreshingRows] = React.useState(false);
  const [syncError, setSyncError] = React.useState<string | null>(null);
  const [formOpen, setFormOpen] = React.useState(false);
  const [formMode, setFormMode] = React.useState<"create" | "edit">("create");
  const [editingRfpId, setEditingRfpId] = React.useState<string | null>(null);
  const [formBusy, setFormBusy] = React.useState(false);
  const [deleteTarget, setDeleteTarget] = React.useState<RfpRow | null>(null);
  const [deleteBusy, setDeleteBusy] = React.useState(false);
  const [rowBusyId, setRowBusyId] = React.useState<string | null>(null);
  const [form, setForm] = React.useState<RfpFormState>(() => emptyForm(defaultOwner));

  const [view, setView] = React.useState<"workspace" | "list">("workspace");
  const [workspaceTab, setWorkspaceTab] = React.useState("upload");
  const [mobileTab, setMobileTab] = React.useState("upload");
  const [search, setSearch] = React.useState("");
  const [statusFilter, setStatusFilter] = React.useState("all");
  const [ownerFilter, setOwnerFilter] = React.useState("all");
  const [laneId, setLaneId] = React.useState<string | null>(null);
  const typed = search.trim().toLowerCase();

  const fetchRfps = React.useCallback(async (mode: "initial" | "refresh" = "refresh") => {
    if (mode === "initial") setLoadingRows(true);
    else setRefreshingRows(true);
    setSyncError(null);
    try {
      const items = await listAllRfps();
      if (items.length === 0) {
        setRfpRows([]);
        return;
      }
      const mapped = items
        .map(mapRecordToRow)
        .sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
      setRfpRows(mapped);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load RFPs from AWS.";
      setSyncError(message);
    } finally {
      setLoadingRows(false);
      setRefreshingRows(false);
    }
  }, []);

  React.useEffect(() => {
    void fetchRfps("initial");
  }, [fetchRfps]);

  React.useEffect(() => {
    setForm((prev) => {
      if (prev.owner.trim()) return prev;
      return { ...prev, owner: defaultOwner };
    });
  }, [defaultOwner]);

  const filtered = React.useMemo(() => {
    return rfpRows.filter((row) => {
      const statusMatch = statusFilter === "all" || row.status === statusFilter;
      const ownerMatch = ownerFilter === "all" || row.owner === ownerFilter;
      const queryMatch =
        !typed ||
        [row.rfpName, row.customer, row.owner, row.approver, row.status]
          .join(" ")
          .toLowerCase()
          .includes(typed);
      return statusMatch && ownerMatch && queryMatch;
    });
  }, [ownerFilter, rfpRows, statusFilter, typed]);

  const suggestions = React.useMemo(
    () => (typed ? filtered.slice(0, 5).map((row) => `${row.rfpName} - ${row.customer}`) : []),
    [filtered, typed],
  );

  const pricingLanes = React.useMemo<PricingLane[]>(() => [], []);

  const lane = React.useMemo(
    () => pricingLanes.find((item) => item.laneId === laneId) ?? null,
    [laneId, pricingLanes],
  );

  const active = React.useMemo(() => {
    if (workspaceRfpId) {
      const selected = rfpRows.find((row) => row.rfpId === workspaceRfpId);
      if (selected) return selected;
    }
    return rfpRows[0] ?? null;
  }, [rfpRows, workspaceRfpId]);

  React.useEffect(() => {
    if (rfpRows.length === 0) {
      setWorkspaceRfpId(null);
      return;
    }
    if (!workspaceRfpId || !rfpRows.some((row) => row.rfpId === workspaceRfpId)) {
      setWorkspaceRfpId(rfpRows[0].rfpId);
    }
  }, [rfpRows, workspaceRfpId]);

  const rfpStats = React.useMemo(() => {
    const activeRfps = rfpRows.filter((row) => row.status !== "Archived");
    const totalLanes = rfpRows.reduce((sum, row) => sum + (row.laneCount || 0), 0);
    const readyForQuotes = rfpRows
      .filter((row) =>
        ["Approved", "Quotes Created", "Exported", "Submitted"].includes(row.status),
      )
      .reduce((sum, row) => sum + (row.laneCount || 0), 0);
    const avgProgress =
      rfpRows.length > 0
        ? Math.round(rfpRows.reduce((sum, row) => sum + row.pricingProgress, 0) / rfpRows.length)
        : 0;
    return { activeRfps: activeRfps.length, totalLanes, readyForQuotes, avgProgress };
  }, [rfpRows]);

  const convertActiveRfpToQuotes = React.useCallback(async () => {
    if (!active) {
      toast.message("Select an RFP first");
      return;
    }
    const laneCount = Math.max(1, Math.min(active.laneCount || 1, 5));
    setRowBusyId(active.rfpId);
    try {
      const created: string[] = [];
      for (let i = 0; i < laneCount; i += 1) {
        const quote = await createQuote({
          quoteId: "",
          customer: active.customer,
          origin: `Lane ${i + 1} origin`,
          destination: `Lane ${i + 1} dest`,
          stops: "2",
          equipment: "Dry Van",
          pickupDate: "",
          deliveryDate: active.dueDate || "",
          baseRate: 0,
          fuelSurcharge: 0,
          accessorials: 0,
          riskScore: 20,
          aiNotes: `Created from RFP ${active.rfpId} (${active.rfpName}).`,
          status: "Draft",
          owner: active.owner || defaultOwner,
          createdBy: user?.userId,
        });
        created.push(quote.quoteId);
      }
      const updated = await updateRfp({
        ...mapRowToRecord(active),
        status: "Quotes Created",
        pricingProgress: Math.max(active.pricingProgress, 100),
      });
      setRfpRows((prev) =>
        prev.map((row) => (row.rfpId === updated.rfpId ? mapRecordToRow(updated) : row)),
      );
      toast.success(`Created ${created.length} quote(s) from ${active.rfpId}`, {
        action: {
          label: "Open Quotes",
          onClick: () => {
            void navigate({ to: "/quotes" });
          },
        },
      });
      void navigate({ to: "/quotes" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not create quotes from RFP");
    } finally {
      setRowBusyId(null);
    }
  }, [active, defaultOwner, navigate, user?.userId]);

  const importProgressSteps = React.useMemo(() => {
    if (!active) {
      return [
        ["Upload progress", 0, "No file uploaded"],
        ["Row parsing progress", 0, "0 rows parsed"],
        ["Normalization progress", 0, "0 lanes"],
        ["Mapping validation progress", 0, "0 rows"],
        ["Pricing calculation progress", 0, "0 lanes scored"],
      ] as const;
    }
    const lanes = active.laneCount.toLocaleString();
    const pricing = active.pricingProgress;
    return [
      ["Upload progress", active.status === "Draft" ? 0 : 100, `${active.fileType} uploaded`],
      ["Row parsing progress", pricing > 0 ? 100 : 0, `${lanes} rows`],
      ["Normalization progress", Math.min(100, pricing + 10), `${lanes} lanes`],
      ["Mapping validation progress", Math.min(100, pricing + 5), active.status],
      ["Pricing calculation progress", pricing, `${pricing}% complete`],
    ] as const;
  }, [active]);

  const openCreateForm = React.useCallback(() => {
    setFormMode("create");
    setEditingRfpId(null);
    setForm(emptyForm(defaultOwner));
    setFormOpen(true);
  }, [defaultOwner]);

  const openEditForm = React.useCallback((row: RfpRow) => {
    setFormMode("edit");
    setEditingRfpId(row.rfpId);
    setForm(rowToForm(row));
    setFormOpen(true);
  }, []);

  const saveRowUpdate = React.useCallback(async (row: RfpRow, patch: Partial<RfpRow>) => {
    setRowBusyId(row.rfpId);
    setSyncError(null);
    try {
      const now = new Date();
      const updatedRow: RfpRow = {
        ...row,
        ...patch,
        lastModified: formatDisplayDateTime(now),
        updatedAt: now.toISOString(),
      };
      const saved = await updateRfp(mapRowToRecord(updatedRow));
      setRfpRows((prev) =>
        prev.map((item) => (item.rfpId === row.rfpId ? mapRecordToRow(saved) : item)),
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to update RFP.";
      setSyncError(message);
    } finally {
      setRowBusyId(null);
    }
  }, []);

  const submitForm = React.useCallback(async () => {
    const rfpName = form.rfpName.trim();
    const customer = form.customer.trim();
    const owner = form.owner.trim();
    const approver = form.approver.trim();
    const laneCount = Math.max(0, Number.parseInt(form.laneCount, 10) || 0);
    const pricingProgress = Math.min(
      100,
      Math.max(0, Number.parseInt(form.pricingProgress, 10) || 0),
    );
    const dueDate = form.dueDate.trim() || formatDisplayDate(new Date());

    if (!rfpName || !customer || !owner) {
      setSyncError("RFP name, customer, and owner are required.");
      return;
    }

    setFormBusy(true);
    setSyncError(null);
    try {
      if (formMode === "edit" && editingRfpId) {
        const current = rfpRows.find((row) => row.rfpId === editingRfpId);
        if (!current) {
          throw new Error("RFP record not found.");
        }
        const now = new Date();
        const payload: RfpRow = {
          ...current,
          rfpName,
          customer,
          fileType: form.fileType,
          laneCount,
          status: form.status,
          pricingProgress,
          owner,
          approver,
          dueDate,
          updatedAt: now.toISOString(),
          lastModified: formatDisplayDateTime(now),
        };
        const updated = await updateRfp(mapRowToRecord(payload));
        setRfpRows((prev) =>
          prev.map((row) => (row.rfpId === editingRfpId ? mapRecordToRow(updated) : row)),
        );
      } else {
        const created = await createRfp({
          rfpId: "",
          rfpName,
          customer,
          fileType: form.fileType,
          laneCount,
          status: form.status,
          pricingProgress,
          owner,
          approver,
          dueDate,
          createdBy: user?.userId,
        });
        setRfpRows((prev) => [mapRecordToRow(created), ...prev]);
      }
      setFormOpen(false);
      setEditingRfpId(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to save RFP.";
      setSyncError(message);
    } finally {
      setFormBusy(false);
    }
  }, [editingRfpId, form, formMode, rfpRows, user?.userId]);

  const handleDelete = React.useCallback(async () => {
    if (!deleteTarget) return;
    setDeleteBusy(true);
    setSyncError(null);
    try {
      await deleteRfp(deleteTarget.rfpId);
      setRfpRows((prev) => prev.filter((row) => row.rfpId !== deleteTarget.rfpId));
      setDeleteTarget(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to delete RFP.";
      setSyncError(message);
    } finally {
      setDeleteBusy(false);
    }
  }, [deleteTarget]);

  const importLogCard = (
    <Card className="border-border/70 shadow-sm">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Import Log</CardTitle>
        <CardDescription>Parsing and normalization checkpoint trail.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2 text-xs">
        {active ? (
          [
            `RFP: ${active.rfpName}`,
            `Status: ${active.status}`,
            `Lanes: ${active.laneCount.toLocaleString()}`,
            `Pricing progress: ${active.pricingProgress}%`,
            `Uploaded: ${active.uploadDate}`,
            `Last modified: ${active.lastModified}`,
          ].map((entry) => (
            <div
              key={entry}
              className="rounded-md border border-border/70 p-2 text-muted-foreground"
            >
              {entry}
            </div>
          ))
        ) : (
          <p className="text-muted-foreground">No import activity yet.</p>
        )}
      </CardContent>
    </Card>
  );

  const validationCard = (
    <Card className="border-border/70 shadow-sm">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Validation Issues</CardTitle>
        <CardDescription>
          Invalid ZIPs, duplicates, missing fields, and outliers.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2 text-xs">
        <p className="text-muted-foreground">
          Validation issues will appear here after file upload and normalization.
        </p>
      </CardContent>
    </Card>
  );

  const workflowStepsCard = (
    <Card className="border-border/70 shadow-sm">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Workflow Steps</CardTitle>
        <CardDescription>1 to 9 end-to-end RFP pricing lifecycle.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2 text-xs">
        {[
          "1. Upload Customer RFP",
          "2. Map Columns",
          "3. Normalize Lane Data",
          "4. Set Historical Baseline Filters",
          "5. Run AI Matching",
          "6. Review Pricing Outputs",
          "7. Assign Approver",
          "8. Bulk Create Quotes",
          "9. Export to Customer Format",
        ].map((step) => (
          <div
            key={step}
            className="rounded-md border border-border/70 p-2 text-muted-foreground"
          >
            {step}
          </div>
        ))}
      </CardContent>
    </Card>
  );

  const auditCard = (
    <Card className="border-border/70 shadow-sm">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Audit History</CardTitle>
        <CardDescription>
          Date/time, user, action, RFP, lane, old/new values, and notes for reproducibility.
        </CardDescription>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date / Time</TableHead>
              <TableHead>User</TableHead>
              <TableHead>Action</TableHead>
              <TableHead>RFP Name</TableHead>
              <TableHead>Lane ID</TableHead>
              <TableHead>Old Value</TableHead>
              <TableHead>New Value</TableHead>
              <TableHead>Notes</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <EmptyTableRow
              colSpan={8}
              message="Audit events will be recorded as you upload, map, price, and approve lanes."
            />
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );

  usePageReady(Boolean(loadingRows && rfpRows.length === 0));

  return (
    <div>
      <PageHeader
        title="RFPs"
        description="Upload customer files, normalize lanes, apply AI matching, and convert priced lanes into quote-ready outputs."
        actions={
          <>
            <Button variant="outline" size="sm" className="gap-1.5">
              <Filter className="h-4 w-4" /> Baseline Filters
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={() => {
                if (!isWorkspaceAiEnabled()) {
                  toast.error("OpenAI is not connected", {
                    description: "Configure your API key in Settings → Integrations.",
                  });
                  return;
                }
                if (pricingLanes.length === 0) {
                  toast.message("No priced lanes yet", {
                    description:
                      "Workspace AI is connected. Run pricing first — match explanations will use OpenAI.",
                  });
                  return;
                }
                toast.success("AI Matching ready", {
                  description: "Lane similarity uses workspace OpenAI for broker explanations.",
                });
              }}
            >
              <Bot className="h-4 w-4" /> Run AI Matching
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              disabled={!active || rowBusyId === active?.rfpId}
              onClick={() => void convertActiveRfpToQuotes()}
            >
              <FileOutput className="h-4 w-4" /> Bulk Create Quotes
            </Button>
            <Button variant="outline" size="sm" className="gap-1.5">
              <Download className="h-4 w-4" /> Export
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={() => void fetchRfps("refresh")}
              disabled={refreshingRows || loadingRows}
            >
              {refreshingRows ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Bot className="h-4 w-4" />
              )}
              Refresh
            </Button>
            <Button
              size="sm"
              className="gap-1.5 bg-gradient-to-r from-primary to-info"
              onClick={openCreateForm}
            >
              <UploadCloud className="h-4 w-4" /> Upload RFP
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
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            label="Active RFPs"
            value={`${rfpStats.activeRfps}`}
            tone="info"
            sub={
              rfpRows.length > 0
                ? `${rfpStats.avgProgress}% avg pricing`
                : "Create an RFP to begin"
            }
          />
          <StatCard
            label="Imported Lanes"
            value={rfpStats.totalLanes.toLocaleString()}
            tone="success"
            sub={rfpRows.length > 0 ? "Across all RFPs" : "No lanes imported"}
          />
          <StatCard
            label="Ready For Quotes"
            value={rfpStats.readyForQuotes.toLocaleString()}
            tone="primary"
            sub={rfpStats.readyForQuotes > 0 ? "Approved or exported" : "Awaiting approval"}
          />
          <StatCard label="Import SLA" value="—" tone="success" sub="Upload a file to measure" />
        </div>
        )}

        <Card className="border-border/70 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Import Performance</CardTitle>
            <CardDescription>
              {active
                ? `${active.rfpName} workflow: upload, parsing, normalization, mapping validation, pricing.`
                : "Select or create an RFP to track import workflow progress."}
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
            {importProgressSteps.map(([label, value, meta]) => (
              <div key={label} className="space-y-1.5 rounded-lg border border-border/70 p-3">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">{label}</span>
                  <span className="font-medium">{`${value}%`}</span>
                </div>
                <Progress value={Number(value)} />
                <div className="text-xs text-muted-foreground">{meta}</div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Tabs value={view} onValueChange={(next) => setView(next as "workspace" | "list")}>
          <TabsList className="grid h-auto w-full grid-cols-2 gap-1 rounded-xl bg-muted p-1 text-sm sm:max-w-md">
            <TabsTrigger value="workspace" className="py-2">
              RFP Workspace
            </TabsTrigger>
            <TabsTrigger value="list" className="py-2">
              RFP List
            </TabsTrigger>
          </TabsList>

          <TabsContent value="workspace" className="space-y-6">
            {!active ? (
              <WorkspaceEmptyCard
                title="No RFP selected"
                description="Create an RFP or open one from the list to use the workspace."
              />
            ) : null}
            <div className="lg:hidden">
              {active ? (
                <div className="sticky top-16 z-20 rounded-xl border border-border/70 bg-background/95 p-4 shadow-sm">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <div className="text-sm font-semibold">{active.rfpName}</div>
                      <div className="text-xs text-muted-foreground">
                        {active.customer} | {active.laneCount.toLocaleString()} lanes
                      </div>
                    </div>
                    <Badge variant="outline" className={statusTone[active.status]}>
                      {active.status}
                    </Badge>
                  </div>
                  <div className="mt-3">
                    <Progress value={active.pricingProgress} />
                    <div className="mt-1 text-xs text-muted-foreground">
                      {active.pricingProgress}% pricing progress
                    </div>
                  </div>
                </div>
              ) : null}

              <Tabs value={mobileTab} onValueChange={setMobileTab} className="mt-4">
                <TabsList className="h-auto w-full flex-wrap justify-start gap-1 rounded-xl p-1">
                  {["upload", "mapping", "lanes", "pricing", "matching", "approval", "export"].map(
                    (tab) => (
                      <TabsTrigger key={tab} value={tab} className="px-3 py-2 text-xs capitalize">
                        {tab}
                      </TabsTrigger>
                    ),
                  )}
                </TabsList>
                <TabsContent value={mobileTab}>
                  <Card className="border-border/70 shadow-sm">
                    <CardContent className="p-4">
                      <div className="text-sm font-medium capitalize">{mobileTab} step</div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        Touch-friendly cards, step actions, and collapsible details for mobile
                        workflow.
                      </div>
                      <div className="mt-3 grid grid-cols-2 gap-2">
                        <Button className="h-11 w-full">Primary Action</Button>
                        <Button variant="outline" className="h-11 w-full">
                          Secondary
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                </TabsContent>
              </Tabs>
            </div>

            <div className="hidden lg:block">
              <Tabs value={workspaceTab} onValueChange={setWorkspaceTab} className="w-full space-y-4">
                <div className="rounded-xl border border-border/70 bg-muted/20 p-1.5 shadow-sm">
                  <TabsList className="flex h-auto w-full gap-0.5 bg-transparent p-0">
                    {[
                      { value: "upload", label: "Upload & Templates", icon: UploadCloud },
                      { value: "mapping", label: "Mapping & Lanes", icon: Link2 },
                      { value: "pricing", label: "Pricing Review", icon: FileSpreadsheet },
                      { value: "matching", label: "AI Matching", icon: Sparkles },
                      { value: "approval", label: "Approve & Export", icon: ShieldCheck },
                      { value: "activity", label: "Activity Log", icon: Clock3 },
                    ].map((tab) => {
                      const Icon = tab.icon;
                      return (
                        <TabsTrigger
                          key={tab.value}
                          value={tab.value}
                          className="flex-1 gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-all hover:bg-background/60 hover:text-foreground data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm"
                        >
                          <Icon className="h-4 w-4 shrink-0" />
                          <span className="whitespace-nowrap">{tab.label}</span>
                        </TabsTrigger>
                      );
                    })}
                  </TabsList>
                </div>

                <TabsContent value="upload" className="mt-0">
                  <div className="grid items-start gap-6 lg:grid-cols-2">
                <Card className="border-border/70 shadow-sm">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base">Upload Customer RFP</CardTitle>
                    <CardDescription>Drag and drop XLSX, XLS, or CSV file.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="rounded-lg border border-dashed border-border/70 bg-muted/30 p-4 text-center">
                      <UploadCloud className="mx-auto h-6 w-6 text-muted-foreground" />
                      <div className="mt-2 text-sm font-medium">Drop file here</div>
                      <div className="text-xs text-muted-foreground">Supported: XLSX, XLS, CSV</div>
                      <Button size="sm" className="mt-3 w-full gap-1.5" disabled={!active}>
                        <FileSpreadsheet className="h-4 w-4" /> Browse File
                      </Button>
                    </div>
                    <Input
                      placeholder="RFP name"
                      value={active?.rfpName ?? ""}
                      readOnly
                      disabled={!active}
                    />
                    <div className="grid grid-cols-2 gap-2">
                      <Input type="date" disabled={!active} />
                      <Input type="date" disabled={!active} />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <Input
                        placeholder="Customer"
                        value={active?.customer ?? ""}
                        readOnly
                        disabled={!active}
                      />
                      <Input
                        placeholder="Approver"
                        value={active?.approver ?? ""}
                        readOnly
                        disabled={!active}
                      />
                    </div>
                    <Textarea
                      rows={3}
                      placeholder="Notes and pricing priorities (optional)"
                      disabled={!active}
                    />
                    <div className="space-y-1 text-xs">
                      {[
                        "Detect missing required columns",
                        "Detect invalid dates",
                        "Detect duplicate lanes",
                        "Detect missing origin/destination",
                        "Detect unsupported equipment",
                        "Detect invalid ZIP codes",
                        "Detect incomplete frequency data",
                        "Detect blank rates or notes",
                      ].map((rule) => (
                        <div
                          key={rule}
                          className="rounded-md border border-border/70 px-2.5 py-1.5 text-muted-foreground"
                        >
                          {rule}
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>

                <div className="space-y-6">
                <Card className="border-border/70 shadow-sm">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base">Saved Customer Templates</CardTitle>
                    <CardDescription>Mapping is saved per customer template.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <Select disabled>
                      <SelectTrigger>
                        <SelectValue placeholder="No saved templates" />
                      </SelectTrigger>
                      <SelectContent />
                    </Select>
                    <div className="grid grid-cols-2 gap-2">
                      <Button size="sm" className="gap-1.5">
                        <Save className="h-4 w-4" /> Save
                      </Button>
                      <Button size="sm" variant="outline">
                        Duplicate
                      </Button>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <Button size="sm" variant="outline">
                        Edit
                      </Button>
                      <Button size="sm" variant="outline">
                        Delete
                      </Button>
                    </div>
                    <Badge
                      variant="outline"
                      className="border-success/40 bg-success/15 text-success"
                    >
                      Acceptance: Mapping saved per customer template
                    </Badge>
                  </CardContent>
                </Card>
                {workflowStepsCard}
                </div>
                  </div>
                </TabsContent>

                <TabsContent value="mapping" className="mt-0 space-y-6">
                <Card className="border-border/70 shadow-sm">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base">Column Mapper</CardTitle>
                    <CardDescription>
                      Auto suggestions, manual mapping, confidence score, validation, and templates.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="grid gap-2 sm:grid-cols-3">
                      <Button size="sm" variant="outline" className="gap-1.5">
                        <Wand2 className="h-4 w-4" /> Auto-detect
                      </Button>
                      <Button size="sm" variant="outline" className="gap-1.5">
                        <Link2 className="h-4 w-4" /> Load Template
                      </Button>
                      <Button size="sm" className="gap-1.5">
                        <Save className="h-4 w-4" /> Save Template
                      </Button>
                    </div>
                    <div className="overflow-x-auto rounded-lg border border-border/70">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Customer Column Name</TableHead>
                            <TableHead>System Field</TableHead>
                            <TableHead>Required / Optional</TableHead>
                            <TableHead>Sample Value</TableHead>
                            <TableHead>Confidence</TableHead>
                            <TableHead>Transform Rule</TableHead>
                            <TableHead>Validation</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          <EmptyTableRow
                            colSpan={7}
                            message="Upload and map a customer file to see column mappings."
                          />
                        </TableBody>
                      </Table>
                    </div>
                  </CardContent>
                </Card>

                <Card className="border-border/70 shadow-sm">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base">Normalize Lane Data</CardTitle>
                    <CardDescription>
                      Standardize city/state names, ZIPs, equipment, dates, frequency, and
                      deduplicate lanes.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="overflow-x-auto rounded-lg border border-border/70 p-0">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Lane ID</TableHead>
                          <TableHead>Origin</TableHead>
                          <TableHead>Origin ZIP 5/3</TableHead>
                          <TableHead>Destination</TableHead>
                          <TableHead>Destination ZIP 5/3</TableHead>
                          <TableHead>Equipment</TableHead>
                          <TableHead>Frequency</TableHead>
                          <TableHead>Validation</TableHead>
                          <TableHead>Issues</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        <EmptyTableRow
                          colSpan={9}
                          message="Normalize lane data after upload to preview standardized lanes."
                        />
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
                </TabsContent>

                <TabsContent value="pricing" className="mt-0 space-y-6">
                <Card className="border-border/70 shadow-sm">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base">Historical Baseline Filters</CardTitle>
                    <CardDescription>
                      Date range baseline and inclusion/exclusion controls for historical averages.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="grid gap-3 sm:grid-cols-2">
                    <Select>
                      <SelectTrigger>
                        <SelectValue placeholder="Historical date range" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="30">Last 30 Days</SelectItem>
                        <SelectItem value="60">Last 60 Days</SelectItem>
                        <SelectItem value="90">Last 90 Days</SelectItem>
                        <SelectItem value="custom">Custom Date Range</SelectItem>
                      </SelectContent>
                    </Select>
                    <Input placeholder="Minimum load count" />
                    <Input placeholder="3-digit ZIP inclusion" />
                    <Input placeholder="5-digit ZIP inclusion" />
                    <Input placeholder="Adjacent markets" />
                    <Input placeholder="Outlier exclusion" />
                    <Input placeholder="Canceled load exclusion" />
                    <Input placeholder="Low-confidence match exclusion" />
                  </CardContent>
                </Card>

                <Card className="border-border/70 shadow-sm">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base">Pricing Review Table</CardTitle>
                    <CardDescription>
                      Historical outputs (30/60/90), AI matching, backhaul score, network fit, risk,
                      and approval.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="overflow-x-auto rounded-lg border border-border/70 p-0">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Lane ID</TableHead>
                          <TableHead>Origin</TableHead>
                          <TableHead>Destination</TableHead>
                          <TableHead>Hist Buy 30/60/90</TableHead>
                          <TableHead>Hist Sell 30/60/90</TableHead>
                          <TableHead>Suggested Buy</TableHead>
                          <TableHead>Suggested Sell</TableHead>
                          <TableHead>Margin $ / %</TableHead>
                          <TableHead>Similarity</TableHead>
                          <TableHead>Backhaul</TableHead>
                          <TableHead>Network Fit</TableHead>
                          <TableHead>Risk</TableHead>
                          <TableHead>Approval</TableHead>
                          <TableHead>Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {pricingLanes.length === 0 ? (
                          <EmptyTableRow
                            colSpan={14}
                            message="Run pricing on uploaded lanes to populate this table."
                          />
                        ) : (
                          pricingLanes.map((row) => (
                            <TableRow key={row.laneId}>
                              <TableCell className="font-medium text-primary">{row.laneId}</TableCell>
                              <TableCell>{row.origin}</TableCell>
                              <TableCell>{row.destination}</TableCell>
                              <TableCell className="text-xs">
                                {money(row.histBuy30)} / {money(row.histBuy60)} /{" "}
                                {money(row.histBuy90)}
                              </TableCell>
                              <TableCell className="text-xs">
                                {money(row.histSell30)} / {money(row.histSell60)} /{" "}
                                {money(row.histSell90)}
                              </TableCell>
                              <TableCell>{money(row.suggestedBuy)}</TableCell>
                              <TableCell>{money(row.suggestedSell)}</TableCell>
                              <TableCell>
                                {money(row.marginUsd)} / {row.marginPct.toFixed(1)}%
                              </TableCell>
                              <TableCell>
                                <Badge
                                  variant="outline"
                                  className="border-primary/30 bg-primary/10 text-primary"
                                >
                                  {row.similarity}%
                                </Badge>
                              </TableCell>
                              <TableCell>{row.backhaul}</TableCell>
                              <TableCell>
                                <Badge variant="outline" className={networkFitTone(row.networkFit)}>
                                  {row.networkFit}
                                </Badge>
                              </TableCell>
                              <TableCell>
                                <Badge variant="outline" className={riskTone(row.riskScore)}>
                                  {row.riskScore}
                                </Badge>
                              </TableCell>
                              <TableCell>{row.approvalStatus}</TableCell>
                              <TableCell>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => setLaneId(row.laneId)}
                                >
                                  View Details
                                </Button>
                              </TableCell>
                            </TableRow>
                          ))
                        )}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
                </TabsContent>

                <TabsContent value="matching" className="mt-0">
                  <div className="grid items-start gap-6 lg:grid-cols-2">
                <Card className="border-border/70 shadow-sm">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base">AI Matching</CardTitle>
                    <CardDescription>
                      Similarity by geography (3-digit/5-digit ZIP), equipment, day-of-week, dwell,
                      seasonality, carrier availability.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {pricingLanes.length === 0 ? (
                      <p className="text-xs text-muted-foreground">
                        Run AI matching after pricing to see lane similarity breakdowns.
                      </p>
                    ) : (
                      pricingLanes.map((row) => (
                        <div key={row.laneId} className="rounded-lg border border-border/70 p-3">
                          <div className="flex items-center justify-between">
                            <span className="text-sm font-semibold">{row.laneId}</span>
                            <Badge
                              variant="outline"
                              className="border-primary/30 bg-primary/10 text-primary"
                            >
                              {row.similarity}% Similarity
                            </Badge>
                          </div>
                          <div className="mt-2 grid grid-cols-2 gap-1 text-xs text-muted-foreground">
                            <span>Geography: {row.geographyMatch}</span>
                            <span>Equipment: {row.equipmentMatch}</span>
                            <span>Day-of-week: {row.dowMatch}</span>
                            <span>Dwell: {row.dwellMatch}</span>
                            <span>Seasonality: {row.seasonalityMatch}</span>
                            <span>Carrier: {row.carrierMatch}</span>
                            <span>Confidence: {row.confidence}</span>
                            <span>Matched historical lanes: {row.matchedHistorical}</span>
                          </div>
                          <details className="mt-2 rounded-md border border-border/70 bg-muted/30 p-2">
                            <summary className="cursor-pointer text-xs font-medium">
                              Why this match?
                            </summary>
                            <div className="mt-1 text-xs text-muted-foreground">{row.why}</div>
                          </details>
                        </div>
                      ))
                    )}
                    <Badge
                      variant="outline"
                      className="border-success/40 bg-success/15 text-success"
                    >
                      Acceptance: Similarity score consistent with test set
                    </Badge>
                  </CardContent>
                </Card>

                <Card className="border-border/70 shadow-sm">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base">Network Fit And Backhaul</CardTitle>
                    <CardDescription>
                      Backhaul score 0-100 with candidate loads and deadhead estimate.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-2 text-xs">
                    {pricingLanes.length === 0 ? (
                      <p className="text-muted-foreground">
                        Network fit and backhaul scores appear after lane pricing runs.
                      </p>
                    ) : (
                      pricingLanes.map((row) => (
                        <div key={row.laneId} className="rounded-md border border-border/70 p-2.5">
                          <div className="flex items-center justify-between">
                            <span className="font-medium">{row.laneId}</span>
                            <Badge variant="outline" className={networkFitTone(row.networkFit)}>
                              {row.networkFit}
                            </Badge>
                          </div>
                          <div className="mt-1 text-muted-foreground">
                            Backhaul {row.backhaul} | Candidate loads {row.matchedActive} | Deadhead{" "}
                            {Math.max(0, 220 - row.backhaul)} mi
                          </div>
                        </div>
                      ))
                    )}
                  </CardContent>
                </Card>
                  </div>
                </TabsContent>

                <TabsContent value="approval" className="mt-0">
                  <div className="grid items-start gap-6 lg:grid-cols-3">
                <Card className="border-border/70 shadow-sm">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base">Approval Workflow</CardTitle>
                    <CardDescription>
                      Approver assignment and approval gates before quote/export.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <Input
                      placeholder="Approver"
                      value={active?.approver ?? ""}
                      readOnly
                      disabled={!active}
                    />
                    <div className="rounded-lg border border-border/70 bg-muted/30 p-3 text-xs text-muted-foreground">
                      {active
                        ? `Approver: ${active.approver || "Unassigned"} | Status: ${active.status} | Owner: ${active.owner} | Last modified: ${active.lastModified}`
                        : "Select an RFP to configure approval workflow."}
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <Button size="sm" className="gap-1.5">
                        <ShieldCheck className="h-4 w-4" /> Send
                      </Button>
                      <Button size="sm" variant="outline" className="gap-1.5">
                        <CheckCircle2 className="h-4 w-4" /> Approve
                      </Button>
                      <Button size="sm" variant="outline" className="gap-1.5">
                        <AlertTriangle className="h-4 w-4" /> Reject
                      </Button>
                      <Button size="sm" variant="outline" className="gap-1.5">
                        <Clock3 className="h-4 w-4" /> Request Changes
                      </Button>
                    </div>
                  </CardContent>
                </Card>

                <Card className="border-border/70 shadow-sm">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base">Bulk Create Quotes</CardTitle>
                    <CardDescription>
                      Create quotes from approved or selected lanes.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-2 text-xs">
                    {[
                      "Create quotes for all approved lanes",
                      "Create quotes for selected lanes",
                      "Create quotes by network fit flag",
                      "Create quotes by margin threshold",
                      "Create quotes by customer region",
                      "Exclude low-confidence lanes",
                      "Exclude weak network fit lanes",
                      "Require approval before quote creation",
                    ].map((rule) => (
                      <label
                        key={rule}
                        className="flex items-center justify-between rounded-md border border-border/70 p-2"
                      >
                        <span>{rule}</span>
                        <input type="checkbox" defaultChecked className="h-4 w-4" />
                      </label>
                    ))}
                    <Button
                      className="mt-1 w-full gap-1.5"
                      disabled={!active || rowBusyId === active?.rfpId}
                      onClick={() => void convertActiveRfpToQuotes()}
                    >
                      <PlayCircle className="h-4 w-4" /> Bulk Create Quotes
                    </Button>
                  </CardContent>
                </Card>

                <Card className="border-border/70 shadow-sm">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base">Export To Customer Format</CardTitle>
                    <CardDescription>
                      Preserve customer column order, required headers, customer reference IDs,
                      optional formatting.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-2 text-xs">
                    {[
                      "Export to original customer template",
                      "Export selected lanes",
                      "Export all lanes",
                      "Export only approved lanes",
                      "Include notes",
                      "Include rates only",
                      "Include optional columns",
                    ].map((rule) => (
                      <label
                        key={rule}
                        className="flex items-center justify-between rounded-md border border-border/70 p-2"
                      >
                        <span>{rule}</span>
                        <input type="checkbox" defaultChecked className="h-4 w-4" />
                      </label>
                    ))}
                    <div className="grid grid-cols-2 gap-2 pt-1">
                      <Button className="gap-1.5">
                        <Download className="h-4 w-4" /> XLSX
                      </Button>
                      <Button variant="outline" className="gap-1.5">
                        <Download className="h-4 w-4" /> CSV
                      </Button>
                    </div>
                  </CardContent>
                </Card>
                  </div>
                </TabsContent>

                <TabsContent value="activity" className="mt-0 space-y-6">
                  <div className="grid items-start gap-6 lg:grid-cols-2">
                    {importLogCard}
                    {validationCard}
                  </div>
                  {auditCard}
                </TabsContent>
              </Tabs>
            </div>

            <div className="space-y-6 lg:hidden">
              <div className="grid gap-6 sm:grid-cols-2">
                {importLogCard}
                {validationCard}
                {workflowStepsCard}
              </div>
              {auditCard}
            </div>
          </TabsContent>

          <TabsContent value="list" className="space-y-4">
            <Card className="border-border/70 shadow-sm">
              <CardHeader className="pb-3">
                <CardTitle className="text-base">RFP List View</CardTitle>
                <CardDescription>
                  All uploaded RFPs with status progression and action controls.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr),180px,180px]">
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      className="pl-8"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="Search RFP name, customer, owner, status..."
                    />
                    {typed && suggestions.length > 0 && (
                      <div className="absolute left-0 top-full z-20 mt-1 w-full rounded-lg border border-border bg-background p-1 shadow-md">
                        {suggestions.map((item) => (
                          <button
                            key={item}
                            type="button"
                            className="block w-full rounded-md px-2 py-1.5 text-left text-xs hover:bg-muted"
                          >
                            {item}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <Select value={statusFilter} onValueChange={setStatusFilter}>
                    <SelectTrigger>
                      <SelectValue placeholder="Status" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All statuses</SelectItem>
                      {STATUSES.map((status) => (
                        <SelectItem key={status} value={status}>
                          {status}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select value={ownerFilter} onValueChange={setOwnerFilter}>
                    <SelectTrigger>
                      <SelectValue placeholder="Owner" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All owners</SelectItem>
                      {Array.from(new Set(rfpRows.map((row) => row.owner))).map((owner) => (
                        <SelectItem key={owner} value={owner}>
                          {owner}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="overflow-x-auto rounded-lg border border-border/70">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>RFP Name</TableHead>
                        <TableHead>Customer</TableHead>
                        <TableHead>File Type</TableHead>
                        <TableHead>Lane Count</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Pricing Progress</TableHead>
                        <TableHead>Assigned Owner</TableHead>
                        <TableHead>Approver</TableHead>
                        <TableHead>Upload Date</TableHead>
                        <TableHead>Last Modified</TableHead>
                        <TableHead>Due Date</TableHead>
                        <TableHead>Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {loadingRows ? (
                        Array.from({ length: 6 }).map((_, i) => (
                          <TableRow key={`skel-${i}`}>
                            {Array.from({ length: 12 }).map((__, j) => (
                              <TableCell key={j}>
                                <Skeleton className="h-4 w-full max-w-[100px]" />
                              </TableCell>
                            ))}
                          </TableRow>
                        ))
                      ) : filtered.length === 0 ? (
                        <TableRow>
                          <TableCell
                            colSpan={12}
                            className="py-8 text-center text-sm text-muted-foreground"
                          >
                            No RFPs found.
                          </TableCell>
                        </TableRow>
                      ) : (
                        filtered.map((row) => {
                          const busy = rowBusyId === row.rfpId;
                          return (
                            <TableRow key={row.rfpId}>
                              <TableCell className="font-medium text-primary">
                                {row.rfpName}
                              </TableCell>
                              <TableCell>{row.customer}</TableCell>
                              <TableCell>{row.fileType}</TableCell>
                              <TableCell className="tabular-nums">
                                {row.laneCount.toLocaleString()}
                              </TableCell>
                              <TableCell>
                                <Badge variant="outline" className={statusTone[row.status]}>
                                  {row.status}
                                </Badge>
                              </TableCell>
                              <TableCell>
                                <div className="min-w-[130px] space-y-1">
                                  <Progress value={row.pricingProgress} />
                                  <div className="text-xs text-muted-foreground">
                                    {row.pricingProgress}%
                                  </div>
                                </div>
                              </TableCell>
                              <TableCell>{row.owner}</TableCell>
                              <TableCell>{row.approver || "Unassigned"}</TableCell>
                              <TableCell className="text-xs tabular-nums text-muted-foreground">
                                {row.uploadDate}
                              </TableCell>
                              <TableCell className="text-xs tabular-nums text-muted-foreground">
                                {row.lastModified}
                              </TableCell>
                              <TableCell className="text-xs tabular-nums">{row.dueDate}</TableCell>
                              <TableCell>
                                <div className="flex flex-wrap gap-1">
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    disabled={busy}
                                    onClick={() => {
                                      setWorkspaceRfpId(row.rfpId);
                                      setRfpRows((prev) => [
                                        row,
                                        ...prev.filter((item) => item.rfpId !== row.rfpId),
                                      ]);
                                      setView("workspace");
                                    }}
                                  >
                                    View RFP
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
                                    disabled={busy}
                                    onClick={() =>
                                      void saveRowUpdate(row, {
                                        status: "Pricing",
                                        pricingProgress: Math.max(25, row.pricingProgress),
                                      })
                                    }
                                  >
                                    Run Pricing
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    disabled={busy}
                                    onClick={() =>
                                      void saveRowUpdate(row, { status: "Approval Pending" })
                                    }
                                  >
                                    Assign Approver
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    disabled={busy}
                                    onClick={() =>
                                      void saveRowUpdate(row, {
                                        status: "Quotes Created",
                                        pricingProgress: 100,
                                      })
                                    }
                                  >
                                    Bulk Create Quotes
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    disabled={busy}
                                    onClick={() =>
                                      void saveRowUpdate(row, {
                                        status: "Exported",
                                        pricingProgress: 100,
                                      })
                                    }
                                  >
                                    Export
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    disabled={busy}
                                    onClick={() => void saveRowUpdate(row, { status: "Archived" })}
                                  >
                                    Archive
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
          </TabsContent>
        </Tabs>
      </div>

      <Dialog
        open={formOpen}
        onOpenChange={(open) => {
          setFormOpen(open);
          if (!open) {
            setEditingRfpId(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{formMode === "create" ? "Create RFP" : "Edit RFP"}</DialogTitle>
            <DialogDescription>
              This form writes directly to AWS DynamoDB (
              {formMode === "create" ? "create" : "update"}).
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 py-1 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className="text-xs font-medium text-muted-foreground">RFP Name</label>
              <Input
                value={form.rfpName}
                onChange={(event) => setForm((prev) => ({ ...prev, rfpName: event.target.value }))}
                placeholder="Q4 National Refresh"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Customer</label>
              <Input
                value={form.customer}
                onChange={(event) => setForm((prev) => ({ ...prev, customer: event.target.value }))}
                placeholder="Customer name"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">File Type</label>
              <Select
                value={form.fileType}
                onValueChange={(value) =>
                  setForm((prev) => ({ ...prev, fileType: value as RfpRow["fileType"] }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="XLSX">XLSX</SelectItem>
                  <SelectItem value="XLS">XLS</SelectItem>
                  <SelectItem value="CSV">CSV</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Lane Count</label>
              <Input
                type="number"
                value={form.laneCount}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, laneCount: event.target.value }))
                }
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">
                Pricing Progress %
              </label>
              <Input
                type="number"
                min={0}
                max={100}
                value={form.pricingProgress}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, pricingProgress: event.target.value }))
                }
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Status</label>
              <Select
                value={form.status}
                onValueChange={(value) =>
                  setForm((prev) => ({ ...prev, status: value as RfpStatus }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUSES.map((status) => (
                    <SelectItem key={status} value={status}>
                      {status}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Due Date</label>
              <Input
                value={form.dueDate}
                onChange={(event) => setForm((prev) => ({ ...prev, dueDate: event.target.value }))}
                placeholder="May 30, 2026"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Owner</label>
              <Input
                value={form.owner}
                onChange={(event) => setForm((prev) => ({ ...prev, owner: event.target.value }))}
                placeholder="Owner"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Approver</label>
              <Input
                value={form.approver}
                onChange={(event) => setForm((prev) => ({ ...prev, approver: event.target.value }))}
                placeholder="Approver"
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
                "Create RFP"
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
            <DialogTitle>Delete RFP?</DialogTitle>
            <DialogDescription>
              {deleteTarget
                ? `This will permanently remove ${deleteTarget.rfpName} from AWS DynamoDB.`
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

      <Sheet open={Boolean(lane)} onOpenChange={(open) => !open && setLaneId(null)}>
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-xl">
          {lane ? (
            <>
              <SheetHeader>
                <SheetTitle>Lane Detail - {lane.laneId}</SheetTitle>
                <SheetDescription>
                  Original row, normalized lane data, historical pricing, AI breakdown, network fit,
                  backhaul, margin guidance, override history, and quote status.
                </SheetDescription>
              </SheetHeader>
              <div className="mt-5 space-y-4">
                <DetailCard title="Original Uploaded Row">
                  O City: {lane.origin.split(",")[0]} | O ZIP: {lane.origin.match(/\((\d+)\)/)?.[1]}
                  00 | D City: {lane.destination.split(",")[0]} | D ZIP:{" "}
                  {lane.destination.match(/\((\d+)\)/)?.[1]}00 | Equip: {lane.equipment}
                </DetailCard>
                <DetailCard title="Historical Pricing">
                  30/60/90 Buy: {money(lane.histBuy30)} / {money(lane.histBuy60)} /{" "}
                  {money(lane.histBuy90)} | 30/60/90 Sell: {money(lane.histSell30)} /{" "}
                  {money(lane.histSell60)} / {money(lane.histSell90)}
                </DetailCard>
                <DetailCard title="AI Matching Breakdown">
                  Similarity {lane.similarity}% | Geography {lane.geographyMatch} | Equipment{" "}
                  {lane.equipmentMatch} | DOW {lane.dowMatch} | Dwell {lane.dwellMatch} |
                  Seasonality {lane.seasonalityMatch} | Carrier {lane.carrierMatch} | Confidence{" "}
                  {lane.confidence}
                </DetailCard>
                <DetailCard title="Why This Match?">{lane.why}</DetailCard>
                <DetailCard title="Network Fit And Backhaul">
                  Fit: {lane.networkFit} | Backhaul {lane.backhaul} | Candidate loads{" "}
                  {lane.matchedActive + 6} | Deadhead {Math.max(42, 220 - lane.backhaul)} mi
                </DetailCard>
                <DetailCard title="Margin Guidance And Override">
                  Suggested buy/sell {money(lane.suggestedBuy)} / {money(lane.suggestedSell)} |
                  Margin {money(lane.marginUsd)} ({lane.marginPct.toFixed(1)}%) | Quote status:{" "}
                  {lane.approvalStatus}
                </DetailCard>
                <div className="grid grid-cols-2 gap-2">
                  <Button className="gap-1.5">
                    <FileCheck2 className="h-4 w-4" /> Create Quote
                  </Button>
                  <Button variant="outline" className="gap-1.5">
                    <ChevronRight className="h-4 w-4" /> Next Lane
                  </Button>
                </div>
              </div>
            </>
          ) : null}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function StatCard({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub: string;
  tone: "primary" | "success" | "info";
}) {
  const toneClass =
    tone === "success"
      ? "border-success/30 bg-success/15 text-success"
      : tone === "info"
        ? "border-info/30 bg-info/15 text-info"
        : "border-primary/30 bg-primary/10 text-primary";
  return (
    <Card className="border-border/70 shadow-sm">
      <CardContent className="p-4">
        <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </div>
        <div className="mt-2 flex items-end justify-between gap-2">
          <div className="text-2xl font-semibold tracking-tight tabular-nums">{value}</div>
          <Badge variant="secondary" className={toneClass}>
            {sub}
          </Badge>
        </div>
      </CardContent>
    </Card>
  );
}

function DetailCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card className="border-border/70">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">{title}</CardTitle>
      </CardHeader>
      <CardContent className={cn("text-xs text-muted-foreground")}>{children}</CardContent>
    </Card>
  );
}
