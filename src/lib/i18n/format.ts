/**
 * Locale- and time-zone-aware formatting.
 *
 * This is the module that makes the Settings dropdowns mean something. Before
 * it, ~150 call sites across the app called `toLocaleString("en-US", …)` with no
 * `timeZone`, so every timestamp rendered in the *viewer's browser* zone under
 * US conventions, and `default_time_zone` / `default_language` were stored and
 * never read. Changing them changed nothing.
 *
 * ## Why a factory rather than loose functions
 *
 * `new Intl.DateTimeFormat(...)` is expensive — enough that constructing one per
 * table cell is visible on a thousand-row ledger. So formatters are built once
 * per (locale, timeZone, shape) and cached. `createFormatters` hands back a bag
 * of ready formatters for one locale/zone pair, which is what the React context
 * holds and re-creates only when the setting changes.
 *
 * ## Time zone is not a display detail
 *
 * A timestamp is an instant; a time zone is what turns it into a wall clock.
 * Rendering `2026-08-19T23:30Z` in `America/Chicago` and in `Asia/Shanghai`
 * yields two different *dates*, not just two different times. That is exactly
 * why an appointment window, a cycle-count timestamp and a delivery date must
 * all go through here rather than through the browser default: for a workspace
 * operating between the US and China, the browser default is the one zone that
 * is guaranteed wrong for someone.
 */
import { DEFAULT_LOCALE, DEFAULT_TIME_ZONE, LOCALES, type LocaleCode } from "@/lib/i18n/locales";

export type HourCycle = "12-hour" | "24-hour";

export type FormatSettings = {
  locale: LocaleCode;
  timeZone: string;
  /** From `default_time_format`. Absent means "whatever the locale prefers". */
  hourCycle?: HourCycle;
  /** ISO 4217. Defaults to the locale's own currency. */
  currency?: string;
};

type DateShape =
  | "date"
  | "dateLong"
  | "dateShort"
  | "time"
  | "dateTime"
  | "dateTimeLong"
  | "monthDay"
  | "weekday"
  | "withZone";

/**
 * One cache for the whole app, keyed by every input that changes the output.
 *
 * Unbounded in principle, bounded in practice: the key space is
 * (locales × zones × shapes), and a session touches one or two locale/zone pairs.
 */
const dateTimeCache = new Map<string, Intl.DateTimeFormat>();
const numberCache = new Map<string, Intl.NumberFormat>();
const relativeCache = new Map<string, Intl.RelativeTimeFormat>();

function hour12From(hourCycle: HourCycle | undefined): boolean | undefined {
  if (hourCycle === "12-hour") return true;
  if (hourCycle === "24-hour") return false;
  return undefined;
}

function dateTimeOptions(shape: DateShape, settings: FormatSettings): Intl.DateTimeFormatOptions {
  const hour12 = hour12From(settings.hourCycle);
  const base: Intl.DateTimeFormatOptions = { timeZone: settings.timeZone };

  switch (shape) {
    case "date":
      return { ...base, year: "numeric", month: "short", day: "numeric" };
    case "dateLong":
      return { ...base, year: "numeric", month: "long", day: "numeric" };
    case "dateShort":
      return { ...base, year: "2-digit", month: "numeric", day: "numeric" };
    case "monthDay":
      return { ...base, month: "short", day: "numeric" };
    case "weekday":
      return { ...base, weekday: "short", month: "short", day: "numeric" };
    case "time":
      return { ...base, hour: "numeric", minute: "2-digit", hour12 };
    case "dateTime":
      return {
        ...base,
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        hour12,
      };
    case "dateTimeLong":
      return {
        ...base,
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        hour12,
      };
    case "withZone":
      return {
        ...base,
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        hour12,
        timeZoneName: "short",
      };
    default:
      return base;
  }
}

function dateTimeFormatter(shape: DateShape, settings: FormatSettings): Intl.DateTimeFormat {
  const key = `${settings.locale}|${settings.timeZone}|${settings.hourCycle ?? "-"}|${shape}`;
  const cached = dateTimeCache.get(key);
  if (cached) return cached;

  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat(settings.locale, dateTimeOptions(shape, settings));
  } catch {
    // A stored zone the runtime rejects must not take a page down. Fall back to
    // the default zone rather than to the browser's, so the failure is
    // consistent for everyone rather than different per viewer.
    formatter = new Intl.DateTimeFormat(
      settings.locale,
      dateTimeOptions(shape, { ...settings, timeZone: DEFAULT_TIME_ZONE }),
    );
  }
  dateTimeCache.set(key, formatter);
  return formatter;
}

function numberFormatter(
  settings: FormatSettings,
  options: Intl.NumberFormatOptions,
  tag: string,
): Intl.NumberFormat {
  const key = `${settings.locale}|${tag}`;
  const cached = numberCache.get(key);
  if (cached) return cached;
  const formatter = new Intl.NumberFormat(settings.locale, options);
  numberCache.set(key, formatter);
  return formatter;
}

function toDate(value: Date | string | number | null | undefined): Date | null {
  if (value === null || value === undefined || value === "") return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export type Formatters = {
  settings: FormatSettings;
  /** `Aug 19, 2026` */
  date: (value: Date | string | number | null | undefined) => string;
  /** `August 19, 2026` */
  dateLong: (value: Date | string | number | null | undefined) => string;
  /** `8/19/26` */
  dateShort: (value: Date | string | number | null | undefined) => string;
  /** `Aug 19` */
  monthDay: (value: Date | string | number | null | undefined) => string;
  /** `Wed, Aug 19` */
  weekday: (value: Date | string | number | null | undefined) => string;
  /** `7:30 PM` */
  time: (value: Date | string | number | null | undefined) => string;
  /** `Aug 19, 7:30 PM` */
  dateTime: (value: Date | string | number | null | undefined) => string;
  /** `Aug 19, 2026, 7:30 PM` */
  dateTimeLong: (value: Date | string | number | null | undefined) => string;
  /** `Aug 19, 2026, 7:30 PM CDT` — for anything a driver or a dock reads. */
  dateTimeWithZone: (value: Date | string | number | null | undefined) => string;
  /** `2h ago` / `in 3 days` */
  relative: (value: Date | string | number | null | undefined, now?: Date) => string;
  number: (value: number | null | undefined, maximumFractionDigits?: number) => string;
  integer: (value: number | null | undefined) => string;
  /** Whole units — `$1,240` / `¥1,240` */
  currency: (value: number | null | undefined, currency?: string) => string;
  /** Cents — `$12.50` */
  currencyPrecise: (value: number | null | undefined, currency?: string) => string;
  percent: (value: number | null | undefined, fractionDigits?: number) => string;
  /** Compact money for a metric tile — `$1.2M` */
  compactCurrency: (value: number | null | undefined, currency?: string) => string;
  compactNumber: (value: number | null | undefined) => string;
};

/** Shown wherever a value is absent, so an empty cell is never mistaken for a zero. */
export const EMPTY_VALUE = "—";

export function createFormatters(input: Partial<FormatSettings> = {}): Formatters {
  const settings: FormatSettings = {
    locale: input.locale ?? DEFAULT_LOCALE,
    timeZone: input.timeZone ?? DEFAULT_TIME_ZONE,
    hourCycle: input.hourCycle,
    currency: input.currency ?? LOCALES[input.locale ?? DEFAULT_LOCALE].defaultCurrency,
  };

  const shaped =
    (shape: DateShape) =>
    (value: Date | string | number | null | undefined): string => {
      const date = toDate(value);
      if (!date) return EMPTY_VALUE;
      return dateTimeFormatter(shape, settings).format(date);
    };

  const money = (
    value: number | null | undefined,
    currency: string | undefined,
    tag: string,
    options: Intl.NumberFormatOptions,
  ): string => {
    if (typeof value !== "number" || !Number.isFinite(value)) return EMPTY_VALUE;
    const code = currency ?? settings.currency ?? "USD";
    return numberFormatter(
      settings,
      { style: "currency", currency: code, ...options },
      `${tag}|${code}`,
    ).format(value);
  };

  return {
    settings,
    date: shaped("date"),
    dateLong: shaped("dateLong"),
    dateShort: shaped("dateShort"),
    monthDay: shaped("monthDay"),
    weekday: shaped("weekday"),
    time: shaped("time"),
    dateTime: shaped("dateTime"),
    dateTimeLong: shaped("dateTimeLong"),
    dateTimeWithZone: shaped("withZone"),

    /**
     * Relative time, in the caller's language.
     *
     * Uses `Intl.RelativeTimeFormat` rather than hand-built `"2h ago"`, which
     * cannot be translated and gets plurals wrong in most languages. Note that
     * the *unit* choice below is a display decision and stays here; only the
     * wording comes from Intl.
     */
    relative: (value, now = new Date()) => {
      const date = toDate(value);
      if (!date) return EMPTY_VALUE;

      const key = settings.locale;
      let formatter = relativeCache.get(key);
      if (!formatter) {
        formatter = new Intl.RelativeTimeFormat(settings.locale, { numeric: "auto" });
        relativeCache.set(key, formatter);
      }

      const seconds = Math.round((date.getTime() - now.getTime()) / 1000);
      const magnitude = Math.abs(seconds);
      if (magnitude < 45) return formatter.format(0, "second");
      if (magnitude < 3600) return formatter.format(Math.round(seconds / 60), "minute");
      if (magnitude < 86_400) return formatter.format(Math.round(seconds / 3600), "hour");
      if (magnitude < 2_592_000) return formatter.format(Math.round(seconds / 86_400), "day");
      if (magnitude < 31_536_000) return formatter.format(Math.round(seconds / 2_592_000), "month");
      return formatter.format(Math.round(seconds / 31_536_000), "year");
    },

    number: (value, maximumFractionDigits = 3) => {
      if (typeof value !== "number" || !Number.isFinite(value)) return EMPTY_VALUE;
      return numberFormatter(
        settings,
        { maximumFractionDigits },
        `num|${maximumFractionDigits}`,
      ).format(value);
    },

    integer: (value) => {
      if (typeof value !== "number" || !Number.isFinite(value)) return EMPTY_VALUE;
      return numberFormatter(settings, { maximumFractionDigits: 0 }, "int").format(value);
    },

    currency: (value, currency) => money(value, currency, "cur0", { maximumFractionDigits: 0 }),

    currencyPrecise: (value, currency) =>
      money(value, currency, "cur2", { minimumFractionDigits: 2, maximumFractionDigits: 2 }),

    percent: (value, fractionDigits = 0) => {
      if (typeof value !== "number" || !Number.isFinite(value)) return EMPTY_VALUE;
      return numberFormatter(
        settings,
        {
          style: "percent",
          minimumFractionDigits: fractionDigits,
          maximumFractionDigits: fractionDigits,
        },
        `pct|${fractionDigits}`,
      ).format(value);
    },

    compactCurrency: (value, currency) =>
      money(value, currency, "curCompact", {
        notation: "compact",
        maximumFractionDigits: 1,
      }),

    compactNumber: (value) => {
      if (typeof value !== "number" || !Number.isFinite(value)) return EMPTY_VALUE;
      return numberFormatter(
        settings,
        { notation: "compact", maximumFractionDigits: 1 },
        "numCompact",
      ).format(value);
    },
  };
}

/**
 * Formatters for the default locale and zone.
 *
 * For module-scope code that runs outside React and has no access to the
 * provider. Prefer `useFormat()` in a component — this one does not follow the
 * user's setting, which is the whole point of the feature.
 */
export const defaultFormatters = createFormatters();

/** Test seam. The caches are process-wide and would otherwise leak between cases. */
export function resetFormatterCachesForTests() {
  dateTimeCache.clear();
  numberCache.clear();
  relativeCache.clear();
}
