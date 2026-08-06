/**
 * Soft audience detection from Cognito attributes.
 * Empty / unknown stays permissive so existing accounts without custom:role keep working.
 */
export type AppAudience = "driver" | "ops" | "unknown";

export function resolveAppAudience(
  attributes: Record<string, string | undefined> | null | undefined,
): AppAudience {
  const raw = [
    attributes?.["custom:role"],
    attributes?.["custom:access_level"],
    attributes?.["custom:userType"],
    attributes?.["custom:user_type"],
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (!raw.trim()) return "unknown";

  const isDriver = /\bdriver\b/.test(raw);
  const isOps =
    /\b(admin|superadmin|dispatcher|broker|ops|operations|manager|shipper|carrier)\b/.test(raw);

  if (isDriver && !isOps) return "driver";
  if (isOps && !isDriver) return "ops";
  if (isDriver && isOps) return "ops"; // dual-tagged staff → ops console
  return "unknown";
}
