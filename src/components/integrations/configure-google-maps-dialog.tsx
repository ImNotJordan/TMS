import * as React from "react";
import { Loader2 } from "lucide-react";
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
import { Switch } from "@/components/ui/switch";
import {
  INTEGRATIONS_CONFIG_DEFAULTS,
  recordGoogleMapsTestResult,
  testGoogleMapsIntegration,
  type GoogleMapsIntegration,
  type IntegrationsConfig,
} from "@/lib/integrations-config";
import { t } from "@/lib/i18n/t";

type ConfigureGoogleMapsDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  config: IntegrationsConfig;
  onSave: (config: IntegrationsConfig) => Promise<void>;
  saving?: boolean;
};

export function ConfigureGoogleMapsDialog({
  open,
  onOpenChange,
  config,
  onSave,
  saving = false,
}: ConfigureGoogleMapsDialogProps) {
  const [draft, setDraft] = React.useState<GoogleMapsIntegration>(config.googleMaps);
  const [testing, setTesting] = React.useState(false);
  const [persisting, setPersisting] = React.useState(false);

  React.useEffect(() => {
    if (open) setDraft(config.googleMaps);
  }, [open, config.googleMaps]);

  const updateDraft = (patch: Partial<GoogleMapsIntegration>) =>
    setDraft((prev) => ({ ...prev, ...patch }));

  const handleSave = async () => {
    const apiKey = draft.apiKey.trim();
    const enabled = draft.enabled || Boolean(apiKey);

    if (apiKey && !draft.enabled) {
      toast.message("Google Maps geocoding was enabled because an API key was saved.");
    }

    setPersisting(true);
    try {
      await onSave({
        ...config,
        googleMaps: {
          ...draft,
          enabled,
          apiKey,
        },
      });
      toast.success("Google Maps integration saved.");
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save integration.");
    } finally {
      setPersisting(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    try {
      const result = await testGoogleMapsIntegration(draft.apiKey);
      await recordGoogleMapsTestResult(result.ok);
      if (result.ok) toast.success(result.message);
      else toast.error(result.message);
    } finally {
      setTesting(false);
    }
  };

  const handleDisconnect = async () => {
    setPersisting(true);
    try {
      await onSave({
        ...config,
        googleMaps: { ...INTEGRATIONS_CONFIG_DEFAULTS.googleMaps },
      });
      toast.message(
        "Google Maps disconnected. Facility address search is disabled until you configure it again.",
      );
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to disconnect integration.");
    } finally {
      setPersisting(false);
    }
  };

  const busy = saving || persisting;

  const canTest = draft.apiKey.trim().length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("Configure Google Maps")}</DialogTitle>
          <DialogDescription>
            Powers facility autocomplete on Loads and TruckBoard and geocoding on Tracking maps.
            Credentials are saved here only — not in <code className="text-xs">{t(".env")}</code>.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <div className="flex items-center justify-between gap-3 rounded-md border border-border/70 px-3 py-2.5">
            <div>
              <Label htmlFor="google-maps-enabled" className="text-sm font-medium">
                {t("Use Google Maps geocoding")}
              </Label>
              <p className="text-xs text-muted-foreground">
                {t("When off, facility address search on Loads and TruckBoard is disabled.")}
              </p>
            </div>
            <Switch
              id="google-maps-enabled"
              checked={draft.enabled}
              onCheckedChange={(checked) => updateDraft({ enabled: checked })}
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="google-maps-api-key">{t("Google Maps API key")}</Label>
            <Input
              id="google-maps-api-key"
              type="password"
              autoComplete="off"
              placeholder={t("AIza…")}
              value={draft.apiKey}
              onChange={(event) => updateDraft({ apiKey: event.target.value })}
            />
            <p className="text-xs text-muted-foreground">
              Stored in the WorkspaceSettings table (shared for all users). Enable{" "}
              <span className="font-medium text-foreground">{t("Geocoding API")}</span>,{" "}
              <span className="font-medium text-foreground">{t("Maps JavaScript API")}</span>, and{" "}
              <span className="font-medium text-foreground">{t("Directions API")}</span> for your
              Google Cloud project.
            </p>
          </div>
        </div>

        <DialogFooter className="flex-col gap-2 sm:flex-col sm:space-x-0">
          <div className="flex w-full flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              className="gap-1.5"
              disabled={testing || !canTest}
              onClick={() => void handleTest()}
            >
              {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Test connection
            </Button>
            <Button
              type="button"
              className="flex-1 gap-1.5"
              disabled={busy}
              onClick={() => void handleSave()}
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Save
            </Button>
          </div>
          <Button
            type="button"
            variant="ghost"
            className="text-destructive"
            disabled={busy}
            onClick={() => void handleDisconnect()}
          >
            {t("Disconnect")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
