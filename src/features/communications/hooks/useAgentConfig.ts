import * as React from "react";

import { appendAuditEvent } from "../lib/communications-store";
import type { AgentConfig } from "../types";
import { useCommunicationsData } from "./useCommunicationsData";
import { useCommsAccess } from "./useCommsAccess";

export function useAgentConfig() {
  const { data, isLoading, persist } = useCommunicationsData();
  const { canEditAgent, userId } = useCommsAccess();

  const save = React.useCallback(
    async (next: AgentConfig) => {
      if (!canEditAgent) throw new Error("You do not have permission to edit the AI agent.");
      let payload = {
        ...data,
        agentConfig: next,
      };
      payload = appendAuditEvent(payload, {
        actorId: userId ?? "unknown",
        action: "agent.updated",
        targetType: "agent",
        targetId: "workspace",
        metadata: { persona: next.persona, enabled: next.enabled },
      });
      await persist(payload);
    },
    [canEditAgent, data, persist, userId],
  );

  return { config: data.agentConfig, isLoading, save, canEdit: canEditAgent };
}
