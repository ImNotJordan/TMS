import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";
import {
  AlertTriangle,
  BellRing,
  Building2,
  Clock3,
  Download,
  Edit3,
  Eye,
  Filter,
  KeyRound,
  Lock,
  Logs,
  Mail,
  LoaderCircle,
  MoreHorizontal,
  PauseCircle,
  RefreshCw,
  Search,
  Send,
  Shield,
  Trash2,
  Upload,
  UserPlus,
  UserX,
  Users,
} from "lucide-react";

import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
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
import { listAdminDirectoryUsers, type AdminUserDirectoryEntry } from "@/lib/admin-users-store";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/admin")({
  head: () => ({
    meta: [
      { title: "Admin - Logistics Software" },
      {
        name: "description",
        content:
          "Enterprise admin control center for users, roles, permissions, invites, security, and audit logs.",
      },
    ],
  }),
  component: Page,
});

const USER_STATUSES = [
  "Active",
  "Pending Invite",
  "Inactive",
  "Suspended",
  "Locked",
  "Deactivated",
] as const;
type UserStatus = (typeof USER_STATUSES)[number];

const INVITE_STATUSES = ["Not Sent", "Sent", "Opened", "Accepted", "Expired", "Canceled"] as const;
type InviteStatus = (typeof INVITE_STATUSES)[number];

const TWO_FA_STATUSES = ["Required", "Enabled", "Optional", "Disabled"] as const;
type TwoFAStatus = (typeof TWO_FA_STATUSES)[number];

const ROLES = [
  "Super Admin",
  "Admin",
  "Operations Manager",
  "Dispatcher",
  "Broker",
  "Carrier Manager",
  "Driver Manager",
  "Sales Representative",
  "Accounting",
  "Customer Support",
  "Read-Only User",
  "Driver",
  "Carrier User",
  "Customer / Shipper User",
] as const;
type Role = (typeof ROLES)[number];

const PERMISSION_TEMPLATES = [
  "Dispatcher Template",
  "Accounting Template",
  "Sales Template",
  "Broker Template",
  "Carrier Manager Template",
  "Admin Template",
  "Driver Template",
  "Customer Portal Template",
] as const;
type PermissionTemplate = (typeof PERMISSION_TEMPLATES)[number];

const ACCESS_SCOPES = [
  "All Company Data",
  "Assigned Branch Only",
  "Assigned Team Only",
  "Assigned Customers Only",
  "Assigned Carriers Only",
  "Assigned Loads Only",
  "Own Records Only",
] as const;
type AccessScope = (typeof ACCESS_SCOPES)[number];

const MODULES = [
  "Dashboard",
  "Bidding",
  "Risk Models",
  "RFPs",
  "Quotes",
  "Loads",
  "TruckBoard",
  "Analytics",
  "Carriers / Brokers",
  "Tracking",
  "Communications",
  "Accounting",
  "CRM & Sales",
  "Settings",
  "Admin",
  "Profile",
] as const;
type ModuleName = (typeof MODULES)[number];

const PERMISSION_LEVELS = [
  "No Access",
  "View Only",
  "Create",
  "Edit",
  "Delete",
  "Approve",
  "Export",
  "Full Access",
] as const;
type PermissionLevel = (typeof PERMISSION_LEVELS)[number];

const FIELD_PERMISSIONS = [
  "Can View Customer Rates",
  "Can View Carrier Rates",
  "Can View Gross Margin",
  "Can Edit Load Pricing",
  "Can Approve Carrier Payments",
  "Can View Accounting Reports",
  "Can Export Customer Data",
  "Can Edit Carrier Compliance",
  "Can Access Risk Models",
  "Can Manage Integrations",
] as const;
type FieldPermission = (typeof FIELD_PERMISSIONS)[number];

type ModulePermissionMatrix = Record<ModuleName, Record<PermissionLevel, boolean>>;
type FieldPermissionMatrix = Record<FieldPermission, boolean>;

type UserRecord = {
  id: string;
  name: string;
  email: string;
  phone: string;
  role: Role;
  department: string;
  status: UserStatus;
  team: string;
  lastLogin: string;
  inviteStatus: InviteStatus;
  twoFAStatus: TwoFAStatus;
  createdDate: string;
};

type AdminSectionId =
  | "users"
  | "roles"
  | "teams"
  | "departments"
  | "branches"
  | "security"
  | "audit"
  | "invitations"
  | "company"
  | "integrations"
  | "billing"
  | "system";

type AddUserDraft = {
  firstName: string;
  lastName: string;
  displayName: string;
  email: string;
  phone: string;
  profilePhoto: string;
  jobTitle: string;
  department: string;
  officeBranch: string;
  timeZone: string;
  language: string;
  username: string;
  temporaryPassword: string;
  sendEmailInvite: boolean;
  requirePasswordReset: boolean;
  requireTwoFactor: boolean;
  accountStatus: UserStatus;
  loginAccessStartDate: string;
  loginAccessExpirationDate: string;
  role: Role;
  permissionTemplate: PermissionTemplate;
  accessLevel: "Standard" | "Elevated" | "Restricted";
  manager: string;
  assignedTeam: string;
  assignedBranch: string;
  modulePermissions: ModulePermissionMatrix;
  fieldPermissions: FieldPermissionMatrix;
  dataAccessScope: AccessScope;
  enforceSessionTimeout: boolean;
  sessionTimeoutMins: string;
  loginAttemptLimit: string;
  trustedDevicesOnly: boolean;
  enableSsoGoogle: boolean;
  enableSsoMicrosoft: boolean;
  ipRestrictions: string;
  inviteExpirationDays: string;
  requireProfileCompletion: boolean;
  customWelcomeMessage: string;
};

const ADMIN_SECTIONS: {
  id: AdminSectionId;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}[] = [
  { id: "users", label: "Users", icon: Users },
  { id: "roles", label: "Roles & Permissions", icon: Shield },
  { id: "teams", label: "Teams", icon: Users },
  { id: "departments", label: "Departments", icon: Building2 },
  { id: "branches", label: "Branches", icon: Building2 },
  { id: "security", label: "Security", icon: Lock },
  { id: "audit", label: "Audit Logs", icon: Logs },
  { id: "invitations", label: "Invitations", icon: Mail },
  { id: "company", label: "Company Settings", icon: Building2 },
  { id: "integrations", label: "Integrations", icon: RefreshCw },
  { id: "billing", label: "Billing", icon: KeyRound },
  { id: "system", label: "System Preferences", icon: Clock3 },
];

const ADD_USER_STEPS = [
  "User Info",
  "Role & Department",
  "Module Access",
  "Data Scope",
  "Security Settings",
  "Review & Invite",
] as const;

const INITIAL_USERS: UserRecord[] = [
  {
    id: "u-001",
    name: "Ava Morgan",
    email: "ava.morgan@titanfreight.com",
    phone: "+1 (214) 555-0130",
    role: "Super Admin",
    department: "Company Admin",
    status: "Active",
    team: "Company Operations",
    lastLogin: "Today, 9:14 AM",
    inviteStatus: "Accepted",
    twoFAStatus: "Enabled",
    createdDate: "Jan 03, 2026",
  },
  {
    id: "u-002",
    name: "Mason Hall",
    email: "mason.hall@titanfreight.com",
    phone: "+1 (312) 555-0144",
    role: "Dispatcher",
    department: "Operations",
    status: "Active",
    team: "Dispatch Team",
    lastLogin: "Today, 8:40 AM",
    inviteStatus: "Accepted",
    twoFAStatus: "Required",
    createdDate: "Feb 11, 2026",
  },
  {
    id: "u-003",
    name: "Priya Shah",
    email: "priya.shah@titanfreight.com",
    phone: "+1 (469) 555-0195",
    role: "Accounting",
    department: "Finance",
    status: "Active",
    team: "Accounting Team",
    lastLogin: "Yesterday, 6:22 PM",
    inviteStatus: "Accepted",
    twoFAStatus: "Enabled",
    createdDate: "Jan 28, 2026",
  },
  {
    id: "u-004",
    name: "Rafael Gomez",
    email: "rafael.gomez@titanfreight.com",
    phone: "+1 (602) 555-0111",
    role: "Sales Representative",
    department: "Sales",
    status: "Pending Invite",
    team: "Sales Team",
    lastLogin: "-",
    inviteStatus: "Opened",
    twoFAStatus: "Optional",
    createdDate: "May 10, 2026",
  },
  {
    id: "u-005",
    name: "Nina Brooks",
    email: "nina.brooks@titanfreight.com",
    phone: "+1 (773) 555-0159",
    role: "Carrier Manager",
    department: "Carrier Compliance",
    status: "Suspended",
    team: "Carrier Compliance Team",
    lastLogin: "May 06, 2026",
    inviteStatus: "Accepted",
    twoFAStatus: "Enabled",
    createdDate: "Mar 14, 2026",
  },
  {
    id: "u-006",
    name: "Jordan Lee",
    email: "jordan.lee@shipperco.com",
    phone: "+1 (404) 555-0127",
    role: "Customer / Shipper User",
    department: "Customer Portal",
    status: "Inactive",
    team: "Customer Support Team",
    lastLogin: "Apr 21, 2026",
    inviteStatus: "Expired",
    twoFAStatus: "Disabled",
    createdDate: "Feb 08, 2026",
  },
];

const ROLE_TEMPLATE_SUMMARY: Record<
  PermissionTemplate,
  { modules: string; dataScope: AccessScope; fieldRules: string }
> = {
  "Dispatcher Template": {
    modules: "Loads, Tracking, Communications",
    dataScope: "Assigned Team Only",
    fieldRules: "Can Edit Load Pricing",
  },
  "Accounting Template": {
    modules: "Accounting, Analytics, Loads (view)",
    dataScope: "All Company Data",
    fieldRules: "Can Approve Carrier Payments",
  },
  "Sales Template": {
    modules: "CRM & Sales, Quotes, RFPs",
    dataScope: "Assigned Customers Only",
    fieldRules: "Can View Gross Margin",
  },
  "Broker Template": {
    modules: "Loads, Carriers / Brokers, Tracking",
    dataScope: "Assigned Loads Only",
    fieldRules: "Can View Carrier Rates",
  },
  "Carrier Manager Template": {
    modules: "Carriers / Brokers, Tracking, Risk Models",
    dataScope: "Assigned Carriers Only",
    fieldRules: "Can Edit Carrier Compliance",
  },
  "Admin Template": {
    modules: "All modules",
    dataScope: "All Company Data",
    fieldRules: "Can Manage Integrations",
  },
  "Driver Template": {
    modules: "Loads, Tracking, Profile",
    dataScope: "Own Records Only",
    fieldRules: "No financial visibility",
  },
  "Customer Portal Template": {
    modules: "Quotes, Tracking, Profile",
    dataScope: "Assigned Customers Only",
    fieldRules: "Can Export Customer Data",
  },
};

const SECURITY_EVENTS = [
  { label: "Suspicious login detected", when: "7 minutes ago", severity: "warning" },
  { label: "Invite expired for 2 users", when: "1 hour ago", severity: "warning" },
  { label: "Password reset requested", when: "2 hours ago", severity: "info" },
  { label: "2FA disabled for one user", when: "Today, 7:30 AM", severity: "destructive" },
] as const;

const AUDIT_LOGS = [
  {
    when: "2026-05-14 09:02",
    user: "Ava Morgan",
    action: "Role Changed",
    module: "Admin",
    record: "mason.hall@titanfreight.com",
    ip: "73.44.211.12",
    device: "Chrome on macOS",
    status: "Success",
    details: "Dispatcher -> Operations Manager",
  },
  {
    when: "2026-05-14 08:41",
    user: "System",
    action: "Login Failed",
    module: "Security",
    record: "nina.brooks@titanfreight.com",
    ip: "96.19.33.92",
    device: "Safari on iOS",
    status: "Blocked",
    details: "Attempt limit exceeded",
  },
  {
    when: "2026-05-14 08:05",
    user: "Priya Shah",
    action: "Invoice Edited",
    module: "Accounting",
    record: "INV-99221",
    ip: "172.16.48.21",
    device: "Edge on Windows",
    status: "Success",
    details: "Added detention fee",
  },
  {
    when: "2026-05-14 07:28",
    user: "Mason Hall",
    action: "Load Deleted",
    module: "Loads",
    record: "L-44821",
    ip: "205.188.10.4",
    device: "Chrome on Windows",
    status: "Reviewed",
    details: "Approved by Super Admin",
  },
];

function buildDefaultModulePermissions(): ModulePermissionMatrix {
  const matrix = {} as ModulePermissionMatrix;
  for (const moduleName of MODULES) {
    matrix[moduleName] = {
      "No Access": true,
      "View Only": false,
      Create: false,
      Edit: false,
      Delete: false,
      Approve: false,
      Export: false,
      "Full Access": false,
    };
  }
  matrix.Dashboard["View Only"] = true;
  matrix.Dashboard["No Access"] = false;
  matrix.Loads["View Only"] = true;
  matrix.Loads.Create = true;
  matrix.Loads.Edit = true;
  matrix.Loads["No Access"] = false;
  return matrix;
}

function buildDefaultFieldPermissions(): FieldPermissionMatrix {
  const matrix = {} as FieldPermissionMatrix;
  for (const permission of FIELD_PERMISSIONS) {
    matrix[permission] = false;
  }
  matrix["Can View Customer Rates"] = true;
  matrix["Can View Carrier Rates"] = true;
  return matrix;
}

function buildEmptyDraft(): AddUserDraft {
  return {
    firstName: "",
    lastName: "",
    displayName: "",
    email: "",
    phone: "",
    profilePhoto: "",
    jobTitle: "",
    department: "Operations",
    officeBranch: "Dallas HQ",
    timeZone: "America/Chicago",
    language: "English",
    username: "",
    temporaryPassword: "",
    sendEmailInvite: true,
    requirePasswordReset: true,
    requireTwoFactor: true,
    accountStatus: "Pending Invite",
    loginAccessStartDate: "",
    loginAccessExpirationDate: "",
    role: "Dispatcher",
    permissionTemplate: "Dispatcher Template",
    accessLevel: "Standard",
    manager: "",
    assignedTeam: "Dispatch Team",
    assignedBranch: "Dallas HQ",
    modulePermissions: buildDefaultModulePermissions(),
    fieldPermissions: buildDefaultFieldPermissions(),
    dataAccessScope: "Assigned Team Only",
    enforceSessionTimeout: true,
    sessionTimeoutMins: "30",
    loginAttemptLimit: "5",
    trustedDevicesOnly: false,
    enableSsoGoogle: false,
    enableSsoMicrosoft: false,
    ipRestrictions: "",
    inviteExpirationDays: "7",
    requireProfileCompletion: true,
    customWelcomeMessage:
      "Welcome to Titan Freight. Please complete your profile before dispatch access is granted.",
  };
}

function statusTone(status: UserStatus) {
  if (status === "Active") return "bg-success/15 text-success border-success/25";
  if (status === "Pending Invite") return "bg-info/15 text-info border-info/25";
  if (status === "Suspended" || status === "Locked") {
    return "bg-destructive/15 text-destructive border-destructive/25";
  }
  if (status === "Deactivated") return "bg-muted text-muted-foreground border-border";
  return "bg-warning/20 text-warning-foreground border-warning/25";
}

function inviteTone(status: InviteStatus) {
  if (status === "Accepted") return "bg-success/15 text-success border-success/25";
  if (status === "Opened" || status === "Sent") return "bg-info/15 text-info border-info/25";
  if (status === "Expired" || status === "Canceled") {
    return "bg-destructive/15 text-destructive border-destructive/25";
  }
  return "bg-muted text-muted-foreground border-border";
}

function formatNowForCreatedDate() {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "2-digit",
    year: "numeric",
  }).format(new Date());
}

function selectedPermissionsForModule(levelMap: Record<PermissionLevel, boolean>) {
  return PERMISSION_LEVELS.filter((level) => levelMap[level]);
}

function applyTemplateToDraft(
  template: PermissionTemplate,
  currentDraft: AddUserDraft,
): AddUserDraft {
  const nextDraft: AddUserDraft = {
    ...currentDraft,
    permissionTemplate: template,
    modulePermissions: buildDefaultModulePermissions(),
    fieldPermissions: buildDefaultFieldPermissions(),
  };

  if (template === "Admin Template") {
    for (const moduleName of MODULES) {
      nextDraft.modulePermissions[moduleName]["No Access"] = false;
      nextDraft.modulePermissions[moduleName]["Full Access"] = true;
      nextDraft.modulePermissions[moduleName]["View Only"] = false;
      nextDraft.modulePermissions[moduleName].Create = false;
      nextDraft.modulePermissions[moduleName].Edit = false;
      nextDraft.modulePermissions[moduleName].Delete = false;
      nextDraft.modulePermissions[moduleName].Approve = false;
      nextDraft.modulePermissions[moduleName].Export = false;
    }
    for (const fieldPermission of FIELD_PERMISSIONS) {
      nextDraft.fieldPermissions[fieldPermission] = true;
    }
    nextDraft.dataAccessScope = "All Company Data";
    nextDraft.role = "Admin";
    nextDraft.accessLevel = "Elevated";
  }

  if (template === "Accounting Template") {
    for (const moduleName of MODULES) {
      nextDraft.modulePermissions[moduleName]["No Access"] = true;
      nextDraft.modulePermissions[moduleName]["View Only"] = false;
      nextDraft.modulePermissions[moduleName].Create = false;
      nextDraft.modulePermissions[moduleName].Edit = false;
      nextDraft.modulePermissions[moduleName].Delete = false;
      nextDraft.modulePermissions[moduleName].Approve = false;
      nextDraft.modulePermissions[moduleName].Export = false;
      nextDraft.modulePermissions[moduleName]["Full Access"] = false;
    }
    nextDraft.modulePermissions.Accounting["No Access"] = false;
    nextDraft.modulePermissions.Accounting["View Only"] = true;
    nextDraft.modulePermissions.Accounting.Approve = true;
    nextDraft.modulePermissions.Analytics["No Access"] = false;
    nextDraft.modulePermissions.Analytics["View Only"] = true;
    nextDraft.modulePermissions.Loads["No Access"] = false;
    nextDraft.modulePermissions.Loads["View Only"] = true;
    nextDraft.fieldPermissions["Can Approve Carrier Payments"] = true;
    nextDraft.fieldPermissions["Can View Accounting Reports"] = true;
    nextDraft.dataAccessScope = "All Company Data";
    nextDraft.role = "Accounting";
    nextDraft.department = "Finance";
  }

  if (template === "Sales Template") {
    for (const moduleName of MODULES) {
      nextDraft.modulePermissions[moduleName]["No Access"] = true;
      nextDraft.modulePermissions[moduleName]["View Only"] = false;
      nextDraft.modulePermissions[moduleName].Create = false;
      nextDraft.modulePermissions[moduleName].Edit = false;
      nextDraft.modulePermissions[moduleName].Delete = false;
      nextDraft.modulePermissions[moduleName].Approve = false;
      nextDraft.modulePermissions[moduleName].Export = false;
      nextDraft.modulePermissions[moduleName]["Full Access"] = false;
    }
    nextDraft.modulePermissions["CRM & Sales"]["No Access"] = false;
    nextDraft.modulePermissions["CRM & Sales"]["View Only"] = true;
    nextDraft.modulePermissions["CRM & Sales"].Create = true;
    nextDraft.modulePermissions["CRM & Sales"].Edit = true;
    nextDraft.modulePermissions.Quotes["No Access"] = false;
    nextDraft.modulePermissions.Quotes["View Only"] = true;
    nextDraft.modulePermissions.Quotes.Create = true;
    nextDraft.modulePermissions.RFPs["No Access"] = false;
    nextDraft.modulePermissions.RFPs["View Only"] = true;
    nextDraft.fieldPermissions["Can View Gross Margin"] = true;
    nextDraft.fieldPermissions["Can Export Customer Data"] = true;
    nextDraft.dataAccessScope = "Assigned Customers Only";
    nextDraft.role = "Sales Representative";
    nextDraft.department = "Sales";
    nextDraft.assignedTeam = "Sales Team";
  }

  return nextDraft;
}

function prettyDate(value: string | undefined): string {
  if (!value) return "-";
  const maybe = new Date(value);
  if (Number.isNaN(maybe.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "2-digit",
    year: "numeric",
  }).format(maybe);
}

function prettyDateTime(value: string | undefined): string {
  if (!value) return "-";
  const maybe = new Date(value);
  if (Number.isNaN(maybe.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "2-digit",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(maybe);
}

function normalizeRole(value: string | undefined): Role {
  if (!value) return "Read-Only User";
  const exact = ROLES.find((role) => role.toLowerCase() === value.toLowerCase());
  if (exact) return exact;
  const normalized = value.toLowerCase();
  if (normalized.includes("admin")) return "Admin";
  if (normalized.includes("dispatch")) return "Dispatcher";
  if (normalized.includes("account")) return "Accounting";
  if (normalized.includes("sales")) return "Sales Representative";
  if (normalized.includes("carrier")) return "Carrier Manager";
  if (normalized.includes("driver")) return "Driver";
  if (normalized.includes("broker")) return "Broker";
  if (normalized.includes("support")) return "Customer Support";
  return "Read-Only User";
}

function normalizeStatus(value: string | undefined): UserStatus {
  if (!value) return "Active";
  const exact = USER_STATUSES.find((status) => status.toLowerCase() === value.toLowerCase());
  if (exact) return exact;
  const normalized = value.toLowerCase();
  if (normalized.includes("pending")) return "Pending Invite";
  if (normalized.includes("suspend")) return "Suspended";
  if (normalized.includes("lock")) return "Locked";
  if (normalized.includes("deactiv")) return "Deactivated";
  if (normalized.includes("inactive")) return "Inactive";
  return "Active";
}

function normalizeInviteStatus(value: string | undefined, status: UserStatus): InviteStatus {
  const exact =
    value &&
    INVITE_STATUSES.find((inviteStatus) => inviteStatus.toLowerCase() === value.toLowerCase());
  if (exact) return exact;
  if (status === "Pending Invite") return "Sent";
  if (status === "Inactive") return "Expired";
  return "Accepted";
}

function normalizeTwoFaStatus(value: string | undefined): TwoFAStatus {
  if (!value) return "Optional";
  const exact = TWO_FA_STATUSES.find((status) => status.toLowerCase() === value.toLowerCase());
  if (exact) return exact;
  const normalized = value.toLowerCase();
  if (normalized.includes("require")) return "Required";
  if (normalized.includes("enable")) return "Enabled";
  if (normalized.includes("disable")) return "Disabled";
  return "Optional";
}

function mapLiveUser(entry: AdminUserDirectoryEntry, index: number): UserRecord {
  const status = normalizeStatus(entry.status);
  return {
    id: entry.id || `live-${index + 1}`,
    name: entry.name || entry.email || `User ${index + 1}`,
    email: entry.email || "-",
    phone: entry.phone || "-",
    role: normalizeRole(entry.role),
    department: entry.department || "Operations",
    status,
    team: entry.team || "Unassigned",
    lastLogin: prettyDateTime(entry.lastLogin),
    inviteStatus: normalizeInviteStatus(entry.inviteStatus, status),
    twoFAStatus: normalizeTwoFaStatus(entry.twoFAStatus),
    createdDate: prettyDate(entry.createdDate),
  };
}

function Page() {
  const [activeSection, setActiveSection] = React.useState<AdminSectionId>("users");
  const [users, setUsers] = React.useState<UserRecord[]>([]);
  const [usersLoading, setUsersLoading] = React.useState(true);
  const [usersWarning, setUsersWarning] = React.useState<string | null>(null);
  const [usersError, setUsersError] = React.useState<string | null>(null);
  const [userSearch, setUserSearch] = React.useState("");
  const [statusFilter, setStatusFilter] = React.useState<"all" | UserStatus>("all");
  const [roleFilter, setRoleFilter] = React.useState<"all" | Role>("all");
  const [departmentFilter, setDepartmentFilter] = React.useState<"all" | string>("all");
  const [selectedIds, setSelectedIds] = React.useState<Record<string, boolean>>({});

  const [addUserOpen, setAddUserOpen] = React.useState(false);
  const [draft, setDraft] = React.useState<AddUserDraft>(buildEmptyDraft());
  const [wizardStep, setWizardStep] = React.useState(0);
  const [savedDraftCount, setSavedDraftCount] = React.useState(0);

  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      setUsersLoading(true);
      setUsersWarning(null);
      setUsersError(null);
      try {
        const result = await listAdminDirectoryUsers();
        if (cancelled) return;
        const liveUsers = result.users.map(mapLiveUser);
        setUsers(liveUsers.length > 0 ? liveUsers : INITIAL_USERS);
        if (result.warning) setUsersWarning(result.warning);
      } catch (err) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : "Could not load users";
        setUsers(INITIAL_USERS);
        setUsersError(`${message}. Showing fallback records.`);
      } finally {
        if (!cancelled) setUsersLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const departments = React.useMemo(() => {
    const all = new Set(users.map((u) => u.department));
    return Array.from(all).sort();
  }, [users]);

  const filteredUsers = React.useMemo(() => {
    const query = userSearch.trim().toLowerCase();
    return users.filter((user) => {
      const matchesQuery =
        query.length === 0 ||
        user.name.toLowerCase().includes(query) ||
        user.email.toLowerCase().includes(query) ||
        user.team.toLowerCase().includes(query);

      const matchesStatus = statusFilter === "all" || user.status === statusFilter;
      const matchesRole = roleFilter === "all" || user.role === roleFilter;
      const matchesDepartment = departmentFilter === "all" || user.department === departmentFilter;
      return matchesQuery && matchesStatus && matchesRole && matchesDepartment;
    });
  }, [users, userSearch, statusFilter, roleFilter, departmentFilter]);

  const selectedVisibleIds = filteredUsers.filter((u) => selectedIds[u.id]).map((u) => u.id);
  const allVisibleSelected =
    filteredUsers.length > 0 && selectedVisibleIds.length === filteredUsers.length;

  const userMetrics = React.useMemo(() => {
    const activeUsers = users.filter((user) => user.status === "Active").length;
    const pendingInvites = users.filter((user) => user.status === "Pending Invite").length;
    const suspended = users.filter(
      (user) => user.status === "Suspended" || user.status === "Locked",
    ).length;
    const twoFAEnabled = users.filter(
      (user) => user.twoFAStatus === "Enabled" || user.twoFAStatus === "Required",
    ).length;
    return { activeUsers, pendingInvites, suspended, twoFAEnabled };
  }, [users]);

  const inviteRows = React.useMemo(() => {
    return users
      .filter((user) => user.inviteStatus !== "Accepted")
      .map((user) => ({
        id: user.id,
        name: user.name,
        email: user.email,
        status: user.inviteStatus,
        expires: user.inviteStatus === "Expired" ? "Expired" : "In 5 days",
      }));
  }, [users]);

  const toggleVisibleSelection = (checked: boolean) => {
    setSelectedIds((prev) => {
      const next = { ...prev };
      for (const user of filteredUsers) next[user.id] = checked;
      return next;
    });
  };

  const toggleSingleSelection = (userId: string, checked: boolean) => {
    setSelectedIds((prev) => ({ ...prev, [userId]: checked }));
  };

  const openAddUser = () => {
    setDraft(buildEmptyDraft());
    setWizardStep(0);
    setAddUserOpen(true);
  };

  const updateDraft = <K extends keyof AddUserDraft>(key: K, value: AddUserDraft[K]) => {
    setDraft((prev) => ({ ...prev, [key]: value }));
  };

  const toggleModulePermission = (
    moduleName: ModuleName,
    level: PermissionLevel,
    checked: boolean,
  ) => {
    setDraft((prev) => {
      const currentModule = prev.modulePermissions[moduleName];
      const nextModule: Record<PermissionLevel, boolean> = { ...currentModule };

      if (level === "No Access") {
        if (checked) {
          for (const permissionLevel of PERMISSION_LEVELS) {
            nextModule[permissionLevel] = permissionLevel === "No Access";
          }
        } else {
          nextModule["No Access"] = false;
        }
      } else if (level === "Full Access") {
        if (checked) {
          for (const permissionLevel of PERMISSION_LEVELS) {
            nextModule[permissionLevel] = permissionLevel === "Full Access";
          }
        } else {
          nextModule["Full Access"] = false;
          if (
            !Object.entries(nextModule).some(
              ([permissionLevel, enabled]) => permissionLevel !== "No Access" && enabled,
            )
          ) {
            nextModule["No Access"] = true;
          }
        }
      } else {
        nextModule[level] = checked;
        if (checked) {
          nextModule["No Access"] = false;
          nextModule["Full Access"] = false;
        }
        const hasOperationalPermission =
          nextModule["View Only"] ||
          nextModule.Create ||
          nextModule.Edit ||
          nextModule.Delete ||
          nextModule.Approve ||
          nextModule.Export ||
          nextModule["Full Access"];
        if (!hasOperationalPermission) {
          nextModule["No Access"] = true;
        }
      }

      return {
        ...prev,
        modulePermissions: {
          ...prev.modulePermissions,
          [moduleName]: nextModule,
        },
      };
    });
  };

  const toggleFieldPermission = (permission: FieldPermission, checked: boolean) => {
    setDraft((prev) => ({
      ...prev,
      fieldPermissions: {
        ...prev.fieldPermissions,
        [permission]: checked,
      },
    }));
  };

  const stepCanContinue = React.useMemo(() => {
    if (wizardStep === 0) return Boolean(draft.firstName && draft.lastName && draft.email);
    if (wizardStep === 1)
      return Boolean(draft.role && draft.department && draft.permissionTemplate);
    if (wizardStep === 2) return true;
    if (wizardStep === 3) return Boolean(draft.dataAccessScope);
    if (wizardStep === 4) return Boolean(draft.accountStatus);
    return true;
  }, [wizardStep, draft]);

  const createUser = (sendInviteNow: boolean) => {
    const fullName =
      `${draft.firstName} ${draft.lastName}`.trim() || draft.displayName || "New User";
    const nextUser: UserRecord = {
      id: `u-${Math.floor(1000 + Math.random() * 9000)}`,
      name: fullName,
      email: draft.email,
      phone: draft.phone || "-",
      role: draft.role,
      department: draft.department,
      status:
        draft.accountStatus === "Pending Invite" || sendInviteNow
          ? "Pending Invite"
          : draft.accountStatus,
      team: draft.assignedTeam || "Unassigned",
      lastLogin: "-",
      inviteStatus: sendInviteNow ? "Sent" : "Not Sent",
      twoFAStatus: draft.requireTwoFactor ? "Required" : "Optional",
      createdDate: formatNowForCreatedDate(),
    };

    setUsers((prev) => [nextUser, ...prev]);
    setAddUserOpen(false);
    setWizardStep(0);
    setDraft(buildEmptyDraft());
    setActiveSection("users");
  };

  const saveDraft = () => {
    setSavedDraftCount((prev) => prev + 1);
    setAddUserOpen(false);
    setWizardStep(0);
  };

  return (
    <div>
      <PageHeader
        title="Admin Control Center"
        description="Complete user management, permissions, invitation workflows, security controls, and audit visibility."
        actions={
          <>
            <Button variant="outline" size="sm" className="gap-1.5">
              <Filter className="h-4 w-4" /> Filters
            </Button>
            <Button variant="outline" size="sm" className="gap-1.5">
              <Download className="h-4 w-4" /> Export
            </Button>
            <Button variant="outline" size="sm" className="gap-1.5">
              <Upload className="h-4 w-4" /> Import CSV
            </Button>
            <Button size="sm" className="gap-1.5" onClick={openAddUser}>
              <UserPlus className="h-4 w-4" /> Add User
            </Button>
          </>
        }
      />

      <div className="grid gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[250px_minmax(0,1fr)] lg:px-8">
        <Card className="h-fit border-border/70 shadow-sm lg:sticky lg:top-4">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Admin Navigation</CardTitle>
            <CardDescription>Control every access surface</CardDescription>
          </CardHeader>
          <CardContent className="space-y-1">
            {ADMIN_SECTIONS.map((section) => {
              const Icon = section.icon;
              return (
                <button
                  key={section.id}
                  type="button"
                  onClick={() => setActiveSection(section.id)}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm transition",
                    activeSection === section.id
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                  )}
                >
                  <Icon className="h-4 w-4" />
                  <span>{section.label}</span>
                </button>
              );
            })}
          </CardContent>
        </Card>

        <div className="space-y-6">
          {activeSection === "users" && (
            <>
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <MetricCard
                  label="Total Users"
                  value={users.length.toString()}
                  hint="Across all portals"
                />
                <MetricCard
                  label="Active Users"
                  value={userMetrics.activeUsers.toString()}
                  hint="Can access production"
                  tone="success"
                />
                <MetricCard
                  label="Pending Invites"
                  value={userMetrics.pendingInvites.toString()}
                  hint="Need onboarding"
                  tone="info"
                />
                <MetricCard
                  label="2FA Protected"
                  value={userMetrics.twoFAEnabled.toString()}
                  hint="Security coverage"
                  tone="warning"
                />
              </div>

              <Card className="border-border/70 shadow-sm">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Users</CardTitle>
                  <CardDescription>
                    Add, invite, edit, suspend, deactivate, and permission users with branch and
                    team scope.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {usersLoading && (
                    <div className="flex items-center gap-2 rounded-md border border-border/70 bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
                      <LoaderCircle className="h-4 w-4 animate-spin" />
                      Loading users from UsersTable / Cognito...
                    </div>
                  )}
                  {usersWarning && (
                    <div className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning-foreground">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                      {usersWarning}
                    </div>
                  )}
                  {usersError && (
                    <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                      {usersError}
                    </div>
                  )}
                  <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_180px_200px_200px_auto]">
                    <div className="relative">
                      <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                      <Input
                        className="pl-9"
                        placeholder="Search by name, email, or team"
                        value={userSearch}
                        onChange={(event) => setUserSearch(event.target.value)}
                      />
                    </div>
                    <Select
                      value={statusFilter}
                      onValueChange={(value) => setStatusFilter(value as "all" | UserStatus)}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Status" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Statuses</SelectItem>
                        {USER_STATUSES.map((status) => (
                          <SelectItem key={status} value={status}>
                            {status}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Select
                      value={roleFilter}
                      onValueChange={(value) => setRoleFilter(value as "all" | Role)}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Role" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Roles</SelectItem>
                        {ROLES.map((role) => (
                          <SelectItem key={role} value={role}>
                            {role}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Select
                      value={departmentFilter}
                      onValueChange={(value) => setDepartmentFilter(value as "all" | string)}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Department" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Departments</SelectItem>
                        {departments.map((department) => (
                          <SelectItem key={department} value={department}>
                            {department}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button size="sm" className="gap-1.5" onClick={openAddUser}>
                      <UserPlus className="h-4 w-4" /> Add User
                    </Button>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border/70 bg-muted/30 px-3 py-2">
                    <div className="text-xs text-muted-foreground">
                      {selectedVisibleIds.length} selected of {filteredUsers.length} visible users
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Button variant="outline" size="sm" className="h-8 gap-1.5">
                        <Mail className="h-3.5 w-3.5" /> Resend Invite
                      </Button>
                      <Button variant="outline" size="sm" className="h-8 gap-1.5">
                        <PauseCircle className="h-3.5 w-3.5" /> Suspend
                      </Button>
                      <Button variant="outline" size="sm" className="h-8 gap-1.5">
                        <UserX className="h-3.5 w-3.5" /> Deactivate
                      </Button>
                    </div>
                  </div>

                  <div className="overflow-x-auto rounded-md border border-border/70">
                    <Table>
                      <TableHeader>
                        <TableRow className="border-border/70">
                          <TableHead className="w-10">
                            <Checkbox
                              checked={allVisibleSelected}
                              onCheckedChange={(checked) =>
                                toggleVisibleSelection(Boolean(checked))
                              }
                            />
                          </TableHead>
                          <TableHead>Name</TableHead>
                          <TableHead>Email</TableHead>
                          <TableHead>Phone</TableHead>
                          <TableHead>Role</TableHead>
                          <TableHead>Department</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>Assigned Team</TableHead>
                          <TableHead>Last Login</TableHead>
                          <TableHead>Invite Status</TableHead>
                          <TableHead>2FA Status</TableHead>
                          <TableHead>Created Date</TableHead>
                          <TableHead className="text-right">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredUsers.length === 0 ? (
                          <TableRow>
                            <TableCell
                              colSpan={13}
                              className="py-10 text-center text-sm text-muted-foreground"
                            >
                              No users match your filters.
                            </TableCell>
                          </TableRow>
                        ) : (
                          filteredUsers.map((user) => (
                            <TableRow key={user.id} className="border-border/60">
                              <TableCell>
                                <Checkbox
                                  checked={Boolean(selectedIds[user.id])}
                                  onCheckedChange={(checked) =>
                                    toggleSingleSelection(user.id, Boolean(checked))
                                  }
                                />
                              </TableCell>
                              <TableCell className="font-medium">{user.name}</TableCell>
                              <TableCell>{user.email}</TableCell>
                              <TableCell>{user.phone}</TableCell>
                              <TableCell>{user.role}</TableCell>
                              <TableCell>{user.department}</TableCell>
                              <TableCell>
                                <Badge variant="outline" className={statusTone(user.status)}>
                                  {user.status}
                                </Badge>
                              </TableCell>
                              <TableCell>{user.team}</TableCell>
                              <TableCell>{user.lastLogin}</TableCell>
                              <TableCell>
                                <Badge variant="outline" className={inviteTone(user.inviteStatus)}>
                                  {user.inviteStatus}
                                </Badge>
                              </TableCell>
                              <TableCell>{user.twoFAStatus}</TableCell>
                              <TableCell>{user.createdDate}</TableCell>
                              <TableCell className="text-right">
                                <DropdownMenu>
                                  <DropdownMenuTrigger asChild>
                                    <Button variant="ghost" size="icon" className="h-8 w-8">
                                      <MoreHorizontal className="h-4 w-4" />
                                    </Button>
                                  </DropdownMenuTrigger>
                                  <DropdownMenuContent align="end">
                                    <DropdownMenuLabel>User Actions</DropdownMenuLabel>
                                    <DropdownMenuItem>
                                      <Edit3 className="h-4 w-4" /> Edit User
                                    </DropdownMenuItem>
                                    <DropdownMenuItem>
                                      <Shield className="h-4 w-4" /> Assign Permissions
                                    </DropdownMenuItem>
                                    <DropdownMenuItem>
                                      <RefreshCw className="h-4 w-4" /> Reset Password
                                    </DropdownMenuItem>
                                    <DropdownMenuItem>
                                      <Mail className="h-4 w-4" /> Resend Invite
                                    </DropdownMenuItem>
                                    <DropdownMenuItem>
                                      <Eye className="h-4 w-4" /> View Activity
                                    </DropdownMenuItem>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem>
                                      <PauseCircle className="h-4 w-4" /> Suspend User
                                    </DropdownMenuItem>
                                    <DropdownMenuItem>
                                      <UserX className="h-4 w-4" /> Deactivate User
                                    </DropdownMenuItem>
                                    <DropdownMenuItem className="text-destructive">
                                      <Trash2 className="h-4 w-4" /> Delete User
                                    </DropdownMenuItem>
                                  </DropdownMenuContent>
                                </DropdownMenu>
                              </TableCell>
                            </TableRow>
                          ))
                        )}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>

              <div className="grid gap-4 xl:grid-cols-2">
                <Card className="border-border/70 shadow-sm">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">Invitation Tracking</CardTitle>
                    <CardDescription>
                      Send, resend, copy link, and expiration controls
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {inviteRows.length === 0 ? (
                      <p className="text-sm text-muted-foreground">No pending invitations.</p>
                    ) : (
                      inviteRows.map((row) => (
                        <div
                          key={row.id}
                          className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border/70 p-3"
                        >
                          <div>
                            <div className="text-sm font-medium">{row.name}</div>
                            <div className="text-xs text-muted-foreground">{row.email}</div>
                          </div>
                          <div className="flex items-center gap-2">
                            <Badge variant="outline" className={inviteTone(row.status)}>
                              {row.status}
                            </Badge>
                            <span className="text-xs text-muted-foreground">{row.expires}</span>
                            <Button variant="outline" size="sm" className="h-8 gap-1.5">
                              <Send className="h-3.5 w-3.5" /> Resend
                            </Button>
                          </div>
                        </div>
                      ))
                    )}
                  </CardContent>
                </Card>

                <Card className="border-border/70 shadow-sm">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">Admin Notifications</CardTitle>
                    <CardDescription>Security, role, and invite signal feed</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {SECURITY_EVENTS.map((event) => (
                      <div
                        key={event.label}
                        className="flex items-start gap-3 rounded-md border border-border/70 p-3"
                      >
                        <BellRing
                          className={cn(
                            "mt-0.5 h-4 w-4",
                            event.severity === "destructive"
                              ? "text-destructive"
                              : event.severity === "warning"
                                ? "text-warning-foreground"
                                : "text-info",
                          )}
                        />
                        <div>
                          <p className="text-sm font-medium">{event.label}</p>
                          <p className="text-xs text-muted-foreground">{event.when}</p>
                        </div>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              </div>
            </>
          )}

          {activeSection === "roles" && (
            <Card className="border-border/70 shadow-sm">
              <CardHeader>
                <CardTitle>Role Templates & Permission Matrix</CardTitle>
                <CardDescription>
                  Build reusable RBAC templates with module and field-level controls.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-4 md:grid-cols-2">
                  {PERMISSION_TEMPLATES.map((template) => (
                    <div key={template} className="rounded-md border border-border/70 p-4">
                      <div className="text-sm font-semibold">{template}</div>
                      <div className="mt-2 text-xs text-muted-foreground">
                        Modules: {ROLE_TEMPLATE_SUMMARY[template].modules}
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        Data Scope: {ROLE_TEMPLATE_SUMMARY[template].dataScope}
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        Field Rule: {ROLE_TEMPLATE_SUMMARY[template].fieldRules}
                      </div>
                    </div>
                  ))}
                </div>
                <Separator />
                <div className="rounded-md border border-border/70 p-4">
                  <h3 className="text-sm font-semibold">Permission Matrix Preview</h3>
                  <p className="mb-3 mt-1 text-xs text-muted-foreground">
                    Configure No Access, View, Create, Edit, Delete, Approve, Export, and Full
                    Access by module.
                  </p>
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Module</TableHead>
                          {PERMISSION_LEVELS.map((level) => (
                            <TableHead key={level}>{level}</TableHead>
                          ))}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {MODULES.map((moduleName) => (
                          <TableRow key={moduleName}>
                            <TableCell className="font-medium">{moduleName}</TableCell>
                            {PERMISSION_LEVELS.map((level) => (
                              <TableCell key={level}>
                                <Checkbox
                                  checked={level === "View Only" || level === "Create"}
                                  disabled
                                />
                              </TableCell>
                            ))}
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {(activeSection === "teams" ||
            activeSection === "departments" ||
            activeSection === "branches") && (
            <div className="grid gap-4 xl:grid-cols-2">
              <Card className="border-border/70 shadow-sm">
                <CardHeader>
                  <CardTitle>Team & Department Management</CardTitle>
                  <CardDescription>
                    Create teams, assign managers, and map users to departments and branches.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {[
                    {
                      team: "Dispatch Team",
                      manager: "Mason Hall",
                      members: "18",
                      branch: "Dallas HQ",
                    },
                    {
                      team: "Sales Team",
                      manager: "Rafael Gomez",
                      members: "11",
                      branch: "Chicago",
                    },
                    {
                      team: "Accounting Team",
                      manager: "Priya Shah",
                      members: "6",
                      branch: "Dallas HQ",
                    },
                    {
                      team: "Carrier Compliance Team",
                      manager: "Nina Brooks",
                      members: "9",
                      branch: "Phoenix",
                    },
                  ].map((item) => (
                    <div key={item.team} className="rounded-md border border-border/70 p-3">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium">{item.team}</span>
                        <Badge variant="outline">{item.members} users</Badge>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">Manager: {item.manager}</p>
                      <p className="text-xs text-muted-foreground">Branch: {item.branch}</p>
                    </div>
                  ))}
                </CardContent>
              </Card>
              <Card className="border-border/70 shadow-sm">
                <CardHeader>
                  <CardTitle>Branch Permissions</CardTitle>
                  <CardDescription>
                    Branch-level data scope and default assignment controls.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {[
                    { branch: "Dallas HQ", users: 34, restricted: "No" },
                    { branch: "Chicago", users: 17, restricted: "Finance data only" },
                    { branch: "Phoenix", users: 12, restricted: "Carrier ops segmented" },
                  ].map((branch) => (
                    <div key={branch.branch} className="rounded-md border border-border/70 p-3">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium">{branch.branch}</span>
                        <span className="text-xs text-muted-foreground">{branch.users} users</span>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Restriction: {branch.restricted}
                      </p>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </div>
          )}

          {activeSection === "security" && (
            <div className="grid gap-4 xl:grid-cols-2">
              <Card className="border-border/70 shadow-sm">
                <CardHeader>
                  <CardTitle>Authentication Controls</CardTitle>
                  <CardDescription>
                    2FA, SSO, session, trusted devices, and login restrictions.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <ToggleRow
                    label="Require Two-Factor Authentication"
                    description="Enforce 2FA on all non-portal users"
                    defaultChecked
                  />
                  <ToggleRow
                    label="Single Sign-On (Google)"
                    description="Allow login with Google Workspace"
                    defaultChecked
                  />
                  <ToggleRow
                    label="Single Sign-On (Microsoft)"
                    description="Allow login with Microsoft Entra ID"
                  />
                  <ToggleRow
                    label="Trusted Devices"
                    description="Challenge unknown devices before session creation"
                    defaultChecked
                  />
                  <ToggleRow
                    label="IP Restrictions"
                    description="Only allow office and approved VPN IP ranges"
                  />
                </CardContent>
              </Card>

              <Card className="border-border/70 shadow-sm">
                <CardHeader>
                  <CardTitle>Password Policy</CardTitle>
                  <CardDescription>
                    Company-wide credential policy and temporary password lifecycle.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <PolicyLine label="Minimum password length" value="12" />
                  <PolicyLine
                    label="Require uppercase, lowercase, number, symbol"
                    value="Enabled"
                  />
                  <PolicyLine label="Password expiration" value="90 days" />
                  <PolicyLine label="Prevent password reuse" value="Last 8 passwords" />
                  <PolicyLine label="Temporary password expiration" value="24 hours" />
                  <PolicyLine label="Login attempt limit" value="5 attempts" />
                </CardContent>
              </Card>

              <Card className="xl:col-span-2 border-border/70 shadow-sm">
                <CardHeader>
                  <CardTitle>Login Activity</CardTitle>
                  <CardDescription>
                    Last login, failed attempts, session state, and device telemetry.
                  </CardDescription>
                </CardHeader>
                <CardContent className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>User</TableHead>
                        <TableHead>Last Login</TableHead>
                        <TableHead>Failed Attempts</TableHead>
                        <TableHead>Device</TableHead>
                        <TableHead>Browser</TableHead>
                        <TableHead>IP Address</TableHead>
                        <TableHead>Location</TableHead>
                        <TableHead>Session Status</TableHead>
                        <TableHead className="text-right">Action</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {[
                        [
                          "Ava Morgan",
                          "Today, 9:14 AM",
                          "0",
                          "MacBook Pro",
                          "Chrome",
                          "73.44.211.12",
                          "Dallas, TX",
                          "Active",
                        ],
                        [
                          "Mason Hall",
                          "Today, 8:40 AM",
                          "1",
                          "Surface Laptop",
                          "Edge",
                          "205.188.10.4",
                          "Dallas, TX",
                          "Active",
                        ],
                        [
                          "Nina Brooks",
                          "May 06, 2026",
                          "5",
                          "iPhone 15",
                          "Safari",
                          "96.19.33.92",
                          "Phoenix, AZ",
                          "Locked",
                        ],
                      ].map((row) => (
                        <TableRow key={row[0]}>
                          <TableCell className="font-medium">{row[0]}</TableCell>
                          <TableCell>{row[1]}</TableCell>
                          <TableCell>{row[2]}</TableCell>
                          <TableCell>{row[3]}</TableCell>
                          <TableCell>{row[4]}</TableCell>
                          <TableCell>{row[5]}</TableCell>
                          <TableCell>{row[6]}</TableCell>
                          <TableCell>{row[7]}</TableCell>
                          <TableCell className="text-right">
                            <Button size="sm" variant="outline" className="h-8">
                              Logout All Devices
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </div>
          )}

          {activeSection === "audit" && (
            <Card className="border-border/70 shadow-sm">
              <CardHeader>
                <CardTitle>Admin Audit Logs</CardTitle>
                <CardDescription>
                  Track user lifecycle, permission changes, sensitive edits, and override
                  operations.
                </CardDescription>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date / Time</TableHead>
                      <TableHead>User</TableHead>
                      <TableHead>Action</TableHead>
                      <TableHead>Module</TableHead>
                      <TableHead>Record</TableHead>
                      <TableHead>IP Address</TableHead>
                      <TableHead>Device</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Details</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {AUDIT_LOGS.map((row) => (
                      <TableRow key={`${row.when}-${row.action}-${row.record}`}>
                        <TableCell className="whitespace-nowrap">{row.when}</TableCell>
                        <TableCell>{row.user}</TableCell>
                        <TableCell>{row.action}</TableCell>
                        <TableCell>{row.module}</TableCell>
                        <TableCell>{row.record}</TableCell>
                        <TableCell>{row.ip}</TableCell>
                        <TableCell>{row.device}</TableCell>
                        <TableCell>
                          <Badge
                            variant="outline"
                            className={
                              row.status === "Success"
                                ? "bg-success/15 text-success border-success/25"
                                : row.status === "Blocked"
                                  ? "bg-destructive/15 text-destructive border-destructive/25"
                                  : "bg-warning/20 text-warning-foreground border-warning/25"
                            }
                          >
                            {row.status}
                          </Badge>
                        </TableCell>
                        <TableCell>{row.details}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}

          {activeSection === "invitations" && (
            <Card className="border-border/70 shadow-sm">
              <CardHeader>
                <CardTitle>Invitation Center</CardTitle>
                <CardDescription>
                  Send invite email, resend invite, copy invite link, set expiration, and cancel
                  invite.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {[
                  {
                    user: "Rafael Gomez",
                    status: "Opened",
                    expires: "In 3 days",
                    role: "Sales Representative",
                  },
                  {
                    user: "Jordan Lee",
                    status: "Expired",
                    expires: "Expired",
                    role: "Customer / Shipper User",
                  },
                  { user: "Aria Cole", status: "Sent", expires: "In 6 days", role: "Carrier User" },
                ].map((invite) => (
                  <div key={invite.user} className="rounded-md border border-border/70 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="text-sm font-medium">{invite.user}</p>
                        <p className="text-xs text-muted-foreground">{invite.role}</p>
                      </div>
                      <Badge
                        variant="outline"
                        className={inviteTone(invite.status as InviteStatus)}
                      >
                        {invite.status}
                      </Badge>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <span>Expires: {invite.expires}</span>
                      <Button variant="outline" size="sm" className="h-7">
                        Resend
                      </Button>
                      <Button variant="outline" size="sm" className="h-7">
                        Copy Link
                      </Button>
                      <Button variant="outline" size="sm" className="h-7">
                        Cancel Invite
                      </Button>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {(activeSection === "company" ||
            activeSection === "integrations" ||
            activeSection === "billing" ||
            activeSection === "system") && (
            <Card className="border-border/70 shadow-sm">
              <CardHeader>
                <CardTitle>Company Admin Settings</CardTitle>
                <CardDescription>
                  Company profile, operating regions, brand, templates, integrations, billing, and
                  system controls.
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4 md:grid-cols-2">
                <SettingBlock label="Company Profile" value="Titan Freight Dash LLC" />
                <SettingBlock label="MC / DOT" value="MC 1029374 / DOT 3048819" />
                <SettingBlock label="EIN / Tax ID" value="12-3456789" />
                <SettingBlock label="Operating Regions" value="US + Canada" />
                <SettingBlock label="Default Currency" value="USD" />
                <SettingBlock label="Default Time Zone" value="America/Chicago" />
                <SettingBlock label="Measurement Units" value="Imperial" />
                <SettingBlock label="Brand Colors" value="Navy, Slate, Cyan" />
                <SettingBlock label="Email Templates" value="Invite, Password Reset, Alert" />
                <SettingBlock
                  label="Notification Templates"
                  value="Role changed, Suspicious login"
                />
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      <Dialog open={addUserOpen} onOpenChange={setAddUserOpen}>
        <DialogContent className="max-h-[90vh] max-w-[1200px] overflow-y-auto p-0">
          <DialogHeader className="border-b border-border px-6 py-4">
            <DialogTitle className="text-xl">Add New User</DialogTitle>
            <DialogDescription>
              Multi-step onboarding for identity, role, module permissions, data scope, and invite
              security.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5 px-6 py-5">
            <div className="grid gap-2 md:grid-cols-6">
              {ADD_USER_STEPS.map((step, index) => (
                <div
                  key={step}
                  className={cn(
                    "rounded-md border px-3 py-2 text-xs",
                    index === wizardStep
                      ? "border-primary bg-primary/10 text-primary"
                      : index < wizardStep
                        ? "border-success/35 bg-success/10 text-success"
                        : "border-border/70 text-muted-foreground",
                  )}
                >
                  <div className="font-semibold">Step {index + 1}</div>
                  <div>{step}</div>
                </div>
              ))}
            </div>

            {wizardStep === 0 && (
              <div className="space-y-4">
                <SectionTitle
                  title="Basic Information"
                  description="First name, last name, profile details, branch, locale, and contact details."
                />
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  <Field label="First Name" required>
                    <Input
                      value={draft.firstName}
                      onChange={(e) => updateDraft("firstName", e.target.value)}
                    />
                  </Field>
                  <Field label="Last Name" required>
                    <Input
                      value={draft.lastName}
                      onChange={(e) => updateDraft("lastName", e.target.value)}
                    />
                  </Field>
                  <Field label="Display Name">
                    <Input
                      value={draft.displayName}
                      onChange={(e) => updateDraft("displayName", e.target.value)}
                    />
                  </Field>
                  <Field label="Email Address" required>
                    <Input
                      type="email"
                      value={draft.email}
                      onChange={(e) => updateDraft("email", e.target.value)}
                      placeholder="name@company.com"
                    />
                  </Field>
                  <Field label="Phone Number">
                    <Input
                      value={draft.phone}
                      onChange={(e) => updateDraft("phone", e.target.value)}
                    />
                  </Field>
                  <Field label="Profile Photo URL">
                    <Input
                      value={draft.profilePhoto}
                      onChange={(e) => updateDraft("profilePhoto", e.target.value)}
                      placeholder="https://..."
                    />
                  </Field>
                  <Field label="Job Title">
                    <Input
                      value={draft.jobTitle}
                      onChange={(e) => updateDraft("jobTitle", e.target.value)}
                    />
                  </Field>
                  <Field label="Department">
                    <Input
                      value={draft.department}
                      onChange={(e) => updateDraft("department", e.target.value)}
                    />
                  </Field>
                  <Field label="Office / Branch">
                    <Input
                      value={draft.officeBranch}
                      onChange={(e) => updateDraft("officeBranch", e.target.value)}
                    />
                  </Field>
                  <Field label="Time Zone">
                    <Input
                      value={draft.timeZone}
                      onChange={(e) => updateDraft("timeZone", e.target.value)}
                    />
                  </Field>
                  <Field label="Language">
                    <Input
                      value={draft.language}
                      onChange={(e) => updateDraft("language", e.target.value)}
                    />
                  </Field>
                  <Field label="Username">
                    <Input
                      value={draft.username}
                      onChange={(e) => updateDraft("username", e.target.value)}
                    />
                  </Field>
                </div>
              </div>
            )}

            {wizardStep === 1 && (
              <div className="space-y-4">
                <SectionTitle
                  title="Role & Department"
                  description="Assign role, template, reporting manager, team ownership, and branch."
                />
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  <Field label="User Role" required>
                    <Select
                      value={draft.role}
                      onValueChange={(value) => updateDraft("role", value as Role)}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select role" />
                      </SelectTrigger>
                      <SelectContent>
                        {ROLES.map((role) => (
                          <SelectItem key={role} value={role}>
                            {role}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field label="Permission Template" required>
                    <Select
                      value={draft.permissionTemplate}
                      onValueChange={(value) =>
                        setDraft((prev) => applyTemplateToDraft(value as PermissionTemplate, prev))
                      }
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select template" />
                      </SelectTrigger>
                      <SelectContent>
                        {PERMISSION_TEMPLATES.map((template) => (
                          <SelectItem key={template} value={template}>
                            {template}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field label="Access Level">
                    <Select
                      value={draft.accessLevel}
                      onValueChange={(value) =>
                        updateDraft("accessLevel", value as AddUserDraft["accessLevel"])
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Standard">Standard</SelectItem>
                        <SelectItem value="Elevated">Elevated</SelectItem>
                        <SelectItem value="Restricted">Restricted</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field label="Manager / Reports To">
                    <Input
                      value={draft.manager}
                      onChange={(e) => updateDraft("manager", e.target.value)}
                    />
                  </Field>
                  <Field label="Assigned Team">
                    <Input
                      value={draft.assignedTeam}
                      onChange={(e) => updateDraft("assignedTeam", e.target.value)}
                    />
                  </Field>
                  <Field label="Assigned Branch">
                    <Input
                      value={draft.assignedBranch}
                      onChange={(e) => updateDraft("assignedBranch", e.target.value)}
                    />
                  </Field>
                </div>

                <Card className="border-border/70 bg-muted/20">
                  <CardContent className="p-4 text-xs text-muted-foreground">
                    <div className="font-semibold text-foreground">Template Summary</div>
                    <p className="mt-1">
                      Modules: {ROLE_TEMPLATE_SUMMARY[draft.permissionTemplate].modules}
                    </p>
                    <p>Data Scope: {ROLE_TEMPLATE_SUMMARY[draft.permissionTemplate].dataScope}</p>
                    <p>Field Rule: {ROLE_TEMPLATE_SUMMARY[draft.permissionTemplate].fieldRules}</p>
                  </CardContent>
                </Card>
              </div>
            )}

            {wizardStep === 2 && (
              <div className="space-y-4">
                <SectionTitle
                  title="Module Access"
                  description="Set module-level permission matrix plus field-level sensitivity permissions."
                />
                <div className="overflow-x-auto rounded-md border border-border/70">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="min-w-[180px]">Module</TableHead>
                        {PERMISSION_LEVELS.map((level) => (
                          <TableHead key={level} className="min-w-[100px]">
                            {level}
                          </TableHead>
                        ))}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {MODULES.map((moduleName) => (
                        <TableRow key={moduleName}>
                          <TableCell className="font-medium">{moduleName}</TableCell>
                          {PERMISSION_LEVELS.map((level) => (
                            <TableCell key={level}>
                              <Checkbox
                                checked={draft.modulePermissions[moduleName][level]}
                                onCheckedChange={(checked) =>
                                  toggleModulePermission(moduleName, level, Boolean(checked))
                                }
                              />
                            </TableCell>
                          ))}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>

                <Card className="border-border/70">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">Field-Level Permissions</CardTitle>
                    <CardDescription>
                      Control access to sensitive rates, margins, payments, and risk data.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="grid gap-2 md:grid-cols-2">
                    {FIELD_PERMISSIONS.map((permission) => (
                      <label
                        key={permission}
                        className="flex items-center gap-2 rounded-md border border-border/70 px-3 py-2 text-sm"
                      >
                        <Checkbox
                          checked={draft.fieldPermissions[permission]}
                          onCheckedChange={(checked) =>
                            toggleFieldPermission(permission, Boolean(checked))
                          }
                        />
                        <span>{permission}</span>
                      </label>
                    ))}
                  </CardContent>
                </Card>
              </div>
            )}

            {wizardStep === 3 && (
              <div className="space-y-4">
                <SectionTitle
                  title="Data Access Scope"
                  description="Define whether this user can access all company data or only assigned records."
                />
                <div className="grid gap-3 md:grid-cols-2">
                  {ACCESS_SCOPES.map((scope) => (
                    <button
                      key={scope}
                      type="button"
                      onClick={() => updateDraft("dataAccessScope", scope)}
                      className={cn(
                        "rounded-md border p-3 text-left",
                        draft.dataAccessScope === scope
                          ? "border-primary bg-primary/10"
                          : "border-border/70 hover:bg-muted/30",
                      )}
                    >
                      <div className="text-sm font-medium">{scope}</div>
                      <div className="text-xs text-muted-foreground">
                        {scope === "All Company Data"
                          ? "Full operational and financial visibility."
                          : scope === "Assigned Team Only"
                            ? "Limited to team-owned loads and tasks."
                            : "Scoped visibility to assigned records only."}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {wizardStep === 4 && (
              <div className="space-y-4">
                <SectionTitle
                  title="Security & Invite Settings"
                  description="Passwords, access windows, 2FA, SSO options, and invite controls."
                />
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  <Field label="Temporary Password">
                    <Input
                      type="password"
                      value={draft.temporaryPassword}
                      onChange={(e) => updateDraft("temporaryPassword", e.target.value)}
                    />
                  </Field>
                  <Field label="Account Status">
                    <Select
                      value={draft.accountStatus}
                      onValueChange={(value) => updateDraft("accountStatus", value as UserStatus)}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Active">Active</SelectItem>
                        <SelectItem value="Pending Invite">Pending Invite</SelectItem>
                        <SelectItem value="Inactive">Inactive</SelectItem>
                        <SelectItem value="Suspended">Suspended</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field label="Invite Expiration (days)">
                    <Input
                      value={draft.inviteExpirationDays}
                      onChange={(e) => updateDraft("inviteExpirationDays", e.target.value)}
                    />
                  </Field>
                  <Field label="Login Access Start Date">
                    <Input
                      type="date"
                      value={draft.loginAccessStartDate}
                      onChange={(e) => updateDraft("loginAccessStartDate", e.target.value)}
                    />
                  </Field>
                  <Field label="Login Access Expiration Date">
                    <Input
                      type="date"
                      value={draft.loginAccessExpirationDate}
                      onChange={(e) => updateDraft("loginAccessExpirationDate", e.target.value)}
                    />
                  </Field>
                  <Field label="Session Timeout (mins)">
                    <Input
                      value={draft.sessionTimeoutMins}
                      onChange={(e) => updateDraft("sessionTimeoutMins", e.target.value)}
                    />
                  </Field>
                  <Field label="Login Attempt Limit">
                    <Input
                      value={draft.loginAttemptLimit}
                      onChange={(e) => updateDraft("loginAttemptLimit", e.target.value)}
                    />
                  </Field>
                  <Field label="IP Restrictions">
                    <Input
                      placeholder="10.30.0.0/16, 73.44.211.0/24"
                      value={draft.ipRestrictions}
                      onChange={(e) => updateDraft("ipRestrictions", e.target.value)}
                    />
                  </Field>
                </div>

                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  <SwitchField
                    label="Send Email Invite"
                    checked={draft.sendEmailInvite}
                    onCheckedChange={(checked) => updateDraft("sendEmailInvite", checked)}
                  />
                  <SwitchField
                    label="Require Password Reset on First Login"
                    checked={draft.requirePasswordReset}
                    onCheckedChange={(checked) => updateDraft("requirePasswordReset", checked)}
                  />
                  <SwitchField
                    label="Require Two-Factor Authentication"
                    checked={draft.requireTwoFactor}
                    onCheckedChange={(checked) => updateDraft("requireTwoFactor", checked)}
                  />
                  <SwitchField
                    label="Enforce Session Timeout"
                    checked={draft.enforceSessionTimeout}
                    onCheckedChange={(checked) => updateDraft("enforceSessionTimeout", checked)}
                  />
                  <SwitchField
                    label="Trusted Devices Only"
                    checked={draft.trustedDevicesOnly}
                    onCheckedChange={(checked) => updateDraft("trustedDevicesOnly", checked)}
                  />
                  <SwitchField
                    label="Require Profile Completion"
                    checked={draft.requireProfileCompletion}
                    onCheckedChange={(checked) => updateDraft("requireProfileCompletion", checked)}
                  />
                  <SwitchField
                    label="Enable Google Login"
                    checked={draft.enableSsoGoogle}
                    onCheckedChange={(checked) => updateDraft("enableSsoGoogle", checked)}
                  />
                  <SwitchField
                    label="Enable Microsoft Login"
                    checked={draft.enableSsoMicrosoft}
                    onCheckedChange={(checked) => updateDraft("enableSsoMicrosoft", checked)}
                  />
                </div>

                <Field label="Custom Welcome Message">
                  <Textarea
                    rows={3}
                    value={draft.customWelcomeMessage}
                    onChange={(e) => updateDraft("customWelcomeMessage", e.target.value)}
                  />
                </Field>
              </div>
            )}

            {wizardStep === 5 && (
              <div className="space-y-4">
                <SectionTitle
                  title="Review & Send Invite"
                  description="Confirm final user settings before creating account and sending invite."
                />

                <div className="grid gap-4 lg:grid-cols-2">
                  <Card className="border-border/70">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-base">User Summary</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2 text-sm">
                      <SummaryRow
                        label="User Name"
                        value={`${draft.firstName} ${draft.lastName}`.trim() || "-"}
                      />
                      <SummaryRow label="Email" value={draft.email || "-"} />
                      <SummaryRow label="Role" value={draft.role} />
                      <SummaryRow label="Department" value={draft.department || "-"} />
                      <SummaryRow label="Assigned Team" value={draft.assignedTeam || "-"} />
                      <SummaryRow label="Assigned Branch" value={draft.assignedBranch || "-"} />
                      <SummaryRow label="Data Access Scope" value={draft.dataAccessScope} />
                      <SummaryRow
                        label="Security Requirements"
                        value={
                          draft.requireTwoFactor
                            ? "2FA required, password reset on first login"
                            : "Standard login requirements"
                        }
                      />
                    </CardContent>
                  </Card>

                  <Card className="border-border/70">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-base">Modules & Restrictions</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2 text-sm">
                      <SummaryRow
                        label="Modules Allowed"
                        value={
                          MODULES.filter((moduleName) => {
                            const selected = selectedPermissionsForModule(
                              draft.modulePermissions[moduleName],
                            );
                            return selected.some((value) => value !== "No Access");
                          }).join(", ") || "None"
                        }
                      />
                      <SummaryRow
                        label="Restricted Modules"
                        value={
                          MODULES.filter(
                            (moduleName) => draft.modulePermissions[moduleName]["No Access"],
                          ).join(", ") || "None"
                        }
                      />
                      <SummaryRow
                        label="Invite Email Preview"
                        value={`Hello ${draft.firstName || "there"}, welcome to Titan Freight. You have been assigned ${draft.role}.`}
                      />
                    </CardContent>
                  </Card>
                </div>

                <Card className="border-border/70 bg-muted/20">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">Invite Email Preview</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2 text-sm">
                    <p>Subject: You are invited to Logistics Software - {draft.role}</p>
                    <p className="text-muted-foreground">
                      {draft.customWelcomeMessage ||
                        "Welcome to Titan Freight. Please activate your account and complete your profile."}
                    </p>
                    <p className="text-muted-foreground">
                      Invitation expires in {draft.inviteExpirationDays || "7"} days.
                    </p>
                  </CardContent>
                </Card>
              </div>
            )}
          </div>

          <DialogFooter className="border-t border-border px-6 py-4 sm:justify-between">
            <div className="text-xs text-muted-foreground">Saved drafts: {savedDraftCount}</div>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" onClick={() => setAddUserOpen(false)}>
                Cancel
              </Button>
              <Button variant="outline" onClick={saveDraft}>
                Save Draft
              </Button>
              {wizardStep > 0 && (
                <Button
                  variant="outline"
                  onClick={() => setWizardStep((prev) => Math.max(0, prev - 1))}
                >
                  Back
                </Button>
              )}
              {wizardStep < ADD_USER_STEPS.length - 1 ? (
                <Button
                  onClick={() =>
                    setWizardStep((prev) => Math.min(ADD_USER_STEPS.length - 1, prev + 1))
                  }
                  disabled={!stepCanContinue}
                >
                  Continue
                </Button>
              ) : (
                <>
                  <Button variant="outline" onClick={() => createUser(false)}>
                    Create User
                  </Button>
                  <Button onClick={() => createUser(true)}>Create & Send Invite</Button>
                </>
              )}
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function MetricCard({
  label,
  value,
  hint,
  tone = "default",
}: {
  label: string;
  value: string;
  hint: string;
  tone?: "default" | "success" | "warning" | "info";
}) {
  return (
    <Card className="border-border/70 shadow-sm">
      <CardContent className="p-4">
        <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </div>
        <div className="mt-2 flex items-end justify-between gap-2">
          <div className="text-2xl font-semibold tracking-tight">{value}</div>
          <Badge
            variant="secondary"
            className={
              tone === "success"
                ? "bg-success/15 text-success"
                : tone === "warning"
                  ? "bg-warning/20 text-warning-foreground"
                  : tone === "info"
                    ? "bg-info/15 text-info"
                    : "bg-muted text-foreground"
            }
          >
            Live
          </Badge>
        </div>
        <div className="mt-1 text-xs text-muted-foreground">{hint}</div>
      </CardContent>
    </Card>
  );
}

function Field({
  label,
  required = false,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="space-y-1">
      <span className="text-xs font-medium text-muted-foreground">
        {label}
        {required ? " *" : ""}
      </span>
      {children}
    </label>
  );
}

function SectionTitle({ title, description }: { title: string; description: string }) {
  return (
    <div>
      <h3 className="text-base font-semibold">{title}</h3>
      <p className="text-sm text-muted-foreground">{description}</p>
    </div>
  );
}

function SwitchField({
  label,
  checked,
  onCheckedChange,
}: {
  label: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-between rounded-md border border-border/70 px-3 py-2 text-sm">
      <span>{label}</span>
      <Switch checked={checked} onCheckedChange={onCheckedChange} />
    </label>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span>{value}</span>
    </div>
  );
}

function ToggleRow({
  label,
  description,
  defaultChecked = false,
}: {
  label: string;
  description: string;
  defaultChecked?: boolean;
}) {
  const [checked, setChecked] = React.useState(defaultChecked);
  return (
    <label className="flex items-start justify-between gap-3 rounded-md border border-border/70 p-3">
      <div>
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <Switch checked={checked} onCheckedChange={setChecked} />
    </label>
  );
}

function PolicyLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between rounded-md border border-border/70 px-3 py-2 text-sm">
      <span>{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}

function SettingBlock({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border/70 p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-sm font-medium">{value}</p>
    </div>
  );
}
