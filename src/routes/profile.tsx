import { useEffect, useMemo, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import type { VerifiableUserAttributeKey } from "aws-amplify/auth";
import {
  Activity,
  ArrowUpRight,
  BadgeCheck,
  Bell,
  Building2,
  Calendar as CalendarIcon,
  Camera,
  Check,
  ChevronRight,
  Clock,
  Copy,
  CreditCard,
  Download,
  Edit3,
  ExternalLink,
  Eye,
  EyeOff,
  FileText,
  Fingerprint,
  Globe,
  Inbox,
  Key,
  KeyRound,
  Laptop,
  LayoutDashboard,
  Loader2,
  LogOut,
  Mail,
  MapPin,
  MessageSquare,
  Monitor,
  Package,
  Phone,
  Plug,
  Plus,
  RefreshCw,
  Save,
  Shield,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Tablet,
  Trash2,
  Truck,
  Upload,
  UserCircle2,
  Users,
  Webhook,
  Wifi,
} from "lucide-react";

import { PageHeader } from "@/components/page-header";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useAuth } from "@/lib/auth";
import { useProfileSection, type UseProfileSection } from "@/hooks/use-profile-section";
import { isDynamoConfigured } from "@/lib/dynamodb";

export const Route = createFileRoute("/profile")({
  head: () => ({
    meta: [
      { title: "Profile — Logistics Software" },
      {
        name: "description",
        content: "Your personal details, preferences, security, and notifications.",
      },
    ],
  }),
  component: ProfilePage,
});

type TabId =
  | "overview"
  | "personal"
  | "permissions"
  | "preferences"
  | "notifications"
  | "security"
  | "activity"
  | "documents"
  | "integrations"
  | "company";

const TABS: { id: TabId; label: string; icon: typeof UserCircle2 }[] = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "personal", label: "Personal Info", icon: UserCircle2 },
  { id: "permissions", label: "Role & Permissions", icon: ShieldCheck },
  { id: "preferences", label: "Preferences", icon: Sparkles },
  { id: "notifications", label: "Notifications", icon: Bell },
  { id: "security", label: "Security", icon: Shield },
  { id: "activity", label: "Activity", icon: Activity },
  { id: "documents", label: "Documents", icon: FileText },
  { id: "integrations", label: "Integrations", icon: Plug },
  { id: "company", label: "Company", icon: Building2 },
];

function ProfilePage() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const [tab, setTab] = useState<TabId>("overview");

  const displayName = user?.name ?? user?.email?.split("@")[0] ?? "User";
  const email = user?.email ?? "you@logistics.com";
  const initials =
    (user?.name ?? user?.email ?? "U")
      .split(/[\s@.]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase() ?? "")
      .join("") || "U";

  const handleSignOutAll = async () => {
    try {
      await signOut();
      toast.success("Signed out of all devices");
      navigate({ to: "/login", replace: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Sign out failed";
      toast.error(message);
    }
  };

  return (
    <div>
      <PageHeader
        title="Profile"
        description="Your account command center — identity, preferences, security, and connected systems."
        actions={
          <>
            {!isDynamoConfigured() && (
              <Badge variant="outline" className="border-warning/30 bg-warning/15 text-warning-foreground">
                Cloud sync offline
              </Badge>
            )}
            <Button variant="outline" size="sm" className="gap-1.5">
              <Download className="h-4 w-4" /> Export data
            </Button>
          </>
        }
      />

      <div className="px-4 py-6 sm:px-6 lg:px-8">
        <div className="grid gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
          <ProfileSidebar
            displayName={displayName}
            email={email}
            initials={initials}
            onSignOutAll={handleSignOutAll}
            onJump={setTab}
          />

          <Tabs value={tab} onValueChange={(v) => setTab(v as TabId)} className="min-w-0">
            <div className="-mx-1 overflow-x-auto pb-1">
              <TabsList className="inline-flex h-auto w-max gap-1 bg-muted/60 p-1">
                {TABS.map((t) => {
                  const Icon = t.icon;
                  return (
                    <TabsTrigger
                      key={t.id}
                      value={t.id}
                      className="gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium data-[state=active]:bg-background data-[state=active]:shadow-sm"
                    >
                      <Icon className="h-3.5 w-3.5" />
                      {t.label}
                    </TabsTrigger>
                  );
                })}
              </TabsList>
            </div>

            <div className="mt-4">
              <TabsContent value="overview" className="mt-0 space-y-4">
                <OverviewTab displayName={displayName} email={email} />
              </TabsContent>
              <TabsContent value="personal" className="mt-0 space-y-4">
                <PersonalTab />
              </TabsContent>
              <TabsContent value="permissions" className="mt-0 space-y-4">
                <PermissionsTab />
              </TabsContent>
              <TabsContent value="preferences" className="mt-0 space-y-4">
                <PreferencesTab />
              </TabsContent>
              <TabsContent value="notifications" className="mt-0 space-y-4">
                <NotificationsTab />
              </TabsContent>
              <TabsContent value="security" className="mt-0 space-y-4">
                <SecurityTab onSignOutAll={handleSignOutAll} />
              </TabsContent>
              <TabsContent value="activity" className="mt-0 space-y-4">
                <ActivityTab />
              </TabsContent>
              <TabsContent value="documents" className="mt-0 space-y-4">
                <DocumentsTab />
              </TabsContent>
              <TabsContent value="integrations" className="mt-0 space-y-4">
                <IntegrationsTab />
              </TabsContent>
              <TabsContent value="company" className="mt-0 space-y-4">
                <CompanyTab />
              </TabsContent>
            </div>
          </Tabs>
        </div>
      </div>
    </div>
  );
}

type ProfileStrengthCheck = { label: string; done: boolean; tab: TabId };

function useProfileStrength(email: string): {
  completion: number;
  checks: ProfileStrengthCheck[];
  nextHint: ProfileStrengthCheck | null;
  loading: boolean;
} {
  const { user } = useAuth();
  const attrs = user?.attributes;
  const personal = useProfileSection<Partial<PersonalForm>>("personal", {});
  const permissions = useProfileSection<Partial<PermissionsForm>>("permissions", {});
  const company = useProfileSection<Partial<CompanyForm>>("company", {});

  const checks: ProfileStrengthCheck[] = [
    {
      label: "Add your first name",
      done: Boolean(personal.data.given_name || attrs?.given_name),
      tab: "personal",
    },
    {
      label: "Add your last name",
      done: Boolean(personal.data.family_name || attrs?.family_name),
      tab: "personal",
    },
    { label: "Verify email", done: Boolean(email), tab: "personal" },
    {
      label: "Add a phone number",
      done: Boolean(personal.data.phone_number || attrs?.phone_number),
      tab: "personal",
    },
    {
      label: "Set your job title",
      done: Boolean(personal.data.job_title || attrs?.["custom:job_title"]),
      tab: "personal",
    },
    {
      label: "Write a short bio",
      done: Boolean(personal.data.bio || attrs?.profile),
      tab: "personal",
    },
    {
      label: "Add your location",
      done: Boolean(personal.data.city && personal.data.state),
      tab: "personal",
    },
    {
      label: "Set your time zone",
      done: Boolean(personal.data.zoneinfo || attrs?.zoneinfo),
      tab: "personal",
    },
    { label: "Configure your role", done: Boolean(permissions.data.role), tab: "permissions" },
    {
      label: "Add company info",
      done: Boolean(company.data.name && (company.data.mc || company.data.dot)),
      tab: "company",
    },
  ];

  const done = checks.filter((c) => c.done).length;
  const completion = Math.round((done / checks.length) * 100);
  const nextHint = checks.find((c) => !c.done) ?? null;
  const loading = personal.loading || permissions.loading || company.loading;

  return { completion, checks, nextHint, loading };
}

function ProfileSidebar({
  displayName,
  email,
  initials,
  onSignOutAll,
  onJump,
}: {
  displayName: string;
  email: string;
  initials: string;
  onSignOutAll: () => void;
  onJump: (id: TabId) => void;
}) {
  const { completion, checks, nextHint, loading: strengthLoading } = useProfileStrength(email);
  const completedCount = checks.filter((c) => c.done).length;
  const strengthTone =
    completion >= 90
      ? "text-success"
      : completion >= 70
        ? "text-info"
        : completion >= 40
          ? "text-warning-foreground"
          : "text-destructive";
  const progressIndicatorClass =
    completion >= 90
      ? "[&>div]:bg-success"
      : completion >= 70
        ? "[&>div]:bg-info"
        : completion >= 40
          ? "[&>div]:bg-warning"
          : "[&>div]:bg-destructive";

  const quickActions: { label: string; icon: typeof Edit3; tab?: TabId; onClick?: () => void; tone?: "danger" }[] = [
    { label: "Edit Profile", icon: Edit3, tab: "personal" },
    { label: "Change Password", icon: KeyRound, tab: "security" },
    { label: "Enable 2FA", icon: Shield, tab: "security" },
    { label: "Upload Document", icon: Upload, tab: "documents" },
    { label: "View Activity", icon: Activity, tab: "activity" },
    { label: "Manage Notifications", icon: Bell, tab: "notifications" },
    { label: "Connect Email", icon: Mail, tab: "integrations" },
    { label: "Logout All Devices", icon: LogOut, onClick: onSignOutAll, tone: "danger" },
  ];

  return (
    <aside className="space-y-4 lg:sticky lg:top-[72px] lg:self-start">
      <Card className="overflow-hidden border-border/70 shadow-sm">
        <div className="relative h-24 bg-gradient-to-br from-primary via-info to-chart-3">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,white,transparent_60%)] opacity-10" />
        </div>
        <CardContent className="-mt-12 space-y-4">
          <div className="flex flex-col items-center text-center">
            <div className="relative">
              <Avatar className="h-24 w-24 border-4 border-background shadow-md">
                <AvatarFallback className="bg-gradient-to-br from-primary to-info text-2xl font-semibold text-primary-foreground">
                  {initials}
                </AvatarFallback>
              </Avatar>
              <Button
                size="icon"
                variant="secondary"
                className="absolute bottom-0 right-0 h-8 w-8 rounded-full border-2 border-background shadow"
                aria-label="Change photo"
                onClick={() => toast.info("Photo upload coming soon")}
              >
                <Camera className="h-3.5 w-3.5" />
              </Button>
            </div>
            <div className="mt-3 flex items-center gap-1.5">
              <h2 className="text-base font-semibold tracking-tight">{displayName}</h2>
              <BadgeCheck className="h-4 w-4 text-info" />
            </div>
            <p className="text-xs text-muted-foreground">Senior Dispatcher · Operations</p>
            <div className="mt-2 flex items-center gap-2">
              <span className="flex items-center gap-1.5 rounded-full bg-success/15 px-2 py-0.5 text-[11px] font-medium text-success">
                <span className="h-1.5 w-1.5 rounded-full bg-success" />
                Online
              </span>
              <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                Admin
              </span>
            </div>
          </div>

          <div className="rounded-lg border border-border/70 bg-muted/40 p-3">
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium text-foreground">Profile strength</span>
              <span className={`font-semibold tabular-nums ${strengthTone}`}>
                {strengthLoading ? "…" : `${completion}%`}
              </span>
            </div>
            <Progress
              value={strengthLoading ? 0 : completion}
              className={`mt-2 h-1.5 ${progressIndicatorClass}`}
            />
            <div className="mt-2 flex items-center justify-between gap-2">
              <p className="truncate text-[11px] text-muted-foreground" title={nextHint?.label}>
                {strengthLoading
                  ? "Calculating…"
                  : nextHint
                    ? `Next: ${nextHint.label}.`
                    : "All set — your profile is complete."}
              </p>
              <span className="shrink-0 text-[10px] font-medium uppercase tracking-wide text-muted-foreground tabular-nums">
                {completedCount}/{checks.length}
              </span>
            </div>
            {nextHint && !strengthLoading && (
              <button
                type="button"
                onClick={() => onJump(nextHint.tab)}
                className="mt-2 inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:underline"
              >
                Complete now <ArrowUpRight className="h-3 w-3" />
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 gap-1.5 text-xs text-muted-foreground">
            <SidebarMeta icon={Mail} text={email} />
            <SidebarMeta icon={Phone} text="+1 (404) 555-0142" />
            <SidebarMeta icon={MapPin} text="Atlanta, GA" />
            <SidebarMeta icon={Globe} text="America/New_York (EST)" />
            <SidebarMeta icon={Clock} text="Last login · 12 min ago" />
          </div>
        </CardContent>
      </Card>

      <Card className="border-border/70 shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Quick actions</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1 pt-0">
          {quickActions.map((q) => {
            const Icon = q.icon;
            return (
              <button
                key={q.label}
                onClick={() => (q.onClick ? q.onClick() : q.tab && onJump(q.tab))}
                className={`group flex w-full items-center justify-between rounded-md px-2.5 py-2 text-sm transition-colors hover:bg-accent ${
                  q.tone === "danger" ? "text-destructive hover:bg-destructive/10" : ""
                }`}
              >
                <span className="flex items-center gap-2.5">
                  <Icon className="h-4 w-4 opacity-80" />
                  {q.label}
                </span>
                <ChevronRight className="h-3.5 w-3.5 opacity-0 transition-opacity group-hover:opacity-60" />
              </button>
            );
          })}
        </CardContent>
      </Card>
    </aside>
  );
}

function SidebarMeta({ icon: Icon, text }: { icon: typeof Mail; text: string }) {
  return (
    <div className="flex items-center gap-2 truncate">
      <Icon className="h-3.5 w-3.5 shrink-0 opacity-70" />
      <span className="truncate">{text}</span>
    </div>
  );
}

function SectionCard({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Card className="border-border/70 shadow-sm">
      <CardHeader className="flex flex-row items-start justify-between gap-3 pb-3">
        <div>
          <CardTitle className="text-base">{title}</CardTitle>
          {description && (
            <CardDescription className="mt-0.5 text-xs">{description}</CardDescription>
          )}
        </div>
        {action}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function StatTile({
  label,
  value,
  delta,
  icon: Icon,
  tone = "default",
}: {
  label: string;
  value: string;
  delta?: string;
  icon: typeof Activity;
  tone?: "default" | "success" | "warning" | "info";
}) {
  const toneClass = {
    default: "bg-muted text-foreground",
    success: "bg-success/15 text-success",
    warning: "bg-warning/20 text-warning-foreground",
    info: "bg-info/15 text-info",
  } as const;
  return (
    <Card className="border-border/70 shadow-sm">
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {label}
          </div>
          <span className={`flex h-7 w-7 items-center justify-center rounded-md ${toneClass[tone]}`}>
            <Icon className="h-3.5 w-3.5" />
          </span>
        </div>
        <div className="mt-2 flex items-baseline justify-between gap-2">
          <div className="text-2xl font-semibold tracking-tight text-foreground">{value}</div>
          {delta && (
            <Badge variant="secondary" className={toneClass[tone]}>
              {delta}
            </Badge>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function SaveBar<T extends Record<string, unknown>>({
  hook,
  extra,
  onSave,
}: {
  hook: UseProfileSection<T>;
  extra?: React.ReactNode;
  onSave?: () => Promise<void> | void;
}) {
  const handleSave = async () => {
    try {
      if (onSave) await onSave();
      await hook.save();
      toast.success("Saved");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Save failed";
      toast.error(message);
    }
  };

  return (
    <div className="flex items-center gap-2">
      {!hook.enabled && (
        <Badge variant="outline" className="border-warning/30 bg-warning/15 text-warning-foreground">
          Cloud sync offline
        </Badge>
      )}
      {hook.enabled && hook.loading && (
        <Badge variant="outline" className="gap-1 border-info/20 bg-info/10 text-info">
          <Loader2 className="h-3 w-3 animate-spin" /> Loading
        </Badge>
      )}
      {hook.dirty && (
        <Badge variant="outline" className="border-warning/30 bg-warning/15 text-warning-foreground">
          Unsaved changes
        </Badge>
      )}
      {extra}
      <Button
        size="sm"
        variant="outline"
        onClick={hook.reset}
        disabled={!hook.dirty || hook.saving}
      >
        Reset
      </Button>
      <Button
        size="sm"
        className="gap-1.5"
        onClick={handleSave}
        disabled={!hook.dirty || hook.saving || !hook.enabled}
      >
        {hook.saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
        Save
      </Button>
    </div>
  );
}

function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-medium text-foreground">{label}</Label>
      {children}
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

function OverviewTab({ displayName, email }: { displayName: string; email: string }) {
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Assigned Loads" value="47" delta="+6 this week" icon={Package} tone="info" />
        <StatTile label="Open Tasks" value="12" delta="3 due today" icon={Inbox} tone="warning" />
        <StatTile label="Approvals" value="4" delta="Action needed" icon={ShieldCheck} tone="warning" />
        <StatTile label="On-time %" value="98.4%" delta="+0.7%" icon={BadgeCheck} tone="success" />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <SectionCard
          title="At a glance"
          description="Your work and identity in one view."
          action={
            <Button variant="ghost" size="sm" className="gap-1 text-primary">
              View all <ArrowUpRight className="h-4 w-4" />
            </Button>
          }
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <InfoRow label="Full name" value={displayName} />
            <InfoRow label="Job title" value="Senior Dispatcher" />
            <InfoRow label="Department" value="Operations" />
            <InfoRow label="Email" value={email} />
            <InfoRow label="Phone" value="+1 (404) 555-0142" />
            <InfoRow label="Time zone" value="America/New_York" />
            <InfoRow label="Location" value="Atlanta, GA" />
            <InfoRow label="Status" value="Active" tone="success" />
            <InfoRow label="Last login" value="May 14, 2026 · 6:48 AM" />
            <InfoRow label="Member since" value="Apr 12, 2023" />
          </div>
        </SectionCard>

        <SectionCard title="Allowed modules" description="Areas you can access today.">
          <div className="flex flex-wrap gap-1.5">
            {[
              "Dashboard",
              "Loads",
              "TruckBoard",
              "Tracking",
              "Quotes",
              "RFPs",
              "CRM",
              "Accounting",
              "Analytics",
              "Admin",
              "Settings",
            ].map((m) => (
              <Badge
                key={m}
                variant="outline"
                className="border-primary/20 bg-primary/5 text-primary"
              >
                <Check className="mr-1 h-3 w-3" /> {m}
              </Badge>
            ))}
          </div>

          <Separator className="my-4" />
          <div className="space-y-2 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Permission group</span>
              <span className="font-medium">Ops · Tier 2</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Access level</span>
              <Badge variant="secondary" className="bg-info/15 text-info">
                Admin
              </Badge>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Branch</span>
              <span className="font-medium">ATL HQ</span>
            </div>
          </div>
        </SectionCard>
      </div>

      <SectionCard
        title="Recent activity"
        description="Latest things you and your account touched."
        action={
          <Button variant="ghost" size="sm" className="gap-1 text-primary">
            Open activity log <ArrowUpRight className="h-4 w-4" />
          </Button>
        }
      >
        <ActivityList compact />
      </SectionCard>
    </>
  );
}

function InfoRow({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "success" | "warning" | "info";
}) {
  const toneClass: Record<string, string> = {
    success: "text-success",
    warning: "text-warning-foreground",
    info: "text-info",
  };
  return (
    <div className="min-w-0">
      <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div
        title={value}
        className={`mt-0.5 break-words text-sm font-medium ${tone ? toneClass[tone] : "text-foreground"}`}
      >
        {value}
      </div>
    </div>
  );
}

type PersonalForm = {
  given_name: string;
  family_name: string;
  nickname: string;
  email: string;
  phone_number: string;
  mobile: string;
  job_title: string;
  department: string;
  locale: string;
  zoneinfo: string;
  street: string;
  city: string;
  state: string;
  zip: string;
  country: string;
  bio: string;
};

const COUNTRY_OPTIONS = [
  { value: "US", label: "United States" },
  { value: "CA", label: "Canada" },
  { value: "MX", label: "Mexico" },
];

const TIMEZONE_OPTIONS = [
  { value: "America/New_York", label: "Eastern Time (US & Canada)" },
  { value: "America/Chicago", label: "Central Time (US & Canada)" },
  { value: "America/Denver", label: "Mountain Time (US & Canada)" },
  { value: "America/Los_Angeles", label: "Pacific Time (US & Canada)" },
  { value: "America/Mexico_City", label: "Mexico City" },
  { value: "America/Toronto", label: "Toronto" },
];

const LANGUAGE_OPTIONS = [
  { value: "en-US", label: "English (US)" },
  { value: "en-GB", label: "English (UK)" },
  { value: "es-MX", label: "Español (MX)" },
  { value: "fr-CA", label: "Français (CA)" },
];

function buildFormFromUser(attrs: Record<string, string | undefined> | undefined, fallbackEmail: string): PersonalForm {
  const a = attrs ?? {};
  const fullName = a.name ?? "";
  const [firstFromName, ...restFromName] = fullName.split(" ");
  let address = { street: "", city: "", state: "", zip: "", country: "" };
  if (a.address) {
    try {
      const parsed = JSON.parse(a.address);
      if (parsed && typeof parsed === "object") {
        address = {
          street: parsed.street_address ?? parsed.street ?? "",
          city: parsed.locality ?? parsed.city ?? "",
          state: parsed.region ?? parsed.state ?? "",
          zip: parsed.postal_code ?? parsed.zip ?? "",
          country: parsed.country ?? "",
        };
      }
    } catch {
      address = { ...address, street: a.address };
    }
  }
  return {
    given_name: a.given_name ?? firstFromName ?? "",
    family_name: a.family_name ?? restFromName.join(" ") ?? "",
    nickname: a.nickname ?? a.preferred_username ?? a.name ?? "",
    email: a.email ?? fallbackEmail,
    phone_number: a.phone_number ?? "",
    mobile: a["custom:mobile"] ?? "",
    job_title: a["custom:job_title"] ?? "",
    department: a["custom:department"] ?? "",
    locale: a.locale ?? "en-US",
    zoneinfo: a.zoneinfo ?? "America/New_York",
    street: address.street,
    city: address.city,
    state: address.state,
    zip: address.zip,
    country: address.country || "US",
    bio: a.profile ?? "",
  };
}

function PersonalTab() {
  const { user, updateAttributes, resendAttributeCode, confirmAttribute } = useAuth();

  const cognitoInitial = useMemo(
    () => buildFormFromUser(user?.attributes, user?.email ?? ""),
    [user],
  );

  const hook = useProfileSection<PersonalForm>("personal", cognitoInitial);
  const form = hook.data;
  const setForm = hook.setData;

  const [savingCognito, setSavingCognito] = useState(false);
  const [pendingVerify, setPendingVerify] = useState<VerifiableUserAttributeKey | null>(null);
  const [code, setCode] = useState("");
  const [confirming, setConfirming] = useState(false);

  const set = <K extends keyof PersonalForm>(key: K, value: PersonalForm[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const saveToCognito = async () => {
    const phone = form.phone_number.trim();
    if (phone && !/^\+[1-9]\d{6,14}$/.test(phone)) {
      throw new Error("Phone must be in E.164 format, e.g. +14045550142");
    }

    const addressJson = JSON.stringify({
      street_address: form.street,
      locality: form.city,
      region: form.state,
      postal_code: form.zip,
      country: form.country,
    });

    const fullName = [form.given_name, form.family_name].filter(Boolean).join(" ").trim();

    const attributes: Record<string, string | undefined> = {
      given_name: form.given_name,
      family_name: form.family_name,
      name: fullName || undefined,
      nickname: form.nickname || undefined,
      email: form.email,
      phone_number: phone || undefined,
      locale: form.locale,
      zoneinfo: form.zoneinfo,
      address: addressJson,
      profile: form.bio || undefined,
    };

    const result = await updateAttributes(attributes);
    let needsVerify: VerifiableUserAttributeKey | null = null;
    for (const [key, info] of Object.entries(result)) {
      if (info?.nextStep?.updateAttributeStep === "CONFIRM_ATTRIBUTE_WITH_CODE") {
        needsVerify = key as VerifiableUserAttributeKey;
      }
    }
    if (needsVerify) {
      setPendingVerify(needsVerify);
      toast.message(`A verification code was sent to confirm your new ${needsVerify}.`);
    }
  };

  const handleSaveAll = async () => {
    setSavingCognito(true);
    try {
      await saveToCognito();
      await hook.save();
      toast.success("Saved");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Save failed";
      toast.error(message);
    } finally {
      setSavingCognito(false);
    }
  };

  const handleConfirm = async () => {
    if (!pendingVerify) return;
    setConfirming(true);
    try {
      await confirmAttribute(pendingVerify, code.trim());
      toast.success(`${pendingVerify} verified`);
      setPendingVerify(null);
      setCode("");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Verification failed";
      toast.error(message);
    } finally {
      setConfirming(false);
    }
  };

  const handleResend = async () => {
    if (!pendingVerify) return;
    try {
      await resendAttributeCode(pendingVerify);
      toast.success("Verification code resent");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not resend code";
      toast.error(message);
    }
  };

  return (
    <>
      {pendingVerify && (
        <Card className="border-warning/40 bg-warning/10 shadow-sm">
          <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <span className="mt-0.5 flex h-9 w-9 items-center justify-center rounded-md bg-warning/30 text-warning-foreground">
                <Shield className="h-4 w-4" />
              </span>
              <div>
                <div className="text-sm font-semibold text-warning-foreground">
                  Verify your new {pendingVerify}
                </div>
                <p className="text-xs text-muted-foreground">
                  AWS Cognito sent a 6-digit code. Enter it below to finish updating your{" "}
                  {pendingVerify}.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="123456"
                inputMode="numeric"
                className="h-9 w-32 tabular-nums"
              />
              <Button size="sm" onClick={handleConfirm} disabled={confirming || !code.trim()}>
                {confirming ? <Loader2 className="h-4 w-4 animate-spin" /> : "Confirm"}
              </Button>
              <Button size="sm" variant="outline" onClick={handleResend}>
                Resend
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <SectionCard
        title="Personal information"
        description="How you appear across the workspace."
        action={
          <div className="flex items-center gap-2">
            {!hook.enabled && (
              <Badge variant="outline" className="border-warning/30 bg-warning/15 text-warning-foreground">
                Cloud sync offline
              </Badge>
            )}
            {hook.dirty && (
              <Badge variant="outline" className="border-warning/30 bg-warning/15 text-warning-foreground">
                Unsaved changes
              </Badge>
            )}
            <Button
              size="sm"
              variant="outline"
              onClick={hook.reset}
              disabled={!hook.dirty || savingCognito || hook.saving}
            >
              Reset
            </Button>
            <Button
              size="sm"
              onClick={handleSaveAll}
              disabled={!hook.dirty || savingCognito || hook.saving}
              className="gap-1.5"
            >
              {savingCognito || hook.saving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              Save
            </Button>
          </div>
        }
      >
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="First name">
            <Input value={form.given_name} onChange={(e) => set("given_name", e.target.value)} />
          </Field>
          <Field label="Last name">
            <Input value={form.family_name} onChange={(e) => set("family_name", e.target.value)} />
          </Field>
          <Field label="Display name">
            <Input value={form.nickname} onChange={(e) => set("nickname", e.target.value)} />
          </Field>
          <Field
            label="Email address"
            hint="Changing email triggers a Cognito verification code."
          >
            <Input
              type="email"
              value={form.email}
              onChange={(e) => set("email", e.target.value)}
            />
          </Field>
          <Field label="Phone number" hint="E.164 format, e.g. +14045550142">
            <Input
              value={form.phone_number}
              onChange={(e) => set("phone_number", e.target.value)}
              placeholder="+14045550142"
            />
          </Field>
          <Field label="Mobile number">
            <Input value={form.mobile} onChange={(e) => set("mobile", e.target.value)} />
          </Field>
          <Field label="Job title">
            <Input value={form.job_title} onChange={(e) => set("job_title", e.target.value)} />
          </Field>
          <Field label="Department">
            <Input value={form.department} onChange={(e) => set("department", e.target.value)} />
          </Field>
          <Field label="Preferred language">
            <Select value={form.locale} onValueChange={(v) => set("locale", v)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LANGUAGE_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Preferred time zone">
            <Select value={form.zoneinfo} onValueChange={(v) => set("zoneinfo", v)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TIMEZONE_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </div>
      </SectionCard>

      <SectionCard title="Address" description="Stored as a structured Cognito address claim.">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Street address">
            <Input value={form.street} onChange={(e) => set("street", e.target.value)} />
          </Field>
          <Field label="City">
            <Input value={form.city} onChange={(e) => set("city", e.target.value)} />
          </Field>
          <Field label="State / Region">
            <Input value={form.state} onChange={(e) => set("state", e.target.value)} />
          </Field>
          <Field label="ZIP / Postal code">
            <Input value={form.zip} onChange={(e) => set("zip", e.target.value)} />
          </Field>
          <Field label="Country">
            <Select value={form.country} onValueChange={(v) => set("country", v)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {COUNTRY_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </div>
      </SectionCard>

      <SectionCard title="About" description="A short bio saved to your Cognito profile attribute.">
        <Textarea
          rows={4}
          value={form.bio}
          onChange={(e) => set("bio", e.target.value)}
          placeholder="Senior dispatcher with 8+ years moving dry van and reefer across the Southeast."
        />
      </SectionCard>
    </>
  );
}

type PermissionsForm = {
  role: string;
  permissionGroup: string;
  accessLevel: string;
  branch: string;
  teams: string;
  customers: string;
  carriers: string;
  brokers: string;
  adminAccess: boolean;
};

const PERMISSIONS_DEFAULTS: PermissionsForm = {
  role: "admin",
  permissionGroup: "Ops · Tier 2",
  accessLevel: "full",
  branch: "ATL HQ",
  teams: "SE Dispatch, Reefer Pod",
  customers: "Acme Foods, Northstar Bev., Summit Retail",
  carriers: "Bluepeak, Ironline, Sundial",
  brokers: "Pinecrest, Atlas, Rivermark",
  adminAccess: true,
};

function PermissionsTab() {
  const hook = useProfileSection<PermissionsForm>("permissions", PERMISSIONS_DEFAULTS);
  const { data: form, patch } = hook;

  const modules = [
    { name: "Dashboard", access: "Full", tone: "success" as const },
    { name: "Loads", access: "Full", tone: "success" as const },
    { name: "TruckBoard", access: "Full", tone: "success" as const },
    { name: "Tracking", access: "Full", tone: "success" as const },
    { name: "Quotes", access: "Edit", tone: "info" as const },
    { name: "RFPs", access: "View", tone: "default" as const },
    { name: "CRM & Sales", access: "Edit", tone: "info" as const },
    { name: "Accounting", access: "View", tone: "default" as const },
    { name: "Analytics", access: "Full", tone: "success" as const },
    { name: "Admin", access: "Restricted", tone: "warning" as const },
    { name: "Settings", access: "Full", tone: "success" as const },
  ];

  const toneClass = {
    default: "bg-muted text-foreground",
    success: "bg-success/15 text-success",
    info: "bg-info/15 text-info",
    warning: "bg-warning/20 text-warning-foreground",
  } as const;

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Role" value={form.role === "admin" ? "Admin" : form.role} icon={ShieldCheck} tone="info" />
        <StatTile label="Permission Group" value={form.permissionGroup} icon={Users} tone="default" />
        <StatTile label="Modules" value="11/11" icon={LayoutDashboard} tone="success" />
        <StatTile label="Branches" value={form.branch} icon={Building2} tone="default" />
      </div>

      <SectionCard
        title="Role & access"
        description="What you can do across the platform."
        action={<SaveBar hook={hook} />}
      >
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="User role">
            <Select value={form.role} onValueChange={(v) => patch({ role: v })}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="admin">Administrator</SelectItem>
                <SelectItem value="ops">Operations Manager</SelectItem>
                <SelectItem value="dispatch">Dispatcher</SelectItem>
                <SelectItem value="broker">Broker</SelectItem>
                <SelectItem value="driver">Driver</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Permission group">
            <Input
              value={form.permissionGroup}
              onChange={(e) => patch({ permissionGroup: e.target.value })}
            />
          </Field>
          <Field label="Access level">
            <Select value={form.accessLevel} onValueChange={(v) => patch({ accessLevel: v })}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="full">Full access</SelectItem>
                <SelectItem value="edit">Edit</SelectItem>
                <SelectItem value="view">View only</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Assigned branch / office">
            <Input value={form.branch} onChange={(e) => patch({ branch: e.target.value })} />
          </Field>
          <Field label="Assigned teams">
            <Input value={form.teams} onChange={(e) => patch({ teams: e.target.value })} />
          </Field>
          <Field label="Admin access">
            <div className="flex h-9 items-center justify-between rounded-md border border-input bg-background px-3">
              <span className="text-sm">{form.adminAccess ? "Enabled" : "Disabled"}</span>
              <Switch
                checked={form.adminAccess}
                onCheckedChange={(v) => patch({ adminAccess: v })}
              />
            </div>
          </Field>
          <Field label="Assigned customers" hint="Comma-separated list.">
            <Input value={form.customers} onChange={(e) => patch({ customers: e.target.value })} />
          </Field>
          <Field label="Assigned carriers" hint="Comma-separated list.">
            <Input value={form.carriers} onChange={(e) => patch({ carriers: e.target.value })} />
          </Field>
          <Field label="Assigned brokers" hint="Comma-separated list.">
            <Input value={form.brokers} onChange={(e) => patch({ brokers: e.target.value })} />
          </Field>
        </div>
      </SectionCard>

      <div className="grid gap-4 lg:grid-cols-2">
        <SectionCard title="Allowed modules" description="Module-level access for your role.">
          <div className="space-y-1.5">
            {modules.map((m) => (
              <div
                key={m.name}
                className="flex items-center justify-between rounded-md border border-border/60 bg-card px-3 py-2"
              >
                <span className="text-sm font-medium">{m.name}</span>
                <Badge variant="secondary" className={toneClass[m.tone]}>
                  {m.access}
                </Badge>
              </div>
            ))}
          </div>
        </SectionCard>

        <SectionCard title="Assigned book of business" description="Accounts attached to you.">
          <div className="space-y-3 text-sm">
            <AssignedRow icon={Users} label="Customers" count={28} sample="Acme Foods, Northstar Bev., Summit Retail" />
            <AssignedRow icon={Truck} label="Carriers" count={42} sample="Bluepeak, Ironline, Sundial" />
            <AssignedRow icon={Building2} label="Brokers" count={11} sample="Pinecrest, Atlas, Rivermark" />
            <AssignedRow icon={Package} label="Active loads" count={47} sample="L-2841, L-2839, L-2832…" />
          </div>
        </SectionCard>
      </div>
    </>
  );
}

function AssignedRow({
  icon: Icon,
  label,
  count,
  sample,
}: {
  icon: typeof Users;
  label: string;
  count: number;
  sample: string;
}) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-md border border-border/60 bg-muted/30 p-3">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-md bg-primary/10 text-primary">
          <Icon className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <div className="text-sm font-medium">{label}</div>
          <div className="truncate text-xs text-muted-foreground">{sample}</div>
        </div>
      </div>
      <Badge variant="outline" className="shrink-0 border-primary/20 bg-primary/5 text-primary">
        {count}
      </Badge>
    </div>
  );
}

type PreferencesForm = {
  landingPage: string;
  dashboardView: string;
  loadBoardFilter: string;
  equipment: string;
  regions: string;
  dateFormat: string;
  currency: string;
  density: string;
  theme: string;
};

const PREFERENCES_DEFAULTS: PreferencesForm = {
  landingPage: "dashboard",
  dashboardView: "ops",
  loadBoardFilter: "my",
  equipment: "Dry Van, Reefer, Flatbed",
  regions: "SE → TX, SE → Midwest",
  dateFormat: "us",
  currency: "usd",
  density: "comfortable",
  theme: "system",
};

function PreferencesTab() {
  const hook = useProfileSection<PreferencesForm>("preferences", PREFERENCES_DEFAULTS);
  const { data: form, patch } = hook;

  return (
    <>
      <SectionCard
        title="Work preferences"
        description="Tune how the workspace shows up for you."
        action={<SaveBar hook={hook} />}
      >
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Default landing page">
            <Select value={form.landingPage} onValueChange={(v) => patch({ landingPage: v })}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="dashboard">Dashboard</SelectItem>
                <SelectItem value="loads">Loads</SelectItem>
                <SelectItem value="truckboard">TruckBoard</SelectItem>
                <SelectItem value="tracking">Tracking</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Default dashboard view">
            <Select value={form.dashboardView} onValueChange={(v) => patch({ dashboardView: v })}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ops">Operations</SelectItem>
                <SelectItem value="sales">Sales</SelectItem>
                <SelectItem value="exec">Executive</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Default load board filters">
            <Select
              value={form.loadBoardFilter}
              onValueChange={(v) => patch({ loadBoardFilter: v })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="my">My loads</SelectItem>
                <SelectItem value="team">My team</SelectItem>
                <SelectItem value="all">All loads</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Preferred equipment">
            <Input value={form.equipment} onChange={(e) => patch({ equipment: e.target.value })} />
          </Field>
          <Field label="Preferred regions / lanes">
            <Input value={form.regions} onChange={(e) => patch({ regions: e.target.value })} />
          </Field>
          <Field label="Date format">
            <Select value={form.dateFormat} onValueChange={(v) => patch({ dateFormat: v })}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="us">MM/DD/YYYY</SelectItem>
                <SelectItem value="iso">YYYY-MM-DD</SelectItem>
                <SelectItem value="eu">DD/MM/YYYY</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Currency">
            <Select value={form.currency} onValueChange={(v) => patch({ currency: v })}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="usd">USD ($)</SelectItem>
                <SelectItem value="cad">CAD ($)</SelectItem>
                <SelectItem value="mxn">MXN ($)</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Table density">
            <Select value={form.density} onValueChange={(v) => patch({ density: v })}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="compact">Compact</SelectItem>
                <SelectItem value="comfortable">Comfortable</SelectItem>
                <SelectItem value="roomy">Roomy</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Theme">
            <Select value={form.theme} onValueChange={(v) => patch({ theme: v })}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="system">Match system</SelectItem>
                <SelectItem value="light">Light</SelectItem>
                <SelectItem value="dark">Dark</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        </div>
      </SectionCard>
    </>
  );
}

type NotificationsForm = {
  channels: { email: boolean; sms: boolean; inapp: boolean; push: boolean };
  topics: Record<string, boolean>;
};

const NOTIFICATION_TOPICS = [
  { key: "load", label: "Load updates", desc: "Booked, dispatched, in-transit, delivered", channels: ["Email", "In-app", "Push"] },
  { key: "bid", label: "Bid updates", desc: "New bids, accepted, lost, expired", channels: ["Email", "In-app"] },
  { key: "quote", label: "Quote updates", desc: "New quote requests, customer replies", channels: ["Email", "In-app"] },
  { key: "rfp", label: "RFP updates", desc: "Awards, rejections, deadlines", channels: ["Email"] },
  { key: "tracking", label: "Tracking alerts", desc: "Geofence enter/exit, delays, exceptions", channels: ["SMS", "Push"] },
  { key: "accounting", label: "Accounting alerts", desc: "Invoices, payments, settlements", channels: ["Email"] },
  { key: "crm", label: "CRM reminders", desc: "Follow-ups, tasks, account changes", channels: ["In-app"] },
  { key: "system", label: "System announcements", desc: "Releases, maintenance, security notices", channels: ["Email", "In-app"] },
];

const NOTIFICATIONS_DEFAULTS: NotificationsForm = {
  channels: { email: true, sms: false, inapp: true, push: true },
  topics: Object.fromEntries(NOTIFICATION_TOPICS.map((t) => [t.key, true])),
};

function NotificationsTab() {
  const hook = useProfileSection<NotificationsForm>("notifications", NOTIFICATIONS_DEFAULTS);
  const { data: form, setData } = hook;

  const channels: { key: keyof NotificationsForm["channels"]; label: string; icon: typeof Mail }[] = [
    { key: "email", label: "Email", icon: Mail },
    { key: "sms", label: "SMS", icon: Smartphone },
    { key: "inapp", label: "In-app", icon: MessageSquare },
    { key: "push", label: "Push", icon: Bell },
  ];

  return (
    <>
      <SectionCard
        title="Channels"
        description="Where we should reach you."
        action={<SaveBar hook={hook} />}
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {channels.map((c) => {
            const Icon = c.icon;
            const on = form.channels[c.key];
            return (
              <div
                key={c.key}
                className="flex items-center justify-between rounded-lg border border-border/70 bg-card p-3"
              >
                <div className="flex items-center gap-2.5">
                  <span className="flex h-8 w-8 items-center justify-center rounded-md bg-primary/10 text-primary">
                    <Icon className="h-4 w-4" />
                  </span>
                  <div>
                    <div className="text-sm font-medium">{c.label}</div>
                    <div className="text-[11px] text-muted-foreground">
                      {on ? "Enabled" : "Disabled"}
                    </div>
                  </div>
                </div>
                <Switch
                  checked={on}
                  onCheckedChange={(v) =>
                    setData((f) => ({ ...f, channels: { ...f.channels, [c.key]: v } }))
                  }
                />
              </div>
            );
          })}
        </div>
      </SectionCard>

      <SectionCard title="Topics" description="Mute or amplify what matters to you.">
        <div className="overflow-hidden rounded-md border border-border/70">
          <Table>
            <TableHeader>
              <TableRow className="border-border/70">
                <TableHead className="pl-4">Topic</TableHead>
                <TableHead>Channels</TableHead>
                <TableHead className="text-right pr-4">Enabled</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {NOTIFICATION_TOPICS.map((c) => (
                <TableRow key={c.key} className="border-border/60">
                  <TableCell className="pl-4">
                    <div className="font-medium">{c.label}</div>
                    <div className="text-xs text-muted-foreground">{c.desc}</div>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {c.channels.map((ch) => (
                        <Badge key={ch} variant="outline" className="border-info/20 bg-info/10 text-info">
                          {ch}
                        </Badge>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell className="pr-4 text-right">
                    <Switch
                      checked={form.topics[c.key] ?? true}
                      onCheckedChange={(v) =>
                        setData((f) => ({ ...f, topics: { ...f.topics, [c.key]: v } }))
                      }
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </SectionCard>
    </>
  );
}

type SecurityPrefs = {
  sessionTimeout: string;
  requireBiometrics: boolean;
  signInAlerts: boolean;
  authenticatorApp: boolean;
  smsCodes: boolean;
  backupEmail: string;
};

const SECURITY_DEFAULTS: SecurityPrefs = {
  sessionTimeout: "60",
  requireBiometrics: true,
  signInAlerts: true,
  authenticatorApp: true,
  smsCodes: false,
  backupEmail: "",
};

function SecurityTab({ onSignOutAll }: { onSignOutAll: () => void }) {
  const [show, setShow] = useState(false);
  const hook = useProfileSection<SecurityPrefs>("security", SECURITY_DEFAULTS);
  const { data: form, patch } = hook;
  const sessions = [
    { device: "MacBook Pro · Chrome", location: "Atlanta, GA · 173.18.x.x", time: "Active now", current: true, icon: Laptop },
    { device: "iPhone 15 · Safari", location: "Atlanta, GA · 24.106.x.x", time: "1h ago", current: false, icon: Smartphone },
    { device: "Windows 11 · Edge", location: "Dallas, TX · 70.114.x.x", time: "3 days ago", current: false, icon: Monitor },
    { device: "iPad · Safari", location: "Miami, FL · 71.43.x.x", time: "Last week", current: false, icon: Tablet },
  ];

  const tokens = [
    { name: "Operations CLI", created: "Mar 2, 2026", lastUsed: "5 min ago", scopes: "read:loads, write:loads" },
    { name: "Analytics ETL", created: "Jan 18, 2026", lastUsed: "2 days ago", scopes: "read:* " },
    { name: "Personal Dev", created: "Nov 5, 2025", lastUsed: "Idle 30d", scopes: "read:profile" },
  ];

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="2FA" value="Enabled" icon={Shield} tone="success" />
        <StatTile label="Active sessions" value={String(sessions.length)} icon={Wifi} tone="info" />
        <StatTile label="API tokens" value={String(tokens.length)} icon={Key} tone="default" />
        <StatTile label="Trusted devices" value="3" icon={Fingerprint} tone="success" />
      </div>

      <SectionCard
        title="Password"
        description="Use a strong password you don't use elsewhere."
      >
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Current password">
            <div className="relative">
              <Input type={show ? "text" : "password"} defaultValue="••••••••••" />
              <button
                type="button"
                onClick={() => setShow((s) => !s)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                aria-label="Toggle password visibility"
              >
                {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </Field>
          <Field label="New password">
            <Input type="password" placeholder="At least 12 characters" />
          </Field>
          <Field label="Confirm new password">
            <Input type="password" placeholder="Repeat new password" />
          </Field>
        </div>
        <div className="mt-3 flex items-center justify-between">
          <p className="text-xs text-muted-foreground">Last changed 47 days ago.</p>
          <Button size="sm" onClick={() => toast.success("Password updated")}>
            Update password
          </Button>
        </div>
      </SectionCard>

      <div className="grid gap-4 lg:grid-cols-2">
        <SectionCard
          title="Two-factor authentication"
          description="Add an extra layer of security at sign-in."
          action={<SaveBar hook={hook} />}
        >
          <div className="flex items-center justify-between rounded-md border border-success/30 bg-success/10 p-3">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-success" />
              <div>
                <div className="text-sm font-medium text-success">2FA is enabled</div>
                <div className="text-xs text-muted-foreground">Authenticator app · 8 backup codes left</div>
              </div>
            </div>
            <Button size="sm" variant="outline">Manage</Button>
          </div>
          <Separator className="my-4" />
          <div className="space-y-3">
            <ControlledToggleRow
              icon={Smartphone}
              title="Authenticator app"
              sub="TOTP via Google Authenticator, Authy, 1Password"
              value={form.authenticatorApp}
              onChange={(v) => patch({ authenticatorApp: v })}
            />
            <ControlledToggleRow
              icon={MessageSquare}
              title="SMS codes"
              sub="Receive a 6-digit code via text message"
              value={form.smsCodes}
              onChange={(v) => patch({ smsCodes: v })}
            />
            <div className="rounded-md border border-border/60 bg-card p-3">
              <Label className="text-xs font-medium">Backup email</Label>
              <Input
                className="mt-1.5"
                placeholder="backup@example.com"
                value={form.backupEmail}
                onChange={(e) => patch({ backupEmail: e.target.value })}
              />
            </div>
          </div>
        </SectionCard>

        <SectionCard
          title="Session preferences"
          description="Auto-lock and idle timeout."
        >
          <div className="space-y-3">
            <Field label="Session timeout">
              <Select
                value={form.sessionTimeout}
                onValueChange={(v) => patch({ sessionTimeout: v })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="15">15 minutes</SelectItem>
                  <SelectItem value="30">30 minutes</SelectItem>
                  <SelectItem value="60">1 hour</SelectItem>
                  <SelectItem value="480">8 hours</SelectItem>
                  <SelectItem value="never">Never (not recommended)</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <ControlledToggleRow
              icon={Fingerprint}
              title="Require biometrics on mobile"
              sub="Face ID / Touch ID on iPhone & iPad"
              value={form.requireBiometrics}
              onChange={(v) => patch({ requireBiometrics: v })}
            />
            <ControlledToggleRow
              icon={ShieldCheck}
              title="Sign-in alerts"
              sub="Get notified about new device sign-ins"
              value={form.signInAlerts}
              onChange={(v) => patch({ signInAlerts: v })}
            />
          </div>
          <Separator className="my-4" />
          <Button variant="outline" size="sm" className="w-full gap-1.5" onClick={onSignOutAll}>
            <LogOut className="h-4 w-4" /> Sign out of all other devices
          </Button>
        </SectionCard>
      </div>

      <SectionCard
        title="Active sessions"
        description="Devices currently signed into your account."
        action={
          <Button variant="ghost" size="sm" className="gap-1 text-destructive">
            <Trash2 className="h-4 w-4" /> Revoke all
          </Button>
        }
      >
        <div className="space-y-2">
          {sessions.map((s) => {
            const Icon = s.icon;
            return (
              <div
                key={s.device}
                className="flex items-center justify-between gap-3 rounded-md border border-border/60 bg-card p-3"
              >
                <div className="flex items-center gap-3">
                  <span className="flex h-9 w-9 items-center justify-center rounded-md bg-muted text-foreground">
                    <Icon className="h-4 w-4" />
                  </span>
                  <div>
                    <div className="flex items-center gap-2 text-sm font-medium">
                      {s.device}
                      {s.current && (
                        <Badge variant="secondary" className="bg-success/15 text-success">
                          This device
                        </Badge>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {s.location} · {s.time}
                    </div>
                  </div>
                </div>
                {!s.current && (
                  <Button size="sm" variant="ghost" className="text-destructive hover:bg-destructive/10">
                    Revoke
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      </SectionCard>

      <SectionCard
        title="API access tokens"
        description="Programmatic access to your account. Treat these like passwords."
        action={
          <Button size="sm" className="gap-1.5">
            <Plus className="h-4 w-4" /> New token
          </Button>
        }
      >
        <div className="overflow-hidden rounded-md border border-border/70">
          <Table>
            <TableHeader>
              <TableRow className="border-border/70">
                <TableHead className="pl-4">Name</TableHead>
                <TableHead>Scopes</TableHead>
                <TableHead>Created</TableHead>
                <TableHead>Last used</TableHead>
                <TableHead className="pr-4 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tokens.map((t) => (
                <TableRow key={t.name} className="border-border/60">
                  <TableCell className="pl-4 font-medium">{t.name}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{t.scopes}</TableCell>
                  <TableCell className="text-muted-foreground">{t.created}</TableCell>
                  <TableCell className="text-muted-foreground">{t.lastUsed}</TableCell>
                  <TableCell className="pr-4 text-right">
                    <Button size="sm" variant="ghost" className="h-7 gap-1 text-xs">
                      <Copy className="h-3.5 w-3.5" /> Copy
                    </Button>
                    <Button size="sm" variant="ghost" className="h-7 gap-1 text-xs text-destructive hover:bg-destructive/10">
                      <Trash2 className="h-3.5 w-3.5" /> Revoke
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </SectionCard>
    </>
  );
}

function ControlledToggleRow({
  icon: Icon,
  title,
  sub,
  value,
  onChange,
}: {
  icon: typeof Mail;
  title: string;
  sub: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between rounded-md border border-border/60 bg-card p-3">
      <div className="flex items-center gap-2.5">
        <span className="flex h-8 w-8 items-center justify-center rounded-md bg-muted text-foreground">
          <Icon className="h-4 w-4" />
        </span>
        <div>
          <div className="text-sm font-medium">{title}</div>
          <div className="text-xs text-muted-foreground">{sub}</div>
        </div>
      </div>
      <Switch checked={value} onCheckedChange={onChange} />
    </div>
  );
}

function ActivityTab() {
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Actions (7d)" value="186" delta="+24" icon={Activity} tone="info" />
        <StatTile label="Logins (30d)" value="42" icon={KeyRound} tone="default" />
        <StatTile label="Devices" value="4" icon={Monitor} tone="default" />
        <StatTile label="Last login" value="12m ago" icon={Clock} tone="success" />
      </div>

      <SectionCard
        title="Activity timeline"
        description="A live feed of everything you've done across the platform."
        action={
          <Button variant="outline" size="sm" className="gap-1.5">
            <RefreshCw className="h-4 w-4" /> Refresh
          </Button>
        }
      >
        <ActivityList />
      </SectionCard>

      <SectionCard title="IP & device log" description="Audit-friendly raw access records.">
        <div className="overflow-hidden rounded-md border border-border/70">
          <Table>
            <TableHeader>
              <TableRow className="border-border/70">
                <TableHead className="pl-4">When</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Device</TableHead>
                <TableHead>IP</TableHead>
                <TableHead className="pr-4">Location</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {[
                ["May 14 · 06:48", "Login", "Mac · Chrome 124", "173.18.92.14", "Atlanta, GA"],
                ["May 14 · 06:12", "Updated load L-2841", "Mac · Chrome 124", "173.18.92.14", "Atlanta, GA"],
                ["May 13 · 22:01", "Login", "iPhone · Safari", "24.106.41.7", "Atlanta, GA"],
                ["May 13 · 18:33", "Created invoice INV-3920", "Mac · Chrome 124", "173.18.92.14", "Atlanta, GA"],
                ["May 12 · 14:09", "Approved bid B-1187", "Windows · Edge", "70.114.10.221", "Dallas, TX"],
              ].map((row) => (
                <TableRow key={row.join("|")} className="border-border/60">
                  <TableCell className="pl-4 tabular-nums text-muted-foreground">{row[0]}</TableCell>
                  <TableCell className="font-medium">{row[1]}</TableCell>
                  <TableCell className="text-muted-foreground">{row[2]}</TableCell>
                  <TableCell className="tabular-nums text-muted-foreground">{row[3]}</TableCell>
                  <TableCell className="pr-4 text-muted-foreground">{row[4]}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </SectionCard>
    </>
  );
}

function ActivityList({ compact = false }: { compact?: boolean }) {
  const items = [
    { icon: Package, tone: "info" as const, title: "Booked load L-2841", sub: "Acme Foods · Atlanta → Dallas · $3,420", time: "12 min ago" },
    { icon: CreditCard, tone: "success" as const, title: "Approved settlement for Bluepeak Freight", sub: "Settlement #S-1182 · $14,820", time: "1 h ago" },
    { icon: FileText, tone: "default" as const, title: "Uploaded POD for L-2820", sub: "Summit Retail · Dallas → Houston", time: "3 h ago" },
    { icon: Users, tone: "info" as const, title: "Added carrier Ironline Logistics", sub: "MC-872118 · Onboarding complete", time: "Yesterday" },
    { icon: ShieldCheck, tone: "warning" as const, title: "2FA backup codes regenerated", sub: "From MacBook Pro · Atlanta, GA", time: "2 days ago" },
    { icon: KeyRound, tone: "default" as const, title: "Signed in from new device", sub: "iPhone 15 · Safari · Atlanta, GA", time: "3 days ago" },
  ];
  const shown = compact ? items.slice(0, 4) : items;
  const toneClass = {
    success: "bg-success/15 text-success",
    info: "bg-info/15 text-info",
    warning: "bg-warning/20 text-warning-foreground",
    default: "bg-muted text-foreground",
  } as const;

  return (
    <ol className="relative space-y-3 border-l border-border/70 pl-5">
      {shown.map((it, i) => {
        const Icon = it.icon;
        return (
          <li key={i} className="relative">
            <span
              className={`absolute -left-[26px] top-1 flex h-6 w-6 items-center justify-center rounded-full ring-4 ring-background ${toneClass[it.tone]}`}
            >
              <Icon className="h-3 w-3" />
            </span>
            <div className="flex items-start justify-between gap-3 rounded-md border border-border/60 bg-card p-3">
              <div className="min-w-0">
                <div className="text-sm font-medium">{it.title}</div>
                <div className="truncate text-xs text-muted-foreground">{it.sub}</div>
              </div>
              <span className="shrink-0 text-[11px] text-muted-foreground">{it.time}</span>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

type DocumentItem = {
  name: string;
  type: string;
  size: string;
  date: string;
  status: string;
  tone: "success" | "warning" | "default";
};

type DocumentsForm = { items: DocumentItem[] };

const DOCUMENTS_DEFAULTS: DocumentsForm = {
  items: [
    { name: "W-9 Tax Form 2026.pdf", type: "Tax", size: "184 KB", date: "Jan 12, 2026", status: "Valid", tone: "success" },
    { name: "ID Verification — Drivers License.jpg", type: "Identity", size: "2.1 MB", date: "Aug 4, 2025", status: "Verified", tone: "success" },
    { name: "HOS Compliance Cert.pdf", type: "Compliance", size: "412 KB", date: "Mar 20, 2026", status: "Valid", tone: "success" },
    { name: "Hazmat Training Cert.pdf", type: "Training", size: "612 KB", date: "Nov 8, 2025", status: "Expires soon", tone: "warning" },
    { name: "Employment Agreement.pdf", type: "Employment", size: "1.8 MB", date: "Apr 12, 2023", status: "Signed", tone: "default" },
    { name: "Brokerage Agency Agreement.pdf", type: "Agreement", size: "988 KB", date: "Feb 1, 2026", status: "Signed", tone: "default" },
  ],
};

function DocumentsTab() {
  const hook = useProfileSection<DocumentsForm>("documents", DOCUMENTS_DEFAULTS);
  const { data: form, setData } = hook;

  const toneClass = {
    success: "bg-success/15 text-success border-success/20",
    warning: "bg-warning/20 text-warning-foreground border-warning/30",
    default: "bg-muted text-foreground border-border",
  } as const;

  const addDoc = () => {
    const name = window.prompt("Document name?");
    if (!name) return;
    const type = window.prompt("Type? (Tax, Identity, Compliance, Training, Employment, Agreement)") ?? "Other";
    setData((f) => ({
      items: [
        ...f.items,
        {
          name,
          type,
          size: "—",
          date: new Date().toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }),
          status: "Pending",
          tone: "default",
        },
      ],
    }));
  };

  const removeDoc = (idx: number) =>
    setData((f) => ({ items: f.items.filter((_, i) => i !== idx) }));

  return (
    <>
      <SectionCard
        title="Documents"
        description="ID, tax, compliance, training, and signed agreements."
        action={
          <div className="flex items-center gap-2">
            <SaveBar hook={hook} />
            <Button size="sm" className="gap-1.5" onClick={addDoc}>
              <Upload className="h-4 w-4" /> Add
            </Button>
          </div>
        }
      >
        <div className="overflow-hidden rounded-md border border-border/70">
          <Table>
            <TableHeader>
              <TableRow className="border-border/70">
                <TableHead className="pl-4">Name</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Size</TableHead>
                <TableHead>Uploaded</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="pr-4 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {form.items.map((d, idx) => (
                <TableRow key={`${d.name}-${idx}`} className="border-border/60">
                  <TableCell className="pl-4">
                    <div className="flex items-center gap-2.5">
                      <span className="flex h-8 w-8 items-center justify-center rounded-md bg-primary/10 text-primary">
                        <FileText className="h-4 w-4" />
                      </span>
                      <span className="font-medium">{d.name}</span>
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{d.type}</TableCell>
                  <TableCell className="tabular-nums text-muted-foreground">{d.size}</TableCell>
                  <TableCell className="text-muted-foreground">{d.date}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className={toneClass[d.tone]}>
                      {d.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="pr-4 text-right">
                    <Button size="sm" variant="ghost" className="h-7 gap-1 text-xs">
                      <Eye className="h-3.5 w-3.5" /> View
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 gap-1 text-xs text-destructive hover:bg-destructive/10"
                      onClick={() => removeDoc(idx)}
                    >
                      <Trash2 className="h-3.5 w-3.5" /> Remove
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </SectionCard>
    </>
  );
}

type IntegrationsForm = {
  connections: Record<string, boolean>;
  webhooks: { url: string; events: string; status: "Active" | "Paused" }[];
};

const INTEGRATION_DEFINITIONS = [
  { key: "google", name: "Google Workspace", desc: "Email, calendar, drive", icon: Mail },
  { key: "microsoft", name: "Microsoft 365", desc: "Outlook, Teams, OneDrive", icon: Mail },
  { key: "calendar", name: "Calendar", desc: "Sync your meetings & pickups", icon: CalendarIcon },
  { key: "eld", name: "ELD provider", desc: "Samsara, KeepTruckin, Geotab", icon: Truck },
  { key: "tms", name: "TMS integration", desc: "McLeod, TMW, Aljex", icon: Package },
  { key: "accounting", name: "Accounting", desc: "QuickBooks, NetSuite, Xero", icon: CreditCard },
] as const;

const INTEGRATIONS_DEFAULTS: IntegrationsForm = {
  connections: {
    google: true,
    microsoft: true,
    calendar: true,
    eld: true,
    tms: false,
    accounting: true,
  },
  webhooks: [
    { url: "https://hooks.acme-ops.com/loads", events: "load.updated, load.delivered", status: "Active" },
    { url: "https://api.northstar.io/freight", events: "invoice.paid", status: "Active" },
    { url: "https://internal.tools.dev/track", events: "tracking.exception", status: "Paused" },
  ],
};

function IntegrationsTab() {
  const hook = useProfileSection<IntegrationsForm>("integrations", INTEGRATIONS_DEFAULTS);
  const { data: form, setData } = hook;

  const toggleConn = (key: string) =>
    setData((f) => ({
      ...f,
      connections: { ...f.connections, [key]: !f.connections[key] },
    }));

  const addWebhook = () => {
    const url = window.prompt("Webhook URL?");
    if (!url) return;
    const events = window.prompt("Events (comma-separated)?") ?? "";
    setData((f) => ({ ...f, webhooks: [...f.webhooks, { url, events, status: "Active" }] }));
  };

  const toggleWebhook = (idx: number) =>
    setData((f) => ({
      ...f,
      webhooks: f.webhooks.map((w, i) =>
        i === idx ? { ...w, status: w.status === "Active" ? "Paused" : "Active" } : w,
      ),
    }));

  const removeWebhook = (idx: number) =>
    setData((f) => ({ ...f, webhooks: f.webhooks.filter((_, i) => i !== idx) }));

  return (
    <>
      <SectionCard
        title="Connected accounts"
        description="Link your tools so data flows automatically."
        action={<SaveBar hook={hook} />}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          {INTEGRATION_DEFINITIONS.map((i) => {
            const Icon = i.icon;
            const connected = form.connections[i.key] ?? false;
            return (
              <div
                key={i.key}
                className="flex items-center justify-between rounded-lg border border-border/70 bg-card p-3"
              >
                <div className="flex items-center gap-3">
                  <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <Icon className="h-5 w-5" />
                  </span>
                  <div>
                    <div className="flex items-center gap-2 text-sm font-medium">
                      {i.name}
                      {connected && (
                        <Badge variant="secondary" className="bg-success/15 text-success">
                          Connected
                        </Badge>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground">{i.desc}</div>
                  </div>
                </div>
                <Button
                  size="sm"
                  variant={connected ? "outline" : "default"}
                  onClick={() => toggleConn(i.key)}
                >
                  {connected ? "Disconnect" : "Connect"}
                </Button>
              </div>
            );
          })}
        </div>
      </SectionCard>

      <SectionCard
        title="Webhooks"
        description="Push events to your own endpoints in real time."
        action={
          <Button size="sm" className="gap-1.5" onClick={addWebhook}>
            <Plus className="h-4 w-4" /> Add webhook
          </Button>
        }
      >
        <div className="space-y-2">
          {form.webhooks.map((w, idx) => (
            <div
              key={`${w.url}-${idx}`}
              className="flex items-center justify-between gap-3 rounded-md border border-border/60 bg-card p-3"
            >
              <div className="flex items-center gap-3 min-w-0">
                <span className="flex h-8 w-8 items-center justify-center rounded-md bg-muted text-foreground">
                  <Webhook className="h-4 w-4" />
                </span>
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{w.url}</div>
                  <div className="truncate text-xs text-muted-foreground">{w.events}</div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Badge
                  variant="outline"
                  className={
                    w.status === "Active"
                      ? "border-success/20 bg-success/15 text-success"
                      : "border-warning/30 bg-warning/20 text-warning-foreground"
                  }
                >
                  {w.status}
                </Badge>
                <Button size="sm" variant="ghost" onClick={() => toggleWebhook(idx)}>
                  {w.status === "Active" ? "Pause" : "Resume"}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-destructive hover:bg-destructive/10"
                  onClick={() => removeWebhook(idx)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      </SectionCard>
    </>
  );
}

type CompanyForm = {
  name: string;
  mc: string;
  dot: string;
  ein: string;
  type: string;
  website: string;
  businessAddress: string;
  billingAddress: string;
  mainContact: string;
  supportEmail: string;
  dispatchPhone: string;
  accountingEmail: string;
  regions: string[];
  equipment: string[];
};

const COMPANY_DEFAULTS: CompanyForm = {
  name: "Logistics Software Inc.",
  mc: "MC-1024871",
  dot: "DOT-4198234",
  ein: "84-1932109",
  type: "brokerage",
  website: "https://logisticssoftware.com",
  businessAddress: "500 Logistics Way, Atlanta, GA 30303",
  billingAddress: "Same as business address",
  mainContact: "Jordan Hayes · COO",
  supportEmail: "support@logisticssoftware.com",
  dispatchPhone: "+1 (404) 555-0100",
  accountingEmail: "ap@logisticssoftware.com",
  regions: ["Southeast", "Texas", "Midwest", "Northeast", "West Coast", "Cross-border MX"],
  equipment: ["Dry Van", "Reefer", "Flatbed", "Step Deck", "Power Only", "Intermodal", "Hotshot"],
};

function CompanyTab() {
  const hook = useProfileSection<CompanyForm>("company", COMPANY_DEFAULTS);
  const { data: form, patch } = hook;

  return (
    <>
      <SectionCard
        title="Company profile"
        description="Visible to admins. Powers compliance and billing."
        action={
          <div className="flex items-center gap-2">
            <SaveBar hook={hook} />
            <Button variant="outline" size="sm" className="gap-1.5">
              <ExternalLink className="h-4 w-4" /> Public profile
            </Button>
          </div>
        }
      >
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-info text-primary-foreground">
            <Building2 className="h-7 w-7" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-base font-semibold">{form.name}</h3>
              <Badge variant="outline" className="border-success/20 bg-success/15 text-success">
                <Check className="mr-1 h-3 w-3" /> Verified
              </Badge>
              <Badge variant="outline">{form.type}</Badge>
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {form.mc} · {form.dot} · EIN {form.ein}
            </p>
          </div>
        </div>

        <Separator className="my-5" />

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Company name">
            <Input value={form.name} onChange={(e) => patch({ name: e.target.value })} />
          </Field>
          <Field label="MC number">
            <Input value={form.mc} onChange={(e) => patch({ mc: e.target.value })} />
          </Field>
          <Field label="DOT number">
            <Input value={form.dot} onChange={(e) => patch({ dot: e.target.value })} />
          </Field>
          <Field label="Tax ID / EIN">
            <Input value={form.ein} onChange={(e) => patch({ ein: e.target.value })} />
          </Field>
          <Field label="Company type">
            <Select value={form.type} onValueChange={(v) => patch({ type: v })}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="brokerage">Brokerage</SelectItem>
                <SelectItem value="asset">Asset Carrier</SelectItem>
                <SelectItem value="hybrid">Hybrid</SelectItem>
                <SelectItem value="3pl">3PL</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Website">
            <Input value={form.website} onChange={(e) => patch({ website: e.target.value })} />
          </Field>
          <Field label="Business address">
            <Input
              value={form.businessAddress}
              onChange={(e) => patch({ businessAddress: e.target.value })}
            />
          </Field>
          <Field label="Billing address">
            <Input
              value={form.billingAddress}
              onChange={(e) => patch({ billingAddress: e.target.value })}
            />
          </Field>
          <Field label="Main contact">
            <Input
              value={form.mainContact}
              onChange={(e) => patch({ mainContact: e.target.value })}
            />
          </Field>
          <Field label="Support email">
            <Input
              value={form.supportEmail}
              onChange={(e) => patch({ supportEmail: e.target.value })}
            />
          </Field>
          <Field label="Dispatch phone">
            <Input
              value={form.dispatchPhone}
              onChange={(e) => patch({ dispatchPhone: e.target.value })}
            />
          </Field>
          <Field label="Accounting email">
            <Input
              value={form.accountingEmail}
              onChange={(e) => patch({ accountingEmail: e.target.value })}
            />
          </Field>
        </div>

        <Separator className="my-5" />

        <div className="grid gap-4 lg:grid-cols-2">
          <Field label="Operating regions" hint="Comma-separated.">
            <Input
              value={form.regions.join(", ")}
              onChange={(e) =>
                patch({
                  regions: e.target.value
                    .split(",")
                    .map((s) => s.trim())
                    .filter(Boolean),
                })
              }
            />
            <div className="mt-2 flex flex-wrap gap-1.5">
              {form.regions.map((r) => (
                <Badge key={r} variant="outline" className="border-info/20 bg-info/10 text-info">
                  {r}
                </Badge>
              ))}
            </div>
          </Field>
          <Field label="Equipment types supported" hint="Comma-separated.">
            <Input
              value={form.equipment.join(", ")}
              onChange={(e) =>
                patch({
                  equipment: e.target.value
                    .split(",")
                    .map((s) => s.trim())
                    .filter(Boolean),
                })
              }
            />
            <div className="mt-2 flex flex-wrap gap-1.5">
              {form.equipment.map((r) => (
                <Badge key={r} variant="outline" className="border-primary/20 bg-primary/5 text-primary">
                  {r}
                </Badge>
              ))}
            </div>
          </Field>
        </div>
      </SectionCard>
    </>
  );
}
