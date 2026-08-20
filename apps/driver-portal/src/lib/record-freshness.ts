/**
 * Read-after-write reconciliation for the driver portal's load list.
 *
 * `listAllLoads` uses a DynamoDB Scan, which is eventually consistent. A poll that
 * started before a write — or one that reads a replica that hasn't caught up — returns
 * the pre-write item. Without a guard, remapping that result rolls the driver's status
 * backwards on screen ("Mark as: En route to pickup" snapping back to "Assigned").
 *
 * `updatedAt` is stamped by the writer as an ISO-8601 UTC string, so lexicographic
 * comparison is a valid recency check.
 */

type Versioned = { loadId: string; updatedAt: string };

export type Reconciled<T extends Versioned> = {
  /** The record to render — the local write when the read is provably older. */
  record: T;
  /** True when the backend has caught up and the pending write can be dropped. */
  settled: boolean;
};

export function reconcileRecord<T extends Versioned>(
  incoming: T,
  pending: T | undefined,
): Reconciled<T> {
  if (!pending) return { record: incoming, settled: true };
  // `>=` so an identical stamp (our own write echoed back) also settles, and a newer
  // stamp from anyone else — ops console, another device — wins outright.
  if ((incoming.updatedAt ?? "") >= pending.updatedAt) {
    return { record: incoming, settled: true };
  }
  return { record: pending, settled: false };
}
