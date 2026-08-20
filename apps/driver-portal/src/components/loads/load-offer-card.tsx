import { ArrowRight, Gauge, Scale, Truck, UserCheck } from "lucide-react";
import { Link } from "@tanstack/react-router";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { Load } from "@/lib/mock-data";
import { cn } from "@/lib/utils";

export function LoadOfferCard({
  load,
  onAccept,
  onDecline,
}: {
  load: Load;
  onAccept?: () => void;
  onDecline?: () => void;
}) {
  const perMile = (load.rate / load.distanceMiles).toFixed(2);

  return (
    <Card
      className={cn(
        "overflow-hidden shadow-sm",
        load.assignedByDispatch ? "border-primary/40 ring-1 ring-primary/15" : "border-border/70",
      )}
    >
      <CardContent className="p-4">
        {load.assignedByDispatch ? (
          <div className="mb-3 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-primary">
            <UserCheck className="h-3.5 w-3.5" /> Assigned to you · accept to start
          </div>
        ) : null}
        <Link to="/loads/$loadId" params={{ loadId: load.id }} className="block">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 font-heading text-base font-bold text-foreground">
                <span className="truncate">
                  {load.pickup.city}, {load.pickup.state}
                </span>
                <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate">
                  {load.delivery.city}, {load.delivery.state}
                </span>
              </div>
              <div className="mt-0.5 font-mono text-xs text-muted-foreground">{load.pickup.window}</div>
            </div>
            <Badge variant="secondary" className="shrink-0">
              {load.equipment}
            </Badge>
          </div>

          <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
            <div>
              <div className="flex items-center gap-1 text-muted-foreground">
                <Gauge className="h-3.5 w-3.5" /> Distance
              </div>
              <div className="mt-0.5 font-mono font-medium text-foreground">{load.distanceMiles} mi</div>
            </div>
            <div>
              <div className="flex items-center gap-1 text-muted-foreground">
                <Scale className="h-3.5 w-3.5" /> Weight
              </div>
              <div className="mt-0.5 font-mono font-medium text-foreground">
                {load.weightLbs.toLocaleString()} lb
              </div>
            </div>
            <div className="text-right">
              <div className="flex items-center justify-end gap-1 text-muted-foreground">
                <Truck className="h-3.5 w-3.5" /> Rate
              </div>
              <div className="mt-0.5 font-mono font-semibold text-success">
                ${load.rate.toLocaleString()} · ${perMile}/mi
              </div>
            </div>
          </div>
        </Link>

        {onAccept && onDecline ? (
          <div className="mt-3 flex gap-2">
            <Button variant="outline" size="sm" className="flex-1" onClick={onDecline}>
              Decline
            </Button>
            <Button size="sm" className="flex-1" onClick={onAccept}>
              Accept
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
