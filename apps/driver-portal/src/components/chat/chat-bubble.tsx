import { Bot } from "lucide-react";

import type { ChatMessage } from "@/lib/mock-data";
import { cn } from "@/lib/utils";

export function ChatBubble({ message }: { message: ChatMessage }) {
  const isDriver = message.from === "driver";

  return (
    <div className={cn("flex items-end gap-2", isDriver && "flex-row-reverse")}>
      {!isDriver ? (
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-ink text-amber">
          <Bot className="h-4 w-4" />
        </div>
      ) : null}
      <div
        className={cn(
          "max-w-[78%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed",
          isDriver
            ? "rounded-br-sm bg-primary text-primary-foreground"
            : "rounded-bl-sm border border-border bg-card text-card-foreground",
        )}
      >
        {message.text}
        <div
          className={cn(
            "mt-1 font-mono text-[10px]",
            isDriver ? "text-primary-foreground/70" : "text-muted-foreground",
          )}
        >
          {message.time}
        </div>
      </div>
    </div>
  );
}
