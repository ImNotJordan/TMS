import * as React from "react";

import { useIntegration } from "@/features/integrations";

import { consentGuard } from "../lib/consentGuard";
import { getCommsAuthHeaders } from "../lib/authHeaders";
import { appendAuditEvent, type CommunicationsWorkspaceData } from "../lib/communications-store";
import { keywordEngine } from "../lib/keywordEngine";
import { canTransition, transitionStatus } from "../lib/statusMachine";
import { getSmsTransport } from "../transport";
import type { ChannelId, GuardResult, Message, MessageLink, TranslationRecord } from "../types";
import { useCommunicationsData } from "./useCommunicationsData";
import { useCommsAccess } from "./useCommsAccess";

export type SendMessageInput = {
  conversationId: string;
  channel: ChannelId;
  body: string;
  link: MessageLink;
  toAddress: string;
  contactId: string;
  acknowledgeUnknownConsent?: boolean;
  translation?: TranslationRecord;
  isAiGenerated?: boolean;
  idempotencyKey?: string;
};

export type SendBlockedResult = {
  ok: false;
  guard: GuardResult;
};

export type SendOkResult = {
  ok: true;
  message: Message;
};

function createIdempotencyKey() {
  return `idem_${crypto.randomUUID()}`;
}

export function useSendMessage() {
  const { data, persist } = useCommunicationsData();
  const { userId } = useCommsAccess();
  const twilio = useIntegration("twilio_sms");
  const sendgrid = useIntegration("sendgrid_email");
  const [pending, setPending] = React.useState(false);

  const runGuard = React.useCallback(
    (contactId: string, channel: ChannelId, address?: string): GuardResult => {
      return consentGuard({
        contactId,
        channel,
        address,
        consentRecords: data.consentRecords,
        dncEntries: data.dncEntries,
      });
    },
    [data.consentRecords, data.dncEntries],
  );

  const send = React.useCallback(
    async (input: SendMessageInput): Promise<SendBlockedResult | SendOkResult> => {
      const hasLink =
        ("loadId" in input.link && Boolean(input.link.loadId)) ||
        ("contactId" in input.link && Boolean(input.link.contactId));
      if (!hasLink) {
        throw new Error("Link this conversation to a load or contact before sending.");
      }

      const guard = runGuard(input.contactId, input.channel, input.toAddress);

      if (guard.status === "blocked-dnc" || guard.status === "blocked-no-consent") {
        const blocked: Message = {
          id: `msg-${crypto.randomUUID()}`,
          conversationId: input.conversationId,
          channel: input.channel,
          direction: "outbound",
          status: "blocked",
          link: input.link,
          body: input.body,
          translation: input.translation,
          keywordHits: [],
          authorId: userId ?? "unknown",
          isAiGenerated: Boolean(input.isAiGenerated),
          failureReason:
            guard.status === "blocked-dnc"
              ? `Blocked by DNC: ${guard.entry.reason}`
              : "Blocked: no consent on file.",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };

        let next: CommunicationsWorkspaceData = {
          ...data,
          messages: [...data.messages, blocked],
        };
        next = appendAuditEvent(next, {
          actorId: userId ?? "unknown",
          action: "send.blocked",
          targetType: "message",
          targetId: blocked.id,
          metadata: {
            reason: guard.status,
            channel: input.channel,
            contactId: input.contactId,
            dncReason: guard.status === "blocked-dnc" ? guard.entry.reason : undefined,
          },
        });
        await persist(next);
        return { ok: false, guard };
      }

      if (guard.status === "warn-unknown-consent") {
        if (
          (input.channel === "sms" || input.channel === "voice") &&
          !input.acknowledgeUnknownConsent
        ) {
          return { ok: false, guard };
        }
      }

      const channelAvailable =
        input.channel === "chat" ||
        (input.channel === "sms" &&
          twilio.data?.status === "connected" &&
          twilio.data.capabilities.includes("sms.send")) ||
        (input.channel === "voice" &&
          twilio.data?.status === "connected" &&
          twilio.data.capabilities.includes("voice.call")) ||
        (input.channel === "email" &&
          sendgrid.data?.status === "connected" &&
          sendgrid.data.capabilities.includes("email.send"));

      const idempotencyKey = input.idempotencyKey ?? createIdempotencyKey();
      const now = new Date().toISOString();
      const keywordHits = keywordEngine(input.body, data.keywordRules, {
        channel: input.channel,
        direction: "outbound",
      });

      let message: Message = {
        id: `msg-${crypto.randomUUID()}`,
        conversationId: input.conversationId,
        channel: input.channel,
        direction: "outbound",
        status: channelAvailable ? "sending" : "queued",
        link: input.link,
        body: input.body,
        translation: input.translation,
        keywordHits,
        authorId: userId ?? "unknown",
        isAiGenerated: Boolean(input.isAiGenerated),
        idempotencyKey,
        createdAt: now,
        updatedAt: now,
      };

      setPending(true);
      try {
        let next: CommunicationsWorkspaceData = {
          ...data,
          messages: [...data.messages, message],
          conversations: data.conversations.map((c) => {
            if (c.id !== input.conversationId) return c;
            const channels = c.channels.includes(input.channel)
              ? c.channels
              : [...c.channels, input.channel];
            return {
              ...c,
              channels,
              lastMessageAt: now,
              lastMessagePreview: input.body.slice(0, 120),
              keywordFlags: [...c.keywordFlags, ...keywordHits].slice(0, 20),
            };
          }),
        };

        if (guard.status === "warn-unknown-consent" && input.acknowledgeUnknownConsent) {
          next = appendAuditEvent(next, {
            actorId: userId ?? "unknown",
            action: "send.consent_warning_acknowledged",
            targetType: "message",
            targetId: message.id,
            metadata: { channel: input.channel },
          });
        }

        await persist(next);

        if (!channelAvailable || message.status === "queued") {
          return { ok: true, message };
        }

        if (input.channel === "sms") {
          try {
            const transport = getSmsTransport(twilio.data);
            const result = await transport.send({
              to: input.toAddress,
              body: input.body,
              link: input.link,
              idempotencyKey,
            });
            const status = canTransition("sending", result.status)
              ? transitionStatus("sending", result.status)
              : "sent";
            message = {
              ...message,
              status,
              providerMessageId: result.providerMessageId,
              updatedAt: new Date().toISOString(),
            };
          } catch (error) {
            message = {
              ...message,
              status: "failed",
              failureReason: error instanceof Error ? error.message : "SMS send failed.",
              updatedAt: new Date().toISOString(),
            };
          }
        } else if (input.channel === "email") {
          try {
            const auth = await getCommsAuthHeaders();
            const response = await fetch("/api/comms/email/send", {
              method: "POST",
              headers: {
                Accept: "application/json",
                "Content-Type": "application/json",
                "Idempotency-Key": idempotencyKey,
                ...auth,
              },
              body: JSON.stringify({
                to: input.toAddress,
                subject: "Message",
                body: input.body,
                link: input.link,
              }),
            });
            const payload = (await response.json().catch(() => null)) as {
              providerMessageId?: string;
              status?: Message["status"];
              error?: string;
            } | null;
            if (!response.ok) {
              throw new Error(payload?.error ?? "Email send failed.");
            }
            message = {
              ...message,
              status: payload?.status ?? "sent",
              providerMessageId: payload?.providerMessageId,
              updatedAt: new Date().toISOString(),
            };
          } catch (error) {
            message = {
              ...message,
              status: "failed",
              failureReason: error instanceof Error ? error.message : "Email send failed.",
              updatedAt: new Date().toISOString(),
            };
          }
        } else {
          // chat / voice click-to-call placeholder
          message = {
            ...message,
            status: "sent",
            updatedAt: new Date().toISOString(),
          };
        }

        let after: CommunicationsWorkspaceData = {
          ...readFresh(data, message),
        };
        if (message.status !== "failed" && message.status !== "blocked") {
          after = appendAuditEvent(after, {
            actorId: userId ?? "unknown",
            action: input.isAiGenerated ? "agent.autoreply" : "message.sent",
            targetType: "message",
            targetId: message.id,
            metadata: {
              channel: input.channel,
              link: input.link,
              providerMessageId: message.providerMessageId,
              isAiGenerated: Boolean(input.isAiGenerated),
            },
          });
        }
        if (input.translation) {
          after = appendAuditEvent(after, {
            actorId: userId ?? "unknown",
            action: "message.translated",
            targetType: "message",
            targetId: message.id,
            metadata: {
              engine: input.translation.engine,
              targetLang: input.translation.targetLang,
            },
          });
        }
        await persist(after);
        return { ok: true, message };
      } finally {
        setPending(false);
      }
    },
    [data, persist, runGuard, twilio.data, sendgrid.data, userId],
  );

  const retry = React.useCallback(
    async (message: Message, toAddress: string) => {
      if (!message.idempotencyKey) return;
      const contactId =
        "contactId" in message.link && message.link.contactId
          ? message.link.contactId
          : "loadId" in message.link && message.link.loadId
            ? message.link.loadId
            : null;
      if (!contactId) return;
      return send({
        conversationId: message.conversationId,
        channel: message.channel,
        body: message.body,
        link: message.link,
        toAddress,
        contactId,
        translation: message.translation,
        isAiGenerated: message.isAiGenerated,
        idempotencyKey: message.idempotencyKey,
        acknowledgeUnknownConsent: true,
      });
    },
    [send],
  );

  return { send, retry, runGuard, pending };
}

function readFresh(
  data: CommunicationsWorkspaceData,
  message: Message,
): CommunicationsWorkspaceData {
  const exists = data.messages.some((m) => m.id === message.id);
  return {
    ...data,
    messages: exists
      ? data.messages.map((m) => (m.id === message.id ? message : m))
      : [...data.messages, message],
  };
}
