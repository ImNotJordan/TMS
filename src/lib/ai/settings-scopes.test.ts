import { describe, expect, it } from "vitest";

import {
  AVALARA_SECRET_SECTION,
  CHINA_TAX_SECRET_SECTION,
  RESEND_SECRET_SECTION,
  LEGACY_GLOBAL_SETTINGS_SCOPE,
  OPENAI_SECRET_SECTION,
  SECRETS_SCOPE,
  companySecretKey,
  companySecretSection,
  companySettingsScope,
} from "@/lib/ai/settings-scopes";

const ACME = "11111111-1111-4111-8111-111111111111";
const RIVAL = "22222222-2222-4222-8222-222222222222";

describe("companySettingsScope", () => {
  it("uses the company id as the partition", () => {
    expect(companySettingsScope(ACME)).toBe(ACME);
  });

  it("refuses an empty id rather than falling back to the shared row", () => {
    expect(() => companySettingsScope("  ")).toThrow(/company id/i);
  });

  it("refuses reserved partitions so tenant data cannot land on global or secrets", () => {
    expect(() => companySettingsScope("global")).toThrow(/reserved/i);
    expect(() => companySettingsScope(SECRETS_SCOPE)).toThrow(/reserved/i);
    expect(() => companySettingsScope("ai-usage")).toThrow(/reserved/i);
  });
});

describe("companySecretSection", () => {
  it("keeps secrets in the denied partition and the company in the sort key", () => {
    const key = companySecretKey(ACME, OPENAI_SECRET_SECTION);
    expect(key.scope).toBe(SECRETS_SCOPE);
    expect(key.section).toBe(`${ACME}#openai`);
    expect(key.section).not.toBe(OPENAI_SECRET_SECTION);
  });

  it("does not collide across companies or kinds", () => {
    expect(companySecretSection(ACME, OPENAI_SECRET_SECTION)).not.toBe(
      companySecretSection(RIVAL, OPENAI_SECRET_SECTION),
    );
    expect(companySecretSection(ACME, OPENAI_SECRET_SECTION)).not.toBe(
      companySecretSection(ACME, CHINA_TAX_SECRET_SECTION),
    );
    expect(companySecretSection(ACME, AVALARA_SECRET_SECTION)).toBe(`${ACME}#avalara`);
    expect(companySecretSection(ACME, RESEND_SECRET_SECTION)).toBe(`${ACME}#resend`);
  });

  it("never produces the legacy unscoped sort keys", () => {
    expect(companySecretSection(ACME, OPENAI_SECRET_SECTION)).not.toBe("openai");
    expect(companySecretSection(ACME, CHINA_TAX_SECRET_SECTION)).not.toBe("chinaTax");
    expect(companySettingsScope(ACME)).not.toBe(LEGACY_GLOBAL_SETTINGS_SCOPE);
  });
});
