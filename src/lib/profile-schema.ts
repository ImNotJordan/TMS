/**
 * Profile vocabulary shared by the client and the server endpoint.
 *
 * Kept apart from `profile-store.ts` because that module is now an HTTP client
 * and the server must not import it. Everything here is pure data and pure
 * functions — no transport, no AWS SDK — so both sides can hold the same
 * definition rather than two copies that drift.
 *
 * The sanitizer in particular has to exist on the server. It used to run only
 * in the browser, where it was an accident guard rather than a boundary: the
 * browser held DynamoDB credentials, so a determined caller skipped it with a
 * raw `PutItem`. Running it behind the endpoint is what makes it real.
 */

export type SectionKey =
  | "personal"
  | "preferences"
  | "notifications"
  | "security"
  | "permissions"
  | "documents"
  | "integrations"
  | "company";

export const SECTION_KEYS: ReadonlySet<string> = new Set<SectionKey>([
  "personal",
  "preferences",
  "notifications",
  "security",
  "permissions",
  "documents",
  "integrations",
  "company",
]);

export function isSectionKey(value: unknown): value is SectionKey {
  return typeof value === "string" && SECTION_KEYS.has(value);
}

export type ProfileItem<T> = {
  userId: string;
  section: SectionKey;
  data: T;
  updatedAt: string;
};

export type SectionLoadResult<T> = {
  data: T | null;
  updatedAt: string | null;
};

export type SanitizedSectionPayload = {
  data: Record<string, unknown>;
  /** Privileged keys the caller tried to write. Empty on a normal save. */
  rejected: string[];
};

/**
 * Fields inside the `permissions` section that confer privilege.
 *
 * `rbac.ts` reads `role`, `adminAccess` and `modulePermissions` to decide what a
 * user may see and do, so anything that can write them is a privilege-escalation
 * path. They are administered on another user's behalf, never self-served.
 *
 * `companyId`/`companyName` are here for the same reason: the company is the
 * tenant key every record is stamped and filtered by, so a user who could set
 * their own would be choosing whose data they see.
 *
 * `employerCompanyId` joins them because it decides which company's directory a
 * Driver appears in — self-serving that would let a driver place themselves on
 * any roster.
 */
export const PRIVILEGED_PERMISSION_FIELDS: ReadonlySet<string> = new Set([
  "role",
  "adminAccess",
  "accessLevel",
  "permissionGroup",
  "dataAccessScope",
  "modulePermissions",
  "fieldPermissions",
  "companyId",
  "companyName",
  "employerCompanyId",
  "employerCompanyName",
  "sessionEpoch",
]);

/**
 * Strip privilege-bearing fields from a self-service profile write.
 *
 * Rejected rather than silently dropped: a save that carries `role` is either a
 * UI wiring mistake or an escalation attempt, and both need to be visible.
 */
export function sanitizeSelfServiceSection(
  section: SectionKey,
  data: Record<string, unknown>,
): SanitizedSectionPayload {
  if (section !== "permissions") return { data, rejected: [] };

  const sanitized: Record<string, unknown> = {};
  const rejected: string[] = [];
  for (const [key, value] of Object.entries(data)) {
    if (PRIVILEGED_PERMISSION_FIELDS.has(key)) rejected.push(key);
    else sanitized[key] = value;
  }
  return { data: sanitized, rejected };
}
