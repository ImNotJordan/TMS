import { ArrowRight, Navigation, Truck } from "lucide-react";
import { Link } from "@tanstack/react-router";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { STATUS_LABELS, STATUS_STEPS, type ActiveLoadStatus, type Load } from "@/lib/mock-data";

export function ActiveLoadCard({ load }: { load: Load }) {
  const milesRemaining = Math.max(12, Math.round(load.distanceMiles * 0.4));
  const currentIndex = STATUS_STEPS.findIndex((s) => s.key === (load.status as ActiveLoadStatus));
  const progressPct = Math.round(((currentIndex + 1) / STATUS_STEPS.length) * 100);

  return (
    <div className="relative overflow-hidden rounded-2xl border border-sidebar-border bg-gradient-to-br from-ink-elevated to-ink p-5 text-sidebar-foreground shadow-lg">
      <div aria-hidden className="absolute -right-16 -top-16 h-48 w-48 rounded-full bg-amber/15 blur-3xl" />

      <div className="relative flex items-center justify-between">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-sidebar-accent/60 px-2.5 py-1 text-[10px] font-heading font-bold uppercase tracking-wider text-sidebar-foreground/80">
          <Navigation className="h-3 w-3 text-amber" /> Active load
        </span>
        <Badge className="bg-sidebar-primary font-mono text-sidebar-primary-foreground">
          {load.id}
        </Badge>
      </div>

      <div className="relative mt-5">
        <div className="flex items-start justify-between gap-2 font-heading text-base font-bold text-white">
          <span className="truncate">
            {load.pickup.city}, {load.pickup.state}
          </span>
          <span className="truncate text-right">
            {load.delivery.city}, {load.delivery.state}
          </span>
        </div>

        {/* Route strip — origin dot, amber progress fill, live truck marker, destination dot */}
        <div className="relative mt-4 h-2 rounded-full bg-white/10">
          <div
            className="h-full rounded-full bg-amber transition-[width] duration-700 ease-out"
            style={{ width: `${progressPct}%` }}
          />
          <span className="absolute left-0 top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-success ring-2 ring-ink" />
          <span className="absolute right-0 top-1/2 h-2.5 w-2.5 translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white/50 bg-ink" />
          <div
            className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 transition-[left] duration-700 ease-out"
            style={{ left: `${progressPct}%` }}
          >
            <span
              aria-hidden
              className="amber-glow absolute -inset-1.5 rounded-full bg-amber/50 blur-md"
            />
            <div className="truck-nudge relative flex h-6 w-6 items-center justify-center rounded-full bg-amber text-ink shadow-[0_0_0_3px_var(--ink)]">
              <Truck className="h-3.5 w-3.5" />
            </div>
          </div>
        </div>

        <div className="mt-2 flex items-center justify-between text-[10px] uppercase tracking-wider text-sidebar-foreground/50">
          <span>Pickup</span>
          <span>Delivery</span>
        </div>
      </div>

      <div className="relative mt-4 flex items-center justify-between rounded-xl border border-white/8 bg-black/15 px-3 py-2.5">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-sidebar-foreground/50">Status</div>
          <div className="flex items-center gap-1.5 text-sm font-semibold text-white">
            <span className="h-1.5 w-1.5 rounded-full bg-amber" />
            {STATUS_LABELS[load.status]}
          </div>
        </div>
        <div className="text-right">
          <div className="text-[10px] uppercase tracking-wider text-sidebar-foreground/50">Distance left</div>
          <div className="font-mono text-sm font-semibold text-white">~{milesRemaining} mi</div>
        </div>
      </div>

      <Button asChild variant="amber" className="relative mt-4 w-full gap-1.5">
        <Link to="/loads/$loadId" params={{ loadId: load.id }}>
          View & update status <ArrowRight className="h-4 w-4" />
        </Link>
      </Button>
    </div>
  );
}
