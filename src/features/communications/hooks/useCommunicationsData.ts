import * as React from "react";

import {
  COMMS_CHANGED,
  loadCommunicationsData,
  readCommunicationsCache,
  saveCommunicationsData,
  type CommunicationsWorkspaceData,
} from "../lib/communications-store";

export function useCommunicationsData() {
  const [data, setData] = React.useState<CommunicationsWorkspaceData>(readCommunicationsCache);
  const [isLoading, setIsLoading] = React.useState(true);

  React.useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    void loadCommunicationsData().then((loaded) => {
      if (!cancelled) {
        setData(loaded);
        setIsLoading(false);
      }
    });

    const onChange = () => setData(readCommunicationsCache());
    window.addEventListener(COMMS_CHANGED, onChange);
    return () => {
      cancelled = true;
      window.removeEventListener(COMMS_CHANGED, onChange);
    };
  }, []);

  const persist = React.useCallback(async (next: CommunicationsWorkspaceData) => {
    const saved = await saveCommunicationsData(next);
    setData(saved);
    return saved;
  }, []);

  return { data, isLoading, persist, setData };
}
