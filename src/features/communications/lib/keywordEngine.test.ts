import { describe, expect, it } from "vitest";

import {
  keywordEngine,
  validateRegexTerm,
} from "@/features/communications/lib/keywordEngine";
import type { KeywordRule } from "@/features/communications/types";

const baseRule = (partial: Partial<KeywordRule> & Pick<KeywordRule, "id" | "label" | "terms">): KeywordRule => ({
  matchType: "contains",
  caseSensitive: false,
  channels: ["sms"],
  direction: "both",
  severity: "warning",
  actions: [{ type: "flag-thread" }],
  enabled: true,
  ...partial,
});

describe("keywordEngine", () => {
  it("matches contains case-insensitively with offsets", () => {
    const rules = [baseRule({ id: "1", label: "Detention", terms: ["detention"] })];
    const hits = keywordEngine("Driver has DETENTION now", rules, {
      channel: "sms",
      direction: "inbound",
    });
    expect(hits).toHaveLength(1);
    expect(hits[0]?.offset).toBe("Driver has ".length);
  });

  it("matches whole words only", () => {
    const rules = [
      baseRule({ id: "1", label: "Rate", terms: ["rate"], matchType: "word" }),
    ];
    expect(
      keywordEngine("flatbed rate increase", rules, { channel: "sms", direction: "inbound" }),
    ).toHaveLength(1);
    expect(
      keywordEngine("irate customer", rules, { channel: "sms", direction: "inbound" }),
    ).toHaveLength(0);
  });

  it("respects channel and direction filters", () => {
    const rules = [
      baseRule({
        id: "1",
        label: "Email only",
        terms: ["hello"],
        channels: ["email"],
        direction: "inbound",
      }),
    ];
    expect(
      keywordEngine("hello", rules, { channel: "sms", direction: "inbound" }),
    ).toHaveLength(0);
    expect(
      keywordEngine("hello", rules, { channel: "email", direction: "outbound" }),
    ).toHaveLength(0);
    expect(
      keywordEngine("hello", rules, { channel: "email", direction: "inbound" }),
    ).toHaveLength(1);
  });

  it("returns overlapping rule hits", () => {
    const rules = [
      baseRule({ id: "1", label: "A", terms: ["rate increase"], severity: "warning" }),
      baseRule({ id: "2", label: "B", terms: ["increase"], severity: "info" }),
    ];
    const hits = keywordEngine("need a rate increase please", rules, {
      channel: "sms",
      direction: "outbound",
    });
    expect(hits.length).toBeGreaterThanOrEqual(2);
  });

  it("rejects dangerous regex", () => {
    const bad = validateRegexTerm("(a+)+$");
    expect(bad.ok).toBe(false);
  });

  it("skips invalid regex terms at match time", () => {
    const rules = [
      baseRule({
        id: "1",
        label: "Bad",
        terms: ["(a+)+"],
        matchType: "regex",
      }),
    ];
    expect(
      keywordEngine("aaaa", rules, { channel: "sms", direction: "inbound" }),
    ).toHaveLength(0);
  });
});
