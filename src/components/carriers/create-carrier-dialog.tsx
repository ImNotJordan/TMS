import * as React from "react";
import {
  AlertTriangle,
  Award,
  Building2,
  CheckCircle2,
  FileText,
  Loader2,
  MapPin,
  Phone,
  Plus,
  Route as RouteIcon,
  ShieldCheck,
  Trash2,
  Truck,
  X,
} from "lucide-react";

import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FancySelect, type FancySelectOption } from "@/components/loads/fancy-select";
import { EQUIPMENT_TYPE_LABELS, EQUIPMENT_TYPE_OPTIONS } from "@/lib/carriers-display";
import {
  createCarrier,
  type CarrierContact,
  type CarrierKind,
  type CarrierRecord,
  type CreateCarrierInput,
} from "@/lib/carriers-store";
import { useAuth } from "@/lib/auth";

export type CarrierDraft = {
  companyName: string;
  carrierKind: CarrierKind;
  mcNumber: string;
  dotNumber: string;
  scacCode: string;
  website: string;
  hqCity: string;
  hqState: string;
  internalNotes: string;

  insuranceProvider: string;
  insurancePolicyNumber: string;
  insuranceCargoAmount: string;
  insuranceLiabilityAmount: string;
  insuranceExpiresAt: string;
  w9OnFile: boolean;
  w9ReceivedAt: string;
  authorityStatus: string;
  safetyRating: string;

  equipmentTypes: string[];
  fleetSize: string;

  lanesServed: string[];
  preferredRegions: string[];

  otdPercentage: string;
  claimsCount: string;
  claimsRatePercentage: string;
  scoreNotes: string;

  contacts: CarrierContact[];
};

const INITIAL: CarrierDraft = {
  companyName: "",
  carrierKind: "carrier",
  mcNumber: "",
  dotNumber: "",
  scacCode: "",
  website: "",
  hqCity: "",
  hqState: "",
  internalNotes: "",
  insuranceProvider: "",
  insurancePolicyNumber: "",
  insuranceCargoAmount: "",
  insuranceLiabilityAmount: "",
  insuranceExpiresAt: "",
  w9OnFile: false,
  w9ReceivedAt: "",
  authorityStatus: "active",
  safetyRating: "unrated",
  equipmentTypes: [],
  fleetSize: "",
  lanesServed: [],
  preferredRegions: [],
  otdPercentage: "",
  claimsCount: "",
  claimsRatePercentage: "",
  scoreNotes: "",
  contacts: [],
};

const CARRIER_KIND_OPTIONS: FancySelectOption[] = [
  { value: "carrier", label: "Carrier", description: "Operates its own trucks", icon: Truck },
  { value: "broker", label: "Broker", description: "Arranges freight via other carriers", icon: Building2 },
];

const AUTHORITY_STATUS_OPTIONS: FancySelectOption[] = [
  { value: "active", label: "Active", description: "In good standing", icon: ShieldCheck },
  { value: "pending", label: "Pending", description: "Application in progress" },
  { value: "inactive", label: "Inactive", description: "Authority has lapsed" },
  { value: "revoked", label: "Revoked", description: "Authority revoked", badge: "Block" },
];

const SAFETY_RATING_OPTIONS: FancySelectOption[] = [
  { value: "satisfactory", label: "Satisfactory", badge: "Good" },
  { value: "conditional", label: "Conditional", badge: "Watch" },
  { value: "unrated", label: "Unrated" },
  { value: "unsatisfactory", label: "Unsatisfactory", badge: "Block" },
];

const EQUIPMENT_OPTIONS: FancySelectOption[] = EQUIPMENT_TYPE_OPTIONS.map((value) => ({
  value,
  label: EQUIPMENT_TYPE_LABELS[value],
  icon: Truck,
}));

function generateCarrierId() {
  const n = Math.floor(1000 + Math.random() * 8999);
  return `CAR-${n}`;
}

function newContactId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID().slice(0, 8);
  }
  return Math.random().toString(36).slice(2, 10);
}

export function computeCarrierErrors(draft: CarrierDraft): string[] {
  const errors: string[] = [];
  if (!draft.companyName.trim()) errors.push("companyName");
  if (!draft.carrierKind) errors.push("carrierKind");
  return errors;
}

export function carrierDraftToInput(
  draft: CarrierDraft,
  carrierId: string,
  createdBy?: string,
): CreateCarrierInput {
  return {
    carrierId,
    createdBy,
    companyName: draft.companyName.trim(),
    carrierKind: draft.carrierKind,
    mcNumber: draft.mcNumber || undefined,
    dotNumber: draft.dotNumber || undefined,
    scacCode: draft.scacCode || undefined,
    website: draft.website || undefined,
    hqCity: draft.hqCity || undefined,
    hqState: draft.hqState || undefined,
    internalNotes: draft.internalNotes || undefined,
    insuranceProvider: draft.insuranceProvider || undefined,
    insurancePolicyNumber: draft.insurancePolicyNumber || undefined,
    insuranceCargoAmount: draft.insuranceCargoAmount || undefined,
    insuranceLiabilityAmount: draft.insuranceLiabilityAmount || undefined,
    insuranceExpiresAt: draft.insuranceExpiresAt || undefined,
    insuranceVerified: false,
    w9OnFile: draft.w9OnFile,
    w9ReceivedAt: draft.w9ReceivedAt || undefined,
    authorityStatus: draft.authorityStatus || undefined,
    safetyRating: draft.safetyRating || undefined,
    documents: [],
    equipmentTypes: draft.equipmentTypes,
    fleetSize: draft.fleetSize || undefined,
    lanesServed: draft.lanesServed,
    preferredRegions: draft.preferredRegions,
    otdPercentage: draft.otdPercentage || undefined,
    claimsCount: draft.claimsCount || undefined,
    claimsRatePercentage: draft.claimsRatePercentage || undefined,
    scoreNotes: draft.scoreNotes || undefined,
    contacts: draft.contacts,
    tier: "none",
    blacklisted: false,
    portalInviteStatus: "not-invited",
  };
}

export function recordToCarrierDraft(r: CarrierRecord): CarrierDraft {
  return {
    companyName: r.companyName ?? "",
    carrierKind: r.carrierKind ?? "carrier",
    mcNumber: r.mcNumber ?? "",
    dotNumber: r.dotNumber ?? "",
    scacCode: r.scacCode ?? "",
    website: r.website ?? "",
    hqCity: r.hqCity ?? "",
    hqState: r.hqState ?? "",
    internalNotes: r.internalNotes ?? "",
    insuranceProvider: r.insuranceProvider ?? "",
    insurancePolicyNumber: r.insurancePolicyNumber ?? "",
    insuranceCargoAmount: r.insuranceCargoAmount ?? "",
    insuranceLiabilityAmount: r.insuranceLiabilityAmount ?? "",
    insuranceExpiresAt: r.insuranceExpiresAt ?? "",
    w9OnFile: r.w9OnFile ?? false,
    w9ReceivedAt: r.w9ReceivedAt ?? "",
    authorityStatus: r.authorityStatus ?? "active",
    safetyRating: r.safetyRating ?? "unrated",
    equipmentTypes: r.equipmentTypes ? [...r.equipmentTypes] : [],
    fleetSize: r.fleetSize ?? "",
    lanesServed: r.lanesServed ? [...r.lanesServed] : [],
    preferredRegions: r.preferredRegions ? [...r.preferredRegions] : [],
    otdPercentage: r.otdPercentage ?? "",
    claimsCount: r.claimsCount ?? "",
    claimsRatePercentage: r.claimsRatePercentage ?? "",
    scoreNotes: r.scoreNotes ?? "",
    contacts: r.contacts ? [...r.contacts] : [],
  };
}

export function carrierDraftToRecord(draft: CarrierDraft, existing: CarrierRecord): CarrierRecord {
  return {
    ...existing,
    companyName: draft.companyName.trim(),
    carrierKind: draft.carrierKind,
    mcNumber: draft.mcNumber || undefined,
    dotNumber: draft.dotNumber || undefined,
    scacCode: draft.scacCode || undefined,
    website: draft.website || undefined,
    hqCity: draft.hqCity || undefined,
    hqState: draft.hqState || undefined,
    internalNotes: draft.internalNotes || undefined,
    insuranceProvider: draft.insuranceProvider || undefined,
    insurancePolicyNumber: draft.insurancePolicyNumber || undefined,
    insuranceCargoAmount: draft.insuranceCargoAmount || undefined,
    insuranceLiabilityAmount: draft.insuranceLiabilityAmount || undefined,
    insuranceExpiresAt: draft.insuranceExpiresAt || undefined,
    w9OnFile: draft.w9OnFile,
    w9ReceivedAt: draft.w9ReceivedAt || undefined,
    authorityStatus: draft.authorityStatus || undefined,
    safetyRating: draft.safetyRating || undefined,
    equipmentTypes: draft.equipmentTypes,
    fleetSize: draft.fleetSize || undefined,
    lanesServed: draft.lanesServed,
    preferredRegions: draft.preferredRegions,
    otdPercentage: draft.otdPercentage || undefined,
    claimsCount: draft.claimsCount || undefined,
    claimsRatePercentage: draft.claimsRatePercentage || undefined,
    scoreNotes: draft.scoreNotes || undefined,
    contacts: draft.contacts,
  };
}

// ---------- Shared building blocks ----------

function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("rounded-xl border border-border/70 bg-card/60 p-5 shadow-sm", className)}>
      {children}
    </div>
  );
}

function SectionTitle({
  title,
  hint,
  icon: Icon,
}: {
  title: string;
  hint?: string;
  icon?: React.ComponentType<{ className?: string }>;
}) {
  return (
    <div className="mb-3 flex items-center gap-2">
      {Icon && (
        <span className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/10 text-primary">
          <Icon className="h-3.5 w-3.5" />
        </span>
      )}
      <div className="min-w-0">
        <div className="text-sm font-semibold tracking-tight text-foreground">{title}</div>
        {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
      </div>
    </div>
  );
}

function FieldShell({
  label,
  required,
  hint,
  error,
  children,
  className,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  error?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <div className="flex items-center justify-between gap-2">
        <Label className="text-xs font-medium text-foreground">
          {label}
          {required && <span className="ml-1 text-destructive">*</span>}
        </Label>
        {hint && <span className="text-[10px] text-muted-foreground">{hint}</span>}
      </div>
      {children}
      {error && <div className="text-[11px] font-medium text-destructive">This field is required.</div>}
    </div>
  );
}

function GridSection({
  cols = 2,
  children,
  className,
}: {
  cols?: 1 | 2 | 3 | 4;
  children: React.ReactNode;
  className?: string;
}) {
  const map = {
    1: "grid-cols-1",
    2: "sm:grid-cols-2",
    3: "sm:grid-cols-2 lg:grid-cols-3",
    4: "sm:grid-cols-2 lg:grid-cols-4",
  };
  return <div className={cn("grid gap-4", map[cols], className)}>{children}</div>;
}

function ChipList({
  items,
  onRemove,
  emptyLabel,
}: {
  items: string[];
  onRemove: (index: number) => void;
  emptyLabel: string;
}) {
  if (items.length === 0) {
    return <div className="text-xs text-muted-foreground">{emptyLabel}</div>;
  }
  return (
    <div className="flex flex-wrap gap-2">
      {items.map((item, i) => (
        <Badge key={`${item}-${i}`} variant="secondary" className="gap-1 py-1 pl-2.5 pr-1.5">
          {item}
          <button
            type="button"
            onClick={() => onRemove(i)}
            className="rounded-full p-0.5 hover:bg-muted-foreground/20"
            aria-label={`Remove ${item}`}
          >
            <X className="h-3 w-3" />
          </button>
        </Badge>
      ))}
    </div>
  );
}

function AddTextRow({
  placeholder,
  onAdd,
}: {
  placeholder: string;
  onAdd: (value: string) => void;
}) {
  const [value, setValue] = React.useState("");
  const submit = () => {
    const trimmed = value.trim();
    if (!trimmed) return;
    onAdd(trimmed);
    setValue("");
  };
  return (
    <div className="flex gap-2">
      <Input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholder}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            submit();
          }
        }}
      />
      <Button type="button" variant="outline" size="icon" onClick={submit} aria-label="Add">
        <Plus className="h-4 w-4" />
      </Button>
    </div>
  );
}

// ---------- Dialog ----------

export function CreateCarrierDialog({
  trigger,
  onCreated,
  open: controlledOpen,
  onOpenChange,
}: {
  trigger?: React.ReactNode;
  onCreated?: (carrierId: string) => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const { user } = useAuth();
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(false);
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : uncontrolledOpen;

  const setOpen = React.useCallback(
    (next: boolean) => {
      if (isControlled) onOpenChange?.(next);
      else setUncontrolledOpen(next);
    },
    [isControlled, onOpenChange],
  );

  const [carrierId, setCarrierId] = React.useState(() => generateCarrierId());
  const [draft, setDraft] = React.useState<CarrierDraft>(() => ({ ...INITIAL }));
  const [touched, setTouched] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [submitError, setSubmitError] = React.useState<string | null>(null);
  const [tab, setTab] = React.useState("profile");

  const reset = React.useCallback(() => {
    setCarrierId(generateCarrierId());
    setDraft({ ...INITIAL });
    setTouched(false);
    setSubmitError(null);
    setTab("profile");
  }, []);

  React.useEffect(() => {
    if (!open) {
      const t = setTimeout(reset, 200);
      return () => clearTimeout(t);
    }
  }, [open, reset]);

  const update = React.useCallback(<K extends keyof CarrierDraft>(key: K, value: CarrierDraft[K]) => {
    setDraft((d) => ({ ...d, [key]: value }));
  }, []);

  const errors = React.useMemo(() => computeCarrierErrors(draft), [draft]);

  const handleSubmit = async () => {
    setTouched(true);
    if (errors.length > 0) {
      setTab("profile");
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    try {
      const input = carrierDraftToInput(draft, carrierId, user?.userId);
      const created = await createCarrier(input);
      onCreated?.(created.carrierId);
      setOpen(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to save carrier to DynamoDB.";
      setSubmitError(message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {trigger ? <DialogTrigger asChild>{trigger}</DialogTrigger> : null}
      <DialogContent className="!max-w-4xl w-[96vw] gap-0 overflow-hidden border-border/70 p-0 sm:rounded-2xl">
        <DialogTitle className="sr-only">Add Carrier / Broker</DialogTitle>
        <DialogDescription className="sr-only">
          Create a carrier or broker profile with docs, equipment, lanes, score, and contacts.
        </DialogDescription>
        <div className="flex items-center justify-between border-b border-border/70 px-6 py-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="inline-flex h-5 items-center rounded-full bg-primary/10 px-2 font-semibold text-primary">
                {carrierId}
              </span>
            </div>
            <h2 className="mt-0.5 text-lg font-semibold tracking-tight text-foreground">
              Add Carrier / Broker
            </h2>
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="max-h-[75vh] overflow-y-auto px-6 py-6">
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList className="grid w-full grid-cols-5">
              <TabsTrigger value="profile">Profile</TabsTrigger>
              <TabsTrigger value="docs">Docs</TabsTrigger>
              <TabsTrigger value="equipment">Equipment & Lanes</TabsTrigger>
              <TabsTrigger value="score">Score</TabsTrigger>
              <TabsTrigger value="contacts">Contacts</TabsTrigger>
            </TabsList>

            <TabsContent value="profile" className="space-y-4">
              <Card>
                <SectionTitle title="Company profile" icon={Building2} />
                <GridSection cols={2}>
                  <FieldShell
                    label="Company Name"
                    required
                    error={touched && errors.includes("companyName")}
                  >
                    <Input
                      value={draft.companyName}
                      onChange={(e) => update("companyName", e.target.value)}
                      placeholder="Bluepeak Freight"
                      className={cn(
                        touched && errors.includes("companyName") && "border-destructive/60",
                      )}
                    />
                  </FieldShell>
                  <FieldShell label="Type" required>
                    <FancySelect
                      value={draft.carrierKind}
                      onChange={(v) => update("carrierKind", v as CarrierKind)}
                      options={CARRIER_KIND_OPTIONS}
                      triggerIcon={Building2}
                    />
                  </FieldShell>
                </GridSection>
                <GridSection cols={3} className="mt-4">
                  <FieldShell label="MC Number">
                    <Input value={draft.mcNumber} onChange={(e) => update("mcNumber", e.target.value)} placeholder="MC-123456" />
                  </FieldShell>
                  <FieldShell label="DOT Number">
                    <Input value={draft.dotNumber} onChange={(e) => update("dotNumber", e.target.value)} placeholder="DOT-7654321" />
                  </FieldShell>
                  <FieldShell label="SCAC Code">
                    <Input value={draft.scacCode} onChange={(e) => update("scacCode", e.target.value)} placeholder="BLPK" />
                  </FieldShell>
                </GridSection>
                <GridSection cols={3} className="mt-4">
                  <FieldShell label="HQ City">
                    <Input value={draft.hqCity} onChange={(e) => update("hqCity", e.target.value)} placeholder="Dallas" />
                  </FieldShell>
                  <FieldShell label="HQ State">
                    <Input value={draft.hqState} onChange={(e) => update("hqState", e.target.value)} placeholder="TX" />
                  </FieldShell>
                  <FieldShell label="Website">
                    <Input value={draft.website} onChange={(e) => update("website", e.target.value)} placeholder="https://" />
                  </FieldShell>
                </GridSection>
                <div className="mt-4">
                  <FieldShell label="Internal Notes" hint="Not visible to the carrier">
                    <Textarea
                      value={draft.internalNotes}
                      onChange={(e) => update("internalNotes", e.target.value)}
                      rows={3}
                    />
                  </FieldShell>
                </div>
              </Card>
            </TabsContent>

            <TabsContent value="docs" className="space-y-4">
              <Card>
                <SectionTitle
                  title="Insurance"
                  hint="Expiry blocks auto-award unless a Manager overrides"
                  icon={ShieldCheck}
                />
                <GridSection cols={2}>
                  <FieldShell label="Provider">
                    <Input
                      value={draft.insuranceProvider}
                      onChange={(e) => update("insuranceProvider", e.target.value)}
                    />
                  </FieldShell>
                  <FieldShell label="Policy Number">
                    <Input
                      value={draft.insurancePolicyNumber}
                      onChange={(e) => update("insurancePolicyNumber", e.target.value)}
                    />
                  </FieldShell>
                  <FieldShell label="Cargo Insurance Amount">
                    <Input
                      value={draft.insuranceCargoAmount}
                      onChange={(e) => update("insuranceCargoAmount", e.target.value)}
                      placeholder="$100,000"
                    />
                  </FieldShell>
                  <FieldShell label="Auto Liability Amount">
                    <Input
                      value={draft.insuranceLiabilityAmount}
                      onChange={(e) => update("insuranceLiabilityAmount", e.target.value)}
                      placeholder="$1,000,000"
                    />
                  </FieldShell>
                  <FieldShell label="Insurance Expires">
                    <Input
                      type="date"
                      value={draft.insuranceExpiresAt}
                      onChange={(e) => update("insuranceExpiresAt", e.target.value)}
                    />
                  </FieldShell>
                </GridSection>
              </Card>

              <Card>
                <SectionTitle title="W-9 & authority" icon={FileText} />
                <div className="flex items-center justify-between rounded-lg border border-input bg-card px-3 py-2.5">
                  <span className="text-sm text-muted-foreground">W-9 on file</span>
                  <Switch checked={draft.w9OnFile} onCheckedChange={(v) => update("w9OnFile", v)} />
                </div>
                <GridSection cols={3} className="mt-4">
                  <FieldShell label="W-9 Received">
                    <Input
                      type="date"
                      value={draft.w9ReceivedAt}
                      onChange={(e) => update("w9ReceivedAt", e.target.value)}
                      disabled={!draft.w9OnFile}
                    />
                  </FieldShell>
                  <FieldShell label="Authority Status">
                    <FancySelect
                      value={draft.authorityStatus}
                      onChange={(v) => update("authorityStatus", v)}
                      options={AUTHORITY_STATUS_OPTIONS}
                    />
                  </FieldShell>
                  <FieldShell label="Safety Rating">
                    <FancySelect
                      value={draft.safetyRating}
                      onChange={(v) => update("safetyRating", v)}
                      options={SAFETY_RATING_OPTIONS}
                    />
                  </FieldShell>
                </GridSection>
              </Card>
            </TabsContent>

            <TabsContent value="equipment" className="space-y-4">
              <Card>
                <SectionTitle title="Equipment" icon={Truck} />
                <FieldShell label="Equipment Types">
                  <div className="flex flex-wrap gap-2">
                    {EQUIPMENT_OPTIONS.map((opt) => {
                      const active = draft.equipmentTypes.includes(opt.value);
                      return (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() =>
                            update(
                              "equipmentTypes",
                              active
                                ? draft.equipmentTypes.filter((v) => v !== opt.value)
                                : [...draft.equipmentTypes, opt.value],
                            )
                          }
                          className={cn(
                            "rounded-lg border px-3 py-1.5 text-xs font-medium transition-all",
                            active
                              ? "border-primary/60 bg-primary/8 text-foreground"
                              : "border-border bg-card text-muted-foreground hover:border-primary/30",
                          )}
                        >
                          {opt.label}
                        </button>
                      );
                    })}
                  </div>
                </FieldShell>
                <div className="mt-4">
                  <FieldShell label="Fleet Size" hint="Approximate power units">
                    <Input
                      value={draft.fleetSize}
                      onChange={(e) => update("fleetSize", e.target.value)}
                      placeholder="25"
                    />
                  </FieldShell>
                </div>
              </Card>

              <Card>
                <SectionTitle title="Lanes served" hint="Common origin → destination pairs" icon={RouteIcon} />
                <ChipList
                  items={draft.lanesServed}
                  onRemove={(i) => update("lanesServed", draft.lanesServed.filter((_, idx) => idx !== i))}
                  emptyLabel="No lanes added yet"
                />
                <div className="mt-3">
                  <AddTextRow
                    placeholder="e.g. Dallas, TX → Atlanta, GA"
                    onAdd={(v) => update("lanesServed", [...draft.lanesServed, v])}
                  />
                </div>
              </Card>

              <Card>
                <SectionTitle title="Preferred regions" icon={MapPin} />
                <ChipList
                  items={draft.preferredRegions}
                  onRemove={(i) =>
                    update("preferredRegions", draft.preferredRegions.filter((_, idx) => idx !== i))
                  }
                  emptyLabel="No regions added yet"
                />
                <div className="mt-3">
                  <AddTextRow
                    placeholder="e.g. Southeast"
                    onAdd={(v) => update("preferredRegions", [...draft.preferredRegions, v])}
                  />
                </div>
              </Card>
            </TabsContent>

            <TabsContent value="score" className="space-y-4">
              <Card>
                <SectionTitle title="Performance score" hint="OTD and claims history" icon={Award} />
                <GridSection cols={3}>
                  <FieldShell label="On-Time Delivery %">
                    <Input
                      value={draft.otdPercentage}
                      onChange={(e) => update("otdPercentage", e.target.value)}
                      placeholder="96"
                    />
                  </FieldShell>
                  <FieldShell label="Claims Count" hint="Trailing 12 months">
                    <Input
                      value={draft.claimsCount}
                      onChange={(e) => update("claimsCount", e.target.value)}
                      placeholder="2"
                    />
                  </FieldShell>
                  <FieldShell label="Claims Rate %">
                    <Input
                      value={draft.claimsRatePercentage}
                      onChange={(e) => update("claimsRatePercentage", e.target.value)}
                      placeholder="0.5"
                    />
                  </FieldShell>
                </GridSection>
                <div className="mt-4">
                  <FieldShell label="Score Notes">
                    <Textarea
                      value={draft.scoreNotes}
                      onChange={(e) => update("scoreNotes", e.target.value)}
                      rows={3}
                    />
                  </FieldShell>
                </div>
              </Card>
            </TabsContent>

            <TabsContent value="contacts" className="space-y-4">
              <Card>
                <SectionTitle title="Contacts" icon={Phone} />
                <div className="space-y-3">
                  {draft.contacts.length === 0 && (
                    <div className="text-xs text-muted-foreground">No contacts added yet.</div>
                  )}
                  {draft.contacts.map((contact, i) => (
                    <div
                      key={contact.id}
                      className="grid gap-2 rounded-lg border border-border/70 p-3 sm:grid-cols-[1fr_1fr_1fr_1fr_auto]"
                    >
                      <Input
                        value={contact.name}
                        onChange={(e) =>
                          update(
                            "contacts",
                            draft.contacts.map((c, idx) =>
                              idx === i ? { ...c, name: e.target.value } : c,
                            ),
                          )
                        }
                        placeholder="Name"
                      />
                      <Input
                        value={contact.role ?? ""}
                        onChange={(e) =>
                          update(
                            "contacts",
                            draft.contacts.map((c, idx) =>
                              idx === i ? { ...c, role: e.target.value } : c,
                            ),
                          )
                        }
                        placeholder="Role"
                      />
                      <Input
                        value={contact.phone ?? ""}
                        onChange={(e) =>
                          update(
                            "contacts",
                            draft.contacts.map((c, idx) =>
                              idx === i ? { ...c, phone: e.target.value } : c,
                            ),
                          )
                        }
                        placeholder="Phone"
                      />
                      <Input
                        value={contact.email ?? ""}
                        onChange={(e) =>
                          update(
                            "contacts",
                            draft.contacts.map((c, idx) =>
                              idx === i ? { ...c, email: e.target.value } : c,
                            ),
                          )
                        }
                        placeholder="Email"
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="text-muted-foreground hover:text-destructive"
                        onClick={() =>
                          update("contacts", draft.contacts.filter((_, idx) => idx !== i))
                        }
                        aria-label="Remove contact"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="gap-1.5"
                    onClick={() =>
                      update("contacts", [
                        ...draft.contacts,
                        { id: newContactId(), name: "", primary: draft.contacts.length === 0 },
                      ])
                    }
                  >
                    <Plus className="h-4 w-4" /> Add contact
                  </Button>
                </div>
              </Card>
            </TabsContent>
          </Tabs>
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-border/70 bg-muted/30 px-6 py-3">
          <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
            {submitError ? (
              <span className="inline-flex items-center gap-1 truncate rounded-md bg-destructive/12 px-2 py-1 font-medium text-destructive">
                <AlertTriangle className="h-3 w-3 shrink-0" />
                <span className="truncate" title={submitError}>
                  {submitError}
                </span>
              </span>
            ) : touched && errors.length > 0 ? (
              <span className="inline-flex items-center gap-1 rounded-md bg-destructive/12 px-2 py-1 font-medium text-destructive">
                <AlertTriangle className="h-3 w-3" />
                Company name is required
              </span>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={submitting}
              onClick={handleSubmit}
              className="bg-gradient-to-r from-primary to-info text-primary-foreground shadow-sm shadow-primary/30 hover:opacity-95"
            >
              {submitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Saving…
                </>
              ) : (
                <>
                  <CheckCircle2 className="h-4 w-4" /> Save Carrier
                </>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
