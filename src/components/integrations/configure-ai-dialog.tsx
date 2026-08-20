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
import { DEFAULT_AI_MODEL } from "@/lib/ai-proxy";
import {
  INTEGRATIONS_CONFIG_DEFAULTS,
  recordAiTestResult,
  saveAiIntegration,
  testAiIntegration,
  type AiIntegration,
  type IntegrationsConfig,
} from "@/lib/integrations-config";

type ConfigureAiDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  config: IntegrationsConfig;
  onSave: (config: IntegrationsConfig) => Promise<void>;
  saving?: boolean;
};

export function ConfigureAiDialog({
  open,
  onOpenChange,
  config,
  onSave,
  saving = false,
}: ConfigureAiDialogProps) {
  const [draft, setDraft] = React.useState<AiIntegration>(config.ai);
  const [testing, setTesting] = React.useState(false);
  const [persisting, setPersisting] = React.useState(false);

  React.useEffect(() => {
    if (open) setDraft({ ...config.ai, model: config.ai.model || DEFAULT_AI_MODEL });
  }, [open, config.ai]);

  const updateDraft = (patch: Partial<AiIntegration>) =>
    setDraft((prev) => ({ ...prev, ...patch }));

  const handleSave = async () => {
    const apiKey = draft.apiKey.trim();
    const enabled = draft.enabled || Boolean(apiKey);
    const model = draft.model?.trim() || DEFAULT_AI_MODEL;

    if (apiKey && !draft.enabled) {
      toast.message("Workspace AI was enabled because an API key was saved.");
    }

    setPersisting(true);
    try {
      // The key goes to the server, never into the browser-readable settings
      // row. Omitting `apiKey` when the field is blank leaves the stored key
      // alone — the admin cannot read it back to re-enter it.
      await saveAiIntegration({
        ...(apiKey ? { apiKey } : {}),
        model,
        enabled,
      });
      // Non-secret display state (test timestamps) still lives with the rest of
      // the integrations config.
      await onSave({
        ...config,
        ai: { ...draft, enabled, apiKey: "", model },
      });
      toast.success("AI integration saved.");
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
      const result = await testAiIntegration(draft.apiKey);
      await recordAiTestResult(result.ok);
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
        ai: { ...INTEGRATIONS_CONFIG_DEFAULTS.ai },
      });
      toast.message(
        "AI disconnected. Bidding, RFP matching, and Content Studio will use local fallbacks until you reconnect OpenAI.",
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
          <DialogTitle>Configure AI</DialogTitle>
          <DialogDescription>
            Connect your OpenAI API key once — Titan Freight uses it for Bidding Copilot, RFP
            matching explanations, Content Studio drafts, and other AI assistants. Stored in
            WorkspaceSettings (not <code className="text-xs">.env</code>).
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <div className="flex items-center justify-between gap-3 rounded-md border border-border/70 px-3 py-2.5">
            <div>
              <Label htmlFor="ai-enabled" className="text-sm font-medium">
                Enable workspace AI
              </Label>
              <p className="text-xs text-muted-foreground">
                When off, AI features fall back to local heuristics and templates.
              </p>
            </div>
            <Switch
              id="ai-enabled"
              checked={draft.enabled}
              onCheckedChange={(checked) => updateDraft({ enabled: checked })}
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="ai-api-key">OpenAI API key</Label>
            <Input
              id="ai-api-key"
              type="password"
              autoComplete="off"
              placeholder="sk-…"
              value={draft.apiKey}
              onChange={(event) => updateDraft({ apiKey: event.target.value })}
            />
            <p className="text-xs text-muted-foreground">
              Create a key at{" "}
              <span className="font-medium text-foreground">platform.openai.com</span>. Test
              Connection calls OpenAI Models to verify the key before you rely on it in production.
            </p>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="ai-model">Chat model</Label>
            <Input
              id="ai-model"
              autoComplete="off"
              placeholder={DEFAULT_AI_MODEL}
              value={draft.model ?? DEFAULT_AI_MODEL}
              onChange={(event) => updateDraft({ model: event.target.value })}
            />
            <p className="text-xs text-muted-foreground">
              Default <code className="text-[10px]">{DEFAULT_AI_MODEL}</code> balances quality and
              cost. Use <code className="text-[10px]">gpt-4o</code> for harder pricing narratives.
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
            Disconnect
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
