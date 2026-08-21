import { MapPin, Navigation } from "lucide-react";
import { Badge } from "@/components/ui/badge";

import type { ShipmentPin } from "@/lib/dashboard-data";
import { t } from "@/lib/i18n/t";

const toneClass = {
  success: "bg-success text-success-foreground",
  warning: "bg-warning text-warning-foreground",
  destructive: "bg-destructive text-destructive-foreground",
} as const;

export function ShipmentMap({ pins }: { pins: ShipmentPin[] }) {
  return (
    <div className="relative h-[280px] overflow-hidden rounded-xl border border-border bg-gradient-to-br from-sidebar/95 via-sidebar to-sidebar/90">
      {/* faux map grid */}
      <svg className="absolute inset-0 h-full w-full opacity-30" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
            <path
              d="M 40 0 L 0 0 0 40"
              fill="none"
              stroke="oklch(0.55 0.16 255)"
              strokeOpacity="0.25"
              strokeWidth="0.5"
            />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#grid)" />
      </svg>

      {/* faux routes */}
      <svg
        className="absolute inset-0 h-full w-full"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
      >
        <path
          d="M 8,70 Q 30,30 55,55 T 95,40"
          stroke="oklch(0.65 0.18 250)"
          strokeWidth="0.4"
          strokeDasharray="1.2 1"
          fill="none"
        />
        <path
          d="M 5,40 Q 35,55 65,35 T 92,60"
          stroke="oklch(0.7 0.16 195)"
          strokeWidth="0.3"
          strokeDasharray="1.2 1"
          fill="none"
        />
      </svg>

      {pins.map((p) => (
        <div
          key={p.id}
          className="group absolute -translate-x-1/2 -translate-y-1/2"
          style={{ left: `${p.x}%`, top: `${p.y}%` }}
        >
          <div
            className={`flex h-7 w-7 items-center justify-center rounded-full ring-4 ring-sidebar/80 ${toneClass[p.tone]}`}
          >
            <MapPin className="h-3.5 w-3.5" />
          </div>
          <div className="pointer-events-none absolute left-1/2 top-full mt-1 -translate-x-1/2 whitespace-nowrap rounded-md bg-popover px-2 py-0.5 text-[10px] font-medium text-popover-foreground opacity-0 shadow-md transition-opacity group-hover:opacity-100">
            {p.id} · {p.status}
          </div>
        </div>
      ))}

      {pins.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center px-6 text-center text-sm text-sidebar-foreground/70">
          {t("No shipments in transit — dispatched and in-transit loads appear here.")}
        </div>
      )}

      <div className="absolute left-3 top-3">
        <Badge className="gap-1 bg-sidebar-accent text-sidebar-accent-foreground">
          <Navigation className="h-3 w-3" /> Live tracking · {pins.length} active
        </Badge>
      </div>
      <div className="absolute bottom-3 right-3 flex gap-1">
        <span className="rounded-md bg-sidebar-accent/80 px-2 py-1 text-[10px] text-sidebar-accent-foreground">
          {t("North America")}
        </span>
      </div>
    </div>
  );
}
