/**
 * The module-scope translator every wrapped string calls.
 *
 * ## Why this is not a hook
 *
 * 2,786 call sites across 88 files were wrapped by `scripts/i18n-wrap.mjs`. A
 * hook-based `t` would have required the codemod to also inject `const t =
 * useT()` into the correct function component at each site — inferring component
 * boundaries, respecting the rules of hooks, and handling the many strings that
 * live in module-level helpers rather than components. That is a codemod that
 * gets it wrong somewhere in 88 files, and the failure mode is a runtime hook
 * error in production.
 *
 * A module-scope function has none of those problems: the codemod adds one
 * import per file and rewrites expressions in place. It works identically inside
 * components, inside helpers, and inside plain functions.
 *
 * ## What that costs, and how it is paid
 *
 * A module-scope read is not reactive: changing the language does not, by
 * itself, re-render anything. `LocaleProvider` closes that by keying its subtree
 * on the active locale, so a language change remounts the tree and every
 * `t(...)` is re-evaluated. Switching language is a rare, deliberate act, and a
 * remount is both correct and cheap for it — far cheaper than 2,786 subscriptions.
 *
 * `useT()` still exists and returns an equivalent translator, for components
 * that would rather subscribe.
 *
 * ## Phrase keys, not symbolic keys
 *
 * `t("Save changes")` — the English string *is* the key. Two reasons:
 *
 * 1. The codemod does not have to invent 2,000 unique names, and a reviewer can
 *    read the diff without a dictionary open beside it.
 * 2. It makes runtime values translatable. `t(row.status)` translates a stored
 *    `"Active"` for display while the value in DynamoDB stays `"Active"` — which
 *    is the only reason this retrofit is safe at all. See the codemod header.
 *
 * A missing translation returns the English unchanged, so an incomplete
 * dictionary degrades to a partly-English UI rather than to blank labels.
 */
import { DEFAULT_LOCALE, type LocaleCode } from "@/lib/i18n/locales";
import { lookupPhrase } from "@/lib/i18n/phrases";
import { DICTIONARIES, type Dictionary, type TranslationKey } from "@/lib/i18n/dictionary";

let activeLocale: LocaleCode = DEFAULT_LOCALE;
let activeKeyed: Dictionary = DICTIONARIES[DEFAULT_LOCALE];

/**
 * Point the module-scope translator at a locale.
 *
 * Called by `LocaleProvider` during render, before children paint, so the first
 * frame after a change is already in the new language.
 */
export function setActiveLocale(locale: LocaleCode): void {
  activeLocale = locale;
  activeKeyed = DICTIONARIES[locale] ?? DICTIONARIES[DEFAULT_LOCALE];
}

export function getActiveLocale(): LocaleCode {
  return activeLocale;
}

/**
 * Translate a symbolic key or an English phrase.
 *
 * Resolution order:
 *   1. the keyed dictionary (`nav.item.Loads`, `action.save`, …)
 *   2. the phrase table (`"Save changes"`)
 *   3. the input, unchanged
 *
 * @param input A `TranslationKey`, or any English phrase.
 * @param fallback Returned instead of `input` when nothing matches.
 */
export function translate(locale: LocaleCode, input: string, fallback?: string): string {
  if (typeof input !== "string" || input === "") return fallback ?? input;

  const keyed = DICTIONARIES[locale] ?? DICTIONARIES[DEFAULT_LOCALE];
  const byKey = keyed[input as TranslationKey];
  if (byKey !== undefined) return byKey;

  const byPhrase = lookupPhrase(locale, input);
  if (byPhrase !== undefined) return byPhrase;

  return fallback ?? input;
}

/**
 * The translator the wrapped call sites use.
 *
 * Deliberately tolerant of a non-string argument: a wrapped expression that
 * turns out to be `undefined` at runtime should render nothing, not crash a page.
 */
export function t(input: string, fallback?: string): string {
  if (activeLocale === DEFAULT_LOCALE) {
    // Fast path. English needs no lookup unless the string is a symbolic key,
    // which only the hand-written call sites use.
    const byKey = activeKeyed[input as TranslationKey];
    return byKey ?? fallback ?? input;
  }
  return translate(activeLocale, input, fallback);
}
