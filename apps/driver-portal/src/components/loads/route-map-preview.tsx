import { MapPin, Truck } from "lucide-react";

/** Faux route map — mirrors the dispatcher console's shipment-map visual language. */
export function RouteMapPreview({ progress = 0 }: { progress?: number }) {
  const clamped = Math.min(1, Math.max(0, progress));

  return (
    <div className="relative h-40 overflow-hidden rounded-xl border border-border bg-gradient-to-br from-sidebar/95 via-sidebar to-sidebar/90">
      <svg className="absolute inset-0 h-full w-full opacity-25" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <pattern id="driver-grid" width="28" height="28" patternUnits="userSpaceOnUse">
            <path
              d="M 28 0 L 0 0 0 28"
              fill="none"
              stroke="#3A4A70"
              strokeOpacity="0.4"
              strokeWidth="0.5"
            />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#driver-grid)" />
      </svg>

      <svg className="absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none">
        <path
          d="M 10,75 Q 35,20 55,50 T 90,25"
          stroke="#54627F"
          strokeWidth="0.8"
          strokeDasharray="2 1.4"
          fill="none"
        />
      </svg>

      <div className="absolute left-[8%] top-[75%] -translate-x-1/2 -translate-y-1/2">
        <div className="flex h-6 w-6 items-center justify-center rounded-full bg-success ring-4 ring-sidebar/80">
          <MapPin className="h-3.5 w-3.5 text-success-foreground" />
        </div>
      </div>
      <div className="absolute left-[88%] top-[23%] -translate-x-1/2 -translate-y-1/2">
        <div className="flex h-6 w-6 items-center justify-center rounded-full bg-destructive ring-4 ring-sidebar/80">
          <MapPin className="h-3.5 w-3.5 text-destructive-foreground" />
        </div>
      </div>
      <div
        className="absolute -translate-x-1/2 -translate-y-1/2 transition-[left,top] duration-700"
        style={{ left: `${8 + clamped * 80}%`, top: `${75 - clamped * 52}%` }}
      >
        <span aria-hidden className="amber-glow absolute -inset-1.5 rounded-full bg-amber/50 blur-md" />
        <div className="relative flex h-7 w-7 items-center justify-center rounded-full bg-amber shadow-lg ring-4 ring-sidebar/80">
          <Truck className="h-3.5 w-3.5 text-ink" />
        </div>
      </div>
    </div>
  );
}
