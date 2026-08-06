import * as React from "react";
import { Download, Share, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  isAndroidDevice,
  isIosDevice,
  isStandaloneDisplay,
  readInstallBannerDismissed,
  writeInstallBannerDismissed,
} from "@/lib/pwa";
import { cn } from "@/lib/utils";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

/**
 * Android Chrome: native install prompt via beforeinstallprompt.
 * iOS Safari: guided “Add to Home Screen” (Apple does not expose a JS install API).
 */
export function InstallAppBanner({ className }: { className?: string }) {
  const [deferred, setDeferred] = React.useState<BeforeInstallPromptEvent | null>(null);
  const [visible, setVisible] = React.useState(false);
  const [iosHint, setIosHint] = React.useState(false);

  React.useEffect(() => {
    if (isStandaloneDisplay() || readInstallBannerDismissed()) return;

    const onBip = (event: Event) => {
      event.preventDefault();
      setDeferred(event as BeforeInstallPromptEvent);
      setVisible(true);
      setIosHint(false);
    };
    window.addEventListener("beforeinstallprompt", onBip);

    // iOS has no beforeinstallprompt — show Add to Home Screen tip in Safari only.
    if (isIosDevice() && !isStandaloneDisplay()) {
      const isSafari =
        /Safari/i.test(navigator.userAgent) &&
        !/CriOS|FxiOS|EdgiOS|OPiOS|Chrome/i.test(navigator.userAgent);
      if (isSafari) {
        setIosHint(true);
        setVisible(true);
      }
    } else if (isAndroidDevice()) {
      // Banner still useful once bip arrives; keep hidden until then.
    }

    return () => window.removeEventListener("beforeinstallprompt", onBip);
  }, []);

  React.useEffect(() => {
    const onInstalled = () => {
      setVisible(false);
      setDeferred(null);
      toast.success("Driver app installed", {
        description: "Open Titan Driver from your home screen anytime.",
      });
    };
    window.addEventListener("appinstalled", onInstalled);
    return () => window.removeEventListener("appinstalled", onInstalled);
  }, []);

  if (!visible) return null;

  const dismiss = () => {
    writeInstallBannerDismissed();
    setVisible(false);
  };

  const onInstall = async () => {
    if (!deferred) {
      toast.message("Install from your browser menu", {
        description: "Use “Install app” or “Add to Home screen”.",
      });
      return;
    }
    try {
      await deferred.prompt();
      const choice = await deferred.userChoice;
      setDeferred(null);
      if (choice.outcome === "accepted") {
        setVisible(false);
      }
    } catch {
      toast.error("Install cancelled");
    }
  };

  return (
    <div
      className={cn(
        "shrink-0 border-b border-amber/25 bg-gradient-to-r from-ink via-ink-elevated to-ink px-3 py-2.5",
        className,
      )}
      role="region"
      aria-label="Install app"
    >
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber/15 text-amber">
          <Download className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-white">Install Titan Driver</p>
          {iosHint ? (
            <p className="mt-0.5 text-[11px] leading-snug text-white/70">
              Tap <Share className="mx-0.5 inline h-3 w-3 text-amber" aria-hidden /> Share, then{" "}
              <span className="font-medium text-amber">Add to Home Screen</span> for a full-screen
              app.
            </p>
          ) : (
            <p className="mt-0.5 text-[11px] leading-snug text-white/70">
              Add to your home screen for faster open, offline shell, and push-ready install.
            </p>
          )}
          <div className="mt-2 flex flex-wrap gap-2">
            {!iosHint ? (
              <Button
                type="button"
                size="sm"
                variant="amber"
                className="h-8 gap-1.5 px-3 text-xs"
                onClick={() => void onInstall()}
              >
                <Download className="h-3.5 w-3.5" /> Install
              </Button>
            ) : null}
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-8 px-2 text-xs text-white/70 hover:bg-white/10 hover:text-white"
              onClick={dismiss}
            >
              Not now
            </Button>
          </div>
        </div>
        <button
          type="button"
          className="rounded-md p-1 text-white/50 transition hover:bg-white/10 hover:text-white"
          aria-label="Dismiss"
          onClick={dismiss}
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
