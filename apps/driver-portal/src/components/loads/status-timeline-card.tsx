import { ArrowRight, Check, CheckCircle2, ClipboardCheck, MapPin, Package, Truck } from "lucide-react";

import { STATUS_STEPS, type ActiveLoadStatus } from "@/lib/mock-data";
import { cn } from "@/lib/utils";

const STAGE_ICONS: Record<ActiveLoadStatus, typeof Truck> = {
  assigned: ClipboardCheck,
  "en-route-pickup": Truck,
  "at-pickup": MapPin,
  loaded: Package,
  "en-route-delivery": Truck,
  "at-delivery": MapPin,
  delivered: CheckCircle2,
};

/**
 * Pure presentation: `currentStage` is a display prop and `onAdvance` is an
 * emitted UI event — the caller owns whether/how the stage actually advances.
 */
export function StatusTimelineCard({
  currentStage,
  onAdvance,
}: {
  currentStage: ActiveLoadStatus;
  onAdvance?: () => void;
}) {
  const currentIndex = STATUS_STEPS.findIndex((s) => s.key === currentStage);
  const nextStep = STATUS_STEPS[currentIndex + 1];

  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <h3 className="font-heading text-base font-bold text-foreground">Status</h3>

      <ol className="mt-4">
        {STATUS_STEPS.map((step, i) => {
          const done = i < currentIndex;
          const current = i === currentIndex;
          const isLast = i === STATUS_STEPS.length - 1;
          const StageIcon = STAGE_ICONS[step.key];

          return (
            <li key={step.key} className="flex gap-3">
              <div className="flex flex-col items-center">
                <div
                  className={cn(
                    "flex h-9 w-9 shrink-0 items-center justify-center rounded-full",
                    done && "bg-success text-success-foreground",
                    current && "bg-amber text-ink ring-4 ring-amber/20",
                    !done && !current && "bg-muted text-muted-foreground",
                  )}
                >
                  {done ? <Check className="h-4 w-4" /> : <StageIcon className="h-4 w-4" />}
                </div>
                {!isLast ? (
                  <div
                    className={cn(
                      "my-1 min-h-7 w-0 flex-1 border-l-2",
                      done ? "border-solid border-success" : "border-dashed border-border",
                    )}
                  />
                ) : null}
              </div>

              <div className={cn("pt-1.5", !isLast && "pb-5")}>
                <div className="flex items-center gap-1.5">
                  <span
                    className={cn(
                      "text-sm",
                      current
                        ? "font-heading font-bold text-foreground"
                        : done
                          ? "text-foreground/80"
                          : "text-muted-foreground",
                    )}
                  >
                    {step.label}
                  </span>
                  {current ? (
                    <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-amber-dim">
                      <span className="h-1.5 w-1.5 rounded-full bg-amber animate-pulse" />
                      Live
                    </span>
                  ) : null}
                </div>
              </div>
            </li>
          );
        })}
      </ol>

      {nextStep ? (
        <button
          type="button"
          onClick={onAdvance}
          className="mt-1 flex w-full items-center justify-center gap-1.5 rounded-full bg-amber py-3.5 font-heading text-sm font-bold text-ink"
        >
          Mark as: {nextStep.label} <ArrowRight className="h-4 w-4" />
        </button>
      ) : (
        <div className="mt-1 rounded-full bg-success/10 py-3.5 text-center text-sm font-semibold text-success">
          Delivered ✓
        </div>
      )}
    </div>
  );
}
