import * as React from "react";
import { createPortal } from "react-dom";

import {
  fetchFacilitySuggestions,
  getActiveGeocodeProviderLabel,
  type StopAutofillResult,
} from "@/components/loads/facility-geocode";
import {
  ensureIntegrationsConfigLoaded,
  INTEGRATIONS_CONFIG_CHANGED,
  isFacilityAddressSearchEnabled,
} from "@/lib/integrations-config";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";

/** Portaled panel — dialogs must not swallow pointer events on this selector. */
export const FACILITY_SUGGESTIONS_ATTR = "data-facility-suggestions";

export function isFacilitySuggestionsTarget(target: EventTarget | null) {
  return target instanceof Element && Boolean(target.closest(`[${FACILITY_SUGGESTIONS_ATTR}]`));
}

export function FacilityLocationInput({
  value,
  onChange,
  onResolved,
  placeholder = "Warehouse / DC name",
}: {
  value: string;
  onChange: (value: string) => void;
  onResolved: (facility: string, result: StopAutofillResult) => void;
  placeholder?: string;
}) {
  const [suggestions, setSuggestions] = React.useState<
    Awaited<ReturnType<typeof fetchFacilitySuggestions>>
  >([]);
  const [pickerOpen, setPickerOpen] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [anchorRect, setAnchorRect] = React.useState<DOMRect | null>(null);
  /** Only search after the user types — not for pre-filled edit values. */
  const [userSearching, setUserSearching] = React.useState(false);
  const containerRef = React.useRef<HTMLDivElement>(null);
  const panelRef = React.useRef<HTMLDivElement>(null);
  const [providerLabel, setProviderLabel] = React.useState(getActiveGeocodeProviderLabel);
  const [addressSearchEnabled, setAddressSearchEnabled] = React.useState(false);
  const [configReady, setConfigReady] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    void ensureIntegrationsConfigLoaded().then(() => {
      if (cancelled) return;
      setAddressSearchEnabled(isFacilityAddressSearchEnabled());
      setProviderLabel(getActiveGeocodeProviderLabel());
      setConfigReady(true);
    });
    const sync = () => {
      setAddressSearchEnabled(isFacilityAddressSearchEnabled());
      setProviderLabel(getActiveGeocodeProviderLabel());
    };
    window.addEventListener(INTEGRATIONS_CONFIG_CHANGED, sync);
    return () => {
      cancelled = true;
      window.removeEventListener(INTEGRATIONS_CONFIG_CHANGED, sync);
    };
  }, []);

  const trimmed = value.trim();
  const canSearch = addressSearchEnabled && trimmed.length >= 3;
  const showPanel = pickerOpen && canSearch && userSearching;

  const syncAnchorRect = React.useCallback(() => {
    if (!containerRef.current) return;
    setAnchorRect(containerRef.current.getBoundingClientRect());
  }, []);

  React.useEffect(() => {
    if (!canSearch || !userSearching) {
      setSuggestions([]);
      setLoading(false);
      if (!userSearching) setPickerOpen(false);
      return;
    }

    const controller = new AbortController();
    setLoading(true);
    setPickerOpen(true);
    queueMicrotask(syncAnchorRect);

    const timerId = window.setTimeout(() => {
      void fetchFacilitySuggestions(trimmed, controller.signal)
        .then((next) => {
          if (controller.signal.aborted) return;
          setSuggestions(next);
          setPickerOpen(true);
        })
        .catch(() => {
          /* aborted or network error — ignore */
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 400);

    return () => {
      controller.abort();
      window.clearTimeout(timerId);
    };
  }, [canSearch, trimmed, userSearching]);

  React.useLayoutEffect(() => {
    if (!showPanel) {
      setAnchorRect(null);
      return;
    }
    syncAnchorRect();
    window.addEventListener("scroll", syncAnchorRect, true);
    window.addEventListener("resize", syncAnchorRect);
    return () => {
      window.removeEventListener("scroll", syncAnchorRect, true);
      window.removeEventListener("resize", syncAnchorRect);
    };
  }, [showPanel, syncAnchorRect, loading, suggestions.length]);

  React.useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (isFacilitySuggestionsTarget(event.target)) return;
      if (containerRef.current?.contains(event.target as Node)) return;
      setPickerOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, []);

  const layoutRect =
    anchorRect ?? (showPanel ? (containerRef.current?.getBoundingClientRect() ?? null) : null);

  const panelStyle = React.useMemo(() => {
    if (!layoutRect) return null;
    const gap = 4;
    const padding = 12;
    const spaceBelow = window.innerHeight - layoutRect.bottom - padding;
    const spaceAbove = layoutRect.top - padding;
    const openUpward = spaceBelow < 160 && spaceAbove > spaceBelow;
    const maxHeight = Math.max(120, Math.min(280, (openUpward ? spaceAbove : spaceBelow) - gap));

    return {
      top: openUpward ? undefined : layoutRect.bottom + gap,
      bottom: openUpward ? window.innerHeight - layoutRect.top + gap : undefined,
      left: layoutRect.left,
      width: layoutRect.width,
      maxHeight,
    };
  }, [layoutRect]);

  // Bound to both onWheel and onTouchMove, so it takes the common supertype
  // rather than WheelEvent — a TouchEvent is not assignable to that.
  const stopWheel = (event: React.SyntheticEvent) => {
    event.stopPropagation();
  };

  const panel =
    showPanel && panelStyle ? (
      <div
        ref={panelRef}
        role="listbox"
        {...{ [FACILITY_SUGGESTIONS_ATTR]: "" }}
        className="pointer-events-auto fixed z-[9999] overflow-y-auto overflow-x-hidden overscroll-contain rounded-md border border-border bg-popover py-1 shadow-lg"
        style={{
          top: panelStyle.top,
          bottom: panelStyle.bottom,
          left: panelStyle.left,
          width: panelStyle.width,
          maxHeight: panelStyle.maxHeight,
        }}
        onWheel={stopWheel}
        onTouchMove={stopWheel}
      >
        {loading && (
          <div
            className="space-y-2.5 px-3 py-2.5"
            aria-busy="true"
            aria-label="Searching locations"
          >
            {[0, 1, 2].map((i) => (
              <div key={i} className="space-y-1.5">
                <Skeleton className="h-3.5 w-full" />
                <Skeleton className="h-3 w-[85%]" />
              </div>
            ))}
          </div>
        )}
        {!loading && suggestions.length === 0 && (
          <div className="px-3 py-2 text-xs text-muted-foreground">
            No locations found. Include a city, e.g.{" "}
            <span className="font-medium text-foreground">Costco Atlanta</span>.
          </div>
        )}
        {!loading &&
          suggestions.map((suggestion) => (
            <button
              key={suggestion.id}
              type="button"
              role="option"
              className="w-full rounded-md px-3 py-2 text-left text-sm text-foreground hover:bg-accent"
              onPointerDown={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onResolved(suggestion.facilityName, suggestion.parsed);
                setUserSearching(false);
                setPickerOpen(false);
              }}
            >
              <span className="line-clamp-2">{suggestion.label}</span>
            </button>
          ))}
      </div>
    ) : null;

  return (
    <div ref={containerRef} className="relative">
      <Input
        value={value}
        onChange={(e) => {
          const next = e.target.value;
          onChange(next);
          if (!addressSearchEnabled) {
            setUserSearching(false);
            setPickerOpen(false);
            return;
          }
          const nextTrimmed = next.trim();
          if (nextTrimmed.length >= 3) {
            setUserSearching(true);
            setPickerOpen(true);
            syncAnchorRect();
          } else {
            setUserSearching(false);
            setPickerOpen(false);
          }
        }}
        onFocus={() => {
          syncAnchorRect();
          if (canSearch && userSearching) setPickerOpen(true);
        }}
        placeholder={placeholder}
        autoComplete="off"
        aria-expanded={showPanel}
        aria-haspopup="listbox"
      />
      <p className="mt-1 text-[10px] text-muted-foreground">
        {configReady && !addressSearchEnabled ? (
          <>
            Address search is off. Configure Google Maps in{" "}
            <span className="font-medium text-foreground">Settings → Integrations</span>.
          </>
        ) : (
          <>Address search: {providerLabel}</>
        )}
      </p>
      {typeof document !== "undefined" && panel ? createPortal(panel, document.body) : null}
    </div>
  );
}
