import * as React from "react";

import { AiChatPanel, LOGISTICS_AI_PANEL_HEIGHT } from "@/components/logistics-ai/ai-chat-panel";
import {
  fetchLogisticsAiStatus,
  invalidateLogisticsAiStatusCache,
  LOGISTICS_AI_STATUS_EVENT,
  type LogisticsAiStatus,
} from "@/components/logistics-ai/ai-chat-utils";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useIsMobile } from "@/hooks/use-mobile";
import { useAuth } from "@/lib/auth";
import { INTEGRATIONS_CONFIG_CHANGED } from "@/lib/integrations-config";
import { cn } from "@/lib/utils";
import { t } from "@/lib/i18n/t";

const AiTriggerButton = React.forwardRef<
  HTMLButtonElement,
  {
    open: boolean;
    connected: boolean;
  } & React.ComponentPropsWithoutRef<typeof Button>
>(function AiTriggerButton({ open, connected, className, ...props }, ref) {
  return (
    <Button
      ref={ref}
      type="button"
      variant="ghost"
      size="sm"
      className={cn(
        "relative h-9 w-40 overflow-hidden rounded-lg p-0 transition-transform duration-150",
        "hover:scale-[1.02] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        className,
      )}
      aria-label={t("Open Logistics AI")}
      aria-haspopup="dialog"
      aria-expanded={open}
      {...props}
    >
      <img
        src="/ai.png"
        alt="AI"
        className="pointer-events-none h-full w-full scale-125 object-cover object-center"
        draggable={false}
      />
      <span
        className={cn(
          "pointer-events-none absolute bottom-1 right-1 h-2.5 w-2.5 rounded-full border-2 border-background",
          connected ? "bg-emerald-500" : "bg-muted-foreground/55",
        )}
        aria-hidden
      />
      <span className="sr-only">{connected ? "OpenAI connected" : "OpenAI not connected"}</span>
    </Button>
  );
});

export function AiHeaderButton() {
  const isMobile = useIsMobile();
  const { status: authStatus } = useAuth();
  const [open, setOpen] = React.useState(false);
  const [status, setStatus] = React.useState<LogisticsAiStatus | null>(null);

  const refreshStatus = React.useCallback(
    async (force = false) => {
      if (authStatus !== "authenticated") {
        setStatus({ connected: false, code: "not_authenticated" });
        return;
      }
      const next = await fetchLogisticsAiStatus({ force });
      setStatus(next);
    },
    [authStatus],
  );

  React.useEffect(() => {
    void refreshStatus(false);
    let debounce: ReturnType<typeof setTimeout> | undefined;
    const onCustom = () => {
      clearTimeout(debounce);
      debounce = setTimeout(() => {
        invalidateLogisticsAiStatusCache();
        void refreshStatus(true);
      }, 300);
    };
    window.addEventListener(LOGISTICS_AI_STATUS_EVENT, onCustom);
    window.addEventListener(INTEGRATIONS_CONFIG_CHANGED, onCustom);
    return () => {
      clearTimeout(debounce);
      window.removeEventListener(LOGISTICS_AI_STATUS_EVENT, onCustom);
      window.removeEventListener(INTEGRATIONS_CONFIG_CHANGED, onCustom);
    };
  }, [refreshStatus]);

  React.useEffect(() => {
    if (open) void refreshStatus(false);
  }, [open, refreshStatus]);

  const connected = Boolean(status?.connected);

  const panel = open ? (
    <AiChatPanel
      connected={connected}
      status={status}
      onClose={() => setOpen(false)}
      className="h-full max-h-none"
    />
  ) : null;

  if (isMobile) {
    return (
      <>
        <AiTriggerButton open={open} connected={connected} onClick={() => setOpen(true)} />
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetContent
            side="bottom"
            className="flex h-[min(92dvh,720px)] flex-col gap-0 overflow-hidden p-0"
          >
            <SheetHeader className="sr-only">
              <SheetTitle>{t("Logistics AI")}</SheetTitle>
            </SheetHeader>
            {panel}
          </SheetContent>
        </Sheet>
      </>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <AiTriggerButton open={open} connected={connected} />
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={8}
        className={cn(
          "z-[80] w-[min(400px,calc(100vw-1.5rem))] overflow-hidden rounded-2xl border border-border/80 bg-popover/95 p-0 shadow-lg backdrop-blur-md",
          LOGISTICS_AI_PANEL_HEIGHT,
        )}
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        {panel}
      </PopoverContent>
    </Popover>
  );
}
