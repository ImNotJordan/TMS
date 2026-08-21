/**
 * Connect a China tax API — invoice verification (发票查验).
 *
 * ## Why this dialog is about verification, not rates
 *
 * China's VAT rates are statutory and the built-in estimator already applies
 * them exactly. What no statute can tell you is whether a *particular* carrier
 * invoice is genuine — and on a brokered Chinese load that single fact is the
 * difference between about ¥185 and ¥925 of tax, because only a valid special VAT
 * invoice (增值税专用发票) carries an input credit.
 *
 * So the copy in here leads with that, rather than implying the key improves a
 * rate. An admin who connects this should know what they are buying.
 *
 * ## The key never comes back
 *
 * Write-only, exactly like the OpenAI key: it is stored in the server-only
 * `secrets` partition and the status response returns `connected` plus the last
 * four characters. There is no field that reveals it, which is why the input is
 * blank on reopen rather than pre-filled.
 */
import * as React from "react";
import { ExternalLink, Loader2, ShieldCheck } from "lucide-react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { t } from "@/lib/i18n/t";
import type { ChinaTaxProviderId } from "@/lib/tax/china-tax-adapter";

export type ChinaTaxStatusView = {
  connected: boolean;
  provider: string | null;
  endpoint: string | null;
  last4?: string;
  updatedAt?: string;
};

/**
 * Where to buy a key, with the trade-off stated.
 *
 * Listed in the dialog rather than only in docs, because the person pasting a
 * key is the person who has to choose a provider.
 */
const PROVIDER_OPTIONS: {
  id: ChinaTaxProviderId;
  label: string;
  signupUrl: string;
  note: string;
}[] = [
  {
    id: "aliyun-market",
    label: "Alibaba Cloud Marketplace (发票查验)",
    signupUrl: "https://market.aliyun.com/apimarket/detail/cmapi025075",
    note: "Self-serve with an Aliyun account. Single APPCODE header — the simplest to connect.",
  },
  {
    id: "juhe",
    label: "Juhe Data 聚合数据",
    signupUrl: "https://www.juhe.cn/docs/api/id/336",
    note: "Key passed as a query parameter. Free tier for testing.",
  },
  {
    id: "custom",
    label: "Other provider (custom endpoint)",
    signupUrl: "",
    note: "Point at any provider that verifies against the tax authority and returns JSON.",
  },
];

export function ConfigureChinaTaxDialog({
  open,
  onOpenChange,
  status,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  status: ChinaTaxStatusView | null;
  onSaved: () => void;
}) {
  const [provider, setProvider] = React.useState<ChinaTaxProviderId>("aliyun-market");
  const [apiKey, setApiKey] = React.useState("");
  const [endpoint, setEndpoint] = React.useState("");
  const [enabled, setEnabled] = React.useState(true);
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    setProvider((status?.provider as ChinaTaxProviderId) ?? "aliyun-market");
    setEndpoint(status?.endpoint ?? "");
    setEnabled(status?.connected ?? true);
    // Deliberately blank. The stored key is unreadable, and an omitted key on
    // save leaves it untouched — so switching provider does not require having
    // the key to hand.
    setApiKey("");
  }, [open, status]);

  const selected = PROVIDER_OPTIONS.find((option) => option.id === provider);
  const needsEndpoint = provider === "custom";
  const endpointInvalid =
    endpoint.trim().length > 0 && !endpoint.trim().toLowerCase().startsWith("https://");

  const handleSave = async () => {
    if (needsEndpoint && !endpoint.trim()) {
      toast.error(t("A custom provider needs an endpoint URL."));
      return;
    }
    if (endpointInvalid) {
      toast.error(t("The endpoint must be an https URL."));
      return;
    }

    setSaving(true);
    try {
      const response = await fetch("/api/settings/integrations/china-tax", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider,
          // Omitted when blank, so an existing key survives a provider change.
          ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
          endpoint: endpoint.trim(),
          enabled,
        }),
      });
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) {
        toast.error(body?.error ?? t("Could not save the integration."));
        return;
      }
      toast.success(t("China tax API saved."));
      onSaved();
      onOpenChange(false);
    } catch {
      toast.error(t("Could not save the integration."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-primary" />
            {t("China tax API")}
          </DialogTitle>
          <DialogDescription>
            {t(
              "Verifies carrier invoices against tax authority records. A valid special VAT invoice (增值税专用发票) is what makes the input credit real — without one, the same load costs several times more in tax.",
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label className="text-xs font-medium text-muted-foreground">{t("Provider")}</Label>
            <Select
              value={provider}
              onValueChange={(value) => setProvider(value as ChinaTaxProviderId)}
            >
              <SelectTrigger className="mt-1.5">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PROVIDER_OPTIONS.map((option) => (
                  <SelectItem key={option.id} value={option.id}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selected ? (
              <p className="mt-1.5 text-xs text-muted-foreground">{t(selected.note)}</p>
            ) : null}
            {selected?.signupUrl ? (
              <a
                href={selected.signupUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-primary underline-offset-4 hover:underline"
              >
                <ExternalLink className="h-3 w-3" />
                {t("Get a key")}
              </a>
            ) : null}
          </div>

          <div>
            <Label htmlFor="cn-tax-key" className="text-xs font-medium text-muted-foreground">
              {t("API key / APPCODE")}
            </Label>
            <Input
              id="cn-tax-key"
              className="mt-1.5"
              type="password"
              autoComplete="off"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              placeholder={
                status?.last4
                  ? `${t("Stored key ending")} ${status.last4} — ${t("leave blank to keep it")}`
                  : t("Paste your key")
              }
            />
            <p className="mt-1 text-xs text-muted-foreground">
              {t(
                "Stored server-side and never returned to the browser. Leave blank to keep the existing key.",
              )}
            </p>
          </div>

          {needsEndpoint || endpoint ? (
            <div>
              <Label
                htmlFor="cn-tax-endpoint"
                className="text-xs font-medium text-muted-foreground"
              >
                {t("Endpoint URL")}
              </Label>
              <Input
                id="cn-tax-endpoint"
                className="mt-1.5"
                value={endpoint}
                onChange={(event) => setEndpoint(event.target.value)}
                placeholder="https://..."
                aria-invalid={endpointInvalid}
              />
              {endpointInvalid ? (
                <p className="mt-1 text-xs text-destructive">
                  {t("Must be https — a metered key must not travel in clear text.")}
                </p>
              ) : null}
            </div>
          ) : null}

          <Separator />

          <label className="flex items-center justify-between gap-3 rounded-md border border-border/70 px-3 py-2.5">
            <span className="text-sm">{t("Enable invoice verification")}</span>
            <Switch checked={enabled} onCheckedChange={setEnabled} />
          </label>

          <p className="text-[11px] leading-relaxed text-muted-foreground">
            {t(
              "These APIs verify against the State Taxation Administration platform and cap queries per invoice per day. They confirm an invoice is genuine; they do not change the statutory VAT rate, which the built-in estimator already applies.",
            )}
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            {t("Cancel")}
          </Button>
          <Button onClick={() => void handleSave()} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {t("Save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
