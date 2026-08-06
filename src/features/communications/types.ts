export type ChannelId = "email" | "sms" | "voice" | "chat";
export type Direction = "inbound" | "outbound";

export type MessageStatus =
  | "draft"
  | "queued"
  | "sending"
  | "sent"
  | "delivered"
  | "read"
  | "failed"
  | "blocked";

/** A message must reference a load, a contact, or both. Never neither. */
export type MessageLink =
  | { loadId: string; contactId: string }
  | { loadId: string; contactId?: never }
  | { loadId?: never; contactId: string };

export interface TranslationRecord {
  originalText: string;
  originalLang: string;
  translatedText: string;
  targetLang: string;
  engine: string;
  translatedAt: string;
  translatedBy: "auto" | "agent";
}

export interface KeywordHit {
  ruleId: string;
  label: string;
  severity: "info" | "warning" | "critical";
  matchedTerm: string;
  offset: number;
}

export interface Message {
  id: string;
  conversationId: string;
  channel: ChannelId;
  direction: Direction;
  status: MessageStatus;
  link: MessageLink;
  body: string;
  translation?: TranslationRecord;
  keywordHits: KeywordHit[];
  attachments?: Array<{ id: string; name: string; url: string; sizeBytes: number }>;
  voice?: { recordingUrl?: string; durationSec: number; transcript?: string };
  authorId: string;
  isAiGenerated: boolean;
  providerMessageId?: string;
  failureReason?: string;
  idempotencyKey?: string;
  translationNote?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Conversation {
  id: string;
  subject: string;
  channels: ChannelId[];
  primaryChannel: ChannelId;
  contactId: string;
  loadId?: string;
  assigneeId?: string;
  unreadCount: number;
  lastMessagePreview: string;
  lastMessageAt: string;
  keywordFlags: KeywordHit[];
  aiHandled: boolean;
  status: "open" | "snoozed" | "closed";
}

export type PersonaId = "dispatcher" | "broker" | "customer-service" | "sales";
export type AgentAction =
  | "draft-reply"
  | "send-reply"
  | "translate"
  | "summarize-thread"
  | "create-task"
  | "update-load-status"
  | "escalate-to-human";

export interface AgentConfig {
  enabled: boolean;
  persona: PersonaId;
  tone: "formal" | "neutral" | "friendly" | "urgent";
  allowedActions: AgentAction[];
  autoSendThreshold: number;
  translation: {
    enabled: boolean;
    detectInbound: boolean;
    replyInContactLanguage: boolean;
    targetLang: string;
  };
  channelScope: ChannelId[];
  escalation: {
    onCriticalKeyword: boolean;
    onLowConfidence: boolean;
    notifyUserIds: string[];
  };
}

export interface KeywordRule {
  id: string;
  label: string;
  terms: string[];
  matchType: "contains" | "word" | "regex";
  caseSensitive: boolean;
  channels: ChannelId[];
  direction: Direction | "both";
  severity: KeywordHit["severity"];
  actions: Array<
    | { type: "flag-thread" }
    | { type: "notify"; userIds: string[] }
    | { type: "create-task"; title: string }
    | { type: "apply-tag"; tag: string }
    | { type: "escalate-to-human" }
  >;
  enabled: boolean;
}

export interface ConsentRecord {
  id: string;
  contactId: string;
  channel: ChannelId;
  state: "granted" | "revoked" | "unknown";
  basis: "explicit-optin" | "contractual" | "imported" | "verbal";
  capturedAt: string;
  capturedBy: string;
  evidence?: string;
  ipAddress?: string;
}

export interface DncEntry {
  id: string;
  contactId?: string;
  address: string;
  channel: ChannelId | "all";
  reason: string;
  addedAt: string;
  addedBy: string;
  expiresAt?: string;
}

export interface AuditEvent {
  id: string;
  at: string;
  actorId: string;
  action: string;
  targetType: "message" | "conversation" | "rule" | "consent" | "dnc" | "agent";
  targetId: string;
  metadata: Record<string, unknown>;
}

export type CommsAccessLevel = "full" | "shipper" | "client";

export type GuardResult =
  | { status: "allowed" }
  | { status: "blocked-dnc"; entry: DncEntry }
  | { status: "blocked-no-consent" }
  | { status: "warn-unknown-consent" };
