import { getWorkspaceSetting, putWorkspaceSetting } from "@/lib/workspace-settings-store";
import { peekCompanyContext } from "@/lib/tenant/company-context";

export type AppSettingValue = string | boolean;
export type AppSettingsData = Record<string, AppSettingValue>;

/** Fired when app settings are saved so other pages (e.g. Communications) can refresh. */
export const APP_SETTINGS_CHANGED = "titan:app-settings-changed";

/** In-memory cache so domain stores can read prefixes without an extra round-trip mid-request. */
let cachedAppSettings: AppSettingsData | null = null;
let cachedForCompany: string | null = null;

export function peekAppSettingsCache(): AppSettingsData | null {
  return cachedAppSettings;
}

export function setAppSettingsCache(settings: AppSettingsData, companyId?: string) {
  cachedAppSettings = settings;
  cachedForCompany = companyId?.trim() || cachedForCompany;
}

export function clearAppSettingsCache() {
  cachedAppSettings = null;
  cachedForCompany = null;
}

export function getAppSettingString(
  key: string,
  fallback: string,
  settings?: AppSettingsData | null,
): string {
  const source = settings ?? cachedAppSettings;
  const raw = source?.[key];
  if (typeof raw === "string" && raw.trim()) return raw.trim();
  return fallback;
}

export function getAppSettingBool(
  key: string,
  fallback: boolean,
  settings?: AppSettingsData | null,
): boolean {
  const source = settings ?? cachedAppSettings;
  const raw = source?.[key];
  if (typeof raw === "boolean") return raw;
  return fallback;
}

export function mergeAppSettings(defaults: AppSettingsData, partial: unknown): AppSettingsData {
  const merged = { ...defaults };
  if (!partial || typeof partial !== "object") return merged;

  for (const [key, raw] of Object.entries(partial as Record<string, unknown>)) {
    if (!(key in defaults)) continue;
    const defaultValue = defaults[key];
    if (typeof defaultValue === "boolean") {
      if (typeof raw === "boolean") merged[key] = raw;
      else if (raw === "true") merged[key] = true;
      else if (raw === "false") merged[key] = false;
    } else if (typeof defaultValue === "string") {
      if (typeof raw === "string") merged[key] = raw;
      else if (typeof raw === "number" || typeof raw === "boolean") merged[key] = String(raw);
    }
  }

  return merged;
}

export async function loadAppSettingsFromDynamo(defaults: AppSettingsData) {
  const { data, updatedAt } = await getWorkspaceSetting<AppSettingsData>("appSettings");
  const companyId = peekCompanyContext()?.companyId;
  // Union with whatever is already cached so a Settings subset load (Integrations)
  // cannot drop keys another page already hydrated (tax, invoice prefixes, DAT).
  const whitelist = { ...(cachedAppSettings ?? {}), ...defaults };
  if (data) {
    const settings = mergeAppSettings(whitelist, data);
    setAppSettingsCache(settings, companyId);
    return { settings, updatedAt };
  }
  const settings = mergeAppSettings(whitelist, {});
  setAppSettingsCache(settings, companyId);
  return { settings, updatedAt: null as string | null };
}

export async function saveAppSettingsToDynamo(settings: AppSettingsData) {
  await putWorkspaceSetting("appSettings", settings);
  setAppSettingsCache(settings, peekCompanyContext()?.companyId);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(APP_SETTINGS_CHANGED));
  }
}

/** Lightweight read for domain modules (Accounting, Loads). */
export async function ensureAppSettingsCache(defaults?: AppSettingsData) {
  const companyId = peekCompanyContext()?.companyId ?? null;
  const incoming = defaults ?? {
    invoice_number_prefix: "INV-",
    load_number_prefix: "LD-",
    require_pod_before_invoice: true,
    auto_generate_invoice_numbers: true,
  };
  if (cachedAppSettings && cachedForCompany && cachedForCompany === companyId) {
    const missing = Object.keys(incoming).some((key) => !(key in cachedAppSettings!));
    if (!missing) return cachedAppSettings;
  }
  const whitelist = { ...(cachedAppSettings ?? {}), ...incoming };
  try {
    const { data } = await getWorkspaceSetting<AppSettingsData>("appSettings");
    const settings = mergeAppSettings(whitelist, data ?? {});
    setAppSettingsCache(settings, peekCompanyContext()?.companyId);
    return settings;
  } catch {
    setAppSettingsCache(whitelist, companyId ?? undefined);
    return whitelist;
  }
}
