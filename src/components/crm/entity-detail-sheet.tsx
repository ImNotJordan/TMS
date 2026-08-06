import * as React from "react";

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import type { CrmActivityEntityType } from "@/lib/crm-store";
import { ActivityTimeline } from "./activity-timeline";

export function EntityDetailSheet({
  open,
  onOpenChange,
  title,
  subtitle,
  entityType,
  entityId,
  fields,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  subtitle?: string;
  entityType: CrmActivityEntityType;
  entityId: string;
  fields: { label: string; value: React.ReactNode }[];
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full gap-0 overflow-y-auto sm:max-w-xl">
        <SheetHeader className="border-b border-border/70 px-6 py-5">
          <SheetTitle>{title}</SheetTitle>
          {subtitle && <SheetDescription>{subtitle}</SheetDescription>}
        </SheetHeader>
        <div className="px-6 py-5">
          <div className="grid grid-cols-2 gap-3 rounded-lg border border-border/70 bg-muted/20 p-4">
            {fields.map((f) => (
              <div key={f.label} className="min-w-0">
                <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  {f.label}
                </div>
                <div className="mt-0.5 truncate text-sm text-foreground">{f.value ?? "—"}</div>
              </div>
            ))}
          </div>

          <div className="mt-6">
            <h3 className="mb-3 text-sm font-semibold text-foreground">Activity timeline</h3>
            <ActivityTimeline entityType={entityType} entityId={entityId} />
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
