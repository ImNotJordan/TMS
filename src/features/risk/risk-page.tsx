import * as React from "react";

import {
  Archive,
  ArrowDown,
  ArrowUp,
  BadgeCheck,
  Boxes,
  Braces,
  CheckCircle2,
  Copy,
  Download,
  FileCode2,
  FlaskConical,
  Gauge,
  GitBranch,
  History,
  LayoutList,
  PenLine,
  PlayCircle,
  Plus,
  RefreshCw,
  RotateCcw,
  ScrollText,
  Search,
  Send,
  Shield,
  ShieldAlert,
  Sparkles,
  Timer,
  TrendingUp,
  TriangleAlert,
} from "lucide-react";

import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { StatCardsSkeleton } from "@/components/page-skeleton";
import { usePageReady } from "@/components/page-load-gate";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
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
import {
  createRiskModel as createRiskModelRemote,
  deleteRiskModel as deleteRiskModelRemote,
  listRiskModelsCached,
  upsertRiskModel as upsertRiskModelRemote,
  type RiskModelRecord,
} from "@/lib/risk-models-store";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";

type ModelStatus = "Draft" | "Published" | "Archived" | "Deprecated" | "Testing" | "Rolled Back";
type RiskLevel = "Low Risk" | "Medium Risk" | "High Risk" | "Critical Risk";
type RiskType =
  | "Lane"
  | "Carrier Reliability"
  | "Pricing Volatility"
  | "Weather Delay"
  | "Fraud / Double Brokering"
  | "High-Value Load"
  | "Reefer Temperature"
  | "Dwell Time";
type ApprovalStatus = "Not Requested" | "Pending" | "Approved" | "Rejected";

type RiskInput = {
  name: string;
  description: string;
  dataType: "number" | "percentage" | "score";
  source: string;
  refreshFrequency: string;
  allowedRange: string;
  exampleValue: string;
  lastUpdated: string;
  required: boolean;
};

type ModelVersion = {
  version: string;
  status: ModelStatus;
  formulaSnapshot: string;
  modifiedBy: string;
  modifiedDate: string;
  publishedBy: string;
  publishedDate: string;
  changeNotes: string;
};

type AuditEvent = {
  dateTime: string;
  user: string;
  action:
    | "Model Created"
    | "Formula Edited"
    | "Input Added"
    | "Input Removed"
    | "Test Run"
    | "Version Created"
    | "Model Published"
    | "Model Rolled Back"
    | "Model Archived"
    | "Permission Changed"
    | "Approval Requested"
    | "Approval Granted"
    | "Approval Rejected";
  modelName: string;
  version: string;
  oldValue: string;
  newValue: string;
  notes: string;
  ipDevice: string;
};

type Governance = {
  currentVersion: string;
  draftVersion: string;
  publishedVersion: string;
  createdBy: string;
  modifiedBy: string;
  approvedBy: string;
  publishedBy: string;
  lastModified: string;
  lastPublished: string;
  changeReason: string;
  approvalStatus: ApprovalStatus;
  rollbackReason: string;
  requiredReviewer: string;
  effectiveDate: string;
};

type RiskModel = {
  id: string;
  modelName: string;
  version: string;
  status: ModelStatus;
  owner: string;
  lastModified: string;
  lastPublished: string;
  riskType: RiskType;
  usedBy: string[];
  description: string;
  formula: string;
  inputVariables: string[];
  outputScale: { min: number; max: number };
  riskThresholds: { low: number; medium: number; high: number };
  allowedRoles: string[];
  notes: string;
  governance: Governance;
  versionHistory: ModelVersion[];
};

type TestHarnessValues = {
  origin: string;
  destination: string;
  equipmentType: string;
  pickupDate: string;
  deliveryDate: string;
  carrier: string;
  commodity: string;
  weight: number;
  customerRate: number;
  carrierRate: number;
  datAverageRate: number;
  datCapacityScore: number;
  weatherRisk: number;
  fuelDelta: number;
  averageDwellTime: number;
  carrierReliability: number;
  laneVolatility: number;
};

type AttributionRow = {
  featureName: string;
  inputValue: number;
  weight: number;
  contribution: number;
  direction: "Positive" | "Negative" | "Neutral";
  impactLevel: "Low" | "Medium" | "High";
};

type EvaluationResult = {
  finalRiskScore: number;
  riskLevel: RiskLevel;
  formulaUsed: string;
  modelVersion: string;
  inputValuesUsed: Record<string, number>;
  evaluationTimestamp: string;
  suggestedAction: string;
  warningMessages: string[];
  whySummary: string;
  attribution: AttributionRow[];
};

type EvaluationRecord = {
  id: string;
  modelId: string;
  modelVersion: string;
  formulaSnapshot: string;
  inputValues: Record<string, number>;
  inputDataTimestamp: string;
  outputScore: number;
  riskLevel: RiskLevel;
  evaluationTimestamp: string;
  evaluatedBy: string;
  testCaseId: string;
};

type RolePermission = {
  role: string;
  create: boolean;
  edit: boolean;
  test: boolean;
  publish: boolean;
  rollback: boolean;
  view: boolean;
  notes: string;
};

const MODEL_STATUSES: ModelStatus[] = [
  "Draft",
  "Published",
  "Archived",
  "Deprecated",
  "Testing",
  "Rolled Back",
];

const RISK_TYPES: RiskType[] = [
  "Lane",
  "Carrier Reliability",
  "Pricing Volatility",
  "Weather Delay",
  "Fraud / Double Brokering",
  "High-Value Load",
  "Reefer Temperature",
  "Dwell Time",
];

const PLATFORM_USAGE = [
  "Create Load Review page",
  "Load Details page",
  "Tracking page",
  "Carrier assignment",
  "Quote pricing",
  "RFP evaluation",
  "TruckBoard matching",
  "Analytics dashboard",
] as const;

const ROLE_OPTIONS = [
  "Super Admin",
  "Admin",
  "Risk Manager",
  "Operations Manager",
  "Dispatcher",
  "Sales",
  "Accounting",
  "Read-Only User",
] as const;

const INPUT_CATALOG: RiskInput[] = [
  {
    name: "lane_volatility",
    description: "Measures historical rate or demand instability on a lane.",
    dataType: "score",
    source: "Historical loads",
    refreshFrequency: "Every 30 min",
    allowedRange: "0 to 100",
    exampleValue: "63",
    lastUpdated: "2026-05-19 08:10 ET",
    required: true,
  },
  {
    name: "DAT_spread",
    description: "Difference between the user's rate and market benchmark rate.",
    dataType: "number",
    source: "DAT market rates",
    refreshFrequency: "Every 15 min",
    allowedRange: "-50 to +50",
    exampleValue: "18",
    lastUpdated: "2026-05-19 08:08 ET",
    required: true,
  },
  {
    name: "carrier_reliability",
    description:
      "Score based on carrier on-time performance, cancellations, claims, and compliance.",
    dataType: "score",
    source: "Carrier performance history",
    refreshFrequency: "Hourly",
    allowedRange: "0 to 100",
    exampleValue: "84",
    lastUpdated: "2026-05-19 07:57 ET",
    required: true,
  },
  {
    name: "weather_risk",
    description: "Risk score based on weather conditions along the route.",
    dataType: "score",
    source: "Weather data",
    refreshFrequency: "Every 10 min",
    allowedRange: "0 to 100",
    exampleValue: "42",
    lastUpdated: "2026-05-19 08:12 ET",
    required: true,
  },
  {
    name: "fuel_delta",
    description: "Change in fuel price compared with recent baseline.",
    dataType: "number",
    source: "Fuel index",
    refreshFrequency: "Daily",
    allowedRange: "-20 to +20",
    exampleValue: "7",
    lastUpdated: "2026-05-19 06:00 ET",
    required: true,
  },
  {
    name: "dwell_avg",
    description: "Average facility dwell time for pickup or delivery locations.",
    dataType: "number",
    source: "Facility dwell history",
    refreshFrequency: "Hourly",
    allowedRange: "0 to 24 hrs",
    exampleValue: "3.4",
    lastUpdated: "2026-05-19 07:40 ET",
    required: false,
  },
];

const DEFAULT_FORMULA =
  "clamp(0.35 * lane_volatility + 0.25 * DAT_spread - 0.20 * carrier_reliability + 0.10 * weather_risk + 0.10 * fuel_delta + 0.08 * dwell_avg, 0, 100)";

const START_MODELS: RiskModel[] = [];

const BASE_TEST_CASE: TestHarnessValues = {
  origin: "",
  destination: "",
  equipmentType: "",
  pickupDate: "",
  deliveryDate: "",
  carrier: "",
  commodity: "",
  weight: 0,
  customerRate: 0,
  carrierRate: 0,
  datAverageRate: 0,
  datCapacityScore: 0,
  weatherRisk: 0,
  fuelDelta: 0,
  averageDwellTime: 0,
  carrierReliability: 0,
  laneVolatility: 0,
};

const ROLE_PERMISSION_MATRIX: RolePermission[] = [
  {
    role: "Super Admin",
    create: true,
    edit: true,
    test: true,
    publish: true,
    rollback: true,
    view: true,
    notes: "Full access",
  },
  {
    role: "Admin",
    create: true,
    edit: true,
    test: true,
    publish: true,
    rollback: true,
    view: true,
    notes: "Full access except system defaults",
  },
  {
    role: "Risk Manager",
    create: true,
    edit: true,
    test: true,
    publish: true,
    rollback: true,
    view: true,
    notes: "Primary owner role",
  },
  {
    role: "Operations Manager",
    create: false,
    edit: false,
    test: true,
    publish: false,
    rollback: false,
    view: true,
    notes: "View, test, request changes",
  },
  {
    role: "Dispatcher",
    create: false,
    edit: false,
    test: false,
    publish: false,
    rollback: false,
    view: true,
    notes: "View published scores only",
  },
  {
    role: "Sales",
    create: false,
    edit: false,
    test: false,
    publish: false,
    rollback: false,
    view: true,
    notes: "View published scores only",
  },
  {
    role: "Accounting",
    create: false,
    edit: false,
    test: false,
    publish: false,
    rollback: false,
    view: false,
    notes: "No access unless granted",
  },
  {
    role: "Read-Only User",
    create: false,
    edit: false,
    test: false,
    publish: false,
    rollback: false,
    view: true,
    notes: "View only",
  },
];

function toneForStatus(status: ModelStatus) {
  if (status === "Published") return "bg-success/15 text-success border-success/30";
  if (status === "Draft") return "bg-info/15 text-info border-info/30";
  if (status === "Testing") return "bg-warning/15 text-warning-foreground border-warning/30";
  if (status === "Rolled Back")
    return "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30";
  if (status === "Archived") return "bg-muted text-muted-foreground border-border";
  return "bg-destructive/15 text-destructive border-destructive/30";
}

function toneForRiskLevel(level: RiskLevel) {
  if (level === "Low Risk") return "bg-success/15 text-success border-success/30";
  if (level === "Medium Risk") return "bg-info/15 text-info border-info/30";
  if (level === "High Risk") return "bg-warning/20 text-warning-foreground border-warning/30";
  return "bg-destructive/15 text-destructive border-destructive/30";
}

function impactTone(level: AttributionRow["impactLevel"]) {
  if (level === "High") return "bg-destructive/15 text-destructive border-destructive/30";
  if (level === "Medium") return "bg-warning/20 text-warning-foreground border-warning/30";
  return "bg-muted text-muted-foreground border-border";
}

function formatNow() {
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date());
}

function nextMinorVersion(version: string) {
  const match = /^v(\d+)\.(\d+)$/.exec(version.trim());
  if (!match) return "v1.0";
  const major = Number(match[1]);
  const minor = Number(match[2]);
  return `v${major}.${minor + 1}`;
}

function stripComments(formula: string) {
  return formula
    .split("\n")
    .map((line) => line.replace(/\/\/.*$/g, "").replace(/#.*$/g, ""))
    .join("\n")
    .trim();
}

function clampValue(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function modelInputsFromHarness(values: TestHarnessValues): Record<string, number> {
  return {
    lane_volatility: values.laneVolatility,
    DAT_spread: values.customerRate - values.datAverageRate,
    carrier_reliability: values.carrierReliability,
    weather_risk: values.weatherRisk,
    fuel_delta: values.fuelDelta,
    dwell_avg: values.averageDwellTime,
  };
}

function evaluateFormula(
  formula: string,
  allowedVariables: string[],
  variableValues: Record<string, number>,
): { ok: true; value: number; cleanedFormula: string } | { ok: false; message: string } {
  const cleaned = stripComments(formula);
  if (!cleaned) return { ok: false, message: "Formula is empty." };

  const allowed = new Set(["Math", "min", "max", "clamp", "true", "false", ...allowedVariables]);
  const tokens = cleaned.match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? [];
  for (const token of tokens) {
    if (!allowed.has(token)) {
      return { ok: false, message: `Token '${token}' is not allowed in the DSL.` };
    }
  }

  const hasOnlyAllowedChars = /^[0-9A-Za-z_\s+\-*/().,<>!=&|?:]+$/.test(cleaned);
  if (!hasOnlyAllowedChars) {
    return { ok: false, message: "Formula contains invalid characters." };
  }

  const executable = cleaned
    .replace(/\bmin\s*\(/g, "Math.min(")
    .replace(/\bmax\s*\(/g, "Math.max(")
    .replace(/\bclamp\s*\(/g, "__clamp(");

  try {
    const evaluator = new Function(
      "values",
      "__clamp",
      `with (values) { return (${executable}); }`,
    ) as (
      values: Record<string, number>,
      __clamp: (value: number, min: number, max: number) => number,
    ) => number;

    const result = evaluator(variableValues, clampValue);
    if (!Number.isFinite(result)) {
      return { ok: false, message: "Formula evaluation returned a non-finite number." };
    }
    return { ok: true, value: result, cleanedFormula: cleaned };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown formula parser error.";
    return { ok: false, message: `Formula parser error: ${message}` };
  }
}

function riskLevelFromScore(score: number, thresholds: RiskModel["riskThresholds"]): RiskLevel {
  if (score <= thresholds.low) return "Low Risk";
  if (score <= thresholds.medium) return "Medium Risk";
  if (score <= thresholds.high) return "High Risk";
  return "Critical Risk";
}

function suggestedAction(level: RiskLevel) {
  if (level === "Low Risk") return "Auto-approve and monitor during transit.";
  if (level === "Medium Risk")
    return "Dispatch with standard check calls and watchlist monitoring.";
  if (level === "High Risk")
    return "Require manager approval before dispatching this load.";
  return "Block dispatch until risk manager approval and mitigation plan are complete.";
}

function parseWeights(formula: string, inputs: string[]) {
  const sanitized = stripComments(formula);
  const map = new Map<string, number>();
  for (const input of inputs) map.set(input, 0);

  for (const input of inputs) {
    const escaped = input.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
    const pattern = new RegExp(`([+-]?\\d*\\.?\\d+)\\s*\\*\\s*${escaped}`, "g");
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(sanitized))) {
      map.set(input, (map.get(input) ?? 0) + Number(match[1]));
    }
  }

  return map;
}

function buildAttribution(
  model: RiskModel,
  inputValues: Record<string, number>,
  score: number,
): AttributionRow[] {
  const weights = parseWeights(model.formula, model.inputVariables);
  const rows: AttributionRow[] = model.inputVariables.map((featureName) => {
    const inputValue = inputValues[featureName] ?? 0;
    const weight = weights.get(featureName) ?? 0;
    const contribution = weight * inputValue;
    const abs = Math.abs(contribution);
    const impactLevel: AttributionRow["impactLevel"] = abs >= 15 ? "High" : abs >= 7 ? "Medium" : "Low";

    return {
      featureName,
      inputValue,
      weight,
      contribution,
      direction: contribution > 0 ? "Positive" : contribution < 0 ? "Negative" : "Neutral",
      impactLevel,
    };
  });

  const sumContribution = rows.reduce((acc, row) => acc + row.contribution, 0);
  if (sumContribution !== 0) {
    const scale = score / sumContribution;
    return rows
      .map((row) => ({ ...row, contribution: row.contribution * scale }))
      .sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));
  }

  return rows.sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));
}

function whySummary(rows: AttributionRow[], level: RiskLevel) {
  const positives = rows.filter((row) => row.contribution > 0).sort((a, b) => b.contribution - a.contribution);
  const negatives = rows.filter((row) => row.contribution < 0).sort((a, b) => a.contribution - b.contribution);

  const primaryA = positives[0]?.featureName ?? "market pressure";
  const primaryB = positives[1]?.featureName ?? "operational friction";
  const offset = negatives[0]?.featureName;

  if (offset) {
    return `This score is ${level.toLowerCase()} because ${primaryA} and ${primaryB} are elevated, while ${offset} only partially offsets the risk.`;
  }
  return `This score is ${level.toLowerCase()} because ${primaryA} and ${primaryB} are the strongest upward contributors.`;
}

function sampleModelName(index: number) {
  return `Risk Model ${index.toString().padStart(2, "0")}`;
}

function buildEmptyModel(): RiskModel {
  return {
    id: "",
    modelName: "",
    version: "v1.0",
    status: "Draft",
    owner: "",
    lastModified: "",
    lastPublished: "-",
    riskType: "Lane",
    usedBy: [],
    description: "",
    formula: DEFAULT_FORMULA,
    inputVariables: INPUT_CATALOG.map((input) => input.name),
    outputScale: { min: 0, max: 100 },
    riskThresholds: { low: 35, medium: 65, high: 85 },
    allowedRoles: [],
    notes: "",
    governance: {
      currentVersion: "v1.0",
      draftVersion: "v1.0",
      publishedVersion: "",
      createdBy: "",
      modifiedBy: "",
      approvedBy: "",
      publishedBy: "",
      lastModified: "",
      lastPublished: "",
      changeReason: "",
      approvalStatus: "Not Requested",
      rollbackReason: "",
      requiredReviewer: "",
      effectiveDate: "",
    },
    versionHistory: [],
  };
}

function toRiskModelRecord(model: RiskModel): RiskModelRecord {
  return {
    ...model,
    lastModified: model.lastModified,
  };
}

function fromRiskModelRecord(record: RiskModelRecord): RiskModel {
  return record as unknown as RiskModel;
}

const RISK_WORKSPACE_TABS = [
  {
    value: "list",
    label: "Models",
    title: "Risk Models List",
    icon: LayoutList,
    group: "workspace",
  },
  {
    value: "editor",
    label: "Editor",
    title: "Risk Model Editor",
    icon: PenLine,
    group: "workspace",
  },
  {
    value: "versions",
    label: "Versions",
    title: "Version History",
    icon: GitBranch,
    group: "workspace",
  },
  {
    value: "inputs",
    label: "Inputs",
    title: "Inputs Catalog",
    icon: Boxes,
    group: "build",
  },
  {
    value: "dsl",
    label: "Formula DSL",
    title: "Formula DSL Builder",
    icon: Braces,
    group: "build",
  },
  {
    value: "test",
    label: "Test Harness",
    title: "Test Harness",
    icon: FlaskConical,
    group: "evaluate",
  },
  {
    value: "output",
    label: "Output",
    title: "Output Preview",
    icon: Gauge,
    group: "evaluate",
  },
  {
    value: "governance",
    label: "Governance",
    title: "Governance & Permissions",
    icon: Shield,
    group: "admin",
  },
  {
    value: "audit",
    label: "Audit Log",
    title: "Audit Log",
    icon: ScrollText,
    group: "admin",
  },
  {
    value: "usage",
    label: "Usage",
    title: "Risk Score Usage",
    icon: TrendingUp,
    group: "admin",
  },
] as const;

type RiskTabId = (typeof RISK_WORKSPACE_TABS)[number]["value"];

export function RiskPage() {
  const { user: authUser } = useAuth();
  const actorLabel = React.useMemo(() => {
    return (
      authUser?.name?.trim() ||
      authUser?.attributes?.given_name ||
      authUser?.email?.split("@")[0] ||
      "Unknown user"
    );
  }, [authUser]);

  const [models, setModels] = React.useState<RiskModel[]>(START_MODELS);
  const [modelsLoading, setModelsLoading] = React.useState(true);
  const [modelsWarning, setModelsWarning] = React.useState<string | null>(null);
  const [modelsError, setModelsError] = React.useState<string | null>(null);
  const [modelActionPending, setModelActionPending] = React.useState(false);
  const [activeTab, setActiveTab] = React.useState<RiskTabId>("list");
  const [search, setSearch] = React.useState("");
  const [statusFilter, setStatusFilter] = React.useState<"all" | ModelStatus>("all");
  const [riskTypeFilter, setRiskTypeFilter] = React.useState<"all" | RiskType>("all");

  usePageReady(modelsLoading);

  const [selectedModelId, setSelectedModelId] = React.useState("");
  const [editorRoleSelect, setEditorRoleSelect] = React.useState<(typeof ROLE_OPTIONS)[number]>(
    "Risk Manager",
  );
  const [dslInsertToken, setDslInsertToken] = React.useState("clamp(");

  const [testValues, setTestValues] = React.useState<TestHarnessValues>(BASE_TEST_CASE);
  const [compareVersion, setCompareVersion] = React.useState("latest");
  const [evaluationResult, setEvaluationResult] = React.useState<EvaluationResult | null>(null);
  const [compareResult, setCompareResult] = React.useState<EvaluationResult | null>(null);
  const [evaluationRecords, setEvaluationRecords] = React.useState<EvaluationRecord[]>([]);
  const emptyModel = React.useMemo(() => buildEmptyModel(), []);

  const selectedModel = React.useMemo(
    () => models.find((model) => model.id === selectedModelId) ?? null,
    [models, selectedModelId],
  );
  const activeModel = selectedModel ?? emptyModel;
  const hasSelectedModel = Boolean(selectedModel);

  const [editorDraft, setEditorDraft] = React.useState<RiskModel>(activeModel);

  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      setModelsLoading(true);
      setModelsWarning(null);
      setModelsError(null);
      try {
        const remote = await listRiskModelsCached();
        if (cancelled) return;
        if (remote.length > 0) {
          const mapped = remote.map(fromRiskModelRecord);
          setModels(mapped);
          setSelectedModelId(mapped[0].id);
        } else {
          setModels([]);
          setSelectedModelId("");
        }
      } catch (err) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : "Could not load risk models from AWS";
        setModels([]);
        setSelectedModelId("");
        setModelsError(message);
      } finally {
        if (!cancelled) setModelsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  React.useEffect(() => {
    setEditorDraft(activeModel);
    setCompareVersion("latest");
  }, [activeModel]);

  const filteredModels = React.useMemo(() => {
    const q = search.trim().toLowerCase();
    return models.filter((model) => {
      const matchQuery =
        q.length === 0 ||
        model.modelName.toLowerCase().includes(q) ||
        model.owner.toLowerCase().includes(q) ||
        model.usedBy.join(" ").toLowerCase().includes(q);

      const matchStatus = statusFilter === "all" || model.status === statusFilter;
      const matchRiskType = riskTypeFilter === "all" || model.riskType === riskTypeFilter;
      return matchQuery && matchStatus && matchRiskType;
    });
  }, [models, search, statusFilter, riskTypeFilter]);

  const allAuditEvents = React.useMemo(() => {
    const rows: AuditEvent[] = [];
    for (const model of models) {
      for (const version of model.versionHistory) {
        rows.push({
          dateTime: version.modifiedDate,
          user: version.modifiedBy,
          action: "Version Created",
          modelName: model.modelName,
          version: version.version,
          oldValue: "",
          newValue: `Status: ${version.status}`,
          notes: version.changeNotes,
          ipDevice: "10.18.44.12 / Chrome macOS",
        });

        if (version.status === "Published") {
          rows.push({
            dateTime: version.publishedDate,
            user: version.publishedBy,
            action: "Model Published",
            modelName: model.modelName,
            version: version.version,
            oldValue: "Draft",
            newValue: "Published",
            notes: "Lifecycle promotion",
            ipDevice: "10.18.44.12 / Chrome macOS",
          });
        }
      }

      if (model.status === "Rolled Back") {
        rows.push({
          dateTime: model.lastModified,
          user: model.governance.modifiedBy,
          action: "Model Rolled Back",
          modelName: model.modelName,
          version: model.version,
          oldValue: "Current candidate",
          newValue: model.version,
          notes: model.governance.rollbackReason || "Rollback performed.",
          ipDevice: "10.18.44.12 / Chrome macOS",
        });
      }
      if (model.status === "Archived") {
        rows.push({
          dateTime: model.lastModified,
          user: model.governance.modifiedBy,
          action: "Model Archived",
          modelName: model.modelName,
          version: model.version,
          oldValue: "Active",
          newValue: "Archived",
          notes: model.governance.changeReason || "Archived",
          ipDevice: "10.18.44.12 / Chrome macOS",
        });
      }
    }

    return rows
      .sort((a, b) => (a.dateTime < b.dateTime ? 1 : -1))
      .slice(0, 120);
  }, [models]);

  const metricCards = React.useMemo(() => {
    const published = models.filter((model) => model.status === "Published").length;
    const drafts = models.filter((model) => model.status === "Draft").length;
    const testing = models.filter((model) => model.status === "Testing").length;
    const rolledBack = models.filter((model) => model.status === "Rolled Back").length;
    return { published, drafts, testing, rolledBack };
  }, [models]);

  const updateEditorField = <K extends keyof RiskModel>(key: K, value: RiskModel[K]) => {
    setEditorDraft((prev) => ({ ...prev, [key]: value }));
  };

  const applyModelMutation = (
    id: string,
    updater: (current: RiskModel) => RiskModel,
  ): RiskModel | null => {
    let updated: RiskModel | null = null;
    setModels((prev) =>
      prev.map((model) => {
        if (model.id !== id) return model;
        updated = updater(model);
        return updated;
      }),
    );
    return updated;
  };

  const persistUpdatedModel = async (model: RiskModel, operation: string) => {
    try {
      await upsertRiskModelRemote(toRiskModelRecord(model));
      setModelsError(null);
      setModelsWarning(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : `Could not ${operation} in AWS`;
      setModelsWarning(`${message}. Kept local changes in UI cache.`);
    }
  };

  const createModel = async () => {
    setModelActionPending(true);
    const now = formatNow();
    const nextId = `rm-${(models.length + 1).toString().padStart(3, "0")}`;
    const newModel: RiskModel = {
      id: nextId,
      modelName: sampleModelName(models.length + 1),
      version: "v1.0",
      status: "Draft",
      owner: actorLabel,
      lastModified: now,
      lastPublished: "-",
      riskType: "Lane",
      usedBy: ["Load Review"],
      description: "New risk model draft.",
      formula: DEFAULT_FORMULA,
      inputVariables: INPUT_CATALOG.map((input) => input.name),
      outputScale: { min: 0, max: 100 },
      riskThresholds: { low: 35, medium: 65, high: 85 },
      allowedRoles: ["Super Admin", "Admin", "Risk Manager"],
      notes: "",
      governance: {
        currentVersion: "v1.0",
        draftVersion: "v1.0",
        publishedVersion: "",
        createdBy: actorLabel,
        modifiedBy: actorLabel,
        approvedBy: "",
        publishedBy: "",
        lastModified: now,
        lastPublished: "-",
        changeReason: "Model Created",
        approvalStatus: "Not Requested",
        rollbackReason: "",
        requiredReviewer: "",
        effectiveDate: "",
      },
      versionHistory: [
        {
          version: "v1.0",
          status: "Draft",
          formulaSnapshot: DEFAULT_FORMULA,
          modifiedBy: actorLabel,
          modifiedDate: now,
          publishedBy: "-",
          publishedDate: "-",
          changeNotes: "Model Created",
        },
      ],
    };

    setModels((prev) => [newModel, ...prev]);
    setSelectedModelId(newModel.id);
    setActiveTab("editor");
    try {
      await createRiskModelRemote(toRiskModelRecord(newModel));
      setModelsError(null);
      setModelsWarning(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not create model in AWS";
      setModelsWarning(`${message}. Model currently exists only in local cache.`);
    } finally {
      setModelActionPending(false);
    }
  };

  const duplicateModel = async (model: RiskModel) => {
    setModelActionPending(true);
    const now = formatNow();
    const nextId = `rm-${(models.length + 1).toString().padStart(3, "0")}`;
    const nextVersion = "v1.0";

    const copy: RiskModel = {
      ...model,
      id: nextId,
      modelName: `${model.modelName} Copy`,
      version: nextVersion,
      status: "Draft",
      lastModified: now,
      lastPublished: "-",
      governance: {
        ...model.governance,
        currentVersion: nextVersion,
        draftVersion: nextVersion,
        publishedVersion: "",
        lastModified: now,
        lastPublished: "-",
        changeReason: "Duplicated as draft",
        approvalStatus: "Not Requested",
      },
      versionHistory: [
        {
          version: nextVersion,
          status: "Draft",
          formulaSnapshot: model.formula,
          modifiedBy: actorLabel,
          modifiedDate: now,
          publishedBy: "-",
          publishedDate: "-",
          changeNotes: `Duplicated from ${model.modelName} ${model.version}`,
        },
      ],
    };

    setModels((prev) => [copy, ...prev]);
    setSelectedModelId(copy.id);
    setActiveTab("editor");
    try {
      await createRiskModelRemote(toRiskModelRecord(copy));
      setModelsError(null);
      setModelsWarning(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not duplicate model in AWS";
      setModelsWarning(`${message}. Duplicated model is currently local-only.`);
    } finally {
      setModelActionPending(false);
    }
  };

  const saveModelDraft = async () => {
    setModelActionPending(true);
    const now = formatNow();
    const updated = applyModelMutation(editorDraft.id, (current) => {
      const nextVersion = nextMinorVersion(current.version);
      const nextStatus: ModelStatus = current.status === "Published" ? "Draft" : current.status;

      const newHistoryEntry: ModelVersion = {
        version: nextVersion,
        status: nextStatus,
        formulaSnapshot: editorDraft.formula,
        modifiedBy: actorLabel,
        modifiedDate: now,
        publishedBy: "-",
        publishedDate: "-",
        changeNotes: editorDraft.governance.changeReason || "Formula/configuration updated.",
      };

      return {
        ...editorDraft,
        version: nextVersion,
        status: nextStatus,
        lastModified: now,
        governance: {
          ...editorDraft.governance,
          currentVersion: nextVersion,
          draftVersion: nextVersion,
          modifiedBy: actorLabel,
          lastModified: now,
          approvalStatus: editorDraft.governance.approvalStatus,
        },
        versionHistory: [newHistoryEntry, ...current.versionHistory],
      };
    });
    if (updated) {
      setEditorDraft(updated);
      await persistUpdatedModel(updated, "save model draft");
    }
    setModelActionPending(false);
  };

  const publishModel = async (model: RiskModel) => {
    setModelActionPending(true);
    const now = formatNow();
    const updated = applyModelMutation(model.id, (current) => ({
      ...current,
      status: "Published",
      lastModified: now,
      lastPublished: now,
      governance: {
        ...current.governance,
        publishedVersion: current.version,
        currentVersion: current.version,
        approvedBy: current.governance.approvedBy || actorLabel,
        publishedBy: actorLabel,
        approvalStatus: "Approved",
        lastModified: now,
        lastPublished: now,
      },
      versionHistory: [
        {
          version: current.version,
          status: "Published",
          formulaSnapshot: current.formula,
          modifiedBy: current.governance.modifiedBy || actorLabel,
          modifiedDate: now,
          publishedBy: actorLabel,
          publishedDate: now,
          changeNotes: current.governance.changeReason || "Model published",
        },
        ...current.versionHistory,
      ],
    }));
    if (updated) {
      if (editorDraft.id === updated.id) setEditorDraft(updated);
      await persistUpdatedModel(updated, "publish model");
    }
    setModelActionPending(false);
  };

  const rollbackModel = async (model: RiskModel) => {
    setModelActionPending(true);
    const now = formatNow();
    const targetVersion =
      model.versionHistory.find(
        (row) => row.status === "Published" && row.version !== model.version,
      ) ?? model.versionHistory.find((row) => row.status === "Published");

    if (!targetVersion) {
      setModelActionPending(false);
      return;
    }

    const updated = applyModelMutation(model.id, (current) => ({
      ...current,
      version: targetVersion.version,
      formula: targetVersion.formulaSnapshot,
      status: "Rolled Back",
      lastModified: now,
      governance: {
        ...current.governance,
        currentVersion: targetVersion.version,
        draftVersion: nextMinorVersion(targetVersion.version),
        rollbackReason:
          current.governance.rollbackReason || `Restored ${targetVersion.version} stable baseline.`,
        modifiedBy: actorLabel,
        lastModified: now,
      },
      versionHistory: [
        {
          version: targetVersion.version,
          status: "Rolled Back",
          formulaSnapshot: targetVersion.formulaSnapshot,
          modifiedBy: actorLabel,
          modifiedDate: now,
          publishedBy: targetVersion.publishedBy,
          publishedDate: targetVersion.publishedDate,
          changeNotes:
            current.governance.rollbackReason ||
            `Rolled back from ${current.version} to ${targetVersion.version}`,
        },
        ...current.versionHistory,
      ],
    }));
    if (updated) {
      if (editorDraft.id === updated.id) setEditorDraft(updated);
      await persistUpdatedModel(updated, "roll back model");
    }
    setModelActionPending(false);
  };

  const archiveModel = async (model: RiskModel) => {
    setModelActionPending(true);
    const now = formatNow();
    const updated = applyModelMutation(model.id, (current) => ({
      ...current,
      status: "Archived",
      lastModified: now,
      governance: {
        ...current.governance,
        modifiedBy: actorLabel,
        lastModified: now,
        changeReason: current.governance.changeReason || "Archived from command center.",
      },
      versionHistory: [
        {
          version: current.version,
          status: "Archived",
          formulaSnapshot: current.formula,
          modifiedBy: actorLabel,
          modifiedDate: now,
          publishedBy: current.governance.publishedBy || "-",
          publishedDate: current.governance.lastPublished || "-",
          changeNotes: current.governance.changeReason || "Archived from command center.",
        },
        ...current.versionHistory,
      ],
    }));
    if (updated) {
      if (editorDraft.id === updated.id) setEditorDraft(updated);
      await persistUpdatedModel(updated, "archive model");
    }
    setModelActionPending(false);
  };

  const deleteModel = async (model: RiskModel) => {
    setModelActionPending(true);
    setModels((prev) => prev.filter((row) => row.id !== model.id));
    if (selectedModelId === model.id) {
      const fallback = models.find((row) => row.id !== model.id);
      setSelectedModelId(fallback?.id ?? "");
    }
    try {
      await deleteRiskModelRemote(model.id);
      setModelsError(null);
      setModelsWarning(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not delete model in AWS";
      setModelsWarning(`${message}. Deletion applied locally; refresh to re-check remote state.`);
    } finally {
      setModelActionPending(false);
    }
  };

  const runEvaluation = (model: RiskModel, versionFormula?: string, versionLabel?: string) => {
    const inputValues = modelInputsFromHarness(testValues);
    const formulaToUse = versionFormula ?? model.formula;

    const evaluated = evaluateFormula(formulaToUse, model.inputVariables, inputValues);
    if (!evaluated.ok) {
      const fallback: EvaluationResult = {
        finalRiskScore: 0,
        riskLevel: "Low Risk",
        formulaUsed: formulaToUse,
        modelVersion: versionLabel ?? model.version,
        inputValuesUsed: inputValues,
        evaluationTimestamp: formatNow(),
        suggestedAction: "Formula error - correct DSL and rerun.",
        warningMessages: [evaluated.message],
        whySummary: "No attribution available until formula compiles successfully.",
        attribution: [],
      };
      return fallback;
    }

    const clamped = clampValue(evaluated.value, model.outputScale.min, model.outputScale.max);
    const finalRiskScore = Number(clamped.toFixed(2));
    const riskLevel = riskLevelFromScore(finalRiskScore, model.riskThresholds);
    const attribution = buildAttribution(model, inputValues, finalRiskScore);
    const warnings: string[] = [];

    if (testValues.datCapacityScore < 40) {
      warnings.push("DAT capacity score is constrained, increasing tender rejection risk.");
    }
    if (testValues.weatherRisk > 70) {
      warnings.push("Severe weather corridor detected on planned route.");
    }
    if (testValues.carrierReliability < 60) {
      warnings.push("Carrier reliability is below policy threshold.");
    }

    return {
      finalRiskScore,
      riskLevel,
      formulaUsed: evaluated.cleanedFormula,
      modelVersion: versionLabel ?? model.version,
      inputValuesUsed: inputValues,
      evaluationTimestamp: formatNow(),
      suggestedAction: suggestedAction(riskLevel),
      warningMessages: warnings,
      whySummary: whySummary(attribution, riskLevel),
      attribution,
    } satisfies EvaluationResult;
  };

  const runCurrentEvaluation = () => {
    if (!hasSelectedModel) return;
    const current = runEvaluation(activeModel);
    setEvaluationResult(current);

    const record: EvaluationRecord = {
      id: `eval-${Date.now()}`,
      modelId: activeModel.id,
      modelVersion: activeModel.version,
      formulaSnapshot: activeModel.formula,
      inputValues: current.inputValuesUsed,
      inputDataTimestamp: formatNow(),
      outputScore: current.finalRiskScore,
      riskLevel: current.riskLevel,
      evaluationTimestamp: current.evaluationTimestamp,
      evaluatedBy: actorLabel,
      testCaseId: `tc-${Date.now()}`,
    };

    setEvaluationRecords((prev) => [record, ...prev].slice(0, 24));
  };

  const runCompareEvaluation = () => {
    if (!hasSelectedModel) return;
    if (compareVersion === "latest") {
      setCompareResult(null);
      return;
    }

    const selectedVersion = activeModel.versionHistory.find(
      (entry) => entry.version === compareVersion,
    );
    if (!selectedVersion) {
      setCompareResult(null);
      return;
    }

    const compared = runEvaluation(activeModel, selectedVersion.formulaSnapshot, selectedVersion.version);
    setCompareResult(compared);
  };

  const loadSampleData = () => {
    setTestValues(BASE_TEST_CASE);
  };

  const resetTestValues = () => {
    setTestValues({
      ...BASE_TEST_CASE,
      weatherRisk: 0,
      fuelDelta: 0,
      averageDwellTime: 0,
      carrierReliability: 100,
      laneVolatility: 0,
    });
  };

  const saveTestCase = () => {
    if (!hasSelectedModel) return;
    const record: EvaluationRecord = {
      id: `saved-${Date.now()}`,
      modelId: activeModel.id,
      modelVersion: activeModel.version,
      formulaSnapshot: activeModel.formula,
      inputValues: modelInputsFromHarness(testValues),
      inputDataTimestamp: formatNow(),
      outputScore: evaluationResult?.finalRiskScore ?? 0,
      riskLevel: evaluationResult?.riskLevel ?? "Low Risk",
      evaluationTimestamp: formatNow(),
      evaluatedBy: actorLabel,
      testCaseId: `saved-${Date.now()}`,
    };
    setEvaluationRecords((prev) => [record, ...prev].slice(0, 24));
  };

  const exportEvaluation = () => {
    if (!evaluationResult || typeof window === "undefined" || !hasSelectedModel) return;
    const payload = {
      modelId: activeModel.id,
      modelVersion: activeModel.version,
      formulaSnapshot: activeModel.formula,
      inputValues: evaluationResult.inputValuesUsed,
      outputScore: evaluationResult.finalRiskScore,
      riskLevel: evaluationResult.riskLevel,
      evaluationTimestamp: evaluationResult.evaluationTimestamp,
      evaluatedBy: actorLabel,
    };

    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    const modelName = activeModel.modelName || "risk-model";
    link.download = `${modelName.toLowerCase().replace(/\s+/g, "-")}-evaluation.json`;
    link.click();
    window.URL.revokeObjectURL(url);
  };

  const toggleAllowedRole = (role: string, checked: boolean) => {
    setEditorDraft((prev) => {
      const next = new Set(prev.allowedRoles);
      if (checked) next.add(role);
      else next.delete(role);
      return { ...prev, allowedRoles: Array.from(next) };
    });
  };

  const appendDslToken = () => {
    updateEditorField("formula", `${editorDraft.formula}\n${dslInsertToken}`);
  };

  const compareDelta =
    evaluationResult && compareResult
      ? Number((evaluationResult.finalRiskScore - compareResult.finalRiskScore).toFixed(2))
      : null;

  return (
    <div>
      <PageHeader
        title="Risk Models"
        description="Enterprise command center for scoring logic, explainability, version governance, and reproducible risk evaluation."
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={() => setActiveTab("audit")}
            >
              <History className="h-4 w-4" /> View Audit Log
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={() => setActiveTab("versions")}
            >
              <GitBranch className="h-4 w-4" /> Version History
            </Button>
            <Button size="sm" className="gap-1.5" disabled={modelActionPending} onClick={() => void createModel()}>
              <Plus className="h-4 w-4" /> Create Model
            </Button>
          </>
        }
      />

      <div className="space-y-5 px-4 py-6 sm:px-6 lg:px-8">
        {modelsLoading ? (
          <StatCardsSkeleton count={4} />
        ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard
            label="Published Models"
            value={String(metricCards.published)}
            subtitle="Production scoring active"
            tone="success"
            icon={<BadgeCheck className="h-4 w-4" />}
          />
          <MetricCard
            label="Draft Models"
            value={String(metricCards.drafts)}
            subtitle="Pending review"
            tone="info"
            icon={<FileCode2 className="h-4 w-4" />}
          />
          <MetricCard
            label="Testing Queue"
            value={String(metricCards.testing)}
            subtitle="In harness validation"
            tone="warning"
            icon={<FlaskConical className="h-4 w-4" />}
          />
          <MetricCard
            label="Rolled Back"
            value={String(metricCards.rolledBack)}
            subtitle="Monitored for regression"
            tone="default"
            icon={<RotateCcw className="h-4 w-4" />}
          />
        </div>
        )}
        {modelsWarning && (
          <div className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning-foreground">
            {modelsWarning}
          </div>
        )}
        {modelsError && (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {modelsError}
          </div>
        )}

        <Tabs
          value={activeTab}
          onValueChange={(value) => setActiveTab(value as RiskTabId)}
          className="space-y-5"
        >
          <div className="rounded-xl border border-border/70 bg-muted/20 p-1.5 shadow-sm">
            <div className="overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              <TabsList className="inline-flex h-auto w-max min-w-full gap-0.5 bg-transparent p-0 sm:min-w-0">
                {RISK_WORKSPACE_TABS.map((tab, index) => {
                  const Icon = tab.icon;
                  const showDivider =
                    index > 0 && RISK_WORKSPACE_TABS[index - 1].group !== tab.group;
                  return (
                    <React.Fragment key={tab.value}>
                      {showDivider ? (
                        <div
                          aria-hidden
                          className="mx-0.5 hidden h-7 w-px shrink-0 self-center bg-border/70 sm:block"
                        />
                      ) : null}
                      <TabsTrigger
                        value={tab.value}
                        title={tab.title}
                        className="group relative gap-1.5 rounded-lg px-3 py-2 text-xs font-medium text-muted-foreground transition-all hover:bg-background/60 hover:text-foreground data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm sm:px-3.5 sm:text-sm"
                      >
                        <Icon className="h-3.5 w-3.5 shrink-0 opacity-70 transition-opacity group-data-[state=active]:opacity-100" />
                        <span className="whitespace-nowrap">{tab.label}</span>
                      </TabsTrigger>
                    </React.Fragment>
                  );
                })}
              </TabsList>
            </div>
          </div>

          <TabsContent value="list" className="mt-0 space-y-4">
            <Card className="border-border/70 shadow-sm">
              <CardHeader>
                <CardTitle>Risk Models List</CardTitle>
                <CardDescription>
                  Create, test, publish, roll back, and govern risk models used across dispatch
                  and pricing workflows.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_220px_220px_auto]">
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                      className="pl-9"
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                      placeholder="Search by model, owner, or usage"
                    />
                  </div>
                  <Select
                    value={statusFilter}
                    onValueChange={(value) => setStatusFilter(value as "all" | ModelStatus)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Status" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Statuses</SelectItem>
                      {MODEL_STATUSES.map((status) => (
                        <SelectItem key={status} value={status}>
                          {status}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select
                    value={riskTypeFilter}
                    onValueChange={(value) => setRiskTypeFilter(value as "all" | RiskType)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Risk Type" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Risk Types</SelectItem>
                      {RISK_TYPES.map((riskType) => (
                        <SelectItem key={riskType} value={riskType}>
                          {riskType}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1.5"
                      onClick={() => setActiveTab("audit")}
                    >
                      <History className="h-4 w-4" /> Audit
                    </Button>
                    <Button size="sm" className="gap-1.5" disabled={modelActionPending} onClick={() => void createModel()}>
                      <Plus className="h-4 w-4" /> Create Model
                    </Button>
                  </div>
                </div>

                <div className="rounded-md border border-border/70">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Model Name</TableHead>
                        <TableHead>Version</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Owner</TableHead>
                        <TableHead>Last Modified</TableHead>
                        <TableHead>Last Published</TableHead>
                        <TableHead>Risk Type</TableHead>
                        <TableHead>Used By</TableHead>
                        <TableHead className="min-w-[340px]">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredModels.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={9} className="py-8 text-center text-sm text-muted-foreground">
                            No risk models yet. Create a model to begin.
                          </TableCell>
                        </TableRow>
                      ) : (
                        filteredModels.map((model) => (
                          <TableRow
                            key={model.id}
                            className={cn(model.id === selectedModelId && "bg-muted/30")}
                          >
                            <TableCell className="font-medium">{model.modelName}</TableCell>
                            <TableCell>{model.version}</TableCell>
                            <TableCell>
                              <Badge variant="outline" className={toneForStatus(model.status)}>
                                {model.status}
                              </Badge>
                            </TableCell>
                            <TableCell>{model.owner}</TableCell>
                            <TableCell>{model.lastModified}</TableCell>
                            <TableCell>{model.lastPublished}</TableCell>
                            <TableCell>{model.riskType}</TableCell>
                            <TableCell>
                              <div className="flex flex-wrap gap-1">
                                {model.usedBy.map((area) => (
                                  <Badge key={area} variant="secondary" className="text-[10px]">
                                    {area}
                                  </Badge>
                                ))}
                              </div>
                            </TableCell>
                            <TableCell>
                              <div className="flex flex-wrap gap-1.5">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="h-7"
                                  onClick={() => {
                                    setSelectedModelId(model.id);
                                    setActiveTab("editor");
                                  }}
                                >
                                  Edit Model
                                </Button>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="h-7"
                                  disabled={modelActionPending}
                                  onClick={() => void duplicateModel(model)}
                                >
                                  <Copy className="mr-1 h-3.5 w-3.5" /> Duplicate
                                </Button>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="h-7"
                                  onClick={() => {
                                    setSelectedModelId(model.id);
                                    setActiveTab("test");
                                  }}
                                >
                                  <FlaskConical className="mr-1 h-3.5 w-3.5" /> Test
                                </Button>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="h-7"
                                  disabled={modelActionPending}
                                  onClick={() => void publishModel(model)}
                                >
                                  <Send className="mr-1 h-3.5 w-3.5" /> Publish
                                </Button>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="h-7"
                                  disabled={modelActionPending}
                                  onClick={() => void rollbackModel(model)}
                                >
                                  <RotateCcw className="mr-1 h-3.5 w-3.5" /> Roll Back
                                </Button>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="h-7"
                                  disabled={modelActionPending}
                                  onClick={() => void archiveModel(model)}
                                >
                                  <Archive className="mr-1 h-3.5 w-3.5" /> Archive
                                </Button>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="h-7 text-destructive"
                                  disabled={modelActionPending}
                                  onClick={() => void deleteModel(model)}
                                >
                                  Delete
                                </Button>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="h-7"
                                  onClick={() => {
                                    setSelectedModelId(model.id);
                                    setActiveTab("audit");
                                  }}
                                >
                                  View Audit Log
                                </Button>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="h-7"
                                  onClick={() => {
                                    setSelectedModelId(model.id);
                                    setActiveTab("versions");
                                  }}
                                >
                                  View Version History
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="editor" className="mt-0 space-y-4">
            <Card className="border-border/70 shadow-sm">
              <CardHeader>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <CardTitle>Risk Model Editor</CardTitle>
                    <CardDescription>
                      Define formulas, thresholds, governance details, and role access for model
                      lifecycle management.
                    </CardDescription>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className={toneForStatus(editorDraft.status)}>
                      {editorDraft.status}
                    </Badge>
                    <Badge variant="secondary">{editorDraft.version}</Badge>
                    {activeModel.status === "Published" && hasSelectedModel && (
                      <Badge
                        variant="outline"
                        className="border-warning/30 bg-warning/15 text-warning-foreground"
                      >
                        Published models are locked; save creates a new draft version
                      </Badge>
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="grid gap-4 xl:grid-cols-3">
                  <Field label="Model Name" required>
                    <Input
                      value={editorDraft.modelName}
                      onChange={(event) => updateEditorField("modelName", event.target.value)}
                    />
                  </Field>
                  <Field label="Risk Type" required>
                    <Select
                      value={editorDraft.riskType}
                      onValueChange={(value) => updateEditorField("riskType", value as RiskType)}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select risk type" />
                      </SelectTrigger>
                      <SelectContent>
                        {RISK_TYPES.map((riskType) => (
                          <SelectItem key={riskType} value={riskType}>
                            {riskType}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field label="Owner" required>
                    <Input
                      value={editorDraft.owner}
                      onChange={(event) => updateEditorField("owner", event.target.value)}
                    />
                  </Field>
                </div>

                <Field label="Model Description" required>
                  <Textarea
                    className="min-h-[80px]"
                    value={editorDraft.description}
                    onChange={(event) => updateEditorField("description", event.target.value)}
                  />
                </Field>

                <div className="grid gap-4 xl:grid-cols-[2fr_1fr]">
                  <Field
                    label="Formula"
                    required
                    hint="Supports numeric weights, variables, + - * /, parentheses, min(), max(), clamp(), comments (# or //), and conditional placeholders via ternary logic."
                  >
                    <Textarea
                      className="min-h-[160px] font-mono text-xs"
                      value={editorDraft.formula}
                      onChange={(event) => updateEditorField("formula", event.target.value)}
                    />
                  </Field>
                  <div className="space-y-3 rounded-md border border-border/70 p-3">
                    <div className="text-sm font-semibold">Formula DSL Builder</div>
                    <p className="text-xs text-muted-foreground">
                      Insert helper snippets into the formula editor.
                    </p>
                    <Select value={dslInsertToken} onValueChange={setDslInsertToken}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="clamp(value, 0, 100)">clamp(value, 0, 100)</SelectItem>
                        <SelectItem value="min(a, b)">min(a, b)</SelectItem>
                        <SelectItem value="max(a, b)">max(a, b)</SelectItem>
                        <SelectItem value="(condition ? a : b)">(condition ? a : b)</SelectItem>
                        <SelectItem value="# note: adjust weight for seasonality">
                          # comment / note
                        </SelectItem>
                      </SelectContent>
                    </Select>
                    <Button size="sm" variant="outline" className="w-full" onClick={appendDslToken}>
                      <Sparkles className="mr-1.5 h-3.5 w-3.5" /> Insert DSL Snippet
                    </Button>
                  </div>
                </div>

                <div className="grid gap-4 lg:grid-cols-3">
                  <Field label="Input Variables" hint="Toggle available variables for this model.">
                    <div className="space-y-2 rounded-md border border-border/70 p-3">
                      {INPUT_CATALOG.map((input) => {
                        const enabled = editorDraft.inputVariables.includes(input.name);
                        return (
                          <div key={input.name} className="flex items-center justify-between gap-2">
                            <div>
                              <p className="text-sm font-medium">{input.name}</p>
                              <p className="text-xs text-muted-foreground">{input.description}</p>
                            </div>
                            <Switch
                              checked={enabled}
                              onCheckedChange={(checked) => {
                                setEditorDraft((prev) => {
                                  const next = new Set(prev.inputVariables);
                                  if (checked) next.add(input.name);
                                  else next.delete(input.name);
                                  return { ...prev, inputVariables: Array.from(next) };
                                });
                              }}
                            />
                          </div>
                        );
                      })}
                    </div>
                  </Field>

                  <Field label="Output Scale">
                    <div className="grid grid-cols-2 gap-2">
                      <Input
                        type="number"
                        value={editorDraft.outputScale.min}
                        onChange={(event) =>
                          updateEditorField("outputScale", {
                            ...editorDraft.outputScale,
                            min: Number(event.target.value || 0),
                          })
                        }
                      />
                      <Input
                        type="number"
                        value={editorDraft.outputScale.max}
                        onChange={(event) =>
                          updateEditorField("outputScale", {
                            ...editorDraft.outputScale,
                            max: Number(event.target.value || 100),
                          })
                        }
                      />
                    </div>
                  </Field>

                  <Field label="Risk Thresholds" hint="Low / Medium / High boundaries (0-100).">
                    <div className="grid grid-cols-3 gap-2">
                      <Input
                        type="number"
                        value={editorDraft.riskThresholds.low}
                        onChange={(event) =>
                          updateEditorField("riskThresholds", {
                            ...editorDraft.riskThresholds,
                            low: Number(event.target.value || 0),
                          })
                        }
                      />
                      <Input
                        type="number"
                        value={editorDraft.riskThresholds.medium}
                        onChange={(event) =>
                          updateEditorField("riskThresholds", {
                            ...editorDraft.riskThresholds,
                            medium: Number(event.target.value || 0),
                          })
                        }
                      />
                      <Input
                        type="number"
                        value={editorDraft.riskThresholds.high}
                        onChange={(event) =>
                          updateEditorField("riskThresholds", {
                            ...editorDraft.riskThresholds,
                            high: Number(event.target.value || 0),
                          })
                        }
                      />
                    </div>
                  </Field>
                </div>

                <div className="grid gap-4 xl:grid-cols-2">
                  <Field label="Allowed Users / Roles" hint="Role-based model access control.">
                    <div className="rounded-md border border-border/70 p-3">
                      <div className="mb-3 flex gap-2">
                        <Select
                          value={editorRoleSelect}
                          onValueChange={(value) =>
                            setEditorRoleSelect(value as (typeof ROLE_OPTIONS)[number])
                          }
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {ROLE_OPTIONS.map((role) => (
                              <SelectItem key={role} value={role}>
                                {role}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => toggleAllowedRole(editorRoleSelect, true)}
                        >
                          Add Role
                        </Button>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {editorDraft.allowedRoles.map((role) => (
                          <button
                            key={role}
                            type="button"
                            onClick={() => toggleAllowedRole(role, false)}
                            className="rounded-full border border-border bg-muted px-2.5 py-1 text-xs transition hover:bg-muted/70"
                          >
                            {role} x
                          </button>
                        ))}
                      </div>
                    </div>
                  </Field>

                  <Field label="Notes">
                    <Textarea
                      className="min-h-[96px]"
                      value={editorDraft.notes}
                      onChange={(event) => updateEditorField("notes", event.target.value)}
                    />
                  </Field>
                </div>

                <div className="grid gap-4 xl:grid-cols-3">
                  <Field label="Change Reason">
                    <Input
                      value={editorDraft.governance.changeReason}
                      onChange={(event) =>
                        updateEditorField("governance", {
                          ...editorDraft.governance,
                          changeReason: event.target.value,
                        })
                      }
                    />
                  </Field>
                  <Field label="Required Reviewer">
                    <Input
                      value={editorDraft.governance.requiredReviewer}
                      onChange={(event) =>
                        updateEditorField("governance", {
                          ...editorDraft.governance,
                          requiredReviewer: event.target.value,
                        })
                      }
                    />
                  </Field>
                  <Field label="Effective Date">
                    <Input
                      type="date"
                      value={editorDraft.governance.effectiveDate}
                      onChange={(event) =>
                        updateEditorField("governance", {
                          ...editorDraft.governance,
                          effectiveDate: event.target.value,
                        })
                      }
                    />
                  </Field>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button
                    className="gap-1.5"
                    disabled={modelActionPending || !hasSelectedModel}
                    onClick={() => void saveModelDraft()}
                  >
                    <CheckCircle2 className="h-4 w-4" /> Save and Version
                  </Button>
                  <Button
                    variant="outline"
                    className="gap-1.5"
                    disabled={modelActionPending || !hasSelectedModel}
                    onClick={() => void publishModel(editorDraft)}
                  >
                    <Send className="h-4 w-4" /> Publish Model
                  </Button>
                  <Button
                    variant="outline"
                    className="gap-1.5"
                    disabled={modelActionPending || !hasSelectedModel}
                    onClick={() => void rollbackModel(editorDraft)}
                  >
                    <RotateCcw className="h-4 w-4" /> Roll Back
                  </Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="inputs" className="mt-0 space-y-4">
            <Card className="border-border/70 shadow-sm">
              <CardHeader>
                <CardTitle>Inputs Catalog</CardTitle>
                <CardDescription>
                  Variable inventory with source, update cadence, ranges, and data quality
                  context.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="rounded-md border border-border/70">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Input Name</TableHead>
                        <TableHead>Description</TableHead>
                        <TableHead>Data Type</TableHead>
                        <TableHead>Source</TableHead>
                        <TableHead>Refresh Frequency</TableHead>
                        <TableHead>Allowed Range</TableHead>
                        <TableHead>Example Value</TableHead>
                        <TableHead>Last Updated</TableHead>
                        <TableHead>Required / Optional</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {INPUT_CATALOG.map((input) => (
                        <TableRow key={input.name}>
                          <TableCell className="font-medium">{input.name}</TableCell>
                          <TableCell className="max-w-[360px] text-xs text-muted-foreground">
                            {input.description}
                          </TableCell>
                          <TableCell>{input.dataType}</TableCell>
                          <TableCell>{input.source}</TableCell>
                          <TableCell>{input.refreshFrequency}</TableCell>
                          <TableCell>{input.allowedRange}</TableCell>
                          <TableCell>{input.exampleValue}</TableCell>
                          <TableCell>{input.lastUpdated}</TableCell>
                          <TableCell>
                            <Badge
                              variant="outline"
                              className={
                                input.required
                                  ? "bg-success/15 text-success border-success/30"
                                  : "bg-muted text-muted-foreground border-border"
                              }
                            >
                              {input.required ? "Required" : "Optional"}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>

                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {[
                    "Historical loads",
                    "DAT market rates",
                    "DAT capacity data",
                    "Carrier performance history",
                    "Weather data",
                    "Fuel index",
                    "Facility dwell history",
                    "Tracking events",
                    "Exception history",
                  ].map((source) => (
                    <Card key={source} className="border-border/70">
                      <CardContent className="p-4">
                        <p className="text-sm font-medium">{source}</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          Connected data feed for model input refresh and reproducible evaluation
                          snapshots.
                        </p>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="dsl" className="mt-0 space-y-4">
            <Card className="border-border/70 shadow-sm">
              <CardHeader>
                <CardTitle>Formula DSL Builder</CardTitle>
                <CardDescription>
                  Developer-friendly formula editor with business-readable syntax and safe model
                  evaluation constraints.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-4 xl:grid-cols-[2fr_1fr]">
                  <div className="space-y-3">
                    <Label>Current Formula ({activeModel.modelName || "No model selected"})</Label>
                    <Textarea value={editorDraft.formula} readOnly className="min-h-[220px] font-mono text-xs" />
                  </div>
                  <div className="space-y-3 rounded-md border border-border/70 p-3">
                    <p className="text-sm font-semibold">DSL Features</p>
                    <ul className="space-y-1 text-xs text-muted-foreground">
                      <li>- Numeric weights</li>
                      <li>- Input variables</li>
                      <li>- Addition, subtraction, multiplication, division</li>
                      <li>- Parentheses</li>
                      <li>- min() / max() helper functions</li>
                      <li>- clamp(value, min, max)</li>
                      <li>- Conditional placeholder with ternary syntax</li>
                      <li>- Comments via # or //</li>
                    </ul>
                    <Separator />
                    <p className="text-xs text-muted-foreground">Example:</p>
                    <code className="block rounded bg-muted p-2 text-[11px] leading-relaxed">
                      0.35 * lane_volatility + 0.25 * DAT_spread + 0.20 * carrier_reliability +
                      0.10 * weather_risk + 0.10 * fuel_delta
                    </code>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="test" className="mt-0 space-y-4">
            <Card className="border-border/70 shadow-sm">
              <CardHeader>
                <CardTitle>Test Harness</CardTitle>
                <CardDescription>
                  Run reproducible evaluations on sample load/lane scenarios and compare versions.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-3 xl:grid-cols-4">
                  <Field label="Origin">
                    <Input
                      value={testValues.origin}
                      onChange={(event) =>
                        setTestValues((prev) => ({ ...prev, origin: event.target.value }))
                      }
                    />
                  </Field>
                  <Field label="Destination">
                    <Input
                      value={testValues.destination}
                      onChange={(event) =>
                        setTestValues((prev) => ({ ...prev, destination: event.target.value }))
                      }
                    />
                  </Field>
                  <Field label="Equipment Type">
                    <Input
                      value={testValues.equipmentType}
                      onChange={(event) =>
                        setTestValues((prev) => ({ ...prev, equipmentType: event.target.value }))
                      }
                    />
                  </Field>
                  <Field label="Carrier">
                    <Input
                      value={testValues.carrier}
                      onChange={(event) =>
                        setTestValues((prev) => ({ ...prev, carrier: event.target.value }))
                      }
                    />
                  </Field>
                  <Field label="Pickup Date">
                    <Input
                      type="date"
                      value={testValues.pickupDate}
                      onChange={(event) =>
                        setTestValues((prev) => ({ ...prev, pickupDate: event.target.value }))
                      }
                    />
                  </Field>
                  <Field label="Delivery Date">
                    <Input
                      type="date"
                      value={testValues.deliveryDate}
                      onChange={(event) =>
                        setTestValues((prev) => ({ ...prev, deliveryDate: event.target.value }))
                      }
                    />
                  </Field>
                  <Field label="Commodity">
                    <Input
                      value={testValues.commodity}
                      onChange={(event) =>
                        setTestValues((prev) => ({ ...prev, commodity: event.target.value }))
                      }
                    />
                  </Field>
                  <Field label="Weight">
                    <Input
                      type="number"
                      value={testValues.weight}
                      onChange={(event) =>
                        setTestValues((prev) => ({ ...prev, weight: Number(event.target.value || 0) }))
                      }
                    />
                  </Field>
                  <Field label="Customer Rate">
                    <Input
                      type="number"
                      value={testValues.customerRate}
                      onChange={(event) =>
                        setTestValues((prev) => ({ ...prev, customerRate: Number(event.target.value || 0) }))
                      }
                    />
                  </Field>
                  <Field label="Carrier Rate">
                    <Input
                      type="number"
                      value={testValues.carrierRate}
                      onChange={(event) =>
                        setTestValues((prev) => ({ ...prev, carrierRate: Number(event.target.value || 0) }))
                      }
                    />
                  </Field>
                  <Field label="DAT Average Rate">
                    <Input
                      type="number"
                      value={testValues.datAverageRate}
                      onChange={(event) =>
                        setTestValues((prev) => ({ ...prev, datAverageRate: Number(event.target.value || 0) }))
                      }
                    />
                  </Field>
                  <Field label="DAT Capacity Score">
                    <Input
                      type="number"
                      value={testValues.datCapacityScore}
                      onChange={(event) =>
                        setTestValues((prev) => ({ ...prev, datCapacityScore: Number(event.target.value || 0) }))
                      }
                    />
                  </Field>
                  <Field label="Weather Risk">
                    <Input
                      type="number"
                      value={testValues.weatherRisk}
                      onChange={(event) =>
                        setTestValues((prev) => ({ ...prev, weatherRisk: Number(event.target.value || 0) }))
                      }
                    />
                  </Field>
                  <Field label="Fuel Delta">
                    <Input
                      type="number"
                      value={testValues.fuelDelta}
                      onChange={(event) =>
                        setTestValues((prev) => ({ ...prev, fuelDelta: Number(event.target.value || 0) }))
                      }
                    />
                  </Field>
                  <Field label="Average Dwell Time">
                    <Input
                      type="number"
                      value={testValues.averageDwellTime}
                      onChange={(event) =>
                        setTestValues((prev) => ({
                          ...prev,
                          averageDwellTime: Number(event.target.value || 0),
                        }))
                      }
                    />
                  </Field>
                  <Field label="Carrier Reliability">
                    <Input
                      type="number"
                      value={testValues.carrierReliability}
                      onChange={(event) =>
                        setTestValues((prev) => ({
                          ...prev,
                          carrierReliability: Number(event.target.value || 0),
                        }))
                      }
                    />
                  </Field>
                  <Field label="Lane Volatility">
                    <Input
                      type="number"
                      value={testValues.laneVolatility}
                      onChange={(event) =>
                        setTestValues((prev) => ({ ...prev, laneVolatility: Number(event.target.value || 0) }))
                      }
                    />
                  </Field>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <Button className="gap-1.5" onClick={runCurrentEvaluation}>
                    <PlayCircle className="h-4 w-4" /> Run Evaluation
                  </Button>
                  <Button variant="outline" className="gap-1.5" onClick={loadSampleData}>
                    <RefreshCw className="h-4 w-4" /> Load Sample Data
                  </Button>
                  <Button variant="outline" className="gap-1.5" onClick={resetTestValues}>
                    <RotateCcw className="h-4 w-4" /> Reset Inputs
                  </Button>
                  <Button variant="outline" className="gap-1.5" onClick={saveTestCase}>
                    <CheckCircle2 className="h-4 w-4" /> Save Test Case
                  </Button>
                  <Button variant="outline" className="gap-1.5" onClick={exportEvaluation}>
                    <Download className="h-4 w-4" /> Export Result
                  </Button>
                </div>

                <div className="grid gap-4 xl:grid-cols-3">
                  <Field label="Compare Versions">
                    <Select value={compareVersion} onValueChange={setCompareVersion}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="latest">Current Version</SelectItem>
                        {activeModel.versionHistory.map((entry) => (
                          <SelectItem key={entry.version} value={entry.version}>
                            {entry.version} ({entry.status})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                  <div className="xl:col-span-2 flex items-end">
                    <Button variant="outline" className="gap-1.5" onClick={runCompareEvaluation}>
                      <GitBranch className="h-4 w-4" /> Compare Versions
                    </Button>
                  </div>
                </div>

                <Card className="border-border/70 bg-muted/20">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">Reproducibility Ledger</CardTitle>
                    <CardDescription>
                      Stored evaluation details: model ID/version, formula snapshot, input values,
                      timestamps, output, and evaluator.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="rounded-md border border-border/70">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Model ID</TableHead>
                            <TableHead>Model Version</TableHead>
                            <TableHead>Output Score</TableHead>
                            <TableHead>Risk Level</TableHead>
                            <TableHead>Evaluation Timestamp</TableHead>
                            <TableHead>Evaluated By</TableHead>
                            <TableHead>Test Case ID</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {evaluationRecords.length === 0 ? (
                            <TableRow>
                              <TableCell
                                colSpan={7}
                                className="py-8 text-center text-sm text-muted-foreground"
                              >
                                No evaluation records yet. Run or save a test case.
                              </TableCell>
                            </TableRow>
                          ) : (
                            evaluationRecords.map((record) => (
                              <TableRow key={record.id}>
                                <TableCell>{record.modelId}</TableCell>
                                <TableCell>{record.modelVersion}</TableCell>
                                <TableCell>{record.outputScore}</TableCell>
                                <TableCell>{record.riskLevel}</TableCell>
                                <TableCell>{record.evaluationTimestamp}</TableCell>
                                <TableCell>{record.evaluatedBy}</TableCell>
                                <TableCell>{record.testCaseId}</TableCell>
                              </TableRow>
                            ))
                          )}
                        </TableBody>
                      </Table>
                    </div>
                  </CardContent>
                </Card>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="output" className="mt-0 space-y-4">
            <Card className="border-border/70 shadow-sm">
              <CardHeader>
                <CardTitle>Output Preview & Feature Attribution</CardTitle>
                <CardDescription>
                  SHAP-like attribution from formula weights, feature ranking, and explainability
                  summary.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                {!evaluationResult ? (
                  <div className="rounded-md border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
                    Run an evaluation in Test Harness to preview output, risk level, and feature
                    attribution.
                  </div>
                ) : (
                  <>
                    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                      <MetricCard
                        label="Final Risk Score"
                        value={`${evaluationResult.finalRiskScore} / 100`}
                        subtitle="Scored from published/draft formula"
                        tone="default"
                        icon={<ShieldAlert className="h-4 w-4" />}
                      />
                      <MetricCard
                        label="Risk Level"
                        value={evaluationResult.riskLevel}
                        subtitle="Threshold-based classification"
                        tone={
                          evaluationResult.riskLevel === "Low Risk"
                            ? "success"
                            : evaluationResult.riskLevel === "Medium Risk"
                              ? "info"
                              : evaluationResult.riskLevel === "High Risk"
                                ? "warning"
                                : "default"
                        }
                        icon={<TriangleAlert className="h-4 w-4" />}
                      />
                      <MetricCard
                        label="Model Version"
                        value={evaluationResult.modelVersion}
                        subtitle={activeModel.modelName || "No model selected"}
                        tone="default"
                        icon={<GitBranch className="h-4 w-4" />}
                      />
                      <MetricCard
                        label="Evaluation Time"
                        value={
                          evaluationResult.evaluationTimestamp.split(",")[0] ??
                          evaluationResult.evaluationTimestamp
                        }
                        subtitle={evaluationResult.evaluationTimestamp}
                        tone="default"
                        icon={<Timer className="h-4 w-4" />}
                      />
                    </div>

                    <div className="grid gap-4 xl:grid-cols-[1.2fr_1fr]">
                      <Card className="border-border/70">
                        <CardHeader className="pb-2">
                          <CardTitle className="text-base">Output Summary</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-3">
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge
                              variant="outline"
                              className={toneForRiskLevel(evaluationResult.riskLevel)}
                            >
                              {evaluationResult.riskLevel}
                            </Badge>
                            <Badge variant="secondary">Model {evaluationResult.modelVersion}</Badge>
                          </div>
                          <p className="text-sm">
                            <span className="font-medium">Suggested Action:</span>{" "}
                            {evaluationResult.suggestedAction}
                          </p>
                          <p className="text-sm text-muted-foreground">
                            <span className="font-medium text-foreground">Formula Used:</span>{" "}
                            <code className="rounded bg-muted px-1 py-0.5 text-[11px]">
                              {evaluationResult.formulaUsed}
                            </code>
                          </p>
                          <div>
                            <p className="mb-1 text-sm font-medium">Input Values Used</p>
                            <div className="grid gap-1 sm:grid-cols-2">
                              {Object.entries(evaluationResult.inputValuesUsed).map(
                                ([key, value]) => (
                                  <div
                                    key={key}
                                    className="rounded border border-border/60 px-2 py-1 text-xs"
                                  >
                                    <span className="font-medium">{key}:</span>{" "}
                                    {Number(value).toFixed(2)}
                                  </div>
                                ),
                              )}
                            </div>
                          </div>
                          {evaluationResult.warningMessages.length > 0 && (
                            <div className="rounded-md border border-warning/30 bg-warning/10 p-3">
                              <p className="text-sm font-medium text-warning-foreground">
                                Warning Messages
                              </p>
                              <ul className="mt-1 space-y-1 text-xs text-warning-foreground/90">
                                {evaluationResult.warningMessages.map((message) => (
                                  <li key={message}>- {message}</li>
                                ))}
                              </ul>
                            </div>
                          )}
                        </CardContent>
                      </Card>

                      <Card className="border-border/70">
                        <CardHeader className="pb-2">
                          <CardTitle className="text-base">Why This Score?</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-3">
                          <p className="text-sm text-muted-foreground">
                            {evaluationResult.whySummary}
                          </p>
                          {compareResult && compareDelta !== null && (
                            <div className="rounded-md border border-border/70 p-3">
                              <p className="text-sm font-medium">Version Comparison</p>
                              <p className="text-xs text-muted-foreground">
                                Current ({evaluationResult.modelVersion}) vs{" "}
                                {compareResult.modelVersion}
                              </p>
                              <div className="mt-2 flex items-center gap-2 text-sm">
                                {compareDelta >= 0 ? (
                                  <ArrowUp className="h-4 w-4 text-destructive" />
                                ) : (
                                  <ArrowDown className="h-4 w-4 text-success" />
                                )}
                                <span>
                                  Score delta:{" "}
                                  <span className="font-semibold">{compareDelta}</span>
                                </span>
                              </div>
                            </div>
                          )}
                        </CardContent>
                      </Card>
                    </div>

                    <Card className="border-border/70">
                      <CardHeader className="pb-2">
                        <CardTitle className="text-base">Feature Attribution</CardTitle>
                        <CardDescription>
                          Feature Name, Input Value, Weight, Contribution, Direction, and Impact
                          Level.
                        </CardDescription>
                      </CardHeader>
                      <CardContent className="space-y-3">
                        {evaluationResult.attribution.length === 0 ? (
                          <p className="text-sm text-muted-foreground">
                            No attribution available due to formula error.
                          </p>
                        ) : (
                          evaluationResult.attribution.map((row) => {
                            const maxAbs = Math.max(
                              ...evaluationResult.attribution.map((item) =>
                                Math.abs(item.contribution),
                              ),
                            );
                            const width = maxAbs === 0 ? 0 : (Math.abs(row.contribution) / maxAbs) * 100;

                            return (
                              <div key={row.featureName} className="rounded-md border border-border/70 p-3">
                                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                                  <div>
                                    <p className="text-sm font-semibold">{row.featureName}</p>
                                    <p className="text-xs text-muted-foreground">
                                      Input {row.inputValue.toFixed(2)} * weight{" "}
                                      {row.weight.toFixed(3)}
                                    </p>
                                  </div>
                                  <div className="flex items-center gap-1.5">
                                    <Badge
                                      variant="outline"
                                      className={
                                        row.direction === "Positive"
                                          ? "bg-destructive/15 text-destructive border-destructive/30"
                                          : row.direction === "Negative"
                                            ? "bg-success/15 text-success border-success/30"
                                            : "bg-muted text-muted-foreground border-border"
                                      }
                                    >
                                      {row.direction}
                                    </Badge>
                                    <Badge variant="outline" className={impactTone(row.impactLevel)}>
                                      {row.impactLevel} Impact
                                    </Badge>
                                  </div>
                                </div>
                                <div className="relative h-2 rounded bg-muted">
                                  <div
                                    className={cn(
                                      "h-2 rounded",
                                      row.contribution >= 0 ? "bg-destructive/70" : "bg-success/70",
                                    )}
                                    style={{ width: `${Math.max(width, 2)}%` }}
                                  />
                                </div>
                                <p className="mt-2 text-xs">
                                  Contribution:{" "}
                                  <span className="font-semibold">{row.contribution.toFixed(2)}</span>
                                </p>
                              </div>
                            );
                          })
                        )}
                      </CardContent>
                    </Card>
                  </>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="versions" className="mt-0 space-y-4">
            <Card className="border-border/70 shadow-sm">
              <CardHeader>
                <CardTitle>Version History</CardTitle>
                <CardDescription>
                  Every formula/config update creates a new version. Compare, restore, roll back,
                  and duplicate as draft.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <Badge variant="secondary">Current Model: {activeModel.modelName || "No model selected"}</Badge>
                  <Badge variant="outline">Current Version: {activeModel.version}</Badge>
                </div>

                <div className="rounded-md border border-border/70">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Version</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Formula Snapshot</TableHead>
                        <TableHead>Modified By</TableHead>
                        <TableHead>Modified Date</TableHead>
                        <TableHead>Published By</TableHead>
                        <TableHead>Published Date</TableHead>
                        <TableHead>Change Notes</TableHead>
                        <TableHead>Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {activeModel.versionHistory.map((row) => (
                        <TableRow key={`${row.version}-${row.modifiedDate}`}>
                          <TableCell className="font-medium">{row.version}</TableCell>
                          <TableCell>
                            <Badge variant="outline" className={toneForStatus(row.status)}>
                              {row.status}
                            </Badge>
                          </TableCell>
                          <TableCell className="max-w-[300px]">
                            <code className="line-clamp-2 rounded bg-muted px-1.5 py-0.5 text-[11px]">
                              {row.formulaSnapshot}
                            </code>
                          </TableCell>
                          <TableCell>{row.modifiedBy}</TableCell>
                          <TableCell>{row.modifiedDate}</TableCell>
                          <TableCell>{row.publishedBy}</TableCell>
                          <TableCell>{row.publishedDate}</TableCell>
                          <TableCell className="max-w-[220px] text-xs text-muted-foreground">
                            {row.changeNotes}
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-wrap gap-1">
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7"
                                onClick={() => {
                                  setEditorDraft((prev) => ({ ...prev, formula: row.formulaSnapshot }));
                                  setActiveTab("editor");
                                }}
                              >
                                View Version
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7"
                                onClick={() => {
                                  setCompareVersion(row.version);
                                  setActiveTab("test");
                                }}
                              >
                                Compare Versions
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7"
                                disabled={modelActionPending || !hasSelectedModel}
                                onClick={() => {
                                  if (!hasSelectedModel) return;
                                  void rollbackModel(activeModel);
                                }}
                              >
                                Restore / Roll Back
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7"
                                disabled={modelActionPending || !hasSelectedModel}
                                onClick={() => {
                                  if (!hasSelectedModel) return;
                                  void duplicateModel(activeModel);
                                }}
                              >
                                Duplicate as Draft
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="governance" className="mt-0 space-y-4">
            <div className="grid gap-4 xl:grid-cols-[1.2fr_1fr]">
              <Card className="border-border/70 shadow-sm">
                <CardHeader>
                  <CardTitle>Governance Controls</CardTitle>
                  <CardDescription>
                    Lifecycle governance: approvals, publish/rollback, change notes, required
                    reviewer, and effective date.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                    <GovernanceStat
                      label="Current Version"
                      value={activeModel.governance.currentVersion || "-"}
                    />
                    <GovernanceStat
                      label="Draft Version"
                      value={activeModel.governance.draftVersion || "-"}
                    />
                    <GovernanceStat
                      label="Published Version"
                      value={activeModel.governance.publishedVersion || "-"}
                    />
                    <GovernanceStat label="Created By" value={activeModel.governance.createdBy || "-"} />
                    <GovernanceStat
                      label="Modified By"
                      value={activeModel.governance.modifiedBy || "-"}
                    />
                    <GovernanceStat
                      label="Approved By"
                      value={activeModel.governance.approvedBy || "-"}
                    />
                    <GovernanceStat
                      label="Published By"
                      value={activeModel.governance.publishedBy || "-"}
                    />
                    <GovernanceStat
                      label="Last Modified"
                      value={activeModel.governance.lastModified || "-"}
                    />
                    <GovernanceStat
                      label="Last Published"
                      value={activeModel.governance.lastPublished || "-"}
                    />
                    <GovernanceStat
                      label="Change Reason"
                      value={activeModel.governance.changeReason || "-"}
                    />
                    <GovernanceStat
                      label="Approval Status"
                      value={activeModel.governance.approvalStatus}
                    />
                    <GovernanceStat
                      label="Rollback Reason"
                      value={activeModel.governance.rollbackReason || "-"}
                    />
                    <GovernanceStat
                      label="Required Reviewer"
                      value={activeModel.governance.requiredReviewer || "-"}
                    />
                    <GovernanceStat
                      label="Effective Date"
                      value={activeModel.governance.effectiveDate || "-"}
                    />
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      className="gap-1.5"
                      disabled={modelActionPending || !hasSelectedModel}
                      onClick={() => {
                        if (!hasSelectedModel) return;
                        void publishModel(activeModel);
                      }}
                    >
                      <Send className="h-4 w-4" /> Publish Model
                    </Button>
                    <Button
                      variant="outline"
                      className="gap-1.5"
                      disabled={modelActionPending || !hasSelectedModel}
                      onClick={() => {
                        if (!hasSelectedModel) return;
                        void rollbackModel(activeModel);
                      }}
                    >
                      <RotateCcw className="h-4 w-4" /> Roll Back Version
                    </Button>
                    <Button
                      variant="outline"
                      className="gap-1.5"
                      disabled={modelActionPending || !hasSelectedModel}
                      onClick={() => {
                        if (!hasSelectedModel) return;
                        void archiveModel(activeModel);
                      }}
                    >
                      <Archive className="h-4 w-4" /> Archive Model
                    </Button>
                    <Button
                      variant="outline"
                      className="gap-1.5"
                      disabled={modelActionPending || !hasSelectedModel}
                      onClick={() => {
                        if (!hasSelectedModel) return;
                        void duplicateModel(activeModel);
                      }}
                    >
                      <Copy className="h-4 w-4" /> Duplicate Model
                    </Button>
                  </div>
                </CardContent>
              </Card>

              <Card className="border-border/70 shadow-sm">
                <CardHeader>
                  <CardTitle>Permission Matrix</CardTitle>
                  <CardDescription>Role-based model access and control policy.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-2">
                  {ROLE_PERMISSION_MATRIX.map((row) => (
                    <div key={row.role} className="rounded-md border border-border/70 p-3">
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <p className="text-sm font-semibold">{row.role}</p>
                        <Badge
                          variant="outline"
                          className={
                            row.view
                              ? "bg-success/15 text-success border-success/30"
                              : "bg-muted text-muted-foreground border-border"
                          }
                        >
                          {row.view ? "Access" : "Blocked"}
                        </Badge>
                      </div>
                      <div className="grid grid-cols-3 gap-1 text-[11px] text-muted-foreground">
                        <span>Create: {row.create ? "Yes" : "No"}</span>
                        <span>Edit: {row.edit ? "Yes" : "No"}</span>
                        <span>Test: {row.test ? "Yes" : "No"}</span>
                        <span>Publish: {row.publish ? "Yes" : "No"}</span>
                        <span>Roll Back: {row.rollback ? "Yes" : "No"}</span>
                        <span>View: {row.view ? "Yes" : "No"}</span>
                      </div>
                      <p className="mt-2 text-xs text-muted-foreground">{row.notes}</p>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="audit" className="mt-0 space-y-4">
            <Card className="border-border/70 shadow-sm">
              <CardHeader>
                <CardTitle>Audit Log</CardTitle>
                <CardDescription>
                  Immutable activity feed across model lifecycle events: create, edit, test,
                  publish, rollback, archive, and permissions.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="rounded-md border border-border/70">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Date / Time</TableHead>
                        <TableHead>User</TableHead>
                        <TableHead>Action</TableHead>
                        <TableHead>Model Name</TableHead>
                        <TableHead>Version</TableHead>
                        <TableHead>Old Value</TableHead>
                        <TableHead>New Value</TableHead>
                        <TableHead>Notes</TableHead>
                        <TableHead>IP Address / Device</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {allAuditEvents.map((event, idx) => (
                        <TableRow key={`${event.modelName}-${event.dateTime}-${idx}`}>
                          <TableCell>{event.dateTime}</TableCell>
                          <TableCell>{event.user}</TableCell>
                          <TableCell>{event.action}</TableCell>
                          <TableCell>{event.modelName}</TableCell>
                          <TableCell>{event.version}</TableCell>
                          <TableCell className="max-w-[220px] text-xs text-muted-foreground">
                            {event.oldValue || "-"}
                          </TableCell>
                          <TableCell className="max-w-[220px] text-xs text-muted-foreground">
                            {event.newValue || "-"}
                          </TableCell>
                          <TableCell className="max-w-[240px] text-xs text-muted-foreground">
                            {event.notes}
                          </TableCell>
                          <TableCell>{event.ipDevice}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="usage" className="mt-0 space-y-4">
            <Card className="border-border/70 shadow-sm">
              <CardHeader>
                <CardTitle>Risk Score Usage Across Platform</CardTitle>
                <CardDescription>
                  Published models are available in core workflows and surface consistent risk
                  cards with drivers and recommended actions.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                  {PLATFORM_USAGE.map((target) => (
                    <Card key={target} className="border-border/70">
                      <CardContent className="space-y-2 p-4">
                        <p className="text-sm font-semibold">{target}</p>
                        <div className="rounded-md border border-border/70 bg-muted/40 p-2 text-xs">
                          <p className="font-medium">Risk Score Card</p>
                          <ul className="mt-1 space-y-1 text-muted-foreground">
                            <li>- Risk Score</li>
                            <li>- Risk Level</li>
                            <li>- Main Risk Drivers</li>
                            <li>- Recommended Action</li>
                            <li>- Model Version</li>
                            <li>- Last Evaluated</li>
                          </ul>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>

                <Card className="border-border/70 bg-muted/20">
                  <CardContent className="p-4">
                    <p className="text-sm font-semibold">Acceptance Criteria Coverage</p>
                    <div className="mt-2 grid gap-2 sm:grid-cols-2 text-xs">
                      <CriteriaItem text="Model updates are versioned on every formula/config save." />
                      <CriteriaItem text="Published models are locked from direct mutation (save creates new draft version)." />
                      <CriteriaItem text="Publish and roll back actions are available in list, editor, and governance." />
                      <CriteriaItem text="Test harness runs reproducible evaluations with versioned formula snapshot." />
                      <CriteriaItem text="SHAP-like attribution ranks contributions with explainability summary." />
                      <CriteriaItem text="Audit log captures key model lifecycle and governance events." />
                      <CriteriaItem text="Role-based permission matrix controls model capabilities." />
                      <CriteriaItem text="Risk score usage mapped across load, tracking, pricing, and analytics workflows." />
                    </div>
                  </CardContent>
                </Card>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

function Field({
  label,
  required,
  hint,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label>
        {label}
        {required ? <span className="ml-1 text-destructive">*</span> : null}
      </Label>
      {children}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function MetricCard({
  label,
  value,
  subtitle,
  tone,
  icon,
}: {
  label: string;
  value: string;
  subtitle: string;
  tone: "default" | "success" | "warning" | "info";
  icon: React.ReactNode;
}) {
  const toneClass =
    tone === "success"
      ? "bg-success/15 text-success border-success/30"
      : tone === "warning"
        ? "bg-warning/20 text-warning-foreground border-warning/30"
        : tone === "info"
          ? "bg-info/15 text-info border-info/30"
          : "bg-muted text-foreground border-border";

  return (
    <Card className="border-border/70 shadow-sm">
      <CardContent className="p-4">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
          <span className={cn("rounded-md border px-2 py-1 text-xs", toneClass)}>{icon}</span>
        </div>
        <p className="mt-2 text-2xl font-semibold tracking-tight">{value}</p>
        <p className="mt-1 text-xs text-muted-foreground">{subtitle}</p>
      </CardContent>
    </Card>
  );
}

function GovernanceStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border/70 p-3">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-sm font-medium">{value || "-"}</p>
    </div>
  );
}

function CriteriaItem({ text }: { text: string }) {
  return (
    <div className="flex items-start gap-2 rounded-md border border-border/60 bg-background px-2.5 py-2">
      <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 text-success" />
      <p>{text}</p>
    </div>
  );
}
