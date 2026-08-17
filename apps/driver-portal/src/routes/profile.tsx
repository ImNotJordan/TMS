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
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
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

const DARK_MODE_KEY = "driver-portal.dark-mode";

function readDarkModePref(): boolean {
  if (document.documentElement.classList.contains("dark")) return true;
  try {
    return localStorage.getItem(DARK_MODE_KEY) === "1";
  } catch {
    return false;
  }
}

function writeDarkModePref(value: boolean) {
  try {
    localStorage.setItem(DARK_MODE_KEY, value ? "1" : "0");
  } catch {
    /* ignore quota */
  }
}

function ProfilePage() {
  useEffect(() => {
    document.title = "Profile — Titan Freight Driver";
  }, []);

  const { driver, signOut } = useAuth();
  const { locationSharing, setLocationSharing } = useLoads();
  const navigate = useNavigate();
  const [dark, setDark] = useState(readDarkModePref);
  const [notifications, setNotifications] = useState(true);
  const [permission, setPermission] = useState(() => getPushPermissionState());
  const [signOutOpen, setSignOutOpen] = useState(false);

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
        <Avatar className="h-16 w-16">
          <AvatarFallback className="bg-ink text-lg font-heading font-bold text-amber">
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
        <StatTile label="Years" value={driver.yearsWithCompany > 0 ? String(driver.yearsWithCompany) : "–"} />
        <StatTile label="Safety score" value={driver.safetyScore > 0 ? String(driver.safetyScore) : "–"} />
        <StatTile
          label="Total miles"
          value={driver.totalMiles > 0 ? `${Math.round(driver.totalMiles / 1000)}k` : "–"}
        />
      </div>
      <p className="-mt-1 text-center text-xs text-muted-foreground">
        Stats will populate after your first completed load
      </p>

      <Card className="border-border/70 shadow-none">
        <CardContent className="divide-y divide-border p-0">
          {!isStandaloneDisplay() ? (
            <div className="flex items-center gap-3 p-3.5">
              <Download className="h-4 w-4 text-muted-foreground" />
              <span className="flex-1 text-sm text-foreground">Install app on this device</span>
              <button
                type="button"
                className="text-xs font-semibold text-amber-dim hover:underline"
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
                Install
              </button>
            </div>
          ) : (
            <SettingRow icon={Download} label="Installed on this device" trailing="Home screen" />
          )}
          <SettingRow icon={Bell} label="Push notifications">
            <Switch
              checked={notifications}
              onCheckedChange={(v) => void onNotificationsChange(v)}
            />
          </SettingRow>
          <SettingRow icon={MapPin} label="Share location by default">
            <Switch checked={locationSharing} onCheckedChange={setLocationSharing} />
          </SettingRow>
          <SettingRow icon={Moon} label="Dark mode">
            <Switch
              checked={dark}
              onCheckedChange={(next) => {
                setDark(next);
                writeDarkModePref(next);
              }}
            />
          </SettingRow>
          <SettingRow icon={Globe} label="Language" trailing="English (US)" chevron />
        </CardContent>
      </Card>

      <Card className="border-border/70 shadow-none">
        <CardContent className="divide-y divide-border p-0">
          <a
            href={DISPATCH_APP_URL}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-3 p-3.5 transition-colors hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <ExternalLink className="h-4 w-4 text-muted-foreground" />
            <span className="flex-1 text-sm text-foreground">Open dispatcher console</span>
          </a>
          <SettingRow icon={HelpCircle} label="Help & support" chevron />
        </CardContent>
      </Card>

      <Button
        variant="ghost"
        className="w-full gap-2 bg-destructive/10 text-destructive hover:bg-destructive/15 hover:text-destructive"
        onClick={() => setSignOutOpen(true)}
      >
        <LogOut className="h-4 w-4" /> Sign out
      </Button>

      <Dialog open={signOutOpen} onOpenChange={setSignOutOpen}>
        <DialogContent showCloseButton={false} className="rounded-2xl shadow-none sm:rounded-2xl">
          <div className="flex flex-col items-center gap-3 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-red-500/12 text-red-600 dark:text-red-400">
              <LogOut className="h-5 w-5" />
            </div>
            <div className="space-y-1.5">
              <DialogTitle>Sign out?</DialogTitle>
              <DialogDescription>
                You'll need to sign back in to see your loads and share your location with dispatch.
              </DialogDescription>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <Button className="w-full" onClick={() => setSignOutOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="ghost"
              className="w-full gap-1.5 text-destructive hover:text-destructive"
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
        </DialogContent>
      </Dialog>
    </div>
  );
}

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <Card className="border-border/70 shadow-none">
      <CardContent className="p-3 text-center">
        <div className="font-mono text-lg font-semibold tracking-tight text-foreground">{value}</div>
        <div className="text-[10px] text-muted-foreground">{label}</div>
      </CardContent>
    </Card>
  );
}

function SettingRow({
  icon: Icon,
  label,
  trailing,
  chevron,
  children,
}: {
  icon: LucideIcon;
  label: string;
  trailing?: string;
  chevron?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 p-3.5">
      <Icon className="h-4 w-4 text-muted-foreground" />
      <span className="flex-1 text-sm text-foreground">{label}</span>
      {trailing ? <span className="text-xs text-muted-foreground">{trailing}</span> : null}
      {children}
      {chevron ? <ChevronRight className="h-4 w-4 text-muted-foreground" /> : null}
    </div>
  );
}
