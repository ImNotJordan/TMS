import { Link } from "@tanstack/react-router";
import { Package } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { LoadOfferCard } from "@/components/loads/load-offer-card";
import type { Load } from "@/lib/mock-data";

export function NoActiveLoadCard({
  offeredLoads,
  onAccept,
  onDecline,
}: {
  offeredLoads: Load[];
  onAccept: (id: string) => void;
  onDecline: (id: string) => void;
}) {
  return (
    <Card className="border-border/70 shadow-sm">
      <CardContent className="p-5 text-center">
        <Package className="mx-auto h-8 w-8 text-muted-foreground" />
        <p className="mt-2 text-sm font-medium text-foreground">No active load</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Browse available loads and accept one to get rolling.
        </p>
        <Button asChild className="mt-4" size="sm">
          <Link to="/loads">Browse loads</Link>
        </Button>
      </CardContent>

      <Separator />

      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <h3 className="font-heading text-sm font-bold text-foreground">Available near you</h3>
          <Link to="/loads" className="text-xs font-semibold text-amber-dim hover:underline">
            See all
          </Link>
        </div>
        <div className="mt-3 space-y-3">
          {offeredLoads.length === 0 ? (
            <p className="text-center text-xs text-muted-foreground">
              No new load offers right now
            </p>
          ) : (
            offeredLoads.slice(0, 2).map((load) => (
              <LoadOfferCard
                key={load.id}
                load={load}
                onAccept={() => onAccept(load.id)}
                onDecline={() => onDecline(load.id)}
              />
            ))
          )}
        </div>
      </CardContent>
    </Card>
  );
}
