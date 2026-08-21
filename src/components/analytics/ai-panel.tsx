import * as React from "react";
import { Link } from "@tanstack/react-router";
import {
  Brain,
  Loader2,
  MapPinned,
  Route,
  Settings2,
  ShieldAlert,
  Sparkles,
  Wand2,
} from "lucide-react";
import { toast } from "sonner";

import { AnalyticsScorecard } from "@/components/analytics/analytics-scorecard";
import { AnalyticsKpiStrip, AnalyticsPanelHeader } from "@/components/analytics/kpi-strip";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useWorkspaceAi } from "@/hooks/use-workspace-ai";
import {
  enrichBackhaulWhatIfWithAi,
  explainAnalyticsScorecard,
  generateAnalyticsAiBriefing,
} from "@/lib/analytics-ai";
import type { AnalyticsKpi, ScorecardRow } from "@/lib/analytics-kpis";
import { scoreBackhaulWhatIf } from "@/lib/analytics-kpis";
import { formatMoneyCompact } from "@/lib/dashboard-data";
import { getWorkspaceAiModel } from "@/lib/ai-client";
import { cn } from "@/lib/utils";
import { t } from "@/lib/i18n/t";

function SectionLabel({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="mb-3 flex items-start justify-between gap-3">
      <div className="flex min-w-0 items-start gap-2.5">
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted text-foreground">
          <Icon className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-foreground">{title}</h3>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>
      </div>
      {action}
    </div>
  );
}

function AiNarrativeBox({
  title,
  text,
  loading,
  error,
}: {
  title: string;
  text: string | null;
  loading?: boolean;
  error?: string | null;
}) {
  if (!loading && !text && !error) return null;
  return (
    <div className="mt-3 rounded-lg border border-border/70 bg-muted/25 px-3 py-2.5">
      <div className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        <Wand2 className="h-3 w-3 text-primary" />
        {title}
      </div>
      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          {t("Calling workspace AI…")}
        </div>
      ) : (
        <>
          {text && (
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">{text}</p>
          )}
          {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
        </>
      )}
    </div>
  );
}

export function AiPanel({
  reliability,
  lanes,
  credit,
  kpis,
  onKpi,
  onScorecard,
}: {
  reliability: ScorecardRow[];
  lanes: ScorecardRow[];
  credit: ScorecardRow[];
  kpis: AnalyticsKpi[];
  onKpi: (kpi: AnalyticsKpi) => void;
  onScorecard: (row: ScorecardRow, title: string) => void;
}) {
  const { ready, status } = useWorkspaceAi();
  const model = ready ? getWorkspaceAiModel() : null;

  const [origin, setOrigin] = React.useState("");
  const [destination, setDestination] = React.useState("");
  const [emptyMiles, setEmptyMiles] = React.useState("");
  const [equipment, setEquipment] = React.useState("Dry Van");

  const scenario = React.useMemo(
    () =>
      scoreBackhaulWhatIf({
        origin,
        destination,
        emptyMiles: Number(emptyMiles) || 0,
        equipment,
      }),
    [origin, destination, emptyMiles, equipment],
  );

  const [briefing, setBriefing] = React.useState<string | null>(null);
  const [briefingLoading, setBriefingLoading] = React.useState(false);
  const [briefingError, setBriefingError] = React.useState<string | null>(null);

  const [explainDomain, setExplainDomain] = React.useState<
    "reliability" | "lanes" | "credit" | null
  >(null);
  const [explainText, setExplainText] = React.useState<Record<string, string>>({});
  const [explainError, setExplainError] = React.useState<Record<string, string>>({});

  const [copilotNotes, setCopilotNotes] = React.useState<string[] | null>(null);
  const [copilotStrategy, setCopilotStrategy] = React.useState<string | null>(null);
  const [copilotLoading, setCopilotLoading] = React.useState(false);
  const [copilotError, setCopilotError] = React.useState<string | null>(null);
  const [copilotUsedAi, setCopilotUsedAi] = React.useState(false);

  // Reset AI enrichment when scenario inputs change
  React.useEffect(() => {
    setCopilotNotes(null);
    setCopilotStrategy(null);
    setCopilotError(null);
    setCopilotUsedAi(false);
  }, [origin, destination, emptyMiles, equipment]);

  const abortRef = React.useRef<AbortController | null>(null);
  React.useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  const requireAiOrToast = React.useCallback(() => {
    if (ready) return true;
    toast.message("OpenAI not connected", {
      description: "Add your API key in Settings → Integrations to use AI Insights.",
      action: {
        label: "Settings",
        onClick: () => {
          window.location.assign("/settings");
        },
      },
    });
    return false;
  }, [ready]);

  const runBriefing = React.useCallback(async () => {
    if (!requireAiOrToast()) return;
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setBriefingLoading(true);
    setBriefingError(null);
    const result = await generateAnalyticsAiBriefing(
      { kpis, reliability, lanes, credit },
      ac.signal,
    );
    if (ac.signal.aborted) return;
    setBriefingLoading(false);
    if (result.usedAi) {
      setBriefing(result.text);
      toast.success("AI briefing ready", { description: model ?? "Workspace AI" });
    } else {
      setBriefing(result.text);
      setBriefingError(result.error ?? null);
      if (result.error) toast.error("AI briefing failed", { description: result.error });
    }
  }, [credit, kpis, lanes, model, reliability, requireAiOrToast]);

  const runExplain = React.useCallback(
    async (domain: "reliability" | "lanes" | "credit") => {
      if (!requireAiOrToast()) return;
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;
      setExplainDomain(domain);
      setExplainError((prev) => {
        const next = { ...prev };
        delete next[domain];
        return next;
      });
      const rows = domain === "reliability" ? reliability : domain === "lanes" ? lanes : credit;
      const result = await explainAnalyticsScorecard({ domain, rows, signal: ac.signal });
      if (ac.signal.aborted) return;
      setExplainDomain(null);
      if (result.usedAi) {
        setExplainText((prev) => ({ ...prev, [domain]: result.text }));
      } else {
        setExplainText((prev) => ({ ...prev, [domain]: result.text }));
        if (result.error) {
          setExplainError((prev) => ({ ...prev, [domain]: result.error! }));
          toast.error("AI explain failed", { description: result.error });
        }
      }
    },
    [credit, lanes, reliability, requireAiOrToast],
  );

  const runCopilotAi = React.useCallback(async () => {
    if (!requireAiOrToast()) return;
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setCopilotLoading(true);
    setCopilotError(null);
    const result = await enrichBackhaulWhatIfWithAi(
      {
        origin,
        destination,
        emptyMiles: Number(emptyMiles) || 0,
        equipment,
        uplift: scenario.uplift,
        fillProbability: scenario.fillProbability,
        recommendedBid: scenario.recommendedBid,
        baselineNotes: scenario.notes,
      },
      ac.signal,
    );
    if (ac.signal.aborted) return;
    setCopilotLoading(false);
    setCopilotNotes(result.notes);
    setCopilotStrategy(result.strategy ?? null);
    setCopilotUsedAi(result.usedAi);
    setCopilotError(result.error ?? null);
    if (result.usedAi) {
      toast.success("Copilot strategy ready");
    } else if (result.error) {
      toast.error("Copilot AI failed", { description: result.error });
    }
  }, [
    destination,
    emptyMiles,
    equipment,
    origin,
    requireAiOrToast,
    scenario.fillProbability,
    scenario.notes,
    scenario.recommendedBid,
    scenario.uplift,
  ]);

  const displayNotes = copilotNotes ?? scenario.notes;
  const statusTone =
    status === "Connected"
      ? "bg-success/15 text-success"
      : status === "Attention"
        ? "bg-warning/20 text-warning-foreground"
        : "bg-muted text-muted-foreground";

  return (
    <div className="animate-in fade-in-0 duration-300 space-y-5 motion-reduce:animate-none">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <AnalyticsPanelHeader
          icon={Brain}
          title={t("AI Insights")}
          description={t(
            "Event-table scores plus live narratives from your Settings → Integrations OpenAI key.",
          )}
        />
        <div className="flex flex-wrap items-center gap-2 sm:justify-end">
          <Badge variant="secondary" className={cn("font-normal", statusTone)}>
            AI {status}
            {model ? ` · ${model}` : ""}
          </Badge>
          {!ready && (
            <Button asChild size="sm" variant="outline" className="gap-1.5">
              <Link to="/settings">
                <Settings2 className="h-3.5 w-3.5" />
                {t("Connect AI")}
              </Link>
            </Button>
          )}
          <Button
            size="sm"
            className="gap-1.5"
            onClick={() => void runBriefing()}
            disabled={briefingLoading}
          >
            {briefingLoading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Wand2 className="h-3.5 w-3.5" />
            )}
            Generate briefing
          </Button>
        </div>
      </div>

      <AiNarrativeBox
        title={t("Workspace AI briefing")}
        text={briefing}
        loading={briefingLoading}
        error={briefingError}
      />

      <AnalyticsKpiStrip kpis={kpis} onSelect={onKpi} columns={3} />

      <div className="grid gap-4 lg:grid-cols-2">
        <div>
          <SectionLabel
            icon={ShieldAlert}
            title={t("Predictive Carrier Reliability Score")}
            description={t(
              "Blends OTD, claims rate, and insurance verification — explain with workspace AI.",
            )}
            action={
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-8 gap-1 shrink-0"
                disabled={explainDomain === "reliability"}
                onClick={() => void runExplain("reliability")}
              >
                {explainDomain === "reliability" ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Wand2 className="h-3.5 w-3.5" />
                )}
                Explain
              </Button>
            }
          />
          <AnalyticsScorecard
            title={t("Ranked carriers")}
            rows={reliability}
            onRowClick={(row) => onScorecard(row, "Carrier reliability")}
          />
          <AiNarrativeBox
            title={t("AI read — reliability")}
            text={explainText.reliability ?? null}
            loading={explainDomain === "reliability"}
            error={explainError.reliability ?? null}
          />
        </div>

        <div>
          <SectionLabel
            icon={MapPinned}
            title={t("Dynamic Lane Profitability & Network Design")}
            description={t("Margin density by lane — grow / optimize / exit, with AI commentary.")}
            action={
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-8 gap-1 shrink-0"
                disabled={explainDomain === "lanes"}
                onClick={() => void runExplain("lanes")}
              >
                {explainDomain === "lanes" ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Wand2 className="h-3.5 w-3.5" />
                )}
                Explain
              </Button>
            }
          />
          <AnalyticsScorecard
            title={t("Lane scores")}
            rows={lanes}
            onRowClick={(row) => onScorecard(row, "Lane profitability")}
          />
          <AiNarrativeBox
            title={t("AI read — lanes")}
            text={explainText.lanes ?? null}
            loading={explainDomain === "lanes"}
            error={explainError.lanes ?? null}
          />
        </div>

        <div>
          <SectionLabel
            icon={Sparkles}
            title={t("Customer Risk & Credit AI")}
            description={t(
              "Credit bands and exposure from events — deepen with the Integrations model.",
            )}
            action={
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-8 gap-1 shrink-0"
                disabled={explainDomain === "credit"}
                onClick={() => void runExplain("credit")}
              >
                {explainDomain === "credit" ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Wand2 className="h-3.5 w-3.5" />
                )}
                Explain
              </Button>
            }
          />
          <AnalyticsScorecard
            title={t("Watchlist (lowest score first)")}
            rows={credit}
            onRowClick={(row) => onScorecard(row, "Customer credit risk")}
          />
          <AiNarrativeBox
            title={t("AI read — credit")}
            text={explainText.credit ?? null}
            loading={explainDomain === "credit"}
            error={explainError.credit ?? null}
          />
        </div>

        <div className="rounded-xl border border-border/70 bg-card/60 p-4 shadow-sm">
          <SectionLabel
            icon={Route}
            title={t("Load Optimization Copilot")}
            description={t(
              "Deterministic uplift/bid math, then optional strategy from your OpenAI key.",
            )}
          />
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="bh-origin">{t("Origin")}</Label>
                <Input
                  id="bh-origin"
                  value={origin}
                  onChange={(e) => setOrigin(e.target.value)}
                  placeholder={t("City, ST")}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="bh-dest">{t("Destination")}</Label>
                <Input
                  id="bh-dest"
                  value={destination}
                  onChange={(e) => setDestination(e.target.value)}
                  placeholder={t("City, ST")}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="bh-empty">{t("Empty miles")}</Label>
                <Input
                  id="bh-empty"
                  type="number"
                  min={0}
                  value={emptyMiles}
                  onChange={(e) => setEmptyMiles(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="bh-eq">{t("Equipment")}</Label>
                <Input
                  id="bh-eq"
                  value={equipment}
                  onChange={(e) => setEquipment(e.target.value)}
                />
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-lg border border-border/70 bg-muted/30 p-3">
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  {t("Est. uplift")}
                </div>
                <div className="mt-1 text-xl font-semibold tabular-nums text-foreground">
                  {formatMoneyCompact(scenario.uplift)}
                </div>
              </div>
              <div className="rounded-lg border border-border/70 bg-muted/30 p-3">
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  {t("Fill probability")}
                </div>
                <div className="mt-1 text-xl font-semibold tabular-nums text-foreground">
                  {(scenario.fillProbability * 100).toFixed(0)}%
                </div>
              </div>
              <div className="rounded-lg border border-border/70 bg-muted/30 p-3">
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  {t("Recommended bid")}
                </div>
                <div className="mt-1 text-xl font-semibold tabular-nums text-foreground">
                  {formatMoneyCompact(scenario.recommendedBid)}
                </div>
              </div>
            </div>

            <ul className="space-y-2">
              {displayNotes.map((note) => (
                <li
                  key={note}
                  className="flex items-start gap-2 rounded-md border border-border/50 bg-background/60 px-3 py-2 text-sm text-muted-foreground"
                >
                  <Badge variant="secondary" className="mt-0.5 shrink-0">
                    {copilotUsedAi ? "AI" : "Tip"}
                  </Badge>
                  <span>{note}</span>
                </li>
              ))}
            </ul>

            {copilotStrategy && (
              <div className="rounded-lg border border-primary/25 bg-primary/5 px-3 py-2.5 text-sm text-foreground">
                <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-primary">
                  {t("Recommended strategy")}
                </div>
                <p className="leading-relaxed">{copilotStrategy}</p>
              </div>
            )}

            {copilotLoading && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                {t("Asking workspace AI for strategy…")}
              </div>
            )}
            {copilotError && <p className="text-xs text-destructive">{copilotError}</p>}

            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                className="gap-1.5"
                disabled={copilotLoading}
                onClick={() => void runCopilotAi()}
              >
                {copilotLoading ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Wand2 className="h-3.5 w-3.5" />
                )}
                Ask AI for strategy
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={() =>
                  onScorecard(
                    {
                      id: "copilot-scenario",
                      name: `${origin} → ${destination}`,
                      score: Math.round(scenario.fillProbability * 100),
                      meta: `Uplift ${formatMoneyCompact(scenario.uplift)}`,
                      eventIds: [],
                    },
                    "Backhaul what-if",
                  )
                }
              >
                {t("Show related bid events")}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
