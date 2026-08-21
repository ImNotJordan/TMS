import * as React from "react";
import { AlertTriangle, Building2, CheckCircle2, Loader2 } from "lucide-react";

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
import { createCrmAccount, type CrmAccountStatus, type CrmAccountType } from "@/lib/crm-store";
import { Card, FieldShell, GridSection, SectionTitle, generateCrmId } from "./crm-shared";
import { t } from "@/lib/i18n/t";

const TYPE_OPTIONS: FancySelectOption[] = [
  { value: "Shipper", label: "Shipper" },
  { value: "Broker", label: "Broker" },
  { value: "Carrier", label: "Carrier" },
  { value: "Other", label: "Other" },
];

const STATUS_OPTIONS: FancySelectOption[] = [
  { value: "Prospect", label: "Prospect" },
  { value: "Active", label: "Active" },
  { value: "Inactive", label: "Inactive" },
];

export function CreateAccountDialog({
  trigger,
  open: controlledOpen,
  onOpenChange,
  onCreated,
}: {
  trigger?: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onCreated?: () => void;
}) {
  const { user } = useAuth();
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(false);
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : uncontrolledOpen;
  const setOpen = (next: boolean) =>
    isControlled ? onOpenChange?.(next) : setUncontrolledOpen(next);

  const [name, setName] = React.useState("");
  const [accountType, setAccountType] = React.useState<CrmAccountType>("Shipper");
  const [status, setStatus] = React.useState<CrmAccountStatus>("Prospect");
  const [industry, setIndustry] = React.useState("");
  const [website, setWebsite] = React.useState("");
  const [phone, setPhone] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [city, setCity] = React.useState("");
  const [state, setState] = React.useState("");
  const [notes, setNotes] = React.useState("");
  const [carrierId, setCarrierId] = React.useState("");
  const [touched, setTouched] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [submitError, setSubmitError] = React.useState<string | null>(null);

  const reset = React.useCallback(() => {
    setName("");
    setAccountType("Shipper");
    setStatus("Prospect");
    setIndustry("");
    setWebsite("");
    setPhone("");
    setEmail("");
    setCity("");
    setState("");
    setNotes("");
    setCarrierId("");
    setTouched(false);
    setSubmitError(null);
  }, []);

  React.useEffect(() => {
    if (!open) {
      const t = setTimeout(reset, 200);
      return () => clearTimeout(t);
    }
  }, [open, reset]);

  const hasError = touched && !name.trim();

  const handleSubmit = async () => {
    setTouched(true);
    if (!name.trim()) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      await createCrmAccount({
        accountId: generateCrmId("ACC"),
        name: name.trim(),
        accountType,
        status,
        industry: industry || undefined,
        website: website || undefined,
        phone: phone || undefined,
        email: email || undefined,
        city: city || undefined,
        state: state || undefined,
        notes: notes || undefined,
        carrierId:
          (accountType === "Carrier" || accountType === "Broker") && carrierId.trim()
            ? carrierId.trim()
            : undefined,
        createdBy: user?.userId,
      });
      onCreated?.();
      setOpen(false);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Failed to save account to DynamoDB.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {trigger ? <DialogTrigger asChild>{trigger}</DialogTrigger> : null}
      <DialogContent className="!max-w-2xl w-[94vw] gap-0 overflow-hidden border-border/70 p-0 sm:rounded-2xl">
        <DialogTitle className="sr-only">{t("Add Account")}</DialogTitle>
        <DialogDescription className="sr-only">
          {t("Create a lead/account company record.")}
        </DialogDescription>
        <div className="border-b border-border/70 px-6 py-4">
          <h2 className="text-lg font-semibold tracking-tight text-foreground">
            {t("Add Account")}
          </h2>
        </div>
        <div className="max-h-[70vh] overflow-y-auto px-6 py-5">
          <Card>
            <SectionTitle title={t("Company")} icon={Building2} />
            <GridSection cols={2}>
              <FieldShell label={t("Account Name")} required error={hasError}>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t("Acme Distribution Co.")}
                  className={cn(hasError && "border-destructive/60")}
                />
              </FieldShell>
              <FieldShell label={t("Type")}>
                <FancySelect
                  value={accountType}
                  onChange={(v) => setAccountType(v as CrmAccountType)}
                  options={TYPE_OPTIONS}
                  searchable={false}
                />
              </FieldShell>
            </GridSection>
            <GridSection cols={3} className="mt-4">
              <FieldShell label={t("Status")}>
                <FancySelect
                  value={status}
                  onChange={(v) => setStatus(v as CrmAccountStatus)}
                  options={STATUS_OPTIONS}
                  searchable={false}
                />
              </FieldShell>
              <FieldShell label={t("Industry")}>
                <Input
                  value={industry}
                  onChange={(e) => setIndustry(e.target.value)}
                  placeholder={t("Retail")}
                />
              </FieldShell>
              <FieldShell label={t("Website")}>
                <Input
                  value={website}
                  onChange={(e) => setWebsite(e.target.value)}
                  placeholder="https://"
                />
              </FieldShell>
            </GridSection>
            <GridSection cols={4} className="mt-4">
              <FieldShell label={t("Phone")}>
                <Input
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="(555) 555-0100"
                />
              </FieldShell>
              <FieldShell label={t("Email")}>
                <Input
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="ops@acme.com"
                />
              </FieldShell>
              <FieldShell label={t("City")}>
                <Input
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  placeholder={t("Dallas")}
                />
              </FieldShell>
              <FieldShell label={t("State")}>
                <Input value={state} onChange={(e) => setState(e.target.value)} placeholder="TX" />
              </FieldShell>
            </GridSection>
            {(accountType === "Carrier" || accountType === "Broker") && (
              <div className="mt-4">
                <FieldShell label={t("Carrier ID (optional)")}>
                  <Input
                    value={carrierId}
                    onChange={(e) => setCarrierId(e.target.value)}
                    placeholder={t("Links to /carriers/$carrierId")}
                  />
                </FieldShell>
              </div>
            )}
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
              Save Account
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
