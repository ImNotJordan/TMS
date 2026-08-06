import * as React from "react";
import { useRouterState } from "@tanstack/react-router";

import { usePageLoadBusy } from "@/components/page-load-gate";
import {
  getWindowScrollY,
  routeScrollKey,
  saveWindowScrollY,
} from "@/lib/route-scroll-store";

/**
 * App-wide window scroll memory.
 * Saves while the user scrolls; restores after the route skeleton clears so
 * async pages land at the last offset instead of the top.
 */
export function AppScrollRestoration() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const busy = usePageLoadBusy();
  const key = routeScrollKey(pathname);
  const restoredForKeyRef = React.useRef<string | null>(null);

  React.useEffect(() => {
    let raf = 0;
    const persist = () => {
      window.cancelAnimationFrame(raf);
      raf = window.requestAnimationFrame(() => {
        saveWindowScrollY(key, window.scrollY || window.pageYOffset || 0);
      });
    };
    window.addEventListener("scroll", persist, { passive: true });
    return () => {
      window.removeEventListener("scroll", persist);
      window.cancelAnimationFrame(raf);
      saveWindowScrollY(key, window.scrollY || window.pageYOffset || 0);
    };
  }, [key]);

  React.useLayoutEffect(() => {
    if (busy) {
      restoredForKeyRef.current = null;
      return;
    }
    if (restoredForKeyRef.current === key) return;
    restoredForKeyRef.current = key;

    const y = getWindowScrollY(key);
    const apply = () => {
      window.scrollTo({ top: y, left: 0, behavior: "auto" });
    };
    apply();
    const raf = window.requestAnimationFrame(apply);
    return () => window.cancelAnimationFrame(raf);
  }, [busy, key]);

  return null;
}
