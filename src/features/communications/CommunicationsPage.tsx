import * as React from "react";
import { Link } from "@tanstack/react-router";
import {
  AlertTriangle,
  ArrowLeft,
  Bot,
  Inbox,
  Mail,
  MessageSquare,
  Plus,
  Scale,
  Settings2,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";

import { PageHeader } from "@/components/page-header";
import { usePageReady } from "@/components/page-load-gate";
import { ScrollRegion } from "@/components/scroll-region";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

import { AgentSettingsTab } from "./agent/AgentSettingsTab";
import { ChannelHealthStrip } from "./ChannelHealthStrip";
import { ComplianceTab } from "./compliance/ComplianceTab";
import { useChannelAvailability } from "./hooks/useChannelAvailability";
import { useCommsAccess } from "./hooks/useCommsAccess";
import { useConversation } from "./hooks/useConversation";
import { useConversations, type ConversationFilter } from "./hooks/useConversations";
import { useSendMessage } from "./hooks/useSendMessage";
import { Composer } from "./inbox/Composer";
import { ConversationFilters, ConversationList } from "./inbox/ConversationList";
import { ContextPanel, ThreadHeader, VoiceCallPanel } from "./inbox/ContextPanel";
import { MessageThread } from "./inbox/MessageThread";
import { appendAuditEvent } from "./lib/communications-store";
import { KeywordRulesTab } from "./rules/KeywordRulesTab";
import type {
  ChannelId,
  Conversation,
  GuardResult,
  MessageLink,
  TranslationRecord,
} from "./types";

function resolveLink(conversation: Conversation | null): MessageLink | null {
  if (!conversation) return null;
  if (conversation.loadId && conversation.contactId) {
    return { loadId: conversation.loadId, contactId: conversation.contactId };
  }
  if (conversation.loadId) return { loadId: conversation.loadId };
  if (conversation.contactId) return { contactId: conversation.contactId };
  return null;
}

const toneStat = {
  default: "bg-muted text-foreground",
  success: "bg-success/15 text-success",
  warning: "bg-warning/20 text-warning-foreground",
  info: "bg-info/15 text-info",
  destructive: "bg-destructive/12 text-destructive",
} as const;

function Metric({
  label,
  value,
  tone,
  icon: Icon,
}: {
  label: string;
  value: string;
  tone: keyof typeof toneStat;
  icon: typeof Inbox;
}) {
  return (
    <Card className="border-border/70 shadow-sm">
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {label}
          </div>
          <span className={cn("flex h-7 w-7 items-center justify-center rounded-md", toneStat[tone])}>
            <Icon className="h-3.5 w-3.5" />
          </span>
        </div>
        <div className="mt-2 text-2xl font-semibold tracking-tight text-foreground">{value}</div>
      </CardContent>
    </Card>
  );
}

export function CommunicationsPage() {
  const access = useCommsAccess();
  const { channels, byChannel, allExternalDisconnected, aiConnected, isLoading: channelsLoading } =
    useChannelAvailability();
  const [tab, setTab] = React.useState("inbox");
  const [channelFilter, setChannelFilter] = React.useState<ConversationFilter>("all");
  const [search, setSearch] = React.useState("");
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [composerBody, setComposerBody] = React.useState("");
  const [composerChannel, setComposerChannel] = React.useState<ChannelId>("chat");
  const [isAiDraft, setIsAiDraft] = React.useState(false);
  const [guardNotice, setGuardNotice] = React.useState<GuardResult | null>(null);
  const [ackConsent, setAckConsent] = React.useState(false);
  const [contextOpen, setContextOpen] = React.useState(false);
  const [composeOpen, setComposeOpen] = React.useState(false);
  const [newSubject, setNewSubject] = React.useState("");
  const [newContactId, setNewContactId] = React.useState("");
  const [newLoadId, setNewLoadId] = React.useState("");
  const [suggesting, setSuggesting] = React.useState(false);
  const [mobileShowThread, setMobileShowThread] = React.useState(false);

  const { conversations, counts, isLoading, data, persist } = useConversations({
    channel: channelFilter,
    search,
  });
  const { conversation, messages } = useConversation(selectedId);
  const { send, retry, pending } = useSendMessage();

  usePageReady(isLoading || channelsLoading || access.loading);

  const metrics = React.useMemo(() => {
    const all = data.conversations;
    const open = all.filter((c) => c.status === "open").length;
    const unread = all.reduce((sum, c) => sum + c.unreadCount, 0);
    const aiHandled = all.filter((c) => c.aiHandled).length;
    const critical = all.filter((c) =>
      c.keywordFlags.some((f) => f.severity === "critical"),
    ).length;
    return { open, unread, aiHandled, critical, total: all.length };
  }, [data.conversations]);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === "j" || e.key === "k") {
        e.preventDefault();
        if (conversations.length === 0) return;
        const idx = conversations.findIndex((c) => c.id === selectedId);
        const nextIdx =
          e.key === "j"
            ? Math.min(conversations.length - 1, Math.max(0, idx + 1))
            : Math.max(0, idx <= 0 ? 0 : idx - 1);
        const nextId = conversations[nextIdx]?.id ?? null;
        setSelectedId(nextId);
        if (nextId) setMobileShowThread(true);
      }
      if (e.key === "Escape") {
        setContextOpen(false);
        setComposeOpen(false);
        setMobileShowThread(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [conversations, selectedId]);

  const availabilityMap = React.useMemo(() => {
    const map: Partial<Record<ChannelId, { available: boolean; reason?: string }>> = {};
    for (const ch of channels) {
      map[ch.channel] = { available: ch.available, reason: ch.reason };
    }
    return map;
  }, [channels]);

  const consent = conversation
    ? data.consentRecords.find(
        (r) => r.contactId === conversation.contactId && r.channel === composerChannel,
      )
    : undefined;
  const dnc = conversation
    ? data.dncEntries.find(
        (e) =>
          e.contactId === conversation.contactId ||
          e.address === conversation.contactId,
      )
    : undefined;

  const selectConversation = (id: string) => {
    setSelectedId(id);
    setMobileShowThread(true);
    setGuardNotice(null);
    setAckConsent(false);
  };

  const handleSend = async (opts: {
    translateTo?: string;
    translation?: TranslationRecord;
  }) => {
    if (!conversation) return;
    const link = resolveLink(conversation);
    if (!link) {
      toast.error("Link this conversation to a load or contact before sending.");
      return;
    }

    let body = composerBody;
    let translation = opts.translation;
    if (translation) {
      body = translation.translatedText;
    } else if (opts.translateTo) {
      translation = undefined;
    }

    const result = await send({
      conversationId: conversation.id,
      channel: composerChannel,
      body,
      link,
      toAddress: conversation.contactId,
      contactId: conversation.contactId,
      acknowledgeUnknownConsent: ackConsent,
      translation:
        translation ??
        (opts.translateTo
          ? undefined
          : undefined),
      isAiGenerated: isAiDraft,
    });

    if (translation === undefined && opts.translateTo) {
      toast.message("Translation unavailable. Sent the original text.");
    }

    if (!result.ok) {
      setGuardNotice(result.guard);
      return;
    }

    setComposerBody("");
    setIsAiDraft(false);
    setGuardNotice(null);
    setAckConsent(false);
    toast.success("Message sent.");
  };

  const createConversation = async () => {
    if (!newContactId.trim() && !newLoadId.trim()) {
      toast.error("Provide a contact id, a load id, or both.");
      return;
    }
    if (!newSubject.trim()) {
      toast.error("Subject is required.");
      return;
    }
    const now = new Date().toISOString();
    const conversation: Conversation = {
      id: `conv-${crypto.randomUUID()}`,
      subject: newSubject.trim(),
      channels: [composerChannel],
      primaryChannel: composerChannel,
      contactId: newContactId.trim() || `contact-${newLoadId.trim()}`,
      loadId: newLoadId.trim() || undefined,
      assigneeId: access.userId,
      unreadCount: 0,
      lastMessagePreview: "Conversation started",
      lastMessageAt: now,
      keywordFlags: [],
      aiHandled: false,
      status: "open",
    };
    await persist({
      ...data,
      conversations: [conversation, ...data.conversations],
    });
    setSelectedId(conversation.id);
    setMobileShowThread(true);
    setComposeOpen(false);
    setNewSubject("");
    setNewContactId("");
    setNewLoadId("");
    setTab("inbox");
  };

  const suggestReply = async () => {
    if (!conversation) return;
    setSuggesting(true);
    try {
      const latestInbound = [...messages].reverse().find((m) => m.direction === "inbound");
      const response = await fetch("/api/comms/agent/draft", {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({
          persona: data.agentConfig.persona,
          tone: data.agentConfig.tone,
          threadSummary: messages.map((m) => m.body).join("\n").slice(0, 4000),
          latestInbound: latestInbound?.body ?? "",
          channel: conversation.primaryChannel,
        }),
      });
      const payload = (await response.json().catch(() => null)) as
        | { draft?: string; error?: string }
        | null;
      if (!response.ok) {
        throw new Error(payload?.error ?? "Could not draft a reply.");
      }
      setComposerBody(payload?.draft ?? "");
      setIsAiDraft(true);
      toast.success("Suggested reply loaded into the composer.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not draft a reply.");
    } finally {
      setSuggesting(false);
    }
  };

  const visibleTabs = React.useMemo(() => {
    const items: {
      id: string;
      label: string;
      icon: typeof Inbox;
    }[] = [{ id: "inbox", label: "Inbox", icon: Inbox }];
    if (access.canViewAgent) items.push({ id: "agent", label: "AI Agent", icon: Bot });
    if (access.canEditRules) items.push({ id: "rules", label: "Keyword Rules", icon: Settings2 });
    if (access.canViewCompliance) items.push({ id: "compliance", label: "Compliance", icon: Scale });
    return items;
  }, [access]);

  const threadPane = !selectedId || !conversation ? (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-16 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-muted text-muted-foreground">
        <MessageSquare className="h-5 w-5" />
      </span>
      <div className="space-y-1">
        <p className="text-sm font-semibold text-foreground">Select a conversation</p>
        <p className="max-w-xs text-sm text-muted-foreground">
          Choose a thread from the list, or start a new conversation to message a contact or load.
        </p>
      </div>
      <Button type="button" size="sm" className="gap-1.5" onClick={() => setComposeOpen(true)}>
        <Plus className="h-4 w-4" />
        New conversation
      </Button>
    </div>
  ) : (
    <>
      <div className="shrink-0 border-b border-border/70 px-4 py-3 sm:px-5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="mb-2 lg:hidden">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="-ml-2 h-8 gap-1.5 px-2 text-muted-foreground"
                onClick={() => setMobileShowThread(false)}
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                Back to inbox
              </Button>
            </div>
            <ThreadHeader conversation={conversation} />
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="shrink-0 xl:hidden"
            onClick={() => setContextOpen(true)}
          >
            Context
          </Button>
        </div>
      </div>
      <ScrollRegion
        id="comms-thread"
        className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5"
      >
        <MessageThread
          messages={messages}
          isLoading={isLoading}
          onRetry={(message) => {
            void retry(message, conversation.contactId);
          }}
        />
      </ScrollRegion>
      <div className="shrink-0 border-t border-border/70 bg-card/80 px-4 py-3 sm:px-5">
        {composerChannel === "voice" ? (
          <div className="mb-3">
            <VoiceCallPanel
              available={Boolean(byChannel.get("voice")?.available)}
              reason={byChannel.get("voice")?.reason}
              onCall={() => toast.message("Call session started (click-to-call).")}
            />
          </div>
        ) : null}
        <Composer
          channel={composerChannel}
          onChannelChange={setComposerChannel}
          body={composerBody}
          onBodyChange={(v) => {
            setComposerBody(v);
            setIsAiDraft(false);
          }}
          link={resolveLink(conversation)}
          guardNotice={guardNotice}
          onAcknowledgeConsent={() => {
            setAckConsent(true);
            setGuardNotice(null);
            void handleSend({});
          }}
          onRecordConsent={() => {
            void (async () => {
              let next = {
                ...data,
                consentRecords: [
                  {
                    id: `consent-${crypto.randomUUID()}`,
                    contactId: conversation.contactId,
                    channel: composerChannel,
                    state: "granted" as const,
                    basis: "explicit-optin" as const,
                    capturedAt: new Date().toISOString(),
                    capturedBy: access.userId ?? "ops",
                  },
                  ...data.consentRecords,
                ],
              };
              next = appendAuditEvent(next, {
                actorId: access.userId ?? "ops",
                action: "consent.recorded",
                targetType: "consent",
                targetId: conversation.contactId,
                metadata: { channel: composerChannel },
              });
              await persist(next);
              setGuardNotice(null);
              toast.success("Consent recorded.");
            })();
          }}
          onSend={handleSend}
          sending={pending}
          isAiDraft={isAiDraft}
        />
      </div>
    </>
  );

  return (
    <div>
      <PageHeader
        title="Communications"
        description="Omnichannel inbox for email, SMS, voice, and chat — with AI agent, keyword rules, and compliance."
        actions={
          <Button size="sm" className="gap-1.5" onClick={() => setComposeOpen(true)}>
            <Plus className="h-4 w-4" />
            New conversation
          </Button>
        }
      />

      <div className="space-y-6 px-4 py-6 sm:px-6 lg:px-8">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Metric label="Open Threads" value={String(metrics.open)} tone="info" icon={Inbox} />
          <Metric label="Unread" value={String(metrics.unread)} tone="warning" icon={Mail} />
          <Metric
            label="AI Handled"
            value={String(metrics.aiHandled)}
            tone="success"
            icon={Sparkles}
          />
          <Metric
            label="Critical Flags"
            value={String(metrics.critical)}
            tone={metrics.critical > 0 ? "destructive" : "default"}
            icon={AlertTriangle}
          />
        </div>

        <ChannelHealthStrip />

        <Tabs value={tab} onValueChange={setTab} className="space-y-5">
          <div className="rounded-xl border border-border/70 bg-muted/20 p-1.5 shadow-sm">
            <div className="overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              <TabsList className="inline-flex h-auto w-max min-w-full gap-0.5 bg-transparent p-0 sm:min-w-0">
                {visibleTabs.map((t) => {
                  const Icon = t.icon;
                  return (
                    <TabsTrigger
                      key={t.id}
                      value={t.id}
                      className="group relative gap-1.5 rounded-lg px-3 py-2 text-xs font-medium text-muted-foreground transition-all hover:bg-background/60 hover:text-foreground data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm sm:px-3.5 sm:text-sm"
                    >
                      <Icon className="h-3.5 w-3.5 shrink-0 opacity-70 transition-opacity group-data-[state=active]:opacity-100" />
                      <span className="whitespace-nowrap">{t.label}</span>
                    </TabsTrigger>
                  );
                })}
              </TabsList>
            </div>
          </div>

          <TabsContent value="inbox" className="mt-0 space-y-4">
            {allExternalDisconnected ? (
              <div className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning-foreground">
                <div>
                  <p className="font-semibold">External channels disconnected</p>
                  <p className="mt-0.5 text-xs opacity-90">
                    Email, SMS, and voice need provider connections. Chat still works.
                  </p>
                </div>
                <Button variant="outline" size="sm" asChild className="shrink-0 border-warning/30">
                  <Link to="/settings" search={{ category: "integrations" } as never}>
                    Open Integrations
                  </Link>
                </Button>
              </div>
            ) : null}

            <div className="grid min-h-[640px] gap-4 xl:grid-cols-[300px_minmax(0,1fr)_280px]">
              {/* Conversation list */}
              <Card
                className={cn(
                  "flex min-h-0 flex-col border-border/70 shadow-sm",
                  mobileShowThread && selectedId ? "hidden xl:flex" : "flex",
                )}
              >
                <CardContent className="flex min-h-0 flex-1 flex-col gap-3 p-4">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-sm font-semibold text-foreground">Conversations</div>
                    <Badge variant="outline">{conversations.length}</Badge>
                  </div>
                  <ConversationFilters
                    channel={channelFilter}
                    onChannelChange={setChannelFilter}
                    counts={counts}
                    search={search}
                    onSearchChange={setSearch}
                    availability={availabilityMap}
                  />
                  <ScrollRegion
                    id="comms-conversations"
                    className="min-h-0 flex-1 overflow-y-auto rounded-md border border-border/70"
                  >
                    <div className="p-1.5">
                      <ConversationList
                        conversations={conversations}
                        selectedId={selectedId}
                        onSelect={selectConversation}
                        isLoading={isLoading}
                      />
                    </div>
                  </ScrollRegion>
                </CardContent>
              </Card>

              {/* Thread */}
              <Card
                className={cn(
                  "flex min-h-[560px] flex-col overflow-hidden border-border/70 shadow-sm xl:min-h-0",
                  !mobileShowThread || !selectedId ? "hidden xl:flex" : "flex",
                )}
              >
                <CardContent className="flex min-h-0 flex-1 flex-col p-0">
                  {threadPane}
                </CardContent>
              </Card>

              {/* Context */}
              <Card className="hidden min-h-0 border-border/70 shadow-sm xl:flex xl:flex-col">
                <CardContent className="flex min-h-0 flex-1 flex-col p-4">
                  <div className="mb-3 text-sm font-semibold text-foreground">Context</div>
                  <ScrollRegion
                    id="comms-context"
                    className="min-h-0 flex-1 overflow-y-auto"
                  >
                    <ContextPanel
                      conversation={conversation}
                      messages={messages}
                      consent={consent}
                      dnc={dnc}
                      agentConfig={data.agentConfig}
                      aiConnected={aiConnected}
                      onSuggestReply={() => void suggestReply()}
                      suggesting={suggesting}
                    />
                  </ScrollRegion>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {access.canViewAgent ? (
            <TabsContent value="agent" className="mt-0">
              <AgentSettingsTab readOnly={!access.canEditAgent} />
            </TabsContent>
          ) : null}

          {access.canEditRules ? (
            <TabsContent value="rules" className="mt-0">
              <KeywordRulesTab />
            </TabsContent>
          ) : null}

          {access.canViewCompliance ? (
            <TabsContent value="compliance" className="mt-0">
              <ComplianceTab />
            </TabsContent>
          ) : null}
        </Tabs>
      </div>

      <Sheet open={contextOpen} onOpenChange={setContextOpen}>
        <SheetContent className="overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Context</SheetTitle>
          </SheetHeader>
          <div className="mt-4">
            <ContextPanel
              conversation={conversation}
              messages={messages}
              consent={consent}
              dnc={dnc}
              agentConfig={data.agentConfig}
              aiConnected={aiConnected}
              onSuggestReply={() => void suggestReply()}
              suggesting={suggesting}
            />
          </div>
        </SheetContent>
      </Sheet>

      <Sheet open={composeOpen} onOpenChange={setComposeOpen}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>New conversation</SheetTitle>
          </SheetHeader>
          <div className="mt-4 space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="comms-new-subject">Subject</Label>
              <Input
                id="comms-new-subject"
                value={newSubject}
                onChange={(e) => setNewSubject(e.target.value)}
                placeholder="e.g. Pickup window confirmation"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="comms-new-contact">Contact id</Label>
              <Input
                id="comms-new-contact"
                value={newContactId}
                onChange={(e) => setNewContactId(e.target.value)}
                placeholder="Contact or phone / email address"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="comms-new-load">Load id (optional)</Label>
              <Input
                id="comms-new-load"
                value={newLoadId}
                onChange={(e) => setNewLoadId(e.target.value)}
                placeholder="Link to a load"
              />
            </div>
            <Button type="button" className="w-full gap-1.5" onClick={() => void createConversation()}>
              <Plus className="h-4 w-4" />
              Start conversation
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
