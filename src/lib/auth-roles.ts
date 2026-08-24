/**
 * Soft audience detection from Cognito attributes.
 * Empty / unknown stays permissive so existing accounts without custom:role keep working.
 */
export type AppAudience = "driver" | "ops" | "client" | "unknown";

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
  const isClient = /\b(client|customer)\b/.test(raw);
  const isOps =
    /\b(admin|superadmin|dispatcher|broker|ops|operations|manager|shipper|carrier)\b/.test(raw);

  // Staff tags win. A dual-tagged account belongs on the console that can do
  // the work, not on a read-only portal.
  if (isOps) return "ops";
  if (isDriver) return "driver";
  if (isClient) return "client";
  return "unknown";
}
