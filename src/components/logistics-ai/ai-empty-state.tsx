import { Link } from "@tanstack/react-router";
import { KeyRound, Sparkles } from "lucide-react";

import { SUGGESTED_PROMPTS } from "@/components/logistics-ai/ai-chat-utils";
import { Button } from "@/components/ui/button";
import { t } from "@/lib/i18n/t";

type AiEmptyStateProps = {
  connected: boolean;
  onPickPrompt: (prompt: string) => void;
};

export function AiEmptyState({ connected, onPickPrompt }: AiEmptyStateProps) {
  if (!connected) {
    return (
      <div className="flex h-full min-h-0 flex-col items-center justify-center gap-4 px-6 py-8 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-border/80 bg-muted/40">
          <KeyRound className="h-5 w-5 text-muted-foreground" />
        </div>
        <div className="max-w-[18rem] space-y-1.5">
          <p className="text-sm font-semibold text-foreground">{t("Connect your OpenAI key")}</p>
          <p className="text-xs leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">
            {t(
              "Logistics AI uses the key saved under Settings → Integrations. Nothing is called until\n            that key is connected.",
            )}
          </p>
        </div>
        <Button asChild size="sm" className="cursor-pointer rounded-xl">
          <Link to="/settings">{t("Open Integrations settings")}</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col justify-end gap-4 px-1 py-2">
      <div className="space-y-1.5">
        <div className="mb-2 inline-flex items-center gap-1.5 rounded-full border border-border/70 bg-muted/40 px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
          <Sparkles className="h-3 w-3" />
          {t("Logistics AI")}
        </div>
        <p className="text-sm font-semibold text-foreground">
          {t("How can I help with ops today?")}
        </p>
        <p className="text-xs leading-relaxed text-muted-foreground">
          {t(
            "Ask about shipments, exceptions, carrier questions, or draft a quick operational message.",
          )}
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        {SUGGESTED_PROMPTS.map((prompt) => (
          <button
            key={prompt}
            type="button"
            onClick={() => onPickPrompt(prompt)}
            className="cursor-pointer rounded-xl border border-border/70 bg-background px-3 py-1.5 text-left text-xs text-foreground transition-colors duration-150 hover:border-primary/40 hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {prompt}
          </button>
        ))}
      </div>
    </div>
  );
}
