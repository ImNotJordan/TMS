/**
 * Connect Resend for the 12-hour driver-location digest.
 *
 * The key is write-only, same as OpenAI: stored under `secrets` /
 * `<companyId>#resend` and never returned. Recipients are not in this dialog —
 * they live on Settings → Automations, because "who gets the email" is an
 * operations choice and "which vendor sends it" is a credential.
 */
import * as React from "react";
import { ExternalLink, Loader2, Mail } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { t } from "@/lib/i18n/t";

export type ResendStatusView = {
  connected: boolean;
  fromEmail: string | null;
  last4?: string;
  updatedAt?: string;
  lastDigestAt?: string;
};

export function ConfigureResendDialog({
  open,
  onOpenChange,
  status,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  status: ResendStatusView | null;
  onSaved: () => void;
}) {
  const [apiKey, setApiKey] = React.useState("");
  const [fromEmail, setFromEmail] = React.useState("");
  const [enabled, setEnabled] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [testing, setTesting] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    setFromEmail(status?.fromEmail ?? "");
    setEnabled(status?.connected ?? true);
    setApiKey("");
  }, [open, status]);

  const handleSave = async () => {
    if (!fromEmail.trim()) {
      toast.error(t("Set a From address — it must be a domain you verified in Resend."));
      return;
    }
    if (!status?.connected && !apiKey.trim()) {
      toast.error(t("Paste your Resend API key."));
      return;
    }

    setSaving(true);
    try {
      const response = await fetch("/api/settings/integrations/resend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
          fromEmail: fromEmail.trim(),
          enabled,
        }),
      });
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) {
        toast.error(body?.error ?? t("Could not save the integration."));
        return;
      }
      toast.success(t("Resend API saved."));
      onSaved();
      onOpenChange(false);
    } catch {
      toast.error(t("Could not save the integration."));
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    try {
      const response = await fetch("/api/settings/integrations/resend/test", { method: "POST" });
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) {
        toast.error(body?.error ?? t("Could not send a test email."));
        return;
      }
      toast.success(t("Test email sent to the Automations recipients."));
    } catch {
      toast.error(t("Could not send a test email."));
    } finally {
      setTesting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Mail className="h-4 w-4 text-primary" />
            {t("Resend email API")}
          </DialogTitle>
          <DialogDescription>
            {t(
              "Sends the 12-hour driver location digest. Recipients are set on the Automations tab.",
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label htmlFor="resend-key" className="text-xs font-medium text-muted-foreground">
              {t("API key")}
            </Label>
            <Input
              id="resend-key"
              className="mt-1.5"
              type="password"
              autoComplete="off"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              placeholder={
                status?.last4
                  ? `${t("Stored key ending")} ${status.last4} — ${t("leave blank to keep it")}`
                  : t("Paste your Resend API key")
              }
            />
            <p className="mt-1 text-xs text-muted-foreground">
              {t(
                "Stored server-side and never returned to the browser. Leave blank to keep the existing key.",
              )}
            </p>
            <a
              href="https://resend.com/api-keys"
              target="_blank"
              rel="noreferrer noopener"
              className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-primary underline-offset-4 hover:underline"
            >
              <ExternalLink className="h-3 w-3" />
              {t("Get a key")}
            </a>
          </div>

          <div>
            <Label htmlFor="resend-from" className="text-xs font-medium text-muted-foreground">
              {t("From address")}
            </Label>
            <Input
              id="resend-from"
              className="mt-1.5"
              value={fromEmail}
              onChange={(event) => setFromEmail(event.target.value)}
              placeholder="Freight Desk <updates@yourdomain.com>"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              {t("Must be a domain you verified in Resend. onboarding@resend.dev works for tests.")}
            </p>
          </div>

          <Separator />

          <label className="flex items-center justify-between gap-3 rounded-md border border-border/70 px-3 py-2.5">
            <span className="text-sm">{t("Enable driver location emails")}</span>
            <Switch checked={enabled} onCheckedChange={setEnabled} />
          </label>
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          <Button
            variant="outline"
            onClick={() => void handleTest()}
            disabled={saving || testing || !status?.connected}
          >
            {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {t("Send test email")}
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
              {t("Cancel")}
            </Button>
            <Button onClick={() => void handleSave()} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {t("Save")}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
