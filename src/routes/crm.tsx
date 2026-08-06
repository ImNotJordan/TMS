import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";
import {
  AlertTriangle,
  Briefcase,
  Building2,
  Loader2,
  Megaphone,
  Radar,
  RefreshCw,
  TrendingUp,
  Users,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageHeader } from "@/components/page-header";
import { usePageReady } from "@/components/page-load-gate";

import { AccountsPanel } from "@/components/crm/accounts-panel";
import { ContactsPanel } from "@/components/crm/contacts-panel";
import { PipelinePanel } from "@/components/crm/pipeline-panel";
import { ProspectingBotPanel } from "@/components/crm/prospecting-bot-panel";
import { CampaignsPanel } from "@/components/crm/campaigns-panel";
import { formatCurrency } from "@/components/crm/crm-shared";

import {
  crmLeadMarginPct,
  crmLeadRevenueForecast,
  listAllCrmAccountsCached,
  listAllCrmContactsCached,
  listAllCrmLeadsCached,
  type CrmAccountRecord,
  type CrmContactRecord,
  type CrmLeadRecord,
} from "@/lib/crm-store";

export const Route = createFileRoute("/crm")({
  head: () => ({
    meta: [
      { title: "CRM & Sales — Logistics Software" },
      {
        name: "description",
        content: "Leads, accounts, contacts, pipeline, prospecting bot, and campaigns.",
      },
    ],
  }),
  component: Page,
});

function Page() {
  const [accounts, setAccounts] = React.useState<CrmAccountRecord[] | null>(null);
  const [contacts, setContacts] = React.useState<CrmContactRecord[] | null>(null);
  const [leads, setLeads] = React.useState<CrmLeadRecord[] | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [refreshing, setRefreshing] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [tab, setTab] = React.useState("overview");

  /**
   * `force: true` (the manual Refresh button / error retry) revalidates against DynamoDB.
   * Everything else — initial mount, and re-reads after a create/update/delete inside a
   * panel — reads the shared session cache, which mutations already keep in sync, so no
   * extra Scan hits the table.
   */
  const load = React.useCallback(async (options?: { force?: boolean; silent?: boolean }) => {
    if (!options?.silent) {
      if (options?.force) setRefreshing(true);
      else setLoading(true);
    }
    setError(null);
    try {
      const [accountRows, contactRows, leadRows] = await Promise.all([
        listAllCrmAccountsCached({ force: options?.force }),
        listAllCrmContactsCached({ force: options?.force }),
        listAllCrmLeadsCached({ force: options?.force }),
      ]);
      accountRows.sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
      contactRows.sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
      leadRows.sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
      setAccounts(accountRows);
      setContacts(contactRows);
      setLeads(leadRows);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load CRM data from DynamoDB.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  const stats = React.useMemo(() => {
    const rows = leads ?? [];
    const open = rows.filter((l) => l.stage === "Prospect" || l.stage === "Quoted").length;
    const pipelineValue = rows
      .filter((l) => l.stage !== "Lost")
      .reduce((sum, l) => sum + crmLeadRevenueForecast(l), 0);
    const today = new Date().toISOString().slice(0, 7);
    const wonMtd = rows.filter((l) => l.stage === "Won" && (l.updatedAt ?? "").slice(0, 7) === today).length;
    const atRisk = rows.filter((l) => {
      const margin = crmLeadMarginPct(l);
      return margin != null && l.marginFloorPct != null && margin < l.marginFloorPct;
    }).length;
    return [
      { label: "Open Opps", value: open.toString(), tone: "info" as const, icon: TrendingUp },
      { label: "Pipeline Value", value: formatCurrency(pipelineValue), tone: "success" as const, icon: Briefcase },
      { label: "Won (MTD)", value: wonMtd.toString(), tone: "success" as const, icon: TrendingUp },
      { label: "Below Margin Floor", value: atRisk.toString(), tone: "warning" as const, icon: AlertTriangle },
    ];
  }, [leads]);

  const toneStat = {
    default: "bg-muted text-foreground",
    success: "bg-success/15 text-success",
    warning: "bg-warning/20 text-warning-foreground",
    info: "bg-info/15 text-info",
  } as const;

  usePageReady(Boolean(loading && accounts == null && contacts == null && leads == null));

  return (
    <div>
      <PageHeader
        title="CRM & Sales"
        description="Leads, accounts, contacts, pipeline, a DAT prospecting bot, and campaigns — backed by DynamoDB."
        actions={
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={() => void load({ force: true })}
            disabled={refreshing || loading}
          >
            {refreshing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Refresh
          </Button>
        }
      />

      <div className="px-4 py-6 sm:px-6 lg:px-8">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {stats.map((s) => {
            const Icon = s.icon;
            return (
              <Card key={s.label} className="border-border/70 shadow-sm">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      {s.label}
                    </div>
                    <span className={`flex h-7 w-7 items-center justify-center rounded-md ${toneStat[s.tone]}`}>
                      <Icon className="h-3.5 w-3.5" />
                    </span>
                  </div>
                  <div className="mt-2 flex items-baseline justify-between gap-2">
                    <div className="text-2xl font-semibold tracking-tight text-foreground">
                      {loading ? (
                        <span className="inline-block h-7 w-10 animate-pulse rounded bg-muted" />
                      ) : (
                        s.value
                      )}
                    </div>
                    <Badge variant="secondary" className={toneStat[s.tone]}>
                      Live
                    </Badge>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>

        {error && (
          <div className="mt-4 flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/8 px-4 py-3 text-sm text-destructive">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <div className="flex-1">
              <div className="font-semibold">Couldn't load from DynamoDB</div>
              <div className="mt-0.5 text-xs text-destructive/90">{error}</div>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => void load({ force: true })}
              className="border-destructive/30 text-destructive hover:bg-destructive/10"
            >
              Retry
            </Button>
          </div>
        )}

        <Card className="mt-6 border-border/70 shadow-sm">
          <CardContent className="p-4 sm:p-6">
            <Tabs value={tab} onValueChange={setTab}>
              <TabsList className="grid w-full grid-cols-3 sm:grid-cols-5">
                <TabsTrigger value="overview">Overview</TabsTrigger>
                <TabsTrigger value="pipeline" className="gap-1.5">
                  <TrendingUp className="hidden h-3.5 w-3.5 sm:block" /> Pipeline
                </TabsTrigger>
                <TabsTrigger value="accounts" className="gap-1.5">
                  <Building2 className="hidden h-3.5 w-3.5 sm:block" /> Accounts
                </TabsTrigger>
                <TabsTrigger value="contacts" className="gap-1.5">
                  <Users className="hidden h-3.5 w-3.5 sm:block" /> Contacts
                </TabsTrigger>
                <TabsTrigger value="prospecting" className="gap-1.5">
                  <Radar className="hidden h-3.5 w-3.5 sm:block" /> Prospecting Bot
                </TabsTrigger>
                <TabsTrigger value="campaigns" className="gap-1.5">
                  <Megaphone className="hidden h-3.5 w-3.5 sm:block" /> Campaigns
                </TabsTrigger>
              </TabsList>

              <TabsContent value="overview" className="mt-5 space-y-3">
                <p className="text-sm text-muted-foreground">
                  Leads, accounts, and contacts each carry a full activity timeline. Use the Pipeline
                  tab to move opportunities across Prospect → Quoted → Won → Lost, the Prospecting Bot
                  to source and qualify new broker relationships from DAT, and Campaigns to run
                  outbound sequences.
                </p>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  {[
                    { label: "Pipeline", desc: "Stages, revenue forecast vs. margin target", tab: "pipeline", icon: TrendingUp },
                    { label: "Accounts", desc: "Companies you sell to or buy capacity from", tab: "accounts", icon: Building2 },
                    { label: "Contacts", desc: "People, linked to accounts", tab: "contacts", icon: Users },
                    { label: "Prospecting Bot", desc: "DAT scan → call → guardrail → log", tab: "prospecting", icon: Radar },
                  ].map((s) => (
                    <button
                      key={s.tab}
                      type="button"
                      onClick={() => setTab(s.tab)}
                      className="rounded-xl border border-border/70 bg-card/60 p-4 text-left shadow-sm transition-colors hover:border-primary/40"
                    >
                      <span className="flex h-8 w-8 items-center justify-center rounded-md bg-primary/10 text-primary">
                        <s.icon className="h-4 w-4" />
                      </span>
                      <div className="mt-2 text-sm font-semibold text-foreground">{s.label}</div>
                      <div className="mt-0.5 text-xs text-muted-foreground">{s.desc}</div>
                    </button>
                  ))}
                </div>
              </TabsContent>

              <TabsContent value="pipeline" className="mt-5">
                <PipelinePanel
                  leads={leads}
                  accounts={accounts ?? []}
                  contacts={contacts ?? []}
                  loading={loading}
                  error={null}
                  onRefresh={() => void load({ silent: true })}
                />
              </TabsContent>

              <TabsContent value="accounts" className="mt-5">
                <AccountsPanel
                  accounts={accounts}
                  loading={loading}
                  error={null}
                  onRefresh={() => void load({ silent: true })}
                />
              </TabsContent>

              <TabsContent value="contacts" className="mt-5">
                <ContactsPanel
                  contacts={contacts}
                  accounts={accounts ?? []}
                  loading={loading}
                  error={null}
                  onRefresh={() => void load({ silent: true })}
                />
              </TabsContent>

              <TabsContent value="prospecting" className="mt-5">
                <ProspectingBotPanel />
              </TabsContent>

              <TabsContent value="campaigns" className="mt-5">
                <CampaignsPanel />
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
