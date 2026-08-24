import { beforeEach, describe, expect, it } from "vitest";

import { EMPTY_VALUE, createFormatters, resetFormatterCachesForTests } from "@/lib/i18n/format";
import { resolveLocaleSettings } from "@/lib/i18n/locale-context";
import { DEFAULT_TIME_ZONE } from "@/lib/i18n/locales";

/** 2026-08-19 23:30 UTC — deliberately late in the UTC day. */
const LATE_UTC = new Date("2026-08-19T23:30:00Z");

beforeEach(() => {
  resetFormatterCachesForTests();
});

describe("time zone actually changes the output", () => {
  /**
   * The whole point of the feature. 23:30 UTC on the 19th is the *20th* in
   * Shanghai and still the 19th in Chicago — so a formatter that ignores the
   * setting reports the wrong day, not merely the wrong time.
   */
  it("shifts the calendar day, not just the clock", () => {
    const chicago = createFormatters({ locale: "en-US", timeZone: "America/Chicago" });
    const shanghai = createFormatters({ locale: "en-US", timeZone: "Asia/Shanghai" });

    expect(chicago.date(LATE_UTC)).toContain("19");
    expect(shanghai.date(LATE_UTC)).toContain("20");
    expect(chicago.date(LATE_UTC)).not.toBe(shanghai.date(LATE_UTC));
  });

  it("renders the same instant as different wall clocks", () => {
    const chicago = createFormatters({ timeZone: "America/Chicago" }).time(LATE_UTC);
    const shanghai = createFormatters({ timeZone: "Asia/Shanghai" }).time(LATE_UTC);
    expect(chicago).not.toBe(shanghai);
    expect(chicago).toMatch(/6:30/); // CDT = UTC-5
    expect(shanghai).toMatch(/7:30/); // CST = UTC+8
  });

  it("can name the zone, for anything a dock or a driver reads", () => {
    const withZone = createFormatters({ timeZone: "Asia/Shanghai" }).dateTimeWithZone(LATE_UTC);
    expect(withZone).toMatch(/GMT\+8|CST/);
  });

  it("falls back to the default zone rather than throwing on a bad one", () => {
    const bad = createFormatters({ timeZone: "Nowhere/Nothing" });
    const good = createFormatters({ timeZone: DEFAULT_TIME_ZONE });
    expect(bad.date(LATE_UTC)).toBe(good.date(LATE_UTC));
  });
});

describe("locale actually changes the output", () => {
  it("writes dates in the selected language", () => {
    const en = createFormatters({ locale: "en-US", timeZone: "UTC" }).dateLong(LATE_UTC);
    const zh = createFormatters({ locale: "zh-CN", timeZone: "UTC" }).dateLong(LATE_UTC);
    expect(en).not.toBe(zh);
    expect(zh).toContain("年");
    expect(zh).toContain("月");
  });

  it("localizes relative time instead of hand-building it", () => {
    const now = new Date("2026-08-20T00:00:00Z");
    const twoHoursAgo = new Date("2026-08-19T22:00:00Z");
    const en = createFormatters({ locale: "en-US" }).relative(twoHoursAgo, now);
    const zh = createFormatters({ locale: "zh-CN" }).relative(twoHoursAgo, now);

    expect(en).toMatch(/hour/);
    expect(zh).toContain("小时");
  });

  it("uses the locale's own currency when none is named", () => {
    expect(createFormatters({ locale: "en-US" }).currency(1240)).toContain("$");
    expect(createFormatters({ locale: "zh-CN" }).currency(1240)).toMatch(/¥|CN¥/);
  });

  it("honours an explicit currency over the locale default", () => {
    expect(createFormatters({ locale: "zh-CN", currency: "USD" }).currency(1240)).toContain("US$");
  });
});

describe("hour cycle", () => {
  it("follows the 24-hour setting", () => {
    const twelve = createFormatters({ timeZone: "UTC", hourCycle: "12-hour" }).time(LATE_UTC);
    const twentyFour = createFormatters({ timeZone: "UTC", hourCycle: "24-hour" }).time(LATE_UTC);
    expect(twelve).toMatch(/11:30\s?PM/);
    expect(twentyFour).toMatch(/23:30/);
  });

  it("defers to the locale when unset", () => {
    const formatted = createFormatters({ locale: "en-US", timeZone: "UTC" }).time(LATE_UTC);
    expect(formatted).toMatch(/11:30/);
  });
});

describe("absent values", () => {
  it.each([null, undefined, "", "not a date", Number.NaN])("renders a dash for %s", (value) => {
    const format = createFormatters();
    expect(format.date(value as never)).toBe(EMPTY_VALUE);
    expect(format.dateTime(value as never)).toBe(EMPTY_VALUE);
    expect(format.relative(value as never)).toBe(EMPTY_VALUE);
  });

  it("renders a dash rather than 0 for a missing number", () => {
    const format = createFormatters();
    expect(format.number(undefined)).toBe(EMPTY_VALUE);
    expect(format.currency(null)).toBe(EMPTY_VALUE);
    expect(format.integer(Number.NaN)).toBe(EMPTY_VALUE);
    // A real zero is still a zero.
    expect(format.number(0)).toBe("0");
  });
});

describe("numbers", () => {
  it("groups by locale convention", () => {
    expect(createFormatters({ locale: "en-US" }).number(1234567.891)).toBe("1,234,567.891");
  });

  it("compacts for metric tiles", () => {
    expect(createFormatters({ locale: "en-US" }).compactNumber(1_250_000)).toBe("1.3M");
    expect(createFormatters({ locale: "en-US" }).compactCurrency(1_250_000)).toContain("1.3M");
  });

  it("formats percentages", () => {
    expect(createFormatters({ locale: "en-US" }).percent(0.427, 1)).toBe("42.7%");
  });

  it("accepts a date, an ISO string and an epoch alike", () => {
    const format = createFormatters({ timeZone: "UTC" });
    const iso = format.date("2026-08-19T23:30:00Z");
    expect(format.date(LATE_UTC)).toBe(iso);
    expect(format.date(LATE_UTC.getTime())).toBe(iso);
  });
});

describe("resolveLocaleSettings", () => {
  it("reads the workspace record", () => {
    const resolved = resolveLocaleSettings({
      default_language: "Chinese",
      default_time_zone: "Asia/Shanghai",
      default_time_format: "24-hour",
      default_currency: "CNY",
    });
    expect(resolved).toMatchObject({
      locale: "zh-CN",
      timeZone: "Asia/Shanghai",
      hourCycle: "24-hour",
      currency: "CNY",
      timeZoneFromBrowser: false,
    });
  });

  /**
   * The zone falls back to the browser so a workspace that has never opened
   * Settings still shows local times. The *language* deliberately does not —
   * guessing it would flip the UI for a colleague who is merely travelling.
   */
  it("falls back to the browser zone but never to a guessed language", () => {
    const resolved = resolveLocaleSettings({ default_language: "English" }, "Asia/Tokyo");
    expect(resolved.timeZone).toBe("Asia/Tokyo");
    expect(resolved.timeZoneFromBrowser).toBe(true);
    expect(resolved.locale).toBe("en-US");
  });

  it("prefers the configured zone over the browser's", () => {
    const resolved = resolveLocaleSettings({ default_time_zone: "Asia/Shanghai" }, "Asia/Tokyo");
    expect(resolved.timeZone).toBe("Asia/Shanghai");
    expect(resolved.timeZoneFromBrowser).toBe(false);
  });

  it("survives an empty or absent record", () => {
    expect(resolveLocaleSettings(null).locale).toBe("en-US");
    expect(resolveLocaleSettings({}).timeZone).toBe(DEFAULT_TIME_ZONE);
  });

  it("ignores a stored zone the runtime rejects", () => {
    const resolved = resolveLocaleSettings({ default_time_zone: "Nowhere/Nothing" }, "Asia/Tokyo");
    expect(resolved.timeZone).toBe(DEFAULT_TIME_ZONE);
  });

  it("takes the currency from the locale when the record has none", () => {
    expect(resolveLocaleSettings({ default_language: "zh-CN" }).currency).toBe("CNY");
  });

  it("ignores an unrecognized time format rather than inventing one", () => {
    expect(resolveLocaleSettings({ default_time_format: "sundial" }).hourCycle).toBeUndefined();
  });
});
