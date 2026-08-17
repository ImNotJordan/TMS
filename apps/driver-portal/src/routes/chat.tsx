import { useEffect, useRef, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Mic, Send } from "lucide-react";
import { toast } from "sonner";

import { ChatPageSkeleton } from "@/components/page-skeletons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ChatBubble } from "@/components/chat/chat-bubble";
import { VoiceOverlay } from "@/components/chat/voice-overlay";
import { listTrackingMessages, putTrackingMessage } from "@/lib/aws-messages";
import { useLoads } from "@/lib/loads-store";
import { QUICK_REPLIES, type ChatMessage } from "@/lib/mock-data";

export const Route = createFileRoute("/chat")({
  component: ChatPage,
});

function formatChatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function ChatPage() {
  useEffect(() => {
    document.title = "Dispatcher chat — Titan Freight Driver";
  }, []);

  const { activeLoad, ready } = useLoads();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [chatReady, setChatReady] = useState(false);
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    async function loadMessages() {
      setChatReady(false);
      if (!activeLoad) {
        setMessages([]);
        setChatReady(true);
        return;
      }
      try {
        const rows = await listTrackingMessages(activeLoad.id);
        if (cancelled) return;
        const ordered = [...rows].sort((a, b) => {
          const ta = new Date(a.timestamp).getTime();
          const tb = new Date(b.timestamp).getTime();
          if (Number.isNaN(ta) || Number.isNaN(tb)) return a.timestamp.localeCompare(b.timestamp);
          return ta - tb;
        });
        setMessages(
          ordered.map((m) => ({
            id: m.id,
            from: m.from === "driver" ? "driver" : "ai",
            text: m.text,
            time: formatChatTime(m.timestamp),
          })),
        );
      } catch (err) {
        if (!cancelled) {
          toast.error("Couldn’t load messages", {
            description: err instanceof Error ? err.message : "Try again",
          });
          setMessages([]);
        }
      } finally {
        if (!cancelled) setChatReady(true);
      }
    }
    if (ready) void loadMessages();
    return () => {
      cancelled = true;
    };
  }, [activeLoad?.id, ready]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const send = async (text: string) => {
    if (!text.trim() || !activeLoad || sending) return;
    const body = text.trim();
    setDraft("");
    setSending(true);
    const optimistic: ChatMessage = {
      id: `local-${Date.now()}`,
      from: "driver",
      text: body,
      time: new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }),
    };
    setMessages((prev) => [...prev, optimistic]);
    try {
      const saved = await putTrackingMessage({
        loadId: activeLoad.id,
        from: "driver",
        text: body,
      });
      setMessages((prev) =>
        prev.map((m) =>
          m.id === optimistic.id
            ? {
                id: saved.id,
                from: "driver",
                text: saved.text,
                time: formatChatTime(saved.timestamp),
              }
            : m,
        ),
      );
    } catch (err) {
      setMessages((prev) => prev.filter((m) => m.id !== optimistic.id));
      toast.error("Message not sent", {
        description: err instanceof Error ? err.message : "Try again",
      });
    } finally {
      setSending(false);
    }
  };

  if (!chatReady) {
    return <ChatPageSkeleton />;
  }

  if (!activeLoad) {
    return (
      <div className="animate-in fade-in slide-in-from-bottom-2 duration-500 flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
        <p className="text-sm font-medium text-foreground">No active load for chat</p>
        <p className="text-xs text-muted-foreground">
          Accept or open a load first. Messages sync to the TrackingMessages table for that load.
        </p>
        <Button asChild size="sm">
          <Link to="/loads">Browse loads</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="animate-in fade-in slide-in-from-bottom-2 duration-500 flex min-h-0 flex-1 flex-col bg-background">
      <div className="shrink-0 border-b border-border/70 bg-background/90 px-4 py-2.5 backdrop-blur-sm">
        <p className="text-[11px] text-muted-foreground">
          Thread for <span className="font-mono font-medium text-foreground">{activeLoad.id}</span>
        </p>
      </div>

      <div
        ref={scrollRef}
        className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-4 py-4"
      >
        {messages.length === 0 ? (
          <div className="flex h-full min-h-[12rem] items-center justify-center">
            <p className="max-w-[16rem] rounded-xl border border-dashed border-border px-4 py-5 text-center text-xs text-muted-foreground">
              No messages yet. Say hello to dispatch — they’ll see it on the tracking console.
            </p>
          </div>
        ) : (
          messages.map((m) => <ChatBubble key={m.id} message={m} />)
        )}
      </div>

      <div className="shrink-0 border-t border-border/80 bg-background/95 shadow-[0_-8px_24px_-12px_rgba(0,0,0,0.12)] backdrop-blur-md">
        <div className="flex gap-2 overflow-x-auto px-4 pb-2 pt-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {QUICK_REPLIES.map((q) => (
            <button
              key={q}
              type="button"
              onClick={() => void send(q)}
              disabled={sending}
              className="shrink-0 whitespace-nowrap rounded-full border border-border bg-muted/60 px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-50"
            >
              {q}
            </button>
          ))}
        </div>

        <form
          className="flex items-center gap-2 px-3 pb-3 pt-1"
          onSubmit={(e) => {
            e.preventDefault();
            void send(draft);
          }}
        >
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Message dispatch…"
            className="h-11 flex-1 rounded-full bg-muted/40 px-4"
            disabled={sending}
          />
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-11 w-11 shrink-0 rounded-full"
            onClick={() => setVoiceOpen(true)}
            aria-label="Voice mode"
          >
            <Mic className="h-4 w-4" />
          </Button>
          <Button
            type="submit"
            variant="amber"
            size="icon"
            className="h-11 w-11 shrink-0 rounded-full"
            disabled={!draft.trim() || sending}
            aria-label="Send"
          >
            <Send className="h-4 w-4" />
          </Button>
        </form>
      </div>

      <VoiceOverlay open={voiceOpen} onClose={() => setVoiceOpen(false)} />
    </div>
  );
}
