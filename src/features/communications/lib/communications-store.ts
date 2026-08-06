import { getWorkspaceSetting, putWorkspaceSetting } from "@/lib/workspace-settings-store";

import { KEYWORD_PRESETS } from "@/features/communications/lib/keywordEngine";
import type {
  AgentConfig,
  AuditEvent,
  ConsentRecord,
  Conversation,
  DncEntry,
  KeywordRule,
  Message,
} from "@/features/communications/types";

export type CommunicationsWorkspaceData = {
  conversations: Conversation[];
  messages: Message[];
  agentConfig: AgentConfig;
  keywordRules: KeywordRule[];
  consentRecords: ConsentRecord[];
  dncEntries: DncEntry[];
  auditEvents: AuditEvent[];
  seededPresets: boolean;
};

export const DEFAULT_AGENT_CONFIG: AgentConfig = {
  enabled: false,
  persona: "dispatcher",
  tone: "neutral",
  allowedActions: ["draft-reply", "translate", "summarize-thread"],
  autoSendThreshold: 0.85,
  translation: {
    enabled: true,
    detectInbound: true,
    replyInContactLanguage: true,
    targetLang: "en",
  },
  channelScope: ["email", "sms", "chat"],
  escalation: {
    onCriticalKeyword: true,
    onLowConfidence: true,
    notifyUserIds: [],
  },
};

export const COMMS_CHANGED = "titan:communications-changed";

let memoryCache: CommunicationsWorkspaceData | null = null;
let loadPromise: Promise<CommunicationsWorkspaceData> | null = null;

function createPresetRules(): KeywordRule[] {
  return KEYWORD_PRESETS.map((preset, index) => ({
    ...preset,
    id: `preset-${index + 1}-${preset.label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
  }));
}

export function createDefaultCommunicationsData(): CommunicationsWorkspaceData {
  return {
    conversations: [],
    messages: [],
    agentConfig: { ...DEFAULT_AGENT_CONFIG },
    keywordRules: createPresetRules(),
    consentRecords: [],
    dncEntries: [],
    auditEvents: [],
    seededPresets: true,
  };
}

function notifyChanged() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(COMMS_CHANGED));
  }
}

function normalize(data: Partial<CommunicationsWorkspaceData> | null): CommunicationsWorkspaceData {
  const base = createDefaultCommunicationsData();
  if (!data) return base;
  return {
    conversations: Array.isArray(data.conversations) ? data.conversations : base.conversations,
    messages: Array.isArray(data.messages) ? data.messages : base.messages,
    agentConfig: data.agentConfig ?? base.agentConfig,
    keywordRules:
      Array.isArray(data.keywordRules) && data.keywordRules.length > 0
        ? data.keywordRules
        : base.keywordRules,
    consentRecords: Array.isArray(data.consentRecords) ? data.consentRecords : base.consentRecords,
    dncEntries: Array.isArray(data.dncEntries) ? data.dncEntries : base.dncEntries,
    auditEvents: Array.isArray(data.auditEvents) ? data.auditEvents : base.auditEvents,
    seededPresets: data.seededPresets ?? true,
  };
}

export function readCommunicationsCache(): CommunicationsWorkspaceData {
  return memoryCache ?? createDefaultCommunicationsData();
}

export function applyCommunicationsCache(data: CommunicationsWorkspaceData) {
  memoryCache = normalize(data);
  notifyChanged();
}

export async function loadCommunicationsData(): Promise<CommunicationsWorkspaceData> {
  if (memoryCache) return memoryCache;
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    try {
      const { data } = await getWorkspaceSetting<CommunicationsWorkspaceData>("communications");
      const normalized = normalize(data);
      memoryCache = normalized;
      return normalized;
    } catch (error) {
      console.error("[communications-store] Failed to load", error);
      memoryCache = createDefaultCommunicationsData();
      return memoryCache;
    } finally {
      loadPromise = null;
    }
  })();

  return loadPromise;
}

export async function saveCommunicationsData(
  data: CommunicationsWorkspaceData,
): Promise<CommunicationsWorkspaceData> {
  const normalized = normalize(data);
  try {
    await putWorkspaceSetting("communications", normalized);
  } catch (error) {
    // Keep working offline / without workspace table — still update memory.
    console.warn("[communications-store] Persist failed; using memory cache", error);
  }
  memoryCache = normalized;
  notifyChanged();
  return normalized;
}

export async function patchCommunicationsData(
  patch: Partial<CommunicationsWorkspaceData>,
): Promise<CommunicationsWorkspaceData> {
  const current = await loadCommunicationsData();
  return saveCommunicationsData({ ...current, ...patch });
}

export function appendAuditEvent(
  data: CommunicationsWorkspaceData,
  event: Omit<AuditEvent, "id" | "at"> & { id?: string; at?: string },
): CommunicationsWorkspaceData {
  const next: AuditEvent = {
    id: event.id ?? `audit-${crypto.randomUUID()}`,
    at: event.at ?? new Date().toISOString(),
    actorId: event.actorId,
    action: event.action,
    targetType: event.targetType,
    targetId: event.targetId,
    metadata: event.metadata,
  };
  return {
    ...data,
    auditEvents: [next, ...data.auditEvents].slice(0, 2000),
  };
}

export function clearCommunicationsCache() {
  memoryCache = null;
  loadPromise = null;
}
