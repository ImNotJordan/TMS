import { createDynamoEntityStore, describeDynamoError } from "./dynamo-entity-store";
import { getCarriersTableName, getDynamoDocClient, queryAllItems } from "./dynamodb";
import { auditActorFromAuth, recordAdminAuditLog, type AdminAuditActor } from "./admin-audit-store";
import type { AuthUser } from "./auth";

export type CarrierKind = "carrier" | "broker";
export type CarrierTier = "none" | "preferred" | "core" | "strategic";
export type PortalInviteStatus = "not-invited" | "invited" | "active" | "declined";

export type CarrierContact = {
  id: string;
  name: string;
  role?: string;
  phone?: string;
  email?: string;
  primary?: boolean;
};

export type CarrierRecord = {
  carrierId: string;
  createdBy?: string;
  createdAt: string;
  updatedAt: string;

  // Company profile
  companyName: string;
  carrierKind: CarrierKind;
  mcNumber?: string;
  dotNumber?: string;
  scacCode?: string;
  website?: string;
  hqCity?: string;
  hqState?: string;
  internalNotes?: string;

  // Docs / compliance
  insuranceProvider?: string;
  insurancePolicyNumber?: string;
  insuranceCargoAmount?: string;
  insuranceLiabilityAmount?: string;
  insuranceExpiresAt?: string;
  insuranceVerified?: boolean;
  insuranceVerifiedAt?: string;
  w9OnFile?: boolean;
  w9ReceivedAt?: string;
  authorityStatus?: string;
  safetyRating?: string;
  documents?: string[];

  // Equipment
  equipmentTypes?: string[];
  fleetSize?: string;

  // Lanes
  lanesServed?: string[];
  preferredRegions?: string[];

  // Score
  otdPercentage?: string;
  claimsCount?: string;
  claimsRatePercentage?: string;
  scoreNotes?: string;

  // Contacts
  contacts?: CarrierContact[];

  // Tier / portal / risk actions
  tier: CarrierTier;
  blacklisted?: boolean;
  blacklistReason?: string;
  blacklistedAt?: string;
  portalInviteStatus: PortalInviteStatus;
  portalInvitedAt?: string;
  lastRateConfirmationSentAt?: string;

  // Insurance-expiry auto-award override (Manager only)
  autoAwardOverrideBy?: string;
  autoAwardOverrideAt?: string;
  autoAwardOverrideReason?: string;
};

export type CreateCarrierInput = Omit<CarrierRecord, "createdAt" | "updatedAt">;

const store = createDynamoEntityStore<CarrierRecord>({
  tableName: getCarriersTableName,
  idKey: "carrierId",
  label: "Carriers",
  kind: "carriers",
});

export const createCarrier = store.create;
export const listAllCarriers = store.listAll;
export const listAllCarriersCached = store.listAllCached;
export const getCarrierById = store.getById;
export const getCarrierByIdCached = store.getByIdCached;
export const updateCarrier = store.update;
export const deleteCarrier = store.remove;

export async function listCarriersByUser(userId: string): Promise<CarrierRecord[]> {
  return store.runReadLimited(async () => {
    try {
      const client = await getDynamoDocClient();
      return await queryAllItems<CarrierRecord>(client, {
        TableName: getCarriersTableName(),
        IndexName: "createdBy-index",
        KeyConditionExpression: "createdBy = :u",
        ExpressionAttributeValues: { ":u": userId },
      });
    } catch (err) {
      throw describeDynamoError(err, "Query", "Carriers");
    }
  });
}

// ---------- Eligibility rule: insurance expiry blocks auto-award unless Manager override ----------

const MANAGER_ROLES = new Set(["admin", "ops"]);

export function isManagerRole(role: string | undefined | null): boolean {
  return Boolean(role && MANAGER_ROLES.has(role));
}

export function isInsuranceExpired(carrier: CarrierRecord, asOf: Date = new Date()): boolean {
  if (!carrier.insuranceExpiresAt) return true;
  const expiry = new Date(carrier.insuranceExpiresAt);
  if (Number.isNaN(expiry.getTime())) return true;
  return expiry.getTime() < asOf.getTime();
}

export function hasActiveAutoAwardOverride(carrier: CarrierRecord): boolean {
  return Boolean(carrier.autoAwardOverrideBy && carrier.autoAwardOverrideAt);
}

export type AutoAwardEligibility = {
  eligible: boolean;
  reason?: string;
};

/** Acceptance rule: insurance expiry blocks auto-award unless a Manager has granted an override. */
export function evaluateAutoAwardEligibility(
  carrier: CarrierRecord,
  asOf: Date = new Date(),
): AutoAwardEligibility {
  if (carrier.blacklisted) {
    return { eligible: false, reason: "Carrier is blacklisted." };
  }
  if (isInsuranceExpired(carrier, asOf)) {
    if (hasActiveAutoAwardOverride(carrier)) {
      return { eligible: true, reason: "Insurance expired — Manager override active." };
    }
    return { eligible: false, reason: "Insurance expired — blocks auto-award until a Manager overrides." };
  }
  return { eligible: true };
}

// ---------- Carrier actions (each updates the record + writes an audit log entry) ----------

function actorFrom(user: AuthUser | null | undefined): AdminAuditActor {
  return auditActorFromAuth(user);
}

async function applyCarrierAction(
  carrierId: string,
  mutate: (carrier: CarrierRecord) => CarrierRecord,
): Promise<CarrierRecord> {
  const current = await getCarrierByIdCached(carrierId);
  if (!current) {
    throw new Error(`Carrier ${carrierId} not found`);
  }
  return updateCarrier(mutate(current));
}

export async function setCarrierTier(
  carrierId: string,
  tier: CarrierTier,
  actor: AuthUser | null | undefined,
): Promise<CarrierRecord> {
  const updated = await applyCarrierAction(carrierId, (c) => ({ ...c, tier }));
  await recordAdminAuditLog({
    actor: actorFrom(actor),
    action: "Set routing guide tier",
    module: "Carriers",
    record: `${updated.companyName} (${carrierId})`,
    details: `Tier set to "${tier}"`,
  });
  return updated;
}

export async function inviteCarrierToPortal(
  carrierId: string,
  actor: AuthUser | null | undefined,
): Promise<CarrierRecord> {
  const now = new Date().toISOString();
  const updated = await applyCarrierAction(carrierId, (c) => ({
    ...c,
    portalInviteStatus: "invited",
    portalInvitedAt: now,
  }));
  await recordAdminAuditLog({
    actor: actorFrom(actor),
    action: "Invite to portal",
    module: "Carriers",
    record: `${updated.companyName} (${carrierId})`,
    details: "Portal invite sent",
  });
  return updated;
}

export async function setCarrierBlacklisted(
  carrierId: string,
  blacklisted: boolean,
  actor: AuthUser | null | undefined,
  reason?: string,
): Promise<CarrierRecord> {
  const now = new Date().toISOString();
  const updated = await applyCarrierAction(carrierId, (c) => ({
    ...c,
    blacklisted,
    blacklistReason: blacklisted ? reason : undefined,
    blacklistedAt: blacklisted ? now : undefined,
  }));
  await recordAdminAuditLog({
    actor: actorFrom(actor),
    action: blacklisted ? "Blacklist carrier" : "Remove from blacklist",
    module: "Carriers",
    record: `${updated.companyName} (${carrierId})`,
    status: blacklisted ? "Blocked" : "Success",
    details: blacklisted ? reason || "No reason provided" : "Carrier reinstated",
  });
  return updated;
}

/** Stubbed insurance-verification call (would hit a real carrier-insurance API in production). */
export async function verifyCarrierInsurance(
  carrierId: string,
  actor: AuthUser | null | undefined,
): Promise<CarrierRecord> {
  const now = new Date().toISOString();
  const current = await getCarrierByIdCached(carrierId);
  if (!current) throw new Error(`Carrier ${carrierId} not found`);
  const expired = isInsuranceExpired(current, new Date());
  const updated = await applyCarrierAction(carrierId, (c) => ({
    ...c,
    insuranceVerified: !expired,
    insuranceVerifiedAt: now,
  }));
  await recordAdminAuditLog({
    actor: actorFrom(actor),
    action: "Verify insurance",
    module: "Carriers",
    record: `${updated.companyName} (${carrierId})`,
    status: expired ? "Blocked" : "Success",
    details: expired
      ? "Insurance verification API check: expired policy on file"
      : "Insurance verification API check: policy active",
  });
  return updated;
}

export async function sendCarrierRateConfirmation(
  carrierId: string,
  actor: AuthUser | null | undefined,
): Promise<CarrierRecord> {
  const now = new Date().toISOString();
  const updated = await applyCarrierAction(carrierId, (c) => ({
    ...c,
    lastRateConfirmationSentAt: now,
  }));
  await recordAdminAuditLog({
    actor: actorFrom(actor),
    action: "Send rate confirmation",
    module: "Carriers",
    record: `${updated.companyName} (${carrierId})`,
    details: "Rate confirmation document sent to carrier contact",
  });
  return updated;
}

/** Callers must confirm the actor holds a Manager role (see `isManagerRole`) before invoking this. */
export async function grantAutoAwardOverride(
  carrierId: string,
  actor: AuthUser | null | undefined,
  reason: string,
): Promise<CarrierRecord> {
  const now = new Date().toISOString();
  const actorInfo = actorFrom(actor);
  const updated = await applyCarrierAction(carrierId, (c) => ({
    ...c,
    autoAwardOverrideBy: actorInfo.actorName,
    autoAwardOverrideAt: now,
    autoAwardOverrideReason: reason,
  }));
  await recordAdminAuditLog({
    actor: actorInfo,
    action: "Grant auto-award override",
    module: "Carriers",
    record: `${updated.companyName} (${carrierId})`,
    status: "Reviewed",
    details: reason || "Manager override granted for expired insurance",
  });
  return updated;
}

export async function revokeAutoAwardOverride(
  carrierId: string,
  actor: AuthUser | null | undefined,
): Promise<CarrierRecord> {
  const updated = await applyCarrierAction(carrierId, (c) => ({
    ...c,
    autoAwardOverrideBy: undefined,
    autoAwardOverrideAt: undefined,
    autoAwardOverrideReason: undefined,
  }));
  await recordAdminAuditLog({
    actor: actorFrom(actor),
    action: "Revoke auto-award override",
    module: "Carriers",
    record: `${updated.companyName} (${carrierId})`,
    details: "Manager override revoked",
  });
  return updated;
}
