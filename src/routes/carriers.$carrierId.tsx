import * as React from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { AlertTriangle, ArrowLeft, Loader2, Save, ShieldAlert, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { usePageReady } from "@/components/page-load-gate";
import { CarrierActionsMenu } from "@/components/carriers/carrier-actions-menu";
import {
  carrierDraftToRecord,
  recordToCarrierDraft,
  type CarrierDraft,
} from "@/components/carriers/create-carrier-dialog";
import { getCarrierByIdCached, updateCarrier, evaluateAutoAwardEligibility, type CarrierRecord } from "@/lib/carriers-store";
import { TIER_LABELS, toneBadge, formatDate } from "@/lib/carriers-display";
import { useProfileSection } from "@/hooks/use-profile-section";

export const Route = createFileRoute("/carriers/$carrierId")({
  head: ({ params }) => ({
    meta: [
      { title: `${params.carrierId} — Edit carrier` },
      { name: "description", content: "View and edit carrier details." },
    ],
  }),
  component: CarrierDetailPage,
});

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-border/60 bg-card/35 p-4 shadow-sm sm:p-5">
      <div className="mb-3 border-b border-border/50 pb-3">
        <h2 className="text-sm font-semibold tracking-tight text-foreground">{title}</h2>
        {hint && <p className="text-xs leading-snug text-muted-foreground">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

function Field({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <Label className="mb-1.5 block text-xs font-medium text-foreground">{label}</Label>
      {children}
    </div>
  );
}

function CarrierDetailPage() {
  const { carrierId } = Route.useParams();
  const [baseline, setBaseline] = React.useState<CarrierRecord | null>(null);
  const [draft, setDraft] = React.useState<CarrierDraft | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  usePageReady(loading);

  const permissions = useProfileSection<{ role?: string }>("permissions", {});
  const role = permissions.data.role;

  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getCarrierByIdCached(carrierId)
      .then((record) => {
        if (cancelled) return;
        if (!record) {
          setError(`Carrier ${carrierId} not found`);
          return;
        }
        setBaseline(record);
        setDraft(recordToCarrierDraft(record));
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load carrier.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [carrierId]);

  const update = React.useCallback(<K extends keyof CarrierDraft>(key: K, value: CarrierDraft[K]) => {
    setDraft((d) => (d ? { ...d, [key]: value } : d));
  }, []);

  const dirty = React.useMemo(() => {
    if (!baseline || !draft) return false;
    return JSON.stringify(recordToCarrierDraft(baseline)) !== JSON.stringify(draft);
  }, [baseline, draft]);

  const handleSave = async () => {
    if (!baseline || !draft) return;
    setSaving(true);
    setError(null);
    try {
      const record = carrierDraftToRecord(draft, baseline);
      const saved = await updateCarrier(record);
      setBaseline(saved);
      setDraft(recordToCarrierDraft(saved));
      toast.success("Carrier saved");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to save carrier.";
      setError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return null;
  }

  if (error && !baseline) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 px-6 py-24 text-center">
        <ShieldAlert className="h-8 w-8 text-destructive" />
        <div className="text-sm font-medium text-foreground">{error}</div>
        <Button asChild variant="outline" size="sm">
          <Link to="/carriers">
            <ArrowLeft className="h-4 w-4" /> Back to carriers
          </Link>
        </Button>
      </div>
    );
  }

  if (!baseline || !draft) return null;

  const tier = TIER_LABELS[baseline.tier];
  const eligibility = evaluateAutoAwardEligibility(baseline);

  return (
    <div className="pb-16">
      <div className="flex flex-col gap-3 border-b border-border px-4 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
        <div className="flex min-w-0 items-center gap-3">
          <Button asChild variant="ghost" size="icon" className="h-8 w-8 shrink-0">
            <Link to="/carriers">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="truncate text-xl font-semibold tracking-tight text-foreground">
                {baseline.companyName}
              </h1>
              <Badge variant="outline" className={toneBadge[tier.tone]}>
                {tier.label}
              </Badge>
              {baseline.blacklisted && (
                <Badge variant="outline" className={toneBadge.destructive}>
                  Blacklisted
                </Badge>
              )}
            </div>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {baseline.carrierId} · {baseline.carrierKind === "broker" ? "Broker" : "Carrier"}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              <Link
                to="/loads"
                className="text-primary underline-offset-2 hover:underline"
              >
                Related loads
              </Link>
              {" · "}
              <Link to="/crm" className="text-primary underline-offset-2 hover:underline">
                CRM accounts
              </Link>
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <CarrierActionsMenu
            carrier={baseline}
            role={role}
            onChanged={(updated) => {
              setBaseline(updated);
              setDraft(recordToCarrierDraft(updated));
            }}
          />
          <Button variant="ghost" size="sm" asChild>
            <Link to="/carriers">
              <X className="h-4 w-4" /> Discard
            </Link>
          </Button>
          <Button size="sm" disabled={!dirty || saving} onClick={() => void handleSave()} className="gap-1.5">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Save changes
          </Button>
        </div>
      </div>

      <div className="px-4 py-6 sm:px-6 lg:px-8">
        <div
          className={`mb-6 flex items-start gap-3 rounded-lg border px-4 py-3 text-sm ${
            eligibility.eligible
              ? "border-success/30 bg-success/8 text-success"
              : "border-destructive/30 bg-destructive/8 text-destructive"
          }`}
        >
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <div className="font-semibold">
              {eligibility.eligible ? "Eligible for auto-award" : "Auto-award blocked"}
            </div>
            <div className="mt-0.5 text-xs opacity-90">
              {eligibility.reason ??
                "Insurance is current and the carrier is not blacklisted."}
            </div>
          </div>
        </div>

        {error && (
          <div className="mb-6 flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/8 px-4 py-3 text-sm text-destructive">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            {error}
          </div>
        )}

        <div className="grid gap-4 lg:grid-cols-2">
          <Section title="Company profile">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Company Name">
                <Input value={draft.companyName} onChange={(e) => update("companyName", e.target.value)} />
              </Field>
              <Field label="MC Number">
                <Input value={draft.mcNumber} onChange={(e) => update("mcNumber", e.target.value)} />
              </Field>
              <Field label="DOT Number">
                <Input value={draft.dotNumber} onChange={(e) => update("dotNumber", e.target.value)} />
              </Field>
              <Field label="SCAC Code">
                <Input value={draft.scacCode} onChange={(e) => update("scacCode", e.target.value)} />
              </Field>
              <Field label="HQ City">
                <Input value={draft.hqCity} onChange={(e) => update("hqCity", e.target.value)} />
              </Field>
              <Field label="HQ State">
                <Input value={draft.hqState} onChange={(e) => update("hqState", e.target.value)} />
              </Field>
            </div>
            <Field label="Internal Notes" className="mt-4">
              <Textarea value={draft.internalNotes} onChange={(e) => update("internalNotes", e.target.value)} rows={3} />
            </Field>
          </Section>

          <Section
            title="Insurance & compliance"
            hint="Expiry blocks auto-award unless a Manager grants an override"
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Provider">
                <Input value={draft.insuranceProvider} onChange={(e) => update("insuranceProvider", e.target.value)} />
              </Field>
              <Field label="Policy Number">
                <Input
                  value={draft.insurancePolicyNumber}
                  onChange={(e) => update("insurancePolicyNumber", e.target.value)}
                />
              </Field>
              <Field label="Insurance Expires">
                <Input
                  type="date"
                  value={draft.insuranceExpiresAt}
                  onChange={(e) => update("insuranceExpiresAt", e.target.value)}
                />
              </Field>
              <Field label="Safety Rating">
                <Input value={draft.safetyRating} onChange={(e) => update("safetyRating", e.target.value)} />
              </Field>
            </div>
            <div className="mt-4 flex items-center justify-between rounded-lg border border-input bg-card px-3 py-2.5">
              <span className="text-sm text-muted-foreground">W-9 on file</span>
              <Switch checked={draft.w9OnFile} onCheckedChange={(v) => update("w9OnFile", v)} />
            </div>
            {baseline.autoAwardOverrideBy && (
              <div className="mt-3 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning-foreground">
                Override granted by {baseline.autoAwardOverrideBy} on {formatDate(baseline.autoAwardOverrideAt)}
                {baseline.autoAwardOverrideReason ? ` — ${baseline.autoAwardOverrideReason}` : ""}
              </div>
            )}
          </Section>

          <Section title="Equipment & lanes">
            <Field label="Equipment Types (comma separated)">
              <Input
                value={draft.equipmentTypes.join(", ")}
                onChange={(e) =>
                  update(
                    "equipmentTypes",
                    e.target.value
                      .split(",")
                      .map((v) => v.trim())
                      .filter(Boolean),
                  )
                }
              />
            </Field>
            <Field label="Lanes Served (comma separated)" className="mt-4">
              <Input
                value={draft.lanesServed.join(", ")}
                onChange={(e) =>
                  update(
                    "lanesServed",
                    e.target.value
                      .split(",")
                      .map((v) => v.trim())
                      .filter(Boolean),
                  )
                }
              />
            </Field>
            <Field label="Fleet Size" className="mt-4">
              <Input value={draft.fleetSize} onChange={(e) => update("fleetSize", e.target.value)} />
            </Field>
          </Section>

          <Section title="Score">
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="OTD %">
                <Input value={draft.otdPercentage} onChange={(e) => update("otdPercentage", e.target.value)} />
              </Field>
              <Field label="Claims Count">
                <Input value={draft.claimsCount} onChange={(e) => update("claimsCount", e.target.value)} />
              </Field>
              <Field label="Claims Rate %">
                <Input
                  value={draft.claimsRatePercentage}
                  onChange={(e) => update("claimsRatePercentage", e.target.value)}
                />
              </Field>
            </div>
            <Field label="Score Notes" className="mt-4">
              <Textarea value={draft.scoreNotes} onChange={(e) => update("scoreNotes", e.target.value)} rows={3} />
            </Field>
          </Section>
        </div>
      </div>
    </div>
  );
}
