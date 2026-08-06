import * as React from "react";
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Award,
  BadgeCheck,
  Calendar,
  CheckCircle2,
  ClipboardCheck,
  Clock,
  Compass,
  Container,
  DollarSign,
  FileText,
  Flag,
  Gauge,
  Hash,
  IdCard,
  Loader2,
  MapPin,
  Navigation,
  Package,
  Paperclip,
  Phone,
  Route as RouteIcon,
  Shield,
  ShieldCheck,
  ShieldX,
  Snowflake,
  Sparkles,
  Thermometer,
  Truck,
  User,
  Users,
  Wallet,
  Weight,
  X,
  Zap,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { FancySelect, type FancySelectOption } from "@/components/loads/fancy-select";
import {
  FacilityLocationInput,
  isFacilitySuggestionsTarget,
} from "@/components/loads/facility-location-input";
import { createTruck, type CreateTruckInput, type TruckRecord } from "@/lib/trucks-store";
import {
  removeStoredTruckDraft,
  shouldPersistTruckDraft,
  upsertStoredTruckDraft,
  type StoredTruckDraft,
} from "@/lib/truck-drafts-storage";
import { useAuth } from "@/lib/auth";

export type TruckDraft = {
  // Step 1: Availability
  truckBoardId: string;
  postingStatus: string;
  availableDate: string;
  availableTime: string;
  expirationDate: string;
  expirationTime: string;
  availableNow: boolean;
  availableUntilDate: string;
  hoursOfService: string;
  remainingDriveHours: string;
  earliestPickupTime: string;
  latestPickupTime: string;
  appointmentRequired: boolean;
  capacityStatus: string;
  // Step 2: Current Location
  currentCity: string;
  currentState: string;
  currentZip: string;
  currentCountry: string;
  currentAddress: string;
  facilityName: string;
  locationRadius: string;
  // Step 3: Equipment Details
  equipmentType: string;
  trailerType: string;
  truckType: string;
  truckNumber: string;
  trailerNumber: string;
  equipmentLength: string;
  equipmentWidth: string;
  equipmentHeight: string;
  maxWeightCapacity: string;
  doorType: string;
  temperatureRange: string;
  reeferUnitAvailable: boolean;
  teamDriverAvailable: boolean;
  powerOnlyAvailable: boolean;
  dropTrailerAvailable: boolean;
  liftgateAvailable: boolean;
  palletJackAvailable: boolean;
  strapsAvailable: boolean;
  loadBarsAvailable: boolean;
  tarpsAvailable: boolean;
  chainsAvailable: boolean;
  eTrackAvailable: boolean;
  hazmatCertified: boolean;
  tankerEndorsement: boolean;
  twicCard: boolean;
  teamService: boolean;
  airRide: boolean;
  foodGradeTrailer: boolean;
  // Step 4: Destination / Lane Preferences
  preferredDestinationCity: string;
  preferredDestinationState: string;
  preferredDestinationRegion: string;
  preferredLanes: string;
  avoidedLanes: string;
  willingDeadheadMiles: string;
  minimumTripMiles: string;
  maximumTripMiles: string;
  preferredStates: string[];
  excludedStates: string[];
  // Step 5: Carrier & Driver Contact
  carrierName: string;
  carrierMcNumber: string;
  carrierDotNumber: string;
  contactName: string;
  contactPhone: string;
  contactEmail: string;
  driverName: string;
  driverPhone: string;
  dispatcherName: string;
  dispatcherPhone: string;
  dispatcherEmail: string;
  // Step 6: Rate Preferences
  desiredRate: string;
  minimumRate: string;
  rateType: string;
  desiredRatePerMile: string;
  minimumRatePerMile: string;
  fuelSurchargePreference: string;
  paymentTerms: string;
  quickPayAccepted: boolean;
  negotiableRate: boolean;
  // Step 7: Compliance & Documents
  insuranceVerified: boolean;
  authorityVerified: boolean;
  safetyRating: string;
  operatingAuthorityStatus: string;
  cargoInsuranceAmount: string;
  autoLiabilityAmount: string;
  insuranceExpirationDate: string;
  documents: string[];
  // Notes
  publicNotes: string;
  internalNotes: string;
};

const INITIAL: TruckDraft = {
  truckBoardId: "",
  postingStatus: "active",
  availableDate: "",
  availableTime: "",
  expirationDate: "",
  expirationTime: "",
  availableNow: false,
  availableUntilDate: "",
  hoursOfService: "",
  remainingDriveHours: "",
  earliestPickupTime: "",
  latestPickupTime: "",
  appointmentRequired: false,
  capacityStatus: "open",
  currentCity: "",
  currentState: "",
  currentZip: "",
  currentCountry: "US",
  currentAddress: "",
  facilityName: "",
  locationRadius: "50",
  equipmentType: "",
  trailerType: "",
  truckType: "",
  truckNumber: "",
  trailerNumber: "",
  equipmentLength: "",
  equipmentWidth: "",
  equipmentHeight: "",
  maxWeightCapacity: "",
  doorType: "",
  temperatureRange: "",
  reeferUnitAvailable: false,
  teamDriverAvailable: false,
  powerOnlyAvailable: false,
  dropTrailerAvailable: false,
  liftgateAvailable: false,
  palletJackAvailable: false,
  strapsAvailable: false,
  loadBarsAvailable: false,
  tarpsAvailable: false,
  chainsAvailable: false,
  eTrackAvailable: false,
  hazmatCertified: false,
  tankerEndorsement: false,
  twicCard: false,
  teamService: false,
  airRide: false,
  foodGradeTrailer: false,
  preferredDestinationCity: "",
  preferredDestinationState: "",
  preferredDestinationRegion: "",
  preferredLanes: "",
  avoidedLanes: "",
  willingDeadheadMiles: "150",
  minimumTripMiles: "",
  maximumTripMiles: "",
  preferredStates: [],
  excludedStates: [],
  carrierName: "",
  carrierMcNumber: "",
  carrierDotNumber: "",
  contactName: "",
  contactPhone: "",
  contactEmail: "",
  driverName: "",
  driverPhone: "",
  dispatcherName: "",
  dispatcherPhone: "",
  dispatcherEmail: "",
  desiredRate: "",
  minimumRate: "",
  rateType: "flat",
  desiredRatePerMile: "",
  minimumRatePerMile: "",
  fuelSurchargePreference: "",
  paymentTerms: "",
  quickPayAccepted: false,
  negotiableRate: true,
  insuranceVerified: false,
  authorityVerified: false,
  safetyRating: "",
  operatingAuthorityStatus: "",
  cargoInsuranceAmount: "",
  autoLiabilityAmount: "",
  insuranceExpirationDate: "",
  documents: [],
  publicNotes: "",
  internalNotes: "",
};

const POSTING_STATUS_OPTIONS: FancySelectOption[] = [
  {
    value: "active",
    label: "Active",
    description: "Visible on the board to brokers",
    icon: Activity,
    badge: "Live",
  },
  {
    value: "pending",
    label: "Pending",
    description: "Awaiting dispatcher approval",
    icon: Clock,
  },
  {
    value: "matched",
    label: "Matched",
    description: "Tentatively matched to a load",
    icon: CheckCircle2,
  },
  {
    value: "booked",
    label: "Booked",
    description: "Hidden — capacity is committed",
    icon: ClipboardCheck,
  },
  {
    value: "paused",
    label: "Paused",
    description: "Temporarily hidden from the board",
    icon: Flag,
  },
  {
    value: "expired",
    label: "Expired",
    description: "Past the expiration date/time",
    icon: ShieldX,
  },
];

const CAPACITY_STATUS_OPTIONS: FancySelectOption[] = [
  { value: "open", label: "Open", description: "Full capacity available", icon: CheckCircle2 },
  { value: "partial", label: "Partial", description: "Some capacity remaining", icon: Package },
  { value: "preplanned", label: "Pre-planned", description: "Soft hold for a customer", icon: Calendar },
  { value: "deadhead", label: "Deadhead", description: "Empty repositioning move", icon: Navigation },
];

const EQUIPMENT_OPTIONS: FancySelectOption[] = [
  {
    value: "dry-van",
    label: "Dry Van",
    description: "53' enclosed trailer · general freight",
    icon: Truck,
    group: "Standard",
  },
  {
    value: "reefer",
    label: "Reefer",
    description: "Temperature-controlled trailer",
    icon: Snowflake,
    group: "Temp control",
  },
  {
    value: "flatbed",
    label: "Flatbed",
    description: "Open trailer · oversized freight",
    icon: Container,
    group: "Specialized",
  },
  {
    value: "step-deck",
    label: "Step Deck",
    description: "Lower-height flatbed for tall loads",
    icon: Container,
    group: "Specialized",
  },
  {
    value: "lowboy",
    label: "Lowboy / RGN",
    description: "Heavy haul · over-dimensional",
    icon: Container,
    group: "Specialized",
  },
  {
    value: "tanker",
    label: "Tanker",
    description: "Liquid bulk · food or chemical",
    icon: Container,
    group: "Specialized",
  },
  {
    value: "power-only",
    label: "Power Only",
    description: "Tractor for shipper-owned trailer",
    icon: Truck,
    group: "Standard",
  },
  {
    value: "hotshot",
    label: "Hotshot",
    description: "Class 3-5 truck with gooseneck",
    icon: Zap,
    group: "Specialized",
  },
];

const TRAILER_OPTIONS: FancySelectOption[] = [
  { value: "53-dry", label: "53' Dry Van", description: "Standard enclosed trailer" },
  { value: "48-dry", label: "48' Dry Van", description: "Shorter enclosed trailer" },
  { value: "53-reefer", label: "53' Reefer", description: "Temperature-controlled" },
  { value: "48-flat", label: "48' Flatbed", description: "Standard flatbed" },
  { value: "53-flat", label: "53' Flatbed", description: "Long flatbed" },
  { value: "step-deck", label: "Step Deck", description: "Drop-deck flatbed" },
  { value: "26ft-box", label: "26' Box Truck", description: "Straight truck for LTL" },
];

const TRUCK_TYPE_OPTIONS: FancySelectOption[] = [
  { value: "solo", label: "Solo", description: "Single driver", icon: User },
  { value: "team", label: "Team", description: "Two drivers · faster transit", icon: Users, badge: "Team" },
  { value: "owner-op", label: "Owner-Operator", description: "Independent contractor", icon: Award },
  { value: "fleet", label: "Fleet", description: "Carrier-managed power unit", icon: Truck },
];

const DOOR_TYPE_OPTIONS: FancySelectOption[] = [
  { value: "swing", label: "Swing Doors", description: "Standard barn doors" },
  { value: "roll-up", label: "Roll-Up", description: "Garage-style overhead door" },
  { value: "side-door", label: "Side Door", description: "Curtain or side access" },
];

const TEMPERATURE_OPTIONS: FancySelectOption[] = [
  {
    value: "ambient",
    label: "Ambient",
    description: "No temperature control",
    icon: Thermometer,
  },
  {
    value: "fresh",
    label: "Fresh (33–40°F)",
    description: "Refrigerated · produce, dairy",
    icon: Thermometer,
    badge: "Reefer",
  },
  {
    value: "frozen",
    label: "Frozen (-10–0°F)",
    description: "Frozen goods",
    icon: Snowflake,
    badge: "Reefer",
  },
  {
    value: "deep-frozen",
    label: "Deep Frozen (-20°F)",
    description: "Ice cream / pharma",
    icon: Snowflake,
    badge: "Reefer",
  },
];

const REGION_OPTIONS: FancySelectOption[] = [
  { value: "northeast", label: "Northeast", description: "NY, NJ, PA, MA, CT, ME, NH, RI, VT" },
  { value: "southeast", label: "Southeast", description: "FL, GA, SC, NC, VA, WV, AL, MS, TN, KY" },
  { value: "midwest", label: "Midwest", description: "OH, MI, IN, IL, WI, IA, MN, MO, KS, NE, ND, SD" },
  { value: "south", label: "South Central", description: "TX, OK, AR, LA" },
  { value: "mountain", label: "Mountain", description: "CO, UT, NM, AZ, ID, MT, WY" },
  { value: "west", label: "West Coast", description: "CA, OR, WA, NV" },
  { value: "national", label: "National", description: "Anywhere in the lower 48" },
];

const RATE_TYPE_OPTIONS: FancySelectOption[] = [
  { value: "flat", label: "Flat Rate", description: "Total amount per trip", icon: DollarSign },
  { value: "per-mile", label: "Per Mile", description: "Charged per loaded mile", icon: RouteIcon },
  { value: "percentage", label: "Percentage", description: "% of linehaul revenue", icon: Gauge },
  { value: "hourly", label: "Hourly", description: "Local / short-haul work", icon: Clock },
];

const FUEL_SURCHARGE_OPTIONS: FancySelectOption[] = [
  { value: "included", label: "Included in Rate", description: "All-in pricing" },
  { value: "separate", label: "Pay Separately", description: "DOE-indexed surcharge" },
  { value: "negotiable", label: "Negotiable", description: "Depends on lane / fuel index" },
];

const PAYMENT_TERMS_OPTIONS: FancySelectOption[] = [
  {
    value: "quickpay-2",
    label: "QuickPay (2 days)",
    description: "3% fee · paid in 2 business days",
    badge: "Fast",
  },
  { value: "net-7", label: "Net 7", description: "Paid 7 days after POD" },
  { value: "net-15", label: "Net 15", description: "Paid 15 days after POD" },
  { value: "net-30", label: "Net 30", description: "Paid 30 days after POD" },
  { value: "factoring", label: "Factoring", description: "Paid via factoring company" },
];

const SAFETY_RATING_OPTIONS: FancySelectOption[] = [
  { value: "satisfactory", label: "Satisfactory", description: "FMCSA satisfactory rating", icon: ShieldCheck, badge: "Good" },
  { value: "conditional", label: "Conditional", description: "Compliance issues identified", icon: Shield, badge: "Watch" },
  { value: "unrated", label: "Unrated", description: "No formal FMCSA rating", icon: Shield },
  { value: "unsatisfactory", label: "Unsatisfactory", description: "Failed safety audit", icon: ShieldX, badge: "Block" },
];

const AUTHORITY_STATUS_OPTIONS: FancySelectOption[] = [
  { value: "active", label: "Active", description: "Authority is in good standing", icon: BadgeCheck, badge: "Active" },
  { value: "pending", label: "Pending", description: "Application in progress", icon: Clock },
  { value: "inactive", label: "Inactive", description: "Authority has lapsed", icon: ShieldX },
  { value: "revoked", label: "Revoked", description: "Authority has been revoked", icon: ShieldX, badge: "Block" },
];

const STATE_OPTIONS: FancySelectOption[] = [
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA",
  "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD",
  "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ",
  "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC",
  "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY",
].map((s) => ({ value: s, label: s, description: `US state · ${s}` }));

const EQUIPMENT_FEATURE_OPTIONS = [
  { id: "reeferUnitAvailable", label: "Reefer Unit", icon: Snowflake, hint: "Active refrigeration unit" },
  { id: "liftgateAvailable", label: "Liftgate", icon: ArrowRight, hint: "Hydraulic lift platform" },
  { id: "palletJackAvailable", label: "Pallet Jack", icon: Package, hint: "Onboard pallet jack" },
  { id: "strapsAvailable", label: "Straps", icon: Shield, hint: "Cargo securement straps" },
  { id: "loadBarsAvailable", label: "Load Bars", icon: Shield, hint: "Adjustable load bars" },
  { id: "tarpsAvailable", label: "Tarps", icon: Shield, hint: "Steel / lumber tarps" },
  { id: "chainsAvailable", label: "Chains", icon: Shield, hint: "Binders and chains" },
  { id: "eTrackAvailable", label: "E-Track", icon: Shield, hint: "E-track tie-down system" },
  { id: "airRide", label: "Air Ride", icon: Sparkles, hint: "Air-ride suspension" },
  { id: "foodGradeTrailer", label: "Food Grade", icon: BadgeCheck, hint: "Food-grade certified trailer" },
] as const;

const SERVICE_FEATURE_OPTIONS = [
  { id: "teamDriverAvailable", label: "Team Driver", icon: Users },
  { id: "powerOnlyAvailable", label: "Power Only", icon: Truck },
  { id: "dropTrailerAvailable", label: "Drop Trailer", icon: Container },
  { id: "hazmatCertified", label: "Hazmat Certified", icon: ShieldCheck },
  { id: "tankerEndorsement", label: "Tanker Endorsement", icon: Container },
  { id: "twicCard", label: "TWIC Card", icon: IdCard },
] as const;

const DOCUMENT_OPTIONS = [
  { id: "insurance-cert", label: "Insurance Certificate", icon: ShieldCheck },
  { id: "w-9", label: "W-9", icon: FileText },
  { id: "carrier-packet", label: "Carrier Packet", icon: FileText },
  { id: "authority-doc", label: "Operating Authority", icon: BadgeCheck },
  { id: "trailer-inspection", label: "Trailer Inspection", icon: ClipboardCheck },
  { id: "driver-docs", label: "Driver Documents", icon: IdCard },
  { id: "equipment-photos", label: "Equipment Photos", icon: Paperclip },
  { id: "other", label: "Other Attachments", icon: Paperclip },
] as const;

export const TRUCK_FORM_STEPS = [
  { id: 1, label: "Availability", description: "When the truck is open", icon: Calendar },
  { id: 2, label: "Current Location", description: "Where the truck is now", icon: MapPin },
  { id: 3, label: "Equipment Details", description: "Truck, trailer, capacity", icon: Truck },
  { id: 4, label: "Destination & Lanes", description: "Where they want to go", icon: Compass },
  { id: 5, label: "Carrier & Driver", description: "Contact information", icon: Users },
  { id: 6, label: "Rate Preferences", description: "Pricing expectations", icon: DollarSign },
  { id: 7, label: "Compliance & Docs", description: "Insurance & authority", icon: ShieldCheck },
  { id: 8, label: "Review & Post", description: "Confirm and publish", icon: CheckCircle2 },
] as const;

function stripUndefined<T extends Record<string, unknown>>(obj: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v !== undefined && v !== null),
  ) as Partial<T>;
}

/** Map DynamoDB record → wizard draft (safe defaults for missing fields). */
export function recordToTruckDraft(r: TruckRecord): TruckDraft {
  return {
    ...INITIAL,
    ...stripUndefined(r as unknown as Record<string, unknown>),
    truckBoardId: r.truckBoardId,
    preferredStates: Array.isArray(r.preferredStates) ? [...r.preferredStates] : INITIAL.preferredStates,
    excludedStates: Array.isArray(r.excludedStates) ? [...r.excludedStates] : INITIAL.excludedStates,
    documents: Array.isArray(r.documents) ? [...r.documents] : INITIAL.documents,
  };
}

export function truckDraftToRecord(draft: TruckDraft, existing: TruckRecord): TruckRecord {
  return {
    ...existing,
    ...draft,
    truckBoardId: existing.truckBoardId,
    createdAt: existing.createdAt,
    createdBy: existing.createdBy,
  };
}

export function computeTruckWizardStepErrors(draft: TruckDraft): Record<number, string[]> {
  const errs: Record<number, string[]> = { 1: [], 2: [], 3: [], 4: [], 5: [], 6: [], 7: [], 8: [] };
  if (!draft.postingStatus) errs[1].push("postingStatus");
  if (!draft.availableNow && !draft.availableDate) errs[1].push("availableDate");
  if (!draft.availableNow && !draft.availableTime) errs[1].push("availableTime");
  if (!draft.currentCity) errs[2].push("currentCity");
  if (!draft.currentState) errs[2].push("currentState");
  if (!draft.equipmentType) errs[3].push("equipmentType");
  if (!draft.maxWeightCapacity) errs[3].push("maxWeightCapacity");
  const hasDestination =
    draft.preferredDestinationCity ||
    draft.preferredDestinationState ||
    draft.preferredDestinationRegion ||
    draft.preferredLanes ||
    draft.preferredStates.length > 0;
  if (!hasDestination) errs[4].push("destination");
  if (!draft.carrierName) errs[5].push("carrierName");
  if (!draft.carrierMcNumber && !draft.carrierDotNumber) errs[5].push("carrierAuthority");
  if (!draft.contactName) errs[5].push("contactName");
  if (!draft.contactPhone) errs[5].push("contactPhone");
  return errs;
}

function generateTruckBoardId() {
  const n = Math.floor(4100 + Math.random() * 999);
  return `T-${n}`;
}

export function CreateTruckDialog({
  trigger,
  onCreated,
  onDraftSaved,
  open: controlledOpen,
  onOpenChange,
  resumeDraft,
}: {
  trigger?: React.ReactNode;
  onCreated?: (truckBoardId: string) => void;
  onDraftSaved?: () => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  resumeDraft?: StoredTruckDraft | null;
}) {
  const { user } = useAuth();
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(false);
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : uncontrolledOpen;

  const setOpenRaw = React.useCallback(
    (next: boolean) => {
      if (isControlled) {
        onOpenChange?.(next);
      } else {
        setUncontrolledOpen(next);
      }
    },
    [isControlled, onOpenChange],
  );

  const [step, setStep] = React.useState(1);
  const [submitting, setSubmitting] = React.useState(false);
  const [submitError, setSubmitError] = React.useState<string | null>(null);
  const [draft, setDraft] = React.useState<TruckDraft>(() => ({
    ...INITIAL,
    truckBoardId: generateTruckBoardId(),
  }));
  const [touched, setTouched] = React.useState<Record<number, boolean>>({});

  const openRef = React.useRef(open);
  const draftRef = React.useRef(draft);
  const stepRef = React.useRef(step);
  const draftStorageIdRef = React.useRef<string | null>(null);
  const skipDraftSaveRef = React.useRef(false);
  const resumeDraftRef = React.useRef(resumeDraft);

  openRef.current = open;
  draftRef.current = draft;
  stepRef.current = step;
  resumeDraftRef.current = resumeDraft;

  const update = React.useCallback(<K extends keyof TruckDraft>(key: K, value: TruckDraft[K]) => {
    setDraft((d) => ({ ...d, [key]: value }));
  }, []);

  const reset = React.useCallback(() => {
    draftStorageIdRef.current = null;
    setDraft({ ...INITIAL, truckBoardId: generateTruckBoardId() });
    setStep(1);
    setTouched({});
    setSubmitError(null);
  }, []);

  const applyResumeDraft = React.useCallback((stored: StoredTruckDraft) => {
    draftStorageIdRef.current = stored.id;
    setDraft(stored.draft);
    setStep(Math.min(8, Math.max(1, stored.step)));
    setTouched({});
    setSubmitError(null);
  }, []);

  const persistDraftIfNeeded = React.useCallback(() => {
    if (skipDraftSaveRef.current) return false;
    const current = draftRef.current;
    const currentStep = stepRef.current;
    const hasStoredDraft = Boolean(draftStorageIdRef.current);
    if (!shouldPersistTruckDraft(current, currentStep, { hasStoredDraft })) return false;
    const id = draftStorageIdRef.current ?? current.truckBoardId;
    draftStorageIdRef.current = id;
    upsertStoredTruckDraft({
      id,
      savedAt: new Date().toISOString(),
      step: currentStep,
      draft: current,
    });
    onDraftSaved?.();
    return true;
  }, [onDraftSaved]);

  const closeWithDraftSave = React.useCallback(() => {
    if (!openRef.current) return;
    persistDraftIfNeeded();
    skipDraftSaveRef.current = false;
    setOpenRaw(false);
  }, [persistDraftIfNeeded, setOpenRaw]);

  const handleOpenChange = React.useCallback(
    (next: boolean) => {
      if (!next) {
        if (openRef.current) {
          persistDraftIfNeeded();
          skipDraftSaveRef.current = false;
        }
      } else if (next) {
        const stored = resumeDraftRef.current;
        if (stored) {
          applyResumeDraft(stored);
        } else {
          reset();
        }
      }
      setOpenRaw(next);
    },
    [persistDraftIfNeeded, applyResumeDraft, reset, setOpenRaw],
  );

  React.useEffect(() => {
    if (!open) {
      const t = setTimeout(reset, 200);
      return () => clearTimeout(t);
    }
    if (resumeDraft) {
      applyResumeDraft(resumeDraft);
    } else if (isControlled) {
      reset();
    }
  }, [open, resumeDraft, isControlled, applyResumeDraft, reset]);

  const stepErrors = React.useMemo(() => computeTruckWizardStepErrors(draft), [draft]);

  const canAdvance = stepErrors[step].length === 0;

  const goNext = () => {
    setTouched((t) => ({ ...t, [step]: true }));
    if (!canAdvance) return;
    setStep((s) => Math.min(8, s + 1));
  };
  const goBack = () => setStep((s) => Math.max(1, s - 1));

  const handleSubmit = async () => {
    setTouched({ 1: true, 2: true, 3: true, 4: true, 5: true, 6: true, 7: true });
    const blocking = [1, 2, 3, 4, 5].some((s) => stepErrors[s].length > 0);
    if (blocking) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const payload: CreateTruckInput = {
        ...draft,
        createdBy: user?.userId,
      };
      await createTruck(payload);
      skipDraftSaveRef.current = true;
      if (draftStorageIdRef.current) {
        removeStoredTruckDraft(draftStorageIdRef.current);
        onDraftSaved?.();
      }
      onCreated?.(draft.truckBoardId);
      setOpenRaw(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to post truck to DynamoDB.";
      setSubmitError(message);
    } finally {
      setSubmitting(false);
    }
  };

  const progress = (step / 8) * 100;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      {trigger ? <DialogTrigger asChild>{trigger}</DialogTrigger> : null}
      <DialogContent
        showCloseButton={false}
        className="!max-w-6xl w-[96vw] gap-0 overflow-hidden border-border/70 p-0 sm:rounded-2xl"
        onInteractOutside={(e) => {
          if (isFacilitySuggestionsTarget(e.target)) return;
          e.preventDefault();
        }}
        onPointerDownOutside={(e) => {
          if (isFacilitySuggestionsTarget(e.target)) {
            e.preventDefault();
          }
        }}
      >
        <DialogTitle className="sr-only">Post Truck</DialogTitle>
        <DialogDescription className="sr-only">
          Post a truck with equipment, location, availability, and pricing details.
        </DialogDescription>
        <div className="grid h-[88vh] grid-cols-1 lg:grid-cols-[280px_1fr]">
          {/* Stepper sidebar */}
          <aside className="hidden flex-col bg-sidebar text-sidebar-foreground lg:flex">
            <div className="flex items-center gap-2 border-b border-sidebar-border/60 px-5 py-4">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-sidebar-primary/15 text-sidebar-primary">
                <Truck className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <div className="text-sm font-semibold tracking-tight text-sidebar-accent-foreground">
                  Post Truck
                </div>
                <div className="truncate text-xs text-sidebar-foreground/70">
                  {draft.truckBoardId} ·{" "}
                  {lookup(POSTING_STATUS_OPTIONS, draft.postingStatus) || "Draft"}
                </div>
              </div>
            </div>
            <div className="px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-sidebar-foreground/60">
              Progress
            </div>
            <div className="px-5">
              <div className="h-1 w-full overflow-hidden rounded-full bg-sidebar-accent/40">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-sidebar-primary to-info transition-all"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <div className="mt-2 text-xs text-sidebar-foreground/70">Step {step} of 8</div>
            </div>
            <nav className="mt-4 flex-1 space-y-0.5 overflow-y-auto px-2 pb-4">
              {TRUCK_FORM_STEPS.map((s) => {
                const Icon = s.icon;
                const isActive = step === s.id;
                const isComplete = step > s.id && (stepErrors[s.id]?.length ?? 0) === 0;
                const hasErrors = touched[s.id] && (stepErrors[s.id]?.length ?? 0) > 0;
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setStep(s.id)}
                    className={cn(
                      "group flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-all",
                      isActive
                        ? "bg-sidebar-accent text-sidebar-accent-foreground"
                        : "hover:bg-sidebar-accent/60 text-sidebar-foreground/80 hover:text-sidebar-accent-foreground",
                    )}
                  >
                    <span
                      className={cn(
                        "flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-xs font-semibold transition-colors",
                        isActive
                          ? "bg-sidebar-primary text-sidebar-primary-foreground shadow-sm shadow-sidebar-primary/40"
                          : isComplete
                            ? "bg-success/25 text-success"
                            : hasErrors
                              ? "bg-destructive/25 text-destructive"
                              : "bg-sidebar-accent/60 text-sidebar-foreground/70",
                      )}
                    >
                      {isComplete ? (
                        <CheckCircle2 className="h-3.5 w-3.5" />
                      ) : hasErrors ? (
                        <AlertTriangle className="h-3.5 w-3.5" />
                      ) : (
                        <Icon className="h-3.5 w-3.5" />
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{s.label}</span>
                      <span className="block truncate text-[11px] text-sidebar-foreground/60">
                        {s.description}
                      </span>
                    </span>
                  </button>
                );
              })}
            </nav>
            <div className="border-t border-sidebar-border/60 px-5 py-3 text-xs text-sidebar-foreground/70">
              Close or Cancel saves to Drafts.
            </div>
          </aside>

          {/* Main content */}
          <div className="flex min-h-0 flex-col bg-background">
            <div className="flex items-center justify-between border-b border-border/70 px-6 py-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="inline-flex h-5 items-center rounded-full bg-primary/10 px-2 font-semibold text-primary">
                    Step {step}
                  </span>
                  <span>·</span>
                  <span className="truncate">{TRUCK_FORM_STEPS[step - 1].description}</span>
                </div>
                <h2 className="mt-0.5 text-lg font-semibold tracking-tight text-foreground">
                  {TRUCK_FORM_STEPS[step - 1].label}
                </h2>
              </div>
              <button
                type="button"
                onClick={closeWithDraftSave}
                className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                aria-label="Close and save draft"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="border-b border-border/70 px-6 py-2 lg:hidden">
              <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-primary to-info transition-all"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
              {step === 1 && (
                <StepAvailability
                  draft={draft}
                  update={update}
                  touched={!!touched[1]}
                  errors={stepErrors[1]}
                />
              )}
              {step === 2 && (
                <StepLocation
                  draft={draft}
                  update={update}
                  touched={!!touched[2]}
                  errors={stepErrors[2]}
                />
              )}
              {step === 3 && (
                <StepEquipment
                  draft={draft}
                  update={update}
                  touched={!!touched[3]}
                  errors={stepErrors[3]}
                />
              )}
              {step === 4 && (
                <StepDestination
                  draft={draft}
                  update={update}
                  touched={!!touched[4]}
                  errors={stepErrors[4]}
                />
              )}
              {step === 5 && (
                <StepCarrier
                  draft={draft}
                  update={update}
                  touched={!!touched[5]}
                  errors={stepErrors[5]}
                />
              )}
              {step === 6 && <StepRate draft={draft} update={update} />}
              {step === 7 && <StepCompliance draft={draft} update={update} />}
              {step === 8 && (
                <StepReview draft={draft} stepErrors={stepErrors} onJump={setStep} />
              )}
            </div>

            <div className="flex items-center justify-between gap-3 border-t border-border/70 bg-muted/30 px-6 py-3">
              <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
                {submitError ? (
                  <span className="inline-flex items-center gap-1 truncate rounded-md bg-destructive/12 px-2 py-1 font-medium text-destructive">
                    <AlertTriangle className="h-3 w-3 shrink-0" />
                    <span className="truncate" title={submitError}>
                      {submitError}
                    </span>
                  </span>
                ) : touched[step] && stepErrors[step].length > 0 ? (
                  <span className="inline-flex items-center gap-1 rounded-md bg-destructive/12 px-2 py-1 font-medium text-destructive">
                    <AlertTriangle className="h-3 w-3" />
                    {stepErrors[step].length} required field
                    {stepErrors[step].length === 1 ? "" : "s"} missing
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5">
                    <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/50" />
                    Cancel saves to Drafts
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={closeWithDraftSave}
                  className="text-muted-foreground hover:text-foreground"
                >
                  Cancel
                </Button>
                {step > 1 && (
                  <Button type="button" variant="outline" size="sm" onClick={goBack}>
                    <ArrowLeft className="h-4 w-4" /> Back
                  </Button>
                )}
                {step < 8 ? (
                  <Button
                    type="button"
                    size="sm"
                    onClick={goNext}
                    className="bg-gradient-to-r from-primary to-info text-primary-foreground shadow-sm shadow-primary/30 hover:opacity-95"
                  >
                    Continue <ArrowRight className="h-4 w-4" />
                  </Button>
                ) : (
                  <Button
                    type="button"
                    size="sm"
                    disabled={submitting}
                    onClick={handleSubmit}
                    className="bg-gradient-to-r from-success to-primary text-primary-foreground shadow-sm shadow-success/30 hover:opacity-95"
                  >
                    {submitting ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" /> Posting…
                      </>
                    ) : (
                      <>
                        <CheckCircle2 className="h-4 w-4" /> Post Truck
                      </>
                    )}
                  </Button>
                )}
              </div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---------- Shared building blocks ----------

function SectionTitle({
  title,
  hint,
  icon: Icon,
}: {
  title: string;
  hint?: string;
  icon?: LucideIcon;
}) {
  return (
    <div className="mb-3 flex items-center gap-2">
      {Icon && (
        <span className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/10 text-primary">
          <Icon className="h-3.5 w-3.5" />
        </span>
      )}
      <div className="min-w-0">
        <div className="text-sm font-semibold tracking-tight text-foreground">{title}</div>
        {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
      </div>
    </div>
  );
}

function FieldShell({
  label,
  required,
  hint,
  error,
  children,
  htmlFor,
  className,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  error?: boolean;
  children: React.ReactNode;
  htmlFor?: string;
  className?: string;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor={htmlFor} className="text-xs font-medium text-foreground">
          {label}
          {required && <span className="ml-1 text-destructive">*</span>}
        </Label>
        {hint && <span className="text-[10px] text-muted-foreground">{hint}</span>}
      </div>
      {children}
      {error && (
        <div className="text-[11px] font-medium text-destructive">This field is required.</div>
      )}
    </div>
  );
}

function GridSection({
  cols = 2,
  children,
  className,
}: {
  cols?: 1 | 2 | 3 | 4;
  children: React.ReactNode;
  className?: string;
}) {
  const map = {
    1: "grid-cols-1",
    2: "sm:grid-cols-2",
    3: "sm:grid-cols-2 lg:grid-cols-3",
    4: "sm:grid-cols-2 lg:grid-cols-4",
  };
  return <div className={cn("grid gap-4", map[cols], className)}>{children}</div>;
}

function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("rounded-xl border border-border/70 bg-card/60 p-5 shadow-sm", className)}>
      {children}
    </div>
  );
}

function ToggleTile({
  label,
  description,
  checked,
  onChange,
  icon: Icon,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  icon: LucideIcon;
}) {
  return (
    <label
      className={cn(
        "flex cursor-pointer items-start gap-3 rounded-lg border bg-card p-3 transition-all",
        checked
          ? "border-primary/60 bg-primary/5 shadow-sm shadow-primary/10"
          : "border-border hover:border-primary/30",
      )}
    >
      <span
        className={cn(
          "flex h-8 w-8 shrink-0 items-center justify-center rounded-md",
          checked ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
        )}
      >
        <Icon className="h-4 w-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-foreground">{label}</span>
        {description && (
          <span className="block text-xs text-muted-foreground">{description}</span>
        )}
      </span>
      <Switch checked={checked} onCheckedChange={onChange} />
    </label>
  );
}

function ChipToggle({
  label,
  icon: Icon,
  active,
  onClick,
}: {
  label: string;
  icon: LucideIcon;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm transition-all",
        active
          ? "border-primary/60 bg-primary/8 text-foreground shadow-sm shadow-primary/10"
          : "border-border bg-card text-muted-foreground hover:border-primary/30 hover:text-foreground",
      )}
    >
      <span
        className={cn(
          "flex h-6 w-6 items-center justify-center rounded-md",
          active ? "bg-primary text-primary-foreground" : "bg-muted",
        )}
      >
        <Icon className="h-3.5 w-3.5" />
      </span>
      <span className="text-xs font-medium">{label}</span>
    </button>
  );
}

function MoneyInput({
  value,
  onChange,
  placeholder,
  suffix,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  suffix?: string;
}) {
  return (
    <div
      className={cn(
        "flex h-10 items-center gap-1 rounded-lg border bg-card px-3 shadow-sm transition-all",
        "border-input focus-within:border-primary/60 focus-within:ring-2 focus-within:ring-primary/20",
      )}
    >
      <span className="text-sm font-semibold text-muted-foreground">$</span>
      <input
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-full w-full bg-transparent text-sm font-medium tabular-nums outline-none placeholder:text-muted-foreground"
      />
      <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {suffix ?? "USD"}
      </span>
    </div>
  );
}

function lookup(opts: FancySelectOption[], v: string) {
  return opts.find((o) => o.value === v)?.label ?? "";
}

function toNumber(v: string) {
  const n = parseFloat(v.replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

// ---------- Step 1: Availability ----------

export function StepAvailability({
  draft,
  update,
  touched,
  errors,
  immutableTruckBoardId,
}: {
  draft: TruckDraft;
  update: <K extends keyof TruckDraft>(k: K, v: TruckDraft[K]) => void;
  touched: boolean;
  errors: string[];
  immutableTruckBoardId?: boolean;
}) {
  const isErr = (k: string) => touched && errors.includes(k);
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <Card>
        <SectionTitle title="Posting identity" hint="Board reference and status" icon={Hash} />
        <GridSection cols={3}>
          <FieldShell label="Truck Board ID" hint={immutableTruckBoardId ? "Primary key · cannot change" : "Auto-generated"}>
            <Input
              value={draft.truckBoardId}
              onChange={(e) => update("truckBoardId", e.target.value)}
              placeholder="T-0000"
              readOnly={immutableTruckBoardId}
              disabled={immutableTruckBoardId}
              className={immutableTruckBoardId ? "cursor-not-allowed bg-muted/60" : undefined}
            />
          </FieldShell>
          <FieldShell label="Posting Status" required error={isErr("postingStatus")}>
            <FancySelect
              value={draft.postingStatus}
              onChange={(v) => update("postingStatus", v)}
              options={POSTING_STATUS_OPTIONS}
              triggerIcon={Activity}
              error={isErr("postingStatus")}
              placeholder="Set status"
            />
          </FieldShell>
          <FieldShell label="Capacity Status">
            <FancySelect
              value={draft.capacityStatus}
              onChange={(v) => update("capacityStatus", v)}
              options={CAPACITY_STATUS_OPTIONS}
              triggerIcon={Package}
              placeholder="How much is open"
            />
          </FieldShell>
        </GridSection>
      </Card>

      <Card>
        <SectionTitle title="Availability window" hint="When the truck is ready" icon={Calendar} />
        <ToggleTile
          label="Available right now"
          description="Truck is empty and ready to dispatch immediately"
          checked={draft.availableNow}
          onChange={(v) => update("availableNow", v)}
          icon={Zap}
        />
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <FieldShell
            label="Available Date"
            required={!draft.availableNow}
            error={isErr("availableDate")}
          >
            <Input
              type="date"
              value={draft.availableDate}
              onChange={(e) => update("availableDate", e.target.value)}
              disabled={draft.availableNow}
              className={cn(isErr("availableDate") && "border-destructive/60")}
            />
          </FieldShell>
          <FieldShell
            label="Available Time"
            required={!draft.availableNow}
            error={isErr("availableTime")}
          >
            <Input
              type="time"
              value={draft.availableTime}
              onChange={(e) => update("availableTime", e.target.value)}
              disabled={draft.availableNow}
              className={cn(isErr("availableTime") && "border-destructive/60")}
            />
          </FieldShell>
          <FieldShell label="Available Until">
            <Input
              type="date"
              value={draft.availableUntilDate}
              onChange={(e) => update("availableUntilDate", e.target.value)}
              placeholder="Optional"
            />
          </FieldShell>
          <FieldShell label="Expiration Date" hint="Auto-remove">
            <Input
              type="date"
              value={draft.expirationDate}
              onChange={(e) => update("expirationDate", e.target.value)}
            />
          </FieldShell>
          <FieldShell label="Expiration Time">
            <Input
              type="time"
              value={draft.expirationTime}
              onChange={(e) => update("expirationTime", e.target.value)}
            />
          </FieldShell>
          <FieldShell label="Appointment Required">
            <div className="flex h-10 items-center justify-between rounded-lg border border-input bg-card px-3">
              <span className="text-sm text-muted-foreground">
                Pickup needs appointment scheduling
              </span>
              <Switch
                checked={draft.appointmentRequired}
                onCheckedChange={(v) => update("appointmentRequired", v)}
              />
            </div>
          </FieldShell>
        </div>
      </Card>

      <Card>
        <SectionTitle title="Pickup window & HOS" hint="Driver hours and timing" icon={Clock} />
        <GridSection cols={4}>
          <FieldShell label="Earliest Pickup">
            <Input
              type="time"
              value={draft.earliestPickupTime}
              onChange={(e) => update("earliestPickupTime", e.target.value)}
            />
          </FieldShell>
          <FieldShell label="Latest Pickup">
            <Input
              type="time"
              value={draft.latestPickupTime}
              onChange={(e) => update("latestPickupTime", e.target.value)}
            />
          </FieldShell>
          <FieldShell label="Remaining Drive Hours" hint="HOS">
            <Input
              inputMode="decimal"
              value={draft.remainingDriveHours}
              onChange={(e) => update("remainingDriveHours", e.target.value)}
              placeholder="9.5"
            />
          </FieldShell>
          <FieldShell label="On-Duty Hours Available">
            <Input
              inputMode="decimal"
              value={draft.hoursOfService}
              onChange={(e) => update("hoursOfService", e.target.value)}
              placeholder="11"
            />
          </FieldShell>
        </GridSection>
      </Card>
    </div>
  );
}

// ---------- Step 2: Location ----------

export function StepLocation({
  draft,
  update,
  touched,
  errors,
}: {
  draft: TruckDraft;
  update: <K extends keyof TruckDraft>(k: K, v: TruckDraft[K]) => void;
  touched: boolean;
  errors: string[];
}) {
  const isErr = (k: string) => touched && errors.includes(k);
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <Card className="overflow-visible">
        <SectionTitle title="Current location" hint="Where the truck is sitting" icon={MapPin} />
        <FieldShell label="Facility / Yard Name">
          <FacilityLocationInput
            value={draft.facilityName}
            onChange={(v) => update("facilityName", v)}
            onResolved={(facility, result) => {
              update("facilityName", facility);
              update("currentAddress", result.address);
              update("currentCity", result.city);
              update("currentState", result.state);
              update("currentZip", result.zip);
            }}
            placeholder="e.g. TA Truck Stop, Dallas TX"
          />
        </FieldShell>
        <div className="mt-4 grid gap-4 sm:grid-cols-6">
          <FieldShell label="City" required error={isErr("currentCity")} className="sm:col-span-3">
            <Input
              value={draft.currentCity}
              onChange={(e) => update("currentCity", e.target.value)}
              placeholder="Atlanta"
              className={cn(isErr("currentCity") && "border-destructive/60")}
            />
          </FieldShell>
          <FieldShell label="State" required error={isErr("currentState")} className="sm:col-span-2">
            <FancySelect
              value={draft.currentState}
              onChange={(v) => update("currentState", v)}
              options={STATE_OPTIONS}
              placeholder="State"
              triggerIcon={MapPin}
              error={isErr("currentState")}
            />
          </FieldShell>
          <FieldShell label="ZIP" className="sm:col-span-1">
            <Input
              value={draft.currentZip}
              onChange={(e) => update("currentZip", e.target.value)}
              placeholder="30301"
            />
          </FieldShell>
        </div>
        <div className="mt-4">
          <FieldShell label="Street Address" hint="Optional">
            <Input
              value={draft.currentAddress}
              onChange={(e) => update("currentAddress", e.target.value)}
              placeholder="1234 Industrial Blvd"
            />
          </FieldShell>
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <FieldShell label="Country">
            <FancySelect
              value={draft.currentCountry}
              onChange={(v) => update("currentCountry", v)}
              options={[
                { value: "US", label: "United States", description: "USA · Lower 48" },
                { value: "CA", label: "Canada", description: "Cross-border allowed" },
                { value: "MX", label: "Mexico", description: "Cross-border allowed" },
              ]}
              triggerIcon={Compass}
            />
          </FieldShell>
          <FieldShell label="Search Radius" hint="miles">
            <Input
              inputMode="numeric"
              value={draft.locationRadius}
              onChange={(e) => update("locationRadius", e.target.value)}
              placeholder="50"
            />
          </FieldShell>
        </div>
      </Card>

      <Card className="border-info/30 bg-info/5">
        <div className="flex items-start gap-3">
          <span className="flex h-8 w-8 items-center justify-center rounded-md bg-info/15 text-info">
            <Navigation className="h-4 w-4" />
          </span>
          <div className="text-sm">
            <div className="font-semibold text-foreground">Location auto-update</div>
            <div className="mt-0.5 text-xs text-muted-foreground">
              When tracking is enabled in Step 7, the truck's location updates automatically from
              the connected ELD / GPS feed. The values above will only be used as a starting
              position.
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}

// ---------- Step 3: Equipment ----------

export function StepEquipment({
  draft,
  update,
  touched,
  errors,
}: {
  draft: TruckDraft;
  update: <K extends keyof TruckDraft>(k: K, v: TruckDraft[K]) => void;
  touched: boolean;
  errors: string[];
}) {
  const isErr = (k: string) => touched && errors.includes(k);
  const isReefer =
    draft.equipmentType === "reefer" ||
    draft.trailerType === "53-reefer" ||
    draft.reeferUnitAvailable;
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <Card>
        <SectionTitle title="Truck & trailer" hint="Equipment basics" icon={Truck} />
        <GridSection cols={3}>
          <FieldShell label="Equipment Type" required error={isErr("equipmentType")}>
            <FancySelect
              value={draft.equipmentType}
              onChange={(v) => update("equipmentType", v)}
              options={EQUIPMENT_OPTIONS}
              triggerIcon={Truck}
              error={isErr("equipmentType")}
              placeholder="Dry van, reefer..."
            />
          </FieldShell>
          <FieldShell label="Trailer Type">
            <FancySelect
              value={draft.trailerType}
              onChange={(v) => update("trailerType", v)}
              options={TRAILER_OPTIONS}
              triggerIcon={Container}
              placeholder="Trailer dimensions"
            />
          </FieldShell>
          <FieldShell label="Truck Type">
            <FancySelect
              value={draft.truckType}
              onChange={(v) => update("truckType", v)}
              options={TRUCK_TYPE_OPTIONS}
              triggerIcon={User}
              placeholder="Solo / Team / Owner-op"
            />
          </FieldShell>
        </GridSection>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <FieldShell label="Truck Number">
            <Input
              value={draft.truckNumber}
              onChange={(e) => update("truckNumber", e.target.value)}
              placeholder="Unit 4421"
            />
          </FieldShell>
          <FieldShell label="Trailer Number">
            <Input
              value={draft.trailerNumber}
              onChange={(e) => update("trailerNumber", e.target.value)}
              placeholder="TR-9981"
            />
          </FieldShell>
        </div>
      </Card>

      <Card>
        <SectionTitle title="Dimensions & capacity" hint="Maximum legal payload" icon={Weight} />
        <div className="grid gap-4 sm:grid-cols-4">
          <FieldShell
            label="Max Weight Capacity"
            required
            error={isErr("maxWeightCapacity")}
            hint="lbs"
          >
            <Input
              inputMode="decimal"
              value={draft.maxWeightCapacity}
              onChange={(e) => update("maxWeightCapacity", e.target.value)}
              placeholder="45,000"
              className={cn(isErr("maxWeightCapacity") && "border-destructive/60")}
            />
          </FieldShell>
          <FieldShell label="Length" hint="ft">
            <Input
              inputMode="decimal"
              value={draft.equipmentLength}
              onChange={(e) => update("equipmentLength", e.target.value)}
              placeholder="53"
            />
          </FieldShell>
          <FieldShell label="Width" hint="ft">
            <Input
              inputMode="decimal"
              value={draft.equipmentWidth}
              onChange={(e) => update("equipmentWidth", e.target.value)}
              placeholder="8.5"
            />
          </FieldShell>
          <FieldShell label="Height" hint="ft">
            <Input
              inputMode="decimal"
              value={draft.equipmentHeight}
              onChange={(e) => update("equipmentHeight", e.target.value)}
              placeholder="13.5"
            />
          </FieldShell>
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <FieldShell label="Door Type">
            <FancySelect
              value={draft.doorType}
              onChange={(v) => update("doorType", v)}
              options={DOOR_TYPE_OPTIONS}
              placeholder="Swing / roll-up"
              triggerIcon={Container}
            />
          </FieldShell>
          {isReefer && (
            <FieldShell label="Temperature Range">
              <FancySelect
                value={draft.temperatureRange}
                onChange={(v) => update("temperatureRange", v)}
                options={TEMPERATURE_OPTIONS}
                placeholder="Reefer setting"
                triggerIcon={Thermometer}
              />
            </FieldShell>
          )}
        </div>
      </Card>

      <Card>
        <SectionTitle
          title="Equipment features"
          hint="Onboard tools and amenities"
          icon={Sparkles}
        />
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {EQUIPMENT_FEATURE_OPTIONS.map((f) => (
            <ChipToggle
              key={f.id}
              label={f.label}
              icon={f.icon}
              active={Boolean(draft[f.id as keyof TruckDraft])}
              onClick={() =>
                update(
                  f.id as keyof TruckDraft,
                  !draft[f.id as keyof TruckDraft] as never,
                )
              }
            />
          ))}
        </div>
      </Card>

      <Card>
        <SectionTitle
          title="Service & endorsements"
          hint="What this truck/driver can do"
          icon={BadgeCheck}
        />
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {SERVICE_FEATURE_OPTIONS.map((f) => (
            <ChipToggle
              key={f.id}
              label={f.label}
              icon={f.icon}
              active={Boolean(draft[f.id as keyof TruckDraft])}
              onClick={() =>
                update(
                  f.id as keyof TruckDraft,
                  !draft[f.id as keyof TruckDraft] as never,
                )
              }
            />
          ))}
        </div>
      </Card>
    </div>
  );
}

// ---------- Step 4: Destination ----------

export function StepDestination({
  draft,
  update,
  touched,
  errors,
}: {
  draft: TruckDraft;
  update: <K extends keyof TruckDraft>(k: K, v: TruckDraft[K]) => void;
  touched: boolean;
  errors: string[];
}) {
  const isErr = touched && errors.includes("destination");
  const toggleState = (k: "preferredStates" | "excludedStates", state: string) => {
    const arr = draft[k];
    const next = arr.includes(state) ? arr.filter((s) => s !== state) : [...arr, state];
    update(k, next);
  };
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <Card className={cn(isErr && "border-destructive/40 bg-destructive/5")}>
        <SectionTitle
          title="Preferred destination"
          hint="At least one preference required"
          icon={Compass}
        />
        <div className="grid gap-4 sm:grid-cols-3">
          <FieldShell label="Destination City">
            <Input
              value={draft.preferredDestinationCity}
              onChange={(e) => update("preferredDestinationCity", e.target.value)}
              placeholder="Dallas"
            />
          </FieldShell>
          <FieldShell label="Destination State">
            <FancySelect
              value={draft.preferredDestinationState}
              onChange={(v) => update("preferredDestinationState", v)}
              options={STATE_OPTIONS}
              placeholder="State"
              triggerIcon={MapPin}
            />
          </FieldShell>
          <FieldShell label="Region / Area">
            <FancySelect
              value={draft.preferredDestinationRegion}
              onChange={(v) => update("preferredDestinationRegion", v)}
              options={REGION_OPTIONS}
              placeholder="Northeast, Midwest..."
              triggerIcon={Compass}
            />
          </FieldShell>
        </div>
        <div className="mt-4 grid gap-4">
          <FieldShell label="Preferred Lanes" hint="comma-separated">
            <Textarea
              value={draft.preferredLanes}
              onChange={(e) => update("preferredLanes", e.target.value)}
              placeholder="Atlanta, GA → Dallas, TX | Chicago, IL → Indianapolis, IN"
              className="min-h-[70px]"
            />
          </FieldShell>
          <FieldShell label="Avoided Lanes" hint="comma-separated">
            <Textarea
              value={draft.avoidedLanes}
              onChange={(e) => update("avoidedLanes", e.target.value)}
              placeholder="NYC metro, San Francisco bay area..."
              className="min-h-[60px]"
            />
          </FieldShell>
        </div>
        {isErr && (
          <div className="mt-3 flex items-center gap-2 text-xs font-medium text-destructive">
            <AlertTriangle className="h-3.5 w-3.5" /> Provide a preferred city, state, region, or
            lane.
          </div>
        )}
      </Card>

      <Card>
        <SectionTitle title="Trip distance" hint="Filter inbound matches" icon={RouteIcon} />
        <GridSection cols={3}>
          <FieldShell label="Willing Deadhead" hint="miles">
            <Input
              inputMode="numeric"
              value={draft.willingDeadheadMiles}
              onChange={(e) => update("willingDeadheadMiles", e.target.value)}
              placeholder="150"
            />
          </FieldShell>
          <FieldShell label="Minimum Trip Miles">
            <Input
              inputMode="numeric"
              value={draft.minimumTripMiles}
              onChange={(e) => update("minimumTripMiles", e.target.value)}
              placeholder="200"
            />
          </FieldShell>
          <FieldShell label="Maximum Trip Miles">
            <Input
              inputMode="numeric"
              value={draft.maximumTripMiles}
              onChange={(e) => update("maximumTripMiles", e.target.value)}
              placeholder="1,500"
            />
          </FieldShell>
        </GridSection>
      </Card>

      <Card>
        <SectionTitle
          title="State preferences"
          hint="Tap to toggle · gold = preferred · red = excluded"
          icon={Flag}
        />
        <div className="flex flex-wrap gap-1.5">
          {STATE_OPTIONS.map((s) => {
            const isPreferred = draft.preferredStates.includes(s.value);
            const isExcluded = draft.excludedStates.includes(s.value);
            return (
              <button
                key={s.value}
                type="button"
                onClick={() => {
                  if (isExcluded) {
                    toggleState("excludedStates", s.value);
                  } else if (isPreferred) {
                    toggleState("preferredStates", s.value);
                    toggleState("excludedStates", s.value);
                  } else {
                    toggleState("preferredStates", s.value);
                  }
                }}
                className={cn(
                  "rounded-md border px-2 py-1 text-xs font-semibold tabular-nums transition-all",
                  isPreferred &&
                    "border-success/60 bg-success/15 text-success shadow-sm shadow-success/10",
                  isExcluded &&
                    "border-destructive/60 bg-destructive/12 text-destructive shadow-sm shadow-destructive/10",
                  !isPreferred &&
                    !isExcluded &&
                    "border-border bg-card text-muted-foreground hover:border-primary/30 hover:text-foreground",
                )}
              >
                {s.value}
              </button>
            );
          })}
        </div>
        <div className="mt-3 flex items-center gap-4 text-[11px] text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-success" /> Preferred:{" "}
            {draft.preferredStates.length}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-destructive" /> Excluded:{" "}
            {draft.excludedStates.length}
          </span>
          <span className="text-[10px] uppercase tracking-wider">Tap once = prefer · twice = exclude · thrice = clear</span>
        </div>
      </Card>
    </div>
  );
}

// ---------- Step 5: Carrier ----------

export function StepCarrier({
  draft,
  update,
  touched,
  errors,
}: {
  draft: TruckDraft;
  update: <K extends keyof TruckDraft>(k: K, v: TruckDraft[K]) => void;
  touched: boolean;
  errors: string[];
}) {
  const isErr = (k: string) => touched && errors.includes(k);
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <Card>
        <SectionTitle title="Carrier" hint="Who owns the truck" icon={Truck} />
        <GridSection cols={3}>
          <FieldShell label="Carrier Name" required error={isErr("carrierName")}>
            <Input
              value={draft.carrierName}
              onChange={(e) => update("carrierName", e.target.value)}
              placeholder="Bluepeak Freight LLC"
              className={cn(isErr("carrierName") && "border-destructive/60")}
            />
          </FieldShell>
          <FieldShell
            label="MC Number"
            required={!draft.carrierDotNumber}
            error={isErr("carrierAuthority")}
            hint="or DOT #"
          >
            <Input
              value={draft.carrierMcNumber}
              onChange={(e) => update("carrierMcNumber", e.target.value)}
              placeholder="MC 887412"
              className={cn(isErr("carrierAuthority") && "border-destructive/60")}
            />
          </FieldShell>
          <FieldShell
            label="DOT Number"
            required={!draft.carrierMcNumber}
            error={isErr("carrierAuthority")}
            hint="or MC #"
          >
            <Input
              value={draft.carrierDotNumber}
              onChange={(e) => update("carrierDotNumber", e.target.value)}
              placeholder="DOT 2456789"
              className={cn(isErr("carrierAuthority") && "border-destructive/60")}
            />
          </FieldShell>
        </GridSection>
        {isErr("carrierAuthority") && (
          <div className="mt-3 flex items-center gap-2 text-xs font-medium text-destructive">
            <AlertTriangle className="h-3.5 w-3.5" /> Provide either an MC or DOT number.
          </div>
        )}
      </Card>

      <Card>
        <SectionTitle title="Primary contact" hint="Booking calls go here" icon={Phone} />
        <GridSection cols={3}>
          <FieldShell label="Contact Name" required error={isErr("contactName")}>
            <Input
              value={draft.contactName}
              onChange={(e) => update("contactName", e.target.value)}
              placeholder="Full name"
              className={cn(isErr("contactName") && "border-destructive/60")}
            />
          </FieldShell>
          <FieldShell label="Contact Phone" required error={isErr("contactPhone")}>
            <Input
              value={draft.contactPhone}
              onChange={(e) => update("contactPhone", e.target.value)}
              placeholder="(555) 555-5555"
              className={cn(isErr("contactPhone") && "border-destructive/60")}
            />
          </FieldShell>
          <FieldShell label="Contact Email">
            <Input
              type="email"
              value={draft.contactEmail}
              onChange={(e) => update("contactEmail", e.target.value)}
              placeholder="name@carrier.com"
            />
          </FieldShell>
        </GridSection>
      </Card>

      <Card>
        <SectionTitle title="Driver" hint="Behind the wheel" icon={User} />
        <GridSection cols={2}>
          <FieldShell label="Driver Name">
            <Input
              value={draft.driverName}
              onChange={(e) => update("driverName", e.target.value)}
              placeholder="Full name"
            />
          </FieldShell>
          <FieldShell label="Driver Phone">
            <Input
              value={draft.driverPhone}
              onChange={(e) => update("driverPhone", e.target.value)}
              placeholder="(555) 555-5555"
            />
          </FieldShell>
        </GridSection>
      </Card>

      <Card>
        <SectionTitle title="Dispatcher" hint="Operations contact" icon={Users} />
        <GridSection cols={3}>
          <FieldShell label="Dispatcher Name">
            <Input
              value={draft.dispatcherName}
              onChange={(e) => update("dispatcherName", e.target.value)}
              placeholder="Full name"
            />
          </FieldShell>
          <FieldShell label="Dispatcher Phone">
            <Input
              value={draft.dispatcherPhone}
              onChange={(e) => update("dispatcherPhone", e.target.value)}
              placeholder="(555) 555-5555"
            />
          </FieldShell>
          <FieldShell label="Dispatcher Email">
            <Input
              type="email"
              value={draft.dispatcherEmail}
              onChange={(e) => update("dispatcherEmail", e.target.value)}
              placeholder="dispatch@carrier.com"
            />
          </FieldShell>
        </GridSection>
      </Card>
    </div>
  );
}

// ---------- Step 6: Rate ----------

export function StepRate({
  draft,
  update,
}: {
  draft: TruckDraft;
  update: <K extends keyof TruckDraft>(k: K, v: TruckDraft[K]) => void;
}) {
  const desired = toNumber(draft.desiredRate);
  const min = toNumber(draft.minimumRate);
  const spread = desired && min ? ((desired - min) / desired) * 100 : 0;
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <Card>
        <SectionTitle title="Rate type" hint="How you want to be paid" icon={DollarSign} />
        <FieldShell label="Rate Type">
          <FancySelect
            value={draft.rateType}
            onChange={(v) => update("rateType", v)}
            options={RATE_TYPE_OPTIONS}
            triggerIcon={DollarSign}
            placeholder="Flat, per mile..."
          />
        </FieldShell>
      </Card>

      <Card>
        <SectionTitle title="Flat rate targets" hint="Total trip price" icon={Wallet} />
        <GridSection cols={2}>
          <FieldShell label="Desired Rate (Total)">
            <MoneyInput
              value={draft.desiredRate}
              onChange={(v) => update("desiredRate", v)}
              placeholder="3,200"
            />
          </FieldShell>
          <FieldShell label="Minimum Rate (Total)">
            <MoneyInput
              value={draft.minimumRate}
              onChange={(v) => update("minimumRate", v)}
              placeholder="2,400"
            />
          </FieldShell>
        </GridSection>
      </Card>

      <Card>
        <SectionTitle title="Per mile" hint="Used for rate per mile lanes" icon={RouteIcon} />
        <GridSection cols={2}>
          <FieldShell label="Desired $/Mile">
            <MoneyInput
              value={draft.desiredRatePerMile}
              onChange={(v) => update("desiredRatePerMile", v)}
              placeholder="2.85"
              suffix="$/MI"
            />
          </FieldShell>
          <FieldShell label="Minimum $/Mile">
            <MoneyInput
              value={draft.minimumRatePerMile}
              onChange={(v) => update("minimumRatePerMile", v)}
              placeholder="2.20"
              suffix="$/MI"
            />
          </FieldShell>
        </GridSection>
      </Card>

      <Card>
        <SectionTitle title="Terms & extras" hint="Surcharges and payment" icon={Wallet} />
        <GridSection cols={2}>
          <FieldShell label="Fuel Surcharge">
            <FancySelect
              value={draft.fuelSurchargePreference}
              onChange={(v) => update("fuelSurchargePreference", v)}
              options={FUEL_SURCHARGE_OPTIONS}
              triggerIcon={DollarSign}
              placeholder="Included or separate"
            />
          </FieldShell>
          <FieldShell label="Payment Terms">
            <FancySelect
              value={draft.paymentTerms}
              onChange={(v) => update("paymentTerms", v)}
              options={PAYMENT_TERMS_OPTIONS}
              triggerIcon={DollarSign}
              placeholder="Choose terms"
            />
          </FieldShell>
        </GridSection>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <ToggleTile
            label="QuickPay Accepted"
            description="Willing to take 2-3 day pay at a fee"
            checked={draft.quickPayAccepted}
            onChange={(v) => update("quickPayAccepted", v)}
            icon={Zap}
          />
          <ToggleTile
            label="Rate Negotiable"
            description="Open to negotiation around your desired rate"
            checked={draft.negotiableRate}
            onChange={(v) => update("negotiableRate", v)}
            icon={DollarSign}
          />
        </div>
      </Card>

      {desired > 0 && min > 0 && (
        <Card className="border-primary/30 bg-gradient-to-br from-primary/5 via-card to-info/5">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Negotiation Spread
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                Difference between your desired rate and your floor
              </div>
            </div>
            <span
              className={cn(
                "rounded-md px-2 py-1 text-[11px] font-semibold",
                spread <= 15
                  ? "bg-success/15 text-success"
                  : spread <= 30
                    ? "bg-warning/20 text-warning-foreground"
                    : "bg-destructive/15 text-destructive",
              )}
            >
              {spread.toFixed(1)}% spread
            </span>
          </div>
          <div className="mt-4 grid grid-cols-3 divide-x divide-border/70 overflow-hidden rounded-lg border border-border/70 bg-card">
            <div className="px-4 py-3">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Desired
              </div>
              <div className="mt-0.5 text-lg font-semibold tabular-nums text-foreground">
                ${desired.toLocaleString(undefined, { maximumFractionDigits: 2 })}
              </div>
            </div>
            <div className="px-4 py-3">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Minimum
              </div>
              <div className="mt-0.5 text-lg font-semibold tabular-nums text-foreground">
                ${min.toLocaleString(undefined, { maximumFractionDigits: 2 })}
              </div>
            </div>
            <div className="px-4 py-3">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Walk-away gap
              </div>
              <div className="mt-0.5 text-lg font-semibold tabular-nums text-foreground">
                ${(desired - min).toLocaleString(undefined, { maximumFractionDigits: 2 })}
              </div>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}

// ---------- Step 7: Compliance & Docs ----------

export function StepCompliance({
  draft,
  update,
}: {
  draft: TruckDraft;
  update: <K extends keyof TruckDraft>(k: K, v: TruckDraft[K]) => void;
}) {
  const toggleDoc = (id: string) => {
    const next = draft.documents.includes(id)
      ? draft.documents.filter((x) => x !== id)
      : [...draft.documents, id];
    update("documents", next);
  };
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <Card>
        <SectionTitle title="Verifications" hint="Pre-booking compliance" icon={ShieldCheck} />
        <div className="grid gap-3 sm:grid-cols-2">
          <ToggleTile
            label="Insurance Verified"
            description="Cert of insurance on file & valid"
            checked={draft.insuranceVerified}
            onChange={(v) => update("insuranceVerified", v)}
            icon={ShieldCheck}
          />
          <ToggleTile
            label="Authority Verified"
            description="MC/DOT confirmed active with FMCSA"
            checked={draft.authorityVerified}
            onChange={(v) => update("authorityVerified", v)}
            icon={BadgeCheck}
          />
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <FieldShell label="Safety Rating">
            <FancySelect
              value={draft.safetyRating}
              onChange={(v) => update("safetyRating", v)}
              options={SAFETY_RATING_OPTIONS}
              triggerIcon={ShieldCheck}
              placeholder="FMCSA rating"
            />
          </FieldShell>
          <FieldShell label="Authority Status">
            <FancySelect
              value={draft.operatingAuthorityStatus}
              onChange={(v) => update("operatingAuthorityStatus", v)}
              options={AUTHORITY_STATUS_OPTIONS}
              triggerIcon={BadgeCheck}
              placeholder="Operating authority"
            />
          </FieldShell>
        </div>
      </Card>

      <Card>
        <SectionTitle title="Insurance coverage" hint="Liability amounts" icon={Shield} />
        <GridSection cols={3}>
          <FieldShell label="Cargo Insurance">
            <MoneyInput
              value={draft.cargoInsuranceAmount}
              onChange={(v) => update("cargoInsuranceAmount", v)}
              placeholder="100,000"
            />
          </FieldShell>
          <FieldShell label="Auto Liability">
            <MoneyInput
              value={draft.autoLiabilityAmount}
              onChange={(v) => update("autoLiabilityAmount", v)}
              placeholder="1,000,000"
            />
          </FieldShell>
          <FieldShell label="Insurance Expires">
            <Input
              type="date"
              value={draft.insuranceExpirationDate}
              onChange={(e) => update("insuranceExpirationDate", e.target.value)}
            />
          </FieldShell>
        </GridSection>
      </Card>

      <Card>
        <SectionTitle title="Documents on file" hint="Tap to attach" icon={Paperclip} />
        <div className="grid gap-2 sm:grid-cols-2">
          {DOCUMENT_OPTIONS.map((d) => {
            const Icon = d.icon;
            const active = draft.documents.includes(d.id);
            return (
              <button
                key={d.id}
                type="button"
                onClick={() => toggleDoc(d.id)}
                className={cn(
                  "flex items-center gap-3 rounded-lg border bg-card p-3 text-left transition-all",
                  active
                    ? "border-primary/60 bg-primary/5 shadow-sm shadow-primary/10"
                    : "border-border hover:border-primary/30",
                )}
              >
                <span
                  className={cn(
                    "flex h-9 w-9 items-center justify-center rounded-md",
                    active
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground",
                  )}
                >
                  <Icon className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-foreground">{d.label}</span>
                  <span className="block text-xs text-muted-foreground">
                    {active ? "Attached to posting" : "Not attached"}
                  </span>
                </span>
                <span
                  className={cn(
                    "rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase",
                    active ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground",
                  )}
                >
                  {active ? "On" : "Off"}
                </span>
              </button>
            );
          })}
        </div>
        <div className="mt-4 flex items-center justify-between rounded-lg border border-dashed border-border/80 bg-muted/30 px-4 py-3">
          <div className="flex items-center gap-3 text-sm">
            <Paperclip className="h-4 w-4 text-muted-foreground" />
            <span className="text-muted-foreground">
              Drop files here or click to upload insurance certs, W-9, packets, photos.
            </span>
          </div>
          <Button size="sm" variant="outline" type="button">
            Choose files
          </Button>
        </div>
      </Card>

      <Card>
        <SectionTitle title="Notes" hint="Visibility per audience" icon={FileText} />
        <div className="grid gap-4 sm:grid-cols-2">
          <FieldShell label="Public Notes" hint="Brokers can see">
            <Textarea
              value={draft.publicNotes}
              onChange={(e) => update("publicNotes", e.target.value)}
              placeholder="Driver prefers daytime pickups. No NYC."
              className="min-h-[90px]"
            />
          </FieldShell>
          <FieldShell label="Internal Notes" hint="Ops team only">
            <Textarea
              value={draft.internalNotes}
              onChange={(e) => update("internalNotes", e.target.value)}
              placeholder="Driver new to fleet — keep on shorter lanes."
              className="min-h-[90px]"
            />
          </FieldShell>
        </div>
      </Card>
    </div>
  );
}

// ---------- Step 8: Review ----------

function ReviewRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 py-1.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="max-w-[60%] text-right text-sm font-medium text-foreground">
        {value || <span className="italic text-muted-foreground">—</span>}
      </span>
    </div>
  );
}

export function StepReview({
  draft,
  stepErrors,
  onJump,
  variant = "wizard",
}: {
  draft: TruckDraft;
  stepErrors: Record<number, string[]>;
  onJump: (s: number) => void;
  variant?: "wizard" | "edit";
}) {
  const blocking = [1, 2, 3, 4, 5].filter((s) => stepErrors[s].length > 0);
  const origin =
    draft.currentCity || draft.currentState
      ? `${draft.currentCity || "?"}, ${draft.currentState || "?"}`
      : "Origin TBD";
  const destination =
    draft.preferredDestinationCity ||
    draft.preferredDestinationState ||
    draft.preferredDestinationRegion ||
    (draft.preferredStates.length > 0 ? draft.preferredStates.join(", ") : "");
  const desired = toNumber(draft.desiredRate);
  const min = toNumber(draft.minimumRate);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <Card className="border-primary/30 bg-gradient-to-br from-primary/8 via-card to-info/8">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-primary">
              {variant === "edit" ? "Summary" : "Ready to post"}
            </div>
            <h3 className="mt-1 text-xl font-semibold tracking-tight text-foreground">
              {draft.truckBoardId} · {draft.carrierName || "New truck"}
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">
              {origin}
              {" → "}
              {destination || "Anywhere"} ·{" "}
              {lookup(EQUIPMENT_OPTIONS, draft.equipmentType) || "Equipment TBD"}
              {draft.maxWeightCapacity && ` · ${draft.maxWeightCapacity} lbs`}
            </p>
          </div>
          <div className="text-right">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Desired Rate
            </div>
            <div className="text-xl font-semibold tabular-nums text-foreground">
              {desired
                ? `$${desired.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
                : "—"}
            </div>
            {min > 0 && (
              <div className="text-xs text-muted-foreground tabular-nums">
                Floor ${min.toLocaleString(undefined, { maximumFractionDigits: 0 })}
              </div>
            )}
          </div>
        </div>
      </Card>

      {blocking.length > 0 && (
        <div className="flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/8 p-4 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
          <div className="flex-1">
            <div className="font-semibold text-destructive">Missing required information</div>
            <div className="mt-0.5 text-xs text-destructive/90">
              {variant === "edit"
                ? "The following sections still need required fields before you can save."
                : "The following steps still need attention before this truck can be posted."}
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {blocking.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => onJump(s)}
                  className="rounded-md border border-destructive/30 bg-card px-2 py-1 text-xs font-medium text-destructive hover:bg-destructive/10"
                >
                  Step {s}: {TRUCK_FORM_STEPS[s - 1].label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <SectionTitle title="Availability" icon={Calendar} />
          <div className="divide-y divide-border/70">
            <ReviewRow label="Truck Board ID" value={draft.truckBoardId} />
            <ReviewRow
              label="Posting Status"
              value={lookup(POSTING_STATUS_OPTIONS, draft.postingStatus)}
            />
            <ReviewRow
              label="Capacity"
              value={lookup(CAPACITY_STATUS_OPTIONS, draft.capacityStatus)}
            />
            <ReviewRow
              label="Available"
              value={
                draft.availableNow
                  ? "Right now"
                  : draft.availableDate
                    ? `${draft.availableDate} · ${draft.availableTime || ""}`
                    : ""
              }
            />
            <ReviewRow
              label="HOS Remaining"
              value={
                draft.remainingDriveHours && `${draft.remainingDriveHours}h drive`
              }
            />
          </div>
        </Card>

        <Card>
          <SectionTitle title="Location & lanes" icon={MapPin} />
          <div className="divide-y divide-border/70">
            <ReviewRow label="Origin" value={origin} />
            <ReviewRow label="Radius" value={draft.locationRadius && `${draft.locationRadius} mi`} />
            <ReviewRow label="Destination" value={destination} />
            <ReviewRow
              label="Region"
              value={lookup(REGION_OPTIONS, draft.preferredDestinationRegion)}
            />
            <ReviewRow
              label="Deadhead OK"
              value={draft.willingDeadheadMiles && `${draft.willingDeadheadMiles} mi`}
            />
          </div>
        </Card>

        <Card>
          <SectionTitle title="Equipment" icon={Truck} />
          <div className="divide-y divide-border/70">
            <ReviewRow label="Equipment" value={lookup(EQUIPMENT_OPTIONS, draft.equipmentType)} />
            <ReviewRow label="Trailer" value={lookup(TRAILER_OPTIONS, draft.trailerType)} />
            <ReviewRow label="Truck Type" value={lookup(TRUCK_TYPE_OPTIONS, draft.truckType)} />
            <ReviewRow
              label="Capacity"
              value={draft.maxWeightCapacity && `${draft.maxWeightCapacity} lbs`}
            />
            <ReviewRow
              label="Dimensions"
              value={
                draft.equipmentLength &&
                `${draft.equipmentLength}' × ${draft.equipmentWidth || "?"}' × ${
                  draft.equipmentHeight || "?"
                }'`
              }
            />
            <ReviewRow
              label="Features"
              value={
                [
                  draft.teamDriverAvailable && "Team",
                  draft.powerOnlyAvailable && "Power Only",
                  draft.dropTrailerAvailable && "Drop Trailer",
                  draft.hazmatCertified && "Hazmat",
                  draft.tankerEndorsement && "Tanker",
                  draft.airRide && "Air Ride",
                ]
                  .filter(Boolean)
                  .join(" · ") || ""
              }
            />
          </div>
        </Card>

        <Card>
          <SectionTitle title="Carrier & contact" icon={Users} />
          <div className="divide-y divide-border/70">
            <ReviewRow label="Carrier" value={draft.carrierName} />
            <ReviewRow
              label="Authority"
              value={
                [draft.carrierMcNumber && `MC ${draft.carrierMcNumber}`, draft.carrierDotNumber && `DOT ${draft.carrierDotNumber}`]
                  .filter(Boolean)
                  .join(" · ") || ""
              }
            />
            <ReviewRow label="Contact" value={draft.contactName} />
            <ReviewRow label="Phone" value={draft.contactPhone} />
            <ReviewRow label="Driver" value={draft.driverName} />
            <ReviewRow label="Dispatcher" value={draft.dispatcherName} />
          </div>
        </Card>

        <Card>
          <SectionTitle title="Rate" icon={DollarSign} />
          <div className="divide-y divide-border/70">
            <ReviewRow label="Rate Type" value={lookup(RATE_TYPE_OPTIONS, draft.rateType)} />
            <ReviewRow
              label="Desired"
              value={
                draft.desiredRate &&
                `$${desired.toLocaleString(undefined, { maximumFractionDigits: 2 })}`
              }
            />
            <ReviewRow
              label="Minimum"
              value={
                draft.minimumRate &&
                `$${min.toLocaleString(undefined, { maximumFractionDigits: 2 })}`
              }
            />
            <ReviewRow
              label="$/Mile"
              value={
                draft.desiredRatePerMile && `$${draft.desiredRatePerMile} (min $${draft.minimumRatePerMile || "—"})`
              }
            />
            <ReviewRow
              label="Fuel Surcharge"
              value={lookup(FUEL_SURCHARGE_OPTIONS, draft.fuelSurchargePreference)}
            />
            <ReviewRow
              label="Payment Terms"
              value={lookup(PAYMENT_TERMS_OPTIONS, draft.paymentTerms)}
            />
          </div>
        </Card>

        <Card>
          <SectionTitle title="Compliance" icon={ShieldCheck} />
          <div className="divide-y divide-border/70">
            <ReviewRow
              label="Insurance"
              value={draft.insuranceVerified ? "Verified" : "Not verified"}
            />
            <ReviewRow
              label="Authority"
              value={draft.authorityVerified ? "Verified" : "Not verified"}
            />
            <ReviewRow
              label="Safety"
              value={lookup(SAFETY_RATING_OPTIONS, draft.safetyRating)}
            />
            <ReviewRow
              label="Cargo Ins."
              value={
                draft.cargoInsuranceAmount &&
                `$${toNumber(draft.cargoInsuranceAmount).toLocaleString()}`
              }
            />
            <ReviewRow
              label="Auto Liab."
              value={
                draft.autoLiabilityAmount &&
                `$${toNumber(draft.autoLiabilityAmount).toLocaleString()}`
              }
            />
            <ReviewRow
              label="Documents"
              value={draft.documents.length ? `${draft.documents.length} attached` : ""}
            />
          </div>
        </Card>
      </div>
    </div>
  );
}
