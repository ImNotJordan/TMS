import * as React from "react";

import {
  askWorkspaceAi,
  callWorkspaceAi,
  isWorkspaceAiReady,
  type CallWorkspaceAiOptions,
  type CallWorkspaceAiResult,
} from "@/lib/ai-client";
import {
  INTEGRATIONS_CONFIG_CHANGED,
  ensureIntegrationsConfigLoaded,
  getAiConnectionStatus,
  type IntegrationConnectionStatus,
} from "@/lib/integrations-config";

/**
 * React hook for any UI that needs the workspace OpenAI integration.
 */
export function useWorkspaceAi() {
  const [ready, setReady] = React.useState(isWorkspaceAiReady);
  const [status, setStatus] = React.useState<IntegrationConnectionStatus>(getAiConnectionStatus);

  React.useEffect(() => {
    void ensureIntegrationsConfigLoaded().then(() => {
      setReady(isWorkspaceAiReady());
      setStatus(getAiConnectionStatus());
    });

    const sync = () => {
      setReady(isWorkspaceAiReady());
      setStatus(getAiConnectionStatus());
    };
    window.addEventListener(INTEGRATIONS_CONFIG_CHANGED, sync);
    return () => window.removeEventListener(INTEGRATIONS_CONFIG_CHANGED, sync);
  }, []);

  const ask = React.useCallback(
    (options: Parameters<typeof askWorkspaceAi>[0]) => askWorkspaceAi(options),
    [],
  );

  const chat = React.useCallback(
    (options: CallWorkspaceAiOptions): Promise<CallWorkspaceAiResult> => callWorkspaceAi(options),
    [],
  );

  return { ready, status, ask, chat };
}
