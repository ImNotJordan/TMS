import { createResourceClient } from "./api/resource-client";
import {
  fetchOperationalListCached,
  getOperationalCacheScope,
  readOperationalItemFromListCache,
  removeOperationalListItem,
  upsertOperationalListItem,
  type OperationalListKind,
} from "./operational-data-cache";

export type TruckRecord = {
  truckBoardId: string;
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
  postingStatus?: string;
  availableDate?: string;
  availableTime?: string;
  expirationDate?: string;
  expirationTime?: string;
  availableNow?: boolean;
  availableUntilDate?: string;
  hoursOfService?: string;
  remainingDriveHours?: string;
  earliestPickupTime?: string;
  latestPickupTime?: string;
  appointmentRequired?: boolean;
  capacityStatus?: string;
  currentCity?: string;
  currentState?: string;
  currentZip?: string;
  currentCountry?: string;
  currentAddress?: string;
  facilityName?: string;
  locationRadius?: string;
  equipmentType?: string;
  trailerType?: string;
  truckType?: string;
  truckNumber?: string;
  trailerNumber?: string;
  equipmentLength?: string;
  equipmentWidth?: string;
  equipmentHeight?: string;
  maxWeightCapacity?: string;
  doorType?: string;
  temperatureRange?: string;
  reeferUnitAvailable?: boolean;
  teamDriverAvailable?: boolean;
  powerOnlyAvailable?: boolean;
  dropTrailerAvailable?: boolean;
  liftgateAvailable?: boolean;
  palletJackAvailable?: boolean;
  strapsAvailable?: boolean;
  loadBarsAvailable?: boolean;
  tarpsAvailable?: boolean;
  chainsAvailable?: boolean;
  eTrackAvailable?: boolean;
  hazmatCertified?: boolean;
  tankerEndorsement?: boolean;
  twicCard?: boolean;
  teamService?: boolean;
  airRide?: boolean;
  foodGradeTrailer?: boolean;
  preferredDestinationCity?: string;
  preferredDestinationState?: string;
  preferredDestinationRegion?: string;
  preferredLanes?: string;
  avoidedLanes?: string;
  willingDeadheadMiles?: string;
  minimumTripMiles?: string;
  maximumTripMiles?: string;
  preferredStates?: string[];
  excludedStates?: string[];
  carrierName?: string;
  carrierMcNumber?: string;
  carrierDotNumber?: string;
  contactName?: string;
  contactPhone?: string;
  contactEmail?: string;
  driverName?: string;
  driverPhone?: string;
  dispatcherName?: string;
  dispatcherPhone?: string;
  dispatcherEmail?: string;
  desiredRate?: string;
  minimumRate?: string;
  rateType?: string;
  desiredRatePerMile?: string;
  minimumRatePerMile?: string;
  fuelSurchargePreference?: string;
  paymentTerms?: string;
  quickPayAccepted?: boolean;
  negotiableRate?: boolean;
  insuranceVerified?: boolean;
  authorityVerified?: boolean;
  safetyRating?: string;
  operatingAuthorityStatus?: string;
  cargoInsuranceAmount?: string;
  autoLiabilityAmount?: string;
  insuranceExpirationDate?: string;
  documents?: string[];
  publicNotes?: string;
  internalNotes?: string;
};

export type CreateTruckInput = Omit<TruckRecord, "createdAt" | "updatedAt">;

/**
 * ## Transport
 *
 * `/api/trucks`, not DynamoDB. The server derives the tenant from the verified
 * token and scopes every query; the browser holds no credentials for the
 * TruckBoard table.
 *
 * Exported names and signatures are unchanged, so no screen moved. The list
 * cache stays — it dedupes polling in front of an already-scoped fetch, and is
 * not a substitute for scoping.
 */
const api = createResourceClient<TruckRecord>("trucks", {
  collection: "trucks",
  item: "truck",
});

const CACHE_KIND: OperationalListKind = "trucks";
const getTruckKey = (row: TruckRecord) => row.truckBoardId;

export async function listAllTrucks(): Promise<TruckRecord[]> {
  return api.list();
}

export async function listAllTrucksCached(options?: {
  force?: boolean;
  scope?: string;
}): Promise<TruckRecord[]> {
  return fetchOperationalListCached({
    kind: CACHE_KIND,
    scope: options?.scope,
    force: options?.force,
    getId: getTruckKey,
    fetchRemote: () => api.list(),
  });
}

export async function getTruckById(truckBoardId: string): Promise<TruckRecord | null> {
  return api.get(truckBoardId);
}

export async function getTruckByIdCached(
  truckBoardId: string,
  options?: { force?: boolean; scope?: string },
): Promise<TruckRecord | null> {
  const id = truckBoardId?.trim();
  if (!id) return null;
  const scope = options?.scope ?? getOperationalCacheScope();

  if (!options?.force) {
    const cached = readOperationalItemFromListCache<TruckRecord>(
      CACHE_KIND,
      scope,
      id,
      getTruckKey,
    );
    if (cached) return cached;
  }

  const remote = await api.get(id);
  if (remote) upsertOperationalListItem(CACHE_KIND, scope, remote, getTruckKey);
  return remote;
}

export async function createTruck(input: CreateTruckInput): Promise<TruckRecord> {
  const created = await api.create(input as unknown as Record<string, unknown>);
  upsertOperationalListItem(CACHE_KIND, getOperationalCacheScope(), created, getTruckKey);
  return created;
}

export async function updateTruck(record: TruckRecord): Promise<TruckRecord> {
  const updated = await api.update(
    record.truckBoardId,
    record as unknown as Record<string, unknown>,
  );
  upsertOperationalListItem(CACHE_KIND, getOperationalCacheScope(), updated, getTruckKey);
  return updated;
}

export async function deleteTruck(truckBoardId: string): Promise<void> {
  await api.remove(truckBoardId);
  removeOperationalListItem(
    CACHE_KIND,
    getOperationalCacheScope(),
    truckBoardId,
    getTruckKey as unknown as (row: { updatedAt: string }) => string,
  );
}
