import type { IntegrationState } from "@/features/integrations";

import { createMockSmsTransport } from "./mockTransport";
import { createTwilioSmsTransport } from "./twilioTransport";
import { shouldUseLiveSmsTransport, type SmsTransport } from "./types";

let lastLoggedAdapter: string | null = null;

/**
 * Returns the Twilio adapter when the integration is connected and capable;
 * otherwise the mock adapter. Logs which adapter is active (once per switch).
 */
export function getSmsTransport(integration?: IntegrationState): SmsTransport {
  const useLive = shouldUseLiveSmsTransport(integration);
  const transport = useLive ? createTwilioSmsTransport() : createMockSmsTransport();

  if (lastLoggedAdapter !== transport.id) {
    lastLoggedAdapter = transport.id;
    console.info(`[comms] SMS transport active: ${transport.id}`);
  }

  return transport;
}

export type { SmsTransport } from "./types";
export { createMockSmsTransport } from "./mockTransport";
export { createTwilioSmsTransport } from "./twilioTransport";
export { shouldUseLiveSmsTransport } from "./types";
