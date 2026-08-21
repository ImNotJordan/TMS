/**
 * WorkspaceSettings partition keys.
 *
 * Split deliberately: DynamoDB IAM conditions (`dynamodb:LeadingKeys`) match the
 * **partition key** only, so anything that must be denied to the browser needs
 * its own partition rather than a separate sort key under the tenant.
 *
 * - `<companyId>` — that company's non-secret config (Google Maps key, which the
 *   Maps JS SDK loads in the page and therefore cannot be secret; feature flags;
 *   invoice prefixes). The browser Identity Pool can still GetItem any partition
 *   it is allowed; the application never asks for another company's row, and
 *   never falls back to a shared one.
 * - `secrets` — server-only. Denied to the browser's Identity Pool role.
 *   Sort key is `<companyId>#<kind>` so company A's OpenAI key cannot answer
 *   company B's request. IAM still denies the whole `secrets` partition; the
 *   company lives in the sort key because LeadingKeys cannot match it.
 *
 * The historical partitions `global` and unscoped `secrets` / `openai` were a
 * single row every tenant shared. They are leftover data, not a read path.
 *
 * Own module so the settings endpoints and the key reader can share them
 * without importing each other.
 */
export const SECRETS_SCOPE = "secrets";

/**
 * Pre-tenant partition. Kept as a name so a migration script can copy it onto
 * one company. Application reads must not use this — that was the leak.
 */
export const LEGACY_GLOBAL_SETTINGS_SCOPE = "global";

/** @deprecated Alias of `LEGACY_GLOBAL_SETTINGS_SCOPE`. Do not read this row. */
export const GLOBAL_SETTINGS_SCOPE = LEGACY_GLOBAL_SETTINGS_SCOPE;

/** Kind suffixes stored as `secrets` sort keys: `<companyId>#openai`. */
export const OPENAI_SECRET_SECTION = "openai";
export const AVALARA_SECRET_SECTION = "avalara";
export const CHINA_TAX_SECRET_SECTION = "chinaTax";
export const RESEND_SECRET_SECTION = "resend";

const RESERVED_SETTINGS_SCOPES = new Set([
  LEGACY_GLOBAL_SETTINGS_SCOPE,
  SECRETS_SCOPE,
  "ai-rl",
  "ai-usage",
]);

/**
 * Partition key for a company's non-secret settings.
 *
 * Refuses empty and reserved names so a bug cannot write tenant data into the
 * legacy shared row or the secrets partition.
 */
export function companySettingsScope(companyId: string): string {
  const id = companyId.trim();
  if (!id) {
    throw new Error("Company settings require a company id.");
  }
  if (RESERVED_SETTINGS_SCOPES.has(id)) {
    throw new Error("Company settings cannot use a reserved partition.");
  }
  return id;
}

/**
 * Sort key for a server-only credential belonging to one company.
 *
 * `secrets` stays the partition so the existing Identity Pool deny still
 * matches. The company is in the sort key: LeadingKeys cannot see it, and
 * putting company in the partition would have required a new IAM deny for
 * every tenant.
 */
export function companySecretSection(companyId: string, kind: string): string {
  const id = companySettingsScope(companyId);
  const suffix = kind.trim();
  if (!suffix || suffix.includes("#")) {
    throw new Error("Invalid secret kind.");
  }
  return `${id}#${suffix}`;
}

export function companySecretKey(
  companyId: string,
  kind: string,
): { scope: typeof SECRETS_SCOPE; section: string } {
  return { scope: SECRETS_SCOPE, section: companySecretSection(companyId, kind) };
}
