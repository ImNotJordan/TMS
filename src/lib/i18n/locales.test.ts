import { describe, expect, it } from "vitest";

import {
  DEFAULT_LOCALE,
  DEFAULT_TIME_ZONE,
  LOCALE_CODES,
  LOCALE_LIST,
  TIME_ZONE_GROUPS,
  TIME_ZONE_IDS,
  currentTimeInZone,
  describeTimeZone,
  isLocaleCode,
  isValidTimeZone,
  resolveLocale,
  resolveTimeZone,
  timeZoneOffsetLabel,
} from "@/lib/i18n/locales";

describe("resolveLocale", () => {
  it("passes through supported codes", () => {
    expect(resolveLocale("en-US")).toBe("en-US");
    expect(resolveLocale("zh-CN")).toBe("zh-CN");
  });

  /**
   * `default_language` has shipped as the literal string "English" since the
   * settings page was written. A resolver that did not accept it would read
   * every existing workspace as unconfigured.
   */
  it("accepts the legacy stored spelling", () => {
    expect(resolveLocale("English")).toBe("en-US");
    expect(resolveLocale("english")).toBe("en-US");
    expect(resolveLocale("  English  ")).toBe("en-US");
  });

  it("accepts the ways a person might type Chinese", () => {
    for (const value of [
      "Chinese",
      "chinese (simplified)",
      "Simplified Chinese",
      "Mandarin",
      "zh",
      "zh-CN",
      "zh_Hans",
      "zh-hans",
      "China",
      "中文",
      "中文（简体）",
      "简体中文",
    ]) {
      expect(resolveLocale(value), value).toBe("zh-CN");
    }
  });

  it("maps a regional variant onto its language", () => {
    expect(resolveLocale("en-GB")).toBe("en-US");
    expect(resolveLocale("zh-Hans-CN")).toBe("zh-CN");
    expect(resolveLocale("zh-TW")).toBe("zh-CN");
  });

  it("falls back for anything unrecognized", () => {
    expect(resolveLocale("Klingon")).toBe(DEFAULT_LOCALE);
    expect(resolveLocale("")).toBe(DEFAULT_LOCALE);
    expect(resolveLocale(undefined)).toBe(DEFAULT_LOCALE);
    expect(resolveLocale(null)).toBe(DEFAULT_LOCALE);
    expect(resolveLocale(42)).toBe(DEFAULT_LOCALE);
  });

  it("honours an explicit fallback", () => {
    expect(resolveLocale("nonsense", "zh-CN")).toBe("zh-CN");
  });

  it("isLocaleCode is strict", () => {
    expect(isLocaleCode("en-US")).toBe(true);
    expect(isLocaleCode("English")).toBe(false);
    expect(isLocaleCode(null)).toBe(false);
  });
});

describe("time zones", () => {
  it("validates against the runtime tz database", () => {
    expect(isValidTimeZone("Asia/Shanghai")).toBe(true);
    expect(isValidTimeZone("America/Chicago")).toBe(true);
    expect(isValidTimeZone("UTC")).toBe(true);
    expect(isValidTimeZone("Mars/Olympus_Mons")).toBe(false);
    expect(isValidTimeZone("")).toBe(false);
    expect(isValidTimeZone(undefined)).toBe(false);
  });

  it("resolves a valid zone unchanged", () => {
    expect(resolveTimeZone("Asia/Shanghai")).toBe("Asia/Shanghai");
    expect(resolveTimeZone("  Asia/Tokyo  ")).toBe("Asia/Tokyo");
  });

  it("falls back for an invalid zone", () => {
    expect(resolveTimeZone("Nowhere/Nothing")).toBe(DEFAULT_TIME_ZONE);
    expect(resolveTimeZone(undefined)).toBe(DEFAULT_TIME_ZONE);
  });

  /**
   * A zone stored before the curated list existed must keep working, or opening
   * Settings would silently rewrite it on the next save.
   */
  it("keeps a valid zone that is not in the curated list", () => {
    expect(TIME_ZONE_IDS).not.toContain("Asia/Kolkata");
    expect(resolveTimeZone("Asia/Kolkata")).toBe("Asia/Kolkata");
  });

  it("offers China in the picker", () => {
    expect(TIME_ZONE_IDS).toContain("Asia/Shanghai");
    const asia = TIME_ZONE_GROUPS.find((g) => g.labelKey === "timezone.group.asiaPacific");
    expect(asia?.zones.some((z) => z.id === "Asia/Shanghai")).toBe(true);
  });

  it("keeps the US zones the picker already had", () => {
    for (const id of [
      "America/Chicago",
      "America/New_York",
      "America/Denver",
      "America/Los_Angeles",
    ]) {
      expect(TIME_ZONE_IDS).toContain(id);
    }
  });

  it("lists every zone id exactly once and all are valid", () => {
    expect(new Set(TIME_ZONE_IDS).size).toBe(TIME_ZONE_IDS.length);
    for (const id of TIME_ZONE_IDS) {
      expect(isValidTimeZone(id), id).toBe(true);
    }
  });

  it("labels a zone outside the list from its id", () => {
    expect(describeTimeZone("Asia/Shanghai")).toContain("Shanghai");
    expect(describeTimeZone("Asia/Ho_Chi_Minh")).toBe("Ho Chi Minh");
  });

  /**
   * Offsets are computed, never stored — half these zones observe DST, so a
   * hardcoded table is wrong for part of the year.
   */
  it("reports a UTC offset for a known instant", () => {
    const january = new Date("2026-01-15T12:00:00Z");
    // China has no DST, so this is stable year-round.
    expect(timeZoneOffsetLabel("Asia/Shanghai", january)).toBe("UTC+8");
    expect(timeZoneOffsetLabel("UTC", january)).toBe("UTC");
  });

  it("tracks DST rather than assuming a fixed offset", () => {
    const winter = timeZoneOffsetLabel("America/Chicago", new Date("2026-01-15T12:00:00Z"));
    const summer = timeZoneOffsetLabel("America/Chicago", new Date("2026-07-15T12:00:00Z"));
    expect(winter).toBe("UTC-6");
    expect(summer).toBe("UTC-5");
    expect(winter).not.toBe(summer);
  });

  it("returns empty rather than throwing for a bad zone", () => {
    expect(timeZoneOffsetLabel("Nowhere/Nothing")).toBe("");
    expect(currentTimeInZone("Nowhere/Nothing")).toBe("");
  });

  it("renders a wall clock in the requested zone", () => {
    const at = new Date("2026-08-19T16:00:00Z");
    // 16:00Z is midnight the next day in Shanghai (UTC+8).
    expect(currentTimeInZone("Asia/Shanghai", "en-US", at)).toMatch(/12:00\s?AM/);
    expect(currentTimeInZone("America/Chicago", "en-US", at)).toMatch(/11:00\s?AM/);
  });
});

describe("locale definitions", () => {
  it("defines every supported code once", () => {
    expect(LOCALE_LIST).toHaveLength(LOCALE_CODES.length);
    expect(new Set(LOCALE_LIST.map((l) => l.code)).size).toBe(LOCALE_CODES.length);
  });

  it("carries a native label, an English label and a valid suggested zone", () => {
    for (const definition of LOCALE_LIST) {
      expect(definition.nativeLabel.trim()).not.toBe("");
      expect(definition.englishLabel.trim()).not.toBe("");
      expect(isValidTimeZone(definition.suggestedTimeZone), definition.code).toBe(true);
      expect(definition.defaultCurrency).toMatch(/^[A-Z]{3}$/);
    }
  });

  it("suggests China for Chinese and the US for English", () => {
    expect(LOCALE_LIST.find((l) => l.code === "zh-CN")?.suggestedTimeZone).toBe("Asia/Shanghai");
    expect(LOCALE_LIST.find((l) => l.code === "en-US")?.defaultCurrency).toBe("USD");
  });
});
