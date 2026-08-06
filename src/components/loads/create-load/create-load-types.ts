import type { LoadRecord } from "@/lib/loads-store";

export type LoadDraft = {
  // Step 1: basic
  loadId: string;
  loadType: string;
  loadStatus: string;
  customer: string;
  broker: string;
  dispatcher: string;
  equipmentType: string;
  trailerType: string;
  loadPriority: string;
  internalNotes: string;
  // Step 2: pickup
  pickupFacility: string;
  pickupAddress: string;
  pickupCity: string;
  pickupState: string;
  pickupZip: string;
  pickupContactName: string;
  pickupContactPhone: string;
  pickupContactEmail: string;
  pickupDate: string;
  pickupAppointmentTime: string;
  pickupWindowStart: string;
  pickupWindowEnd: string;
  pickupInstructions: string;
  pickupReference: string;
  // Step 2b: delivery
  deliveryFacility: string;
  deliveryAddress: string;
  deliveryCity: string;
  deliveryState: string;
  deliveryZip: string;
  deliveryContactName: string;
  deliveryContactPhone: string;
  deliveryContactEmail: string;
  deliveryDate: string;
  deliveryAppointmentTime: string;
  deliveryWindowStart: string;
  deliveryWindowEnd: string;
  deliveryInstructions: string;
  deliveryReference: string;
  // Step 3: freight
  commodityDescription: string;
  freightClass: string;
  weight: string;
  weightUnit: "lbs" | "kg";
  dimensions: string;
  palletCount: string;
  pieceCount: string;
  packagingType: string;
  temperatureRequirement: string;
  hazmat: boolean;
  hazmatUn: string;
  specialHandling: string[];
  sealNumber: string;
  loadValue: string;
  // Step 4: pricing
  customerRate: string;
  carrierRate: string;
  linehaulRate: string;
  fuelSurcharge: string;
  accessorialCharges: string;
  detentionRate: string;
  lumperFee: string;
  tonuFee: string;
  layoverFee: string;
  paymentTerms: string;
  // Step 5: carrier/driver
  assignedCarrier: string;
  assignedDriver: string;
  // Step 6: docs + tracking
  trackingRequired: boolean;
  trackingMethod: string;
  checkInRequired: boolean;
  checkOutRequired: boolean;
  documents: string[];
  insuranceVerified: boolean;
  authorityVerified: boolean;
  highValueFlag: boolean;
};

export const INITIAL: LoadDraft = {
  loadId: "",
  loadType: "",
  loadStatus: "draft",
  customer: "",
  broker: "",
  dispatcher: "",
  equipmentType: "",
  trailerType: "",
  loadPriority: "standard",
  internalNotes: "",
  pickupFacility: "",
  pickupAddress: "",
  pickupCity: "",
  pickupState: "",
  pickupZip: "",
  pickupContactName: "",
  pickupContactPhone: "",
  pickupContactEmail: "",
  pickupDate: "",
  pickupAppointmentTime: "",
  pickupWindowStart: "",
  pickupWindowEnd: "",
  pickupInstructions: "",
  pickupReference: "",
  deliveryFacility: "",
  deliveryAddress: "",
  deliveryCity: "",
  deliveryState: "",
  deliveryZip: "",
  deliveryContactName: "",
  deliveryContactPhone: "",
  deliveryContactEmail: "",
  deliveryDate: "",
  deliveryAppointmentTime: "",
  deliveryWindowStart: "",
  deliveryWindowEnd: "",
  deliveryInstructions: "",
  deliveryReference: "",
  commodityDescription: "",
  freightClass: "",
  weight: "",
  weightUnit: "lbs",
  dimensions: "",
  palletCount: "",
  pieceCount: "",
  packagingType: "",
  temperatureRequirement: "",
  hazmat: false,
  hazmatUn: "",
  specialHandling: [],
  sealNumber: "",
  loadValue: "",
  customerRate: "",
  carrierRate: "",
  linehaulRate: "",
  fuelSurcharge: "",
  accessorialCharges: "",
  detentionRate: "",
  lumperFee: "",
  tonuFee: "",
  layoverFee: "",
  paymentTerms: "",
  assignedCarrier: "",
  assignedDriver: "",
  trackingRequired: true,
  trackingMethod: "",
  checkInRequired: true,
  checkOutRequired: true,
  documents: [],
  insuranceVerified: false,
  authorityVerified: false,
  highValueFlag: false,
};

/** Map DynamoDB record → wizard draft (safe defaults for missing fields). */
export function recordToLoadDraft(r: LoadRecord): LoadDraft {
  return {
    ...INITIAL,
    loadId: r.loadId ?? "",
    loadType: r.loadType ?? "",
    loadStatus: r.loadStatus ?? "draft",
    customer: r.customer ?? "",
    broker: r.broker ?? "",
    dispatcher: r.dispatcher ?? "",
    equipmentType: r.equipmentType ?? "",
    trailerType: r.trailerType ?? "",
    loadPriority: r.loadPriority ?? "standard",
    internalNotes: r.internalNotes ?? "",
    pickupFacility: r.pickupFacility ?? "",
    pickupAddress: r.pickupAddress ?? "",
    pickupCity: r.pickupCity ?? "",
    pickupState: r.pickupState ?? "",
    pickupZip: r.pickupZip ?? "",
    pickupContactName: r.pickupContactName ?? "",
    pickupContactPhone: r.pickupContactPhone ?? "",
    pickupContactEmail: r.pickupContactEmail ?? "",
    pickupDate: r.pickupDate ?? "",
    pickupAppointmentTime: r.pickupAppointmentTime ?? "",
    pickupWindowStart: r.pickupWindowStart ?? "",
    pickupWindowEnd: r.pickupWindowEnd ?? "",
    pickupInstructions: r.pickupInstructions ?? "",
    pickupReference: r.pickupReference ?? "",
    deliveryFacility: r.deliveryFacility ?? "",
    deliveryAddress: r.deliveryAddress ?? "",
    deliveryCity: r.deliveryCity ?? "",
    deliveryState: r.deliveryState ?? "",
    deliveryZip: r.deliveryZip ?? "",
    deliveryContactName: r.deliveryContactName ?? "",
    deliveryContactPhone: r.deliveryContactPhone ?? "",
    deliveryContactEmail: r.deliveryContactEmail ?? "",
    deliveryDate: r.deliveryDate ?? "",
    deliveryAppointmentTime: r.deliveryAppointmentTime ?? "",
    deliveryWindowStart: r.deliveryWindowStart ?? "",
    deliveryWindowEnd: r.deliveryWindowEnd ?? "",
    deliveryInstructions: r.deliveryInstructions ?? "",
    deliveryReference: r.deliveryReference ?? "",
    commodityDescription: r.commodityDescription ?? "",
    freightClass: r.freightClass ?? "",
    weight: r.weight ?? "",
    weightUnit: r.weightUnit === "kg" ? "kg" : "lbs",
    dimensions: r.dimensions ?? "",
    palletCount: r.palletCount ?? "",
    pieceCount: r.pieceCount ?? "",
    packagingType: r.packagingType ?? "",
    temperatureRequirement: r.temperatureRequirement ?? "",
    hazmat: Boolean(r.hazmat),
    hazmatUn: r.hazmatUn ?? "",
    specialHandling: Array.isArray(r.specialHandling) ? [...r.specialHandling] : [],
    sealNumber: r.sealNumber ?? "",
    loadValue: r.loadValue ?? "",
    customerRate: r.customerRate ?? "",
    carrierRate: r.carrierRate ?? "",
    linehaulRate: r.linehaulRate ?? "",
    fuelSurcharge: r.fuelSurcharge ?? "",
    accessorialCharges: r.accessorialCharges ?? "",
    detentionRate: r.detentionRate ?? "",
    lumperFee: r.lumperFee ?? "",
    tonuFee: r.tonuFee ?? "",
    layoverFee: r.layoverFee ?? "",
    paymentTerms: r.paymentTerms ?? "",
    assignedCarrier: r.assignedCarrier ?? "",
    assignedDriver: r.assignedDriver ?? "",
    trackingRequired: r.trackingRequired ?? false,
    trackingMethod: r.trackingMethod ?? "",
    checkInRequired: r.checkInRequired ?? false,
    checkOutRequired: r.checkOutRequired ?? false,
    documents: Array.isArray(r.documents) ? [...r.documents] : [],
    insuranceVerified: Boolean(r.insuranceVerified),
    authorityVerified: Boolean(r.authorityVerified),
    highValueFlag: Boolean(r.highValueFlag),
  };
}

/** Merge edited draft back into an existing record (keeps PK and audit fields stable). */
export function loadDraftToRecord(draft: LoadDraft, existing: LoadRecord): LoadRecord {
  return {
    ...existing,
    ...draft,
    loadId: existing.loadId,
    createdAt: existing.createdAt,
    createdBy: existing.createdBy,
  };
}

export function computeLoadWizardStepErrors(draft: LoadDraft): Record<number, string[]> {
  const errs: Record<number, string[]> = { 1: [], 2: [], 3: [], 4: [], 5: [], 6: [], 7: [] };
  if (!draft.customer) errs[1].push("customer");
  if (!draft.equipmentType) errs[1].push("equipmentType");
  if (!draft.loadStatus) errs[1].push("loadStatus");
  if (!draft.pickupAddress) errs[2].push("pickupAddress");
  if (!draft.pickupDate) errs[2].push("pickupDate");
  if (!draft.pickupAppointmentTime && !(draft.pickupWindowStart && draft.pickupWindowEnd))
    errs[2].push("pickupTime");
  if (!draft.deliveryAddress) errs[2].push("deliveryAddress");
  if (!draft.deliveryDate) errs[2].push("deliveryDate");
  if (!draft.deliveryAppointmentTime && !(draft.deliveryWindowStart && draft.deliveryWindowEnd))
    errs[2].push("deliveryTime");
  if (!draft.commodityDescription) errs[3].push("commodityDescription");
  if (!draft.weight) errs[3].push("weight");
  if (!draft.customerRate) errs[4].push("customerRate");
  if (!draft.carrierRate) errs[4].push("carrierRate");
  if (!draft.assignedCarrier && !draft.assignedDriver) errs[5].push("assignment");
  return errs;
}

