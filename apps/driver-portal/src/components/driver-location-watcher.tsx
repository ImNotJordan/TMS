import { useEffect, useRef } from "react";

import { DRIVER_GPS_SHARE_INTERVAL_MS } from "@/lib/device-location";
import { useLoads } from "@/lib/loads-store";

/**
 * While location sharing is on and the driver has an active load,
 * publish device GPS immediately and every 10 minutes for Tracking Map.
 */
export function DriverLocationWatcher() {
  const {
    locationSharing,
    activeLoad,
    ready,
    publishLocationNow,
    lastGpsError,
  } = useLoads();
  const inFlightRef = useRef(false);
  const lastErrorToastRef = useRef<string | null>(null);

  useEffect(() => {
    if (!ready || !locationSharing || !activeLoad) return;

    let cancelled = false;

    const tick = async () => {
      if (cancelled || inFlightRef.current) return;
      if (document.visibilityState === "hidden") return;
      inFlightRef.current = true;
      try {
        await publishLocationNow();
      } finally {
        inFlightRef.current = false;
      }
    };

    void tick();
    const intervalId = window.setInterval(() => void tick(), DRIVER_GPS_SHARE_INTERVAL_MS);

    const onVisible = () => {
      if (document.visibilityState === "visible") void tick();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [ready, locationSharing, activeLoad?.id, publishLocationNow]);

  useEffect(() => {
    if (!lastGpsError || lastGpsError === lastErrorToastRef.current) return;
    lastErrorToastRef.current = lastGpsError;
  }, [lastGpsError]);

  return null;
}
