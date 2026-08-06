import * as React from "react";
import { ArrowUp, Square } from "lucide-react";

import { ASSISTANT_INPUT_MAX_CHARS } from "@/components/logistics-ai/ai-chat-utils";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

type AiInputProps = {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  onStop: () => void;
  disabled?: boolean;
  streaming?: boolean;
  placeholder?: string;
};

export function AiInput({
  value,
  onChange,
  onSend,
  onStop,
  disabled = false,
  streaming = false,
  placeholder = "Ask Logistics AI…",
}: AiInputProps) {
  const ref = React.useRef<HTMLTextAreaElement>(null);

  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  }, [value]);

  const canSend = value.trim().length > 0 && !disabled && !streaming;

  return (
    <div className="shrink-0 border-t border-border/70 bg-background/90 p-3 backdrop-blur-sm">
      <div
        className={cn(
          "flex items-end gap-2 rounded-2xl border border-border/80 bg-muted/20 p-2 shadow-sm transition-colors duration-150",
          disabled && "opacity-70",
        )}
      >
        <Textarea
          ref={ref}
          value={value}
          disabled={disabled || streaming}
          placeholder={placeholder}
          rows={1}
          maxLength={ASSISTANT_INPUT_MAX_CHARS}
          className="max-h-[120px] min-h-[40px] flex-1 resize-none overflow-y-auto border-0 bg-transparent px-2 py-2 text-sm shadow-none [overflow-wrap:anywhere] focus-visible:ring-0"
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              if (canSend) onSend();
            }
          }}
        />
        {streaming ? (
          <Button
            type="button"
            size="icon"
            variant="secondary"
            className="h-9 w-9 shrink-0 cursor-pointer rounded-xl"
            onClick={onStop}
            aria-label="Stop generating"
          >
            <Square className="h-3.5 w-3.5 fill-current" />
          </Button>
        ) : (
          <Button
            type="button"
            size="icon"
            className="h-9 w-9 shrink-0 cursor-pointer rounded-xl"
            disabled={!canSend}
            onClick={onSend}
            aria-label="Send message"
          >
            <ArrowUp className="h-4 w-4" />
          </Button>
        )}
      </div>
      <p className="mt-1.5 px-1 text-[10px] text-muted-foreground">
        Enter to send · Shift+Enter for a new line
      </p>
    </div>
  );
}
