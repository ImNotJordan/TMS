import * as React from "react";
import { AlertTriangle, CheckCircle2, Loader2, User } from "lucide-react";

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
import { createCrmContact, type CrmAccountRecord } from "@/lib/crm-store";
import { Card, FieldShell, GridSection, SectionTitle, generateCrmId } from "./crm-shared";
import { t } from "@/lib/i18n/t";

export function CreateContactDialog({
  trigger,
  open: controlledOpen,
  onOpenChange,
  onCreated,
  accounts,
  defaultAccountId,
}: {
  trigger?: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onCreated?: () => void;
  accounts: CrmAccountRecord[];
  defaultAccountId?: string;
}) {
  const { user } = useAuth();
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(false);
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : uncontrolledOpen;
  const setOpen = (next: boolean) =>
    isControlled ? onOpenChange?.(next) : setUncontrolledOpen(next);

  const [firstName, setFirstName] = React.useState("");
  const [lastName, setLastName] = React.useState("");
  const [accountId, setAccountId] = React.useState(defaultAccountId ?? "");
  const [title, setTitle] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [phone, setPhone] = React.useState("");
  const [notes, setNotes] = React.useState("");
  const [touched, setTouched] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [submitError, setSubmitError] = React.useState<string | null>(null);

  const reset = React.useCallback(() => {
    setFirstName("");
    setLastName("");
    setAccountId(defaultAccountId ?? "");
    setTitle("");
    setEmail("");
    setPhone("");
    setNotes("");
    setTouched(false);
    setSubmitError(null);
  }, [defaultAccountId]);

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

  const hasError = touched && (!firstName.trim() || !lastName.trim());

  const handleSubmit = async () => {
    setTouched(true);
    if (!firstName.trim() || !lastName.trim()) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      await createCrmContact({
        contactId: generateCrmId("CON"),
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        accountId: accountId || undefined,
        title: title || undefined,
        email: email || undefined,
        phone: phone || undefined,
        notes: notes || undefined,
        createdBy: user?.userId,
      });
      onCreated?.();
      setOpen(false);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Failed to save contact to DynamoDB.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {trigger ? <DialogTrigger asChild>{trigger}</DialogTrigger> : null}
      <DialogContent className="!max-w-2xl w-[94vw] gap-0 overflow-hidden border-border/70 p-0 sm:rounded-2xl">
        <DialogTitle className="sr-only">{t("Add Contact")}</DialogTitle>
        <DialogDescription className="sr-only">
          {t("Create a contact linked to an account.")}
        </DialogDescription>
        <div className="border-b border-border/70 px-6 py-4">
          <h2 className="text-lg font-semibold tracking-tight text-foreground">
            {t("Add Contact")}
          </h2>
        </div>
        <div className="max-h-[70vh] overflow-y-auto px-6 py-5">
          <Card>
            <SectionTitle title={t("Contact")} icon={User} />
            <GridSection cols={2}>
              <FieldShell label={t("First Name")} required error={hasError && !firstName.trim()}>
                <Input
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  className={cn(hasError && !firstName.trim() && "border-destructive/60")}
                />
              </FieldShell>
              <FieldShell label={t("Last Name")} required error={hasError && !lastName.trim()}>
                <Input
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  className={cn(hasError && !lastName.trim() && "border-destructive/60")}
                />
              </FieldShell>
            </GridSection>
            <GridSection cols={2} className="mt-4">
              <FieldShell label={t("Account")} hint={t("Optional")}>
                <FancySelect
                  value={accountId}
                  onChange={setAccountId}
                  options={accountOptions}
                  placeholder={t("Link to an account")}
                  emptyMessage={t("No accounts yet")}
                />
              </FieldShell>
              <FieldShell label={t("Title")}>
                <Input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder={t("Logistics Manager")}
                />
              </FieldShell>
            </GridSection>
            <GridSection cols={2} className="mt-4">
              <FieldShell label={t("Email")}>
                <Input
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="jane@acme.com"
                />
              </FieldShell>
              <FieldShell label={t("Phone")}>
                <Input
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="(555) 555-0100"
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
              Save Contact
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
