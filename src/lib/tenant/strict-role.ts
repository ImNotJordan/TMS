/**
 * Strict role resolution for authorization decisions.
 *
 * `normalizeRole` in admin-user-constants is a *display* helper: it infers
 * fuzzily and, when nothing matches, returns `"Operations Manager"`. That is
 * right for rendering a label and wrong for deciding access. Fed an unexpected
 * value it will happily invent a staff role:
 *
 *     normalizeRole("everyone")        → "Operations Manager"
 *     normalizeRole("readonly-admin")  → "Admin"
 *     normalizeRole("")                → "Operations Manager"
 *
 * A Cognito group name or a stored string that reaches an authorization check
 * must never be widened like that. This resolver accepts only exact matches —
 * the canonical role labels and the storage keys the app itself writes — and
 * returns `null` for anything else. An unrecognized role is no role.
 */
import { ROLES, ROLE_STORAGE_KEYS, type Role } from "@/lib/admin-user-constants";

/** Canonical label and storage key → Role. Nothing else resolves. */
const EXACT_ROLE_LOOKUP: ReadonlyMap<string, Role> = new Map<string, Role>([
  ...ROLES.map((role) => [role.toLowerCase(), role] as const),
  ...(Object.entries(ROLE_STORAGE_KEYS) as [Role, string][]).map(
    ([role, key]) => [key.toLowerCase(), role] as const,
  ),
]);

/**
 * Resolve a role for an authorization decision, or `null`.
 *
 * @param value Raw role string from a token claim, Cognito group, or stored record.
 */
export function strictRole(value: unknown): Role | null {
  if (typeof value !== "string") return null;
  const key = value.trim().toLowerCase();
  if (!key) return null;
  return EXACT_ROLE_LOOKUP.get(key) ?? null;
}

/** First recognized role among Cognito groups, or `null`. */
export function strictRoleFromGroups(groups: unknown): Role | null {
  if (!Array.isArray(groups)) return null;
  for (const group of groups) {
    const role = strictRole(group);
    if (role) return role;
  }
  return null;
}
