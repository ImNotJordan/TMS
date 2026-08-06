import type { MessageStatus } from "../types";

const TRANSITIONS: Record<MessageStatus, ReadonlySet<MessageStatus>> = {
  draft: new Set(["queued", "sending", "blocked"]),
  queued: new Set(["sending", "failed", "blocked", "draft"]),
  sending: new Set(["sent", "failed", "queued", "blocked"]),
  sent: new Set(["delivered", "read", "failed"]),
  delivered: new Set(["read", "failed"]),
  read: new Set([]),
  failed: new Set(["queued", "sending", "draft"]),
  blocked: new Set(["draft"]),
};

export function canTransition(from: MessageStatus, to: MessageStatus): boolean {
  if (from === to) return true;
  return TRANSITIONS[from]?.has(to) ?? false;
}

export function assertTransition(from: MessageStatus, to: MessageStatus): void {
  if (!canTransition(from, to)) {
    throw new Error(`Illegal message status transition: ${from} → ${to}`);
  }
}

export function transitionStatus(from: MessageStatus, to: MessageStatus): MessageStatus {
  assertTransition(from, to);
  return to;
}
