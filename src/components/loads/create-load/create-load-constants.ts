import type { FancySelectOption } from "@/components/loads/fancy-select";
import {
  Activity,
  ArrowRight,
  Calendar,
  CheckCircle2,
  ClipboardCheck,
  Container,
  DollarSign,
  FileText,
  Flame,
  Flag,
  Gauge,
  MapPin,
  Navigation,
  Package,
  Phone,
  Radar,
  Route,
  Shield,
  ShieldCheck,
  Snowflake,
  Sparkles,
  Thermometer,
  Truck,
  User,
  Users,
} from "lucide-react";

export const LOAD_TYPE_OPTIONS: FancySelectOption[] = [
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

export const LOAD_STATUS_OPTIONS: FancySelectOption[] = [
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

export const EQUIPMENT_OPTIONS: FancySelectOption[] = [
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

export const TRAILER_OPTIONS: FancySelectOption[] = [
  { value: "53-dry", label: "53' Dry Van", description: "Standard enclosed trailer" },
  { value: "48-dry", label: "48' Dry Van", description: "Shorter enclosed trailer" },
  { value: "53-reefer", label: "53' Reefer", description: "Temperature-controlled" },
  { value: "48-flat", label: "48' Flatbed", description: "Standard flatbed" },
  { value: "53-flat", label: "53' Flatbed", description: "Long flatbed" },
  { value: "step-deck", label: "Step Deck", description: "Drop-deck flatbed" },
];

export const PRIORITY_OPTIONS: FancySelectOption[] = [
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

export const PACKAGING_OPTIONS: FancySelectOption[] = [
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

export const TRACKING_OPTIONS: FancySelectOption[] = [
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

export const PAYMENT_TERMS_OPTIONS: FancySelectOption[] = [
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

export const FREIGHT_CLASS_OPTIONS: FancySelectOption[] = [
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

export const TEMPERATURE_OPTIONS: FancySelectOption[] = [
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

export const STATE_OPTIONS: FancySelectOption[] = [
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


export const HANDLING_OPTIONS = [
  { id: "stackable", label: "Stackable", icon: Package },
  { id: "tarp", label: "Tarp Required", icon: Shield },
  { id: "team-driver", label: "Team Driver", icon: Users },
  { id: "white-glove", label: "White Glove", icon: Sparkles },
  { id: "liftgate-pu", label: "Liftgate (Pickup)", icon: ArrowRight },
  { id: "liftgate-del", label: "Liftgate (Delivery)", icon: ArrowRight },
  { id: "no-touch", label: "No-Touch Freight", icon: Shield },
  { id: "appt-required", label: "Appointment Required", icon: Calendar },
] as const;

export const DOCUMENT_OPTIONS = [
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
