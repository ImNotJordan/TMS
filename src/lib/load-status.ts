/**
 * The load lifecycle, as a type and a transition table.
 *
 * ## Why this file exists
 *
 * `loadStatus` was `string`. Every reader lowercased and compared against its
 * own private list of values, so the set of statuses *written* and the set
 * *recognised* had drifted apart: `Quotes` wrote `"Booked"` while every other
 * writer used lowercase, `cancelled` was treated as terminal by three readers
 * but was absent from every dropdown, and `PATCH /api/loads/:id` accepted
 * `loadStatus: "totally-invented"` with a 200.
 *
 * A load moving `draft → delivered` in one write is not a typo, it is a load
 * that gets invoiced without ever having been picked up. The transition table
 * below is the thing that makes that a 409 instead of a 200.
 *
 * ## Aliases are normalised, not rejected
 *
 * Records already in DynamoDB carry `"Booked"`, `en_route_pickup`, `canceled`
 * and friends. Rejecting them would take working loads off the board on deploy,
 * so `normalizeLoadStatus` folds every known spelling onto the canonical value
 * and the transition check runs on the canonical form. An *unrecognised* value
 * is a different matter — that is a bug or an attack, and it is refused.
 *
 * ## What this file does not do
 *
 * It does not decide who may perform a transition; that is
 * `tenant/load-permissions`. Separating "is this move legal for any actor" from
 * "may this actor make it" keeps the table readable and means a role change
 * never silently widens the graph.
 */

/** The canonical lifecycle values. Anything else is not a load status. */
export const LOAD_STATUSES = [
  "draft",
  "tendered",
  "booked",
  "driver-assigned",
  "dispatched",
  "at-pickup",
  "loaded",
  "in-transit",
  "at-delivery",
  "delivered",
  "pod-uploaded",
  "completed",
  "cancelled",
  "exception",
  /**
   * Legacy catch-all meaning "live, somewhere between booked and delivered".
   * The driver portal still writes it ([driver loads-store] on `loaded` /
   * `en-route-delivery`), so it stays reachable — but it is deliberately last:
   * new code should pick a specific stage instead.
   */
  "active",
] as const;

export type LoadStatus = (typeof LOAD_STATUSES)[number];

const CANONICAL = new Set<string>(LOAD_STATUSES);

/**
 * Spellings seen in stored records and in code, folded onto canonical values.
 *
 * `booked` covers the capitalised `"Booked"` that `Quotes` writes, via the
 * lowercase pass in `normalizeLoadStatus` — it is listed here only where the
 * *shape* differs, not the case.
 */
const ALIASES: Record<string, LoadStatus> = {
  canceled: "cancelled",
  en_route_pickup: "dispatched",
  "en-route-pickup": "dispatched",
  at_pickup: "at-pickup",
  in_transit: "in-transit",
  en_route_delivery: "in-transit",
  "en-route-delivery": "in-transit",
  at_delivery: "at-delivery",
  pod_uploaded: "pod-uploaded",
  "driver-accepted": "driver-assigned",
  driver_assigned: "driver-assigned",
};

/**
 * The canonical status for a stored value, or `null` if it is not a load status.
 *
 * `null` and `undefined` normalise to `null` rather than to `draft`: a load with
 * no status is a data problem, and defaulting it would hide that.
 */
export function normalizeLoadStatus(raw: string | null | undefined): LoadStatus | null {
  if (typeof raw !== "string") return null;
  const lowered = raw.trim().toLowerCase();
  if (!lowered) return null;
  if (CANONICAL.has(lowered)) return lowered as LoadStatus;
  return ALIASES[lowered] ?? null;
}

export function isLoadStatus(raw: unknown): raw is LoadStatus {
  return typeof raw === "string" && normalizeLoadStatus(raw) !== null;
}

/**
 * Loads that are finished. No transition leaves these except an explicit
 * platform-admin correction, which does not go through this table.
 */
export const TERMINAL_LOAD_STATUSES: ReadonlySet<LoadStatus> = new Set(["completed", "cancelled"]);

/**
 * Statuses after which the load's economics are evidence rather than plans.
 * `tenant/load-permissions` refuses rate edits at or past these.
 */
export const ECONOMICALLY_FROZEN_STATUSES: ReadonlySet<LoadStatus> = new Set([
  "delivered",
  "pod-uploaded",
  "completed",
]);

/**
 * The forward graph.
 *
 * Read as "from this status, a load may move to one of these". Cancellation is
 * added to every pre-`loaded` status by `ALLOWED_TRANSITIONS` construction
 * below rather than repeated fifteen times — once freight is on the trailer,
 * cancelling is no longer a cancellation, it is a TONU or an exception.
 */
const FORWARD: Record<LoadStatus, LoadStatus[]> = {
  draft: ["tendered", "booked", "driver-assigned"],
  tendered: ["booked", "driver-assigned", "draft"],
  booked: ["driver-assigned", "dispatched", "tendered"],
  "driver-assigned": ["dispatched", "active", "at-pickup", "booked"],
  dispatched: ["at-pickup", "active"],
  // `at-pickup → in-transit` without passing through `loaded` is the normal
  // tracking path, not a skip: the tracking board collapses "loaded" into
  // at-pickup, so `depart-pickup` moves straight to in-transit.
  "at-pickup": ["loaded", "in-transit", "active"],
  loaded: ["in-transit", "active"],
  active: ["at-pickup", "loaded", "in-transit", "at-delivery", "delivered"],
  // `in-transit → delivered` skips the arrival marker. Allowed deliberately: a
  // driver who forgot to tap "arrived" and marks delivered must not be blocked,
  // because refusing loses the POD event entirely. Missing arrivals are a data
  // quality problem to report on, not a reason to reject the delivery.
  "in-transit": ["at-delivery", "delivered", "active"],
  "at-delivery": ["delivered", "active"],
  delivered: ["pod-uploaded", "completed"],
  "pod-uploaded": ["completed"],
  completed: [],
  cancelled: [],
  exception: ["draft", "tendered", "booked", "driver-assigned", "cancelled"],
};

/** Cancellable while the freight is not yet on the trailer. */
const CANCELLABLE_FROM: LoadStatus[] = [
  "draft",
  "tendered",
  "booked",
  "driver-assigned",
  "dispatched",
  "at-pickup",
];

export const ALLOWED_TRANSITIONS: Record<LoadStatus, ReadonlySet<LoadStatus>> = Object.freeze(
  Object.fromEntries(
    LOAD_STATUSES.map((from) => {
      const to = new Set<LoadStatus>(FORWARD[from]);
      if (CANCELLABLE_FROM.includes(from)) to.add("cancelled");
      // Any non-terminal load can be flagged as an exception. Getting *out* of
      // exception is the narrow part, and `FORWARD.exception` governs that.
      if (!TERMINAL_LOAD_STATUSES.has(from) && from !== "exception") to.add("exception");
      return [from, to as ReadonlySet<LoadStatus>];
    }),
  ) as Record<LoadStatus, ReadonlySet<LoadStatus>>,
);

export type TransitionRejection =
  | { ok: false; code: "unknown_status"; message: string }
  | { ok: false; code: "illegal_transition"; message: string }
  | { ok: false; code: "load_terminal"; message: string };

export type TransitionCheck =
  | { ok: true; from: LoadStatus | null; to: LoadStatus }
  | TransitionRejection;

/**
 * May a load move from `rawFrom` to `rawTo`?
 *
 * A no-op (`from === to`) is allowed: clients re-send whole records, and
 * refusing a write that changes nothing would break every editor screen.
 *
 * A load with no stored status yet (`rawFrom` unrecognised or absent) may be
 * set to anything reachable from `draft`. That covers records written before
 * this table existed without opening the graph up for everyone else.
 */
export function checkLoadTransition(
  rawFrom: string | null | undefined,
  rawTo: string | null | undefined,
): TransitionCheck {
  const to = normalizeLoadStatus(rawTo);
  if (!to) {
    return {
      ok: false,
      code: "unknown_status",
      message: `"${String(rawTo)}" is not a load status.`,
    };
  }

  const from = normalizeLoadStatus(rawFrom);
  if (!from) {
    const reachable = ALLOWED_TRANSITIONS.draft;
    if (to === "draft" || reachable.has(to)) return { ok: true, from: null, to };
    return {
      ok: false,
      code: "illegal_transition",
      message: `A load with no status may only start at draft or one of: ${[...reachable].join(", ")}.`,
    };
  }

  if (from === to) return { ok: true, from, to };

  if (TERMINAL_LOAD_STATUSES.has(from)) {
    return {
      ok: false,
      code: "load_terminal",
      message: `This load is ${from} and cannot be changed.`,
    };
  }

  if (!ALLOWED_TRANSITIONS[from].has(to)) {
    return {
      ok: false,
      code: "illegal_transition",
      message: `A load cannot move from ${from} to ${to}. Allowed from ${from}: ${[
        ...ALLOWED_TRANSITIONS[from],
      ].join(", ")}.`,
    };
  }

  return { ok: true, from, to };
}

/** True when the load's rates and reference numbers are frozen. */
export function isEconomicallyFrozen(raw: string | null | undefined): boolean {
  const status = normalizeLoadStatus(raw);
  return status !== null && ECONOMICALLY_FROZEN_STATUSES.has(status);
}

/**
 * The `loadStatus` a driver-reported step implies.
 *
 * ## Why this exists: one fact, two fields
 *
 * `loadStatus` and `driverWorkflowStatus` both record where a load is. A driver
 * only ever writes the second; the ops board, the billing queue and every guard
 * read the first. Nothing kept them in step, so they routinely disagreed — and
 * every reader that consulted only one of them was silently wrong about the other.
 *
 * That single split produced three separate defects: loads delivered on the
 * tracking board never reaching the billing queue, the post-delivery freeze
 * failing to engage on loads the driver had delivered, and a board showing "never
 * picked up" for a truck that had already unloaded.
 *
 * Patching each reader to check both fields is what produced those bugs in the
 * first place — it only takes one new guard consulting one field to reopen the
 * hole. So the fix belongs at the *write* boundary: when a driver reports a step,
 * the server moves `loadStatus` with it, and the two cannot drift.
 *
 * `declined` maps to nothing deliberately. A driver refusing a load is not a
 * lifecycle position, and what happens next — requeue, reassign, cancel — is
 * dispatch's decision, not an automatic consequence.
 */
const LOAD_STATUS_BY_DRIVER_WORKFLOW: Record<string, LoadStatus> = {
  assigned: "driver-assigned",
  "en-route-pickup": "dispatched",
  "at-pickup": "at-pickup",
  loaded: "loaded",
  "en-route-delivery": "in-transit",
  "at-delivery": "at-delivery",
  delivered: "delivered",
  "pod-uploaded": "pod-uploaded",
};

/**
 * The `loadStatus` to write alongside a driver's step report, or `undefined` to
 * leave it alone.
 *
 * Forward-only, and only where the lifecycle table permits the move: a driver
 * re-reporting an earlier step (a queued mutation replaying after a dead zone)
 * must not walk the ops board backwards, and the board must never end up holding
 * a status the loads API would itself refuse.
 */
export function loadStatusForDriverWorkflow(
  workflow: string | null | undefined,
  currentLoadStatus: string | null | undefined,
): LoadStatus | undefined {
  const step = (workflow ?? "").trim().toLowerCase();
  const mapped = LOAD_STATUS_BY_DRIVER_WORKFLOW[step];
  if (!mapped) return undefined;

  const from = normalizeLoadStatus(currentLoadStatus);
  if (!from) return mapped;
  if (from === mapped) return undefined;

  // A terminal load is not moved by a late-arriving driver report.
  if (TERMINAL_LOAD_STATUSES.has(from)) return undefined;

  return checkLoadTransition(from, mapped).ok ? mapped : undefined;
}

/** Driver-reported steps that mean the freight is off the truck. */
const DELIVERED_WORKFLOW_STATUSES: ReadonlySet<string> = new Set([
  "delivered",
  "pod-uploaded",
  "completed",
]);

/**
 * Is this load delivered — by **either** record of it?
 *
 * `loadStatus` is not sufficient on its own, and assuming it was is a bug this
 * caught in a live run. A driver reports delivery by writing
 * `driverWorkflowStatus`, and `loadStatus` only follows if something else writes
 * it — the tracking board's write-through, or a client that sends both fields. A
 * load can therefore be genuinely delivered, with a POD on file, while
 * `loadStatus` still reads `driver-assigned`.
 *
 * Every guard keyed on `loadStatus` alone silently does not apply to those loads.
 * In the run that found this, a broker changed a delivered load's customer rate to
 * $9,999 and rewrote its BOL number, and both returned 200, because the freeze was
 * looking at the one field the driver never wrote.
 *
 * Two independent records of the same fact means the safe reading is "delivered if
 * either says so". Under-freezing lets someone edit evidence; over-freezing at
 * worst forces a correction through a credit memo, which is where it belongs.
 */
export function isLoadDelivered(load: {
  loadStatus?: string | null;
  driverWorkflowStatus?: string | null;
}): boolean {
  if (isEconomicallyFrozen(load.loadStatus)) return true;
  const workflow = (load.driverWorkflowStatus ?? "").trim().toLowerCase();
  return DELIVERED_WORKFLOW_STATUSES.has(workflow);
}
