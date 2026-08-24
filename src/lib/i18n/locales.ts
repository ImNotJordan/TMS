/**
 * Supported locales and the time zones the workspace can operate in.
 *
 * Pure data plus resolvers. No React, no transport — the settings page, the
 * provider and every formatter read the same definitions rather than three
 * lists that drift.
 *
 * ## Why the resolvers are forgiving
 *
 * `default_language` has shipped as the free-text string `"English"`, and
 * `personal_time_zone` as a free-text input, so real workspaces already hold
 * values that are neither locale codes nor IANA ids. A resolver that accepted
 * only canonical values would read those as "unset" and silently reset a saved
 * preference the first time someone opened Settings. So the resolvers accept the
 * legacy spellings and normalize them, and `resolveTimeZone` validates against
 * the runtime's own tz database rather than a hardcoded list.
 */

export const LOCALE_CODES = ["en-US", "zh-CN"] as const;
export type LocaleCode = (typeof LOCALE_CODES)[number];

export const DEFAULT_LOCALE: LocaleCode = "en-US";

export type LocaleDefinition = {
  code: LocaleCode;
  /** Shown in its own language — the convention every language picker follows. */
  nativeLabel: string;
  /** Shown alongside, so an English-speaking admin can still identify the row. */
  englishLabel: string;
  region: string;
  /** Offered when the user picks this language and has no time zone of their own. */
  suggestedTimeZone: string;
  /** ISO 4217, used when a caller does not name one. */
  defaultCurrency: string;
  /** Regional indicator pair — renders as a flag where the platform supports it. */
  flag: string;
};

export const LOCALES: Record<LocaleCode, LocaleDefinition> = {
  "en-US": {
    code: "en-US",
    nativeLabel: "English",
    englishLabel: "English (United States)",
    region: "US",
    suggestedTimeZone: "America/Chicago",
    defaultCurrency: "USD",
    flag: "\u{1F1FA}\u{1F1F8}",
  },
  "zh-CN": {
    code: "zh-CN",
    nativeLabel: "中文（简体）",
    englishLabel: "Chinese (Simplified)",
    region: "CN",
    suggestedTimeZone: "Asia/Shanghai",
    defaultCurrency: "CNY",
    flag: "\u{1F1E8}\u{1F1F3}",
  },
};

export const LOCALE_LIST: LocaleDefinition[] = LOCALE_CODES.map((code) => LOCALES[code]);

/**
 * Legacy and colloquial spellings that map onto a supported locale.
 *
 * Compared lowercased and trimmed. `"english"` is the value `default_language`
 * has always stored, so this table is load-bearing rather than defensive.
 */
const LOCALE_ALIASES: Record<string, LocaleCode> = {
  english: "en-US",
  en: "en-US",
  en_us: "en-US",
  "english (united states)": "en-US",
  us: "en-US",
  usa: "en-US",
  "united states": "en-US",
  chinese: "zh-CN",
  "chinese (simplified)": "zh-CN",
  "simplified chinese": "zh-CN",
  mandarin: "zh-CN",
  zh: "zh-CN",
  zh_cn: "zh-CN",
  zh_hans: "zh-CN",
  cn: "zh-CN",
  china: "zh-CN",
  中文: "zh-CN",
  "中文（简体）": "zh-CN",
  "中文(简体)": "zh-CN",
  简体中文: "zh-CN",
};

export function isLocaleCode(value: unknown): value is LocaleCode {
  return typeof value === "string" && (LOCALE_CODES as readonly string[]).includes(value);
}

/** Normalize any stored or user-typed language value onto a supported locale. */
export function resolveLocale(value: unknown, fallback: LocaleCode = DEFAULT_LOCALE): LocaleCode {
  if (isLocaleCode(value)) return value;
  if (typeof value !== "string") return fallback;

  const key = value.trim().toLowerCase();
  if (!key) return fallback;

  const alias = LOCALE_ALIASES[key] ?? LOCALE_ALIASES[key.replace(/-/g, "_")];
  if (alias) return alias;

  // `zh-Hans-CN`, `en-GB` and friends — match the language subtag so a regional
  // variant lands somewhere sensible instead of on the fallback.
  const [language] = key.split(/[-_]/);
  if (language === "zh") return "zh-CN";
  if (language === "en") return "en-US";

  return fallback;
}

/* ------------------------------------------------------------------ *
 * Time zones
 * ------------------------------------------------------------------ */

export type TimeZoneOption = {
  /** IANA identifier — the only thing persisted. */
  id: string;
  label: string;
};

export type TimeZoneGroupKey =
  | "timezone.group.americas"
  | "timezone.group.asiaPacific"
  | "timezone.group.europe"
  | "timezone.group.utc";

export type TimeZoneGroup = {
  /** Dictionary key, so the group heading translates. */
  labelKey: TimeZoneGroupKey;
  zones: TimeZoneOption[];
};

/**
 * The curated list the picker offers.
 *
 * Deliberately not `Intl.supportedValuesOf("timeZone")` — that is ~400 entries
 * and turns a two-click choice into a search problem. Deliberately not the four
 * US zones it replaced either: a workspace that moves freight into China cannot
 * express its destination in that list, and a picker that cannot say what you
 * mean is why a setting stays wrong.
 *
 * Anything already stored outside this list still resolves and still displays —
 * see `resolveTimeZone` and `describeTimeZone`.
 */
export const TIME_ZONE_GROUPS: TimeZoneGroup[] = [
  {
    labelKey: "timezone.group.americas",
    zones: [
      { id: "America/New_York", label: "New York — Eastern" },
      { id: "America/Chicago", label: "Chicago — Central" },
      { id: "America/Denver", label: "Denver — Mountain" },
      { id: "America/Phoenix", label: "Phoenix — Arizona (no DST)" },
      { id: "America/Los_Angeles", label: "Los Angeles — Pacific" },
      { id: "America/Anchorage", label: "Anchorage — Alaska" },
      { id: "Pacific/Honolulu", label: "Honolulu — Hawaii" },
      { id: "America/Toronto", label: "Toronto" },
      { id: "America/Mexico_City", label: "Mexico City" },
    ],
  },
  {
    labelKey: "timezone.group.asiaPacific",
    zones: [
      { id: "Asia/Shanghai", label: "Shanghai — China Standard Time" },
      { id: "Asia/Hong_Kong", label: "Hong Kong" },
      { id: "Asia/Taipei", label: "Taipei" },
      { id: "Asia/Singapore", label: "Singapore" },
      { id: "Asia/Tokyo", label: "Tokyo" },
      { id: "Asia/Seoul", label: "Seoul" },
      { id: "Asia/Manila", label: "Manila" },
      { id: "Australia/Sydney", label: "Sydney" },
    ],
  },
  {
    labelKey: "timezone.group.europe",
    zones: [
      { id: "Europe/London", label: "London" },
      { id: "Europe/Amsterdam", label: "Amsterdam" },
      { id: "Europe/Berlin", label: "Berlin" },
    ],
  },
  {
    labelKey: "timezone.group.utc",
    zones: [{ id: "UTC", label: "Coordinated Universal Time" }],
  },
];

export const TIME_ZONE_IDS: string[] = TIME_ZONE_GROUPS.flatMap((group) =>
  group.zones.map((zone) => zone.id),
);

const TIME_ZONE_LABELS = new Map(
  TIME_ZONE_GROUPS.flatMap((group) => group.zones.map((zone) => [zone.id, zone.label] as const)),
);

export const DEFAULT_TIME_ZONE = "America/Chicago";

/**
 * Is this a time zone the runtime actually knows?
 *
 * Asked of `Intl` rather than of the list above, because a stored value may
 * predate the list and still be perfectly valid. An unknown zone throws a
 * RangeError, which is the only reliable test available.
 */
export function isValidTimeZone(value: unknown): value is string {
  if (typeof value !== "string" || !value.trim()) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value.trim() });
    return true;
  } catch {
    return false;
  }
}

export function resolveTimeZone(value: unknown, fallback = DEFAULT_TIME_ZONE): string {
  if (isValidTimeZone(value)) return value.trim();
  return isValidTimeZone(fallback) ? fallback : "UTC";
}

/** The viewer's own zone, for the "detected" hint. Never silently persisted. */
export function detectTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || DEFAULT_TIME_ZONE;
  } catch {
    return DEFAULT_TIME_ZONE;
  }
}

/**
 * `UTC+8` / `UTC-05:00` for a zone at a given instant.
 *
 * Computed rather than stored: most of these zones observe DST, so a hardcoded
 * offset is wrong for part of the year — and being an hour out on an
 * appointment window is worse than showing nothing.
 */
export function timeZoneOffsetLabel(timeZone: string, at: Date = new Date()): string {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      timeZoneName: "shortOffset",
    }).formatToParts(at);
    const name = parts.find((part) => part.type === "timeZoneName")?.value;
    if (!name) return "";
    // Intl renders these as "GMT+8" / "GMT+0". "UTC" is the label this app uses
    // everywhere else, and a zero offset reads better bare than as "UTC+0".
    const normalized = name.replace("GMT", "UTC");
    return /^UTC[+-]0(?::00)?$/.test(normalized) ? "UTC" : normalized;
  } catch {
    return "";
  }
}

/** Human label for a zone id, including ones outside the curated list. */
export function describeTimeZone(timeZone: string): string {
  const known = TIME_ZONE_LABELS.get(timeZone);
  if (known) return known;
  // `Asia/Ho_Chi_Minh` -> `Ho Chi Minh`, rather than showing the raw id.
  const city = timeZone.split("/").pop() ?? timeZone;
  return city.replace(/_/g, " ");
}

/** Wall-clock time in a zone right now, for the picker's live preview. */
export function currentTimeInZone(
  timeZone: string,
  locale: LocaleCode = DEFAULT_LOCALE,
  at: Date = new Date(),
): string {
  try {
    return new Intl.DateTimeFormat(locale, {
      timeZone,
      hour: "numeric",
      minute: "2-digit",
    }).format(at);
  } catch {
    return "";
  }
}
