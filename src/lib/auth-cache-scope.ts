/**
 * When does a client-side cache belong to somebody else?
 *
 * Every cached row in the browser is scoped to a `userId:companyId` pair, even
 * when the cache key does not say so — `["loads"]` means "loads for whoever was
 * signed in when this was fetched". So a change in that pair invalidates
 * everything, and the pair is the only thing worth comparing.
 *
 * Kept as a separate pure function because the two ways to get it wrong are both
 * one character wide, and neither shows up in a typecheck:
 *
 * - Dropping the null guard (`previous !== next`) purges on first sign-in, which
 *   throws away a cache nothing has polluted yet.
 * - Dropping the inequality (`previous !== null`) purges on every load,
 *   including plain token refreshes on tab focus.
 * - Inverting either one purges never, which is the leak this exists to close.
 */

/** `userId:companyId` — the identity a cached row implicitly belongs to. */
export function cacheScopeOf(userId: string, companyId: string | null | undefined): string {
  return `${userId}:${companyId ?? "none"}`;
}

/**
 * Should every client cache be dropped before showing this scope's data?
 *
 * @param previous The scope as of the last successful load, or null when there
 *   has not been one in this page's lifetime.
 * @param next The scope just resolved.
 */
export function shouldPurgeForScopeChange(previous: string | null, next: string): boolean {
  // No previous scope means nothing has been cached under a different identity —
  // a first sign-in, or the first load after a purge.
  if (previous === null) return false;
  return previous !== next;
}
