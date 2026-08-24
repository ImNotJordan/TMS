/**
 * UI strings, by locale.
 *
 * ## Scope, stated plainly
 *
 * This covers the application *shell* and the Settings surfaces that configure
 * language and time zone — the sidebar, the topbar, the settings chrome, and the
 * verbs that appear on every page. It does **not** cover the body copy of the
 * operational modules (Loads, Bidding, Admin, Accounting and friends run to tens
 * of thousands of lines of English prose). Those keep rendering English, which
 * is ordinary i18n fallback behaviour rather than a defect: a partially
 * translated app is the normal state of every app that has ever been
 * translated, and the alternative — machine-translating freight terminology
 * unreviewed — produces text a Chinese dispatcher trusts less than the English.
 *
 * Formatting is a different matter and is complete: every date, time, number and
 * currency that goes through `useFormat()` follows the selected locale and zone
 * everywhere, translated or not.
 *
 * ## Adding a key
 *
 * Add it to `en-US` first. `TranslationKey` is derived from that object, so
 * TypeScript then reports the same key missing from every other locale — the
 * dictionaries cannot silently drift apart.
 */
import { DEFAULT_LOCALE, LOCALE_CODES, type LocaleCode } from "@/lib/i18n/locales";
import { lookupPhrase } from "@/lib/i18n/phrases";

const EN = {
  // ---- Navigation groups -------------------------------------------------
  "nav.group.Operations": "Operations",
  "nav.group.Commercial": "Commercial",
  "nav.group.Insights": "Insights",
  "nav.group.Workspace": "Workspace",

  // ---- Navigation items --------------------------------------------------
  // Keyed by the canonical module name, never by the translated label: RBAC
  // matches `NavItem.title` against `MODULES`, so translating the title itself
  // would silently un-gate every module. See `navItemToModule` in rbac.ts.
  "nav.item.Dashboard": "Dashboard",
  "nav.item.Loads": "Loads",
  "nav.item.TruckBoard": "TruckBoard",
  "nav.item.Inventory": "Inventory",
  "nav.item.Tracking": "Tracking",
  "nav.item.Bidding": "Bidding",
  "nav.item.RFPs": "RFPs",
  "nav.item.Quotes": "Quotes",
  "nav.item.Carriers / Brokers": "Carriers / Brokers",
  "nav.item.CRM & Sales": "CRM & Sales",
  "nav.item.Risk Models": "Risk Models",
  "nav.item.Analytics": "Analytics",
  "nav.item.Accounting": "Accounting",
  "nav.item.Communications": "Communications",
  "nav.item.Settings": "Settings",
  "nav.item.Admin": "Admin",
  "nav.item.Profile": "Profile",

  // ---- Shell -------------------------------------------------------------
  "shell.appName": "Logistics Software",
  "shell.appTagline": "Operations Console",
  "shell.signedIn": "Signed in",
  "shell.loading": "Loading…",
  "shell.signOut": "Sign out",
  "shell.search": "Search",
  "shell.notifications": "Notifications",

  // ---- Common actions ----------------------------------------------------
  "action.save": "Save",
  "action.saveChanges": "Save changes",
  "action.cancel": "Cancel",
  "action.close": "Close",
  "action.refresh": "Refresh",
  "action.export": "Export",
  "action.create": "Create",
  "action.edit": "Edit",
  "action.delete": "Delete",
  "action.search": "Search",
  "action.clear": "Clear",
  "action.filters": "Filters",
  "action.reset": "Reset",
  "action.retry": "Try again",

  // ---- Common state ------------------------------------------------------
  "state.loading": "Loading…",
  "state.saving": "Saving…",
  "state.saved": "Saved",
  "state.never": "Never",
  "state.justNow": "Just now",
  "state.noResults": "No results",
  "state.readOnly": "Read-only",

  // ---- Settings shell ----------------------------------------------------
  "settings.title": "Settings",
  "settings.description": "Workspace configuration, defaults, and integrations.",
  "settings.category.general": "General",
  "settings.unsaved": "Unsaved changes",
  "settings.lastSaved": "Last saved",

  // ---- Locale & time zone fields ----------------------------------------
  "locale.field.language": "Language",
  "locale.field.languageHelp":
    "Sets the interface language and how dates, numbers and currency are written.",
  "locale.field.timeZone": "Time Zone",
  "locale.field.timeZoneHelp":
    "Every timestamp in the app is shown in this zone. Stored times are unchanged.",
  "locale.field.personalLanguage": "My Language",
  "locale.field.personalTimeZone": "My Time Zone",
  "locale.personalOverrides": "Your personal choice overrides the workspace default.",
  "locale.usingWorkspaceDefault": "Using the workspace default",
  "locale.detected": "Detected",
  "locale.useDetected": "Use detected",
  "locale.followWorkspace": "Follow workspace default",
  "locale.currentTime": "Current time",

  "timezone.group.americas": "Americas",
  "timezone.group.asiaPacific": "Asia-Pacific",
  "timezone.group.europe": "Europe",
  "timezone.group.utc": "Universal",

  // ---- Live preview card -------------------------------------------------
  "locale.preview.title": "Live preview",
  "locale.preview.description": "How this workspace will render dates, times and money once saved.",
  "locale.preview.dateTime": "Date & time",
  "locale.preview.withZone": "With zone",
  "locale.preview.relative": "Relative",
  "locale.preview.number": "Number",
  "locale.preview.currency": "Currency",
  "locale.preview.appliesNow": "Applied across the app as soon as you save.",
  "locale.preview.sampleLabel": "Sample instant",
} as const;

export type TranslationKey = keyof typeof EN;

/**
 * Every locale must supply every key.
 *
 * `Record<TranslationKey, string>` rather than `Partial<...>` on purpose: a
 * missing key should be a type error at the moment it is added, not a stray
 * English word discovered in a screenshot.
 */
export type Dictionary = Record<TranslationKey, string>;

const ZH: Dictionary = {
  "nav.group.Operations": "运营",
  "nav.group.Commercial": "商务",
  "nav.group.Insights": "分析洞察",
  "nav.group.Workspace": "工作区",

  "nav.item.Dashboard": "仪表板",
  "nav.item.Loads": "货运订单",
  "nav.item.TruckBoard": "车源看板",
  "nav.item.Inventory": "库存管理",
  "nav.item.Tracking": "在途跟踪",
  "nav.item.Bidding": "报价竞标",
  "nav.item.RFPs": "招标书",
  "nav.item.Quotes": "报价单",
  "nav.item.Carriers / Brokers": "承运商 / 经纪商",
  "nav.item.CRM & Sales": "客户关系与销售",
  "nav.item.Risk Models": "风险模型",
  "nav.item.Analytics": "数据分析",
  "nav.item.Accounting": "财务核算",
  "nav.item.Communications": "沟通中心",
  "nav.item.Settings": "设置",
  "nav.item.Admin": "管理后台",
  "nav.item.Profile": "个人资料",

  "shell.appName": "物流管理系统",
  "shell.appTagline": "运营控制台",
  "shell.signedIn": "已登录",
  "shell.loading": "加载中…",
  "shell.signOut": "退出登录",
  "shell.search": "搜索",
  "shell.notifications": "通知",

  "action.save": "保存",
  "action.saveChanges": "保存更改",
  "action.cancel": "取消",
  "action.close": "关闭",
  "action.refresh": "刷新",
  "action.export": "导出",
  "action.create": "新建",
  "action.edit": "编辑",
  "action.delete": "删除",
  "action.search": "搜索",
  "action.clear": "清除",
  "action.filters": "筛选",
  "action.reset": "重置",
  "action.retry": "重试",

  "state.loading": "加载中…",
  "state.saving": "保存中…",
  "state.saved": "已保存",
  "state.never": "从未",
  "state.justNow": "刚刚",
  "state.noResults": "暂无结果",
  "state.readOnly": "只读",

  "settings.title": "设置",
  "settings.description": "工作区配置、默认值与集成。",
  "settings.category.general": "通用",
  "settings.unsaved": "有未保存的更改",
  "settings.lastSaved": "上次保存",

  "locale.field.language": "语言",
  "locale.field.languageHelp": "设置界面语言，以及日期、数字和货币的书写方式。",
  "locale.field.timeZone": "时区",
  "locale.field.timeZoneHelp": "应用内所有时间均按此时区显示，存储的时间不会改变。",
  "locale.field.personalLanguage": "我的语言",
  "locale.field.personalTimeZone": "我的时区",
  "locale.personalOverrides": "您的个人设置将覆盖工作区默认值。",
  "locale.usingWorkspaceDefault": "正在使用工作区默认值",
  "locale.detected": "已检测到",
  "locale.useDetected": "使用检测结果",
  "locale.followWorkspace": "跟随工作区默认值",
  "locale.currentTime": "当前时间",

  "timezone.group.americas": "美洲",
  "timezone.group.asiaPacific": "亚太地区",
  "timezone.group.europe": "欧洲",
  "timezone.group.utc": "世界标准时间",

  "locale.preview.title": "实时预览",
  "locale.preview.description": "保存后，工作区将按以下方式显示日期、时间和金额。",
  "locale.preview.dateTime": "日期与时间",
  "locale.preview.withZone": "含时区",
  "locale.preview.relative": "相对时间",
  "locale.preview.number": "数字",
  "locale.preview.currency": "货币",
  "locale.preview.appliesNow": "保存后立即在全应用生效。",
  "locale.preview.sampleLabel": "示例时刻",
};

export const DICTIONARIES: Record<LocaleCode, Dictionary> = {
  "en-US": EN,
  "zh-CN": ZH,
};

/**
 * Accepts a symbolic key *or* an English phrase.
 *
 * The union is deliberate. Hand-written call sites use symbolic keys
 * (`action.save`); the ~2,800 codemod-wrapped sites pass the English string
 * itself. One translator serving both means `useT()` and the module-scope `t`
 * cannot disagree about what a string resolves to.
 */
export type Translate = (key: TranslationKey | (string & {}), fallback?: string) => string;

/**
 * Build a lookup for a locale.
 *
 * Resolution: keyed dictionary, then the phrase table, then English, then the
 * input itself — so a missing string degrades to readable text rather than to
 * `undefined` on screen.
 */
export function createTranslator(locale: LocaleCode): Translate {
  const dictionary = DICTIONARIES[locale] ?? DICTIONARIES[DEFAULT_LOCALE];
  const base = DICTIONARIES[DEFAULT_LOCALE];
  return (key, fallback) => {
    const keyed = dictionary[key as TranslationKey] ?? base[key as TranslationKey];
    if (keyed !== undefined) return keyed;
    const phrase = lookupPhrase(locale, key);
    if (phrase !== undefined) return phrase;
    return fallback ?? key;
  };
}

/** Translated label for a nav item, keyed by its canonical (untranslated) title. */
export function navItemLabel(t: Translate, canonicalTitle: string): string {
  return t(`nav.item.${canonicalTitle}` as TranslationKey, canonicalTitle);
}

/** Translated label for a nav group. */
export function navGroupLabel(t: Translate, group: string): string {
  return t(`nav.group.${group}` as TranslationKey, group);
}

/** Guard used by the dictionary test to prove no locale is missing a key. */
export function dictionaryKeys(): TranslationKey[] {
  return Object.keys(EN) as TranslationKey[];
}

export { LOCALE_CODES };
