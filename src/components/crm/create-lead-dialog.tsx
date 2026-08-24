import * as React from "react";
import { AlertTriangle, CheckCircle2, Loader2, TrendingUp } from "lucide-react";

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
import { FancySelect, type FancySelectOption } from "@/components/loads/fancy-select";
import { useAuth } from "@/lib/auth";
import {
  CRM_LEAD_STAGES,
  createCrmLead,
  type CrmAccountRecord,
  type CrmContactRecord,
  type CrmLeadStage,
} from "@/lib/crm-store";
import { Card, FieldShell, GridSection, SectionTitle, generateCrmId } from "./crm-shared";
import { t } from "@/lib/i18n/t";

const STAGE_OPTIONS: FancySelectOption[] = CRM_LEAD_STAGES.map((s) => ({ value: s, label: s }));

export function CreateLeadDialog({
  trigger,
  open: controlledOpen,
  onOpenChange,
  onCreated,
  accounts,
  contacts,
  defaultStage,
}: {
  trigger?: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onCreated?: () => void;
  accounts: CrmAccountRecord[];
  contacts: CrmContactRecord[];
  defaultStage?: CrmLeadStage;
}) {
  const { user } = useAuth();
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(false);
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : uncontrolledOpen;
  const setOpen = (next: boolean) =>
    isControlled ? onOpenChange?.(next) : setUncontrolledOpen(next);

  const [title, setTitle] = React.useState("");
  const [stage, setStage] = React.useState<CrmLeadStage>(defaultStage ?? "Prospect");
  const [accountId, setAccountId] = React.useState("");
  const [contactId, setContactId] = React.useState("");
  const [origin, setOrigin] = React.useState("");
  const [destination, setDestination] = React.useState("");
  const [equipmentType, setEquipmentType] = React.useState("");
  const [quotedRate, setQuotedRate] = React.useState("");
  const [estimatedCost, setEstimatedCost] = React.useState("");
  const [marginFloorPct, setMarginFloorPct] = React.useState("15");
  const [probabilityPct, setProbabilityPct] = React.useState("50");
  const [notes, setNotes] = React.useState("");
  const [touched, setTouched] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [submitError, setSubmitError] = React.useState<string | null>(null);

  const reset = React.useCallback(() => {
    setTitle("");
    setStage(defaultStage ?? "Prospect");
    setAccountId("");
    setContactId("");
    setOrigin("");
    setDestination("");
    setEquipmentType("");
    setQuotedRate("");
    setEstimatedCost("");
    setMarginFloorPct("15");
    setProbabilityPct("50");
    setNotes("");
    setTouched(false);
    setSubmitError(null);
  }, [defaultStage]);

  React.useEffect(() => {
    if (!open) {
      const t = setTimeout(reset, 200);
      return () => clearTimeout(t);
    }
  }, [open, reset]);

  const accountOptions: FancySelectOption[] = accounts.map((a) => ({
    value: a.accountId,
    label: a.name,
  }));
  const contactOptions: FancySelectOption[] = contacts
    .filter((c) => !accountId || c.accountId === accountId)
    .map((c) => ({ value: c.contactId, label: `${c.firstName} ${c.lastName}` }));

  const hasError = touched && !title.trim();

  const handleSubmit = async () => {
    setTouched(true);
    if (!title.trim()) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      await createCrmLead({
        leadId: generateCrmId("LEAD"),
        title: title.trim(),
        stage,
        accountId: accountId || undefined,
        contactId: contactId || undefined,
        origin: origin || undefined,
        destination: destination || undefined,
        equipmentType: equipmentType || undefined,
        quotedRate: quotedRate ? Number(quotedRate) : undefined,
        estimatedCost: estimatedCost ? Number(estimatedCost) : undefined,
        marginFloorPct: marginFloorPct ? Number(marginFloorPct) : undefined,
        probabilityPct: probabilityPct ? Number(probabilityPct) : undefined,
        source: "manual",
        notes: notes || undefined,
        createdBy: user?.userId,
      });
      onCreated?.();
      setOpen(false);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Failed to save lead to DynamoDB.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {trigger ? <DialogTrigger asChild>{trigger}</DialogTrigger> : null}
      <DialogContent className="!max-w-2xl w-[94vw] gap-0 overflow-hidden border-border/70 p-0 sm:rounded-2xl">
        <DialogTitle className="sr-only">{t("Add Lead")}</DialogTitle>
        <DialogDescription className="sr-only">
          {t("Create a pipeline opportunity.")}
        </DialogDescription>
        <div className="border-b border-border/70 px-6 py-4">
          <h2 className="text-lg font-semibold tracking-tight text-foreground">{t("Add Lead")}</h2>
        </div>
        <div className="max-h-[70vh] overflow-y-auto px-6 py-5">
          <Card>
            <SectionTitle title={t("Opportunity")} icon={TrendingUp} />
            <GridSection cols={2}>
              <FieldShell label={t("Title")} required error={hasError}>
                <Input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder={t("Acme — weekly DFW to ATL lane")}
                  className={cn(hasError && "border-destructive/60")}
                />
              </FieldShell>
              <FieldShell label={t("Stage")}>
                <FancySelect
                  value={stage}
                  onChange={(v) => setStage(v as CrmLeadStage)}
                  options={STAGE_OPTIONS}
                  searchable={false}
                />
              </FieldShell>
            </GridSection>
            <GridSection cols={2} className="mt-4">
              <FieldShell label={t("Account")} hint={t("Optional")}>
                <FancySelect
                  value={accountId}
                  onChange={setAccountId}
                  options={accountOptions}
                  placeholder={t("Link account")}
                  emptyMessage={t("No accounts yet")}
                />
              </FieldShell>
              <FieldShell label={t("Contact")} hint={t("Optional")}>
                <FancySelect
                  value={contactId}
                  onChange={setContactId}
                  options={contactOptions}
                  placeholder={t("Link contact")}
                  emptyMessage={t("No contacts yet")}
                />
              </FieldShell>
            </GridSection>
            <GridSection cols={3} className="mt-4">
              <FieldShell label={t("Origin")}>
                <Input
                  value={origin}
                  onChange={(e) => setOrigin(e.target.value)}
                  placeholder={t("Dallas, TX")}
                />
              </FieldShell>
              <FieldShell label={t("Destination")}>
                <Input
                  value={destination}
                  onChange={(e) => setDestination(e.target.value)}
                  placeholder={t("Atlanta, GA")}
                />
              </FieldShell>
              <FieldShell label={t("Equipment")}>
                <Input
                  value={equipmentType}
                  onChange={(e) => setEquipmentType(e.target.value)}
                  placeholder={t("Dry Van")}
                />
              </FieldShell>
            </GridSection>
            <GridSection cols={4} className="mt-4">
              <FieldShell label={t("Quoted Rate ($)")}>
                <Input
                  type="number"
                  value={quotedRate}
                  onChange={(e) => setQuotedRate(e.target.value)}
                  placeholder="1850"
                />
              </FieldShell>
              <FieldShell label={t("Est. Cost ($)")}>
                <Input
                  type="number"
                  value={estimatedCost}
                  onChange={(e) => setEstimatedCost(e.target.value)}
                  placeholder="1500"
                />
              </FieldShell>
              <FieldShell label={t("Margin Floor %")} hint={t("Guardrail")}>
                <Input
                  type="number"
                  value={marginFloorPct}
                  onChange={(e) => setMarginFloorPct(e.target.value)}
                />
              </FieldShell>
              <FieldShell label={t("Win Probability %")}>
                <Input
                  type="number"
                  value={probabilityPct}
                  onChange={(e) => setProbabilityPct(e.target.value)}
                />
              </FieldShell>
            </GridSection>
            <div className="mt-4">
              <FieldShell label={t("Notes")}>
                <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
              </FieldShell>
            </div>
          </Card>
        </div>
        <div className="flex items-center justify-between gap-3 border-t border-border/70 bg-muted/30 px-6 py-3">
          <div className="min-w-0 text-xs text-muted-foreground">
            {submitError && (
              <span className="inline-flex items-center gap-1 text-destructive">
                <AlertTriangle className="h-3 w-3 shrink-0" />
                {submitError}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
              {t("Cancel")}
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={submitting}
              onClick={handleSubmit}
              className="gap-1.5"
            >
              {submitting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <CheckCircle2 className="h-4 w-4" />
              )}
              Save Lead
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
