import * as React from "react";

import type { Message } from "../types";
import { useCommunicationsData } from "./useCommunicationsData";

export function useConversation(conversationId: string | null) {
  const { data, isLoading, persist } = useCommunicationsData();

  const conversation = React.useMemo(
    () => data.conversations.find((c) => c.id === conversationId) ?? null,
    [data.conversations, conversationId],
  );

  const messages = React.useMemo(() => {
    if (!conversationId) return [] as Message[];
    return data.messages
      .filter((m) => m.conversationId === conversationId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }, [data.messages, conversationId]);

  const markRead = React.useCallback(async () => {
    if (!conversationId || !conversation || conversation.unreadCount === 0) return;
    await persist({
      ...data,
      conversations: data.conversations.map((c) =>
        c.id === conversationId ? { ...c, unreadCount: 0 } : c,
      ),
    });
  }, [conversation, conversationId, data, persist]);

  React.useEffect(() => {
    void markRead();
  }, [markRead]);

  return { conversation, messages, isLoading, data, persist };
}
