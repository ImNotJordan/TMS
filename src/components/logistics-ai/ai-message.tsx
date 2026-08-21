import * as React from "react";
import { Check, Copy } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { UIMessage } from "ai";

import { messageText } from "@/components/logistics-ai/ai-chat-utils";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { t } from "@/lib/i18n/t";

type AiMessageProps = {
  message: UIMessage;
  isStreaming?: boolean;
};

function CodeBlock({ children, className }: { children: React.ReactNode; className?: string }) {
  const [copied, setCopied] = React.useState(false);
  const text = String(children).replace(/\n$/, "");

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      // ignore
    }
  };

  return (
    <div className="group relative my-2 max-w-full overflow-hidden rounded-xl border border-border/70 bg-muted/40">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="absolute right-1.5 top-1.5 z-10 h-7 w-7 cursor-pointer opacity-0 transition-opacity duration-150 group-hover:opacity-100"
        onClick={() => void onCopy()}
        aria-label={t("Copy code")}
      >
        {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      </Button>
      <pre className="max-w-full overflow-x-auto p-3 pr-10 text-[11px] leading-relaxed [overflow-wrap:anywhere]">
        <code className={cn("whitespace-pre-wrap break-words", className)}>{text}</code>
      </pre>
    </div>
  );
}

const bubbleBase =
  "min-w-0 max-w-[min(100%,20.5rem)] rounded-2xl px-3 py-2 text-sm leading-relaxed [overflow-wrap:anywhere] break-words";

export function AiMessage({ message, isStreaming = false }: AiMessageProps) {
  const isUser = message.role === "user";
  const text = messageText(message);

  return (
    <div
      className={cn(
        "flex w-full min-w-0 gap-2.5 animate-in fade-in-0 slide-in-from-bottom-1 duration-150",
        isUser ? "flex-row-reverse" : "flex-row",
      )}
    >
      <Avatar className="mt-0.5 h-7 w-7 shrink-0 rounded-lg border border-border/70">
        {isUser ? (
          <AvatarFallback className="rounded-lg bg-primary/15 text-[10px] font-semibold text-primary">
            You
          </AvatarFallback>
        ) : (
          <>
            <AvatarImage src="/ai.png" alt="" className="scale-125 object-cover object-center" />
            <AvatarFallback className="rounded-lg text-[10px]">AI</AvatarFallback>
          </>
        )}
      </Avatar>

      <div
        className={cn(
          bubbleBase,
          isUser
            ? "bg-primary text-primary-foreground"
            : "border border-border/70 bg-muted/30 text-foreground",
        )}
      >
        {isUser ? (
          <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{text}</p>
        ) : isStreaming ? (
          <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
            {text}
            <span
              className="ml-0.5 inline-block h-3.5 w-1.5 translate-y-0.5 animate-pulse rounded-sm bg-foreground/70"
              aria-hidden
            />
          </p>
        ) : (
          <div
            className={cn(
              "min-w-0 max-w-full text-sm leading-relaxed",
              "[&_p]:my-1.5 [&_ul]:my-1.5 [&_ol]:my-1.5 [&_li]:my-0.5",
              "[&_h1]:my-2 [&_h2]:my-2 [&_h3]:my-2",
              "[&_pre]:max-w-full [&_code]:break-words",
              "[&_a]:break-all [&_a]:underline [&_a]:underline-offset-2",
              "[&_table]:block [&_table]:w-full [&_table]:max-w-full [&_table]:overflow-x-auto",
              "[&_th]:border [&_th]:border-border/70 [&_th]:bg-muted/40 [&_th]:px-2 [&_th]:py-1 [&_th]:text-left",
              "[&_td]:border [&_td]:border-border/70 [&_td]:px-2 [&_td]:py-1",
            )}
          >
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                code({ className, children, ...props }) {
                  const isBlock =
                    Boolean(className?.includes("language-")) || String(children).includes("\n");
                  if (isBlock) {
                    return <CodeBlock className={className}>{children}</CodeBlock>;
                  }
                  return (
                    <code
                      className="break-words rounded bg-muted px-1 py-0.5 text-[11px] font-medium"
                      {...props}
                    >
                      {children}
                    </code>
                  );
                },
                a({ href, children }) {
                  return (
                    <a href={href} target="_blank" rel="noreferrer" className="break-all">
                      {children}
                    </a>
                  );
                },
                table({ children }) {
                  return (
                    <div className="my-2 max-w-full overflow-x-auto rounded-lg border border-border/60">
                      <table className="w-full min-w-[240px] border-collapse text-xs">
                        {children}
                      </table>
                    </div>
                  );
                },
              }}
            >
              {text || "…"}
            </ReactMarkdown>
          </div>
        )}
      </div>
    </div>
  );
}

export function AiTypingIndicator() {
  return (
    <div className="flex w-full min-w-0 items-center gap-2.5 animate-in fade-in-0 duration-150">
      <Avatar className="h-7 w-7 shrink-0 rounded-lg border border-border/70">
        <AvatarImage src="/ai.png" alt="" className="scale-125 object-cover object-center" />
        <AvatarFallback className="rounded-lg text-[10px]">AI</AvatarFallback>
      </Avatar>
      <div className="rounded-2xl border border-border/70 bg-muted/30 px-3 py-2.5">
        <div className="flex items-center gap-1" aria-label={t("Assistant is typing")}>
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="h-1.5 w-1.5 rounded-full bg-muted-foreground/70 motion-reduce:animate-none"
              style={{
                animation: "logistics-ai-dot 1s ease-in-out infinite",
                animationDelay: `${i * 0.16}s`,
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

export function AiErrorBubble({
  title,
  detail,
  onRetry,
}: {
  title: string;
  detail: string;
  onRetry?: () => void;
}) {
  return (
    <div className="flex w-full min-w-0 gap-2.5 animate-in fade-in-0 slide-in-from-bottom-1 duration-150">
      <Avatar className="mt-0.5 h-7 w-7 shrink-0 rounded-lg border border-border/70">
        <AvatarImage src="/ai.png" alt="" className="scale-125 object-cover object-center" />
        <AvatarFallback className="rounded-lg text-[10px]">AI</AvatarFallback>
      </Avatar>
      <div
        className={cn(
          bubbleBase,
          "space-y-2 border border-destructive/30 bg-destructive/5 text-foreground",
        )}
      >
        <p className="font-medium">{title}</p>
        <p className="text-xs leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">
          {detail}
        </p>
        {onRetry ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7 cursor-pointer rounded-lg text-xs"
            onClick={onRetry}
          >
            {t("Retry")}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
