import { CheckCircle2, Gauge, Truck } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

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
  const stats: { label: string; value: string; icon: LucideIcon; tone: string }[] = [
    {
      label: "Miles on file",
      value: milesToday > 0 ? String(milesToday) : "—",
      icon: Gauge,
      tone: "bg-info/12 text-info",
    },
    {
      label: "Active loads",
      value: String(activeCount),
      icon: Truck,
      tone: "bg-amber/15 text-amber-dim",
    },
    {
      label: "Delivered",
      value: String(deliveredCount),
      icon: CheckCircle2,
      tone: "bg-success/12 text-success",
    },
  ];

  return (
    <div className="grid grid-cols-3 gap-2.5">
      {stats.map((s) => {
        const Icon = s.icon;
        return (
          <Card key={s.label} className="border-border/70 shadow-sm">
            <CardContent className="flex flex-col gap-2 p-3">
              <span
                className={cn(
                  "flex h-7 w-7 items-center justify-center rounded-full",
                  s.tone,
                )}
              >
                <Icon className="h-3.5 w-3.5" />
              </span>
              <div className="font-mono text-sm font-semibold tracking-tight text-foreground">
                {s.value}
              </div>
              <div className="text-[10px] leading-tight text-muted-foreground">{s.label}</div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
