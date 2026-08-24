import { Activity, Gavel, Landmark, LineChart, Truck, type LucideIcon } from "lucide-react";

import { AnalyticsTrendChart } from "@/components/analytics/analytics-charts";
import { AnalyticsScorecard } from "@/components/analytics/analytics-scorecard";
import { AnalyticsKpiStrip, AnalyticsPanelHeader } from "@/components/analytics/kpi-strip";
import type { AnalyticsKpi, DomainAnalytics, ScorecardRow } from "@/lib/analytics-kpis";
import { t } from "@/lib/i18n/t";

type PanelHandlers = {
  onKpi: (kpi: AnalyticsKpi) => void;
  onScorecard: (row: ScorecardRow, title: string) => void;
};

function DomainLayout({
  icon,
  title,
  description,
  domain,
  onKpi,
  onScorecard,
  chartVariant = "area",
  scoreAsMoney = false,
  kpiColumns = 5,
}: PanelHandlers & {
  icon: LucideIcon;
  title: string;
  description: string;
  domain: DomainAnalytics;
  chartVariant?: "area" | "bar";
  scoreAsMoney?: boolean;
  kpiColumns?: 3 | 4 | 5 | 6;
}) {
  return (
    <div className="animate-in fade-in-0 duration-300 space-y-5 motion-reduce:animate-none">
      <AnalyticsPanelHeader icon={icon} title={title} description={description} />
      <AnalyticsKpiStrip kpis={domain.kpis} onSelect={onKpi} columns={kpiColumns} />
      <div className="grid gap-4 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <AnalyticsTrendChart
            title={domain.seriesLabel}
            description={
              domain.secondarySeriesLabel
                ? `${domain.seriesLabel} vs ${domain.secondarySeriesLabel}`
                : undefined
            }
            data={domain.series}
            primaryLabel={domain.seriesLabel}
            secondaryLabel={domain.secondarySeriesLabel}
            variant={chartVariant}
          />
        </div>
        <div className="lg:col-span-2">
          <AnalyticsScorecard
            title={domain.scorecardTitle}
            rows={domain.scorecard}
            scoreAsMoney={scoreAsMoney}
            onRowClick={(row) => onScorecard(row, domain.scorecardTitle)}
          />
        </div>
      </div>
    </div>
  );
}

export function OverviewPanel({
  domain,
  onKpi,
  onScorecard,
}: PanelHandlers & { domain: DomainAnalytics }) {
  return (
    <DomainLayout
      icon={LineChart}
      title={t("Overview")}
      description={t(
        "Cross-domain KPIs reproducible from analytics event tables — click any KPI to drill through.",
      )}
      domain={domain}
      onKpi={onKpi}
      onScorecard={onScorecard}
      kpiColumns={6}
    />
  );
}

export function OpsPanel({
  domain,
  onKpi,
  onScorecard,
}: PanelHandlers & { domain: DomainAnalytics }) {
  return (
    <DomainLayout
      icon={Truck}
      title={t("Operations")}
      description={t("Time-to-cover, OTD/OTA, dwell, exception rates, and carrier scorecards.")}
      domain={domain}
      onKpi={onKpi}
      onScorecard={onScorecard}
      chartVariant="bar"
    />
  );
}

export function FinancePanel({
  domain,
  onKpi,
  onScorecard,
}: PanelHandlers & { domain: DomainAnalytics }) {
  return (
    <DomainLayout
      icon={Landmark}
      title={t("Finance")}
      description={t("Margin per mile, margin vs target, DSO, aged AR, and factoring utilization.")}
      domain={domain}
      onKpi={onKpi}
      onScorecard={onScorecard}
      scoreAsMoney
    />
  );
}

export function SalesPanel({
  domain,
  onKpi,
  onScorecard,
}: PanelHandlers & { domain: DomainAnalytics }) {
  return (
    <DomainLayout
      icon={Activity}
      title={t("Sales")}
      description={t(
        "Hit rate, pipeline velocity, and campaign performance from CRM + quotes events.",
      )}
      domain={domain}
      onKpi={onKpi}
      onScorecard={onScorecard}
      kpiColumns={4}
    />
  );
}

export function BiddingPanel({
  domain,
  onKpi,
  onScorecard,
}: PanelHandlers & { domain: DomainAnalytics }) {
  return (
    <DomainLayout
      icon={Gavel}
      title={t("Bidding")}
      description={t("Historical vs DAT spread, win-rate by lane/ZIP3, and backhaul success.")}
      domain={domain}
      onKpi={onKpi}
      onScorecard={onScorecard}
      kpiColumns={4}
    />
  );
}
