import * as React from "react";
import { AlertTriangle, ArrowRight, Loader2, MapPin, Percent } from "lucide-react";

import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import {
  CRM_LEAD_STAGES,
  createCrmActivity,
  crmLeadMarginPct,
  crmLeadRevenueForecast,
  updateCrmLead,
  type CrmLeadRecord,
  type CrmLeadStage,
} from "@/lib/crm-store";
import { CRM_STAGE_BADGE_CLASS, CRM_STAGE_TONE, formatCurrency } from "./crm-shared";

export function PipelineBoard({
  leads,
  loading,
  onOpenLead,
  onChanged,
}: {
  leads: CrmLeadRecord[];
  loading: boolean;
  onOpenLead: (lead: CrmLeadRecord) => void;
  onChanged: () => void;
}) {
  const { user } = useAuth();
  const [movingId, setMovingId] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const byStage = React.useMemo(() => {
    const map = new Map<CrmLeadStage, CrmLeadRecord[]>();
    for (const stage of CRM_LEAD_STAGES) map.set(stage, []);
    for (const lead of leads) {
      map.get(lead.stage)?.push(lead);
    }
    return map;
  }, [leads]);

  const moveStage = async (lead: CrmLeadRecord, nextStage: CrmLeadStage) => {
    if (nextStage === lead.stage) return;
    setMovingId(lead.leadId);
    setError(null);
    try {
      await updateCrmLead({ ...lead, stage: nextStage });
      await createCrmActivity({
        activityId: `ACT-${Math.random().toString(36).slice(2, 10)}`,
        entityType: "lead",
        entityId: lead.leadId,
        type: "stage_change",
        subject: `Stage changed: ${lead.stage} → ${nextStage}`,
        createdBy: user?.userId,
      });
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to move lead.");
    } finally {
      setMovingId(null);
    }
  };

  if (loading) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, col) => (
          <div key={col} className="flex flex-col rounded-xl border border-border/70 bg-muted/20">
            <div className="flex items-center justify-between border-b border-border/70 px-3 py-2.5">
              <Skeleton className="h-5 w-20 rounded-full" />
              <Skeleton className="h-3.5 w-12" />
            </div>
            <div className="flex-1 space-y-2 p-2">
              {Array.from({ length: 2 }).map((__, i) => (
                <div key={i} className="rounded-lg border border-border/60 bg-card p-3 shadow-sm">
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="mt-2 h-3 w-1/2" />
                  <Skeleton className="mt-2 h-3 w-2/3" />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {error && (
        <div className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/8 px-3 py-2 text-xs text-destructive">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          {error}
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {CRM_LEAD_STAGES.map((stage) => {
          const stageLeads = byStage.get(stage) ?? [];
          const forecastTotal = stageLeads.reduce((sum, l) => sum + crmLeadRevenueForecast(l), 0);
          return (
            <div key={stage} className="flex flex-col rounded-xl border border-border/70 bg-muted/20">
              <div className="flex items-center justify-between border-b border-border/70 px-3 py-2.5">
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className={CRM_STAGE_BADGE_CLASS[CRM_STAGE_TONE[stage]]}>
                    {stage}
                  </Badge>
                  <span className="text-xs text-muted-foreground">{stageLeads.length}</span>
                </div>
                <span className="text-xs font-medium tabular-nums text-muted-foreground">
                  {formatCurrency(forecastTotal)}
                </span>
              </div>
              <div className="flex-1 space-y-2 p-2">
                {stageLeads.length === 0 ? (
                  <div className="py-6 text-center text-[11px] text-muted-foreground">No leads</div>
                ) : (
                  stageLeads.map((lead) => {
                    const margin = crmLeadMarginPct(lead);
                    const floorBreach = margin != null && lead.marginFloorPct != null && margin < lead.marginFloorPct;
                    return (
                      <div
                        key={lead.leadId}
                        className="cursor-pointer rounded-lg border border-border/60 bg-card p-3 shadow-sm transition-colors hover:border-primary/40"
                        onClick={() => onOpenLead(lead)}
                      >
                        <div className="text-sm font-medium leading-tight text-foreground">{lead.title}</div>
                        {(lead.origin || lead.destination) && (
                          <div className="mt-1 flex items-center gap-1 text-[11px] text-muted-foreground">
                            <MapPin className="h-3 w-3 shrink-0" />
                            <span className="truncate">
                              {lead.origin ?? "—"} → {lead.destination ?? "—"}
                            </span>
                          </div>
                        )}
                        <div className="mt-2 flex items-center justify-between">
                          <span className="text-sm font-semibold tabular-nums text-foreground">
                            {formatCurrency(lead.quotedRate)}
                          </span>
                          {margin != null && (
                            <span
                              className={cn(
                                "inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[11px] font-medium",
                                floorBreach ? "bg-destructive/12 text-destructive" : "bg-success/12 text-success",
                              )}
                            >
                              <Percent className="h-2.5 w-2.5" />
                              {margin.toFixed(0)}%
                            </span>
                          )}
                        </div>
                        <div
                          className="mt-2 flex flex-wrap gap-1"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {CRM_LEAD_STAGES.filter((s) => s !== lead.stage).map((s) => (
                            <Button
                              key={s}
                              type="button"
                              variant="outline"
                              size="sm"
                              className="h-6 gap-1 px-1.5 text-[10px]"
                              disabled={movingId === lead.leadId}
                              onClick={() => void moveStage(lead, s)}
                            >
                              {s} <ArrowRight className="h-2.5 w-2.5" />
                            </Button>
                          ))}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
