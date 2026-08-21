import type { MessageLink, MessageStatus } from "../types";
import type { IntegrationState } from "@/features/integrations";

export interface SmsTransport {
  id: string;
  send(input: {
    to: string;
    body: string;
    link: MessageLink;
    idempotencyKey: string;
  }): Promise<{ providerMessageId: string; status: MessageStatus }>;
  getStatus(providerMessageId: string): Promise<MessageStatus>;
}

export interface EmailTransport {
  id: string;
  send(input: {
    to: string;
    subject: string;
    body: string;
    link: MessageLink;
    idempotencyKey: string;
  }): Promise<{ providerMessageId: string; status: MessageStatus }>;
}

export function shouldUseLiveSmsTransport(integration?: IntegrationState): boolean {
  if (!integration) return false;
  return integration.status === "connected" && integration.capabilities.includes("sms.send");
}
