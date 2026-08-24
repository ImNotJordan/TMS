import { describe, expect, it } from "vitest";

import { lookupPhrase, normalizePhrase, phraseCoverage } from "@/lib/i18n/phrases";
import { ZH_CN_PHRASES } from "@/lib/i18n/phrases.zh-CN";
import { getActiveLocale, setActiveLocale, t, translate } from "@/lib/i18n/t";
import { DEFAULT_LOCALE } from "@/lib/i18n/locales";
import { MODULES, ROLES, USER_STATUSES } from "@/lib/admin-user-constants";
import { INVENTORY_ITEM_STATUSES } from "@/lib/inventory-domain";

describe("normalizePhrase", () => {
  /**
   * A JSX text node that wrapped across lines reaches `t()` with its newline and
   * indentation intact. Without normalization the same sentence would need one
   * table entry per line-break position, and a prettier reflow would silently
   * un-translate it.
   */
  it("collapses the whitespace JSX formatting introduces", () => {
    expect(normalizePhrase("Save   changes")).toBe("Save changes");
    expect(normalizePhrase("Save\n        changes")).toBe("Save changes");
    expect(normalizePhrase("  Save changes  ")).toBe("Save changes");
  });

  it("matches a multi-line phrase against its single-line table entry", () => {
    const key = Object.keys(ZH_CN_PHRASES).find((k) => k.includes(" ") && k.length > 30);
    expect(key).toBeDefined();
    const wrapped = key!.replace(" ", "\n                    ");
    expect(lookupPhrase("zh-CN", wrapped)).toBe(ZH_CN_PHRASES[key!]);
  });
});

describe("lookupPhrase", () => {
  it("returns the translation for a known phrase", () => {
    expect(lookupPhrase("zh-CN", "Save changes")).toBe("保存更改");
  });

  it("returns undefined for an unknown phrase, never a blank", () => {
    expect(lookupPhrase("zh-CN", "A phrase nobody has translated")).toBeUndefined();
  });

  /** English is the key space; a table mapping it to itself would be dead weight. */
  it("never consults a table for the default locale", () => {
    expect(lookupPhrase("en-US", "Save changes")).toBeUndefined();
  });
});

describe("t", () => {
  it("passes English through unchanged", () => {
    setActiveLocale("en-US");
    expect(t("Save changes")).toBe("Save changes");
    expect(getActiveLocale()).toBe("en-US");
  });

  it("translates once a locale is active", () => {
    setActiveLocale("zh-CN");
    expect(t("Save changes")).toBe("保存更改");
    setActiveLocale(DEFAULT_LOCALE);
  });

  /**
   * The property the whole retrofit rests on: an untranslated string renders as
   * English rather than as blank or `undefined`. 2,786 call sites depend on it.
   */
  it("falls back to the input when a translation is missing", () => {
    setActiveLocale("zh-CN");
    expect(t("Not in any table")).toBe("Not in any table");
    expect(t("Not in any table", "Fallback")).toBe("Fallback");
    setActiveLocale(DEFAULT_LOCALE);
  });

  it("resolves symbolic keys as well as phrases", () => {
    setActiveLocale("zh-CN");
    expect(t("nav.item.Loads")).toBe("货运订单");
    expect(t("action.save")).toBe("保存");
    setActiveLocale(DEFAULT_LOCALE);
  });

  it("survives a non-string argument rather than crashing a page", () => {
    setActiveLocale("zh-CN");
    expect(t(undefined as unknown as string)).toBeUndefined();
    expect(t("" as string)).toBe("");
    setActiveLocale(DEFAULT_LOCALE);
  });

  it("translate() is pure and does not depend on the active locale", () => {
    setActiveLocale("en-US");
    expect(translate("zh-CN", "Save changes")).toBe("保存更改");
    expect(translate("en-US", "Save changes")).toBe("Save changes");
  });
});

describe("the table does not corrupt persisted vocabulary", () => {
  /**
   * The safety property that makes display-side translation viable.
   *
   * Status values, roles and module names are written to DynamoDB and compared
   * on the server. Translating them *at rest* would put Chinese in the database
   * and break every comparison. Translating them *for display* is fine and
   * desirable — so these keys legitimately appear in the table, and what must
   * hold is that the constants themselves are untouched English.
   */
  it("leaves the constant arrays in English", () => {
    for (const value of [...MODULES, ...ROLES, ...USER_STATUSES, ...INVENTORY_ITEM_STATUSES]) {
      expect(value, value).toMatch(/^[\x20-\x7E]+$/);
    }
  });

  it("still translates those values for display", () => {
    setActiveLocale("zh-CN");
    // Same string in, Chinese out — while `USER_STATUSES` itself is unchanged.
    expect(t("Active")).toBe("启用");
    expect(USER_STATUSES).toContain("Active");
    setActiveLocale(DEFAULT_LOCALE);
  });
});

describe("table hygiene", () => {
  it("has no empty or whitespace-only translations", () => {
    for (const [english, translated] of Object.entries(ZH_CN_PHRASES)) {
      expect(translated.trim(), english).not.toBe("");
    }
  });

  it("has no entry that is merely a copy of the English", () => {
    const copies = Object.entries(ZH_CN_PHRASES).filter(([english, zh]) => english === zh);
    // Acronyms and product names legitimately match — "SOC 2", "MC / DOT", "SKU *".
    expect(copies.length).toBeLessThan(10);
  });

  it("has no key with leading or trailing whitespace", () => {
    for (const key of Object.keys(ZH_CN_PHRASES)) {
      expect(key, key).toBe(key.trim());
    }
  });

  it("holds a substantial table", () => {
    expect(phraseCoverage("zh-CN")).toBeGreaterThan(1900);
    expect(phraseCoverage("en-US")).toBe(0);
  });
});
