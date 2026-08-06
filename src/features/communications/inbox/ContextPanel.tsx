import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";

import { CHANNEL_LABELS, formatDuration } from "../lib/formatters";
import type { AgentConfig, ConsentRecord, Conversation, DncEntry, Message } from "../types";

export function ThreadHeader({ conversation }: { conversation: Conversation }) {
  return (
    <div className="min-w-0 space-y-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="truncate text-base font-semibold tracking-tight text-foreground sm:text-lg">
          {conversation.subject}
        </h2>
        <Badge variant="outline">{CHANNEL_LABELS[conversation.primaryChannel]}</Badge>
        {conversation.status !== "open" ? (
          <Badge variant="outline" className="capitalize">
            {conversation.status}
          </Badge>
        ) : null}
      </div>
      <p className="truncate text-sm text-muted-foreground">
        Contact · {conversation.contactId}
        {conversation.loadId ? ` · Load #${conversation.loadId}` : ""}
      </p>
    </div>
  );
}

export function ContextPanel({
  conversation,
  messages,
  consent,
  dnc,
  agentConfig,
  aiConnected,
  onSuggestReply,
  suggesting,
}: {
  conversation: Conversation | null;
  messages: Message[];
  consent?: ConsentRecord;
  dnc?: DncEntry;
  agentConfig: AgentConfig;
  aiConnected: boolean;
  onSuggestReply: () => void;
  suggesting: boolean;
}) {
  if (!conversation) {
    return (
      <div className="rounded-lg border border-dashed border-border/70 bg-muted/20 px-4 py-8 text-center text-sm text-muted-foreground">
        Select a conversation to see load, contact, and activity context.
      </div>
    );
  }

  const voice = [...messages].reverse().find((m) => m.voice);

  return (
    <div className="space-y-4 text-sm">
      <section className="space-y-1.5 rounded-lg border border-border/70 bg-muted/20 p-3">
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Linked load
        </h3>
        {conversation.loadId ? (
          <div>
            <p className="font-medium tabular-nums text-foreground">Load #{conversation.loadId}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Open Loads for pickup, delivery, status, and carrier details.
            </p>
          </div>
        ) : (
          <p className="text-muted-foreground">No load linked.</p>
        )}
      </section>

      <section className="space-y-1.5 rounded-lg border border-border/70 bg-muted/20 p-3">
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Contact
        </h3>
        <p className="font-medium text-foreground">{conversation.contactId}</p>
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span>
            Consent:{" "}
            <span className="font-medium text-foreground">{consent?.state ?? "unknown"}</span>
          </span>
          <span>
            DNC:{" "}
            <span className="font-medium text-foreground">
              {dnc ? `yes — ${dnc.reason}` : "no"}
            </span>
          </span>
        </div>
      </section>

      <section className="space-y-2 rounded-lg border border-border/70 bg-muted/20 p-3">
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          AI agent
        </h3>
        <p className="text-xs text-muted-foreground">
          Persona: {agentConfig.persona.replace("-", " ")} · Tone: {agentConfig.tone}
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 w-full cursor-pointer"
          disabled={!aiConnected || suggesting || !agentConfig.allowedActions.includes("draft-reply")}
          title={
            !aiConnected
              ? "AI integration is disconnected."
              : !agentConfig.allowedActions.includes("draft-reply")
                ? "draft-reply is not enabled for the agent."
                : undefined
          }
          onClick={onSuggestReply}
        >
          {suggesting ? "Drafting…" : "Suggest reply"}
        </Button>
        {!aiConnected ? (
          <p className="text-xs text-muted-foreground">
            AI is disconnected. Connect it in Settings → Integrations.
          </p>
        ) : null}
      </section>

      <Separator />

      <section className="space-y-1.5">
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Activity
        </h3>
        {conversation.keywordFlags.length === 0 ? (
          <p className="text-xs text-muted-foreground">No keyword hits on this thread.</p>
        ) : (
          <ul className="space-y-1.5">
            {conversation.keywordFlags.slice(0, 8).map((hit) => (
              <li
                key={`${hit.ruleId}-${hit.offset}`}
                className="rounded-md border border-border/70 bg-card px-2.5 py-1.5 text-xs"
              >
                <span className="font-medium">{hit.label}</span>
                <span className="text-muted-foreground">
                  {" "}
                  · {hit.severity} · “{hit.matchedTerm}”
                </span>
              </li>
            ))}
          </ul>
        )}
        {voice?.voice ? (
          <p className="text-xs text-muted-foreground">
            Last recording {formatDuration(voice.voice.durationSec)}
            {voice.voice.transcript ? ` — ${voice.voice.transcript}` : ""}
          </p>
        ) : null}
      </section>
    </div>
  );
}

export function VoiceCallPanel({
  available,
  reason,
  onCall,
}: {
  available: boolean;
  reason?: string;
  onCall: () => void;
}) {
  return (
    <div className="rounded-md border border-border/70 p-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-sm font-medium">Voice</p>
          <p className="text-xs text-muted-foreground">
            {available ? "Click to place a call via Twilio." : reason}
          </p>
        </div>
        <Button type="button" variant="outline" size="sm" disabled={!available} onClick={onCall}>
          Call
        </Button>
      </div>
    </div>
  );
}
