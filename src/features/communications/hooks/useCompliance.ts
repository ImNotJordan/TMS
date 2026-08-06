import * as React from "react";

import { appendAuditEvent } from "../lib/communications-store";
import type { ConsentRecord, DncEntry } from "../types";
import { useCommunicationsData } from "./useCommunicationsData";
import { useCommsAccess } from "./useCommsAccess";

export function useCompliance() {
  const { data, isLoading, persist } = useCommunicationsData();
  const { canViewCompliance, userId } = useCommsAccess();

  const recordConsent = React.useCallback(
    async (record: Omit<ConsentRecord, "id" | "capturedAt"> & { id?: string }) => {
      if (!canViewCompliance) throw new Error("Compliance is restricted to broker/admin roles.");
      const next: ConsentRecord = {
        ...record,
        id: record.id ?? `consent-${crypto.randomUUID()}`,
        capturedAt: new Date().toISOString(),
      };
      let payload = {
        ...data,
        consentRecords: [next, ...data.consentRecords],
      };
      payload = appendAuditEvent(payload, {
        actorId: userId ?? "unknown",
        action: "consent.recorded",
        targetType: "consent",
        targetId: next.id,
        metadata: { contactId: next.contactId, channel: next.channel, state: next.state },
      });
      await persist(payload);
      return next;
    },
    [canViewCompliance, data, persist, userId],
  );

  const addDnc = React.useCallback(
    async (entry: Omit<DncEntry, "id" | "addedAt"> & { id?: string }) => {
      if (!canViewCompliance) throw new Error("Compliance is restricted to broker/admin roles.");
      if (!entry.reason.trim()) throw new Error("A reason is required for do-not-contact entries.");
      const next: DncEntry = {
        ...entry,
        id: entry.id ?? `dnc-${crypto.randomUUID()}`,
        addedAt: new Date().toISOString(),
      };
      const affected = data.conversations.filter(
        (c) =>
          (next.contactId && c.contactId === next.contactId) ||
          c.contactId === next.address,
      ).length;
      let payload = {
        ...data,
        dncEntries: [next, ...data.dncEntries],
      };
      payload = appendAuditEvent(payload, {
        actorId: userId ?? "unknown",
        action: "dnc.added",
        targetType: "dnc",
        targetId: next.id,
        metadata: { address: next.address, channel: next.channel, affectedConversations: affected },
      });
      await persist(payload);
      return { entry: next, affectedConversations: affected };
    },
    [canViewCompliance, data, persist, userId],
  );

  const removeDnc = React.useCallback(
    async (id: string) => {
      if (!canViewCompliance) throw new Error("Compliance is restricted to broker/admin roles.");
      let payload = {
        ...data,
        dncEntries: data.dncEntries.filter((e) => e.id !== id),
      };
      payload = appendAuditEvent(payload, {
        actorId: userId ?? "unknown",
        action: "dnc.removed",
        targetType: "dnc",
        targetId: id,
        metadata: {},
      });
      await persist(payload);
    },
    [canViewCompliance, data, persist, userId],
  );

  return {
    consentRecords: data.consentRecords,
    dncEntries: data.dncEntries,
    auditEvents: data.auditEvents,
    isLoading,
    canView: canViewCompliance,
    recordConsent,
    addDnc,
    removeDnc,
  };
}
