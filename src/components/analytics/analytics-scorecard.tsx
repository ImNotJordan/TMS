import { Link } from "@tanstack/react-router";
import { ArrowUpRight } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import type { ScorecardRow } from "@/lib/analytics-kpis";
import { cn } from "@/lib/utils";
import { t } from "@/lib/i18n/t";

export function AnalyticsScorecard({
  title,
  description,
  rows,
  onRowClick,
  scoreAsMoney = false,
}: {
  title: string;
  description?: string;
  rows: ScorecardRow[];
  onRowClick?: (row: ScorecardRow) => void;
  scoreAsMoney?: boolean;
}) {
  const maxScore = Math.max(1, ...rows.map((r) => Math.abs(r.score)));

  return (
    <Card className="border-border/70 shadow-sm">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold">{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent className="space-y-2">
        {rows.length === 0 ? (
          <div className="flex h-32 items-center justify-center rounded-lg border border-dashed border-border text-sm text-muted-foreground">
            {t("No rows for this period.")}
          </div>
        ) : (
          rows.map((row) => {
            const pct = Math.min(100, (Math.abs(row.score) / maxScore) * 100);
            const body = (
              <div
                className={cn(
                  "rounded-lg border border-border/60 bg-card/40 px-3 py-2.5 transition-colors",
                  onRowClick && "cursor-pointer hover:border-primary/40 hover:bg-muted/40",
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-foreground">{row.name}</div>
                    {row.meta && !scoreAsMoney && (
                      <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
                        {row.meta}
                      </div>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <Badge variant="secondary" className="tabular-nums">
                      {scoreAsMoney
                        ? (row.meta ?? `$${Math.round(row.score).toLocaleString()}`)
                        : row.score}
                    </Badge>
                    {row.href && <ArrowUpRight className="h-3.5 w-3.5 text-muted-foreground" />}
                  </div>
                </div>
                {!scoreAsMoney && <Progress value={pct} className="mt-2 h-1.5" />}
              </div>
            );

            if (onRowClick) {
              return (
                <button
                  key={row.id}
                  type="button"
                  className="block w-full text-left"
                  onClick={() => onRowClick(row)}
                >
                  {body}
                </button>
              );
            }
            if (row.href) {
              return (
                <Link key={row.id} to={row.href} className="block">
                  {body}
                </Link>
              );
            }
            return <div key={row.id}>{body}</div>;
          })
        )}
      </CardContent>
    </Card>
  );
}
