import * as React from "react";
import { createPortal } from "react-dom";
import { Download, Eye, FileText, Loader2, Send, Trash2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { formatBytes } from "@/lib/load-documents";
import { getLoadById } from "@/lib/loads-store";
import {
  deleteTrackingMessage,
  sendTrackingMessage,
  type TrackingDocument,
  type TrackingMessage,
} from "@/lib/tracking-workflow-store";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

const LONG_PRESS_MS = 500;

const LEGACY_DOC_RE =
  /uploaded\s+(Bill of Lading|Proof of Delivery)(?:\s+\(([^)]+)\))?/i;

function prettyTime(iso?: string | null) {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function isOutgoingMessage(from: TrackingMessage["from"]) {
  return from === "ops" || from === "system";
}

function senderLabel(from: TrackingMessage["from"]) {
  if (from === "system") return "System";
  if (from === "ops") return "Ops";
  return "Driver";
}

type ResolvedAttachment = {
  label: string;
  fileName: string;
  docType: "BOL" | "POD";
  contentType?: string;
  viewUrl?: string;
  size?: number;
};

function resolveDocAttachment(
  message: TrackingMessage,
  documents: TrackingDocument[],
): ResolvedAttachment | null {
  let docKind = message.docKind;
  let fileName = message.fileName;
  let contentType = message.contentType;

  if (!docKind) {
    const match = message.text.match(LEGACY_DOC_RE);
    if (!match) return null;
    docKind = /proof|pod/i.test(match[1] ?? "") ? "pod" : "bol";
    fileName = fileName || match[2]?.trim() || undefined;
  }

  const docType = docKind === "pod" ? "POD" : "BOL";
  const label = docKind === "pod" ? "Proof of Delivery" : "Bill of Lading";
  const matched =
    documents.find((d) => d.type === docType && d.viewUrl) ??
    documents.find((d) => d.type === docType);

  const rawName = fileName || matched?.name || label;
  const base = rawName.replace(/\.[^.]+$/, "");
  const uglyUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(base);
  const isPdf = (contentType || matched?.contentType || "").includes("pdf") || /\.pdf$/i.test(rawName);
  const displayName = uglyUuid
    ? `${docKind === "pod" ? "POD" : "BOL"} · ${prettyTime(message.timestamp)}.${isPdf ? "pdf" : "jpg"}`
    : rawName;

  return {
    label,
    fileName: displayName,
    docType,
    contentType: contentType || matched?.contentType,
    viewUrl: matched?.viewUrl,
    size: matched?.size,
  };
}

function useLongPress(onLongPress: (event: React.PointerEvent) => void, ms = LONG_PRESS_MS) {
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const suppressClickRef = React.useRef(false);

  const clearTimer = React.useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  React.useEffect(() => clearTimer, [clearTimer]);

  return {
    onPointerDown: (event: React.PointerEvent) => {
      if (event.button !== 0) return;
      suppressClickRef.current = false;
      clearTimer();
      timerRef.current = setTimeout(() => {
        suppressClickRef.current = true;
        onLongPress(event);
        if (typeof navigator !== "undefined" && "vibrate" in navigator) {
          navigator.vibrate(10);
        }
      }, ms);
    },
    onPointerUp: clearTimer,
    onPointerLeave: clearTimer,
    onPointerCancel: clearTimer,
    onClick: (event: React.MouseEvent) => {
      if (suppressClickRef.current) {
        event.preventDefault();
        event.stopPropagation();
        suppressClickRef.current = false;
      }
    },
  };
}

function computeMenuPosition(event: React.PointerEvent, outgoing: boolean) {
  const menuWidth = 196;
  const menuHeight = 92;
  const padding = 12;
  const gap = 10;

  let x = outgoing ? event.clientX - menuWidth + 24 : event.clientX - 12;
  let y = event.clientY - menuHeight - gap;

  if (y < padding) y = event.clientY + gap;
  x = Math.max(padding, Math.min(x, window.innerWidth - menuWidth - padding));
  y = Math.max(padding, Math.min(y, window.innerHeight - menuHeight - padding));

  return { x, y };
}

type MessageActionMenuProps = {
  open: boolean;
  position: { x: number; y: number };
  outgoing: boolean;
  onClose: () => void;
  onDelete: () => void;
  deleting: boolean;
};

function MessageActionMenu({
  open,
  position,
  outgoing,
  onClose,
  onDelete,
  deleting,
}: MessageActionMenuProps) {
  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <>
      <button
        type="button"
        className="fixed inset-0 z-[200] cursor-default bg-background/30 backdrop-blur-[3px] animate-in fade-in-0 duration-150"
        aria-label="Close message menu"
        onClick={onClose}
      />
      <div
        className={cn(
          "fixed z-[210] w-[12.25rem] overflow-hidden rounded-2xl border border-border/60",
          "bg-background/95 p-1.5 text-popover-foreground shadow-[0_20px_50px_-16px_rgba(15,23,42,0.45)] backdrop-blur-xl",
          "animate-in fade-in-0 zoom-in-95 duration-200",
          outgoing ? "slide-in-from-bottom-1 slide-in-from-right-1" : "slide-in-from-bottom-1 slide-in-from-left-1",
        )}
        style={{ left: position.x, top: position.y }}
        role="menu"
      >
        <div className="border-b border-border/50 px-2.5 py-2">
          <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
            Message actions
          </p>
        </div>
        <div className="p-1">
          <button
            type="button"
            role="menuitem"
            disabled={deleting}
            className={cn(
              "group flex w-full items-center gap-3 rounded-xl px-2 py-2.5 text-left transition-all",
              "hover:bg-destructive/8 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50",
            )}
            onClick={() => void onDelete()}
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-destructive/12 text-destructive ring-1 ring-destructive/20 transition-colors group-hover:bg-destructive/18">
              {deleting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4" />
              )}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold text-destructive">Delete message</span>
              <span className="block text-[11px] text-muted-foreground">Remove for everyone</span>
            </span>
          </button>
        </div>
      </div>
    </>,
    document.body,
  );
}

const CURSOR_RING_SIZE = 28;
const CURSOR_RING_R = 11;
const CURSOR_RING_CIRCUMFERENCE = 2 * Math.PI * CURSOR_RING_R;

function LongPressCursorRing({
  point,
  active,
}: {
  point: { x: number; y: number } | null;
  active: boolean;
}) {
  if (!active || !point || typeof document === "undefined") return null;

  const offset = CURSOR_RING_SIZE / 2;

  return createPortal(
    <div
      className="pointer-events-none fixed z-[190]"
      style={{
        left: point.x - offset,
        top: point.y - offset,
        width: CURSOR_RING_SIZE,
        height: CURSOR_RING_SIZE,
      }}
      aria-hidden
    >
      <svg className="h-full w-full -rotate-90" viewBox={`0 0 ${CURSOR_RING_SIZE} ${CURSOR_RING_SIZE}`}>
        <circle
          cx={CURSOR_RING_SIZE / 2}
          cy={CURSOR_RING_SIZE / 2}
          r={CURSOR_RING_R}
          fill="hsl(var(--background) / 0.92)"
          stroke="currentColor"
          strokeWidth="2"
          className="text-primary/20"
        />
        <circle
          cx={CURSOR_RING_SIZE / 2}
          cy={CURSOR_RING_SIZE / 2}
          r={CURSOR_RING_R}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          className="text-primary"
          strokeDasharray={CURSOR_RING_CIRCUMFERENCE}
          strokeDashoffset={CURSOR_RING_CIRCUMFERENCE}
          style={{ animation: `tracking-msg-long-press ${LONG_PRESS_MS}ms linear forwards` }}
        />
      </svg>
      <style>{`@keyframes tracking-msg-long-press { to { stroke-dashoffset: 0; } }`}</style>
    </div>,
    document.body,
  );
}

function DocumentAttachmentCard({
  attachment,
  outgoing,
  loading,
  onOpen,
}: {
  attachment: ResolvedAttachment;
  outgoing: boolean;
  loading?: boolean;
  onOpen: () => void;
}) {
  const canAttempt = Boolean(attachment.viewUrl) || Boolean(attachment.docType);
  const isImage =
    Boolean(attachment.contentType?.startsWith("image/")) ||
    Boolean(attachment.viewUrl?.startsWith("data:image"));

  return (
    <button
      type="button"
      data-doc-attach="true"
      onPointerDown={(e) => {
        // Keep bubble long-press / pointer-capture from eating this control
        e.stopPropagation();
      }}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (canAttempt && !loading) onOpen();
      }}
      disabled={!canAttempt || loading}
      className={cn(
        "mt-1.5 flex w-full min-w-[15rem] max-w-[18.5rem] items-stretch gap-0 overflow-hidden rounded-xl text-left transition",
        outgoing
          ? "bg-primary-foreground/12 ring-1 ring-primary-foreground/20"
          : "bg-muted/50 ring-1 ring-border/70",
        canAttempt
          ? "hover:brightness-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          : "cursor-default opacity-90",
      )}
    >
      <span
        className={cn(
          "flex h-[4.25rem] w-[4.25rem] shrink-0 items-center justify-center overflow-hidden",
          outgoing ? "bg-primary-foreground/10" : "bg-background",
        )}
      >
        {attachment.viewUrl && isImage ? (
          <img src={attachment.viewUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          <FileText className={cn("h-6 w-6", outgoing ? "text-primary-foreground/80" : "text-muted-foreground")} />
        )}
      </span>
      <span className="flex min-w-0 flex-1 flex-col justify-center gap-0.5 px-3 py-2">
        <span
          className={cn(
            "truncate text-sm font-semibold leading-tight",
            outgoing ? "text-primary-foreground" : "text-foreground",
          )}
        >
          {attachment.label}
        </span>
        <span
          className={cn(
            "truncate text-[11px] leading-tight",
            outgoing ? "text-primary-foreground/75" : "text-muted-foreground",
          )}
        >
          {attachment.fileName}
          {attachment.size ? ` · ${formatBytes(attachment.size)}` : ""}
        </span>
        <span
          className={cn(
            "mt-0.5 inline-flex items-center gap-1 text-[11px] font-medium",
            outgoing ? "text-primary-foreground/90" : "text-primary",
          )}
        >
          {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Eye className="h-3 w-3" />}
          {loading ? "Opening…" : "Tap to view"}
        </span>
      </span>
    </button>
  );
}

function DocumentViewerDialog({
  attachment,
  open,
  onOpenChange,
}: {
  attachment: ResolvedAttachment | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const viewUrl = attachment?.viewUrl;
  if (!open || !attachment || !viewUrl) return null;

  const download = () => {
    const a = document.createElement("a");
    a.href = viewUrl;
    a.download = attachment.fileName || "document";
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const isPdf =
    attachment.contentType?.includes("pdf") || viewUrl.startsWith("data:application/pdf");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-hidden p-0 sm:rounded-2xl">
        <DialogHeader className="space-y-1 border-b border-border/70 px-5 py-4 text-left">
          <DialogTitle className="pr-8 text-base">{attachment.label}</DialogTitle>
          <DialogDescription>{attachment.fileName}</DialogDescription>
        </DialogHeader>
        <div className="max-h-[min(70vh,640px)] overflow-auto bg-muted/30 p-4">
          {isPdf ? (
            <iframe
              title={attachment.label}
              src={viewUrl}
              className="h-[min(65vh,600px)] w-full rounded-lg border border-border bg-background"
            />
          ) : (
            <img
              src={viewUrl}
              alt={attachment.label}
              className="mx-auto max-h-[min(65vh,600px)] w-auto max-w-full rounded-lg object-contain shadow-sm"
            />
          )}
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-border/70 px-4 py-3">
          <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={() => onOpenChange(false)}>
            <X className="h-3.5 w-3.5" /> Close
          </Button>
          <Button type="button" size="sm" className="gap-1.5" onClick={download}>
            <Download className="h-3.5 w-3.5" /> Download
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function TrackingMessageBubble({
  message,
  loadId,
  documents,
  onDelete,
}: {
  message: TrackingMessage;
  loadId: string;
  documents: TrackingDocument[];
  onDelete: (messageId: string) => Promise<void>;
}) {
  const outgoing = isOutgoingMessage(message.from);
  const baseAttachment = resolveDocAttachment(message, documents);
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [menuPosition, setMenuPosition] = React.useState({ x: 0, y: 0 });
  const [deleting, setDeleting] = React.useState(false);
  const [pressing, setPressing] = React.useState(false);
  const [pressPoint, setPressPoint] = React.useState<{ x: number; y: number } | null>(null);
  const [viewerOpen, setViewerOpen] = React.useState(false);
  const [opening, setOpening] = React.useState(false);
  const [liveAttachment, setLiveAttachment] = React.useState<ResolvedAttachment | null>(null);
  const bubbleRef = React.useRef<HTMLDivElement>(null);

  const attachment = liveAttachment ?? baseAttachment;

  const longPressHandlers = useLongPress((event) => {
    setMenuPosition(computeMenuPosition(event, outgoing));
    setMenuOpen(true);
    setPressing(false);
    setPressPoint(null);
  });

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await onDelete(message.id);
      setMenuOpen(false);
    } finally {
      setDeleting(false);
    }
  };

  const openDocument = async () => {
    if (!baseAttachment) return;
    if (baseAttachment.viewUrl || liveAttachment?.viewUrl) {
      setLiveAttachment(baseAttachment.viewUrl ? baseAttachment : liveAttachment);
      setViewerOpen(true);
      return;
    }

    setOpening(true);
    try {
      const load = await getLoadById(loadId);
      const kind = baseAttachment.docType === "POD" ? "pod" : "bol";
      const asset = (load?.documentAssets ?? []).find((a) => a.kind === kind);
      if (!asset?.dataUrl) {
        toast.error("Document file not available", {
          description: "Refresh Tracking, or open the Documents tab after the next sync.",
        });
        return;
      }
      const next: ResolvedAttachment = {
        ...baseAttachment,
        viewUrl: asset.dataUrl,
        contentType: asset.contentType || baseAttachment.contentType,
        fileName: asset.fileName || baseAttachment.fileName,
        size: asset.size ?? baseAttachment.size,
      };
      setLiveAttachment(next);
      setViewerOpen(true);
    } catch (err) {
      console.error("[tracking] open document failed", err);
      toast.error("Could not open document", {
        description: err instanceof Error ? err.message : "Try refreshing Tracking.",
      });
    } finally {
      setOpening(false);
    }
  };

  const caption = attachment
    ? message.text.replace(LEGACY_DOC_RE, "uploaded $1").replace(/\s+\([^)]+\)\.?$/, "").replace(/\.$/, "")
    : message.text;

  const isInteractiveTarget = (event: React.PointerEvent | React.MouseEvent) => {
    const el = event.target as HTMLElement | null;
    return Boolean(el?.closest?.("[data-doc-attach='true']"));
  };

  return (
    <>
      <div className={cn("flex w-full", outgoing ? "justify-end" : "justify-start")}>
        <div
          ref={bubbleRef}
          className={cn(
            "relative flex max-w-[min(100%,20rem)] flex-col gap-0.5 select-none",
            pressing && "scale-[0.98]",
            menuOpen && "ring-2 ring-primary/35 ring-offset-2 ring-offset-transparent rounded-2xl",
            outgoing ? "items-end" : "items-start",
          )}
          {...longPressHandlers}
          onPointerDown={(event) => {
            if (isInteractiveTarget(event)) {
              longPressHandlers.onPointerUp();
              return;
            }
            setPressing(true);
            setPressPoint({ x: event.clientX, y: event.clientY });
            bubbleRef.current?.setPointerCapture(event.pointerId);
            longPressHandlers.onPointerDown(event);
          }}
          onPointerMove={(event) => {
            if (isInteractiveTarget(event)) return;
            if ((event.buttons & 1) === 0) return;
            setPressPoint({ x: event.clientX, y: event.clientY });
          }}
          onPointerUp={(event) => {
            if (bubbleRef.current?.hasPointerCapture(event.pointerId)) {
              bubbleRef.current.releasePointerCapture(event.pointerId);
            }
            setPressing(false);
            setPressPoint(null);
            longPressHandlers.onPointerUp?.(event);
          }}
          onPointerLeave={(event) => {
            if (bubbleRef.current?.hasPointerCapture(event.pointerId)) return;
            setPressing(false);
            setPressPoint(null);
            longPressHandlers.onPointerLeave?.(event);
          }}
          onPointerCancel={(event) => {
            if (bubbleRef.current?.hasPointerCapture(event.pointerId)) {
              bubbleRef.current.releasePointerCapture(event.pointerId);
            }
            setPressing(false);
            setPressPoint(null);
            longPressHandlers.onPointerCancel?.(event);
          }}
        >
          <span className="px-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            {senderLabel(message.from)}
          </span>
          <div
            className={cn(
              "px-3 py-2 text-sm leading-snug shadow-sm",
              outgoing
                ? message.from === "system"
                  ? "rounded-2xl rounded-br-md border border-info/25 bg-info/12 text-foreground"
                  : "rounded-2xl rounded-br-md bg-primary text-primary-foreground"
                : "rounded-2xl rounded-bl-md border border-border/70 bg-background text-foreground",
            )}
          >
            <p>
              {caption}
              {attachment ? "." : ""}
            </p>
            {attachment ? (
              <DocumentAttachmentCard
                attachment={attachment}
                outgoing={outgoing && message.from !== "system"}
                loading={opening}
                onOpen={() => void openDocument()}
              />
            ) : null}
          </div>
          <span className="px-1 text-[10px] text-muted-foreground">
            {prettyTime(message.timestamp)}
          </span>
        </div>
      </div>

      <LongPressCursorRing point={pressPoint} active={pressing && !menuOpen} />

      <MessageActionMenu
        open={menuOpen}
        position={menuPosition}
        outgoing={outgoing}
        onClose={() => setMenuOpen(false)}
        onDelete={handleDelete}
        deleting={deleting}
      />

      <DocumentViewerDialog
        attachment={attachment}
        open={viewerOpen}
        onOpenChange={setViewerOpen}
      />
    </>
  );
}

type TrackingMessagesPanelProps = {
  loadId: string;
  messages: TrackingMessage[];
  documents?: TrackingDocument[];
  /** When false (inactive tab), skip scroll until the tab is shown. */
  active?: boolean;
};

function scrollMessageListToEnd(list: HTMLElement) {
  // Prefer scrollTop — scrollIntoView can move the page and fight route scroll restore.
  list.scrollTop = list.scrollHeight;
}

export function TrackingMessagesPanel({
  loadId,
  messages,
  documents = [],
  active = true,
}: TrackingMessagesPanelProps) {
  const [messageText, setMessageText] = React.useState("");
  const [sending, setSending] = React.useState(false);
  const [sendError, setSendError] = React.useState<string | null>(null);
  const [actionError, setActionError] = React.useState<string | null>(null);
  const listRef = React.useRef<HTMLDivElement>(null);
  const endRef = React.useRef<HTMLDivElement>(null);
  const lastMessageId = messages[messages.length - 1]?.id;
  const lastScrolledKeyRef = React.useRef<string | null>(null);
  const activeRef = React.useRef(active);
  activeRef.current = active;

  const scrollToLatest = React.useCallback((force = false) => {
    if (!activeRef.current) return;
    const list = listRef.current;
    if (!list) return;
    // Tab panels that were `hidden` report 0 height until layout settles
    if (list.clientHeight < 8) return;

    const key = `${loadId}:${lastMessageId ?? "empty"}:${messages.length}`;
    if (!force && lastScrolledKeyRef.current === key) {
      const distanceFromBottom = list.scrollHeight - list.scrollTop - list.clientHeight;
      if (distanceFromBottom < 48) scrollMessageListToEnd(list);
      return;
    }
    lastScrolledKeyRef.current = key;
    scrollMessageListToEnd(list);
  }, [loadId, lastMessageId, messages.length]);

  React.useLayoutEffect(() => {
    if (!active) {
      lastScrolledKeyRef.current = null;
      return;
    }

    scrollToLatest(true);

    let raf2 = 0;
    const raf1 = window.requestAnimationFrame(() => {
      scrollToLatest(true);
      raf2 = window.requestAnimationFrame(() => scrollToLatest(true));
    });

    // Radix tab reveal + image/doc cards need a short follow-up after paint
    const t1 = window.setTimeout(() => scrollToLatest(true), 50);
    const t2 = window.setTimeout(() => scrollToLatest(true), 180);

    const list = listRef.current;
    const ro =
      typeof ResizeObserver !== "undefined" && list
        ? new ResizeObserver(() => scrollToLatest(false))
        : null;
    if (list && ro) ro.observe(list);

    return () => {
      window.cancelAnimationFrame(raf1);
      window.cancelAnimationFrame(raf2);
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      ro?.disconnect();
    };
  }, [active, loadId, lastMessageId, messages.length, scrollToLatest]);

  const sendMessage = async () => {
    const trimmed = messageText.trim();
    if (!trimmed || sending) return;
    setSending(true);
    setSendError(null);
    try {
      await sendTrackingMessage(loadId, "ops", trimmed);
      setMessageText("");
      window.requestAnimationFrame(() => scrollToLatest(true));
    } catch (err) {
      setSendError(err instanceof Error ? err.message : "Failed to send message.");
    } finally {
      setSending(false);
    }
  };

  const handleDeleteMessage = async (messageId: string) => {
    setActionError(null);
    try {
      await deleteTrackingMessage(loadId, messageId);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to delete message.");
      throw err;
    }
  };

  return (
    <div className="flex h-[min(26rem,70vh)] flex-col overflow-hidden rounded-xl border border-border/70 bg-muted/15">
      <div ref={listRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto overflow-x-hidden p-3">
        {messages.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No messages yet. Start the conversation below.
          </p>
        ) : (
          messages.map((message) => (
            <TrackingMessageBubble
              key={message.id}
              message={message}
              loadId={loadId}
              documents={documents}
              onDelete={handleDeleteMessage}
            />
          ))
        )}
        <div ref={endRef} aria-hidden className="h-px w-full shrink-0" />
      </div>
      <div className="border-t border-border/70 bg-background/80 p-2">
        {sendError ? <p className="mb-2 px-1 text-xs text-destructive">{sendError}</p> : null}
        {actionError ? <p className="mb-2 px-1 text-xs text-destructive">{actionError}</p> : null}
        <div className="flex gap-2">
          <Input
            value={messageText}
            onChange={(e) => setMessageText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void sendMessage();
              }
            }}
            placeholder="Message driver…"
            className="rounded-full border-border/70 bg-muted/30"
            disabled={sending}
          />
          <Button
            size="icon"
            className="h-9 w-9 shrink-0 rounded-full"
            onClick={() => void sendMessage()}
            disabled={!messageText.trim() || sending}
          >
            <Send className="h-4 w-4" />
            <span className="sr-only">Send</span>
          </Button>
        </div>
      </div>
    </div>
  );
}
