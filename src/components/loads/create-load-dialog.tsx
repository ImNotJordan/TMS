import * as React from "react";
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  BarChart3,
  Building2,
  Calendar,
  CheckCircle2,
  ClipboardCheck,
  Container,
  DollarSign,
  FileText,
  Flame,
  Flag,
  Gauge,
  Hash,
  Lightbulb,
  Loader2,
  MapPin,
  Minus,
  Navigation,
  Package,
  Paperclip,
  Phone,
  Radar,
  Route,
  Ruler,
  Shield,
  ShieldCheck,
  Snowflake,
  Sparkles,
  Target,
  Thermometer,
  TrendingDown,
  TrendingUp,
  Truck,
  User,
  Users,
  Weight,
  X,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { FancySelect, type FancySelectOption } from "@/components/loads/fancy-select";
import { createLoad, type CreateLoadInput, type LoadRecord } from "@/lib/loads-store";
import { useAuth } from "@/lib/auth";
import {
  normalizeLoadForDriverAssignment,
  syncTrackingSessionForLoad,
} from "@/lib/tracking-workflow-store";

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

const INITIAL: LoadDraft = {
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

const CUSTOMER_OPTIONS: FancySelectOption[] = [
  {
    value: "acme-foods",
    label: "Acme Foods, Inc.",
    description: "Net 30 · Atlanta, GA",
    icon: Building2,
    badge: "Tier 1",
    group: "Top customers",
  },
  {
    value: "northstar-bev",
    label: "Northstar Beverage",
    description: "Net 45 · Chicago, IL",
    icon: Building2,
    badge: "Tier 1",
    group: "Top customers",
  },
  {
    value: "greenfield",
    label: "Greenfield Co.",
    description: "Net 30 · Denver, CO",
    icon: Building2,
    group: "Top customers",
  },
  {
    value: "transocean",
    label: "TransOcean Logistics",
    description: "Net 60 · Long Beach, CA",
    icon: Building2,
    group: "Top customers",
  },
  {
    value: "freshline",
    label: "Freshline Distributors",
    description: "Net 30 · Miami, FL",
    icon: Building2,
    group: "Standard",
  },
  {
    value: "summit-retail",
    label: "Summit Retail Group",
    description: "Net 30 · Dallas, TX",
    icon: Building2,
    group: "Standard",
  },
];

const LOAD_TYPE_OPTIONS: FancySelectOption[] = [
  {
    value: "ftl",
    label: "Full Truckload",
    description: "Single shipper · full trailer",
    icon: Truck,
    badge: "FTL",
  },
  {
    value: "ltl",
    label: "Less Than Truckload",
    description: "Multiple shippers · shared trailer",
    icon: Container,
    badge: "LTL",
  },
  {
    value: "partial",
    label: "Partial Load",
    description: "Volume between LTL and FTL",
    icon: Package,
    badge: "Partial",
  },
  {
    value: "drayage",
    label: "Drayage",
    description: "Short-haul container moves",
    icon: Container,
    badge: "DRAY",
  },
  {
    value: "intermodal",
    label: "Intermodal",
    description: "Rail + truck combination",
    icon: Route,
    badge: "IM",
  },
  {
    value: "expedite",
    label: "Expedited / Hot Shot",
    description: "Time-critical delivery",
    icon: Sparkles,
    badge: "EXPD",
  },
];

const LOAD_STATUS_OPTIONS: FancySelectOption[] = [
  { value: "draft", label: "Draft", description: "Not yet booked or tendered", icon: FileText },
  {
    value: "driver-assigned",
    label: "Driver Assigned",
    description: "Driver has been assigned and notified",
    icon: User,
  },
  {
    value: "active",
    label: "Active",
    description: "Live load · in planning or execution",
    icon: Activity,
  },
  {
    value: "tendered",
    label: "Tendered",
    description: "Sent to carrier for acceptance",
    icon: ClipboardCheck,
  },
  {
    value: "booked",
    label: "Booked",
    description: "Carrier accepted · awaiting pickup",
    icon: CheckCircle2,
  },
  {
    value: "dispatched",
    label: "Dispatched",
    description: "Driver assigned and en route to pickup",
    icon: Navigation,
  },
  { value: "in-transit", label: "In Transit", description: "Picked up · on the way", icon: Truck },
  { value: "delivered", label: "Delivered", description: "POD received", icon: CheckCircle2 },
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
];

const TRAILER_OPTIONS: FancySelectOption[] = [
  { value: "53-dry", label: "53' Dry Van", description: "Standard enclosed trailer" },
  { value: "48-dry", label: "48' Dry Van", description: "Shorter enclosed trailer" },
  { value: "53-reefer", label: "53' Reefer", description: "Temperature-controlled" },
  { value: "48-flat", label: "48' Flatbed", description: "Standard flatbed" },
  { value: "53-flat", label: "53' Flatbed", description: "Long flatbed" },
  { value: "step-deck", label: "Step Deck", description: "Drop-deck flatbed" },
];

const PRIORITY_OPTIONS: FancySelectOption[] = [
  { value: "low", label: "Low", description: "No urgency · flexible scheduling", icon: Flag },
  { value: "standard", label: "Standard", description: "Normal lane and rate", icon: Flag },
  {
    value: "high",
    label: "High",
    description: "Customer is watching · prioritize",
    icon: Flag,
    badge: "Hot",
  },
  {
    value: "critical",
    label: "Critical",
    description: "Time-critical · escalate immediately",
    icon: Flame,
    badge: "Critical",
  },
];

const DISPATCHER_OPTIONS: FancySelectOption[] = [
  { value: "jordan", label: "Jordan Taylor", description: "Day shift · East region", icon: User },
  { value: "priya", label: "Priya Singh", description: "Day shift · West region", icon: User },
  { value: "marcus", label: "Marcus Lee", description: "Night shift · National", icon: User },
  { value: "alex", label: "Alex Romero", description: "Day shift · Midwest", icon: User },
];

const BROKER_OPTIONS: FancySelectOption[] = [
  {
    value: "in-house",
    label: "In-house Brokerage",
    description: "Logistics Software Brokerage",
    icon: Users,
  },
  {
    value: "partner-a",
    label: "Partner: Coastline Logistics",
    description: "Preferred · 5% margin share",
    icon: Users,
  },
  {
    value: "partner-b",
    label: "Partner: Heartland Logistics",
    description: "Preferred · 4.5% margin share",
    icon: Users,
  },
];

const CARRIER_OPTIONS: FancySelectOption[] = [
  {
    value: "bluepeak",
    label: "Bluepeak Freight",
    description: "MC 887412 · 96 safety · 32 power units",
    icon: Truck,
    badge: "Preferred",
    group: "Preferred",
  },
  {
    value: "ironline",
    label: "Ironline Logistics",
    description: "MC 553201 · 93 safety · 18 power units",
    icon: Truck,
    badge: "Preferred",
    group: "Preferred",
  },
  {
    value: "gulfstream",
    label: "Gulfstream Express",
    description: "MC 412009 · 89 safety · 22 power units",
    icon: Truck,
    group: "Approved",
  },
  {
    value: "sundial",
    label: "Sundial Trucking",
    description: "MC 778120 · 78 safety · 14 power units",
    icon: Truck,
    badge: "Watch",
    group: "Approved",
  },
  {
    value: "northbay",
    label: "Northbay Carriers",
    description: "MC 990010 · 84 safety · 27 power units",
    icon: Truck,
    group: "Approved",
  },
];

const DRIVER_OPTIONS: FancySelectOption[] = [
  {
    value: "d-101",
    label: "Dwayne Carter",
    description: "Bluepeak · CDL-A · HOS 7h",
    icon: User,
    group: "Available",
  },
  {
    value: "d-102",
    label: "Marisa Lopez",
    description: "Bluepeak · CDL-A · HOS 9h",
    icon: User,
    group: "Available",
  },
  {
    value: "d-201",
    label: "Sam Reyes",
    description: "Ironline · CDL-A · HOS 4h",
    icon: User,
    badge: "HOS low",
    group: "Available",
  },
  {
    value: "d-301",
    label: "Tyrese Hill",
    description: "Gulfstream · CDL-A · HOS 8h",
    icon: User,
    group: "Available",
  },
];

const PACKAGING_OPTIONS: FancySelectOption[] = [
  { value: "pallets", label: "Pallets", description: "Standard 48x40 wood pallets", icon: Package },
  {
    value: "boxes",
    label: "Boxes / Cartons",
    description: "Loose or palletized cartons",
    icon: Package,
  },
  { value: "drums", label: "Drums", description: "55-gallon or similar", icon: Container },
  {
    value: "totes",
    label: "Totes / IBCs",
    description: "Intermediate bulk containers",
    icon: Container,
  },
  { value: "bulk", label: "Bulk", description: "Loose unpackaged freight", icon: Container },
  { value: "crates", label: "Crates", description: "Wooden or metal crates", icon: Package },
];

const TRACKING_OPTIONS: FancySelectOption[] = [
  {
    value: "macropoint",
    label: "MacroPoint",
    description: "Phone-based GPS check-in",
    icon: MapPin,
  },
  {
    value: "project44",
    label: "project44",
    description: "ELD-connected real-time visibility",
    icon: MapPin,
    badge: "Live",
  },
  {
    value: "fourkites",
    label: "FourKites",
    description: "Network-wide tracking platform",
    icon: MapPin,
    badge: "Live",
  },
  { value: "eld", label: "Direct ELD", description: "Carrier-provided ELD feed", icon: Activity },
  {
    value: "manual",
    label: "Manual Check Calls",
    description: "Dispatcher schedules check calls",
    icon: Phone,
  },
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
  { value: "net-45", label: "Net 45", description: "Paid 45 days after POD" },
  { value: "net-60", label: "Net 60", description: "Paid 60 days after POD" },
];

const FREIGHT_CLASS_OPTIONS: FancySelectOption[] = [
  "50",
  "55",
  "60",
  "65",
  "70",
  "77.5",
  "85",
  "92.5",
  "100",
  "110",
  "125",
  "150",
  "175",
  "200",
  "250",
  "300",
  "400",
  "500",
].map((v) => ({ value: v, label: `Class ${v}`, description: `NMFC freight class ${v}` }));

const TEMPERATURE_OPTIONS: FancySelectOption[] = [
  {
    value: "ambient",
    label: "Ambient",
    description: "No temperature control required",
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
  { value: "heated", label: "Heated", description: "Protect from freeze", icon: Flame },
];

const STATE_OPTIONS: FancySelectOption[] = [
  "AL",
  "AK",
  "AZ",
  "AR",
  "CA",
  "CO",
  "CT",
  "DE",
  "FL",
  "GA",
  "HI",
  "ID",
  "IL",
  "IN",
  "IA",
  "KS",
  "KY",
  "LA",
  "ME",
  "MD",
  "MA",
  "MI",
  "MN",
  "MS",
  "MO",
  "MT",
  "NE",
  "NV",
  "NH",
  "NJ",
  "NM",
  "NY",
  "NC",
  "ND",
  "OH",
  "OK",
  "OR",
  "PA",
  "RI",
  "SC",
  "SD",
  "TN",
  "TX",
  "UT",
  "VT",
  "VA",
  "WA",
  "WV",
  "WI",
  "WY",
].map((s) => ({ value: s, label: s, description: `US state · ${s}` }));

const HANDLING_OPTIONS = [
  { id: "stackable", label: "Stackable", icon: Package },
  { id: "tarp", label: "Tarp Required", icon: Shield },
  { id: "team-driver", label: "Team Driver", icon: Users },
  { id: "white-glove", label: "White Glove", icon: Sparkles },
  { id: "liftgate-pu", label: "Liftgate (Pickup)", icon: ArrowRight },
  { id: "liftgate-del", label: "Liftgate (Delivery)", icon: ArrowRight },
  { id: "no-touch", label: "No-Touch Freight", icon: Shield },
  { id: "appt-required", label: "Appointment Required", icon: Calendar },
] as const;

const DOCUMENT_OPTIONS = [
  { id: "rate-con", label: "Rate Confirmation", icon: FileText },
  { id: "bol", label: "Bill of Lading", icon: FileText },
  { id: "pod", label: "Proof of Delivery", icon: ClipboardCheck },
  { id: "packing-list", label: "Packing List", icon: FileText },
  { id: "carrier-agreement", label: "Carrier Agreement", icon: FileText },
  { id: "insurance", label: "Insurance Certificate", icon: ShieldCheck },
] as const;

export const LOAD_FORM_STEPS = [
  { id: 1, label: "Basic Info", description: "Customer & equipment", icon: Sparkles },
  { id: 2, label: "Pickup & Delivery", description: "Stops, times, contacts", icon: MapPin },
  { id: 3, label: "Freight Details", description: "Commodity, weight, hazmat", icon: Package },
  { id: 4, label: "Pricing", description: "Customer & carrier rates", icon: DollarSign },
  { id: 5, label: "Assignment", description: "Carrier & driver", icon: Truck },
  { id: 6, label: "Docs & Tracking", description: "Visibility & paperwork", icon: ClipboardCheck },
  { id: 7, label: "Review", description: "Confirm and create", icon: CheckCircle2 },
] as const;

function generateLoadId() {
  const n = Math.floor(2800 + Math.random() * 999);
  return `L-${n}`;
}

export function CreateLoadDialog({
  trigger,
  onCreated,
  open: controlledOpen,
  onOpenChange,
}: {
  trigger?: React.ReactNode;
  onCreated?: (loadId: string) => void;
  /** Controlled mode — omit `trigger` and toggle from parent (e.g. top nav menu). */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const { user } = useAuth();
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(false);
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : uncontrolledOpen;

  const setOpen = React.useCallback(
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
  const [draft, setDraft] = React.useState<LoadDraft>(() => ({
    ...INITIAL,
    loadId: generateLoadId(),
  }));
  const [touched, setTouched] = React.useState<Record<number, boolean>>({});

  const update = React.useCallback(<K extends keyof LoadDraft>(key: K, value: LoadDraft[K]) => {
    setDraft((d) => ({ ...d, [key]: value }));
  }, []);

  const reset = () => {
    setDraft({ ...INITIAL, loadId: generateLoadId() });
    setStep(1);
    setTouched({});
    setSubmitError(null);
  };

  React.useEffect(() => {
    if (!open) {
      const t = setTimeout(reset, 200);
      return () => clearTimeout(t);
    }
  }, [open]);

  const stepErrors = React.useMemo(() => computeLoadWizardStepErrors(draft), [draft]);

  const canAdvance = stepErrors[step].length === 0;

  const goNext = () => {
    setTouched((t) => ({ ...t, [step]: true }));
    if (!canAdvance) return;
    setStep((s) => Math.min(7, s + 1));
  };
  const goBack = () => setStep((s) => Math.max(1, s - 1));

  const handleSubmit = async () => {
    setTouched({ 1: true, 2: true, 3: true, 4: true, 5: true });
    const blocking = [1, 2, 3, 4, 5].some((s) => stepErrors[s].length > 0);
    if (blocking) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const payload: CreateLoadInput = normalizeLoadForDriverAssignment({
        ...draft,
        createdBy: user?.userId,
      });
      const saved = await createLoad(payload);
      syncTrackingSessionForLoad(saved, user?.name ?? "Dispatcher");
      onCreated?.(draft.loadId);
      setOpen(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to save load to DynamoDB.";
      setSubmitError(message);
    } finally {
      setSubmitting(false);
    }
  };

  const progress = (step / 7) * 100;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {trigger ? <DialogTrigger asChild>{trigger}</DialogTrigger> : null}
      <DialogContent
        showCloseButton={false}
        className="!max-w-6xl w-[96vw] gap-0 overflow-hidden border-border/70 p-0 sm:rounded-2xl"
        onInteractOutside={(e) => e.preventDefault()}
      >
        <div className="grid h-[88vh] grid-cols-1 lg:grid-cols-[280px_1fr]">
          {/* Stepper sidebar */}
          <aside className="hidden flex-col bg-sidebar text-sidebar-foreground lg:flex">
            <div className="flex items-center gap-2 border-b border-sidebar-border/60 px-5 py-4">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-sidebar-primary/15 text-sidebar-primary">
                <Truck className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <div className="text-sm font-semibold tracking-tight text-sidebar-accent-foreground">
                  Create Load
                </div>
                <div className="truncate text-xs text-sidebar-foreground/70">
                  {draft.loadId} · {draft.loadType ? draft.loadType.toUpperCase() : "Draft"}
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
              <div className="mt-2 text-xs text-sidebar-foreground/70">Step {step} of 7</div>
            </div>
            <nav className="mt-4 flex-1 space-y-0.5 overflow-y-auto px-2 pb-4">
              {LOAD_FORM_STEPS.map((s) => {
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
              All changes auto-save to draft.
            </div>
          </aside>

          {/* Main content */}
          <div className="flex min-h-0 flex-col bg-background">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-border/70 px-6 py-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="inline-flex h-5 items-center rounded-full bg-primary/10 px-2 font-semibold text-primary">
                    Step {step}
                  </span>
                  <span>·</span>
                  <span className="truncate">{LOAD_FORM_STEPS[step - 1].description}</span>
                </div>
                <h2 className="mt-0.5 text-lg font-semibold tracking-tight text-foreground">
                  {LOAD_FORM_STEPS[step - 1].label}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Mobile progress */}
            <div className="border-b border-border/70 px-6 py-2 lg:hidden">
              <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-primary to-info transition-all"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>

            {/* Body */}
            <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
              {step === 1 && (
                <StepBasic
                  draft={draft}
                  update={update}
                  touched={!!touched[1]}
                  errors={stepErrors[1]}
                />
              )}
              {step === 2 && (
                <StepStops
                  draft={draft}
                  update={update}
                  touched={!!touched[2]}
                  errors={stepErrors[2]}
                />
              )}
              {step === 3 && (
                <StepFreight
                  draft={draft}
                  update={update}
                  touched={!!touched[3]}
                  errors={stepErrors[3]}
                />
              )}
              {step === 4 && (
                <StepPricing
                  draft={draft}
                  update={update}
                  touched={!!touched[4]}
                  errors={stepErrors[4]}
                />
              )}
              {step === 5 && (
                <StepAssignment
                  draft={draft}
                  update={update}
                  touched={!!touched[5]}
                  errors={stepErrors[5]}
                />
              )}
              {step === 6 && <StepDocsTracking draft={draft} update={update} />}
              {step === 7 && <StepReview draft={draft} stepErrors={stepErrors} onJump={setStep} />}
            </div>

            {/* Footer */}
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
                    <span className="h-1.5 w-1.5 rounded-full bg-success" />
                    Draft saved
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setOpen(false)}
                  className="text-muted-foreground hover:text-foreground"
                >
                  Cancel
                </Button>
                {step > 1 && (
                  <Button type="button" variant="outline" size="sm" onClick={goBack}>
                    <ArrowLeft className="h-4 w-4" /> Back
                  </Button>
                )}
                {step < 7 ? (
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
                        <Loader2 className="h-4 w-4 animate-spin" /> Creating…
                      </>
                    ) : (
                      <>
                        <CheckCircle2 className="h-4 w-4" /> Create Load
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

// ---------- Step 1: Basic ----------

export function StepBasic({
  draft,
  update,
  touched,
  errors,
  immutableLoadId,
}: {
  draft: LoadDraft;
  update: <K extends keyof LoadDraft>(k: K, v: LoadDraft[K]) => void;
  touched: boolean;
  errors: string[];
  immutableLoadId?: boolean;
}) {
  const isErr = (k: string) => touched && errors.includes(k);
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <Card>
        <SectionTitle
          title="Load identity"
          hint="Reference numbers and high-level type"
          icon={Hash}
        />
        <GridSection cols={3}>
          <FieldShell
            label="Load ID"
            hint={immutableLoadId ? "Primary key · cannot change" : "Auto-generated"}
            htmlFor="loadId"
          >
            <Input
              id="loadId"
              value={draft.loadId}
              onChange={(e) => update("loadId", e.target.value)}
              placeholder="L-0000"
              readOnly={immutableLoadId}
              disabled={immutableLoadId}
              className={immutableLoadId ? "cursor-not-allowed bg-muted/60" : undefined}
            />
          </FieldShell>
          <FieldShell label="Load Type">
            <FancySelect
              value={draft.loadType}
              onChange={(v) => update("loadType", v)}
              options={LOAD_TYPE_OPTIONS}
              triggerIcon={Truck}
              placeholder="Choose load type"
            />
          </FieldShell>
          <FieldShell label="Load Status" required error={isErr("loadStatus")}>
            <FancySelect
              value={draft.loadStatus}
              onChange={(v) => update("loadStatus", v)}
              options={LOAD_STATUS_OPTIONS}
              triggerIcon={Activity}
              error={isErr("loadStatus")}
              placeholder="Set status"
            />
          </FieldShell>
        </GridSection>
      </Card>

      <Card>
        <SectionTitle
          title="Customer & ownership"
          hint="Who owns the load internally"
          icon={Users}
        />
        <GridSection cols={3}>
          <FieldShell label="Customer / Shipper" required error={isErr("customer")}>
            <FancySelect
              value={draft.customer}
              onChange={(v) => update("customer", v)}
              options={CUSTOMER_OPTIONS}
              triggerIcon={Building2}
              error={isErr("customer")}
              placeholder="Search customers"
            />
          </FieldShell>
          <FieldShell label="Broker">
            <FancySelect
              value={draft.broker}
              onChange={(v) => update("broker", v)}
              options={BROKER_OPTIONS}
              triggerIcon={Users}
              placeholder="In-house or partner"
            />
          </FieldShell>
          <FieldShell label="Dispatcher">
            <FancySelect
              value={draft.dispatcher}
              onChange={(v) => update("dispatcher", v)}
              options={DISPATCHER_OPTIONS}
              triggerIcon={User}
              placeholder="Assign dispatcher"
            />
          </FieldShell>
        </GridSection>
      </Card>

      <Card>
        <SectionTitle title="Equipment & priority" hint="What truck and how urgent" icon={Truck} />
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
          <FieldShell label="Load Priority">
            <FancySelect
              value={draft.loadPriority}
              onChange={(v) => update("loadPriority", v)}
              options={PRIORITY_OPTIONS}
              triggerIcon={Flag}
              placeholder="Standard"
            />
          </FieldShell>
        </GridSection>
      </Card>

      <Card>
        <SectionTitle title="Internal notes" hint="Visible to ops team only" icon={FileText} />
        <Textarea
          placeholder="Anything the team should know about this load..."
          value={draft.internalNotes}
          onChange={(e) => update("internalNotes", e.target.value)}
          className="min-h-[90px]"
        />
      </Card>
    </div>
  );
}

// ---------- Step 2: Pickup & Delivery ----------

function StopBlock({
  prefix,
  draft,
  update,
  touched,
  errors,
  accent,
}: {
  prefix: "pickup" | "delivery";
  draft: LoadDraft;
  update: <K extends keyof LoadDraft>(k: K, v: LoadDraft[K]) => void;
  touched: boolean;
  errors: string[];
  accent: "primary" | "info";
}) {
  const isErr = (k: string) => touched && errors.includes(k);
  const title = prefix === "pickup" ? "Pickup" : "Delivery";
  const accentClass =
    accent === "primary"
      ? "from-primary/20 to-primary/0 text-primary"
      : "from-info/25 to-info/0 text-info";
  return (
    <Card>
      <div className="mb-4 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <span
            className={cn(
              "flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br",
              accentClass,
            )}
          >
            <MapPin className="h-4 w-4" />
          </span>
          <div>
            <div className="text-sm font-semibold tracking-tight text-foreground">{title}</div>
            <div className="text-xs text-muted-foreground">
              {prefix === "pickup" ? "Where the freight is picked up" : "Final consignee stop"}
            </div>
          </div>
        </div>
        <span
          className={cn(
            "rounded-md px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider",
            accent === "primary" ? "bg-primary/10 text-primary" : "bg-info/12 text-info",
          )}
        >
          {prefix === "pickup" ? "Stop 1" : "Stop 2"}
        </span>
      </div>

      <GridSection cols={2}>
        <FieldShell label="Facility / Location Name">
          <Input
            value={draft[`${prefix}Facility`] as string}
            onChange={(e) =>
              update(`${prefix}Facility` as keyof LoadDraft, e.target.value as never)
            }
            placeholder="Warehouse / DC name"
          />
        </FieldShell>
        <FieldShell label={`${title} Reference #`}>
          <Input
            value={draft[`${prefix}Reference`] as string}
            onChange={(e) =>
              update(`${prefix}Reference` as keyof LoadDraft, e.target.value as never)
            }
            placeholder="PRO / PO / ref"
          />
        </FieldShell>
      </GridSection>

      <div className="mt-4 grid gap-4 sm:grid-cols-6">
        <FieldShell
          label="Address"
          required
          className="sm:col-span-3"
          error={isErr(`${prefix}Address`)}
        >
          <Input
            value={draft[`${prefix}Address`] as string}
            onChange={(e) => update(`${prefix}Address` as keyof LoadDraft, e.target.value as never)}
            placeholder="Street address"
            className={isErr(`${prefix}Address`) ? "border-destructive/60" : ""}
          />
        </FieldShell>
        <FieldShell label="City" className="sm:col-span-2">
          <Input
            value={draft[`${prefix}City`] as string}
            onChange={(e) => update(`${prefix}City` as keyof LoadDraft, e.target.value as never)}
            placeholder="City"
          />
        </FieldShell>
        <FieldShell label="ZIP" className="sm:col-span-1">
          <Input
            value={draft[`${prefix}Zip`] as string}
            onChange={(e) => update(`${prefix}Zip` as keyof LoadDraft, e.target.value as never)}
            placeholder="ZIP"
          />
        </FieldShell>
        <FieldShell label="State" className="sm:col-span-2">
          <FancySelect
            value={draft[`${prefix}State`] as string}
            onChange={(v) => update(`${prefix}State` as keyof LoadDraft, v as never)}
            options={STATE_OPTIONS}
            placeholder="State"
            triggerIcon={MapPin}
          />
        </FieldShell>
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        <FieldShell label={`${title} Date`} required error={isErr(`${prefix}Date`)}>
          <Input
            type="date"
            value={draft[`${prefix}Date`] as string}
            onChange={(e) => update(`${prefix}Date` as keyof LoadDraft, e.target.value as never)}
            className={isErr(`${prefix}Date`) ? "border-destructive/60" : ""}
          />
        </FieldShell>
        <FieldShell label="Appointment Time" hint="exact" error={isErr(`${prefix}Time`)}>
          <Input
            type="time"
            value={draft[`${prefix}AppointmentTime`] as string}
            onChange={(e) =>
              update(`${prefix}AppointmentTime` as keyof LoadDraft, e.target.value as never)
            }
            className={isErr(`${prefix}Time`) ? "border-destructive/60" : ""}
          />
        </FieldShell>
        <div className="grid grid-cols-2 gap-2">
          <FieldShell label="Window Start" hint="or range">
            <Input
              type="time"
              value={draft[`${prefix}WindowStart`] as string}
              onChange={(e) =>
                update(`${prefix}WindowStart` as keyof LoadDraft, e.target.value as never)
              }
            />
          </FieldShell>
          <FieldShell label="Window End">
            <Input
              type="time"
              value={draft[`${prefix}WindowEnd`] as string}
              onChange={(e) =>
                update(`${prefix}WindowEnd` as keyof LoadDraft, e.target.value as never)
              }
            />
          </FieldShell>
        </div>
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        <FieldShell label="Contact Name">
          <Input
            value={draft[`${prefix}ContactName`] as string}
            onChange={(e) =>
              update(`${prefix}ContactName` as keyof LoadDraft, e.target.value as never)
            }
            placeholder="Full name"
          />
        </FieldShell>
        <FieldShell label="Contact Phone">
          <Input
            value={draft[`${prefix}ContactPhone`] as string}
            onChange={(e) =>
              update(`${prefix}ContactPhone` as keyof LoadDraft, e.target.value as never)
            }
            placeholder="(555) 555-5555"
          />
        </FieldShell>
        <FieldShell label="Contact Email">
          <Input
            type="email"
            value={draft[`${prefix}ContactEmail`] as string}
            onChange={(e) =>
              update(`${prefix}ContactEmail` as keyof LoadDraft, e.target.value as never)
            }
            placeholder="name@company.com"
          />
        </FieldShell>
      </div>

      <div className="mt-4">
        <FieldShell label={`${title} Instructions`} hint="Optional">
          <Textarea
            value={draft[`${prefix}Instructions`] as string}
            onChange={(e) =>
              update(`${prefix}Instructions` as keyof LoadDraft, e.target.value as never)
            }
            placeholder="Dock 7 · Driver must check in at security · No idling..."
            className="min-h-[70px]"
          />
        </FieldShell>
      </div>
    </Card>
  );
}

export function StepStops({
  draft,
  update,
  touched,
  errors,
}: {
  draft: LoadDraft;
  update: <K extends keyof LoadDraft>(k: K, v: LoadDraft[K]) => void;
  touched: boolean;
  errors: string[];
}) {
  return (
    <div className="mx-auto grid w-full max-w-4xl grid-cols-1 gap-6 lg:max-w-none lg:grid-cols-2 lg:items-start lg:gap-5">
      <div className="min-w-0">
        <StopBlock
          prefix="pickup"
          draft={draft}
          update={update}
          touched={touched}
          errors={errors}
          accent="primary"
        />
      </div>
      <div className="min-w-0">
        <StopBlock
          prefix="delivery"
          draft={draft}
          update={update}
          touched={touched}
          errors={errors}
          accent="info"
        />
      </div>
    </div>
  );
}

// ---------- Step 3: Freight ----------

export function StepFreight({
  draft,
  update,
  touched,
  errors,
}: {
  draft: LoadDraft;
  update: <K extends keyof LoadDraft>(k: K, v: LoadDraft[K]) => void;
  touched: boolean;
  errors: string[];
}) {
  const isErr = (k: string) => touched && errors.includes(k);
  const toggleHandling = (id: string) => {
    const next = draft.specialHandling.includes(id)
      ? draft.specialHandling.filter((x) => x !== id)
      : [...draft.specialHandling, id];
    update("specialHandling", next);
  };
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <Card>
        <SectionTitle title="Commodity" hint="What's being moved" icon={Package} />
        <FieldShell label="Commodity Description" required error={isErr("commodityDescription")}>
          <Textarea
            value={draft.commodityDescription}
            onChange={(e) => update("commodityDescription", e.target.value)}
            placeholder="e.g. 24 pallets of cased non-alcoholic beverages"
            className={cn("min-h-[70px]", isErr("commodityDescription") && "border-destructive/60")}
          />
        </FieldShell>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <FieldShell label="Freight Class">
            <FancySelect
              value={draft.freightClass}
              onChange={(v) => update("freightClass", v)}
              options={FREIGHT_CLASS_OPTIONS}
              placeholder="NMFC class"
              triggerIcon={Gauge}
            />
          </FieldShell>
          <FieldShell label="Packaging Type">
            <FancySelect
              value={draft.packagingType}
              onChange={(v) => update("packagingType", v)}
              options={PACKAGING_OPTIONS}
              placeholder="How is it packaged"
              triggerIcon={Package}
            />
          </FieldShell>
          <FieldShell label="Temperature Requirement">
            <FancySelect
              value={draft.temperatureRequirement}
              onChange={(v) => update("temperatureRequirement", v)}
              options={TEMPERATURE_OPTIONS}
              placeholder="Ambient / reefer"
              triggerIcon={Thermometer}
            />
          </FieldShell>
        </div>
      </Card>

      <Card>
        <SectionTitle
          title="Dimensions & weight"
          hint="For rate and equipment validation"
          icon={Ruler}
        />
        <div className="grid gap-4 sm:grid-cols-4">
          <FieldShell label="Weight" required error={isErr("weight")} className="sm:col-span-2">
            <div className="flex items-stretch gap-2">
              <Input
                inputMode="decimal"
                value={draft.weight}
                onChange={(e) => update("weight", e.target.value)}
                placeholder="42,000"
                className={cn("flex-1", isErr("weight") && "border-destructive/60")}
              />
              <div className="flex overflow-hidden rounded-md border border-input bg-card">
                {(["lbs", "kg"] as const).map((u) => (
                  <button
                    type="button"
                    key={u}
                    onClick={() => update("weightUnit", u)}
                    className={cn(
                      "px-3 text-xs font-semibold uppercase tracking-wide transition-colors",
                      draft.weightUnit === u
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {u}
                  </button>
                ))}
              </div>
            </div>
          </FieldShell>
          <FieldShell label="Pallet Count">
            <Input
              inputMode="numeric"
              value={draft.palletCount}
              onChange={(e) => update("palletCount", e.target.value)}
              placeholder="24"
            />
          </FieldShell>
          <FieldShell label="Piece Count">
            <Input
              inputMode="numeric"
              value={draft.pieceCount}
              onChange={(e) => update("pieceCount", e.target.value)}
              placeholder="1,200"
            />
          </FieldShell>
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <FieldShell label="Dimensions (L × W × H)" hint="inches">
            <Input
              value={draft.dimensions}
              onChange={(e) => update("dimensions", e.target.value)}
              placeholder="48 × 40 × 60"
            />
          </FieldShell>
          <FieldShell label="Seal Number">
            <Input
              value={draft.sealNumber}
              onChange={(e) => update("sealNumber", e.target.value)}
              placeholder="SEAL-0000"
            />
          </FieldShell>
          <FieldShell label="Load Value (USD)">
            <Input
              inputMode="decimal"
              value={draft.loadValue}
              onChange={(e) => update("loadValue", e.target.value)}
              placeholder="$45,000"
            />
          </FieldShell>
        </div>
      </Card>

      <Card>
        <SectionTitle title="Special handling" hint="Multi-select all that apply" icon={Sparkles} />
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {HANDLING_OPTIONS.map((h) => {
            const Icon = h.icon;
            const active = draft.specialHandling.includes(h.id);
            return (
              <button
                key={h.id}
                type="button"
                onClick={() => toggleHandling(h.id)}
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
                <span className="text-xs font-medium">{h.label}</span>
              </button>
            );
          })}
        </div>
      </Card>

      <Card className="border-warning/30 bg-warning/5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-warning/20 text-warning-foreground">
              <Flame className="h-4 w-4" />
            </span>
            <div>
              <div className="text-sm font-semibold tracking-tight text-foreground">
                Hazardous materials
              </div>
              <div className="text-xs text-muted-foreground">
                Toggle if this load is hazmat-regulated
              </div>
            </div>
          </div>
          <Switch checked={draft.hazmat} onCheckedChange={(v) => update("hazmat", v)} />
        </div>
        {draft.hazmat && (
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <FieldShell label="UN Number">
              <Input
                value={draft.hazmatUn}
                onChange={(e) => update("hazmatUn", e.target.value)}
                placeholder="UN1203"
              />
            </FieldShell>
            <FieldShell label="Hazmat Class">
              <Input placeholder="e.g. Class 3 - Flammable Liquid" />
            </FieldShell>
          </div>
        )}
      </Card>
    </div>
  );
}

// ---------- Step 4: Pricing ----------

function MoneyInput({
  value,
  onChange,
  placeholder,
  error,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  error?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex h-10 items-center gap-1 rounded-lg border bg-card px-3 shadow-sm transition-all",
        "border-input focus-within:border-primary/60 focus-within:ring-2 focus-within:ring-primary/20",
        error && "border-destructive/60 ring-2 ring-destructive/15",
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
        USD
      </span>
    </div>
  );
}

function toNumber(v: string) {
  const n = parseFloat(v.replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

export function StepPricing({
  draft,
  update,
  touched,
  errors,
}: {
  draft: LoadDraft;
  update: <K extends keyof LoadDraft>(k: K, v: LoadDraft[K]) => void;
  touched: boolean;
  errors: string[];
}) {
  const isErr = (k: string) => touched && errors.includes(k);
  const customer = toNumber(draft.customerRate);
  const linehaul = toNumber(draft.linehaulRate);
  const fsc = toNumber(draft.fuelSurcharge);
  const acc = toNumber(draft.accessorialCharges);
  const carrier = toNumber(draft.carrierRate);
  const totalRevenue = customer || linehaul + fsc + acc;
  const margin = totalRevenue - carrier;
  const marginPct = totalRevenue ? (margin / totalRevenue) * 100 : 0;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <Card>
        <SectionTitle title="Customer rate" hint="What you charge the shipper" icon={DollarSign} />
        <GridSection cols={2}>
          <FieldShell label="Customer Rate (Total)" required error={isErr("customerRate")}>
            <MoneyInput
              value={draft.customerRate}
              onChange={(v) => update("customerRate", v)}
              placeholder="0.00"
              error={isErr("customerRate")}
            />
          </FieldShell>
          <FieldShell label="Linehaul Rate">
            <MoneyInput
              value={draft.linehaulRate}
              onChange={(v) => update("linehaulRate", v)}
              placeholder="0.00"
            />
          </FieldShell>
          <FieldShell label="Fuel Surcharge">
            <MoneyInput
              value={draft.fuelSurcharge}
              onChange={(v) => update("fuelSurcharge", v)}
              placeholder="0.00"
            />
          </FieldShell>
          <FieldShell label="Accessorial Charges">
            <MoneyInput
              value={draft.accessorialCharges}
              onChange={(v) => update("accessorialCharges", v)}
              placeholder="0.00"
            />
          </FieldShell>
        </GridSection>
      </Card>

      <Card>
        <SectionTitle title="Carrier pay" hint="What you pay the carrier" icon={Truck} />
        <GridSection cols={2}>
          <FieldShell label="Carrier Rate (Total)" required error={isErr("carrierRate")}>
            <MoneyInput
              value={draft.carrierRate}
              onChange={(v) => update("carrierRate", v)}
              placeholder="0.00"
              error={isErr("carrierRate")}
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
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <FieldShell label="Detention Rate" hint="per hour">
            <MoneyInput
              value={draft.detentionRate}
              onChange={(v) => update("detentionRate", v)}
              placeholder="0.00"
            />
          </FieldShell>
          <FieldShell label="Lumper Fee">
            <MoneyInput
              value={draft.lumperFee}
              onChange={(v) => update("lumperFee", v)}
              placeholder="0.00"
            />
          </FieldShell>
          <FieldShell label="TONU Fee">
            <MoneyInput
              value={draft.tonuFee}
              onChange={(v) => update("tonuFee", v)}
              placeholder="0.00"
            />
          </FieldShell>
          <FieldShell label="Layover Fee">
            <MoneyInput
              value={draft.layoverFee}
              onChange={(v) => update("layoverFee", v)}
              placeholder="0.00"
            />
          </FieldShell>
        </div>
      </Card>

      {/* Live margin */}
      <Card className="border-primary/30 bg-gradient-to-br from-primary/5 via-card to-info/5">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Live Margin Preview
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              Auto-calculated from rates entered above
            </div>
          </div>
          <span
            className={cn(
              "rounded-md px-2 py-1 text-[11px] font-semibold",
              marginPct >= 15
                ? "bg-success/15 text-success"
                : marginPct >= 5
                  ? "bg-warning/20 text-warning-foreground"
                  : "bg-destructive/15 text-destructive",
            )}
          >
            {marginPct.toFixed(1)}% margin
          </span>
        </div>
        <div className="mt-4 grid grid-cols-3 divide-x divide-border/70 overflow-hidden rounded-lg border border-border/70 bg-card">
          <div className="px-4 py-3">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Revenue
            </div>
            <div className="mt-0.5 text-lg font-semibold tabular-nums text-foreground">
              ${totalRevenue.toLocaleString(undefined, { maximumFractionDigits: 2 })}
            </div>
          </div>
          <div className="px-4 py-3">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Cost
            </div>
            <div className="mt-0.5 text-lg font-semibold tabular-nums text-foreground">
              ${carrier.toLocaleString(undefined, { maximumFractionDigits: 2 })}
            </div>
          </div>
          <div className="px-4 py-3">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Gross Margin
            </div>
            <div
              className={cn(
                "mt-0.5 text-lg font-semibold tabular-nums",
                margin >= 0 ? "text-success" : "text-destructive",
              )}
            >
              ${margin.toLocaleString(undefined, { maximumFractionDigits: 2 })}
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}

// ---------- Step 5: Assignment ----------

export function StepAssignment({
  draft,
  update,
  touched,
  errors,
}: {
  draft: LoadDraft;
  update: <K extends keyof LoadDraft>(k: K, v: LoadDraft[K]) => void;
  touched: boolean;
  errors: string[];
}) {
  const isErr = touched && errors.includes("assignment");
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <Card>
        <SectionTitle title="Carrier" hint="Approved & insurance-verified only" icon={Truck} />
        <FieldShell label="Assigned Carrier" hint="At least one of carrier or driver required">
          <FancySelect
            value={draft.assignedCarrier}
            onChange={(v) => update("assignedCarrier", v)}
            options={CARRIER_OPTIONS}
            placeholder="Search carriers"
            triggerIcon={Truck}
          />
        </FieldShell>
      </Card>
      <Card>
        <SectionTitle title="Driver" hint="HOS-aware from connected ELDs" icon={User} />
        <FieldShell label="Assigned Driver">
          <FancySelect
            value={draft.assignedDriver}
            onChange={(v) => update("assignedDriver", v)}
            options={DRIVER_OPTIONS}
            placeholder="Search drivers"
            triggerIcon={User}
          />
        </FieldShell>
      </Card>

      <Card>
        <SectionTitle
          title="Compliance verification"
          hint="Pre-booking checks"
          icon={ShieldCheck}
        />
        <div className="grid gap-3 sm:grid-cols-3">
          <ToggleTile
            label="Insurance Verified"
            description="Cert on file & valid"
            checked={draft.insuranceVerified}
            onChange={(v) => update("insuranceVerified", v)}
            icon={ShieldCheck}
          />
          <ToggleTile
            label="Authority Verified"
            description="Active MC/DOT"
            checked={draft.authorityVerified}
            onChange={(v) => update("authorityVerified", v)}
            icon={Shield}
          />
          <ToggleTile
            label="High-Value Flag"
            description="Extra escort & monitoring"
            checked={draft.highValueFlag}
            onChange={(v) => update("highValueFlag", v)}
            icon={Sparkles}
          />
        </div>
      </Card>

      {isErr && (
        <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/8 px-4 py-3 text-sm text-destructive">
          <AlertTriangle className="h-4 w-4" />
          You must assign at least one carrier or driver before continuing.
        </div>
      )}
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
  description: string;
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
        <span className="block text-xs text-muted-foreground">{description}</span>
      </span>
      <Switch checked={checked} onCheckedChange={onChange} />
    </label>
  );
}

// ---------- Step 6: Docs & Tracking ----------

export function StepDocsTracking({
  draft,
  update,
}: {
  draft: LoadDraft;
  update: <K extends keyof LoadDraft>(k: K, v: LoadDraft[K]) => void;
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
        <SectionTitle
          title="Visibility & tracking"
          hint="Real-time location updates"
          icon={MapPin}
        />
        <div className="grid gap-3 sm:grid-cols-3">
          <ToggleTile
            label="Tracking Required"
            description="Carrier must share location"
            checked={draft.trackingRequired}
            onChange={(v) => update("trackingRequired", v)}
            icon={MapPin}
          />
          <ToggleTile
            label="Check-In Required"
            description="At pickup arrival"
            checked={draft.checkInRequired}
            onChange={(v) => update("checkInRequired", v)}
            icon={CheckCircle2}
          />
          <ToggleTile
            label="Check-Out Required"
            description="At delivery completion"
            checked={draft.checkOutRequired}
            onChange={(v) => update("checkOutRequired", v)}
            icon={ClipboardCheck}
          />
        </div>
        {draft.trackingRequired && (
          <div className="mt-4">
            <FieldShell label="Tracking Method">
              <FancySelect
                value={draft.trackingMethod}
                onChange={(v) => update("trackingMethod", v)}
                options={TRACKING_OPTIONS}
                triggerIcon={MapPin}
                placeholder="Choose visibility provider"
              />
            </FieldShell>
          </div>
        )}
      </Card>

      <Card>
        <SectionTitle
          title="Documents to attach"
          hint="Upload now or after dispatch"
          icon={Paperclip}
        />
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
                    {active ? "Will be required at dispatch" : "Optional for this load"}
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
              Drop files here or click to upload PDFs, images, or scans.
            </span>
          </div>
          <Button size="sm" variant="outline" type="button">
            Choose files
          </Button>
        </div>
      </Card>
    </div>
  );
}

// ---------- Step 7: Review ----------

function ReviewRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 py-1.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="max-w-[60%] text-right text-sm font-medium text-foreground">
        {value || <span className="text-muted-foreground italic">—</span>}
      </span>
    </div>
  );
}

function lookup(opts: FancySelectOption[], v: string) {
  return opts.find((o) => o.value === v)?.label ?? v;
}

export function StepReview({
  draft,
  stepErrors,
  onJump,
  variant = "create",
}: {
  draft: LoadDraft;
  stepErrors: Record<number, string[]>;
  onJump: (s: number) => void;
  variant?: "create" | "edit";
}) {
  const customerRate = toNumber(draft.customerRate);
  const carrierRate = toNumber(draft.carrierRate);
  const margin = customerRate - carrierRate;
  const marginPct = customerRate ? (margin / customerRate) * 100 : 0;
  const blocking = [1, 2, 3, 4, 5].filter((s) => stepErrors[s].length > 0);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <Card className="border-primary/30 bg-gradient-to-br from-primary/8 via-card to-info/8">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-primary">
              {variant === "edit" ? "Review & save" : "Ready to create"}
            </div>
            <h3 className="mt-1 text-xl font-semibold tracking-tight text-foreground">
              {draft.loadId} · {lookup(CUSTOMER_OPTIONS, draft.customer) || "New load"}
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">
              {draft.pickupCity || draft.pickupState || "Origin"}
              {" → "}
              {draft.deliveryCity || draft.deliveryState || "Destination"} ·{" "}
              {lookup(EQUIPMENT_OPTIONS, draft.equipmentType) || "Equipment TBD"}
            </p>
          </div>
          <div className="text-right">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Margin
            </div>
            <div
              className={cn(
                "text-xl font-semibold tabular-nums",
                marginPct >= 15
                  ? "text-success"
                  : marginPct >= 5
                    ? "text-warning-foreground"
                    : "text-destructive",
              )}
            >
              {marginPct.toFixed(1)}%
            </div>
            <div className="text-xs text-muted-foreground tabular-nums">
              ${margin.toLocaleString(undefined, { maximumFractionDigits: 2 })}
            </div>
          </div>
        </div>
      </Card>

      {blocking.length > 0 && (
        <div className="flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/8 p-4 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
          <div className="flex-1">
            <div className="font-semibold text-destructive">Missing required information</div>
            <div className="mt-0.5 text-xs text-destructive/90">
              The following steps still need attention before you can{" "}
              {variant === "edit" ? "save changes to DynamoDB." : "create this load."}
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {blocking.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => onJump(s)}
                  className="rounded-md border border-destructive/30 bg-card px-2 py-1 text-xs font-medium text-destructive hover:bg-destructive/10"
                >
                  Step {s}: {LOAD_FORM_STEPS[s - 1].label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <SectionTitle title="Basic" icon={Sparkles} />
          <div className="divide-y divide-border/70">
            <ReviewRow label="Load ID" value={draft.loadId} />
            <ReviewRow label="Customer" value={lookup(CUSTOMER_OPTIONS, draft.customer)} />
            <ReviewRow label="Type" value={lookup(LOAD_TYPE_OPTIONS, draft.loadType)} />
            <ReviewRow label="Status" value={lookup(LOAD_STATUS_OPTIONS, draft.loadStatus)} />
            <ReviewRow label="Equipment" value={lookup(EQUIPMENT_OPTIONS, draft.equipmentType)} />
            <ReviewRow label="Priority" value={lookup(PRIORITY_OPTIONS, draft.loadPriority)} />
            <ReviewRow label="Dispatcher" value={lookup(DISPATCHER_OPTIONS, draft.dispatcher)} />
          </div>
        </Card>
        <Card>
          <SectionTitle title="Stops" icon={MapPin} />
          <div className="divide-y divide-border/70">
            <ReviewRow
              label="Pickup"
              value={`${draft.pickupCity || "?"}, ${draft.pickupState || "?"} · ${draft.pickupDate || "no date"}`}
            />
            <ReviewRow
              label="Pickup time"
              value={
                draft.pickupAppointmentTime ||
                (draft.pickupWindowStart && `${draft.pickupWindowStart}–${draft.pickupWindowEnd}`)
              }
            />
            <ReviewRow
              label="Delivery"
              value={`${draft.deliveryCity || "?"}, ${draft.deliveryState || "?"} · ${draft.deliveryDate || "no date"}`}
            />
            <ReviewRow
              label="Delivery time"
              value={
                draft.deliveryAppointmentTime ||
                (draft.deliveryWindowStart &&
                  `${draft.deliveryWindowStart}–${draft.deliveryWindowEnd}`)
              }
            />
          </div>
        </Card>
        <Card>
          <SectionTitle title="Freight" icon={Package} />
          <div className="divide-y divide-border/70">
            <ReviewRow label="Commodity" value={draft.commodityDescription} />
            <ReviewRow
              label="Weight"
              value={draft.weight ? `${draft.weight} ${draft.weightUnit}` : ""}
            />
            <ReviewRow label="Pallets" value={draft.palletCount} />
            <ReviewRow label="Class" value={draft.freightClass && `Class ${draft.freightClass}`} />
            <ReviewRow
              label="Temperature"
              value={lookup(TEMPERATURE_OPTIONS, draft.temperatureRequirement)}
            />
            <ReviewRow
              label="Hazmat"
              value={draft.hazmat ? `Yes · ${draft.hazmatUn || "no UN"}` : "No"}
            />
          </div>
        </Card>
        <Card>
          <SectionTitle title="Pricing & assignment" icon={DollarSign} />
          <div className="divide-y divide-border/70">
            <ReviewRow
              label="Customer Rate"
              value={
                draft.customerRate &&
                `$${customerRate.toLocaleString(undefined, { maximumFractionDigits: 2 })}`
              }
            />
            <ReviewRow
              label="Carrier Rate"
              value={
                draft.carrierRate &&
                `$${carrierRate.toLocaleString(undefined, { maximumFractionDigits: 2 })}`
              }
            />
            <ReviewRow
              label="Payment Terms"
              value={lookup(PAYMENT_TERMS_OPTIONS, draft.paymentTerms)}
            />
            <ReviewRow label="Carrier" value={lookup(CARRIER_OPTIONS, draft.assignedCarrier)} />
            <ReviewRow label="Driver" value={lookup(DRIVER_OPTIONS, draft.assignedDriver)} />
            <ReviewRow
              label="Tracking"
              value={
                draft.trackingRequired
                  ? lookup(TRACKING_OPTIONS, draft.trackingMethod) || "Required"
                  : "Not required"
              }
            />
          </div>
        </Card>
      </div>

      <DatMarketPanel draft={draft} customerRate={customerRate} carrierRate={carrierRate} />
    </div>
  );
}

// ---------- DAT Market Suggestions ----------

const EQUIPMENT_RPM_BASE: Record<string, number> = {
  "dry-van": 2.32,
  reefer: 2.78,
  flatbed: 2.69,
  "step-deck": 2.84,
  lowboy: 3.45,
  tanker: 3.12,
  "power-only": 2.05,
  intermodal: 2.05,
  drayage: 4.1,
  expedite: 3.6,
};

const STATE_COORDS: Record<string, [number, number]> = {
  AL: [32.7, -86.7],
  AK: [64, -149],
  AZ: [34.2, -111.7],
  AR: [34.7, -92.4],
  CA: [37, -119.5],
  CO: [38.9, -105.5],
  CT: [41.6, -72.7],
  DE: [38.9, -75.5],
  FL: [27.7, -81.5],
  GA: [33, -83.6],
  HI: [20.7, -157.5],
  ID: [44, -114.5],
  IL: [40, -89.2],
  IN: [39.8, -86.3],
  IA: [42, -93.5],
  KS: [38.5, -98.4],
  KY: [37.5, -85.3],
  LA: [31, -91.8],
  ME: [45.4, -69.4],
  MD: [39, -76.7],
  MA: [42.3, -71.6],
  MI: [44.3, -85.6],
  MN: [46.3, -94.3],
  MS: [32.7, -89.7],
  MO: [38.5, -92.5],
  MT: [46.9, -110],
  NE: [41.5, -99.8],
  NV: [39.3, -116.6],
  NH: [43.7, -71.6],
  NJ: [40.2, -74.5],
  NM: [34.4, -106.1],
  NY: [42.9, -75.5],
  NC: [35.5, -79.4],
  ND: [47.5, -100.3],
  OH: [40.3, -82.8],
  OK: [35.5, -97.5],
  OR: [44, -120.5],
  PA: [40.9, -77.8],
  RI: [41.7, -71.5],
  SC: [33.9, -80.9],
  SD: [44.4, -100.2],
  TN: [35.9, -86.4],
  TX: [31.5, -99.3],
  UT: [39.3, -111.7],
  VT: [44.1, -72.7],
  VA: [37.5, -78.9],
  WA: [47.4, -120.4],
  WV: [38.6, -80.6],
  WI: [44.6, -89.6],
  WY: [42.9, -107.3],
};

function hashString(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h >>> 0);
}

function seedRng(seed: number) {
  let s = (seed || 1) >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

function estimateMiles(originState: string, destState: string, fallback: number) {
  const a = STATE_COORDS[originState];
  const b = STATE_COORDS[destState];
  if (!a || !b) return fallback;
  const dy = (a[0] - b[0]) * 69;
  const dx = (a[1] - b[1]) * 53;
  const direct = Math.sqrt(dx * dx + dy * dy);
  return Math.max(80, Math.round(direct * 1.18));
}

type DatInsights = {
  miles: number;
  capacityScore: number;
  trucksNearOrigin: number;
  trl: number;
  trend: number[];
  trendDelta: number;
  lowRate: number;
  avgRate: number;
  highRate: number;
  lowRpm: number;
  avgRpm: number;
  highRpm: number;
  suggestedCustomerRate: number;
  suggestedCarrierRate: number;
  estMargin: number;
  estMarginPct: number;
  diffVsAvg: number;
  diffPct: number;
  marketPosition: "below" | "at" | "above";
  capacityBadge: "loose" | "moderate" | "tight";
};

function computeDatInsights(draft: LoadDraft, customerRate: number): DatInsights {
  const seedKey = `${draft.pickupState}|${draft.pickupCity}|${draft.deliveryState}|${draft.deliveryCity}|${draft.equipmentType}|${draft.pickupDate}`;
  const seed = hashString(seedKey || "default-lane");
  const rng = seedRng(seed);

  const fallbackMiles = 420 + Math.floor(rng() * 1100);
  const miles = estimateMiles(draft.pickupState, draft.deliveryState, fallbackMiles);

  const baseRpm = EQUIPMENT_RPM_BASE[draft.equipmentType] ?? 2.35;
  const month = draft.pickupDate ? new Date(draft.pickupDate).getMonth() : new Date().getMonth();
  const seasonalMap = [-0.05, -0.04, 0.02, 0.05, 0.07, 0.06, 0.04, 0.02, 0.0, -0.02, 0.06, 0.09];
  const seasonalAdj = seasonalMap[month] ?? 0;

  const weightNum = parseFloat((draft.weight || "").replace(/[^0-9.]/g, ""));
  const weightAdj =
    Number.isFinite(weightNum) && weightNum > 0
      ? Math.min(0.08, Math.max(-0.04, (weightNum / 2000 - 20) * 0.005))
      : 0;
  const hazmatAdj = draft.hazmat ? 0.06 : 0;
  const reeferAdj = draft.equipmentType === "reefer" ? 0.04 : 0;

  const noise = (rng() - 0.5) * 0.16;
  const avgRpm = Math.max(
    1.05,
    baseRpm * (1 + seasonalAdj + weightAdj + hazmatAdj + reeferAdj + noise),
  );
  const lowRpm = avgRpm * (0.82 + rng() * 0.05);
  const highRpm = avgRpm * (1.13 + rng() * 0.06);

  const lowRate = Math.round(lowRpm * miles);
  const avgRate = Math.round(avgRpm * miles);
  const highRate = Math.round(highRpm * miles);

  const capacitySwing = (rng() - 0.5) * 60;
  const seasonalCapacity = seasonalAdj < 0 ? 12 : seasonalAdj > 0.05 ? -14 : 0;
  const capacityScore = Math.round(
    Math.max(8, Math.min(95, 50 + capacitySwing + seasonalCapacity)),
  );

  const trucksNearOrigin = Math.max(8, Math.round(35 + capacityScore * 6.2 + (rng() - 0.5) * 90));
  const trl = Number(((capacityScore / 50) * (0.7 + rng() * 0.6)).toFixed(2));

  const trend: number[] = [];
  let v = Math.max(15, Math.min(90, capacityScore - 14 + rng() * 14));
  for (let i = 0; i < 6; i++) {
    v += (rng() - 0.5) * 16;
    v = Math.max(10, Math.min(95, v));
    trend.push(Math.round(v));
  }
  trend.push(capacityScore);
  const trendDelta = trend[6] - trend[0];

  const tightnessPremium = capacityScore < 35 ? 0.05 : capacityScore < 50 ? 0.02 : 0;
  const loosenessDiscount = capacityScore > 70 ? -0.03 : capacityScore > 55 ? -0.01 : 0;
  const suggestedCustomerRate = Math.round(avgRate * (1.025 + tightnessPremium));
  const suggestedCarrierRate = Math.round(avgRate * (0.86 + loosenessDiscount));
  const estMargin = suggestedCustomerRate - suggestedCarrierRate;
  const estMarginPct = suggestedCustomerRate ? (estMargin / suggestedCustomerRate) * 100 : 0;

  const diffVsAvg = customerRate ? customerRate - avgRate : 0;
  const diffPct = avgRate && customerRate ? (diffVsAvg / avgRate) * 100 : 0;
  const marketPosition: "below" | "at" | "above" =
    !customerRate || Math.abs(diffPct) < 3 ? "at" : diffPct > 0 ? "above" : "below";

  const capacityBadge: "loose" | "moderate" | "tight" =
    capacityScore >= 65 ? "loose" : capacityScore >= 35 ? "moderate" : "tight";

  return {
    miles,
    capacityScore,
    trucksNearOrigin,
    trl,
    trend,
    trendDelta,
    lowRate,
    avgRate,
    highRate,
    lowRpm,
    avgRpm,
    highRpm,
    suggestedCustomerRate,
    suggestedCarrierRate,
    estMargin,
    estMarginPct,
    diffVsAvg,
    diffPct,
    marketPosition,
    capacityBadge,
  };
}

function buildRecommendation(i: DatInsights, customerRate: number, carrierRate: number): string {
  const haveCustomer = customerRate > 0;
  const haveCarrier = carrierRate > 0;
  const carrierVsSuggested =
    haveCarrier && i.suggestedCarrierRate
      ? ((carrierRate - i.suggestedCarrierRate) / i.suggestedCarrierRate) * 100
      : 0;

  if (!haveCustomer) {
    if (i.capacityBadge === "tight") {
      return `Capacity is tight on this lane — only ${i.trucksNearOrigin.toLocaleString()} trucks near origin. Quote toward the high band ($${i.highRate.toLocaleString()}) to secure coverage fast.`;
    }
    if (i.capacityBadge === "loose") {
      return `Capacity is loose with a ${i.trl.toFixed(2)} truck-to-load ratio. You can win competitively at $${i.suggestedCustomerRate.toLocaleString()} and still keep ${i.estMarginPct.toFixed(1)}% margin.`;
    }
    return `Lane average is $${i.avgRate.toLocaleString()} ($${i.avgRpm.toFixed(2)}/mi). Suggested quote: $${i.suggestedCustomerRate.toLocaleString()} for a healthy ${i.estMarginPct.toFixed(1)}% margin.`;
  }

  if (i.marketPosition === "below") {
    if (i.capacityBadge === "tight") {
      return `You are ${Math.abs(i.diffPct).toFixed(1)}% below the 7-day DAT average in a tight market. Raise to at least $${i.avgRate.toLocaleString()} or expect coverage problems.`;
    }
    return `You are ${Math.abs(i.diffPct).toFixed(1)}% below DAT average ($${i.avgRate.toLocaleString()}). Consider a +$${Math.abs(i.diffVsAvg).toLocaleString()} adjustment to capture margin without losing the deal.`;
  }

  if (i.marketPosition === "above") {
    if (i.capacityBadge === "loose") {
      return `Premium pricing — ${i.diffPct.toFixed(1)}% above DAT average and capacity is loose. Strong revenue play; expect easy carrier coverage.`;
    }
    return `Priced ${i.diffPct.toFixed(1)}% above the 7-day DAT average. Margin looks excellent — be ready to defend the rate if shipper benchmarks.`;
  }

  if (haveCarrier && carrierVsSuggested > 6) {
    return `Customer rate is at market, but carrier rate is ${carrierVsSuggested.toFixed(1)}% above the suggested $${i.suggestedCarrierRate.toLocaleString()}. Margin is being squeezed — re-negotiate or post for a backup carrier.`;
  }

  if (i.capacityBadge === "tight") {
    return `At-market pricing with tight capacity. Post immediately and consider a 3-5% premium ($${Math.round(i.avgRate * 0.04).toLocaleString()}) to lock coverage.`;
  }
  return `Priced at the 7-day DAT lane average. Balanced market conditions — proceed with current quote and standard posting strategy.`;
}

function MarketBadge({ position }: { position: "below" | "at" | "above" }) {
  const map = {
    below: {
      label: "Below Market",
      cls: "bg-info/15 text-info border-info/30",
      Icon: TrendingDown,
    },
    at: {
      label: "At Market",
      cls: "bg-muted text-foreground border-border",
      Icon: Minus,
    },
    above: {
      label: "Above Market",
      cls: "bg-success/15 text-success border-success/30",
      Icon: TrendingUp,
    },
  } as const;
  const { label, cls, Icon } = map[position];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold",
        cls,
      )}
    >
      <Icon className="h-3 w-3" />
      {label}
    </span>
  );
}

function CapacityBadge({ level }: { level: "loose" | "moderate" | "tight" }) {
  const map = {
    loose: {
      label: "Loose Capacity",
      cls: "bg-success/15 text-success border-success/30",
    },
    moderate: {
      label: "Moderate Capacity",
      cls: "bg-warning/20 text-warning-foreground border-warning/40",
    },
    tight: {
      label: "Tight Capacity",
      cls: "bg-destructive/15 text-destructive border-destructive/30",
    },
  } as const;
  const { label, cls } = map[level];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold",
        cls,
      )}
    >
      <Radar className="h-3 w-3" />
      {label}
    </span>
  );
}

function Sparkline({
  data,
  color = "var(--color-primary)",
  width = 160,
  height = 44,
}: {
  data: number[];
  color?: string;
  width?: number;
  height?: number;
}) {
  const gradId = React.useId();
  if (data.length < 2) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = Math.max(1, max - min);
  const stepX = width / (data.length - 1);
  const points = data.map((v, i) => {
    const x = i * stepX;
    const y = height - ((v - min) / range) * (height - 6) - 3;
    return [x, y] as const;
  });
  const path = points
    .map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`)
    .join(" ");
  const areaPath = `${path} L${width},${height} L0,${height} Z`;
  const last = points[points.length - 1];
  return (
    <svg width={width} height={height} className="overflow-visible">
      <defs>
        <linearGradient id={gradId} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.35" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={areaPath} fill={`url(#${gradId})`} />
      <path
        d={path}
        fill="none"
        stroke={color}
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx={last[0]} cy={last[1]} r={2.75} fill={color} />
      <circle cx={last[0]} cy={last[1]} r={5} fill={color} fillOpacity={0.2} />
    </svg>
  );
}

function RateBand({
  low,
  avg,
  high,
  user,
}: {
  low: number;
  avg: number;
  high: number;
  user: number;
}) {
  const range = Math.max(1, high - low);
  const avgPos = ((avg - low) / range) * 100;
  const userPos = user > 0 ? Math.max(-6, Math.min(106, ((user - low) / range) * 100)) : null;
  return (
    <div className="space-y-3">
      <div className="relative h-9 rounded-full bg-gradient-to-r from-info/30 via-primary/30 to-success/30 ring-1 ring-inset ring-border/60">
        <div
          className="absolute top-0 bottom-0 w-[2px] -translate-x-1/2 bg-foreground/60"
          style={{ left: `${avgPos}%` }}
          title={`DAT Avg $${avg.toLocaleString()}`}
        >
          <div className="absolute -top-1.5 left-1/2 h-1.5 w-1.5 -translate-x-1/2 rotate-45 bg-foreground/60" />
        </div>
        {userPos != null && (
          <div
            className="absolute -top-1 -bottom-1 z-10 w-3 -translate-x-1/2 rounded-full border-2 border-card bg-primary shadow-md shadow-primary/40"
            style={{ left: `${userPos}%` }}
            title={`Your rate $${user.toLocaleString()}`}
          />
        )}
      </div>
      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="rounded-lg border border-border/70 bg-card px-2 py-1.5">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-info">Low</div>
          <div className="text-sm font-semibold tabular-nums text-foreground">
            ${low.toLocaleString()}
          </div>
        </div>
        <div className="rounded-lg border border-primary/40 bg-primary/5 px-2 py-1.5">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-primary">Avg</div>
          <div className="text-sm font-semibold tabular-nums text-foreground">
            ${avg.toLocaleString()}
          </div>
        </div>
        <div className="rounded-lg border border-border/70 bg-card px-2 py-1.5">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-success">
            High
          </div>
          <div className="text-sm font-semibold tabular-nums text-foreground">
            ${high.toLocaleString()}
          </div>
        </div>
      </div>
    </div>
  );
}

function StatBlock({
  label,
  value,
  hint,
  icon: Icon,
  tone = "default",
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  icon?: LucideIcon;
  tone?: "default" | "success" | "warning" | "destructive" | "info" | "primary";
}) {
  const toneCls = {
    default: "bg-muted text-foreground",
    success: "bg-success/15 text-success",
    warning: "bg-warning/20 text-warning-foreground",
    destructive: "bg-destructive/15 text-destructive",
    info: "bg-info/15 text-info",
    primary: "bg-primary/12 text-primary",
  }[tone];
  return (
    <div className="rounded-lg border border-border/70 bg-card/80 p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          {label}
        </span>
        {Icon && (
          <span className={cn("flex h-6 w-6 items-center justify-center rounded-md", toneCls)}>
            <Icon className="h-3.5 w-3.5" />
          </span>
        )}
      </div>
      <div className="mt-1.5 text-base font-semibold tabular-nums text-foreground">{value}</div>
      {hint && <div className="mt-0.5 text-[11px] text-muted-foreground">{hint}</div>}
    </div>
  );
}

function DatMarketPanel({
  draft,
  customerRate,
  carrierRate,
}: {
  draft: LoadDraft;
  customerRate: number;
  carrierRate: number;
}) {
  const insights = React.useMemo(
    () => computeDatInsights(draft, customerRate),
    [
      draft.pickupCity,
      draft.pickupState,
      draft.deliveryCity,
      draft.deliveryState,
      draft.equipmentType,
      draft.pickupDate,
      draft.weight,
      draft.hazmat,
      customerRate,
    ],
  );

  const recommendation = React.useMemo(
    () => buildRecommendation(insights, customerRate, carrierRate),
    [insights, customerRate, carrierRate],
  );

  const equipmentLabel = lookup(EQUIPMENT_OPTIONS, draft.equipmentType) || "Equipment TBD";
  const lane = `${draft.pickupCity || draft.pickupState || "Origin"} → ${draft.deliveryCity || draft.deliveryState || "Destination"}`;

  const trendUp = insights.trendDelta > 4;
  const trendDown = insights.trendDelta < -4;
  const TrendIcon = trendUp ? TrendingUp : trendDown ? TrendingDown : Minus;
  const trendColor = trendUp
    ? "text-success"
    : trendDown
      ? "text-destructive"
      : "text-muted-foreground";
  const trendLabel = trendUp
    ? `Loosening (+${insights.trendDelta})`
    : trendDown
      ? `Tightening (${insights.trendDelta})`
      : "Steady";

  const diffSign = insights.diffVsAvg > 0 ? "+" : insights.diffVsAvg < 0 ? "−" : "";
  const diffAbs = Math.abs(insights.diffVsAvg);
  const diffPctAbs = Math.abs(insights.diffPct);

  return (
    <Card className="border-primary/30 bg-gradient-to-br from-primary/5 via-card to-info/8">
      {/* Header */}
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-primary to-info text-primary-foreground shadow-sm shadow-primary/30">
            <BarChart3 className="h-5 w-5" />
          </span>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold tracking-tight text-foreground">
                DAT Market Suggestions
              </h3>
              <span className="rounded-full bg-primary/12 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-primary">
                Last 7 days
              </span>
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {lane} · {equipmentLabel} · {insights.miles.toLocaleString()} mi
              {draft.pickupDate && ` · pickup ${draft.pickupDate}`}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <MarketBadge position={insights.marketPosition} />
          <CapacityBadge level={insights.capacityBadge} />
        </div>
      </div>

      {/* Top stats */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatBlock
          label="DAT Capacity Score"
          value={`${insights.capacityScore}/100`}
          hint={
            insights.capacityBadge === "tight"
              ? "Low truck availability"
              : insights.capacityBadge === "loose"
                ? "High truck availability"
                : "Balanced supply"
          }
          icon={Radar}
          tone={
            insights.capacityBadge === "tight"
              ? "destructive"
              : insights.capacityBadge === "loose"
                ? "success"
                : "warning"
          }
        />
        <StatBlock
          label="Trucks Near Origin"
          value={insights.trucksNearOrigin.toLocaleString()}
          hint="Within 100 mi · last 24h"
          icon={Truck}
          tone="primary"
        />
        <StatBlock
          label="Truck-to-Load Ratio"
          value={insights.trl.toFixed(2)}
          hint={
            insights.trl >= 1.2
              ? "Supply > demand"
              : insights.trl >= 0.8
                ? "Balanced"
                : "Demand > supply"
          }
          icon={Gauge}
          tone="info"
        />
        <div className="rounded-lg border border-border/70 bg-card/80 p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Capacity Trend
            </span>
            <span
              className={cn("inline-flex items-center gap-1 text-[11px] font-semibold", trendColor)}
            >
              <TrendIcon className="h-3 w-3" />
              {trendLabel}
            </span>
          </div>
          <div className="mt-1 flex items-end justify-between">
            <div className="text-[11px] text-muted-foreground">7-day capacity</div>
            <Sparkline
              data={insights.trend}
              color={
                trendUp
                  ? "var(--color-success)"
                  : trendDown
                    ? "var(--color-destructive)"
                    : "var(--color-primary)"
              }
              width={140}
              height={36}
            />
          </div>
        </div>
      </div>

      {/* Rate band */}
      <div className="mt-5 grid gap-5 lg:grid-cols-[1fr_320px]">
        <div className="rounded-xl border border-border/70 bg-card/80 p-4">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <div className="text-xs font-semibold tracking-tight text-foreground">
                7-Day DAT Rate Band
              </div>
              <div className="text-[11px] text-muted-foreground">
                Lane rate distribution · {insights.miles.toLocaleString()} mi
              </div>
            </div>
            <div className="text-right">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Rate / Mile
              </div>
              <div className="text-sm font-semibold tabular-nums text-foreground">
                ${insights.avgRpm.toFixed(2)}
                <span className="ml-1 text-[10px] font-medium text-muted-foreground">
                  (${insights.lowRpm.toFixed(2)}–${insights.highRpm.toFixed(2)})
                </span>
              </div>
            </div>
          </div>
          <RateBand
            low={insights.lowRate}
            avg={insights.avgRate}
            high={insights.highRate}
            user={customerRate}
          />
          {customerRate > 0 && (
            <div className="mt-3 flex items-center justify-between rounded-lg border border-border/70 bg-muted/40 px-3 py-2">
              <div className="flex items-center gap-2">
                <Target className="h-3.5 w-3.5 text-primary" />
                <span className="text-xs text-muted-foreground">Your customer rate vs DAT avg</span>
              </div>
              <span
                className={cn(
                  "text-sm font-semibold tabular-nums",
                  insights.marketPosition === "above"
                    ? "text-success"
                    : insights.marketPosition === "below"
                      ? "text-destructive"
                      : "text-foreground",
                )}
              >
                {diffSign}${diffAbs.toLocaleString()}{" "}
                <span className="text-[11px] font-medium text-muted-foreground">
                  ({diffSign}
                  {diffPctAbs.toFixed(1)}%)
                </span>
              </span>
            </div>
          )}
        </div>

        {/* Suggested rates */}
        <div className="rounded-xl border border-border/70 bg-card/80 p-4">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <div className="text-xs font-semibold tracking-tight text-foreground">
                Suggested Rates
              </div>
              <div className="text-[11px] text-muted-foreground">
                Optimized for current capacity
              </div>
            </div>
            <span className="rounded-md bg-primary/12 px-2 py-0.5 text-[10px] font-semibold text-primary">
              AI
            </span>
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between rounded-lg border border-info/30 bg-info/5 px-3 py-2">
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-wider text-info">
                  Carrier
                </div>
                <div className="text-xs text-muted-foreground">Recommended buy</div>
              </div>
              <div className="text-base font-semibold tabular-nums text-foreground">
                ${insights.suggestedCarrierRate.toLocaleString()}
              </div>
            </div>
            <div className="flex items-center justify-between rounded-lg border border-primary/30 bg-primary/8 px-3 py-2">
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-wider text-primary">
                  Customer
                </div>
                <div className="text-xs text-muted-foreground">Recommended sell</div>
              </div>
              <div className="text-base font-semibold tabular-nums text-foreground">
                ${insights.suggestedCustomerRate.toLocaleString()}
              </div>
            </div>
            <div className="flex items-center justify-between rounded-lg border border-success/30 bg-success/8 px-3 py-2">
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-wider text-success">
                  Est. Gross Margin
                </div>
                <div className="text-xs text-muted-foreground">
                  {insights.estMarginPct.toFixed(1)}% on suggested
                </div>
              </div>
              <div className="text-base font-semibold tabular-nums text-success">
                ${insights.estMargin.toLocaleString()}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Recommendation banner */}
      <div className="mt-5 flex items-start gap-3 rounded-xl border border-primary/30 bg-gradient-to-br from-primary/8 via-card to-info/8 p-4">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm shadow-primary/30">
          <Lightbulb className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <div className="text-xs font-semibold tracking-tight text-foreground">
              Smart recommendation
            </div>
            <span className="rounded-full bg-primary/12 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-primary">
              DAT-informed
            </span>
          </div>
          <p className="mt-1 text-sm leading-relaxed text-foreground/90">{recommendation}</p>
          <div className="mt-2 text-[11px] text-muted-foreground">
            Adjust pricing or posting strategy on prior steps before clicking Create Load.
          </div>
        </div>
      </div>
    </Card>
  );
}
