import { GetCommand, PutCommand, ScanCommand } from "@aws-sdk/lib-dynamodb";

import { getDynamoDocClient, getTrucksTableName } from "./dynamodb";
import { createRateLimitedExecutor } from "./rate-limit";

const TRUCKS_READ_RATE_LIMIT_MS = 300;
const TRUCKS_WRITE_RATE_LIMIT_MS = 1200;
const runTrucksReadLimited = createRateLimitedExecutor(TRUCKS_READ_RATE_LIMIT_MS);
const runTrucksWriteLimited = createRateLimitedExecutor(TRUCKS_WRITE_RATE_LIMIT_MS);

export type TruckRecord = {
  truckBoardId: string;
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
  // Step 1: Availability
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
  // Step 2: Current Location
  currentCity?: string;
  currentState?: string;
  currentZip?: string;
  currentCountry?: string;
  currentAddress?: string;
  facilityName?: string;
  locationRadius?: string;
  // Step 3: Equipment
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
  // Step 4: Destination
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
  // Step 5: Carrier
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
  // Step 6: Rate
  desiredRate?: string;
  minimumRate?: string;
  rateType?: string;
  desiredRatePerMile?: string;
  minimumRatePerMile?: string;
  fuelSurchargePreference?: string;
  paymentTerms?: string;
  quickPayAccepted?: boolean;
  negotiableRate?: boolean;
  // Step 7: Compliance
  insuranceVerified?: boolean;
  authorityVerified?: boolean;
  safetyRating?: string;
  operatingAuthorityStatus?: string;
  cargoInsuranceAmount?: string;
  autoLiabilityAmount?: string;
  insuranceExpirationDate?: string;
  documents?: string[];
  // Notes
  publicNotes?: string;
  internalNotes?: string;
};

export type CreateTruckInput = Omit<TruckRecord, "createdAt" | "updatedAt">;

function describeError(err: unknown, op: string): Error {
  if (err instanceof Error) {
    const awsName = (err as { name?: string }).name;
    const status = (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
    const detail = [awsName && `${awsName}`, status && `HTTP ${status}`, err.message]
      .filter(Boolean)
      .join(" · ");
    console.error(`[DynamoDB Trucks ${op}]`, err);
    return new Error(`DynamoDB ${op} failed: ${detail}`);
  }
  console.error(`[DynamoDB Trucks ${op}]`, err);
  return new Error(`DynamoDB ${op} failed`);
}

export async function createTruck(input: CreateTruckInput): Promise<TruckRecord> {
  if (!input.truckBoardId) {
    throw new Error("truckBoardId is required to post a truck");
  }
  return runTrucksWriteLimited(async () => {
    try {
      const client = await getDynamoDocClient();
      const now = new Date().toISOString();
      const item: TruckRecord = {
        ...input,
        createdAt: now,
        updatedAt: now,
      };
      await client.send(
        new PutCommand({
          TableName: getTrucksTableName(),
          Item: item,
          ConditionExpression: "attribute_not_exists(truckBoardId)",
        }),
      );
      return item;
    } catch (err) {
      throw describeError(err, "PutItem");
    }
  });
}

export async function listAllTrucks(): Promise<TruckRecord[]> {
  return runTrucksReadLimited(async () => {
    try {
      const client = await getDynamoDocClient();
      const out = await client.send(new ScanCommand({ TableName: getTrucksTableName() }));
      return (out.Items as TruckRecord[] | undefined) ?? [];
    } catch (err) {
      throw describeError(err, "Scan");
    }
  });
}

export async function getTruckById(truckBoardId: string): Promise<TruckRecord | null> {
  if (!truckBoardId?.trim()) {
    throw new Error("truckBoardId is required");
  }
  return runTrucksReadLimited(async () => {
    try {
      const client = await getDynamoDocClient();
      const out = await client.send(
        new GetCommand({
          TableName: getTrucksTableName(),
          Key: { truckBoardId: truckBoardId.trim() },
        }),
      );
      const item = out.Item as TruckRecord | undefined;
      return item ?? null;
    } catch (err) {
      throw describeError(err, "GetItem");
    }
  });
}

/** Replace an existing truck item (preserves `createdAt` / `createdBy` from `record`). */
export async function updateTruck(record: TruckRecord): Promise<TruckRecord> {
  if (!record.truckBoardId?.trim()) {
    throw new Error("truckBoardId is required");
  }
  return runTrucksWriteLimited(async () => {
    try {
      const client = await getDynamoDocClient();
      const now = new Date().toISOString();
      const item: TruckRecord = {
        ...record,
        updatedAt: now,
      };
      await client.send(
        new PutCommand({
          TableName: getTrucksTableName(),
          Item: item,
          ConditionExpression: "attribute_exists(truckBoardId)",
        }),
      );
      return item;
    } catch (err) {
      throw describeError(err, "PutItem(update)");
    }
  });
}
