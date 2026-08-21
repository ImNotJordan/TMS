import * as React from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { CHANNEL_LABELS, languageDisplayName } from "../lib/formatters";
import type { KeywordHit, Message } from "../types";
import { t } from "@/lib/i18n/t";

export function TranslationToggle({
  showingOriginal,
  onToggle,
  originalLang,
}: {
  showingOriginal: boolean;
  onToggle: () => void;
  originalLang: string;
}) {
  return (
    <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={onToggle}>
      {showingOriginal
        ? "Show translation"
        : `Show original (${languageDisplayName(originalLang)})`}
    </Button>
  );
}

function highlightHits(text: string, hits: KeywordHit[]): React.ReactNode {
  if (!hits.length) return text;
  const sorted = [...hits].sort((a, b) => a.offset - b.offset);
  const parts: React.ReactNode[] = [];
  let cursor = 0;
  sorted.forEach((hit, index) => {
    const start = hit.offset;
    const end = start + hit.matchedTerm.length;
    if (start < cursor || start > text.length) return;
    if (start > cursor) parts.push(text.slice(cursor, start));
    const severityClass =
      hit.severity === "critical"
        ? "bg-destructive/20 text-destructive"
        : hit.severity === "warning"
          ? "bg-warning/25 text-warning-foreground"
          : "bg-muted text-foreground";
    parts.push(
      <mark
        key={`${hit.ruleId}-${index}`}
        className={cn("rounded px-0.5", severityClass)}
        title={`${hit.label} (${hit.severity})`}
      >
        {text.slice(start, Math.min(end, text.length))}
      </mark>,
    );
    cursor = Math.min(end, text.length);
  });
  if (cursor < text.length) parts.push(text.slice(cursor));
  return parts;
}

export function MessageBubble({ message, onRetry }: { message: Message; onRetry?: () => void }) {
  const [showOriginal, setShowOriginal] = React.useState(false);
  const outbound = message.direction === "outbound";
  const displayBody =
    message.translation && !showOriginal
      ? message.translation.translatedText
      : message.translation && showOriginal
        ? message.translation.originalText
        : message.body;

  const statusLabel =
    message.status === "blocked"
      ? "Blocked"
      : message.status.charAt(0).toUpperCase() + message.status.slice(1);

  return (
    <div
      className={cn("flex w-full", outbound ? "justify-end" : "justify-start")}
      data-message-id={message.id}
    >
      <div
        className={cn(
          "max-w-[85%] rounded-lg border border-border/70 px-3 py-2 text-sm motion-safe:animate-in motion-safe:fade-in",
          outbound ? "bg-primary/5" : "bg-card",
        )}
      >
        <div className="mb-1 flex flex-wrap items-center gap-1.5">
          <Badge variant="outline" className="h-5 text-[10px]">
            {CHANNEL_LABELS[message.channel]}
          </Badge>
          <span className="text-[11px] text-muted-foreground">{statusLabel}</span>
          {message.isAiGenerated ? (
            <Badge variant="outline" className="h-5 text-[10px]">
              AI
            </Badge>
          ) : null}
          {message.translation ? (
            <span className="text-[11px] text-muted-foreground">
              Translated from {languageDisplayName(message.translation.originalLang)}
            </span>
          ) : null}
          {message.translationNote ? (
            <span className="text-[11px] text-warning-foreground">{message.translationNote}</span>
          ) : null}
        </div>
        <p className="whitespace-pre-wrap break-words">
          {highlightHits(displayBody, message.keywordHits)}
        </p>
        {message.keywordHits.length > 0 ? (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {message.keywordHits.map((hit) => (
              <Badge
                key={`${hit.ruleId}-${hit.offset}`}
                variant="outline"
                className={cn(
                  "h-5 text-[10px]",
                  hit.severity === "critical" &&
                    "border-destructive/25 bg-destructive/15 text-destructive",
                  hit.severity === "warning" &&
                    "border-warning/25 bg-warning/20 text-warning-foreground",
                )}
              >
                {hit.label}
              </Badge>
            ))}
          </div>
        ) : null}
        {message.translation ? (
          <div className="mt-1">
            <TranslationToggle
              showingOriginal={showOriginal}
              onToggle={() => setShowOriginal((v) => !v)}
              originalLang={message.translation.originalLang}
            />
          </div>
        ) : null}
        {message.status === "failed" ? (
          <div className="mt-2 flex items-center gap-2 text-xs text-destructive">
            <span>{message.failureReason ?? "Send failed."}</span>
            {onRetry ? (
              <Button type="button" variant="outline" size="sm" className="h-7" onClick={onRetry}>
                {t("Retry")}
              </Button>
            ) : null}
          </div>
        ) : null}
        {message.status === "blocked" ? (
          <p className="mt-2 text-xs text-destructive">
            {message.failureReason ?? "Send blocked."}
          </p>
        ) : null}
      </div>
    </div>
  );
}

export function MessageThread({
  messages,
  isLoading,
  onRetry,
}: {
  messages: Message[];
  isLoading: boolean;
  onRetry?: (message: Message) => void;
}) {
  if (isLoading) {
    return (
      <div className="space-y-3" aria-busy="true">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className={cn(
              "h-16 animate-pulse rounded-lg border border-border/70 bg-muted/40",
              i % 2 === 0 ? "mr-12" : "ml-12",
            )}
          />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-3" aria-live="polite" role="log" aria-label={t("Message thread")}>
      {messages.map((message) => (
        <MessageBubble
          key={message.id}
          message={message}
          onRetry={message.status === "failed" && onRetry ? () => onRetry(message) : undefined}
        />
      ))}
    </div>
  );
}
