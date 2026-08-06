import { CheckCircle2, Gauge, Truck } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";

type QuickStatsProps = {
  milesToday?: number;
  activeCount?: number;
  deliveredCount?: number;
};

export function QuickStats({
  milesToday = 0,
  activeCount = 0,
  deliveredCount = 0,
}: QuickStatsProps) {
  const stats: { label: string; value: string; icon: LucideIcon }[] = [
    {
      label: "Miles on file",
      value: milesToday > 0 ? String(milesToday) : "—",
      icon: Gauge,
    },
    {
      label: "Active loads",
      value: String(activeCount),
      icon: Truck,
    },
    {
      label: "Delivered",
      value: String(deliveredCount),
      icon: CheckCircle2,
    },
  ];

  return (
    <div className="grid grid-cols-3 gap-2.5">
      {stats.map((s) => {
        const Icon = s.icon;
        return (
          <Card key={s.label} className="border-border/70 shadow-sm">
            <CardContent className="flex flex-col gap-1.5 p-3">
              <Icon className="h-4 w-4 text-amber-dim" />
              <div className="font-mono text-sm font-semibold tracking-tight text-foreground">
                {s.value}
              </div>
              <div className="text-[10px] uppercase tracking-wide leading-tight text-muted-foreground">
                {s.label}
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
