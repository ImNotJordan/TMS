import * as React from "react";
import { AlertTriangle, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { CreateLeadDialog } from "./create-lead-dialog";
import { PipelineBoard } from "./pipeline-board";
import { EntityDetailSheet } from "./entity-detail-sheet";
import { crmLeadMarginPct, crmLeadRevenueForecast } from "@/lib/crm-store";
import type { CrmAccountRecord, CrmContactRecord, CrmLeadRecord } from "@/lib/crm-store";
import { formatCurrency } from "./crm-shared";
import { t } from "@/lib/i18n/t";

export function PipelinePanel({
  leads,
  accounts,
  contacts,
  loading,
  error,
  onRefresh,
}: {
  leads: CrmLeadRecord[] | null;
  accounts: CrmAccountRecord[];
  contacts: CrmContactRecord[];
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
}) {
  const [createOpen, setCreateOpen] = React.useState(false);
  const [selected, setSelected] = React.useState<CrmLeadRecord | null>(null);

  const rows = leads ?? [];
  const totalForecast = rows.reduce((sum, l) => sum + crmLeadRevenueForecast(l), 0);
  const marginTarget = 15;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-sm text-muted-foreground">
          Revenue forecast:{" "}
          <span className="font-medium text-foreground">{formatCurrency(totalForecast)}</span> vs.{" "}
          {marginTarget}% margin target
        </div>
        <Button size="sm" className="gap-1.5" onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4" /> {t("New Lead")}
        </Button>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/8 px-3 py-2 text-xs text-destructive">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          {error}
        </div>
      )}

      <PipelineBoard
        leads={rows}
        loading={loading}
        onOpenLead={setSelected}
        onChanged={onRefresh}
      />

      <CreateLeadDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={onRefresh}
        accounts={accounts}
        contacts={contacts}
      />

      {selected && (
        <EntityDetailSheet
          open={!!selected}
          onOpenChange={(open) => !open && setSelected(null)}
          title={selected.title}
          subtitle={`${selected.stage} · ${selected.origin ?? "—"} → ${selected.destination ?? "—"}`}
          entityType="lead"
          entityId={selected.leadId}
          fields={[
            { label: "Stage", value: selected.stage },
            { label: "Quoted rate", value: formatCurrency(selected.quotedRate) },
            { label: "Estimated cost", value: formatCurrency(selected.estimatedCost) },
            {
              label: "Margin",
              value: (() => {
                const m = crmLeadMarginPct(selected);
                return m == null ? "—" : `${m.toFixed(1)}%`;
              })(),
            },
            {
              label: "Margin floor",
              value: selected.marginFloorPct != null ? `${selected.marginFloorPct}%` : "—",
            },
            {
              label: "Win probability",
              value: selected.probabilityPct != null ? `${selected.probabilityPct}%` : "—",
            },
            { label: "Source", value: selected.source },
            { label: "Notes", value: selected.notes },
          ]}
        />
      )}
    </div>
  );
}
