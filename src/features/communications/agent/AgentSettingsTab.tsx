import * as React from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

import { useAgentConfig } from "../hooks/useAgentConfig";
import { useChannelAvailability } from "../hooks/useChannelAvailability";
import type { AgentAction, AgentConfig, ChannelId, PersonaId } from "../types";

const PERSONAS: { id: PersonaId; title: string; blurb: string }[] = [
  { id: "dispatcher", title: "Dispatcher", blurb: "ETA updates, check-calls, and load status." },
  { id: "broker", title: "Broker", blurb: "Rate negotiation and carrier coverage." },
  { id: "customer-service", title: "Customer service", blurb: "Exceptions, claims intake, and follow-ups." },
  { id: "sales", title: "Sales", blurb: "Outbound quotes and relationship touchpoints." },
];

const ACTIONS: { id: AgentAction; label: string; destructive?: boolean }[] = [
  { id: "draft-reply", label: "Draft reply" },
  { id: "send-reply", label: "Send reply", destructive: true },
  { id: "translate", label: "Translate" },
  { id: "summarize-thread", label: "Summarize thread" },
  { id: "create-task", label: "Create task" },
  { id: "update-load-status", label: "Update load status", destructive: true },
  { id: "escalate-to-human", label: "Escalate to human" },
];

export function AgentSettingsTab({ readOnly }: { readOnly?: boolean }) {
  const { config, save, canEdit } = useAgentConfig();
  const { aiConnected } = useChannelAvailability();
  const [draft, setDraft] = React.useState(config);
  const [confirmAction, setConfirmAction] = React.useState<AgentAction | null>(null);
  const editable = canEdit && !readOnly;

  React.useEffect(() => setDraft(config), [config]);

  const toggleAction = (action: AgentAction, enabled: boolean) => {
    if (!editable) return;
    if (enabled && (action === "send-reply" || action === "update-load-status")) {
      setConfirmAction(action);
      return;
    }
    setDraft((prev) => ({
      ...prev,
      allowedActions: enabled
        ? [...new Set([...prev.allowedActions, action])]
        : prev.allowedActions.filter((a) => a !== action),
    }));
  };

  const confirmDestructive = () => {
    if (!confirmAction) return;
    setDraft((prev) => ({
      ...prev,
      allowedActions: [...new Set([...prev.allowedActions, confirmAction])],
    }));
    setConfirmAction(null);
  };

  const toggleChannel = (channel: ChannelId, enabled: boolean) => {
    setDraft((prev) => ({
      ...prev,
      channelScope: enabled
        ? [...new Set([...prev.channelScope, channel])]
        : prev.channelScope.filter((c) => c !== channel),
    }));
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end gap-3">
        {editable ? (
          <Button type="button" onClick={() => void save(draft)}>
            Save agent settings
          </Button>
        ) : (
          <p className="text-sm text-muted-foreground">Agent settings are read-only for your role.</p>
        )}
      </div>

      {!aiConnected ? (
        <Card className="border-border/70 shadow-sm">
          <CardContent className="pt-6 text-sm text-muted-foreground">
            AI is disconnected. Connect it in Settings → Integrations to enable the agent.
          </CardContent>
        </Card>
      ) : null}

      <Card className="border-border/70 shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Persona</CardTitle>
          <CardDescription>Choose how the agent should sound and what it optimizes for.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {PERSONAS.map((persona) => {
            const selected = draft.persona === persona.id;
            return (
              <button
                key={persona.id}
                type="button"
                disabled={!editable}
                onClick={() => setDraft((p) => ({ ...p, persona: persona.id }))}
                className={cn(
                  "rounded-md border border-border/70 p-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  selected && "border-primary bg-primary/5",
                )}
                role="radio"
                aria-checked={selected}
              >
                <div className="font-medium">{persona.title}</div>
                <p className="mt-1 text-xs text-muted-foreground">{persona.blurb}</p>
              </button>
            );
          })}
        </CardContent>
      </Card>

      <Card className="border-border/70 shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Behavior</CardTitle>
          <CardDescription>Enablement, tone, auto-send threshold, and channel scope.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <div className="flex items-center justify-between rounded-md border border-border/70 px-3 py-2">
            <Label htmlFor="agent-enabled">Agent enabled</Label>
            <Switch
              id="agent-enabled"
              checked={draft.enabled}
              disabled={!editable || !aiConnected}
              onCheckedChange={(v) => setDraft((p) => ({ ...p, enabled: v }))}
            />
          </div>
          <div className="space-y-1">
            <Label>Tone</Label>
            <Select
              value={draft.tone}
              disabled={!editable}
              onValueChange={(v) =>
                setDraft((p) => ({ ...p, tone: v as AgentConfig["tone"] }))
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="formal">Formal</SelectItem>
                <SelectItem value="neutral">Neutral</SelectItem>
                <SelectItem value="friendly">Friendly</SelectItem>
                <SelectItem value="urgent">Urgent</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1 md:col-span-2">
            <Label htmlFor="threshold">
              Auto-send threshold ({Math.round(draft.autoSendThreshold * 100)}%)
            </Label>
            <input
              id="threshold"
              type="range"
              min={0}
              max={100}
              value={Math.round(draft.autoSendThreshold * 100)}
              disabled={!editable}
              onChange={(e) =>
                setDraft((p) => ({
                  ...p,
                  autoSendThreshold: Number(e.target.value) / 100,
                }))
              }
              className="w-full"
            />
            <p className="text-xs text-muted-foreground">
              Replies below this confidence stay as drafts. Critical keyword hits always escalate.
            </p>
          </div>
          <div className="md:col-span-2">
            <p className="mb-2 text-xs font-medium text-muted-foreground">Channel scope</p>
            <div className="flex flex-wrap gap-2">
              {(["email", "sms", "voice", "chat"] as ChannelId[]).map((channel) => (
                <Button
                  key={channel}
                  type="button"
                  size="sm"
                  variant={draft.channelScope.includes(channel) ? "secondary" : "outline"}
                  disabled={!editable}
                  onClick={() =>
                    toggleChannel(channel, !draft.channelScope.includes(channel))
                  }
                >
                  {channel}
                </Button>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="border-border/70 shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Allowed actions</CardTitle>
          <CardDescription>Opt-in capabilities. Destructive actions need a second confirm.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {ACTIONS.map((action) => {
            const on = draft.allowedActions.includes(action.id);
            return (
              <div key={action.id} className="space-y-1">
                <div className="flex items-center justify-between rounded-md border border-border/70 px-3 py-2">
                  <div className="flex items-center gap-2">
                    <span className="text-sm">{action.label}</span>
                    {action.destructive ? (
                      <Badge
                        variant="outline"
                        className="border-destructive/25 bg-destructive/15 text-destructive"
                      >
                        Destructive
                      </Badge>
                    ) : null}
                  </div>
                  <Switch
                    checked={on}
                    disabled={!editable}
                    onCheckedChange={(v) => toggleAction(action.id, v)}
                  />
                </div>
                {action.destructive ? (
                  <p className="px-1 text-xs text-muted-foreground">
                    Enabling this lets the agent change live customer or load state without a human click.
                  </p>
                ) : null}
              </div>
            );
          })}
          {confirmAction ? (
            <div className="rounded-md border border-warning/25 bg-warning/15 p-3 text-sm">
              Enable {confirmAction}? This can send or mutate without review.
              <div className="mt-2 flex gap-2">
                <Button type="button" size="sm" onClick={confirmDestructive}>
                  Enable
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setConfirmAction(null)}
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card className="border-border/70 shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Translation</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2">
          {(
            [
              ["enabled", "Translation enabled"],
              ["detectInbound", "Detect inbound language"],
              ["replyInContactLanguage", "Reply in contact language"],
            ] as const
          ).map(([key, label]) => (
            <div
              key={key}
              className="flex items-center justify-between rounded-md border border-border/70 px-3 py-2"
            >
              <Label>{label}</Label>
              <Switch
                checked={draft.translation[key]}
                disabled={!editable}
                onCheckedChange={(v) =>
                  setDraft((p) => ({
                    ...p,
                    translation: { ...p.translation, [key]: v },
                  }))
                }
              />
            </div>
          ))}
          <div className="space-y-1">
            <Label>Agent reading language</Label>
            <Select
              value={draft.translation.targetLang}
              disabled={!editable}
              onValueChange={(v) =>
                setDraft((p) => ({
                  ...p,
                  translation: { ...p.translation, targetLang: v },
                }))
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="en">English</SelectItem>
                <SelectItem value="es">Spanish</SelectItem>
                <SelectItem value="fr">French</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
