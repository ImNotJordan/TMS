/**
 * Driver Loads API — the assignment-scoped counterpart to `/api/loads`.
 *
 *   GET   /api/driver/loads       loads assigned to the caller
 *   GET   /api/driver/loads/:id   one, 404 unless it is theirs
 *   PATCH /api/driver/loads/:id   the driver-owned fields, nothing else
 *
 * ## Why this is separate from `/api/loads`
 *
 * Drivers are tenant-exempt: they carry no `companyId`, because a driver works
 * across companies over a career and giving them one would hand them a whole
 * company's board. "Exempt from the companyId rule" is not "exempt from
 * filtering" though — so their scope is `assignedDriver = <their sub>`, applied
 * here with the same rigour the company predicate gets elsewhere.
 *
 * Two scopes, two endpoints. A single endpoint that switched predicate on role
 * would be one `if` away from serving the wrong one.
 *
 * ## Writes
 *
 * The field allowlist lives here, on the server. It also exists in the driver
 * portal, but that copy is advice: the client can be edited. This copy is the
 * rule. Without it a driver could rewrite `customerRate` on a load they are
 * legitimately assigned.
 */
import { GetCommand, QueryCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";

import { getServerDataClient, ServerDataPrincipalMissingError } from "@/lib/server/server-dynamo";
import { readServerEnv } from "@/lib/server-env";
import { requireCurrentTenantContext } from "@/lib/tenant/request-context";
import {
  loadStatusForDriverWorkflow,
  normalizeLoadStatus,
  type LoadStatus,
} from "@/lib/load-status";
import { legForDriverStep, windowForLeg, windowVariance } from "@/lib/appointment-window";
import {
  logTenantDenial,
  tenantErrorResponse,
  type TenantContext,
} from "@/lib/tenant/server-tenant-context";

const DRIVER_LOADS_PATH = "/api/driver/loads";
const ASSIGNED_DRIVER_INDEX = "assignedDriver-index";

/**
 * Attributes a driver may write. Everything else on a load — rates, customer,
 * addresses, carrier, the ops console's `trackingSession` — belongs to dispatch.
 */
const DRIVER_WRITABLE_FIELDS: ReadonlySet<string> = new Set([
  "driverWorkflowStatus",
  // `driverStatusHistory` is deliberately ABSENT — it is server-owned. See
  // SERVER_OWNED_DRIVER_FIELDS.
  "documentAssets",
  "documents",
  "driverGps",
  /**
   * How a driver reports something wrong: a BOL number that does not match the
   * paperwork in their hand, a refused pallet, a dock that turned them away.
   *
   * A transient *input*, not a stored field. The server turns it into an attributed
   * entry on `driverExceptions` and never writes this key. Needed because the
   * driver is refused `deliveryReference` — correctly, it is what the invoice
   * reconciles on — yet they are the only person holding the physical BOL. Without
   * a channel, a mismatch dies in a phone call that never happens.
   */
  "reportIssue",
  // Shared with dispatch by design: a driver marking a load delivered is how the
  // board finds out. Narrowed to the stages a driver can actually report — see
  // DRIVER_WRITABLE_LOAD_STATUSES.
  "loadStatus",
]);

/**
 * The audit trail is written by the server or not at all.
 *
 * The first attempt at this let the client send `driverStatusHistory` and merely
 * filled in a `serverAt` when one was missing. A driver found the hole in minutes:
 * supply your own `serverAt` and it is trusted verbatim, supply your own `by` and
 * it is never checked against the token, and because the update *assigns* the
 * array rather than appending to it, one request replaces the entire trail. Four
 * recorded stops became a single entry dated 2020 and attributed to a different
 * driver, HTTP 200.
 *
 * That is strictly worse than having no history, because dispatch would trust it.
 * A driver could move their own arrival times to defeat a detention claim, pin a
 * late delivery on someone else, and erase the evidence in the same call.
 *
 * So the field is server-owned now. A request carrying it is refused rather than
 * quietly stripped, for the same reason `loads-api-proxy` refuses `companyId`: a
 * silent drop leaves no trace of the attempt, and a genuine client bug would go
 * unnoticed for months.
 */
const SERVER_OWNED_DRIVER_FIELDS = ["driverStatusHistory", "driverExceptions"] as const;

/**
 * The `loadStatus` values a driver may set.
 *
 * The field has to stay writable — a driver marking a load delivered is how the
 * board finds out — but the freedom did not. Before this, a driver could `PATCH`
 * any string, including `completed` and `cancelled`, which three separate readers
 * treat as terminal: one request from a driver's phone could take a live load off
 * the tracking board and out of the billing queue.
 *
 * These are the stages a driver legitimately reports. Booking, tendering,
 * cancelling and closing out are dispatch and accounting decisions.
 *
 * Compared against the **canonical** form, not the raw string. The first version
 * of this check did a bare lowercase compare, which refused `en-route-delivery`
 * while allowing `in-transit` — the same status under two spellings, one accepted
 * and one 403. A driver tapping "departing shipper" got a permission error on a
 * status they were entitled to set. Normalising first is the entire reason
 * `normalizeLoadStatus` exists; not calling it here was the bug.
 */
const DRIVER_WRITABLE_LOAD_STATUSES: ReadonlySet<LoadStatus> = new Set<LoadStatus>([
  "driver-assigned",
  "active",
  "dispatched",
  "at-pickup",
  "loaded",
  "in-transit",
  "at-delivery",
  "delivered",
]);

/**
 * The fields a driver's app receives.
 *
 * ## Why an allowlist, and why this exists at all
 *
 * The write path was locked down and the read path was not: `GET` returned the
 * whole DynamoDB item, so a driver's phone received `customerRate` sitting next to
 * `carrierRate` — the brokerage's margin on every load, on the list endpoint,
 * before they even opened it. A driver refused permission to *edit* `carrierRate`
 * could still read the number they would have needed to negotiate against. For an
 * outside carrier or an owner-operator that is the whole negotiating position.
 *
 * `carrierRate` stays: it is what the carrier is paid, the driver is entitled to
 * it, and the offer card shows it. `customerRate` and `linehaulRate` are the
 * customer side of the sheet and are removed. Removing either alone is not enough
 * — the margin is a subtraction, so both have to go.
 *
 * An allowlist rather than a denylist because of the failure direction: a new
 * economic column added to `LoadRecord` next quarter leaks by default under a
 * denylist, and nobody would notice. Same reasoning as `DRIVER_WRITABLE_FIELDS`.
 */
const DRIVER_READABLE_FIELDS: ReadonlySet<string> = new Set([
  "loadId",
  "loadType",
  "loadStatus",
  "customer",
  "broker",
  "dispatcher",
  "equipmentType",
  "trailerType",
  "createdAt",
  "updatedAt",
  // What the carrier earns. Their side of the deal, not the customer's.
  "carrierRate",
  "paymentTerms",
  // Where and when — a driver cannot plan hours without all of this.
  "pickupFacility",
  "pickupAddress",
  "pickupCity",
  "pickupState",
  "pickupZip",
  "pickupDate",
  "pickupWindowStart",
  "pickupWindowEnd",
  "pickupAppointmentTime",
  "pickupInstructions",
  "pickupContactName",
  "pickupContactPhone",
  "pickupReference",
  "deliveryFacility",
  "deliveryAddress",
  "deliveryCity",
  "deliveryState",
  "deliveryZip",
  "deliveryDate",
  "deliveryWindowStart",
  "deliveryWindowEnd",
  "deliveryAppointmentTime",
  "deliveryInstructions",
  "deliveryContactName",
  "deliveryContactPhone",
  "deliveryReference",
  // What is on the trailer.
  "commodityDescription",
  "weight",
  "weightUnit",
  "dimensions",
  "palletCount",
  "pieceCount",
  "packagingType",
  "temperatureRequirement",
  "hazmat",
  "hazmatUn",
  "specialHandling",
  "sealNumber",
  // The driver's own workflow state and artefacts.
  "assignedDriver",
  "assignedCarrier",
  "driverWorkflowStatus",
  "driverStatusHistory",
  "driverExceptions",
  "driverGps",
  "documents",
  "documentAssets",
  "trackingRequired",
  "trackingMethod",
  "checkInRequired",
  "checkOutRequired",
]);

/** Strip a load to what a driver may see. */
function forDriver(load: LoadItem): LoadItem {
  const out: LoadItem = {};
  for (const [key, value] of Object.entries(load)) {
    if (DRIVER_READABLE_FIELDS.has(key)) out[key] = value;
  }
  return out;
}

/** The driver portal's own step vocabulary, plus the two answers to an offer. */
const DRIVER_WORKFLOW_STATUSES: ReadonlySet<string> = new Set([
  "assigned",
  "en-route-pickup",
  "at-pickup",
  "loaded",
  "en-route-delivery",
  "at-delivery",
  "delivered",
  "declined",
]);

const MAX_BODY_BYTES = 2_000_000;

function loadsTable(): string {
  return readServerEnv("VITE_LOADS_TABLE_NAME") || "Loads";
}

export function isDriverLoadsRequest(url: URL): boolean {
  return url.pathname === DRIVER_LOADS_PATH || url.pathname.startsWith(`${DRIVER_LOADS_PATH}/`);
}

function loadIdFromPath(url: URL): string | null {
  if (url.pathname === DRIVER_LOADS_PATH) return null;
  const rest = url.pathname.slice(DRIVER_LOADS_PATH.length + 1);
  return decodeURIComponent(rest).trim() || null;
}

function jsonError(message: string, status: number, code?: string) {
  return Response.json({ error: message, code }, { status });
}

type LoadItem = Record<string, unknown>;

/**
 * One assigned load, read strongly-consistently from the base table.
 *
 * Deliberately NOT the `assignedDriver-index` used by the read endpoints. A GSI
 * is eventually consistent, so for a short window after dispatch assigns a load
 * the index does not yet carry it — and a driver tapping "accept" in that window
 * got `404 Load not found` on a load that was genuinely theirs. Reading the base
 * table by primary key with `ConsistentRead` removes the window entirely.
 *
 * Checking `assignedDriver` here in code rather than as a query predicate does not
 * weaken the boundary: the write that follows still carries
 * `assignedDriver = :owner` in its `ConditionExpression`, and that single atomic
 * statement remains the enforcement. This read only informs decisions — which
 * `loadStatus` to derive, which appointment window to measure, whether a
 * document's reference belongs here — and answers 404 for anything not theirs, so
 * it leaks nothing either.
 */
async function getAssignedConsistent(driverId: string, loadId: string): Promise<LoadItem | null> {
  const client = getServerDataClient();
  const out = (await client.send(
    new GetCommand({
      TableName: loadsTable(),
      Key: { loadId },
      ConsistentRead: true,
    }) as never,
  )) as { Item?: LoadItem };

  const item = out.Item;
  if (!item || item.assignedDriver !== driverId) return null;
  return item;
}

/**
 * How many confirmation reads to have in flight at once.
 *
 * A driver has a handful of active loads, so this is about politeness rather than
 * throughput.
 */
const CONFIRM_CONCURRENCY = 10;

/**
 * Re-read candidates from the base table and keep only the ones still assigned
 * to this driver.
 *
 * ## Why the index result is not trustworthy on its own
 *
 * `assignedDriver-index` is a GSI, and a GSI is eventually consistent in *both*
 * directions. The direction that gets talked about is the missing one — a load
 * just assigned that has not propagated yet. The direction that matters more is
 * the opposite: a load **reassigned away** from this driver whose old index entry
 * is still there. Serving that entry hands the previous driver a load that is no
 * longer theirs, complete with the facility addresses, the receiver's contact
 * details and the carrier rate.
 *
 * That is an authorization staleness on a read path, in the module whose entire
 * job is scoping driver reads, so the index is treated as a *candidate list* and
 * the base table decides. `ConsistentRead` means a reassignment that has
 * committed is honoured immediately.
 *
 * A dropped candidate is not an error: it is a load that moved on, or was deleted,
 * between the index write and now.
 */
async function confirmStillAssigned(driverId: string, candidates: LoadItem[]): Promise<LoadItem[]> {
  const ids = [...new Set(candidates.map((c) => String(c.loadId)).filter(Boolean))];
  if (ids.length === 0) return [];

  /**
   * Individual `GetItem`s rather than one `BatchGetItem`.
   *
   * The first version of this used BatchGetItem, and it took the driver's whole
   * load list down: the server principal's policy grants Query, GetItem, PutItem,
   * UpdateItem and DeleteItem, but **not** `dynamodb:BatchGetItem`. Every list
   * request became a 502 the moment this shipped.
   *
   * The obvious fix is to add the permission. The better one is to not need it: a
   * correctness fix that depends on an out-of-band IAM deploy is broken in every
   * environment where that deploy has not happened yet, and it fails exactly the
   * way this one did — silently, at the one endpoint a driver opens first. GetItem
   * is an action the principal is already known to hold, because the detail
   * endpoint has always used it.
   *
   * The cost is N reads instead of one round trip. A driver has a handful of
   * active loads, so that is a rounding error; if this ever serves something with
   * hundreds of rows, add the IAM permission and switch back.
   */
  const confirmed: LoadItem[] = [];
  for (let i = 0; i < ids.length; i += CONFIRM_CONCURRENCY) {
    const slice = ids.slice(i, i + CONFIRM_CONCURRENCY);
    const rows = await Promise.all(slice.map((loadId) => getAssignedConsistent(driverId, loadId)));
    for (const row of rows) {
      if (row) confirmed.push(row);
    }
  }
  return confirmed;
}

/**
 * Loads assigned to this driver. Never a table scan.
 *
 * The index finds the candidates; the base table confirms them — see
 * `confirmStillAssigned`.
 *
 * One direction of staleness survives and cannot be closed here: a load assigned
 * moments ago may not be in the index yet, so it will not appear in this list
 * until propagation catches up (typically well under a second, and the portal
 * polls). DynamoDB offers no strongly-consistent read of a non-key attribute, so
 * removing that entirely means a different access pattern — an assignment list
 * kept on the driver, written transactionally with the load. That is a schema
 * change with its own drift risk and it is deliberately not done here. It does not
 * affect writes: `getAssignedConsistent` already reads the base table, so a driver
 * can act on a load the moment it is theirs even if the list has not caught up.
 */
async function listAssigned(driverId: string): Promise<LoadItem[]> {
  const client = getServerDataClient();
  const candidates: LoadItem[] = [];
  let cursor: Record<string, unknown> | undefined;

  do {
    const page = (await client.send(
      new QueryCommand({
        TableName: loadsTable(),
        IndexName: ASSIGNED_DRIVER_INDEX,
        KeyConditionExpression: "assignedDriver = :owner",
        ExpressionAttributeValues: { ":owner": driverId },
        // Only the key is needed; the base table supplies the record.
        ProjectionExpression: "loadId",
        ExclusiveStartKey: cursor,
      }) as never,
    )) as { Items?: LoadItem[]; LastEvaluatedKey?: Record<string, unknown> };
    if (page.Items?.length) candidates.push(...page.Items);
    cursor = page.LastEvaluatedKey;
  } while (cursor);

  return confirmStillAssigned(driverId, candidates);
}

async function readBody(request: Request): Promise<Record<string, unknown> | Response> {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    return jsonError("Request body too large.", 413, "payload_too_large");
  }
  try {
    const parsed = (await request.json()) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return jsonError("Expected a JSON object.", 400, "invalid_payload");
    }
    return parsed as Record<string, unknown>;
  } catch {
    return jsonError("Invalid JSON body.", 400, "invalid_payload");
  }
}

/**
 * Stamp server time onto driver-reported events, keeping the device's own value.
 *
 * Every timestamp in this system was written by the phone. A device whose clock
 * is three hours off does not merely mislabel its events — it reorders them,
 * because the tracking derive reads "the last entry in the array" and the
 * timeline sorts on that string. A backdated append could therefore be read as
 * the driver's latest status.
 *
 * So the server stamps `serverAt` on write and readers order by it. `at` is left
 * exactly as the device reported it: it is what the driver's phone said, it is
 * evidence in a detention dispute, and overwriting it would destroy that.
 */
function stampServerTime(patch: Record<string, unknown>, receivedAt: string): void {
  // `driverStatusHistory` is not handled here any more: it is refused on arrival
  // and built server-side. The old code did `serverAt: entry.serverAt ?? receivedAt`,
  // which trusted a client-supplied server timestamp — the whole point of the field
  // is that the client cannot set it.
  const gps = patch.driverGps;
  if (gps && typeof gps === "object" && !Array.isArray(gps)) {
    // Assigned unconditionally, never `??`. A ping arrives with the device's clock
    // in `lastPingAt`; `serverAt` is ours and a supplied one is overwritten.
    patch.driverGps = { ...(gps as Record<string, unknown>), serverAt: receivedAt };
  }
}

/** Reference-shaped tokens in a filename: `BOL-556731`, `PO_88213`, `12345678`. */
const REFERENCE_TOKEN = /\b(?:bol|pod|po|pro|ref)[-_ ]?([a-z0-9]{4,})\b|\b(\d{6,})\b/gi;

function referenceTokens(text: string): string[] {
  const found: string[] = [];
  for (const match of text.matchAll(REFERENCE_TOKEN)) {
    const token = (match[1] ?? match[2] ?? "").toLowerCase();
    if (token) found.push(token);
  }
  return found;
}

/**
 * Refuse a document whose reference belongs to a different load.
 *
 * A driver filed `pod:BOL-556731-signed.jpg` against a load whose own
 * `deliveryReference` was `BOL-999999`, and nothing objected. That is the ordinary
 * way a POD gets kicked back by a shipper's AP and payment sits another thirty
 * days — and the load looks fully documented in the meantime, so nobody chases it.
 *
 * Narrow on purpose. It fires only when the filename carries a
 * recognisably reference-shaped token and *none* of them matches any reference on
 * the load. A file named `signed-pod.jpg` carries no reference and is accepted;
 * blocking those would stop legitimate uploads, and a blocked POD delays exactly
 * the payment this is meant to protect. When it does fire the message names the
 * expected reference, so the driver can rename the file or use `reportIssue` if the
 * paperwork in their hand genuinely disagrees with the load.
 */
function rejectMismatchedDocuments(
  patch: Record<string, unknown>,
  current: LoadItem,
): Response | null {
  const incoming = patch.documents;
  if (!Array.isArray(incoming)) return null;

  // Only the shipper's and receiver's own reference numbers. `loadId` is
  // deliberately excluded: it is our internal handle, not a BOL, so comparing a
  // real BOL against it would refuse legitimate paperwork on any load whose
  // references were never filled in — blocking exactly the payment this protects.
  const loadRefs = new Set(
    [current.pickupReference, current.deliveryReference]
      .filter((v): v is string => typeof v === "string" && v.trim() !== "")
      .flatMap((v) => referenceTokens(v).concat(v.trim().toLowerCase())),
  );
  if (loadRefs.size === 0) return null;

  const existing = new Set(
    (Array.isArray(current.documents) ? current.documents : []).map((d) => String(d)),
  );

  for (const raw of incoming) {
    const name = String(raw);
    // Only judge newly added documents; re-sending the existing list is routine.
    if (existing.has(name)) continue;

    const tokens = referenceTokens(name);
    if (tokens.length === 0) continue;
    if (tokens.some((t) => loadRefs.has(t))) continue;

    const expected =
      (current.deliveryReference as string | undefined) ??
      (current.pickupReference as string | undefined) ??
      String(current.loadId);

    return jsonError(
      `"${name}" carries reference ${tokens.join(", ")}, which does not match this load ` +
        `(${expected}). Check you have the right load, or send reportIssue if the paperwork disagrees.`,
      409,
      "document_reference_mismatch",
    );
  }
  return null;
}

async function patchAssigned(
  ctx: TenantContext,
  loadId: string,
  patch: Record<string, unknown>,
): Promise<Response> {
  // Named separately from the generic refusal so the message says *why* — a client
  // sending history is not reaching for someone else's field, it is doing something
  // the server now does for it.
  const serverOwned = SERVER_OWNED_DRIVER_FIELDS.filter((field) => field in patch);
  if (serverOwned.length > 0) {
    logTenantDenial(
      ctx,
      `driver write to server-owned fields: ${serverOwned.join(", ")}`,
      `${DRIVER_LOADS_PATH}/:id`,
    );
    return jsonError(
      `${serverOwned.join(", ")} is recorded by the server and cannot be supplied. ` +
        `Report the status and the entry is written for you.`,
      403,
      "server_owned_field",
    );
  }

  const rejected = Object.keys(patch).filter(
    (key) => key !== "loadId" && !DRIVER_WRITABLE_FIELDS.has(key),
  );
  if (rejected.length > 0) {
    logTenantDenial(
      ctx,
      `driver write to non-driver fields: ${rejected.join(", ")}`,
      `${DRIVER_LOADS_PATH}/:id`,
    );
    return jsonError(`Drivers cannot modify: ${rejected.join(", ")}.`, 403, "field_not_writable");
  }

  if ("loadStatus" in patch) {
    // Normalise before comparing: `en-route-delivery` and `in-transit` are the
    // same status, and the allowlist must not accept one spelling and 403 the other.
    const canonical =
      typeof patch.loadStatus === "string" ? normalizeLoadStatus(patch.loadStatus) : null;
    if (!canonical) {
      return jsonError(
        `"${String(patch.loadStatus)}" is not a load status.`,
        400,
        "unknown_status",
      );
    }
    if (!DRIVER_WRITABLE_LOAD_STATUSES.has(canonical)) {
      logTenantDenial(
        ctx,
        `driver write to out-of-scope loadStatus: ${String(patch.loadStatus)}`,
        `${DRIVER_LOADS_PATH}/:id`,
      );
      return jsonError(
        `Drivers cannot set loadStatus to "${String(patch.loadStatus)}".`,
        403,
        "status_not_writable",
      );
    }
    patch.loadStatus = canonical;
  }

  if ("driverWorkflowStatus" in patch) {
    const raw =
      typeof patch.driverWorkflowStatus === "string"
        ? patch.driverWorkflowStatus.trim().toLowerCase()
        : "";
    if (!DRIVER_WORKFLOW_STATUSES.has(raw)) {
      logTenantDenial(
        ctx,
        `driver write to unknown workflow status: ${String(patch.driverWorkflowStatus)}`,
        `${DRIVER_LOADS_PATH}/:id`,
      );
      return jsonError(
        `"${String(patch.driverWorkflowStatus)}" is not a driver workflow status.`,
        400,
        "unknown_workflow_status",
      );
    }
    patch.driverWorkflowStatus = raw;

    /**
     * Move `loadStatus` with the driver's step — the structural fix.
     *
     * `loadStatus` and `driverWorkflowStatus` both record where the load is, and
     * the driver only writes the second. Leaving them to drift is what produced
     * three separate defects: delivered loads never reaching the billing queue,
     * the post-delivery freeze failing to engage, and a board reading "never
     * picked up" for a truck that had already unloaded.
     *
     * Patching each reader to consult both fields is what caused those bugs — it
     * only takes one new guard reading one field to reopen the hole. Keeping them
     * in step here, at the only boundary a driver can write through, means no
     * reader can observe them disagreeing in the first place.
     *
     * An explicit `loadStatus` in the same patch wins: the client asked for
     * something specific and it already passed the allowlist above.
     */
  }

  // The stored load. Needed for four decisions the server cannot make from the
  // patch alone: which `loadStatus` to move to, whether a document's reference
  // belongs to this load, which appointment window to measure against, and — via
  // the index — that the load is genuinely this driver's.
  const current = await getAssignedConsistent(ctx.userId, loadId);
  if (!current) {
    logTenantDenial(ctx, "driver write to an unassigned load", `${DRIVER_LOADS_PATH}/:id`);
    return jsonError("Load not found.", 404, "not_found");
  }

  const documentCheck = rejectMismatchedDocuments(patch, current);
  if (documentCheck) return documentCheck;

  /**
   * Move `loadStatus` with the driver's step — the structural fix.
   *
   * `loadStatus` and `driverWorkflowStatus` both record where the load is, and the
   * driver only writes the second. Leaving them to drift produced three separate
   * defects: delivered loads never reaching the billing queue, the post-delivery
   * freeze failing to engage, and a board reading "never picked up" for a truck
   * that had already unloaded.
   *
   * Patching each reader to consult both fields is what caused those bugs — it only
   * takes one new guard reading one field to reopen the hole. Keeping them in step
   * here, at the only boundary a driver can write through, means no reader can
   * observe them disagreeing.
   *
   * An explicit `loadStatus` in the same patch wins: the client asked for something
   * specific and it already passed the allowlist above.
   */
  if (typeof patch.driverWorkflowStatus === "string" && patch.loadStatus === undefined) {
    const derived = loadStatusForDriverWorkflow(
      patch.driverWorkflowStatus,
      current.loadStatus as string | undefined,
    );
    if (derived) patch.loadStatus = derived;
  }

  // Stamp before building the update expression, so the stamped values are the
  // ones written rather than the client's originals.
  stampServerTime(patch, new Date().toISOString());

  /**
   * Convert `reportIssue` into an attributed exception entry.
   *
   * The driver supplies the text; the server supplies who and when. Same posture as
   * the status trail — the reporter does not get to write the record of their own
   * report — and `reportIssue` itself is stripped so it never lands as an attribute.
   */
  const issueEntries: unknown[] = [];
  if (patch.reportIssue !== undefined) {
    const raw = patch.reportIssue;
    const detail =
      typeof raw === "string"
        ? raw
        : typeof (raw as { detail?: unknown })?.detail === "string"
          ? (raw as { detail: string }).detail
          : null;
    if (!detail || !detail.trim()) {
      return jsonError(
        "reportIssue needs a detail describing the problem.",
        400,
        "invalid_payload",
      );
    }
    const kindRaw = (raw as { kind?: unknown })?.kind;
    issueEntries.push({
      kind: typeof kindRaw === "string" && kindRaw.trim() ? kindRaw.trim().toLowerCase() : "other",
      detail: detail.trim().slice(0, 1000),
      at: new Date().toISOString(),
      by: ctx.userId,
      source: "driver-app",
      status: "open",
    });
    delete patch.reportIssue;
  }

  const entries = Object.entries(patch).filter(
    ([key, value]) => key !== "loadId" && value !== undefined,
  );
  if (entries.length === 0 && issueEntries.length === 0) {
    return jsonError("Nothing to update.", 400, "invalid_payload");
  }

  const names: Record<string, string> = { "#updatedAt": "updatedAt" };
  const values: Record<string, unknown> = {
    ":updatedAt": new Date().toISOString(),
    ":owner": ctx.userId,
  };
  const sets = ["#updatedAt = :updatedAt"];
  entries.forEach(([key, value], i) => {
    names[`#a${i}`] = key;
    values[`:a${i}`] = value;
    sets.push(`#a${i} = :a${i}`);
  });

  /**
   * Record the status change ourselves when the client did not.
   *
   * `driverStatusHistory` used to be entirely client-supplied: the portal builds
   * the array and sends it, and the server stored whatever arrived. A live test
   * ran eight status changes from a client that simply never sent the field, and
   * the finished load carried no history at all — no record of when the driver
   * reached the shipper, departed, or delivered.
   *
   * That is the one field you cannot afford to have missing. It is what gets
   * pulled up when a receiver claims the truck showed up late, and what a
   * detention claim is argued from. An audit trail the client can opt out of is
   * not an audit trail.
   *
   * `list_append` rather than read-modify-write so two concurrent updates from a
   * reconnecting phone both land instead of one overwriting the other.
   */
  const reportedStatus = patch.driverWorkflowStatus ?? patch.loadStatus;
  if (reportedStatus !== undefined) {
    const at = new Date().toISOString();

    /**
     * Measure the report against its appointment window.
     *
     * Recorded, never refused: a driver outside their window is Tuesday, and
     * rejecting the report would lose the event and leave the board showing a truck
     * that never arrived. What was missing is that nothing noticed — an `at-pickup`
     * a day before the window opened was accepted in silence, and on-time
     * percentage, detention and late fees are all computed off these timestamps.
     */
    const leg = legForDriverStep(String(reportedStatus));
    const variance = leg ? windowVariance(leg, windowForLeg(leg, current as never), at) : null;

    names["#history"] = "driverStatusHistory";
    values[":historyEntry"] = [
      {
        status: reportedStatus,
        at,
        serverAt: at,
        by: ctx.userId,
        source: "driver-app",
        ...(variance ? { onTime: variance.onTime, varianceMinutes: variance.varianceMinutes } : {}),
      },
    ];
    values[":emptyHistory"] = [];
    sets.push("#history = list_append(if_not_exists(#history, :emptyHistory), :historyEntry)");
  }

  if (issueEntries.length > 0) {
    names["#exceptions"] = "driverExceptions";
    values[":issueEntry"] = issueEntries;
    values[":emptyIssues"] = [];
    sets.push("#exceptions = list_append(if_not_exists(#exceptions, :emptyIssues), :issueEntry)");
  }

  try {
    const client = getServerDataClient();
    const out = (await client.send(
      new UpdateCommand({
        TableName: loadsTable(),
        Key: { loadId },
        UpdateExpression: `SET ${sets.join(", ")}`,
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
        // Exists AND is assigned to this driver, in one statement. A load
        // reassigned between read and write fails here rather than being
        // silently overwritten.
        ConditionExpression: "attribute_exists(loadId) AND assignedDriver = :owner",
        ReturnValues: "ALL_NEW",
      }) as never,
    )) as { Attributes?: LoadItem };
    return Response.json({ load: forDriver(out.Attributes as LoadItem) });
  } catch (err) {
    if ((err as { name?: string })?.name === "ConditionalCheckFailedException") {
      logTenantDenial(ctx, "driver write to an unassigned load", `${DRIVER_LOADS_PATH}/:id`);
      // Same answer as a load that does not exist.
      return jsonError("Load not found.", 404, "not_found");
    }
    throw err;
  }
}

export async function handleDriverLoadsRequest(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const loadId = loadIdFromPath(url);

  let ctx: TenantContext;
  try {
    ctx = await requireCurrentTenantContext(request);
  } catch (err) {
    return tenantErrorResponse(err) ?? jsonError("Sign in required.", 401, "not_authenticated");
  }

  // Scoped to the caller's own assignments, whoever they are. No company
  // predicate — a driver has no company — and no way to ask about anyone else's
  // loads, because the driver id comes from the token rather than the request.
  const driverId = ctx.userId;

  try {
    switch (request.method) {
      case "GET": {
        if (!loadId) return Response.json({ loads: (await listAssigned(driverId)).map(forDriver) });
        // The base table, not the index: we already have the primary key, so a
        // Query+Filter over the driver's whole partition was both wasteful and
        // eventually consistent. A consistent Get is cheaper and correct in both
        // staleness directions.
        const load = await getAssignedConsistent(driverId, loadId);
        if (!load) {
          logTenantDenial(ctx, "load not assigned to caller", `${DRIVER_LOADS_PATH}/:id`);
          return jsonError("Load not found.", 404, "not_found");
        }
        return Response.json({ load: forDriver(load) });
      }

      case "PATCH": {
        if (!loadId) return jsonError("Method not allowed.", 405);
        const body = await readBody(request);
        if (body instanceof Response) return body;
        return await patchAssigned(ctx, loadId, body);
      }

      default:
        return jsonError("Method not allowed.", 405);
    }
  } catch (err) {
    if (err instanceof ServerDataPrincipalMissingError) {
      console.error("[driver-loads] data principal is not configured");
      return jsonError("Server is not configured for data access.", 503, err.code);
    }
    console.error("[driver-loads] request failed", err instanceof Error ? err.message : err);
    return jsonError("Could not complete that request.", 502, "error");
  }
}
