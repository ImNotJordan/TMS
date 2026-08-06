import { Mail, MessageSquare, MessagesSquare, Phone, Search } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

import type { ConversationFilter } from "../hooks/useConversations";
import { CHANNEL_LABELS, formatRelativeTime, truncatePreview } from "../lib/formatters";
import type { ChannelId, Conversation } from "../types";

const ICONS: Record<ChannelId, typeof Mail> = {
  email: Mail,
  sms: MessageSquare,
  voice: Phone,
  chat: MessagesSquare,
};

export function ConversationFilters({
  channel,
  onChannelChange,
  counts,
  search,
  onSearchChange,
  availability,
}: {
  channel: ConversationFilter;
  onChannelChange: (c: ConversationFilter) => void;
  counts: Record<"all" | ChannelId, number>;
  search: string;
  onSearchChange: (v: string) => void;
  availability: Partial<Record<ChannelId, { available: boolean; reason?: string }>>;
}) {
  const items: { id: ConversationFilter; label: string }[] = [
    { id: "all", label: "All" },
    { id: "email", label: "Email" },
    { id: "sms", label: "SMS" },
    { id: "voice", label: "Voice" },
    { id: "chat", label: "Chat" },
  ];

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          className="pl-8"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search subject, contact, load…"
          aria-label="Search conversations"
        />
      </div>
      <div
        className="flex flex-wrap gap-1 rounded-lg border border-border/70 bg-muted/20 p-1"
        role="listbox"
        aria-label="Channel filters"
      >
        {items.map((item) => {
          const disabled =
            item.id !== "all" &&
            Boolean(availability[item.id as ChannelId]) &&
            !availability[item.id as ChannelId]?.available;
          const count = item.id === "all" ? counts.all : counts[item.id];
          return (
            <Button
              key={item.id}
              variant="ghost"
              size="sm"
              className={cn(
                "h-8 flex-1 gap-1 px-2 text-xs font-medium",
                channel === item.id && "bg-background text-foreground shadow-sm",
                disabled && "opacity-50",
              )}
              disabled={disabled}
              title={disabled ? availability[item.id as ChannelId]?.reason : undefined}
              onClick={() => onChannelChange(item.id)}
              role="option"
              aria-selected={channel === item.id}
            >
              <span>{item.label}</span>
              <span className="tabular-nums text-muted-foreground">{count}</span>
            </Button>
          );
        })}
      </div>
    </div>
  );
}

export function ConversationListItem({
  conversation,
  selected,
  onSelect,
}: {
  conversation: Conversation;
  selected: boolean;
  onSelect: () => void;
}) {
  const Icon = ICONS[conversation.primaryChannel];
  const critical = conversation.keywordFlags.some((f) => f.severity === "critical");

  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "flex w-full cursor-pointer flex-col gap-1 rounded-md px-2.5 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        selected ? "bg-muted/60" : "hover:bg-muted/40",
      )}
      aria-current={selected ? "true" : undefined}
    >
      <div className="flex items-center gap-2">
        {conversation.unreadCount > 0 ? (
          <span
            className="h-2 w-2 shrink-0 rounded-full bg-primary"
            aria-label={`${conversation.unreadCount} unread`}
          />
        ) : (
          <span className="h-2 w-2 shrink-0" aria-hidden />
        )}
        <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
        <span
          className={cn(
            "min-w-0 flex-1 truncate text-sm",
            conversation.unreadCount > 0 ? "font-semibold text-foreground" : "font-medium text-foreground",
          )}
        >
          {conversation.subject}
        </span>
        <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
          {formatRelativeTime(conversation.lastMessageAt)}
        </span>
      </div>
      <p
        className="truncate pl-4 text-xs text-muted-foreground"
        title={conversation.lastMessagePreview}
      >
        {truncatePreview(conversation.lastMessagePreview)}
      </p>
      <div className="flex flex-wrap gap-1 pl-4">
        <Badge variant="outline" className="h-5 text-[10px]">
          {CHANNEL_LABELS[conversation.primaryChannel]}
        </Badge>
        {critical ? (
          <Badge
            variant="outline"
            className="h-5 border-destructive/25 bg-destructive/15 text-[10px] text-destructive"
          >
            Critical
          </Badge>
        ) : null}
        {conversation.aiHandled ? (
          <Badge variant="outline" className="h-5 text-[10px]">
            AI
          </Badge>
        ) : null}
        {conversation.loadId ? (
          <Badge variant="outline" className="h-5 text-[10px] tabular-nums">
            {conversation.loadId}
          </Badge>
        ) : null}
      </div>
    </button>
  );
}

export function ConversationList({
  conversations,
  selectedId,
  onSelect,
  isLoading,
}: {
  conversations: Conversation[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  isLoading: boolean;
}) {
  if (isLoading) {
    return (
      <div className="space-y-1 p-1" aria-busy="true">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-16 animate-pulse rounded-md bg-muted/40" />
        ))}
      </div>
    );
  }

  if (conversations.length === 0) {
    return (
      <div className="px-3 py-10 text-center">
        <p className="text-sm font-medium text-foreground">No conversations</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Start one from any load or contact, or compose a new thread.
        </p>
      </div>
    );
  }

  return (
    <div className="divide-y divide-border/60" role="listbox" aria-label="Conversations">
      {conversations.map((c) => (
        <ConversationListItem
          key={c.id}
          conversation={c}
          selected={selectedId === c.id}
          onSelect={() => onSelect(c.id)}
        />
      ))}
    </div>
  );
}
