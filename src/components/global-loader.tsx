import { Truck } from "lucide-react";

import { cn } from "@/lib/utils";

type GlobalLoaderProps = {
  message?: string;
  /** fullscreen = auth; overlay = modal scrim; embedded = route area under shell */
  variant?: "fullscreen" | "overlay" | "embedded";
  className?: string;
};

/** Full-screen / overlay / embedded loader with a truck moving along a lane (global UX). */
export function GlobalLoader({
  message = "Loading…",
  variant = "fullscreen",
  className,
}: GlobalLoaderProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center px-6",
        variant === "overlay"
          ? "fixed inset-0 z-[200] bg-background/80 backdrop-blur-md"
          : variant === "embedded"
            ? "min-h-[min(560px,calc(100dvh-7rem))] w-full bg-background py-10"
            : "min-h-screen w-full bg-background",
        className,
      )}
      role="status"
      aria-live="polite"
      aria-busy="true"
      aria-label={message}
    >
      <div className="relative mx-auto h-[4.75rem] w-full max-w-[min(320px,88vw)] overflow-hidden rounded-2xl border border-primary/20 bg-gradient-to-b from-muted/60 to-muted/30 shadow-inner">
        <div className="pointer-events-none absolute inset-x-0 bottom-[38%] mx-4 border-b border-dashed border-primary/30" />
        <div className="global-loader-truck-wrap">
          <Truck className="h-9 w-9 text-primary drop-shadow-md" strokeWidth={2.35} aria-hidden />
        </div>
      </div>
      <p className="mt-7 text-sm font-medium tracking-tight text-muted-foreground">{message}</p>
    </div>
  );
}
