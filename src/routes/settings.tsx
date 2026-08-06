import * as React from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Activity,
  BellRing,
  Building2,
  Database,
  Download,
  FileCog,
  FileText,
  Globe2,
  Layers,
  Link2,
  LoaderCircle,
  Lock,
  Mail,
  MapPinned,
  Receipt,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Settings,
  Shield,
  SlidersHorizontal,
  Sparkles,
  Upload,
  UserCog,
  Webhook,
} from "lucide-react";

import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { usePageReady } from "@/components/page-load-gate";
import { FormCardSkeleton } from "@/components/page-skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { ConfigureAiDialog } from "@/components/integrations/configure-ai-dialog";
import { ConfigureGoogleMapsDialog } from "@/components/integrations/configure-google-maps-dialog";
import {
  INTEGRATION_PROVIDERS,
  integrationStatusBadgeClass,
  runIntegrationTestWithToast,
  toCanonicalIntegrationId,
  useIntegrations,
  type IntegrationId,
} from "@/features/integrations";
import { useAppSettings } from "@/hooks/use-app-settings";
import { useIntegrationsConfig } from "@/hooks/use-integrations-config";
import { fetchAdminAuditLogsCached } from "@/lib/admin-audit-store";
import {
  ensureWorkspaceOpsSeeded,
  loadAutomations,
  loadWebhooks,
  saveAutomations,
  saveWebhooks,
  type AutomationRuleRecord,
  type WebhookEndpointRecord,
} from "@/lib/workspace-ops-store";
import { isWorkspaceSettingsConfigured } from "@/lib/dynamodb";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export const Route = createFileRoute("/settings")({
  head: () => ({
    meta: [
      { title: "Settings - Logistics Software" },
      {
        name: "description",
        content:
          "Enterprise settings control center for preferences, workflows, integrations, automation, security, billing, and defaults.",
      },
    ],
  }),
  component: Page,
});

type SettingValue = string | boolean;

type SettingCategoryId =
  | "general"
  | "company"
  | "workflows"
  | "loads"
  | "truckboard"
  | "tracking"
  | "notifications"
  | "communications"
  | "accounting"
  | "crm"
  | "quotes"
  | "risk"
  | "integrations"
  | "automations"
  | "documents"
  | "userprefs"
  | "security"
  | "billing"
  | "apiwebhooks"
  | "importexport"
  | "systemlogs";

type SettingField = {
  key: string;
  label: string;
  type: "text" | "select" | "toggle" | "textarea";
  placeholder?: string;
  required?: boolean;
  help?: string;
  fullWidth?: boolean;
  options?: string[];
};

type SettingsSection = {
  id: string;
  categoryId: SettingCategoryId;
  title: string;
  description: string;
  scope: "All Admins" | "Ops + Finance" | "Super Admin Only";
  fields: SettingField[];
};

const SETTINGS_CATEGORIES: {
  id: SettingCategoryId;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}[] = [
  { id: "general", label: "General", icon: SlidersHorizontal },
  { id: "company", label: "Company", icon: Building2 },
  { id: "workflows", label: "Workflows", icon: Layers },
  { id: "loads", label: "Loads", icon: FileCog },
  { id: "truckboard", label: "TruckBoard", icon: MapPinned },
  { id: "tracking", label: "Tracking", icon: Activity },
  { id: "notifications", label: "Notifications", icon: BellRing },
  { id: "communications", label: "Communications", icon: Mail },
  { id: "accounting", label: "Accounting", icon: Receipt },
  { id: "crm", label: "CRM & Sales", icon: UserCog },
  { id: "quotes", label: "Quotes & RFPs", icon: FileText },
  { id: "risk", label: "Risk Models", icon: Shield },
  { id: "integrations", label: "Integrations", icon: Link2 },
  { id: "automations", label: "Automations", icon: Sparkles },
  { id: "documents", label: "Documents", icon: FileCog },
  { id: "userprefs", label: "User Preferences", icon: UserCog },
  { id: "security", label: "Security", icon: Lock },
  { id: "billing", label: "Billing", icon: Receipt },
  { id: "apiwebhooks", label: "API & Webhooks", icon: Webhook },
  { id: "importexport", label: "Import / Export", icon: Database },
  { id: "systemlogs", label: "System Logs", icon: Activity },
];

const DEFAULT_SETTINGS: Record<string, SettingValue> = {
  company_name: "Titan Freight Dash",
  default_time_zone: "America/Chicago",
  default_language: "English",
  default_currency: "USD",
  default_date_format: "MM/DD/YYYY",
  default_time_format: "12-hour",
  default_distance_unit: "Miles",
  default_weight_unit: "LBS",
  default_temperature_unit: "Fahrenheit",
  default_theme: "System Theme",
  default_dashboard_view: "Operations",
  default_login_landing_page: "Dashboard",
  default_density: "Comfortable View",

  company_legal_name: "",
  company_dba_name: "",
  mc_number: "",
  dot_number: "",
  ein_tax_id: "",
  company_website: "",
  business_address: "",
  billing_address: "",
  dispatch_phone: "",
  accounting_email: "",
  support_email: "",
  operating_regions: "",
  supported_equipment_types: "Dry Van, Reefer, Flatbed, Power Only",

  default_load_workflow: "Standard Load Lifecycle",
  default_quote_workflow: "Quote Review > Send > Follow-Up",
  default_rfp_workflow: "RFP Intake > Scoring > Response",
  default_carrier_approval_workflow: "Compliance Review > Safety Check > Activation",
  default_invoice_approval_workflow: "POD Validation > Finance Approval",
  required_approval_rules: "High-risk loads and invoice edits require manager approval.",
  auto_assignment_rules: "Assign by branch, team lane, and equipment preference.",
  default_statuses: "Draft, Quoted, Booked, Dispatched, In Transit, Delivered, Invoiced, Paid",
  escalation_rules: "Escalate at 30m delay, 60m ETA drift, 2 failed tracking pings.",

  auto_generate_load_number: true,
  load_number_prefix: "LD-",
  required_load_fields:
    "Pickup Address, Delivery Address, Equipment Type, Commodity, Weight, Customer Rate, Carrier Rate, Tracking",
  default_equipment_type: "Dry Van",
  default_trailer_type: "53' Trailer",
  default_load_status: "Draft",
  default_pickup_window: "2 hours",
  default_delivery_window: "2 hours",
  require_documents_before_dispatch: true,
  require_pod_before_invoice: true,
  require_carrier_assignment: true,

  auto_expire_truck_posts: true,
  default_post_expiration_time: "24 hours",
  required_truckboard_fields: "Origin, Destination, Equipment, Availability",
  default_search_radius: "150 miles",
  allow_power_only_posts: true,
  allow_team_driver_posts: true,
  allow_partial_availability: true,
  show_dat_capacity_suggestions: true,
  show_market_rate_suggestions: true,
  require_mc_dot_verification: true,

  require_tracking_for_all_loads: true,
  default_tracking_method: "Driver App GPS",
  enable_gps_tracking: true,
  enable_manual_checkins: true,
  enable_geofence_events: true,
  default_geofence_radius: "2 miles",
  auto_detect_arrival: true,
  auto_detect_departure: true,
  eta_auto_updates: true,
  route_deviation_alerts: true,
  customer_tracking_links: true,
  tracking_link_expiration: "7 days",
  hide_carrier_details_public_tracking: true,
  hide_rate_details_public_tracking: true,

  notify_load_created: true,
  notify_load_assigned: true,
  notify_quote_sent: true,
  notify_high_risk_alert: true,
  notify_tracking_exception: true,
  notify_document_missing: true,
  notification_channels: "Email, SMS, In-App",

  default_sender_email: "",
  sms_sender_number: "",
  email_signature: "",
  quick_replies:
    "Driver has arrived at pickup.\nDriver has been loaded.\nDriver is in transit.\nDriver has arrived at delivery.\nPOD has been uploaded.",
  communication_logging: true,
  call_logging: true,

  default_payment_terms: "Net 30",
  default_customer_invoice_terms: "Net 30",
  default_carrier_payment_terms: "Net 15",
  invoice_number_prefix: "INV-",
  auto_generate_invoice_numbers: true,
  require_approval_before_invoice: true,
  default_tax_settings: "Standard US tax rules",
  default_fuel_surcharge_rules: "DOE Weekly Index",
  quickpay_settings: "Enabled for approved carriers",

  default_sales_pipeline: "Logistics Growth Pipeline",
  lead_sources: "Website, Referral, Outbound, Partner",
  opportunity_stages: "New Lead, Contacted, Qualified, Quote Sent, Negotiation, Won, Lost",
  auto_assign_leads: true,
  quote_followup_reminder: "48 hours",
  lost_reason_codes: "Price, Capacity, Timing, Compliance",

  quote_number_prefix: "QT-",
  rfp_number_prefix: "RFP-",
  auto_generate_quote_numbers: true,
  auto_generate_rfp_numbers: true,
  quote_expiration_days: "14",
  require_approval_before_sending_quote: true,
  allow_customer_esignature: true,
  default_quote_terms: "Rates valid for 14 days.",

  enable_risk_scoring: true,
  risk_score_thresholds: "Low 0-29, Medium 30-59, High 60-79, Critical 80+",
  high_risk_load_rules: "Escalate loads over $100K or hazmat with new carriers.",
  carrier_fraud_check: true,
  double_brokering_risk_check: true,
  insurance_verification_rules: true,
  authority_verification_rules: true,
  high_value_load_threshold: "$100,000",
  manual_risk_override_permission: "Super Admin + Risk Manager",
  require_manager_approval_high_risk: true,

  dat_api_key: "",
  dat_account_id: "",
  enable_dat_capacity_data: true,
  enable_dat_rate_data: true,
  default_dat_data_window: "Last 7 days",
  show_dat_suggestions_load_review: true,
  show_dat_suggestions_truckboard: true,
  twilio_sms_enabled: false,
  sendgrid_email_enabled: false,
  quickbooks_integration_enabled: false,

  automation_rule_examples:
    "If load is delivered -> request POD\nIf POD uploaded -> notify accounting\nIf carrier insurance expires in 15 days -> alert admin",
  automation_rules_enabled: true,
  automation_default_audience: "Ops Managers",
  automation_schedule: "Always On",

  required_load_documents: "Rate Confirmation, Bill of Lading, POD",
  required_carrier_documents: "Insurance Certificate, W-9, Authority Letter",
  required_driver_documents: "License, Inspection Report",
  allowed_file_types: "CSV, XLSX, PDF, JSON, JPG, PNG",
  maximum_file_size: "25 MB",
  document_approval_workflow: true,
  esignature_settings: "Enabled",

  profile_display_name: "Admin",
  personal_time_zone: "America/Chicago",
  personal_language: "English",
  personal_theme: "System Theme",
  personal_default_dashboard: "Operations",
  table_density: "Comfortable View",
  keyboard_shortcuts: true,

  minimum_password_length: "12",
  require_uppercase: true,
  require_lowercase: true,
  require_number: true,
  require_special_character: true,
  password_expiration: "90 days",
  temporary_password_expiration: "24 hours",
  prevent_password_reuse: "Last 8 passwords",
  session_timeout: "30 minutes",
  login_attempt_limit: "5",
  single_sign_on: true,
  google_login: true,
  microsoft_login: false,
  ip_restrictions: "",
  allowed_domains: "",

  current_plan: "",
  billing_contact: "",
  billing_email: "",
  payment_method: "",
  seats_used: "",
  available_seats: "",
  usage_limits: "",

  api_usage_rate_limits: "",
  webhook_secret_rotation: "",
  developer_docs_link: "",
  create_api_key_scope: "Read + Write",
  webhook_events:
    "load.created, load.updated, load.delivered, quote.accepted, document.uploaded, payment.received",

  import_supported_formats: "CSV, XLSX, JSON",
  export_supported_formats: "CSV, XLSX, PDF, JSON",
  backup_frequency: "Daily",
  backup_retention: "90 days",

  system_log_retention: "180 days",
  audit_log_export_frequency: "Weekly",
  incident_alerting: true,
  environment_label: "Production",
};

const SETTINGS_SECTIONS: SettingsSection[] = [
  {
    id: "general-defaults",
    categoryId: "general",
    title: "General Defaults",
    description: "App-wide default preferences and landing experience.",
    scope: "All Admins",
    fields: [
      { key: "company_name", label: "Company Name", type: "text", required: true },
      {
        key: "default_time_zone",
        label: "Default Time Zone",
        type: "select",
        options: ["America/Chicago", "America/New_York", "America/Denver", "America/Los_Angeles"],
        required: true,
      },
      {
        key: "default_currency",
        label: "Default Currency",
        type: "select",
        options: ["USD", "CAD", "MXN"],
        required: true,
      },
      {
        key: "default_theme",
        label: "Default Theme",
        type: "select",
        options: ["Light Mode", "Dark Mode", "System Theme"],
      },
      {
        key: "default_density",
        label: "Default View Density",
        type: "select",
        options: ["Compact View", "Comfortable View"],
      },
      {
        key: "default_dashboard_view",
        label: "Default Dashboard View",
        type: "select",
        options: ["Operations", "Commercial", "Executive"],
      },
      {
        key: "default_login_landing_page",
        label: "Default Landing Page After Login",
        type: "select",
        options: ["Dashboard", "Loads", "TruckBoard", "Tracking", "CRM & Sales"],
      },
    ],
  },
  {
    id: "company-profile",
    categoryId: "company",
    title: "Company Profile",
    description: "Business identity, addresses, contacts, and operating footprint.",
    scope: "All Admins",
    fields: [
      { key: "company_legal_name", label: "Company Legal Name", type: "text", required: true },
      { key: "company_dba_name", label: "DBA Name", type: "text" },
      { key: "mc_number", label: "MC Number", type: "text" },
      { key: "dot_number", label: "DOT Number", type: "text" },
      { key: "ein_tax_id", label: "EIN / Tax ID", type: "text" },
      { key: "company_website", label: "Company Website", type: "text" },
      {
        key: "business_address",
        label: "Main Business Address",
        type: "textarea",
        fullWidth: true,
      },
      { key: "billing_address", label: "Billing Address", type: "textarea", fullWidth: true },
      { key: "dispatch_phone", label: "Dispatch Phone", type: "text" },
      { key: "accounting_email", label: "Accounting Email", type: "text" },
      { key: "support_email", label: "Support Email", type: "text" },
      {
        key: "operating_regions",
        label: "Operating Regions",
        type: "text",
        placeholder: "US South, Midwest, Southeast",
      },
      {
        key: "supported_equipment_types",
        label: "Supported Equipment Types",
        type: "text",
        placeholder: "Dry Van, Reefer, Flatbed",
      },
    ],
  },
  {
    id: "workflow-rules",
    categoryId: "workflows",
    title: "Workflow Settings",
    description: "Default operational workflow paths, statuses, escalation, and approvals.",
    scope: "Ops + Finance",
    fields: [
      { key: "default_load_workflow", label: "Default Load Workflow", type: "text" },
      { key: "default_quote_workflow", label: "Default Quote Workflow", type: "text" },
      { key: "default_rfp_workflow", label: "Default RFP Workflow", type: "text" },
      {
        key: "default_carrier_approval_workflow",
        label: "Default Carrier Approval Workflow",
        type: "text",
      },
      {
        key: "default_invoice_approval_workflow",
        label: "Default Invoice Approval Workflow",
        type: "text",
      },
      {
        key: "required_approval_rules",
        label: "Required Approval Rules",
        type: "textarea",
        fullWidth: true,
      },
      {
        key: "auto_assignment_rules",
        label: "Auto-Assignment Rules",
        type: "textarea",
        fullWidth: true,
      },
      { key: "default_statuses", label: "Default Statuses", type: "textarea", fullWidth: true },
      { key: "escalation_rules", label: "Escalation Rules", type: "textarea", fullWidth: true },
    ],
  },
  {
    id: "load-defaults",
    categoryId: "loads",
    title: "Load Settings",
    description: "Load creation rules, required fields, numbering, and document requirements.",
    scope: "Ops + Finance",
    fields: [
      { key: "auto_generate_load_number", label: "Auto-Generate Load Number", type: "toggle" },
      { key: "load_number_prefix", label: "Load Number Prefix", type: "text", required: true },
      {
        key: "required_load_fields",
        label: "Required Load Fields",
        type: "textarea",
        fullWidth: true,
        required: true,
      },
      {
        key: "default_equipment_type",
        label: "Default Equipment Type",
        type: "select",
        options: ["Dry Van", "Reefer", "Flatbed", "Power Only", "Step Deck"],
        required: true,
      },
      { key: "default_trailer_type", label: "Default Trailer Type", type: "text" },
      {
        key: "default_load_status",
        label: "Default Load Status",
        type: "select",
        options: ["Draft", "Quoted", "Booked", "Dispatched"],
        required: true,
      },
      { key: "default_pickup_window", label: "Default Pickup Window", type: "text" },
      { key: "default_delivery_window", label: "Default Delivery Window", type: "text" },
      {
        key: "require_documents_before_dispatch",
        label: "Require Documents Before Dispatch",
        type: "toggle",
      },
      {
        key: "require_pod_before_invoice",
        label: "Require POD Before Invoice",
        type: "toggle",
        required: true,
      },
      { key: "require_carrier_assignment", label: "Require Carrier Assignment", type: "toggle" },
    ],
  },
  {
    id: "truckboard-defaults",
    categoryId: "truckboard",
    title: "TruckBoard Settings",
    description: "Capacity posting defaults, verification rules, and market insights.",
    scope: "All Admins",
    fields: [
      { key: "auto_expire_truck_posts", label: "Auto-Expire Truck Posts", type: "toggle" },
      { key: "default_post_expiration_time", label: "Default Post Expiration Time", type: "text" },
      { key: "required_truckboard_fields", label: "Required TruckBoard Fields", type: "text" },
      { key: "default_search_radius", label: "Default Search Radius", type: "text" },
      { key: "allow_power_only_posts", label: "Allow Power Only Posts", type: "toggle" },
      { key: "allow_team_driver_posts", label: "Allow Team Driver Posts", type: "toggle" },
      { key: "allow_partial_availability", label: "Allow Partial Availability", type: "toggle" },
      {
        key: "show_dat_capacity_suggestions",
        label: "Show DAT Capacity Suggestions",
        type: "toggle",
        required: true,
      },
      {
        key: "show_market_rate_suggestions",
        label: "Show Market Rate Suggestions",
        type: "toggle",
      },
      {
        key: "require_mc_dot_verification",
        label: "Require MC / DOT Verification",
        type: "toggle",
      },
    ],
  },
  {
    id: "tracking-rules",
    categoryId: "tracking",
    title: "Tracking Settings",
    description: "Shipment monitoring defaults, geofences, ETA updates, and public link controls.",
    scope: "Ops + Finance",
    fields: [
      {
        key: "require_tracking_for_all_loads",
        label: "Require Tracking for All Loads",
        type: "toggle",
        required: true,
      },
      {
        key: "default_tracking_method",
        label: "Default Tracking Method",
        type: "select",
        options: [
          "Driver App GPS",
          "ELD Integration",
          "Manual Check-In",
          "Carrier Link",
          "Third-Party Tracking",
        ],
      },
      { key: "enable_gps_tracking", label: "Enable GPS Tracking", type: "toggle" },
      { key: "enable_manual_checkins", label: "Enable Manual Check-Ins", type: "toggle" },
      { key: "enable_geofence_events", label: "Enable Geofence Events", type: "toggle" },
      { key: "default_geofence_radius", label: "Default Geofence Radius", type: "text" },
      { key: "auto_detect_arrival", label: "Auto-Detect Arrival", type: "toggle" },
      { key: "auto_detect_departure", label: "Auto-Detect Departure", type: "toggle" },
      { key: "eta_auto_updates", label: "ETA Auto-Updates", type: "toggle" },
      { key: "route_deviation_alerts", label: "Route Deviation Alerts", type: "toggle" },
      { key: "customer_tracking_links", label: "Customer Tracking Links", type: "toggle" },
      { key: "tracking_link_expiration", label: "Tracking Link Expiration", type: "text" },
      {
        key: "hide_carrier_details_public_tracking",
        label: "Hide Carrier Details on Public Tracking",
        type: "toggle",
      },
      {
        key: "hide_rate_details_public_tracking",
        label: "Hide Rate Details on Public Tracking",
        type: "toggle",
      },
    ],
  },
  {
    id: "notification-settings",
    categoryId: "notifications",
    title: "Notification Settings",
    description: "Event triggers and channel routing for teams and admins.",
    scope: "All Admins",
    fields: [
      { key: "notify_load_created", label: "Load Created", type: "toggle" },
      { key: "notify_load_assigned", label: "Load Assigned", type: "toggle" },
      { key: "notify_quote_sent", label: "Quote Sent", type: "toggle" },
      { key: "notify_high_risk_alert", label: "High-Risk Load Alert", type: "toggle" },
      { key: "notify_tracking_exception", label: "Tracking Exception", type: "toggle" },
      { key: "notify_document_missing", label: "Document Missing", type: "toggle" },
      {
        key: "notification_channels",
        label: "Notification Channels",
        type: "text",
        required: true,
      },
    ],
  },
  {
    id: "communications-settings",
    categoryId: "communications",
    title: "Communications Settings",
    description: "Email, SMS, templates, quick replies, and communication logging.",
    scope: "All Admins",
    fields: [
      { key: "default_sender_email", label: "Default Sender Email", type: "text" },
      { key: "sms_sender_number", label: "SMS Sender Number", type: "text" },
      { key: "email_signature", label: "Email Signature", type: "text" },
      { key: "quick_replies", label: "Quick Replies", type: "textarea", fullWidth: true },
      { key: "communication_logging", label: "Communication Logging", type: "toggle" },
      { key: "call_logging", label: "Call Logging", type: "toggle" },
    ],
  },
  {
    id: "accounting-settings",
    categoryId: "accounting",
    title: "Accounting Settings",
    description: "Payment terms, invoice rules, surcharge policies, and finance controls.",
    scope: "Ops + Finance",
    fields: [
      {
        key: "default_payment_terms",
        label: "Default Payment Terms",
        type: "select",
        options: ["Due on Receipt", "Net 7", "Net 15", "Net 30", "Net 45", "Net 60"],
        required: true,
      },
      {
        key: "default_customer_invoice_terms",
        label: "Default Customer Invoice Terms",
        type: "text",
      },
      {
        key: "default_carrier_payment_terms",
        label: "Default Carrier Payment Terms",
        type: "text",
      },
      {
        key: "invoice_number_prefix",
        label: "Invoice Number Prefix",
        type: "text",
        required: true,
      },
      {
        key: "auto_generate_invoice_numbers",
        label: "Auto-Generate Invoice Numbers",
        type: "toggle",
      },
      { key: "require_pod_before_invoice", label: "Require POD Before Invoice", type: "toggle" },
      {
        key: "require_approval_before_invoice",
        label: "Require Approval Before Invoice",
        type: "toggle",
      },
      { key: "default_tax_settings", label: "Default Tax Settings", type: "text" },
      { key: "default_fuel_surcharge_rules", label: "Default Fuel Surcharge Rules", type: "text" },
      { key: "quickpay_settings", label: "QuickPay Settings", type: "text" },
    ],
  },
  {
    id: "crm-sales-settings",
    categoryId: "crm",
    title: "CRM & Sales Settings",
    description: "Lead sources, pipeline stages, follow-up automation, and opportunity controls.",
    scope: "All Admins",
    fields: [
      { key: "default_sales_pipeline", label: "Default Sales Pipeline", type: "text" },
      { key: "lead_sources", label: "Lead Sources", type: "text" },
      { key: "opportunity_stages", label: "Opportunity Stages", type: "textarea", fullWidth: true },
      { key: "auto_assign_leads", label: "Auto-Assign Leads", type: "toggle" },
      { key: "quote_followup_reminder", label: "Quote Follow-Up Reminder", type: "text" },
      { key: "lost_reason_codes", label: "Lost Reason Codes", type: "text" },
    ],
  },
  {
    id: "rfp-quote-settings",
    categoryId: "quotes",
    title: "RFP / Quote Settings",
    description: "Quote and RFP numbering, approval controls, expiration, and templates.",
    scope: "All Admins",
    fields: [
      { key: "quote_number_prefix", label: "Quote Number Prefix", type: "text", required: true },
      { key: "rfp_number_prefix", label: "RFP Number Prefix", type: "text" },
      { key: "auto_generate_quote_numbers", label: "Auto-Generate Quote Numbers", type: "toggle" },
      { key: "auto_generate_rfp_numbers", label: "Auto-Generate RFP Numbers", type: "toggle" },
      { key: "quote_expiration_days", label: "Quote Expiration Days", type: "text" },
      {
        key: "require_approval_before_sending_quote",
        label: "Require Approval Before Sending Quote",
        type: "toggle",
      },
      { key: "allow_customer_esignature", label: "Allow Customer E-Signature", type: "toggle" },
      {
        key: "default_quote_terms",
        label: "Default Quote Terms",
        type: "textarea",
        fullWidth: true,
      },
    ],
  },
  {
    id: "risk-model-settings",
    categoryId: "risk",
    title: "Risk Model Settings",
    description: "Fraud and compliance checks, scoring thresholds, and manager override rules.",
    scope: "Super Admin Only",
    fields: [
      { key: "enable_risk_scoring", label: "Enable Risk Scoring", type: "toggle" },
      { key: "risk_score_thresholds", label: "Risk Score Thresholds", type: "text" },
      {
        key: "high_risk_load_rules",
        label: "High-Risk Load Rules",
        type: "textarea",
        fullWidth: true,
      },
      { key: "carrier_fraud_check", label: "Carrier Fraud Check", type: "toggle" },
      { key: "double_brokering_risk_check", label: "Double Brokering Risk Check", type: "toggle" },
      {
        key: "insurance_verification_rules",
        label: "Insurance Verification Rules",
        type: "toggle",
      },
      {
        key: "authority_verification_rules",
        label: "Authority Verification Rules",
        type: "toggle",
      },
      { key: "high_value_load_threshold", label: "High-Value Load Threshold", type: "text" },
      {
        key: "manual_risk_override_permission",
        label: "Manual Risk Override Permission",
        type: "text",
      },
      {
        key: "require_manager_approval_high_risk",
        label: "Require Manager Approval for High-Risk Loads",
        type: "toggle",
      },
    ],
  },
  {
    id: "integrations-settings",
    categoryId: "integrations",
    title: "Integrations & DAT Settings",
    description: "Third-party connections, DAT controls, and suggestion defaults.",
    scope: "Super Admin Only",
    fields: [
      { key: "dat_api_key", label: "DAT API Key", type: "text", required: true },
      { key: "dat_account_id", label: "DAT Account ID", type: "text" },
      {
        key: "enable_dat_capacity_data",
        label: "Enable DAT Capacity Data",
        type: "toggle",
        required: true,
      },
      {
        key: "enable_dat_rate_data",
        label: "Enable DAT Rate Data",
        type: "toggle",
        required: true,
      },
      {
        key: "default_dat_data_window",
        label: "Default DAT Data Window",
        type: "select",
        options: ["Last 24 hours", "Last 3 days", "Last 7 days", "Last 14 days", "Last 30 days"],
        required: true,
      },
      {
        key: "show_dat_suggestions_load_review",
        label: "Show DAT Suggestions on Load Review",
        type: "toggle",
        required: true,
      },
      {
        key: "show_dat_suggestions_truckboard",
        label: "Show DAT Suggestions on TruckBoard",
        type: "toggle",
        required: true,
      },
      { key: "twilio_sms_enabled", label: "Twilio SMS Integration", type: "toggle" },
      { key: "sendgrid_email_enabled", label: "SendGrid Email Integration", type: "toggle" },
      { key: "quickbooks_integration_enabled", label: "QuickBooks Integration", type: "toggle" },
    ],
  },
  {
    id: "automation-rules",
    categoryId: "automations",
    title: "Automation Rules",
    description: "If-this-then-that workflow actions, schedules, and audiences.",
    scope: "Ops + Finance",
    fields: [
      { key: "automation_rules_enabled", label: "Automation Rules Enabled", type: "toggle" },
      { key: "automation_default_audience", label: "Default Audience", type: "text" },
      { key: "automation_schedule", label: "Schedule", type: "text" },
      {
        key: "automation_rule_examples",
        label: "Rule Definitions",
        type: "textarea",
        fullWidth: true,
      },
    ],
  },
  {
    id: "document-settings",
    categoryId: "documents",
    title: "Document Settings",
    description: "Required document policy, file constraints, approval, and template workflows.",
    scope: "All Admins",
    fields: [
      { key: "required_load_documents", label: "Required Load Documents", type: "text" },
      { key: "required_carrier_documents", label: "Required Carrier Documents", type: "text" },
      { key: "required_driver_documents", label: "Required Driver Documents", type: "text" },
      { key: "allowed_file_types", label: "Allowed File Types", type: "text" },
      { key: "maximum_file_size", label: "Maximum File Size", type: "text" },
      { key: "document_approval_workflow", label: "Document Approval Workflow", type: "toggle" },
      { key: "esignature_settings", label: "E-Signature Settings", type: "text" },
    ],
  },
  {
    id: "user-preferences-settings",
    categoryId: "userprefs",
    title: "User Preferences",
    description: "Default profile, locale, dashboard, filter, and personal productivity settings.",
    scope: "All Admins",
    fields: [
      { key: "profile_display_name", label: "Profile Display Name", type: "text" },
      { key: "personal_time_zone", label: "Personal Time Zone", type: "text" },
      { key: "personal_language", label: "Personal Language", type: "text" },
      {
        key: "personal_theme",
        label: "Personal Theme",
        type: "select",
        options: ["Light Mode", "Dark Mode", "System Theme"],
      },
      { key: "personal_default_dashboard", label: "Default Dashboard", type: "text" },
      {
        key: "table_density",
        label: "Table Density",
        type: "select",
        options: ["Compact View", "Comfortable View"],
      },
      { key: "keyboard_shortcuts", label: "Keyboard Shortcuts", type: "toggle" },
    ],
  },
  {
    id: "security-settings",
    categoryId: "security",
    title: "Security Settings",
    description: "Password policy, session constraints, SSO, login controls, and access rules.",
    scope: "Super Admin Only",
    fields: [
      {
        key: "minimum_password_length",
        label: "Minimum Password Length",
        type: "text",
        required: true,
      },
      { key: "require_uppercase", label: "Require Uppercase", type: "toggle" },
      { key: "require_lowercase", label: "Require Lowercase", type: "toggle" },
      { key: "require_number", label: "Require Number", type: "toggle" },
      { key: "require_special_character", label: "Require Special Character", type: "toggle" },
      { key: "password_expiration", label: "Password Expiration", type: "text" },
      {
        key: "temporary_password_expiration",
        label: "Temporary Password Expiration",
        type: "text",
      },
      { key: "prevent_password_reuse", label: "Prevent Password Reuse", type: "text" },
      { key: "session_timeout", label: "Session Timeout", type: "text", required: true },
      { key: "login_attempt_limit", label: "Login Attempt Limit", type: "text", required: true },
      { key: "single_sign_on", label: "Single Sign-On", type: "toggle" },
      { key: "google_login", label: "Google Login", type: "toggle" },
      { key: "microsoft_login", label: "Microsoft Login", type: "toggle" },
      { key: "ip_restrictions", label: "IP Restrictions", type: "text" },
      { key: "allowed_domains", label: "Allowed Domains", type: "text" },
    ],
  },
  {
    id: "billing-subscription-settings",
    categoryId: "billing",
    title: "Billing & Subscription",
    description: "Plan and subscription controls, seats, usage limits, and billing contacts.",
    scope: "Super Admin Only",
    fields: [
      { key: "current_plan", label: "Current Plan", type: "text" },
      { key: "billing_contact", label: "Billing Contact", type: "text" },
      { key: "billing_email", label: "Billing Email", type: "text" },
      { key: "payment_method", label: "Payment Method", type: "text" },
      { key: "seats_used", label: "Seats Used", type: "text" },
      { key: "available_seats", label: "Available Seats", type: "text" },
      { key: "usage_limits", label: "Usage Limits", type: "textarea", fullWidth: true },
    ],
  },
  {
    id: "api-webhook-settings",
    categoryId: "apiwebhooks",
    title: "API / Webhooks",
    description: "API key policy, webhook event controls, secrets, and rate limits.",
    scope: "Super Admin Only",
    fields: [
      { key: "api_usage_rate_limits", label: "Rate Limits", type: "text" },
      { key: "webhook_secret_rotation", label: "Webhook Secret Rotation", type: "text" },
      { key: "developer_docs_link", label: "Developer Documentation Link", type: "text" },
      { key: "create_api_key_scope", label: "Default API Key Scope", type: "text" },
      { key: "webhook_events", label: "Webhook Events", type: "textarea", fullWidth: true },
    ],
  },
  {
    id: "import-export-settings",
    categoryId: "importexport",
    title: "Data Import / Export",
    description: "Bulk import and export defaults, backup schedule, and retention.",
    scope: "All Admins",
    fields: [
      { key: "import_supported_formats", label: "Import Supported Formats", type: "text" },
      { key: "export_supported_formats", label: "Export Supported Formats", type: "text" },
      { key: "backup_frequency", label: "Backup Frequency", type: "text" },
      { key: "backup_retention", label: "Backup Retention", type: "text" },
    ],
  },
  {
    id: "system-log-settings",
    categoryId: "systemlogs",
    title: "System Logs & Audit",
    description: "Retention policy, export cadence, incident alerting, and environment labels.",
    scope: "Super Admin Only",
    fields: [
      { key: "system_log_retention", label: "System Log Retention", type: "text" },
      { key: "audit_log_export_frequency", label: "Audit Log Export Frequency", type: "text" },
      { key: "incident_alerting", label: "Incident Alerting", type: "toggle" },
      {
        key: "environment_label",
        label: "Environment Label",
        type: "select",
        options: ["Production", "Staging", "Development"],
      },
    ],
  },
];

const SETTINGS_SAVE_RATE_LIMIT_MS = 1500;

function Page() {
  const [activeCategory, setActiveCategory] = React.useState<SettingCategoryId>("general");
  const [search, setSearch] = React.useState("");

  React.useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const category = params.get("category");
    if (
      category === "integrations" ||
      category === "communications" ||
      category === "general"
    ) {
      setActiveCategory(category as SettingCategoryId);
    }
    const hash = window.location.hash.replace(/^#/, "");
    if (hash.startsWith("integration-")) {
      setActiveCategory("integrations");
      window.setTimeout(() => {
        document.getElementById(hash)?.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 200);
    }
  }, []);
  const {
    values,
    setValues,
    savedValues,
    loading: settingsLoading,
    saving,
    save: saveAppSettings,
    error: settingsError,
    dirty,
    workspaceReady,
    lastSavedLabel,
    resetToSaved,
    resetToDefaults,
  } = useAppSettings(DEFAULT_SETTINGS);
  usePageReady(settingsLoading);
  const [saveCoolingDown, setSaveCoolingDown] = React.useState(false);
  const [automationRules, setAutomationRules] = React.useState<AutomationRuleRecord[]>([]);
  const [webhookEndpoints, setWebhookEndpoints] = React.useState<WebhookEndpointRecord[]>([]);
  const [opsLoading, setOpsLoading] = React.useState(false);
  const [systemLogs, setSystemLogs] = React.useState<
    { when: string; actor: string; action: string; module: string; status: string }[]
  >([]);
  const importInputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (!workspaceReady || !isWorkspaceSettingsConfigured()) return;
    let cancelled = false;
    setOpsLoading(true);
    void (async () => {
      try {
        await ensureWorkspaceOpsSeeded();
        const [autos, hooks, audit] = await Promise.all([
          loadAutomations(),
          loadWebhooks(),
          fetchAdminAuditLogsCached({ force: true }).catch(() => []),
        ]);
        if (cancelled) return;
        setAutomationRules(autos.rules);
        setWebhookEndpoints(hooks.endpoints);
        setSystemLogs(
          audit.slice(0, 25).map((row) => ({
            when: row.when,
            actor: row.actorName || "System",
            action: row.action,
            module: row.module,
            status: row.status || "Success",
          })),
        );
      } catch (err) {
        if (!cancelled) {
          toast.error("Could not load workspace ops", {
            description: err instanceof Error ? err.message : "Try again",
          });
        }
      } finally {
        if (!cancelled) setOpsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [workspaceReady]);

  const handleExportSettings = () => {
    const payload = {
      exportedAt: new Date().toISOString(),
      appSettings: values,
      automations: { rules: automationRules },
      webhooks: { endpoints: webhookEndpoints },
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `titan-settings-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Settings exported");
  };

  const handleImportSettings = async (file: File) => {
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as {
        appSettings?: Record<string, SettingValue>;
        automations?: { rules?: AutomationRuleRecord[] };
        webhooks?: { endpoints?: WebhookEndpointRecord[] };
      };
      if (parsed.appSettings && typeof parsed.appSettings === "object") {
        setValues({ ...values, ...parsed.appSettings });
      }
      if (parsed.automations?.rules?.length) {
        setAutomationRules(parsed.automations.rules);
        await saveAutomations({ rules: parsed.automations.rules });
      }
      if (parsed.webhooks?.endpoints?.length) {
        setWebhookEndpoints(parsed.webhooks.endpoints);
        await saveWebhooks({ endpoints: parsed.webhooks.endpoints });
      }
      toast.success("Settings imported", {
        description: "Review changes, then Save to persist app settings to DynamoDB.",
      });
    } catch (err) {
      toast.error("Import failed", {
        description: err instanceof Error ? err.message : "Invalid JSON",
      });
    }
  };

  const toggleAutomationStatus = async (id: string) => {
    const next = automationRules.map((rule) =>
      rule.id === id
        ? {
            ...rule,
            status: (rule.status === "Active" ? "Paused" : "Active") as AutomationRuleRecord["status"],
            updatedAt: new Date().toISOString(),
          }
        : rule,
    );
    setAutomationRules(next);
    try {
      await saveAutomations({ rules: next });
      toast.success("Automation updated in WorkspaceSettings");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save automation");
    }
  };

  const toggleWebhookStatus = async (id: string) => {
    const next = webhookEndpoints.map((wh) =>
      wh.id === id
        ? {
            ...wh,
            status: (wh.status === "Active" ? "Disabled" : "Active") as WebhookEndpointRecord["status"],
            updatedAt: new Date().toISOString(),
          }
        : wh,
    );
    setWebhookEndpoints(next);
    try {
      await saveWebhooks({ endpoints: next });
      toast.success("Webhook updated in WorkspaceSettings");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save webhook");
    }
  };

  const visibleSections = React.useMemo(() => {
    const query = search.trim().toLowerCase();
    return SETTINGS_SECTIONS.filter((section) => {
      const inCategory = section.categoryId === activeCategory;
      if (!inCategory) return false;
      if (query.length === 0) return true;
      const haystack = `${section.title} ${section.description} ${section.fields
        .map((field) => `${field.label} ${field.help ?? ""}`)
        .join(" ")}`.toLowerCase();
      return haystack.includes(query);
    });
  }, [search, activeCategory]);

  const updateValue = (key: string, nextValue: SettingValue) => {
    setValues((prev) => ({ ...prev, [key]: nextValue }));
  };

  const handleSave = async () => {
    if (saving || saveCoolingDown || !dirty) return;

    setSaveCoolingDown(true);
    try {
      await saveAppSettings(values);
      toast.success("Settings saved", {
        description: "All fields are stored in the WorkspaceSettings table for your organization.",
      });
      void fetchAdminAuditLogsCached({ force: true })
        .then((audit) => {
          setSystemLogs(
            audit.slice(0, 25).map((row) => ({
              when: row.when,
              actor: row.actorName || "System",
              action: row.action,
              module: row.module,
              status: row.status || "Success",
            })),
          );
        })
        .catch(() => undefined);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save settings");
    } finally {
      setTimeout(() => setSaveCoolingDown(false), SETTINGS_SAVE_RATE_LIMIT_MS);
    }
  };

  const handleCancel = () => {
    resetToSaved();
  };

  const handleResetDefaults = () => {
    resetToDefaults();
  };

  return (
    <div>
      <PageHeader
        title="Settings Control Center"
        description="Configure company preferences, workflows, integrations, automations, notifications, security, billing, and system defaults."
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={handleExportSettings}
            >
              <Download className="h-4 w-4" /> Export Settings
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={() => importInputRef.current?.click()}
            >
              <Upload className="h-4 w-4" /> Import Settings
            </Button>
            <input
              ref={importInputRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleImportSettings(file);
                e.target.value = "";
              }}
            />
            <Button
              size="sm"
              className="gap-1.5"
              onClick={handleSave}
              disabled={!dirty || saving || saveCoolingDown || settingsLoading || !workspaceReady}
            >
              {saving ? (
                <LoaderCircle className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              Save Changes
            </Button>
          </>
        }
      />

      <div className="grid gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[260px_minmax(0,1fr)] lg:px-8">
        <Card className="h-fit border-border/70 shadow-sm lg:sticky lg:top-4">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Settings Navigation</CardTitle>
            <CardDescription>Enterprise configuration modules</CardDescription>
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline" className="bg-success/15 text-success border-success/25">
                Environment: {String(values.environment_label)}
              </Badge>
              <Badge variant="outline">
                {settingsLoading ? "Loading…" : `Last saved: ${lastSavedLabel}`}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-1">
            {SETTINGS_CATEGORIES.map((category) => {
              const Icon = category.icon;
              const selected = category.id === activeCategory;
              return (
                <button
                  type="button"
                  key={category.id}
                  onClick={() => setActiveCategory(category.id)}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm transition",
                    selected
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                  )}
                >
                  <Icon className="h-4 w-4" />
                  <span>{category.label}</span>
                </button>
              );
            })}
          </CardContent>
        </Card>

        <div className="space-y-4 pb-24">
          <Card className="border-border/70 shadow-sm">
            <CardContent className="grid gap-3 p-4 lg:grid-cols-[minmax(0,1fr)_auto_auto] lg:items-center">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  className="pl-9"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search settings by field, module, or control"
                />
              </div>
              <Badge variant={dirty ? "destructive" : "secondary"} className="h-8 px-3 py-1.5">
                {dirty ? "Unsaved Changes" : "All Changes Saved"}
              </Badge>
              <Badge variant="outline" className="h-8 px-3 py-1.5">
                Category: {labelForCategory(activeCategory)}
              </Badge>
            </CardContent>
          </Card>

          {settingsError ? (
            <Card className="border-destructive/40 bg-destructive/5 shadow-sm">
              <CardContent className="py-3 text-sm text-destructive">{settingsError}</CardContent>
            </Card>
          ) : null}

          {!workspaceReady ? (
            <Card className="border-border/70 shadow-sm">
              <CardContent className="py-3 text-sm text-muted-foreground">
                Sign in and set <code className="text-xs">VITE_WORKSPACE_SETTINGS_TABLE_NAME</code> in{" "}
                <code className="text-xs">.env</code> to save settings to DynamoDB for all users.
              </CardContent>
            </Card>
          ) : null}

          {settingsLoading ? (
            <>
              <FormCardSkeleton fields={4} columns={1} />
              <FormCardSkeleton fields={3} columns={1} />
            </>
          ) : visibleSections.length === 0 ? (
            <Card className="border-border/70 shadow-sm">
              <CardContent className="py-14 text-center text-sm text-muted-foreground">
                No settings matched your search in this category.
              </CardContent>
            </Card>
          ) : (
            visibleSections.map((section) => (
              <Card key={section.id} className="border-border/70 shadow-sm">
                <CardHeader className="pb-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <CardTitle className="text-base">{section.title}</CardTitle>
                    <Badge
                      variant="outline"
                      className={
                        section.scope === "Super Admin Only"
                          ? "bg-destructive/15 text-destructive border-destructive/25"
                          : section.scope === "Ops + Finance"
                            ? "bg-warning/20 text-warning-foreground border-warning/25"
                            : "bg-info/15 text-info border-info/25"
                      }
                    >
                      {section.scope}
                    </Badge>
                  </div>
                  <CardDescription>{section.description}</CardDescription>
                </CardHeader>
                <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {section.fields.map((field) => (
                    <SettingFieldControl
                      key={field.key}
                      field={field}
                      value={values[field.key]}
                      disabled={settingsLoading || !workspaceReady}
                      onChange={(nextValue) => updateValue(field.key, nextValue)}
                    />
                  ))}
                </CardContent>
              </Card>
            ))
          )}

          {activeCategory === "integrations" && (
            <IntegrationsConnectionPanel settingsValues={values} />
          )}

          {activeCategory === "automations" && (
            <Card className="border-border/70 shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Automation Rules Table</CardTitle>
                <CardDescription>
                  Trigger, condition, action, audience, and execution snapshot.
                </CardDescription>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Rule Name</TableHead>
                      <TableHead>Trigger</TableHead>
                      <TableHead>Condition</TableHead>
                      <TableHead>Action</TableHead>
                      <TableHead>Audience</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Last Run</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {opsLoading ? (
                      <TableRow>
                        <TableCell colSpan={7}>
                          <Skeleton className="h-8 w-full" />
                        </TableCell>
                      </TableRow>
                    ) : automationRules.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={7} className="text-center text-sm text-muted-foreground">
                          No automation rules in WorkspaceSettings yet.
                        </TableCell>
                      </TableRow>
                    ) : (
                      automationRules.map((rule) => (
                      <TableRow key={rule.id}>
                        <TableCell className="font-medium">{rule.name}</TableCell>
                        <TableCell>{rule.trigger}</TableCell>
                        <TableCell>{rule.condition}</TableCell>
                        <TableCell>{rule.action}</TableCell>
                        <TableCell>{rule.audience}</TableCell>
                        <TableCell>
                          <button type="button" onClick={() => void toggleAutomationStatus(rule.id)}>
                            <Badge variant={rule.status === "Active" ? "secondary" : "outline"}>
                              {rule.status}
                            </Badge>
                          </button>
                        </TableCell>
                        <TableCell>
                          {rule.lastRunAt
                            ? new Date(rule.lastRunAt).toLocaleString()
                            : "—"}
                        </TableCell>
                      </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}

          {activeCategory === "apiwebhooks" && (
            <Card className="border-border/70 shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Webhook Endpoints</CardTitle>
                <CardDescription>
                  Endpoint health and event subscriptions with test-webhook controls.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Endpoint</TableHead>
                        <TableHead>Events</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {opsLoading ? (
                        <TableRow>
                          <TableCell colSpan={4}>
                            <Skeleton className="h-8 w-full" />
                          </TableCell>
                        </TableRow>
                      ) : webhookEndpoints.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={4} className="text-center text-sm text-muted-foreground">
                            No webhooks in WorkspaceSettings yet.
                          </TableCell>
                        </TableRow>
                      ) : (
                        webhookEndpoints.map((webhook) => (
                          <TableRow key={webhook.id}>
                            <TableCell className="max-w-[340px] truncate">
                              {webhook.endpoint}
                            </TableCell>
                            <TableCell>{webhook.events}</TableCell>
                            <TableCell>
                              <button
                                type="button"
                                onClick={() => void toggleWebhookStatus(webhook.id)}
                              >
                                <Badge
                                  variant="outline"
                                  className={
                                    webhook.status === "Active"
                                      ? "bg-success/15 text-success border-success/25"
                                      : "bg-muted text-muted-foreground border-border"
                                  }
                                >
                                  {webhook.status}
                                </Badge>
                              </button>
                            </TableCell>
                            <TableCell className="text-right">
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-8 gap-1.5"
                                onClick={() =>
                                  toast.message("Test webhook queued", {
                                    description: webhook.endpoint,
                                  })
                                }
                              >
                                <Webhook className="h-3.5 w-3.5" /> Test Webhook
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button size="sm">Create API Key</Button>
                  <Button variant="outline" size="sm">
                    Revoke API Key
                  </Button>
                  <Button variant="outline" size="sm">
                    Open Developer Docs
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {activeCategory === "importexport" && (
            <Card className="border-border/70 shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Data Import / Export Actions</CardTitle>
                <CardDescription>
                  Bulk import and export operations plus backup controls for admins.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                  {[
                    "Import Customers",
                    "Import Carriers",
                    "Import Loads",
                    "Import Trucks",
                    "Import Users",
                    "Import Contacts",
                    "Export Loads",
                    "Export Invoices",
                    "Export Customers",
                    "Export Carrier List",
                    "Export Audit Logs",
                    "Download Backup",
                  ].map((action) => (
                    <Button key={action} variant="outline" className="justify-start">
                      {action}
                    </Button>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  Supported file types: CSV, XLSX, PDF, JSON.
                </p>
              </CardContent>
            </Card>
          )}

          {activeCategory === "systemlogs" && (
            <Card className="border-border/70 shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">System Change Log</CardTitle>
                <CardDescription>
                  Recent configuration changes, warning events, and module-level audit detail.
                </CardDescription>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date / Time</TableHead>
                      <TableHead>Actor</TableHead>
                      <TableHead>Action</TableHead>
                      <TableHead>Module</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {opsLoading && systemLogs.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={5}>
                          <Skeleton className="h-8 w-full" />
                        </TableCell>
                      </TableRow>
                    ) : systemLogs.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center text-sm text-muted-foreground">
                          No admin audit events yet. Changes in Admin will appear here.
                        </TableCell>
                      </TableRow>
                    ) : (
                      systemLogs.map((row) => (
                        <TableRow key={`${row.when}-${row.action}-${row.actor}`}>
                          <TableCell>{row.when}</TableCell>
                          <TableCell>{row.actor}</TableCell>
                          <TableCell>{row.action}</TableCell>
                          <TableCell>{row.module}</TableCell>
                          <TableCell>
                            <Badge variant={row.status === "Success" ? "secondary" : "outline"}>
                              {row.status}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}

          <Card className="border-border/70 shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Cross-module links</CardTitle>
              <CardDescription>
                Settings drive Accounting invoice prefixes, Admin company profile, and integrations.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" asChild>
                <Link to="/accounting">Accounting</Link>
              </Button>
              <Button variant="outline" size="sm" asChild>
                <Link to="/admin">Admin</Link>
              </Button>
              <Button variant="outline" size="sm" asChild>
                <Link to="/communications">Communications</Link>
              </Button>
              <Button variant="outline" size="sm" asChild>
                <Link to="/tracking">Tracking</Link>
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function IntegrationsConnectionPanel({
  settingsValues,
}: {
  settingsValues: Record<string, SettingValue>;
}) {
  const {
    data: integrations,
    isLoading,
    testingId,
    test,
    canTest,
  } = useIntegrations(settingsValues);
  const { config, save, loading, saving, error } = useIntegrationsConfig();
  const [googleMapsOpen, setGoogleMapsOpen] = React.useState(false);
  const [aiOpen, setAiOpen] = React.useState(false);

  const handleConfigure = (id: IntegrationId) => {
    if (id === "google_maps") {
      setGoogleMapsOpen(true);
      return;
    }
    if (id === "ai") {
      setAiOpen(true);
      return;
    }
    toast.message(
      `Configure ${INTEGRATION_PROVIDERS.find((p) => p.id === id)?.label} using the fields above.`,
    );
  };

  return (
    <>
      <Card className="border-border/70 shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Integration Connection Status</CardTitle>
          <CardDescription>
            Connection health, sync recency, and test controls. Google Maps powers facility
            autocomplete on Loads and TruckBoard and geocoding on Tracking maps.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {error ? (
            <p className="col-span-full text-sm text-destructive">{error}</p>
          ) : null}
          {loading || isLoading
            ? Array.from({ length: 6 }).map((_, i) => (
                <div key={`skel-${i}`} className="rounded-md border border-border/70 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <Skeleton className="h-4 w-28" />
                    <Skeleton className="h-5 w-20 rounded-full" />
                  </div>
                  <Skeleton className="mt-3 h-3 w-3/4" />
                  <Skeleton className="mt-2 h-3 w-1/2" />
                </div>
              ))
            : null}
          {!loading &&
            !isLoading &&
            integrations.map((integration) => {
              const testing = testingId === integration.id;
              return (
                <div
                  key={integration.id}
                  id={`integration-${integration.id}`}
                  className="rounded-md border border-border/70 p-3"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="font-medium">{integration.name}</div>
                    <Badge
                      variant="outline"
                      className={integrationStatusBadgeClass(integration.connectionLabel)}
                    >
                      {integration.connectionLabel}
                    </Badge>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Last sync: {integration.lastSyncLabel}
                  </p>
                  <div className="mt-3 flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 gap-1.5"
                      disabled={loading || testing || !canTest(integration.id)}
                      onClick={() => void runIntegrationTestWithToast(test, integration.id)}
                    >
                      {testing ? (
                        <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <RefreshCw className="h-3.5 w-3.5" />
                      )}
                      Test
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8"
                      disabled={loading}
                      onClick={() => handleConfigure(toCanonicalIntegrationId(integration.id))}
                    >
                      Configure
                    </Button>
                  </div>
                </div>
              );
            })}
        </CardContent>
      </Card>

      <ConfigureGoogleMapsDialog
        open={googleMapsOpen}
        onOpenChange={setGoogleMapsOpen}
        config={config}
        onSave={save}
        saving={saving}
      />

      <ConfigureAiDialog
        open={aiOpen}
        onOpenChange={setAiOpen}
        config={config}
        onSave={save}
        saving={saving}
      />
    </>
  );
}

function SettingFieldControl({
  field,
  value,
  onChange,
  disabled = false,
}: {
  field: SettingField;
  value: SettingValue | undefined;
  onChange: (value: SettingValue) => void;
  disabled?: boolean;
}) {
  const normalizedStringValue = typeof value === "string" ? value : "";
  const normalizedBooleanValue = typeof value === "boolean" ? value : false;

  return (
    <label className={cn("space-y-1", field.fullWidth ? "md:col-span-2 xl:col-span-3" : undefined)}>
      <span className="text-xs font-medium text-muted-foreground">
        {field.label}
        {field.required ? " *" : ""}
      </span>

      {field.type === "text" && (
        <Input
          value={normalizedStringValue}
          onChange={(event) => onChange(event.target.value)}
          placeholder={field.placeholder}
          disabled={disabled}
        />
      )}

      {field.type === "textarea" && (
        <Textarea
          value={normalizedStringValue}
          onChange={(event) => onChange(event.target.value)}
          placeholder={field.placeholder}
          rows={3}
          disabled={disabled}
        />
      )}

      {field.type === "select" && (
        <Select
          value={normalizedStringValue}
          onValueChange={(nextValue) => onChange(nextValue)}
          disabled={disabled}
        >
          <SelectTrigger disabled={disabled}>
            <SelectValue placeholder="Select option" />
          </SelectTrigger>
          <SelectContent>
            {(field.options ?? []).map((option) => (
              <SelectItem key={option} value={option}>
                {option}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {field.type === "toggle" && (
        <div className="flex items-center justify-between rounded-md border border-border/70 px-3 py-2">
          <span className="text-sm text-foreground">Enabled</span>
          <Switch
            checked={normalizedBooleanValue}
            onCheckedChange={(checked) => onChange(checked)}
            disabled={disabled}
          />
        </div>
      )}

      {field.help ? <p className="text-xs text-muted-foreground">{field.help}</p> : null}
    </label>
  );
}

function labelForCategory(id: SettingCategoryId) {
  return SETTINGS_CATEGORIES.find((category) => category.id === id)?.label ?? "Settings";
}
