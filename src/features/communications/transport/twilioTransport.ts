import type { MessageStatus } from "../types";
import { getCommsAuthHeaders } from "../lib/authHeaders";
import type { SmsTransport } from "./types";

/**
 * Twilio SMS transport — calls our backend only. Never talks to api.twilio.com
 * from the browser. Credentials stay on the server.
 */
export function createTwilioSmsTransport(): SmsTransport {
  return {
    id: "twilio-sms",
    async send(input) {
      const auth = await getCommsAuthHeaders();
      const response = await fetch("/api/comms/sms/send", {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "Idempotency-Key": input.idempotencyKey,
          ...auth,
        },
        body: JSON.stringify({
          to: input.to,
          body: input.body,
          link: input.link,
        }),
      });

      const payload = (await response.json().catch(() => null)) as {
        providerMessageId?: string;
        status?: MessageStatus;
        error?: string;
        mock?: boolean;
      } | null;

      if (!response.ok) {
        throw new Error(payload?.error ?? `SMS send failed (HTTP ${response.status}).`);
      }

      if (!payload?.providerMessageId || !payload.status) {
        throw new Error("SMS send returned an incomplete response.");
      }

      return {
        providerMessageId: payload.providerMessageId,
        status: payload.status,
      };
    },
    async getStatus(providerMessageId) {
      const response = await fetch(
        `/api/comms/sms/status?sid=${encodeURIComponent(providerMessageId)}`,
        { headers: { Accept: "application/json" } },
      );
      const payload = (await response.json().catch(() => null)) as {
        status?: MessageStatus;
        error?: string;
      } | null;
      if (!response.ok || !payload?.status) {
        throw new Error(payload?.error ?? "Could not load SMS status.");
      }
      return payload.status;
    },
  };
}
