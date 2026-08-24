import { Link } from "@tanstack/react-router";
import { Mail, MessageSquare, MessagesSquare, Phone, Plug } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { integrationStatusBadgeClass } from "@/features/integrations";

import { type ChannelAvailability, useChannelAvailability } from "./hooks/useChannelAvailability";
import { CHANNEL_LABELS } from "./lib/formatters";
import type { ChannelId } from "./types";
import { t } from "@/lib/i18n/t";

const ICONS: Record<ChannelId, typeof Mail> = {
  email: Mail,
  sms: MessageSquare,
  voice: Phone,
  chat: MessagesSquare,
};

function isStale(lastSyncAt: string | null, channel: ChannelId): boolean {
  if (channel === "chat") return false;
  if (!lastSyncAt) return true;
  const age = Date.now() - new Date(lastSyncAt).getTime();
  return Number.isFinite(age) && age > 24 * 60 * 60 * 1000;
}

export function ChannelHealthStrip() {
  const { channels, isLoading } = useChannelAvailability();

  if (isLoading) {
    return (
      <Card className="border-border/70 shadow-sm">
        <CardContent className="flex flex-wrap gap-2 p-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="h-10 w-44 animate-pulse rounded-lg border border-border/70 bg-muted/40"
            />
          ))}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-border/70 shadow-sm">
      <CardContent className="p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-sm font-semibold text-foreground">{t("Channel health")}</p>
            <p className="text-xs text-muted-foreground">
              {t("Connection status and last sync for each outbound channel")}
            </p>
          </div>
          <Button variant="outline" size="sm" className="h-8 gap-1.5" asChild>
            <Link to="/settings" search={{ category: "integrations" } as never}>
              <Plug className="h-3.5 w-3.5" />
              {t("Integrations")}
            </Link>
          </Button>
        </div>
        <div
          className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4"
          role="list"
          aria-label={t("Channel health")}
        >
          {channels.map((ch) => (
            <ChannelChip key={ch.channel} availability={ch} />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function ChannelChip({ availability }: { availability: ChannelAvailability }) {
  const Icon = ICONS[availability.channel];
  const stale = isStale(availability.lastSyncAt, availability.channel);
  const disconnected = !availability.available;

  const body = (
    <div
      className={cn(
        "flex h-full items-start gap-3 rounded-lg border border-border/70 bg-muted/20 px-3 py-2.5 transition-colors",
        disconnected && "hover:border-primary/40 hover:bg-muted/40",
        !disconnected && "bg-card",
      )}
      role="listitem"
    >
      <span
        className={cn(
          "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md",
          disconnected ? "bg-muted text-muted-foreground" : "bg-info/15 text-info",
        )}
      >
        <Icon className="h-3.5 w-3.5" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-sm font-medium text-foreground">
            {CHANNEL_LABELS[availability.channel]}
          </span>
          <Badge
            variant="outline"
            className={cn(
              "h-5 px-1.5 text-[10px]",
              integrationStatusBadgeClass(availability.connectionLabel),
              stale &&
                availability.available &&
                "border-warning/25 bg-warning/20 text-warning-foreground",
            )}
          >
            {stale && availability.available
              ? `Last sync ${availability.lastSyncLabel}`
              : availability.connectionLabel}
          </Badge>
        </div>
        <p
          className="mt-0.5 truncate text-[11px] text-muted-foreground"
          title={availability.reason}
        >
          {disconnected
            ? (availability.reason ?? "Connect in Settings → Integrations")
            : `Last sync: ${availability.lastSyncLabel}`}
        </p>
      </div>
    </div>
  );

  if (disconnected) {
    return (
      <Link
        to="/settings"
        search={{ category: "integrations" } as never}
        hash={`integration-${availability.integrationId ?? ""}`}
        title={availability.reason}
        className="block cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-lg"
      >
        {body}
      </Link>
    );
  }

  return body;
}
