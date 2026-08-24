/**
 * The provider that turns the Settings choice into observable behaviour.
 *
 * Resolution order, most specific first:
 *
 *   1. the workspace's `default_language` / `default_time_zone`
 *   2. the viewer's browser time zone, for the zone only
 *   3. `DEFAULT_LOCALE` / `DEFAULT_TIME_ZONE`
 *
 * Step 2 exists so a workspace that has never opened Settings still renders
 * sensible local times rather than Central for a viewer in Shanghai. It applies
 * only to the zone: guessing the *language* from the browser would flip the
 * whole UI for a colleague travelling, which is worse than showing English.
 *
 * A per-user override belongs above step 1 and is deliberately not wired yet —
 * `personal_time_zone` and `personal_language` are currently stored in the
 * shared `appSettings` record, so honouring them would let one user's choice
 * change everyone's. Doing it properly means moving them to the Profile
 * `preferences` section; the hook below is where that override would slot in.
 *
 * ## Applying without a reload
 *
 * `saveAppSettingsToDynamo` dispatches `APP_SETTINGS_CHANGED`. Listening for it
 * here is what makes the dropdown feel like a setting rather than a form field:
 * save, and every timestamp on screen re-renders in the new zone immediately.
 *
 * ## Why this reads Dynamo directly rather than through `useAppSettings`
 *
 * That hook is built for the Settings page — it takes the full defaults object,
 * tracks dirty state, and writes the shared `appSettings` cache. Calling it here
 * with a four-key defaults object would overwrite that cache with four keys and
 * break every other consumer of `getAppSettingString`. So this reads the record
 * and touches nothing global.
 */
import * as React from "react";

import { APP_SETTINGS_CHANGED } from "@/lib/app-settings-store";
import { isWorkspaceSettingsConfigured } from "@/lib/dynamodb";
import { getWorkspaceSetting } from "@/lib/workspace-settings-store";
import { createFormatters, type Formatters, type HourCycle } from "@/lib/i18n/format";
import { setActiveLocale } from "@/lib/i18n/t";
import {
  createTranslator,
  navGroupLabel,
  navItemLabel,
  type Translate,
} from "@/lib/i18n/dictionary";
import {
  DEFAULT_LOCALE,
  DEFAULT_TIME_ZONE,
  LOCALES,
  detectTimeZone,
  resolveLocale,
  resolveTimeZone,
  type LocaleCode,
} from "@/lib/i18n/locales";

/** The subset of `appSettings` this provider cares about. */
export type LocaleSettingsInput = {
  default_language?: unknown;
  default_time_zone?: unknown;
  default_time_format?: unknown;
  default_currency?: unknown;
};

export type ResolvedLocale = {
  locale: LocaleCode;
  timeZone: string;
  hourCycle: HourCycle | undefined;
  currency: string;
  /** True when the zone came from the browser because the workspace had none. */
  timeZoneFromBrowser: boolean;
};

function hourCycleFrom(value: unknown): HourCycle | undefined {
  if (value === "24-hour" || value === "12-hour") return value;
  return undefined;
}

/**
 * Pure resolution, exported so it can be tested without mounting React and
 * reused by any non-component caller.
 */
export function resolveLocaleSettings(
  settings: LocaleSettingsInput | null | undefined,
  browserTimeZone?: string,
): ResolvedLocale {
  const locale = resolveLocale(settings?.default_language, DEFAULT_LOCALE);

  const configuredZone =
    typeof settings?.default_time_zone === "string" && settings.default_time_zone.trim()
      ? settings.default_time_zone.trim()
      : null;

  const fallbackZone = browserTimeZone?.trim() || DEFAULT_TIME_ZONE;
  const timeZone = resolveTimeZone(configuredZone ?? fallbackZone, DEFAULT_TIME_ZONE);

  const currency =
    typeof settings?.default_currency === "string" && settings.default_currency.trim()
      ? settings.default_currency.trim()
      : LOCALES[locale].defaultCurrency;

  return {
    locale,
    timeZone,
    hourCycle: hourCycleFrom(settings?.default_time_format),
    currency,
    timeZoneFromBrowser: configuredZone === null,
  };
}

export type LocaleContextValue = ResolvedLocale & {
  /** True until the workspace record has been read once. */
  loading: boolean;
  t: Translate;
  format: Formatters;
  /** Translated nav label for a canonical (untranslated) module title. */
  navLabel: (canonicalTitle: string) => string;
  navGroup: (group: string) => string;
  /** Re-read the workspace record. */
  refresh: () => void;
};

const FALLBACK: LocaleContextValue = {
  ...resolveLocaleSettings(null, DEFAULT_TIME_ZONE),
  loading: false,
  t: createTranslator(DEFAULT_LOCALE),
  format: createFormatters(),
  navLabel: (title) => title,
  navGroup: (group) => group,
  refresh: () => {},
};

const LocaleContext = React.createContext<LocaleContextValue>(FALLBACK);

export function LocaleProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = React.useState<LocaleSettingsInput | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [generation, setGeneration] = React.useState(0);

  // Read once on the client. `detectTimeZone` touches Intl, which resolves to
  // UTC during SSR — held in state so the first client render corrects it
  // without the server and client disagreeing on markup.
  const [browserTimeZone, setBrowserTimeZone] = React.useState<string>(DEFAULT_TIME_ZONE);
  React.useEffect(() => {
    setBrowserTimeZone(detectTimeZone());
  }, []);

  React.useEffect(() => {
    if (!isWorkspaceSettingsConfigured()) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    void getWorkspaceSetting<Record<string, unknown>>("appSettings")
      .then(({ data }) => {
        if (cancelled) return;
        setSettings((data ?? null) as LocaleSettingsInput | null);
      })
      .catch(() => {
        // A settings read failure must not blank the app — the defaults below
        // are a working configuration, not an error state.
        if (!cancelled) setSettings(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [generation]);

  // Saving in Settings re-reads immediately, so the change is visible without a
  // reload.
  React.useEffect(() => {
    if (typeof window === "undefined") return;
    const onChanged = () => setGeneration((value) => value + 1);
    window.addEventListener(APP_SETTINGS_CHANGED, onChanged);
    return () => window.removeEventListener(APP_SETTINGS_CHANGED, onChanged);
  }, []);

  const resolved = React.useMemo(
    () => resolveLocaleSettings(settings, browserTimeZone),
    [browserTimeZone, settings],
  );

  // `lang` drives font fallback, hyphenation and screen-reader pronunciation, so
  // a Chinese UI announced as English is a real accessibility defect rather than
  // a cosmetic one.
  React.useEffect(() => {
    if (typeof document === "undefined") return;
    document.documentElement.lang = resolved.locale;
  }, [resolved.locale]);

  // Set during render, not in an effect: the module-scope `t` used by ~2,800
  // wrapped call sites is read while children render, so an effect would paint
  // one frame in the previous language.
  setActiveLocale(resolved.locale);

  const value = React.useMemo<LocaleContextValue>(() => {
    const t = createTranslator(resolved.locale);
    return {
      ...resolved,
      loading,
      t,
      format: createFormatters({
        locale: resolved.locale,
        timeZone: resolved.timeZone,
        hourCycle: resolved.hourCycle,
        currency: resolved.currency,
      }),
      navLabel: (canonicalTitle: string) => navItemLabel(t, canonicalTitle),
      navGroup: (group: string) => navGroupLabel(t, group),
      refresh: () => setGeneration((current) => current + 1),
    };
  }, [loading, resolved]);

  return (
    <LocaleContext.Provider value={value}>
      {/*
        Keyed on the locale so a language change remounts the subtree.

        This is what makes the module-scope `t` correct: it is not reactive, so
        without a remount the ~2,800 wrapped strings would keep their previous
        language until something else happened to re-render them. Keying here
        re-evaluates all of them at once.

        Two consequences worth naming. Switching language discards transient
        component state — an open dialog closes, a scroll position resets — which
        is acceptable for a deliberate, rare action. And the workspace record
        arriving on boot counts as a change, so a workspace configured for
        Chinese remounts once during startup, while the auth gate is still
        showing its loader.

        Time zone is deliberately *not* in the key: every zone-sensitive render
        goes through `useFormat()`, which is a context consumer and re-renders on
        its own.
      */}
      <React.Fragment key={resolved.locale}>{children}</React.Fragment>
    </LocaleContext.Provider>
  );
}

export function useLocaleSettings(): LocaleContextValue {
  return React.useContext(LocaleContext);
}

/** Just the translator, for components that render text and no data. */
export function useT(): Translate {
  return React.useContext(LocaleContext).t;
}

/**
 * Locale- and zone-aware formatters.
 *
 * Prefer this over `toLocaleString` anywhere a user sees the result. A bare
 * `toLocaleString` renders in the viewer's own zone, which for a workspace
 * operating between the US and China is the one zone guaranteed to be wrong for
 * somebody.
 */
export function useFormat(): Formatters {
  return React.useContext(LocaleContext).format;
}
