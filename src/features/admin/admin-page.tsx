import * as React from "react";
import { Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
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
import { Skeleton } from "@/components/ui/skeleton";
import { StatCardsSkeleton } from "@/components/page-skeleton";
import { usePageReady } from "@/components/page-load-gate";
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
import {
  auditActorFromAuth,
  fetchAdminAuditLogsCached,
  formatAuditWhen,
  recordAdminAuditLog,
  type AdminAuditLogEntry,
} from "@/lib/admin-audit-store";
import { readAdminDirectoryCache } from "@/lib/admin-users-cache";
import {
  cacheAdminDirectoryUser,
  createAdminDirectoryUser,
  listAdminDirectoryUsersCached,
  listKnownCompanies,
  type AdminUserDirectoryEntry,
  type KnownCompany,
} from "@/lib/admin-users-store";
import {
  ensureCompanyContext,
  newCompanyId,
  normalizeCompanyName,
} from "@/lib/tenant/company-context";
import {
  adminResendCognitoInvite,
  adminResetCognitoPassword,
  isCognitoAdminConfigured,
} from "@/lib/cognito-admin";
import { useAuth } from "@/lib/auth";
import { useAppSettings } from "@/hooks/use-app-settings";
import {
  ensureWorkspaceOpsSeeded,
  loadOrgStructure,
  type OrgStructureData,
} from "@/lib/workspace-ops-store";
import { isWorkspaceSettingsConfigured } from "@/lib/dynamodb";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  ACCESS_SCOPES,
  FIELD_PERMISSIONS,
  INVITE_STATUSES,
  MODULES,
  PERMISSION_LEVELS,
  PERMISSION_TEMPLATES,
  ROLES,
  TWO_FA_STATUSES,
  USER_STATUSES,
  buildDefaultFieldPermissions,
  buildDefaultModulePermissions,
  normalizeInviteStatus,
  normalizeRole,
  normalizeStatus,
  normalizeTwoFaStatus,
  type AccessScope,
  type FieldPermission,
  type FieldPermissionMatrix,
  type InviteStatus,
  type ModuleName,
  type ModulePermissionMatrix,
  type PermissionLevel,
  type PermissionTemplate,
  type Role,
  type TwoFAStatus,
  type UserStatus,
} from "@/lib/admin-user-constants";

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
  /**
   * Company the new user is assigned to, by name. The id is resolved at submit
   * — matching an existing company, or minting a new one when the name is new.
   * Deliberately not free-text-into-the-filter: the *name* is a label, the
   * generated `companyId` is what records are keyed by, so renames and typo
   * variants cannot silently split or merge a tenant.
   */
  companyName: string;
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

function buildEmptyDraft(): AddUserDraft {
  return {
    firstName: "",
    lastName: "",
    displayName: "",
    email: "",
    companyName: "",
    phone: "",
    profilePhoto: "",
    jobTitle: "",
    department: "Operations",
    officeBranch: "",
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
    assignedTeam: "",
    assignedBranch: "",
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

function auditSeverity(status: AdminAuditLogEntry["status"]): "destructive" | "warning" | "info" {
  if (status === "Blocked" || status === "Failed") return "destructive";
  if (status === "Reviewed") return "warning";
  return "info";
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
    nextDraft.role = "Sales";
    nextDraft.department = "Sales";
    nextDraft.assignedTeam = "Sales Team";
  }

  if (template === "Dispatcher Template") {
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
    for (const moduleName of [
      "Dashboard",
      "Loads",
      "TruckBoard",
      "Tracking",
      "Carriers / Brokers",
      "Communications",
      "Profile",
    ] as const) {
      nextDraft.modulePermissions[moduleName]["No Access"] = false;
      nextDraft.modulePermissions[moduleName]["View Only"] = true;
      nextDraft.modulePermissions[moduleName].Create = true;
      nextDraft.modulePermissions[moduleName].Edit = true;
    }
    nextDraft.dataAccessScope = "Assigned Team Only";
    nextDraft.role = "Dispatcher";
    nextDraft.department = "Operations";
  }

  if (template === "Driver Template") {
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
    for (const moduleName of ["Loads", "Tracking", "Profile"] as const) {
      nextDraft.modulePermissions[moduleName]["No Access"] = false;
      nextDraft.modulePermissions[moduleName]["View Only"] = true;
    }
    nextDraft.modulePermissions.Loads.Edit = true;
    nextDraft.dataAccessScope = "Own Records Only";
    nextDraft.role = "Driver";
    nextDraft.department = "Operations";
    nextDraft.accessLevel = "Restricted";
  }

  if (template === "Broker Template") {
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
    for (const moduleName of [
      "Dashboard",
      "Loads",
      "Bidding",
      "Quotes",
      "RFPs",
      "Carriers / Brokers",
      "CRM & Sales",
      "Communications",
      "Profile",
    ] as const) {
      nextDraft.modulePermissions[moduleName]["No Access"] = false;
      nextDraft.modulePermissions[moduleName]["View Only"] = true;
      nextDraft.modulePermissions[moduleName].Create = true;
      nextDraft.modulePermissions[moduleName].Edit = true;
    }
    nextDraft.dataAccessScope = "Assigned Customers Only";
    nextDraft.role = "Broker";
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

export function AdminPage() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const isEditUserPath = /^\/admin\/users\/[^/]+$/.test(pathname);
  const navigate = useNavigate();

  const { user: authUser } = useAuth();
  const cacheScope = authUser?.userId ?? "_";

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
  const [knownCompanies, setKnownCompanies] = React.useState<KnownCompany[]>([]);
  const [activeCompany, setActiveCompany] = React.useState<{
    companyId: string;
    companyName: string;
  } | null>(null);
  const [draft, setDraft] = React.useState<AddUserDraft>(buildEmptyDraft());

  React.useEffect(() => {
    void ensureCompanyContext().then(setActiveCompany);
  }, []);
  const [wizardStep, setWizardStep] = React.useState(0);
  const [savedDraftCount, setSavedDraftCount] = React.useState(0);
  const [creatingUser, setCreatingUser] = React.useState(false);
  const [createUserError, setCreateUserError] = React.useState<string | null>(null);
  const [passwordResetBusyId, setPasswordResetBusyId] = React.useState<string | null>(null);
  const [passwordResetResult, setPasswordResetResult] = React.useState<{
    name: string;
    email: string;
    temporaryPassword?: string;
    emailed: boolean;
    method: string;
  } | null>(null);
  const [auditLogs, setAuditLogs] = React.useState<AdminAuditLogEntry[]>([]);
  const [auditLogsLoading, setAuditLogsLoading] = React.useState(true);

  const companyDefaults = React.useMemo(
    () => ({
      company_legal_name: "",
      mc_number: "",
      dot_number: "",
      ein_tax_id: "",
      operating_regions: "",
      default_currency: "USD",
      default_time_zone: "America/Chicago",
      default_distance_unit: "Miles",
      accounting_email: "",
      support_email: "",
      minimum_password_length: "12",
      require_uppercase: true,
      require_lowercase: true,
      require_number: true,
      require_special_character: true,
      password_expiration: "90 days",
      temporary_password_expiration: "24 hours",
      prevent_password_reuse: "Last 8 passwords",
      login_attempt_limit: "5",
    }),
    [],
  );
  const { values: companySettings, loading: companySettingsLoading } =
    useAppSettings(companyDefaults);

  const securityEvents = React.useMemo(
    () =>
      auditLogs.slice(0, 8).map((log) => ({
        id: log.id,
        label: log.details?.trim() || `${log.action} · ${log.record}`,
        when: formatAuditWhen(log.when),
        severity: auditSeverity(log.status),
      })),
    [auditLogs],
  );

  const loginActivityRows = React.useMemo(
    () =>
      [...users]
        .sort((a, b) => {
          if (a.lastLogin === "-" && b.lastLogin !== "-") return 1;
          if (b.lastLogin === "-" && a.lastLogin !== "-") return -1;
          return 0;
        })
        .slice(0, 25)
        .map((user) => ({
          id: user.id,
          name: user.name,
          lastLogin: user.lastLogin,
          sessionStatus:
            user.status === "Locked" || user.status === "Suspended"
              ? user.status
              : user.status === "Active"
                ? "Active"
                : user.status,
        })),
    [users],
  );
  const [orgStructure, setOrgStructure] = React.useState<OrgStructureData | null>(null);

  React.useEffect(() => {
    if (!isWorkspaceSettingsConfigured()) return;
    let cancelled = false;
    void (async () => {
      try {
        await ensureWorkspaceOpsSeeded();
        const org = await loadOrgStructure();
        if (!cancelled) setOrgStructure(org);
      } catch {
        if (!cancelled) setOrgStructure(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const teamsFromDirectory = React.useMemo(() => {
    const byTeam = new Map<string, number>();
    for (const u of users) {
      const key = u.team?.trim() || u.department?.trim() || "Unassigned";
      byTeam.set(key, (byTeam.get(key) ?? 0) + 1);
    }
    return Array.from(byTeam.entries())
      .map(([team, count]) => ({ team, count }))
      .sort((a, b) => b.count - a.count);
  }, [users]);

  usePageReady(Boolean(!isEditUserPath && usersLoading && users.length === 0));

  const loadUsers = React.useCallback(
    async (options?: { force?: boolean }) => {
      if (!authUser?.userId) {
        setUsersLoading(false);
        return;
      }

      const cached = readAdminDirectoryCache(cacheScope);
      const hadCache = Boolean(cached?.users.length);

      if (hadCache && !options?.force) {
        setUsers(cached!.users.map(mapLiveUser));
        if (cached!.warning) setUsersWarning(cached!.warning);
        setUsersLoading(false);
        return;
      }

      if (!hadCache || options?.force) {
        setUsersLoading(true);
      }
      setUsersWarning(null);
      setUsersError(null);

      try {
        const result = await listAdminDirectoryUsersCached(cacheScope, {
          force: options?.force,
        });
        const liveUsers = result.users.map(mapLiveUser);
        setUsers(liveUsers);
        if (result.warning) setUsersWarning(result.warning);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Could not load users";
        if (!hadCache) setUsers([]);
        setUsersError(message);
      } finally {
        setUsersLoading(false);
      }
    },
    [authUser?.userId, cacheScope],
  );

  React.useLayoutEffect(() => {
    if (isEditUserPath || !authUser?.userId) return;
    const cached = readAdminDirectoryCache(authUser.userId);
    if (!cached?.users.length) return;
    setUsers(cached.users.map(mapLiveUser));
    if (cached.warning) setUsersWarning(cached.warning);
    setUsersLoading(false);
  }, [authUser?.userId, isEditUserPath]);

  React.useEffect(() => {
    if (isEditUserPath) return;
    void loadUsers();
  }, [loadUsers, isEditUserPath]);

  const loadAuditLogs = React.useCallback(async (options?: { force?: boolean }) => {
    setAuditLogsLoading(true);
    try {
      const rows = await fetchAdminAuditLogsCached({ force: options?.force });
      setAuditLogs(rows);
    } catch {
      setAuditLogs([]);
    } finally {
      setAuditLogsLoading(false);
    }
  }, []);

  React.useEffect(() => {
    if (isEditUserPath) return;
    void loadAuditLogs();
  }, [loadAuditLogs, isEditUserPath]);

  React.useEffect(() => {
    if (isEditUserPath || activeSection !== "audit") return;
    void loadAuditLogs({ force: true });
  }, [activeSection, isEditUserPath, loadAuditLogs]);

  const logAdminAction = React.useCallback(
    async (input: Omit<Parameters<typeof recordAdminAuditLog>[0], "actor">) => {
      try {
        const entry = await recordAdminAuditLog({
          ...input,
          actor: auditActorFromAuth(authUser),
        });
        setAuditLogs((prev) => [entry, ...prev]);
        return entry;
      } catch {
        return null;
      }
    },
    [authUser],
  );

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
    // Default to the admin's own company — adding a colleague is the common
    // case, and typing the name again is how you get a typo'd second tenant.
    setDraft({ ...buildEmptyDraft(), companyName: activeCompany?.companyName ?? "" });
    setWizardStep(0);
    setCreateUserError(null);
    setAddUserOpen(true);
    void listKnownCompanies()
      .then(setKnownCompanies)
      .catch(() => setKnownCompanies([]));
  };

  const updateUsersStatus = async (userIds: string[], status: UserStatus, action: string) => {
    const targets = users.filter((user) => userIds.includes(user.id));
    if (targets.length === 0) return;

    setUsers((prev) =>
      prev.map((user) => (userIds.includes(user.id) ? { ...user, status } : user)),
    );

    await Promise.all(
      targets.map((user) =>
        logAdminAction({
          action,
          record: user.email,
          details: `${user.name}: ${user.status} → ${status}`,
        }),
      ),
    );
    toast.success(
      targets.length === 1
        ? `${targets[0].name} marked as ${status}.`
        : `${targets.length} users marked as ${status}.`,
    );
  };

  const deleteUsers = async (userIds: string[]) => {
    const targets = users.filter((user) => userIds.includes(user.id));
    if (targets.length === 0) return;

    setUsers((prev) => prev.filter((user) => !userIds.includes(user.id)));
    setSelectedIds((prev) => {
      const next = { ...prev };
      for (const id of userIds) delete next[id];
      return next;
    });

    await Promise.all(
      targets.map((user) =>
        logAdminAction({
          action: "User Deleted",
          record: user.email,
          details: user.name,
          status: "Reviewed",
        }),
      ),
    );
    toast.success(
      targets.length === 1
        ? `${targets[0].name} removed from directory.`
        : `${targets.length} users removed from directory.`,
    );
  };

  const resendUserInvite = async (user: UserRecord) => {
    if (!isCognitoAdminConfigured()) {
      toast.error("Cognito admin is not configured", {
        description: "Set VITE_COGNITO_USER_POOL_ID and VITE_COGNITO_IDENTITY_POOL_ID.",
      });
      return;
    }
    if (!user.email || user.email === "-") {
      toast.error("This user has no email address in Cognito.");
      return;
    }

    setPasswordResetBusyId(user.id);
    try {
      const result = await adminResendCognitoInvite({
        userId: user.id,
        email: user.email,
      });
      setUsers((prev) =>
        prev.map((row) =>
          row.id === user.id
            ? {
                ...row,
                inviteStatus: "Sent" as InviteStatus,
                status: row.status === "Active" ? row.status : ("Pending Invite" as UserStatus),
              }
            : row,
        ),
      );
      setPasswordResetResult({
        name: user.name,
        email: user.email,
        temporaryPassword: result.temporaryPassword,
        emailed: result.emailed,
        method: result.method,
      });
      await logAdminAction({
        action: "Invite Resent",
        record: user.email,
        details: `${user.name} · Cognito ${result.method}`,
      });
      toast.success(`Invite resent for ${user.name}.`, {
        description: result.emailed
          ? `Cognito emailed ${user.email}.`
          : "Share the temporary password with the user.",
      });
    } catch (err) {
      toast.error("Couldn’t resend invite", {
        description: err instanceof Error ? err.message : "Cognito request failed",
      });
    } finally {
      setPasswordResetBusyId(null);
    }
  };

  const requestPasswordReset = async (user: UserRecord) => {
    if (!isCognitoAdminConfigured()) {
      toast.error("Cognito admin is not configured", {
        description: "Set VITE_COGNITO_USER_POOL_ID and VITE_COGNITO_IDENTITY_POOL_ID.",
      });
      return;
    }
    if (!user.email || user.email === "-") {
      toast.error("This user has no email address in Cognito.");
      return;
    }

    setPasswordResetBusyId(user.id);
    try {
      const result = await adminResetCognitoPassword({
        userId: user.id,
        email: user.email,
        sendEmail: true,
      });
      setUsers((prev) =>
        prev.map((row) =>
          row.id === user.id
            ? {
                ...row,
                inviteStatus:
                  result.method === "resend-invite" || result.method === "email-reset-code"
                    ? ("Sent" as InviteStatus)
                    : row.inviteStatus,
                status:
                  result.method === "resend-invite" && row.status !== "Active"
                    ? ("Pending Invite" as UserStatus)
                    : row.status,
              }
            : row,
        ),
      );
      setPasswordResetResult({
        name: user.name,
        email: user.email,
        temporaryPassword: result.temporaryPassword,
        emailed: result.emailed,
        method: result.method,
      });
      await logAdminAction({
        action: "Password Reset Requested",
        record: user.email,
        details: `Admin reset for ${user.name} via Cognito ${result.method}`,
      });
      toast.success(
        result.emailed ? `Reset email sent to ${user.email}` : `Password reset for ${user.name}`,
        {
          description:
            result.method === "email-reset-code"
              ? "They’ll receive a Cognito verification code to set a new password."
              : result.emailed
                ? "They’ll receive a temporary password by email, then must set a permanent one."
                : "Cognito email delivery failed — share the temporary password from the dialog.",
        },
      );
    } catch (err) {
      toast.error("Password reset failed", {
        description: err instanceof Error ? err.message : "Cognito request failed",
      });
    } finally {
      setPasswordResetBusyId(null);
    }
  };

  const logInviteCenterAction = async (
    userLabel: string,
    action: string,
    details: string,
    status?: "Success" | "Reviewed",
  ) => {
    await logAdminAction({
      action,
      module: "Invitations",
      record: userLabel,
      details,
      status,
    });
    toast.success(details);
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

  /** The existing company this name refers to, if any. Case/space insensitive. */
  const matchedCompany = React.useMemo(() => {
    const needle = normalizeCompanyName(draft.companyName);
    if (!needle) return null;
    return knownCompanies.find((c) => normalizeCompanyName(c.companyName) === needle) ?? null;
  }, [draft.companyName, knownCompanies]);

  const stepCanContinue = React.useMemo(() => {
    if (wizardStep === 0)
      return Boolean(draft.firstName && draft.lastName && draft.email && draft.companyName.trim());
    if (wizardStep === 1)
      return Boolean(draft.role && draft.department && draft.permissionTemplate);
    if (wizardStep === 2) return true;
    if (wizardStep === 3) return Boolean(draft.dataAccessScope);
    if (wizardStep === 4) return Boolean(draft.accountStatus);
    return true;
  }, [wizardStep, draft]);

  const createUser = async (sendInviteNow: boolean) => {
    const accountStatus: UserStatus =
      draft.accountStatus === "Pending Invite" || sendInviteNow
        ? "Pending Invite"
        : draft.accountStatus;
    const inviteStatus: InviteStatus = sendInviteNow ? "Sent" : "Not Sent";
    const twoFAStatus: TwoFAStatus = draft.requireTwoFactor ? "Required" : "Optional";

    // Reuse the existing company's id when the name matches one, otherwise mint
    // a new one. The id — never the typed name — is what records are keyed by.
    const companyName = draft.companyName.trim();
    const company = matchedCompany ?? { companyId: newCompanyId(), companyName };

    setCreatingUser(true);
    setCreateUserError(null);

    try {
      const saved = await createAdminDirectoryUser({
        firstName: draft.firstName,
        lastName: draft.lastName,
        displayName: draft.displayName,
        email: draft.email,
        companyId: company.companyId,
        companyName: company.companyName,
        phone: draft.phone,
        jobTitle: draft.jobTitle,
        department: draft.department,
        officeBranch: draft.officeBranch,
        timeZone: draft.timeZone,
        language: draft.language,
        role: draft.role,
        permissionTemplate: draft.permissionTemplate,
        accessLevel: draft.accessLevel,
        assignedTeam: draft.assignedTeam,
        assignedBranch: draft.assignedBranch,
        dataAccessScope: draft.dataAccessScope,
        accountStatus,
        inviteStatus,
        twoFAStatus,
        modulePermissions: draft.modulePermissions as Record<string, unknown>,
        fieldPermissions: draft.fieldPermissions as Record<string, unknown>,
        temporaryPassword: draft.temporaryPassword,
        sendEmailInvite: sendInviteNow || draft.sendEmailInvite,
      });

      const nextUser = mapLiveUser(saved, 0);
      setUsers((prev) => [nextUser, ...prev]);
      if (authUser?.userId) cacheAdminDirectoryUser(authUser.userId, saved);
      await logAdminAction({
        action: sendInviteNow ? "User Created & Invited" : "User Created",
        record: draft.email,
        details: `${nextUser.name} · ${draft.role} · ${accountStatus}${
          sendInviteNow || draft.sendEmailInvite ? " · invite sent" : ""
        }`,
      });
      toast.success(
        sendInviteNow || draft.sendEmailInvite
          ? `${nextUser.name} created in Cognito and saved to UsersTable. Invite email sent by Cognito.`
          : `${nextUser.name} created in Cognito and saved to UsersTable.`,
      );
      setAddUserOpen(false);
      setWizardStep(0);
      setDraft(buildEmptyDraft());
      setActiveSection("users");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not save user to AWS";
      setCreateUserError(message);
      toast.error(message);
    } finally {
      setCreatingUser(false);
    }
  };

  const saveDraft = () => {
    const label =
      `${draft.firstName} ${draft.lastName}`.trim() || draft.email.trim() || "New user draft";
    void logAdminAction({
      action: "User Draft Saved",
      record: draft.email.trim() || label,
      details: `Wizard step ${wizardStep + 1} · ${draft.role || "no role"}`,
    });
    setSavedDraftCount((prev) => prev + 1);
    setAddUserOpen(false);
    setWizardStep(0);
    toast.success("User draft saved.");
  };

  if (isEditUserPath) {
    return <Outlet />;
  }

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
              {usersLoading && users.length === 0 ? (
                <StatCardsSkeleton count={4} />
              ) : (
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
              )}

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
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8 gap-1.5"
                        disabled={selectedVisibleIds.length === 0}
                        onClick={() => {
                          const selected = users.filter((u) => selectedVisibleIds.includes(u.id));
                          void (async () => {
                            for (const user of selected) await resendUserInvite(user);
                          })();
                        }}
                      >
                        <Mail className="h-3.5 w-3.5" /> Resend Invite
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8 gap-1.5"
                        disabled={selectedVisibleIds.length === 0}
                        onClick={() =>
                          void updateUsersStatus(selectedVisibleIds, "Suspended", "User Suspended")
                        }
                      >
                        <PauseCircle className="h-3.5 w-3.5" /> Suspend
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8 gap-1.5"
                        disabled={selectedVisibleIds.length === 0}
                        onClick={() =>
                          void updateUsersStatus(
                            selectedVisibleIds,
                            "Deactivated",
                            "User Deactivated",
                          )
                        }
                      >
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
                        {usersLoading && filteredUsers.length === 0 ? (
                          Array.from({ length: 6 }).map((_, i) => (
                            <TableRow key={`skel-${i}`} className="border-border/60">
                              {Array.from({ length: 13 }).map((__, j) => (
                                <TableCell key={j} className={j === 12 ? "text-right" : ""}>
                                  <Skeleton
                                    className={j === 0 ? "h-4 w-4" : "h-4 w-full max-w-[110px]"}
                                  />
                                </TableCell>
                              ))}
                            </TableRow>
                          ))
                        ) : filteredUsers.length === 0 ? (
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
                                    <DropdownMenuItem
                                      onSelect={() => {
                                        void navigate({
                                          to: "/admin/users/$userId",
                                          params: { userId: user.id },
                                        });
                                      }}
                                    >
                                      <Edit3 className="h-4 w-4" /> Edit User
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                      disabled={passwordResetBusyId === user.id}
                                      onSelect={() => void requestPasswordReset(user)}
                                    >
                                      <RefreshCw
                                        className={`h-4 w-4 ${passwordResetBusyId === user.id ? "animate-spin" : ""}`}
                                      />{" "}
                                      Reset Password
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                      disabled={passwordResetBusyId === user.id}
                                      onSelect={() => void resendUserInvite(user)}
                                    >
                                      <Mail className="h-4 w-4" /> Resend Invite
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                      onSelect={() => {
                                        void logAdminAction({
                                          action: "Activity Viewed",
                                          record: user.email,
                                          details: user.name,
                                        });
                                        setActiveSection("audit");
                                      }}
                                    >
                                      <Eye className="h-4 w-4" /> View Activity
                                    </DropdownMenuItem>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem
                                      onSelect={() =>
                                        void updateUsersStatus(
                                          [user.id],
                                          "Suspended",
                                          "User Suspended",
                                        )
                                      }
                                    >
                                      <PauseCircle className="h-4 w-4" /> Suspend User
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                      onSelect={() =>
                                        void updateUsersStatus(
                                          [user.id],
                                          "Deactivated",
                                          "User Deactivated",
                                        )
                                      }
                                    >
                                      <UserX className="h-4 w-4" /> Deactivate User
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                      className="text-destructive"
                                      onSelect={() => void deleteUsers([user.id])}
                                    >
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
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-8 gap-1.5"
                              onClick={() => {
                                const user = users.find((u) => u.id === row.id);
                                if (user) void resendUserInvite(user);
                              }}
                            >
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
                    {auditLogsLoading && securityEvents.length === 0 ? (
                      <p className="text-sm text-muted-foreground">Loading security signals…</p>
                    ) : securityEvents.length === 0 ? (
                      <p className="text-sm text-muted-foreground">
                        No admin audit events yet. User lifecycle actions appear here.
                      </p>
                    ) : (
                      securityEvents.map((event) => (
                        <div
                          key={event.id}
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
                      ))
                    )}
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
                    Live roster counts from Cognito/UsersTable, plus org chart seeded in
                    WorkspaceSettings (`orgStructure`).
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {(orgStructure?.teams ?? []).map((item) => {
                    const liveCount =
                      teamsFromDirectory.find((t) => t.team === item.name)?.count ?? 0;
                    return (
                      <div key={item.id} className="rounded-md border border-border/70 p-3">
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-medium">{item.name}</span>
                          <Badge variant="outline">{liveCount} users</Badge>
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">Lead: {item.lead}</p>
                        <p className="text-xs text-muted-foreground">{item.focus}</p>
                      </div>
                    );
                  })}
                  {teamsFromDirectory.length > 0 ? (
                    <div className="rounded-md border border-dashed border-border/70 p-3">
                      <p className="text-xs font-medium text-muted-foreground">
                        Directory teams / departments
                      </p>
                      <ul className="mt-2 space-y-1">
                        {teamsFromDirectory.slice(0, 8).map((row) => (
                          <li
                            key={row.team}
                            className="flex justify-between text-xs text-foreground"
                          >
                            <span>{row.team}</span>
                            <span className="text-muted-foreground">{row.count}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </CardContent>
              </Card>
              <Card className="border-border/70 shadow-sm">
                <CardHeader>
                  <CardTitle>Branch Permissions</CardTitle>
                  <CardDescription>Branches from WorkspaceSettings orgStructure.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {(orgStructure?.branches ?? []).map((branch) => (
                    <div key={branch.id} className="rounded-md border border-border/70 p-3">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium">{branch.name}</span>
                        <span className="text-xs text-muted-foreground">{branch.region}</span>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Restriction: {branch.restricted ? "Restricted" : "Open"}
                      </p>
                    </div>
                  ))}
                  {!orgStructure?.branches?.length ? (
                    <p className="text-sm text-muted-foreground">
                      No branches yet — open Settings once while signed in to seed defaults.
                    </p>
                  ) : null}
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
                    onChange={(enabled) =>
                      void logAdminAction({
                        action: "Security Setting Updated",
                        module: "Security",
                        record: "Require Two-Factor Authentication",
                        details: enabled ? "Enabled" : "Disabled",
                      })
                    }
                  />
                  <ToggleRow
                    label="Single Sign-On (Google)"
                    description="Allow login with Google Workspace"
                    defaultChecked
                    onChange={(enabled) =>
                      void logAdminAction({
                        action: "Security Setting Updated",
                        module: "Security",
                        record: "Single Sign-On (Google)",
                        details: enabled ? "Enabled" : "Disabled",
                      })
                    }
                  />
                  <ToggleRow
                    label="Single Sign-On (Microsoft)"
                    description="Allow login with Microsoft Entra ID"
                    onChange={(enabled) =>
                      void logAdminAction({
                        action: "Security Setting Updated",
                        module: "Security",
                        record: "Single Sign-On (Microsoft)",
                        details: enabled ? "Enabled" : "Disabled",
                      })
                    }
                  />
                  <ToggleRow
                    label="Trusted Devices"
                    description="Challenge unknown devices before session creation"
                    defaultChecked
                    onChange={(enabled) =>
                      void logAdminAction({
                        action: "Security Setting Updated",
                        module: "Security",
                        record: "Trusted Devices",
                        details: enabled ? "Enabled" : "Disabled",
                      })
                    }
                  />
                  <ToggleRow
                    label="IP Restrictions"
                    description="Only allow office and approved VPN IP ranges"
                    onChange={(enabled) =>
                      void logAdminAction({
                        action: "Security Setting Updated",
                        module: "Security",
                        record: "IP Restrictions",
                        details: enabled ? "Enabled" : "Disabled",
                      })
                    }
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
                  <PolicyLine
                    label="Minimum password length"
                    value={String(companySettings.minimum_password_length ?? "12")}
                  />
                  <PolicyLine
                    label="Require uppercase, lowercase, number, symbol"
                    value={
                      companySettings.require_uppercase &&
                      companySettings.require_lowercase &&
                      companySettings.require_number &&
                      companySettings.require_special_character
                        ? "Enabled"
                        : "Partial / check Settings → Security"
                    }
                  />
                  <PolicyLine
                    label="Password expiration"
                    value={String(companySettings.password_expiration || "—")}
                  />
                  <PolicyLine
                    label="Prevent password reuse"
                    value={String(companySettings.prevent_password_reuse || "—")}
                  />
                  <PolicyLine
                    label="Temporary password expiration"
                    value={String(companySettings.temporary_password_expiration || "—")}
                  />
                  <PolicyLine
                    label="Login attempt limit"
                    value={`${String(companySettings.login_attempt_limit || "5")} attempts`}
                  />
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
                        <TableHead>Email</TableHead>
                        <TableHead>Role</TableHead>
                        <TableHead>2FA</TableHead>
                        <TableHead>Session Status</TableHead>
                        <TableHead className="text-right">Action</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {usersLoading && loginActivityRows.length === 0 ? (
                        <TableRow>
                          <TableCell
                            colSpan={7}
                            className="py-8 text-center text-sm text-muted-foreground"
                          >
                            Loading Cognito directory…
                          </TableCell>
                        </TableRow>
                      ) : loginActivityRows.length === 0 ? (
                        <TableRow>
                          <TableCell
                            colSpan={7}
                            className="py-8 text-center text-sm text-muted-foreground"
                          >
                            No directory users yet. Invite a user to populate login activity.
                          </TableCell>
                        </TableRow>
                      ) : (
                        loginActivityRows.map((row) => {
                          const user = users.find((u) => u.id === row.id);
                          return (
                            <TableRow key={row.id}>
                              <TableCell className="font-medium">{row.name}</TableCell>
                              <TableCell>{row.lastLogin}</TableCell>
                              <TableCell>{user?.email ?? "—"}</TableCell>
                              <TableCell>{user?.role ?? "—"}</TableCell>
                              <TableCell>{user?.twoFAStatus ?? "—"}</TableCell>
                              <TableCell>{row.sessionStatus}</TableCell>
                              <TableCell className="text-right">
                                <Button size="sm" variant="outline" className="h-8" disabled>
                                  Logout All Devices
                                </Button>
                              </TableCell>
                            </TableRow>
                          );
                        })
                      )}
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
                {auditLogsLoading && (
                  <div className="mb-3 flex items-center gap-2 text-sm text-muted-foreground">
                    <LoaderCircle className="h-4 w-4 animate-spin" />
                    Loading audit logs…
                  </div>
                )}
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
                    {auditLogsLoading && auditLogs.length === 0 ? (
                      Array.from({ length: 5 }).map((_, i) => (
                        <TableRow key={`skel-${i}`}>
                          {Array.from({ length: 9 }).map((__, j) => (
                            <TableCell key={j}>
                              <Skeleton className="h-4 w-full max-w-[110px]" />
                            </TableCell>
                          ))}
                        </TableRow>
                      ))
                    ) : auditLogs.length === 0 && !auditLogsLoading ? (
                      <TableRow>
                        <TableCell
                          colSpan={9}
                          className="py-10 text-center text-sm text-muted-foreground"
                        >
                          No admin actions logged yet. Create or edit a user to see entries here.
                        </TableCell>
                      </TableRow>
                    ) : (
                      auditLogs.map((row) => (
                        <TableRow key={row.id}>
                          <TableCell className="whitespace-nowrap">
                            {formatAuditWhen(row.when)}
                          </TableCell>
                          <TableCell>{row.actorName}</TableCell>
                          <TableCell>{row.action}</TableCell>
                          <TableCell>{row.module}</TableCell>
                          <TableCell>{row.record}</TableCell>
                          <TableCell>{row.ip ?? "—"}</TableCell>
                          <TableCell>{row.device ?? "—"}</TableCell>
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
                          <TableCell className="max-w-md whitespace-normal">
                            {row.details}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
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
                  Live Cognito invitations from the user directory — resend, copy, and track
                  expiration.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {inviteRows.length === 0 ? (
                  <p className="py-8 text-center text-sm text-muted-foreground">
                    No pending invitations. Create a user from Users to send an invite.
                  </p>
                ) : (
                  inviteRows.map((invite) => (
                    <div key={invite.id} className="rounded-md border border-border/70 p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <p className="text-sm font-medium">{invite.name}</p>
                          <p className="text-xs text-muted-foreground">{invite.email}</p>
                        </div>
                        <Badge variant="outline" className={inviteTone(invite.status)}>
                          {invite.status}
                        </Badge>
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <span>Expires: {invite.expires}</span>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7"
                          onClick={() => {
                            const user = users.find((u) => u.id === invite.id);
                            if (user) void resendUserInvite(user);
                          }}
                        >
                          Resend
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7"
                          onClick={() => {
                            void navigator.clipboard.writeText(
                              `${window.location.origin}/login?email=${encodeURIComponent(invite.email)}`,
                            );
                            toast.success("Invite link copied");
                            void logInviteCenterAction(
                              invite.name,
                              "Invite Link Copied",
                              `Copied invite link for ${invite.name}`,
                            );
                          }}
                        >
                          Copy Link
                        </Button>
                      </div>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          )}

          {(activeSection === "company" ||
            activeSection === "integrations" ||
            activeSection === "billing" ||
            activeSection === "system") && (
            <Card className="border-border/70 shadow-sm">
              <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
                <div>
                  <CardTitle>Company Admin Settings</CardTitle>
                  <CardDescription>
                    Sourced from Settings → Company (WorkspaceSettings / DynamoDB). Edit there to
                    update letterhead, MC/DOT, and billing contacts.
                  </CardDescription>
                </div>
                <Button variant="outline" size="sm" asChild>
                  <Link to="/settings">Open Settings</Link>
                </Button>
              </CardHeader>
              <CardContent className="grid gap-4 md:grid-cols-2">
                {companySettingsLoading ? (
                  <Skeleton className="h-24 w-full md:col-span-2" />
                ) : (
                  <>
                    <SettingBlock
                      label="Company Profile"
                      value={String(companySettings.company_legal_name || "—")}
                    />
                    <SettingBlock
                      label="MC / DOT"
                      value={`${String(companySettings.mc_number || "—")} / ${String(companySettings.dot_number || "—")}`}
                    />
                    <SettingBlock
                      label="EIN / Tax ID"
                      value={String(companySettings.ein_tax_id || "—")}
                    />
                    <SettingBlock
                      label="Operating Regions"
                      value={String(companySettings.operating_regions || "—")}
                    />
                    <SettingBlock
                      label="Default Currency"
                      value={String(companySettings.default_currency || "USD")}
                    />
                    <SettingBlock
                      label="Default Time Zone"
                      value={String(companySettings.default_time_zone || "—")}
                    />
                    <SettingBlock
                      label="Measurement Units"
                      value={String(companySettings.default_distance_unit || "—")}
                    />
                    <SettingBlock
                      label="Accounting Email"
                      value={String(companySettings.accounting_email || "—")}
                    />
                    <SettingBlock
                      label="Support Email"
                      value={String(companySettings.support_email || "—")}
                    />
                    {activeSection === "integrations" ? (
                      <SettingBlock
                        label="Integrations"
                        value="Configure Google Maps, AI, and providers in Settings → Integrations"
                      />
                    ) : null}
                  </>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      <Dialog
        open={Boolean(passwordResetResult)}
        onOpenChange={(open) => {
          if (!open) setPasswordResetResult(null);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {passwordResetResult?.method === "email-reset-code"
                ? "Reset email sent"
                : passwordResetResult?.emailed
                  ? "Invite email sent"
                  : "Temporary password ready"}
            </DialogTitle>
            <DialogDescription>
              {passwordResetResult?.method === "email-reset-code"
                ? `${passwordResetResult.name} (${passwordResetResult.email}) was sent a Cognito password-reset code. They enter that code in the driver app (Forgot password) to choose a new password.`
                : passwordResetResult?.emailed
                  ? `${passwordResetResult.name} (${passwordResetResult.email}) was emailed a temporary password. They sign in, then set a permanent password.`
                  : passwordResetResult
                    ? `${passwordResetResult.name} (${passwordResetResult.email}) — Cognito could not deliver email. Share this temporary password securely.`
                    : null}
            </DialogDescription>
          </DialogHeader>
          {passwordResetResult ? (
            <div className="space-y-3">
              {passwordResetResult.method === "email-reset-code" ? (
                <div className="rounded-lg border border-success/30 bg-success/10 p-3 text-sm text-foreground">
                  Check <span className="font-medium">{passwordResetResult.email}</span> (and spam)
                  for the Cognito message with a verification code.
                </div>
              ) : passwordResetResult.temporaryPassword ? (
                <div className="rounded-lg border border-border/70 bg-muted/40 p-3">
                  <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                    Temporary password
                  </p>
                  <p className="mt-1 break-all font-mono text-sm font-semibold text-foreground">
                    {passwordResetResult.temporaryPassword}
                  </p>
                </div>
              ) : null}
              <p className="text-xs text-muted-foreground">
                Method: <span className="font-mono">{passwordResetResult.method}</span>
                {passwordResetResult.emailed
                  ? " · email requested from Cognito"
                  : " · manual share"}
              </p>
            </div>
          ) : null}
          <DialogFooter className="gap-2 sm:justify-between">
            {passwordResetResult?.temporaryPassword ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  if (!passwordResetResult.temporaryPassword) return;
                  void navigator.clipboard.writeText(passwordResetResult.temporaryPassword);
                  toast.success("Temporary password copied");
                }}
              >
                Copy password
              </Button>
            ) : (
              <span />
            )}
            <Button type="button" onClick={() => setPasswordResetResult(null)}>
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
                  <Field
                    label="Company"
                    hint={
                      matchedCompany
                        ? `Joins ${matchedCompany.companyName} · ${matchedCompany.userCount} existing ${
                            matchedCompany.userCount === 1 ? "user" : "users"
                          }`
                        : draft.companyName.trim()
                          ? "New company — this user will not see any existing data."
                          : "Required. Determines which data this user can see."
                    }
                  >
                    <Input
                      value={draft.companyName}
                      onChange={(e) => updateDraft("companyName", e.target.value)}
                      list="admin-known-companies"
                      placeholder="Start typing to pick or create"
                      autoComplete="off"
                    />
                    <datalist id="admin-known-companies">
                      {knownCompanies.map((company) => (
                        <option key={company.companyId} value={company.companyName} />
                      ))}
                    </datalist>
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
            <div className="space-y-1 text-xs text-muted-foreground">
              <div>Saved drafts: {savedDraftCount}</div>
              {createUserError && <div className="text-destructive">{createUserError}</div>}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                onClick={() => setAddUserOpen(false)}
                disabled={creatingUser}
              >
                Cancel
              </Button>
              <Button variant="outline" onClick={saveDraft} disabled={creatingUser}>
                Save Draft
              </Button>
              {wizardStep > 0 && (
                <Button
                  variant="outline"
                  onClick={() => setWizardStep((prev) => Math.max(0, prev - 1))}
                  disabled={creatingUser}
                >
                  Back
                </Button>
              )}
              {wizardStep < ADD_USER_STEPS.length - 1 ? (
                <Button
                  onClick={() =>
                    setWizardStep((prev) => Math.min(ADD_USER_STEPS.length - 1, prev + 1))
                  }
                  disabled={!stepCanContinue || creatingUser}
                >
                  Continue
                </Button>
              ) : (
                <>
                  <Button
                    variant="outline"
                    onClick={() => void createUser(false)}
                    disabled={creatingUser}
                  >
                    {creatingUser ? (
                      <>
                        <LoaderCircle className="h-4 w-4 animate-spin" /> Saving…
                      </>
                    ) : (
                      "Create User"
                    )}
                  </Button>
                  <Button onClick={() => void createUser(true)} disabled={creatingUser}>
                    {creatingUser ? (
                      <>
                        <LoaderCircle className="h-4 w-4 animate-spin" /> Saving…
                      </>
                    ) : (
                      "Create & Send Invite"
                    )}
                  </Button>
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
  hint,
  children,
}: {
  label: string;
  required?: boolean;
  /** Helper line under the control — e.g. what a value will do. */
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="space-y-1">
      <span className="text-xs font-medium text-muted-foreground">
        {label}
        {required ? " *" : ""}
      </span>
      {children}
      {hint ? <span className="block text-xs text-muted-foreground">{hint}</span> : null}
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
  onChange,
}: {
  label: string;
  description: string;
  defaultChecked?: boolean;
  onChange?: (checked: boolean) => void;
}) {
  const [checked, setChecked] = React.useState(defaultChecked);
  return (
    <label className="flex items-start justify-between gap-3 rounded-md border border-border/70 p-3">
      <div>
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <Switch
        checked={checked}
        onCheckedChange={(value) => {
          const next = Boolean(value);
          setChecked(next);
          onChange?.(next);
        }}
      />
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
