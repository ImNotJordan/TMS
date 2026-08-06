import * as React from "react";
import { Send } from "lucide-react";
import { Link } from "@tanstack/react-router";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

import { useChannelAvailability } from "../hooks/useChannelAvailability";
import type { GuardResult } from "../types";
import type { ChannelId, MessageLink, TranslationRecord } from "../types";
import { CHANNEL_LABELS } from "../lib/formatters";

const LANGS = [
  { id: "en", label: "English" },
  { id: "es", label: "Spanish" },
  { id: "fr", label: "French" },
  { id: "pt", label: "Portuguese" },
];

export function Composer({
  channel,
  onChannelChange,
  body,
  onBodyChange,
  link,
  disabledReason,
  guardNotice,
  onAcknowledgeConsent,
  onRecordConsent,
  onSend,
  sending,
  isAiDraft,
}: {
  channel: ChannelId;
  onChannelChange: (c: ChannelId) => void;
  body: string;
  onBodyChange: (v: string) => void;
  link: MessageLink | null;
  disabledReason?: string;
  guardNotice?: GuardResult | null;
  onAcknowledgeConsent?: () => void;
  onRecordConsent?: () => void;
  onSend: (opts: {
    translateTo?: string;
    translation?: TranslationRecord;
  }) => Promise<void>;
  sending: boolean;
  isAiDraft?: boolean;
}) {
  const { byChannel } = useChannelAvailability();
  const [translateTo, setTranslateTo] = React.useState<string>("none");
  const [template, setTemplate] = React.useState<string>("none");

  const channelState = byChannel.get(channel);
  const channelDisabled = channelState && !channelState.available;
  const missingLink = !link;
  const sendDisabled =
    sending ||
    !body.trim() ||
    missingLink ||
    Boolean(channelDisabled) ||
    Boolean(disabledReason);

  const reason =
    disabledReason ||
    (missingLink
      ? "Link this conversation to a load or contact before sending."
      : channelDisabled
        ? channelState?.reason
        : undefined);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && !sendDisabled) {
        e.preventDefault();
        void handleSend();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- handleSend closes over latest
  }, [sendDisabled, body, channel, translateTo]);

  async function handleSend() {
    let translation: TranslationRecord | undefined;
    if (translateTo !== "none" && body.trim()) {
      try {
        const response = await fetch("/api/comms/translate", {
          method: "POST",
          headers: { Accept: "application/json", "Content-Type": "application/json" },
          body: JSON.stringify({
            text: body,
            targetLang: translateTo,
            translatedBy: "agent",
          }),
        });
        if (response.ok) {
          translation = (await response.json()) as TranslationRecord;
        }
      } catch {
        // Translation failure must not block send.
      }
    }

    await onSend({
      translateTo: translateTo === "none" ? undefined : translateTo,
      translation,
    });
  }

  return (
    <div className="space-y-2.5">
      {guardNotice?.status === "blocked-dnc" ? (
        <p className="rounded-md border border-destructive/25 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          Blocked by do-not-contact: {guardNotice.entry.reason}
        </p>
      ) : null}
      {guardNotice?.status === "blocked-no-consent" ? (
        <div className="rounded-md border border-destructive/25 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          No consent on file for this channel.{" "}
          <Button type="button" variant="outline" size="sm" className="h-7" onClick={onRecordConsent}>
            Record consent
          </Button>
        </div>
      ) : null}
      {guardNotice?.status === "warn-unknown-consent" ? (
        <div className="rounded-md border border-warning/25 bg-warning/15 px-3 py-2 text-sm">
          Consent status is unknown.{" "}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7"
            onClick={onAcknowledgeConsent}
          >
            Confirm and send
          </Button>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Select value={channel} onValueChange={(v) => onChannelChange(v as ChannelId)}>
          <SelectTrigger className="h-9 w-[130px]" aria-label="Channel">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(CHANNEL_LABELS) as ChannelId[]).map((id) => {
              const avail = byChannel.get(id);
              return (
                <SelectItem key={id} value={id} disabled={avail && !avail.available}>
                  {CHANNEL_LABELS[id]}
                  {avail && !avail.available ? " (disconnected)" : ""}
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>

        <Select
          value={template}
          onValueChange={(v) => {
            setTemplate(v);
            if (v !== "none") onBodyChange(v);
          }}
        >
          <SelectTrigger className="h-9 w-[160px]" aria-label="Template">
            <SelectValue placeholder="Template" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">No template</SelectItem>
            <SelectItem value="Driver has arrived at pickup.">Arrived at pickup</SelectItem>
            <SelectItem value="Driver is in transit.">In transit</SelectItem>
            <SelectItem value="POD has been uploaded.">POD uploaded</SelectItem>
          </SelectContent>
        </Select>

        <Select value={translateTo} onValueChange={setTranslateTo}>
          <SelectTrigger className="h-9 w-[150px]" aria-label="Translate to">
            <SelectValue placeholder="Translate to" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">No translation</SelectItem>
            {LANGS.map((l) => (
              <SelectItem key={l.id} value={l.id}>
                Translate to {l.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {channelDisabled ? (
        <p className="text-xs text-muted-foreground">
          {channelState?.reason}{" "}
          <Link to="/settings" search={{ category: "integrations" } as never} className="underline">
            Connect in Settings → Integrations.
          </Link>
        </p>
      ) : null}

      <Textarea
        value={body}
        onChange={(e) => onBodyChange(e.target.value)}
        placeholder={isAiDraft ? "AI draft — edit before sending" : "Write a message"}
        rows={3}
        className="min-h-[88px] resize-none"
        aria-label="Message body"
      />

      <div className="flex items-center justify-between gap-2">
        <p className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
          {reason ?? "Ctrl/⌘ + Enter to send"}
        </p>
        <Button
          type="button"
          size="sm"
          className="shrink-0 gap-1.5"
          disabled={sendDisabled}
          onClick={() => void handleSend()}
        >
          <Send className="h-4 w-4" aria-hidden />
          Send
        </Button>
      </div>
    </div>
  );
}
