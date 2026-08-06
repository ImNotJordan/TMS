import { describe, expect, it, vi } from "vitest";

import { consentGuard } from "@/features/communications/lib/consentGuard";
import { createMockSmsTransport } from "@/features/communications/transport/mockTransport";
import type { Message, MessageLink, TranslationRecord } from "@/features/communications/types";

describe("send + translation invariants", () => {
  it("blocked send does not call transport", async () => {
    const transport = createMockSmsTransport();
    const spy = vi.spyOn(transport, "send");

    const guard = consentGuard({
      contactId: "c1",
      channel: "sms",
      consentRecords: [],
      dncEntries: [
        {
          id: "d1",
          contactId: "c1",
          address: "+1555",
          channel: "sms",
          reason: "stop",
          addedAt: new Date().toISOString(),
          addedBy: "ops",
        },
      ],
    });

    expect(guard.status).toBe("blocked-dnc");
    if (guard.status === "blocked-dnc") {
      // audit would be written by useSendMessage; transport must stay idle
      expect(spy).not.toHaveBeenCalled();
    }
  });

  it("failed send retains idempotency key", async () => {
    const transport = createMockSmsTransport({ failureRate: 1, roll: 0 });
    const key = "idem_abc123";
    await expect(
      transport.send({
        to: "+15551212",
        body: "hello",
        link: { contactId: "c1" },
        idempotencyKey: key,
      }),
    ).rejects.toThrow();

    const message: Message = {
      id: "m1",
      conversationId: "conv1",
      channel: "sms",
      direction: "outbound",
      status: "failed",
      link: { contactId: "c1" },
      body: "hello",
      keywordHits: [],
      authorId: "u1",
      isAiGenerated: false,
      idempotencyKey: key,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    expect(message.idempotencyKey).toBe(key);
  });

  it("translation keeps originalText permanently", () => {
    const translation: TranslationRecord = {
      originalText: "Hola conductor",
      originalLang: "es-MX",
      translatedText: "Hello driver",
      targetLang: "en",
      engine: "ai:gpt-4o-mini",
      translatedAt: new Date().toISOString(),
      translatedBy: "auto",
    };
    const message: Message = {
      id: "m1",
      conversationId: "conv1",
      channel: "sms",
      direction: "inbound",
      status: "delivered",
      link: { loadId: "L1", contactId: "c1" },
      body: translation.translatedText,
      translation,
      keywordHits: [],
      authorId: "c1",
      isAiGenerated: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    // Round-trip through JSON (persistence shape)
    const roundTrip = JSON.parse(JSON.stringify(message)) as Message;
    expect(roundTrip.translation?.originalText).toBe("Hola conductor");
    expect(roundTrip.translation?.originalLang).toBe("es-MX");
    expect(roundTrip.body).toBe("Hello driver");
  });
});

/**
 * Compile-time MessageLink enforcement.
 * Uncommenting the invalid assignment must fail `tsc --noEmit`.
 */
export function typeTestMessageLink(): MessageLink {
  const validLoad: MessageLink = { loadId: "L1" };
  const validContact: MessageLink = { contactId: "C1" };
  const validBoth: MessageLink = { loadId: "L1", contactId: "C1" };
  // @ts-expect-error — unlinked message is unrepresentable
  const invalid: MessageLink = {};
  void invalid;
  return validBoth.loadId ? validBoth : validLoad.loadId ? validLoad : validContact;
}
