import { Link } from "@tanstack/react-router";
import { ArrowUpRight, Database } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { AnalyticsEvent } from "@/lib/analytics-events";
import { t } from "@/lib/i18n/t";

export function DrillThroughSheet({
  open,
  onOpenChange,
  title,
  description,
  events,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  events: AnalyticsEvent[];
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col gap-0 overflow-hidden sm:max-w-xl">
        <SheetHeader className="shrink-0 border-b border-border/70 pb-4 text-left">
          <SheetTitle className="pr-8">{title}</SheetTitle>
          <SheetDescription className="flex flex-wrap items-center gap-2">
            <span>{description ?? "Contributing events from analytics event tables."}</span>
            <Badge variant="secondary" className="gap-1 font-normal">
              <Database className="h-3 w-3" />
              {events.length} event{events.length === 1 ? "" : "s"}
            </Badge>
          </SheetDescription>
        </SheetHeader>

        <div className="min-h-0 flex-1 overflow-y-auto py-4">
          {events.length === 0 ? (
            <div className="flex h-40 items-center justify-center rounded-lg border border-dashed border-border text-sm text-muted-foreground">
              {t("No contributing events in this period.")}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("Event")}</TableHead>
                  <TableHead>{t("When")}</TableHead>
                  <TableHead className="text-right">{t("Record")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {events.slice(0, 80).map((event) => {
                  const primary = event.links[0];
                  return (
                    <TableRow key={event.id}>
                      <TableCell className="max-w-[180px]">
                        <div className="truncate font-medium text-foreground">{event.label}</div>
                        <div className="truncate text-[11px] text-muted-foreground">
                          {event.type}
                          {event.source === "synthetic" ? " · filled" : ""}
                        </div>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                        {new Date(event.at).toLocaleString(undefined, {
                          month: "short",
                          day: "numeric",
                          hour: "numeric",
                          minute: "2-digit",
                        })}
                      </TableCell>
                      <TableCell className="text-right">
                        {primary ? (
                          <Button asChild size="sm" variant="ghost" className="h-8 gap-1 px-2">
                            <Link to={primary.href}>
                              {t("Open")}
                              <ArrowUpRight className="h-3.5 w-3.5" />
                            </Link>
                          </Button>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
