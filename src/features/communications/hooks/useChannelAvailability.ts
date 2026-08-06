import * as React from "react";

import { useIntegration } from "@/features/integrations";

import type { ChannelId } from "../types";

export type ChannelAvailability = {
  channel: ChannelId;
  available: boolean;
  reason?: string;
  fixPath?: string;
  integrationId?: string;
  lastSyncAt: string | null;
  lastSyncLabel: string;
  connectionLabel: "Connected" | "Attention" | "Disconnected";
};

export function useChannelAvailability() {
  const twilio = useIntegration("twilio_sms");
  const sendgrid = useIntegration("sendgrid_email");
  const ai = useIntegration("ai");

  const channels = React.useMemo((): ChannelAvailability[] => {
    const smsConnected =
      twilio.data?.status === "connected" &&
      (twilio.data.capabilities.includes("sms.send") ?? false);
    const emailConnected =
      sendgrid.data?.status === "connected" &&
      (sendgrid.data.capabilities.includes("email.send") ?? false);
    const voiceConnected =
      twilio.data?.status === "connected" &&
      (twilio.data.capabilities.includes("voice.call") ?? false);

    return [
      {
        channel: "email",
        available: emailConnected,
        reason: emailConnected ? undefined : "SendGrid Email is disconnected.",
        fixPath: "/settings?category=integrations#integration-sendgrid_email",
        integrationId: "sendgrid_email",
        lastSyncAt: sendgrid.data?.lastSyncAt ?? null,
        lastSyncLabel: sendgrid.data?.lastSyncLabel ?? "Never",
        connectionLabel: sendgrid.data?.connectionLabel ?? "Disconnected",
      },
      {
        channel: "sms",
        available: Boolean(smsConnected),
        reason: smsConnected ? undefined : "Twilio SMS is disconnected.",
        fixPath: "/settings?category=integrations#integration-twilio_sms",
        integrationId: "twilio_sms",
        lastSyncAt: twilio.data?.lastSyncAt ?? null,
        lastSyncLabel: twilio.data?.lastSyncLabel ?? "Never",
        connectionLabel: twilio.data?.connectionLabel ?? "Disconnected",
      },
      {
        channel: "voice",
        available: Boolean(voiceConnected),
        reason: voiceConnected ? undefined : "Twilio voice is disconnected.",
        fixPath: "/settings?category=integrations#integration-twilio_sms",
        integrationId: "twilio_sms",
        lastSyncAt: twilio.data?.lastSyncAt ?? null,
        lastSyncLabel: twilio.data?.lastSyncLabel ?? "Never",
        connectionLabel: twilio.data?.connectionLabel ?? "Disconnected",
      },
      {
        channel: "chat",
        available: true,
        lastSyncAt: new Date().toISOString(),
        lastSyncLabel: "Just now",
        connectionLabel: "Connected",
      },
    ];
  }, [twilio.data, sendgrid.data]);

  const byChannel = React.useMemo(() => {
    const map = new Map<ChannelId, ChannelAvailability>();
    for (const c of channels) map.set(c.channel, c);
    return map;
  }, [channels]);

  const anyExternalConnected = channels.some(
    (c) => c.channel !== "chat" && c.available,
  );
  const allExternalDisconnected = !anyExternalConnected;

  return {
    channels,
    byChannel,
    allExternalDisconnected,
    aiConnected: ai.data?.status === "connected",
    isLoading: twilio.isLoading || sendgrid.isLoading || ai.isLoading,
    refetch: () => {
      twilio.refetch();
      sendgrid.refetch();
      ai.refetch();
    },
  };
}
