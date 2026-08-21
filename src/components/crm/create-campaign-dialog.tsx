import * as React from "react";
import { AlertTriangle, CheckCircle2, Loader2, Megaphone, Sparkles } from "lucide-react";

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
import { createCrmCampaign, type CrmCampaignType } from "@/lib/crm-store";
import { draftCampaignContentAsync } from "@/lib/content-studio";
import { isWorkspaceAiEnabled } from "@/lib/integrations-config";
import { toast } from "sonner";
import { Card, FieldShell, GridSection, SectionTitle, generateCrmId } from "./crm-shared";
import { t } from "@/lib/i18n/t";

const TYPE_OPTIONS: FancySelectOption[] = [
  { value: "email_sequence", label: "Email Sequence" },
  { value: "landing_page", label: "Landing Page" },
  { value: "social", label: "Social Scheduler" },
  { value: "content_studio", label: "Content Studio" },
];

export function CreateCampaignDialog({
  trigger,
  open: controlledOpen,
  onOpenChange,
  onCreated,
  defaultType,
}: {
  trigger?: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onCreated?: () => void;
  defaultType?: CrmCampaignType;
}) {
  const { user } = useAuth();
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(false);
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : uncontrolledOpen;
  const setOpen = (next: boolean) =>
    isControlled ? onOpenChange?.(next) : setUncontrolledOpen(next);

  const [name, setName] = React.useState("");
  const [type, setType] = React.useState<CrmCampaignType>(defaultType ?? "email_sequence");
  const [audience, setAudience] = React.useState("");
  const [content, setContent] = React.useState("");
  const [scheduledAt, setScheduledAt] = React.useState("");
  const [touched, setTouched] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [submitError, setSubmitError] = React.useState<string | null>(null);
  const [aiDrafting, setAiDrafting] = React.useState(false);

  const reset = React.useCallback(() => {
    setName("");
    setType(defaultType ?? "email_sequence");
    setAudience("");
    setContent("");
    setScheduledAt("");
    setTouched(false);
    setSubmitError(null);
  }, [defaultType]);

  React.useEffect(() => {
    if (!open) {
      const t = setTimeout(reset, 200);
      return () => clearTimeout(t);
    }
  }, [open, reset]);

  const hasError = touched && !name.trim();

  const handleAiDraft = async () => {
    setAiDrafting(true);
    setSubmitError(null);
    try {
      const result = await draftCampaignContentAsync({
        name: name || "New campaign",
        type,
        audience,
      });
      setContent(result.text);
      if (result.usedAi) {
        toast.success("AI draft ready");
      } else if (result.error) {
        toast.error(result.error);
      } else if (!isWorkspaceAiEnabled()) {
        toast.message("Using template draft", {
          description: "Connect OpenAI in Settings → Integrations for live AI copy.",
        });
      }
    } finally {
      setAiDrafting(false);
    }
  };

  const handleSubmit = async () => {
    setTouched(true);
    if (!name.trim()) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      await createCrmCampaign({
        campaignId: generateCrmId("CMP"),
        name: name.trim(),
        type,
        status: "draft",
        audience: audience || undefined,
        content: content || undefined,
        scheduledAt: scheduledAt || undefined,
        createdBy: user?.userId,
      });
      onCreated?.();
      setOpen(false);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Failed to save campaign to DynamoDB.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {trigger ? <DialogTrigger asChild>{trigger}</DialogTrigger> : null}
      <DialogContent className="!max-w-2xl w-[94vw] gap-0 overflow-hidden border-border/70 p-0 sm:rounded-2xl">
        <DialogTitle className="sr-only">{t("Add Campaign")}</DialogTitle>
        <DialogDescription className="sr-only">
          {t("Create an email, landing page, social, or content studio campaign.")}
        </DialogDescription>
        <div className="border-b border-border/70 px-6 py-4">
          <h2 className="text-lg font-semibold tracking-tight text-foreground">
            {t("Add Campaign")}
          </h2>
        </div>
        <div className="max-h-[70vh] overflow-y-auto px-6 py-5">
          <Card>
            <SectionTitle title={t("Campaign")} icon={Megaphone} />
            <GridSection cols={2}>
              <FieldShell label={t("Name")} required error={hasError}>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t("Q3 shipper outreach")}
                  className={cn(hasError && "border-destructive/60")}
                />
              </FieldShell>
              <FieldShell label={t("Type")}>
                <FancySelect
                  value={type}
                  onChange={(v) => setType(v as CrmCampaignType)}
                  options={TYPE_OPTIONS}
                  searchable={false}
                />
              </FieldShell>
            </GridSection>
            <GridSection cols={2} className="mt-4">
              <FieldShell label={t("Audience")} hint={t("Segment or list")}>
                <Input
                  value={audience}
                  onChange={(e) => setAudience(e.target.value)}
                  placeholder={t("Mid-market shippers, Southeast")}
                />
              </FieldShell>
              <FieldShell label={t("Scheduled for")}>
                <Input
                  type="datetime-local"
                  value={scheduledAt}
                  onChange={(e) => setScheduledAt(e.target.value)}
                />
              </FieldShell>
            </GridSection>
            <div className="mt-4">
              <FieldShell
                label={t("Content")}
                hint={t("Draft body, landing page copy, or post text")}
              >
                <div className="space-y-2">
                  <Textarea value={content} onChange={(e) => setContent(e.target.value)} rows={6} />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="gap-1.5"
                    disabled={aiDrafting}
                    onClick={() => void handleAiDraft()}
                  >
                    {aiDrafting ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Sparkles className="h-3.5 w-3.5" />
                    )}
                    {aiDrafting
                      ? "Drafting…"
                      : isWorkspaceAiEnabled()
                        ? "AI draft"
                        : "AI draft (template)"}
                  </Button>
                </div>
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
              Save Campaign
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
