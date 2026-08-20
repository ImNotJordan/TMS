/**
 * Company (tenant) context for the ops console.
 *
 * ## What this is
 *
 * The signed-in user's `companyId`, plus the accessors every tenant-scoped code
 * path uses to reach it. Records are stamped with `companyId` on create and
 * lists are narrowed to it on read.
 *
 * ## Where it comes from
 *
 * The `custom:companyId` claim on the Cognito ID token — the same value the
 * server authorizes against, so the two cannot disagree. Cognito signs it, the
 * app client cannot write it, and it therefore cannot be self-assigned.
 *
 * It used to be read from the Profile table's `permissions` section. That row is
 * writable by the browser holding Identity Pool credentials, so a user could set
 * their own tenant. The Profile row survives only as a fallback for accounts
 * assigned before the Cognito attribute existed, and only for the *display name*
 * once a claim is present.
 *
 * ## What this is NOT
 *
 * A security boundary. This code runs in the browser, and the browser holds
 * Cognito Identity Pool credentials with direct DynamoDB access. A determined
 * caller bypasses every function in this file by issuing a raw `Scan` from the
 * console. What this buys is a correct *data model* — every record carries a
 * stable tenant key from day one — and a UI that shows one company's data.
 *
 * Enforcement arrives when data access moves behind the server API tier and the
 * browser's DynamoDB permissions are revoked. At that point the same
 * `companyId` becomes a server-derived claim and these call sites do not change.
 * See docs/security/stage-0-iam.md.
 *
 * ## Fail closed
 *
 * A user with no assigned company resolves to `null`, and every read narrows to
 * nothing rather than falling back to unfiltered. An empty dashboard is a
 * support ticket; an unfiltered one is a breach.
 */
import { fetchAuthSession } from "aws-amplify/auth";

import { getSection } from "@/lib/profile-store";

export type CompanyContext = {
  companyId: string;
  companyName: string;
};

/** Attribute name carried on every tenant-scoped record. */
export const COMPANY_ID_ATTRIBUTE = "companyId";
/** Cognito claim holding the tenant key. Matches the server's expectation. */
export const COMPANY_ID_CLAIM = "custom:companyId";

type PermissionsSection = {
  companyId?: unknown;
  companyName?: unknown;
};

let contextUserId: string | null = null;
let contextPromise: Promise<CompanyContext | null> | null = null;
let resolved: CompanyContext | null = null;

/**
 * Mint an id for a newly named company.
 *
 * Opaque and non-sequential, so it is never mistaken for something guessable —
 * though note that unguessable ids are friction, not access control.
 */
export function newCompanyId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // Non-crypto fallback for environments without WebCrypto (tests, older SSR).
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Normalize a company name for comparison — so "Acme Logistics" and
 * "  acme logistics " are recognised as the same company when an admin is
 * picking from existing ones. Display always uses the original casing.
 */
export function normalizeCompanyName(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

function asTrimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** `custom:companyId` from the current ID token, or "" when absent. */
async function readCompanyIdFromToken(options?: { forceRefresh?: boolean }): Promise<string> {
  try {
    const session = await fetchAuthSession(
      options?.forceRefresh ? { forceRefresh: true } : undefined,
    );
    const claims = session.tokens?.idToken?.payload as Record<string, unknown> | undefined;
    return asTrimmedString(claims?.[COMPANY_ID_CLAIM]);
  } catch {
    return "";
  }
}

/**
 * Bind the context to a user. Call on sign-in and whenever identity changes;
 * a different user invalidates any resolved company immediately.
 */
export function setCompanyContextUser(userId: string | null | undefined) {
  const next = userId?.trim() || null;
  if (next === contextUserId) return;
  contextUserId = next;
  contextPromise = null;
  resolved = null;
}

export function clearCompanyContext() {
  contextUserId = null;
  contextPromise = null;
  resolved = null;
}

/**
 * Resolve the signed-in user's company, loading it once and caching for the
 * session. Returns `null` when no user is bound or none is assigned.
 *
 * Resolution order:
 *
 * 1. `custom:companyId` on the ID token — authoritative, signed, unforgeable.
 * 2. The Profile `permissions` row — legacy only, for accounts assigned before
 *    the Cognito attribute existed. Warned about, because that row is writable
 *    by the browser and so is not a trustworthy source of tenancy.
 *
 * The display name always comes from the Profile mirror; it is a label, and a
 * failure to read it must not cost us the id.
 */
export function ensureCompanyContext(options?: {
  forceRefresh?: boolean;
}): Promise<CompanyContext | null> {
  if (!contextUserId) return Promise.resolve(null);
  if (contextPromise && !options?.forceRefresh) return contextPromise;

  const userId = contextUserId;
  contextPromise = (async () => {
    const claimCompanyId = await readCompanyIdFromToken(options);

    let section: PermissionsSection | null = null;
    try {
      section = (await getSection<PermissionsSection>(userId, "permissions")).data;
    } catch (err) {
      // Only the label is at stake when the claim is present.
      console.warn(
        "[tenant] could not read the company display name",
        err instanceof Error ? err.message : err,
      );
    }

    // Guard against a sign-out or user switch that landed mid-flight.
    if (contextUserId !== userId) return null;

    const mirrorCompanyId = asTrimmedString(section?.companyId);
    const companyName = asTrimmedString(section?.companyName);

    if (claimCompanyId) {
      if (mirrorCompanyId && mirrorCompanyId !== claimCompanyId) {
        // The token wins. A mismatch means the mirror is stale, or somebody
        // edited the row directly — either way it is not the authority.
        console.warn("[tenant] Profile company does not match the token claim; using the claim");
      }
      resolved = { companyId: claimCompanyId, companyName };
      return resolved;
    }

    if (mirrorCompanyId) {
      console.warn(
        "[tenant] no custom:companyId claim on this token — falling back to the Profile " +
          "record. Re-assign this user so the company is set on their Cognito account, " +
          "then have them sign in again.",
      );
      resolved = { companyId: mirrorCompanyId, companyName };
      return resolved;
    }

    resolved = null;
    // Not cached as a permanent answer: assignment plus a token refresh should
    // resolve without a full reload.
    contextPromise = null;
    return null;
  })();

  return contextPromise;
}

/**
 * Re-read the company after an assignment.
 *
 * The claim only changes when a new token is issued, so this forces a refresh.
 * Without it a freshly assigned user keeps their previous company — or keeps
 * seeing nothing — until their token happens to expire.
 */
export function refreshCompanyContext(): Promise<CompanyContext | null> {
  contextPromise = null;
  resolved = null;
  return ensureCompanyContext({ forceRefresh: true });
}

/** Synchronous peek — `null` until `ensureCompanyContext` has resolved. */
export function peekCompanyContext(): CompanyContext | null {
  return resolved;
}

export class MissingCompanyError extends Error {
  readonly code = "COMPANY_ASSIGNMENT_REQUIRED";

  constructor() {
    super("Your account is not assigned to a company yet. Ask an administrator to assign one.");
    this.name = "MissingCompanyError";
  }
}

/**
 * The company id, or a thrown error. Use on write paths, where silently
 * skipping the tenant stamp would create an orphan record visible to nobody.
 */
export async function requireCompanyId(): Promise<string> {
  const context = await ensureCompanyContext();
  if (!context) throw new MissingCompanyError();
  return context.companyId;
}

/**
 * Narrow a fetched list to the active company.
 *
 * Records without a `companyId` (pre-migration rows) are excluded. They are
 * quarantined rather than shown to everyone — an unstamped row matching every
 * tenant is precisely the failure this work exists to prevent. Backfill them
 * with `scripts/backfill-company-id.mjs`.
 */
export function filterByCompany<T extends Record<string, unknown>>(
  items: T[],
  companyId: string | null,
): T[] {
  if (!companyId) return [];
  return items.filter((item) => item[COMPANY_ID_ATTRIBUTE] === companyId);
}

/** True when the record belongs to the given company. Unstamped rows are not. */
export function belongsToCompany(
  record: Record<string, unknown> | null | undefined,
  companyId: string | null,
): boolean {
  if (!record || !companyId) return false;
  return record[COMPANY_ID_ATTRIBUTE] === companyId;
}
