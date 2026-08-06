import { useEffect, useState } from "react";
import { Mic, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const BAR_HEIGHTS = [40, 70, 100, 60, 85, 50, 95, 65];

export function VoiceOverlay({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [phase, setPhase] = useState<"listening" | "thinking" | "responding">("listening");

  useEffect(() => {
    if (!open) {
      setPhase("listening");
      return;
    }
    const t1 = window.setTimeout(() => setPhase("thinking"), 2600);
    const t2 = window.setTimeout(() => setPhase("responding"), 3600);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, [open]);

  if (!open) return null;

  const label = {
    listening: "Listening…",
    thinking: "Thinking…",
    responding: "“You're 15 minutes ahead of schedule on TF-58231.”",
  }[phase];

  return (
    <div className="absolute inset-0 z-30 flex flex-col items-center justify-between bg-sidebar/97 px-6 py-10 text-sidebar-foreground backdrop-blur-sm">
      <Button
        variant="ghost"
        size="icon"
        className="self-end rounded-full text-sidebar-foreground hover:bg-sidebar-accent"
        onClick={onClose}
        aria-label="Close voice mode"
      >
        <X className="h-5 w-5" />
      </Button>

      <div className="flex flex-1 flex-col items-center justify-center gap-8">
        <div className="relative flex h-28 w-28 items-center justify-center">
          {phase === "listening" ? (
            <>
              <span className="voice-pulse-ring absolute inset-0 rounded-full bg-amber/40" />
              <span
                className="voice-pulse-ring absolute inset-0 rounded-full bg-amber/40"
                style={{ animationDelay: "0.6s" }}
              />
            </>
          ) : null}
          <div
            className={cn(
              "relative flex h-20 w-20 items-center justify-center rounded-full bg-amber text-ink shadow-xl",
              phase === "thinking" && "animate-pulse",
            )}
          >
            <Mic className="h-8 w-8" />
          </div>
        </div>

        {phase !== "responding" ? (
          <div className="flex h-10 items-end gap-1">
            {BAR_HEIGHTS.map((h, i) => (
              <span
                key={i}
                className="voice-wave-bar w-1 rounded-full bg-sidebar-primary"
                style={{ height: `${h}%`, animationDelay: `${i * 0.08}s` }}
              />
            ))}
          </div>
        ) : null}

        <p className="max-w-[16rem] text-center text-sm text-sidebar-foreground/80">{label}</p>
      </div>

      <p className="text-[11px] text-sidebar-foreground/45">Tap the X to end voice mode</p>
    </div>
  );
}
