import { describe, expect, it } from "vitest";

import { consentGuard } from "@/features/communications/lib/consentGuard";
import type { ConsentRecord, DncEntry } from "@/features/communications/types";

const consent = (
  partial: Partial<ConsentRecord> & Pick<ConsentRecord, "state">,
): ConsentRecord => ({
  id: "c1",
  contactId: "contact-1",
  channel: "sms",
  basis: "explicit-optin",
  capturedAt: "2026-01-01T00:00:00.000Z",
  capturedBy: "ops",
  ...partial,
});

const dnc = (partial: Partial<DncEntry> = {}): DncEntry => ({
  id: "d1",
  address: "+15551212",
  channel: "sms",
  reason: "Customer requested",
  addedAt: "2026-01-01T00:00:00.000Z",
  addedBy: "ops",
  ...partial,
});

describe("consentGuard", () => {
  it("blocks active DNC by contact", () => {
    const result = consentGuard({
      contactId: "contact-1",
      channel: "sms",
      consentRecords: [consent({ state: "granted" })],
      dncEntries: [dnc({ contactId: "contact-1" })],
    });
    expect(result.status).toBe("blocked-dnc");
  });

  it("ignores expired DNC", () => {
    const result = consentGuard({
      contactId: "contact-1",
      channel: "sms",
      address: "+15551212",
      consentRecords: [consent({ state: "granted" })],
      dncEntries: [dnc({ expiresAt: "2020-01-01T00:00:00.000Z" })],
      now: new Date("2026-01-01"),
    });
    expect(result.status).toBe("allowed");
  });

  it("blocks revoked consent", () => {
    const result = consentGuard({
      contactId: "contact-1",
      channel: "sms",
      consentRecords: [consent({ state: "revoked" })],
      dncEntries: [],
    });
    expect(result.status).toBe("blocked-no-consent");
  });

  it("warns on unknown consent", () => {
    const result = consentGuard({
      contactId: "contact-1",
      channel: "sms",
      consentRecords: [],
      dncEntries: [],
    });
    expect(result.status).toBe("warn-unknown-consent");
  });

  it("allows granted consent", () => {
    const result = consentGuard({
      contactId: "contact-1",
      channel: "sms",
      consentRecords: [consent({ state: "granted" })],
      dncEntries: [],
    });
    expect(result.status).toBe("allowed");
  });

  it("matches DNC by address across channel all", () => {
    const result = consentGuard({
      contactId: "other",
      channel: "email",
      address: "+1 (555) 1212",
      consentRecords: [consent({ state: "granted", channel: "email" })],
      dncEntries: [dnc({ channel: "all", address: "+15551212" })],
    });
    expect(result.status).toBe("blocked-dnc");
  });
});
