import * as React from "react";

import type { ChannelId, Conversation } from "../types";
import { useCommunicationsData } from "./useCommunicationsData";
import { useCommsAccess } from "./useCommsAccess";

export type ConversationFilter = ChannelId | "all";

export function useConversations(options?: {
  channel?: ConversationFilter;
  search?: string;
  status?: Conversation["status"] | "all";
}) {
  const { data, isLoading, persist } = useCommunicationsData();
  const { level, userId } = useCommsAccess();
  const channel = options?.channel ?? "all";
  const search = (options?.search ?? "").trim().toLowerCase();
  const status = options?.status ?? "all";

  const conversations = React.useMemo(() => {
    let list = [...data.conversations];

    if (level === "client" && userId) {
      list = list.filter((c) => c.assigneeId === userId || c.contactId === userId);
    }
    // Shipper: prefer load-linked threads (full load ownership filter needs Loads store join).
    if (level === "shipper") {
      list = list.filter((c) => Boolean(c.loadId));
    }

    if (channel !== "all") {
      list = list.filter((c) => c.channels.includes(channel) || c.primaryChannel === channel);
    }
    if (status !== "all") {
      list = list.filter((c) => c.status === status);
    }
    if (search) {
      list = list.filter(
        (c) =>
          c.subject.toLowerCase().includes(search) ||
          c.lastMessagePreview.toLowerCase().includes(search) ||
          c.contactId.toLowerCase().includes(search) ||
          (c.loadId?.toLowerCase().includes(search) ?? false),
      );
    }

    return list.sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt));
  }, [data.conversations, channel, search, status, level, userId]);

  const counts = React.useMemo(() => {
    const base = { all: 0, email: 0, sms: 0, voice: 0, chat: 0 };
    for (const c of data.conversations) {
      base.all += 1;
      for (const ch of new Set(c.channels)) {
        if (ch in base) base[ch] += 1;
      }
    }
    return base;
  }, [data.conversations]);

  return {
    conversations,
    counts,
    isLoading,
    messages: data.messages,
    data,
    persist,
  };
}
