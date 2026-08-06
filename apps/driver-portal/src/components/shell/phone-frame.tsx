import { isStandaloneDisplay } from "@/lib/pwa";
import { cn } from "@/lib/utils";

/**
 * On real mobile viewports this is edge-to-edge (a normal mobile web app).
 * On wider screens it centers a phone-shaped frame so the UI can be reviewed
 * from a desktop browser without misrepresenting the target form factor.
 * When installed as a PWA, always fill the device viewport (no desktop chrome).
 */
export function PhoneFrame({ children }: { children: React.ReactNode }) {
  const installed = isStandaloneDisplay();

  return (
    <div
      className={cn(
        "flex w-full justify-center",
        installed ? "min-h-dvh bg-background" : "min-h-screen bg-muted/40 sm:items-center sm:p-6",
      )}
    >
      <div
        className={cn(
          "flex w-full flex-col overflow-hidden bg-background",
          installed
            ? "h-dvh max-w-none rounded-none border-0 shadow-none"
            : "h-screen sm:h-[min(860px,calc(100vh-3rem))] sm:max-w-[420px] sm:rounded-[2.75rem] sm:border sm:border-border sm:shadow-2xl",
        )}
      >
        {children}
      </div>
    </div>
  );
}
