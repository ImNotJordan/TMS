import * as React from "react";
import { useRouterState } from "@tanstack/react-router";

import { usePageLoadBusy } from "@/components/page-load-gate";
import { getRegionScrollY, routeScrollKey, saveRegionScrollY } from "@/lib/route-scroll-store";
import { cn } from "@/lib/utils";

type ScrollRegionProps = React.HTMLAttributes<HTMLDivElement> & {
  /** Stable id within the route (e.g. "tracking-sessions"). */
  id: string;
};

/**
 * Nested overflow container that remembers scrollTop for the current route.
 * Use for side lists, timelines, and other in-page scrollers.
 */
export const ScrollRegion = React.forwardRef<HTMLDivElement, ScrollRegionProps>(
  function ScrollRegion({ id, className, children, onScroll, ...props }, forwardedRef) {
    const pathname = useRouterState({ select: (s) => s.location.pathname });
    const busy = usePageLoadBusy();
    const key = routeScrollKey(pathname);
    const localRef = React.useRef<HTMLDivElement>(null);
    const restoredTokenRef = React.useRef<string | null>(null);

    const setRefs = React.useCallback(
      (node: HTMLDivElement | null) => {
        localRef.current = node;
        if (typeof forwardedRef === "function") forwardedRef(node);
        else if (forwardedRef) forwardedRef.current = node;
      },
      [forwardedRef],
    );

    React.useEffect(() => {
      const el = localRef.current;
      if (!el) return;
      const persist = () => saveRegionScrollY(key, id, el.scrollTop);
      el.addEventListener("scroll", persist, { passive: true });
      return () => {
        el.removeEventListener("scroll", persist);
        persist();
      };
    }, [key, id]);

    React.useLayoutEffect(() => {
      if (busy) {
        restoredTokenRef.current = null;
        return;
      }
      const token = `${key}::${id}`;
      if (restoredTokenRef.current === token) return;
      restoredTokenRef.current = token;
      const el = localRef.current;
      if (!el) return;
      const y = getRegionScrollY(key, id);
      if (y != null) el.scrollTop = y;
    }, [busy, key, id]);

    return (
      <div
        ref={setRefs}
        data-scroll-restoration-id={id}
        className={cn(className)}
        onScroll={(event) => {
          saveRegionScrollY(key, id, event.currentTarget.scrollTop);
          onScroll?.(event);
        }}
        {...props}
      >
        {children}
      </div>
    );
  },
);
