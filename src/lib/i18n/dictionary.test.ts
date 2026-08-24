import { describe, expect, it } from "vitest";

import {
  DICTIONARIES,
  createTranslator,
  dictionaryKeys,
  navGroupLabel,
  navItemLabel,
} from "@/lib/i18n/dictionary";
import { LOCALE_CODES } from "@/lib/i18n/locales";
import { MODULES } from "@/lib/admin-user-constants";
import { NAV_ITEMS } from "@/lib/nav";

describe("dictionaries", () => {
  it("covers every supported locale", () => {
    for (const code of LOCALE_CODES) {
      expect(DICTIONARIES[code], code).toBeDefined();
    }
  });

  /**
   * `Dictionary` is `Record<TranslationKey, string>`, so a missing key is a
   * compile error. This asserts the other direction: no locale carries a key
   * English has dropped, and nothing is blank.
   */
  it("has the same keys in every locale, none of them empty", () => {
    const keys = dictionaryKeys();
    for (const code of LOCALE_CODES) {
      const dictionary = DICTIONARIES[code];
      expect(Object.keys(dictionary).sort(), code).toEqual([...keys].sort());
      for (const key of keys) {
        expect(dictionary[key].trim(), `${code}:${key}`).not.toBe("");
      }
    }
  });

  it("actually translates rather than copying English", () => {
    const en = DICTIONARIES["en-US"];
    const zh = DICTIONARIES["zh-CN"];
    // A handful of keys are legitimately identical across locales (RFPs, CRM);
    // the bulk must differ, or the dictionary is decorative.
    const differing = dictionaryKeys().filter((key) => en[key] !== zh[key]);
    expect(differing.length / dictionaryKeys().length).toBeGreaterThan(0.9);
  });
});

describe("createTranslator", () => {
  it("returns the locale's string", () => {
    expect(createTranslator("zh-CN")("nav.item.Inventory")).toBe("库存管理");
    expect(createTranslator("en-US")("nav.item.Inventory")).toBe("Inventory");
  });

  it("falls back to the key when nothing matches", () => {
    const t = createTranslator("en-US");
    // Cast: the point of the test is behaviour for a key the types forbid.
    expect(t("nav.item.Nonexistent" as never)).toBe("nav.item.Nonexistent");
    expect(t("nav.item.Nonexistent" as never, "Fallback")).toBe("Fallback");
  });
});

describe("nav labels stay decoupled from RBAC keys", () => {
  /**
   * The regression this guards: `navItemToModule` matches `NavItem.title`
   * against `MODULES`. Translating the title in place would silently un-gate
   * every module for a Chinese user, because no translated string is in MODULES.
   * The dictionary is keyed by the canonical title instead, so this must hold.
   */
  it("every nav item title is still a canonical module name", () => {
    for (const item of NAV_ITEMS) {
      expect(MODULES as readonly string[], item.url).toContain(item.title);
    }
  });

  it("has a translation for every nav item, in every locale", () => {
    for (const code of LOCALE_CODES) {
      const t = createTranslator(code);
      for (const item of NAV_ITEMS) {
        const label = navItemLabel(t, item.title);
        expect(label.trim(), `${code}:${item.title}`).not.toBe("");
        // A missing key falls through to the raw dictionary key.
        expect(label.startsWith("nav.item."), `${code}:${item.title}`).toBe(false);
      }
    }
  });

  it("has a translation for every nav group", () => {
    const groups = [...new Set(NAV_ITEMS.map((item) => item.group))];
    for (const code of LOCALE_CODES) {
      const t = createTranslator(code);
      for (const group of groups) {
        const label = navGroupLabel(t, group);
        expect(label.startsWith("nav.group."), `${code}:${group}`).toBe(false);
      }
    }
  });

  it("translates the labels it is asked for", () => {
    const zh = createTranslator("zh-CN");
    expect(navItemLabel(zh, "Loads")).toBe("货运订单");
    expect(navGroupLabel(zh, "Operations")).toBe("运营");
  });

  it("passes an unknown title through unchanged", () => {
    expect(navItemLabel(createTranslator("zh-CN"), "Brand New Module")).toBe("Brand New Module");
  });
});
