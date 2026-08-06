import type { MessageStatus } from "../types";
import type { SmsTransport } from "./types";

export type MockTransportOptions = {
  failureRate?: number;
  /** Deterministic RNG seed (0–1). When set, overrides Math.random for failure. */
  roll?: number;
  delayMs?: number;
};

/**
 * Deterministic mock SMS transport for disconnected / local-dev paths.
 * Simulates queued → sent lifecycle without calling any provider.
 */
export function createMockSmsTransport(options: MockTransportOptions = {}): SmsTransport {
  const failureRate = options.failureRate ?? 0;
  const statuses = new Map<string, MessageStatus>();

  return {
    id: "mock-sms",
    async send(input) {
      if (options.delayMs) {
        await new Promise((r) => setTimeout(r, options.delayMs));
      }
      const roll = options.roll ?? Math.random();
      if (roll < failureRate) {
        throw new Error("Mock SMS provider rejected the message.");
      }
      const providerMessageId = `MOCK${input.idempotencyKey.replace(/[^a-zA-Z0-9]/g, "").slice(0, 24)}`;
      statuses.set(providerMessageId, "sent");
      // Promote to delivered shortly in memory for UI demos.
      queueMicrotask(() => {
        statuses.set(providerMessageId, "delivered");
      });
      return { providerMessageId, status: "sent" };
    },
    async getStatus(providerMessageId) {
      return statuses.get(providerMessageId) ?? "failed";
    },
  };
}
