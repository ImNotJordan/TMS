import { useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  Bell,
  ChevronRight,
  Download,
  ExternalLink,
  Globe,
  HelpCircle,
  LogOut,
  MapPin,
  Moon,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { useAuth } from "@/lib/auth";
import { useLoads } from "@/lib/loads-store";
import { DISPATCH_APP_URL } from "@/lib/external-links";
import {
  getPushPermissionState,
  readPushPreference,
  requestPushPermission,
  writePushPreference,
} from "@/lib/load-notifications";
import { isIosDevice, isStandaloneDisplay } from "@/lib/pwa";
import { toast } from "sonner";

export const Route = createFileRoute("/profile")({
  component: ProfilePage,
});

function ProfilePage() {
  useEffect(() => {
    document.title = "Profile — Titan Freight Driver";
  }, []);

  const { driver, signOut } = useAuth();
  const { locationSharing, setLocationSharing } = useLoads();
  const navigate = useNavigate();
  const [dark, setDark] = useState(false);
  const [notifications, setNotifications] = useState(true);
  const [permission, setPermission] = useState(() => getPushPermissionState());

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
  }, [dark]);

  useEffect(() => {
    if (!driver?.userId) return;
    setNotifications(readPushPreference(driver.userId));
    setPermission(getPushPermissionState());
  }, [driver?.userId]);

  const onNotificationsChange = async (next: boolean) => {
    if (!driver?.userId) return;
    setNotifications(next);
    writePushPreference(driver.userId, next);
    if (!next) {
      toast.message("Push notifications off", {
        description: "You'll still see in-app toasts for new loads.",
      });
      return;
    }
    const result = await requestPushPermission();
    setPermission(result);
    if (result === "granted") {
      toast.success("Browser notifications enabled");
    } else if (result === "denied") {
      toast.message("Permission blocked", {
        description: "Allow notifications in your browser settings to get push alerts.",
      });
    } else if (result === "unsupported") {
      toast.message("Not supported here", {
        description: "This browser can't show system notifications.",
      });
    }
  };

  if (!driver) return null;

  return (
    <div className="animate-in fade-in slide-in-from-bottom-2 duration-500 space-y-5 px-4 py-5">
      <div className="flex items-center gap-4">
        <Avatar className="h-16 w-16 shadow-md">
          <AvatarFallback className="bg-gradient-to-br from-ink-elevated to-ink text-lg font-heading font-bold text-amber">
            {driver.initials}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <h1 className="truncate font-heading text-lg font-bold text-foreground">{driver.name}</h1>
            <Badge variant="secondary" className="gap-1 text-[10px]">
              <ShieldCheck className="h-3 w-3 text-success" /> Verified
            </Badge>
          </div>
          <p className="truncate font-mono text-xs text-muted-foreground">
            Truck #{driver.truckNumber} · Trailer #{driver.trailerNumber}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2.5">
        <StatTile label="Years" value={`${driver.yearsWithCompany}`} />
        <StatTile label="Safety score" value={`${driver.safetyScore}`} />
        <StatTile label="Total miles" value={`${Math.round(driver.totalMiles / 1000)}k`} />
      </div>

      <Card className="border-border/70 shadow-sm">
        <CardContent className="divide-y divide-border p-0">
          {!isStandaloneDisplay() ? (
            <button
              type="button"
              className="flex w-full items-center gap-3 p-3.5 text-left transition-colors hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              onClick={() => {
                if (isIosDevice()) {
                  toast.message("Install on iPhone / iPad", {
                    description: "Safari → Share → Add to Home Screen",
                    duration: 8_000,
                  });
                  return;
                }
                toast.message("Install on Android", {
                  description: "Browser menu → Install app / Add to Home screen",
                  duration: 8_000,
                });
              }}
            >
              <Download className="h-4 w-4 text-muted-foreground" />
              <span className="flex-1 text-sm text-foreground">Install app on this device</span>
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            </button>
          ) : (
            <SettingRow icon={Download} label="Installed on this device" trailing="Home screen" />
          )}
          <SettingRow
            icon={Bell}
            label="Push notifications"
            trailing={
              permission === "denied"
                ? "Blocked"
                : permission === "granted" && notifications
                  ? "On"
                  : undefined
            }
          >
            <Switch
              checked={notifications}
              onCheckedChange={(v) => void onNotificationsChange(v)}
            />
          </SettingRow>
          <SettingRow icon={MapPin} label="Share location by default">
            <Switch checked={locationSharing} onCheckedChange={setLocationSharing} />
          </SettingRow>
          <SettingRow icon={Moon} label="Dark mode">
            <Switch checked={dark} onCheckedChange={setDark} />
          </SettingRow>
          <SettingRow icon={Globe} label="Language" trailing="English (US)" />
        </CardContent>
      </Card>

      <Card className="border-border/70 shadow-sm">
        <CardContent className="divide-y divide-border p-0">
          <a
            href={DISPATCH_APP_URL}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-3 p-3.5 transition-colors hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <ExternalLink className="h-4 w-4 text-muted-foreground" />
            <span className="flex-1 text-sm text-foreground">Open Dispatcher Console</span>
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          </a>
          <SettingRow icon={HelpCircle} label="Help & support" />
        </CardContent>
      </Card>

      <Button
        variant="destructive"
        className="w-full gap-2"
        onClick={() => {
          void (async () => {
            await signOut();
            void navigate({ to: "/login" });
          })();
        }}
      >
        <LogOut className="h-4 w-4" /> Sign out
      </Button>
    </div>
  );
}

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <Card className="border-border/70 shadow-sm">
      <CardContent className="p-3 text-center">
        <div className="font-mono text-lg font-semibold tracking-tight text-foreground">{value}</div>
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      </CardContent>
    </Card>
  );
}

function SettingRow({
  icon: Icon,
  label,
  trailing,
  children,
}: {
  icon: LucideIcon;
  label: string;
  trailing?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 p-3.5">
      <Icon className="h-4 w-4 text-muted-foreground" />
      <span className="flex-1 text-sm text-foreground">{label}</span>
      {trailing ? <span className="text-xs text-muted-foreground">{trailing}</span> : null}
      {children}
    </div>
  );
}
