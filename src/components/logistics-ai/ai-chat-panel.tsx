import * as React from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { useLocation } from "@tanstack/react-router";
import { Eraser, X } from "lucide-react";

import { AiEmptyState } from "@/components/logistics-ai/ai-empty-state";
import { AiInput } from "@/components/logistics-ai/ai-input";
import { AiErrorBubble, AiMessage, AiTypingIndicator } from "@/components/logistics-ai/ai-message";
import {
  authHeaders,
  clampComposerInput,
  clearPersistedMessages,
  friendlyChatError,
  loadPersistedMessages,
  persistMessages,
  type LogisticsAiStatus,
  ASSISTANT_CLIENT_HISTORY_CAP,
} from "@/components/logistics-ai/ai-chat-utils";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { t } from "@/lib/i18n/t";

/** Fixed panel chrome: header + message lane + composer. */
export const LOGISTICS_AI_PANEL_HEIGHT = "h-[560px]";

type AiChatPanelProps = {
  connected: boolean;
  status?: LogisticsAiStatus | null;
  onClose: () => void;
  className?: string;
};

export function AiChatPanel({ connected, status, onClose, className }: AiChatPanelProps) {
  const { user } = useAuth();
  const userId = user?.userId ?? "_";
  const pathname = useLocation({ select: (l) => l.pathname });
  const [input, setInput] = React.useState("");
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const bottomRef = React.useRef<HTMLDivElement>(null);
  const pathnameRef = React.useRef(pathname);
  pathnameRef.current = pathname;

  const initialMessages = React.useMemo(() => loadPersistedMessages(userId), [userId]);

  const transport = React.useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/ai/assistant",
        headers: async () => authHeaders(),
        prepareSendMessagesRequest: async ({ messages, id, body, headers, credentials, api }) => ({
          api,
          credentials,
          headers,
          body: {
            ...(body ?? {}),
            id,
            messages: messages.slice(-ASSISTANT_CLIENT_HISTORY_CAP),
            context: {
              pathname: pathnameRef.current,
            },
          },
        }),
      }),
    [],
  );

  const {
    messages,
    sendMessage,
    status: chatStatus,
    stop,
    setMessages,
    error,
    clearError,
    regenerate,
  } = useChat({
    id: `logistics-ai-${userId}`,
    messages: initialMessages,
    transport,
  });

  const streaming = chatStatus === "streaming" || chatStatus === "submitted";
  const showTyping =
    chatStatus === "submitted" &&
    (messages.length === 0 || messages[messages.length - 1]?.role === "user");

  React.useEffect(() => {
    if (chatStatus === "streaming" || chatStatus === "submitted") return;
    const timer = window.setTimeout(() => {
      persistMessages(userId, messages.slice(-ASSISTANT_CLIENT_HISTORY_CAP));
    }, 400);
    return () => window.clearTimeout(timer);
  }, [messages, userId, chatStatus]);

  const scrollToBottom = React.useCallback((behavior: ScrollBehavior = "smooth") => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    scroller.scrollTo({
      top: scroller.scrollHeight,
      behavior: reduced ? "auto" : behavior,
    });
  }, []);

  React.useEffect(() => {
    scrollToBottom(chatStatus === "streaming" ? "auto" : "smooth");
  }, [messages, chatStatus, error, showTyping, scrollToBottom]);

  const send = React.useCallback(
    (text: string) => {
      const trimmed = clampComposerInput(text).trim();
      if (!trimmed || !connected || streaming) return;
      clearError();
      setInput("");
      // Keep client history bounded before send.
      if (messages.length > ASSISTANT_CLIENT_HISTORY_CAP) {
        setMessages(messages.slice(-ASSISTANT_CLIENT_HISTORY_CAP));
      }
      void sendMessage({ text: trimmed });
      requestAnimationFrame(() => scrollToBottom("smooth"));
    },
    [clearError, connected, messages, scrollToBottom, sendMessage, setMessages, streaming],
  );

  const clearConversation = () => {
    stop();
    clearError();
    setMessages([] as UIMessage[]);
    clearPersistedMessages(userId);
    setInput("");
  };

  const friendly = error ? friendlyChatError(error) : null;
  const showEmpty = !connected || (messages.length === 0 && !error && !streaming);

  return (
    <div
      className={cn(
        "flex min-h-0 flex-col overflow-hidden bg-popover",
        LOGISTICS_AI_PANEL_HEIGHT,
        className,
      )}
    >
      <header className="flex shrink-0 items-center gap-2.5 border-b border-border/60 px-3 py-2.5">
        <div className="relative h-8 w-8 shrink-0 overflow-hidden rounded-xl border border-border/70 bg-muted/30">
          <img
            src="/ai.png"
            alt=""
            className="h-full w-full scale-125 object-cover object-center"
          />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold tracking-tight text-foreground">
            {t("Logistics AI")}
          </p>
          <div className="mt-0.5 flex items-center gap-1.5">
            <span
              className={cn(
                "h-1.5 w-1.5 shrink-0 rounded-full",
                connected ? "bg-emerald-500" : "bg-muted-foreground/50",
              )}
              aria-hidden
            />
            <span className="truncate text-[11px] text-muted-foreground">
              {connected
                ? status?.model
                  ? `Connected · ${status.model}`
                  : "Connected"
                : "Not connected"}
            </span>
          </div>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8 cursor-pointer rounded-lg"
          onClick={clearConversation}
          aria-label={t("Clear conversation")}
          disabled={messages.length === 0 && !error}
        >
          <Eraser className="h-3.5 w-3.5" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8 cursor-pointer rounded-lg"
          onClick={onClose}
          aria-label={t("Close Logistics AI")}
        >
          <X className="h-4 w-4" />
        </Button>
      </header>

      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain"
        role="log"
        aria-live="polite"
        aria-relevant="additions"
      >
        <div
          className={cn(
            "flex min-h-full w-full min-w-0 flex-col gap-3 px-3 py-3",
            showEmpty && "justify-center",
          )}
        >
          {showEmpty ? (
            <AiEmptyState
              connected={connected}
              onPickPrompt={(prompt) => {
                setInput(prompt);
              }}
            />
          ) : (
            <>
              {messages.map((message, index) => (
                <AiMessage
                  key={message.id}
                  message={message}
                  isStreaming={
                    streaming && index === messages.length - 1 && message.role === "assistant"
                  }
                />
              ))}
              {showTyping ? <AiTypingIndicator /> : null}
              {friendly ? (
                <AiErrorBubble
                  title={friendly.title}
                  detail={friendly.detail}
                  onRetry={() => {
                    clearError();
                    void regenerate();
                  }}
                />
              ) : null}
              <div ref={bottomRef} className="h-px w-full shrink-0" aria-hidden />
            </>
          )}
        </div>
      </div>

      <AiInput
        value={input}
        onChange={(value) => setInput(clampComposerInput(value))}
        onSend={() => send(input)}
        onStop={() => stop()}
        disabled={!connected}
        streaming={streaming}
        placeholder={connected ? "Ask Logistics AI…" : "Connect an OpenAI key to chat"}
      />
    </div>
  );
}
