import { isStandaloneDisplay } from "@/lib/pwa";
import { cn } from "@/lib/utils";

/**
 * On real mobile-width viewports this is edge-to-edge (a normal mobile web app).
 * On wider screens — a desktop browser tab, or the PWA installed and opened on a
 * tablet/foldable/large phone — content caps at a comfortable column width and
 * centers, rather than stretching a phone-oriented layout edge to edge. This is
 * the one shared choke-point every screen renders through, so the cap applies
 * consistently everywhere without each page reimplementing it.
 */
export function PhoneFrame({ children }: { children: React.ReactNode }) {
  const installed = isStandaloneDisplay();

  return (
    <div
      className={cn(
        "flex w-full justify-center",
        installed ? "min-h-dvh bg-muted/40" : "min-h-screen bg-muted/40 sm:items-center sm:p-6",
      )}
    >
      <div
        className={cn(
          // Continuous at every width — min(100%, 420px) with no breakpoint
          // snap, so the column narrows smoothly on small phones and caps
          // out at an actual phone's proportions on tablets/desktop instead
          // of jumping between fixed states or ballooning wider than a phone.
          "flex w-full max-w-[420px] flex-col overflow-hidden bg-background",
          installed
            ? "h-dvh rounded-none border-0 shadow-none"
            : // Only the desktop "phone mockup" framing (bezel/shadow/fixed
              // preview height) is a deliberate discrete toggle — an actual
              // device bezel can't fluidly interpolate. Width above is not.
              "h-screen sm:h-[min(860px,calc(100vh-3rem))] sm:rounded-[2.75rem] sm:border sm:border-border sm:shadow-2xl",
        )}
      >
        {children}
      </div>
    </div>
  );
}
