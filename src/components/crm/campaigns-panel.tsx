import * as React from "react";
import { AlertTriangle, FileText, Globe, Loader2, Mail, Plus, Send, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { CreateCampaignDialog } from "./create-campaign-dialog";
import {
  listAllCrmCampaignsCached,
  type CrmCampaignRecord,
  type CrmCampaignType,
} from "@/lib/crm-store";
import { Card, formatTimestamp } from "./crm-shared";
import { t } from "@/lib/i18n/t";

const TYPE_META: Record<
  CrmCampaignType,
  { label: string; icon: React.ComponentType<{ className?: string }> }
> = {
  email_sequence: { label: "Email Sequence", icon: Mail },
  landing_page: { label: "Landing Page", icon: Globe },
  social: { label: "Social Scheduler", icon: Send },
  content_studio: { label: "Content Studio", icon: Sparkles },
};

export function CampaignsPanel() {
  const [campaigns, setCampaigns] = React.useState<CrmCampaignRecord[] | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [createOpen, setCreateOpen] = React.useState(false);

  const load = React.useCallback(async (options?: { force?: boolean }) => {
    setLoading(true);
    setError(null);
    try {
      const rows = await listAllCrmCampaignsCached({ force: options?.force });
      rows.sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
      setCampaigns(rows);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load campaigns.");
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-sm text-muted-foreground">
          {t(
            "Email sequences, landing pages, social scheduling, and AI-drafted content live here.",
          )}
        </div>
        <Button size="sm" className="gap-1.5" onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4" /> {t("New Campaign")}
        </Button>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/8 px-3 py-2 text-xs text-destructive">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          {error}
        </div>
      )}

      {loading ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="rounded-xl border border-border/70 p-4">
              <div className="flex items-center justify-between gap-2">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-5 w-16 rounded-full" />
              </div>
              <Skeleton className="mt-3 h-3 w-3/4" />
              <Skeleton className="mt-2 h-3 w-1/2" />
            </div>
          ))}
        </div>
      ) : !campaigns || campaigns.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-12 text-center text-sm text-muted-foreground">
          <FileText className="h-6 w-6" />
          {t("No campaigns yet.")}
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {campaigns.map((c) => {
            const meta = TYPE_META[c.type];
            const Icon = meta.icon;
            return (
              <Card key={c.campaignId}>
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="flex h-8 w-8 items-center justify-center rounded-md bg-primary/10 text-primary">
                      <Icon className="h-4 w-4" />
                    </span>
                    <div>
                      <div className="text-sm font-semibold text-foreground">{c.name}</div>
                      <div className="text-xs text-muted-foreground">{meta.label}</div>
                    </div>
                  </div>
                  <Badge variant="secondary" className="capitalize">
                    {c.status}
                  </Badge>
                </div>
                {c.audience && (
                  <div className="mt-2 text-xs text-muted-foreground">Audience: {c.audience}</div>
                )}
                {c.content && (
                  <p className="mt-2 line-clamp-3 text-xs text-muted-foreground">{c.content}</p>
                )}
                <div className="mt-3 text-[11px] text-muted-foreground">
                  Created {formatTimestamp(c.createdAt)}
                  {c.scheduledAt ? ` · Scheduled ${formatTimestamp(c.scheduledAt)}` : ""}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <CreateCampaignDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={() => void load()}
      />
    </div>
  );
}
