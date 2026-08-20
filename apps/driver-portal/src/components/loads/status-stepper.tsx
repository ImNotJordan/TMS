import { Check } from "lucide-react";

import { STATUS_STEPS, type ActiveLoadStatus } from "@/lib/mock-data";
import { cn } from "@/lib/utils";

export function StatusStepper({ status }: { status: ActiveLoadStatus }) {
  const currentIndex = STATUS_STEPS.findIndex((s) => s.key === status);

  return (
    <ol>
      {STATUS_STEPS.map((step, i) => {
        const done = i < currentIndex;
        const current = i === currentIndex;
        const isLast = i === STATUS_STEPS.length - 1;
        return (
          <li key={step.key} className="flex gap-3">
            <div className="flex flex-col items-center">
              <div
                className={cn(
                  "flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 font-mono text-[11px] font-semibold",
                  done && "border-success bg-success text-success-foreground",
                  current && "border-amber bg-amber text-ink",
                  !done && !current && "border-border bg-background text-muted-foreground",
                )}
              >
                {done ? <Check className="h-3.5 w-3.5" /> : i + 1}
              </div>
              {!isLast ? (
                <div className={cn("min-h-7 w-px flex-1", done ? "bg-success" : "bg-border")} />
              ) : null}
            </div>
            <div
              className={cn(
                "pb-5 pt-0.5 text-sm",
                current ? "font-heading font-bold text-foreground" : done ? "text-foreground/80" : "text-muted-foreground",
              )}
            >
              {step.label}
              {current ? <span className="ml-1.5 text-[10px] font-sans font-semibold uppercase tracking-wide text-amber-dim">Live</span> : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
