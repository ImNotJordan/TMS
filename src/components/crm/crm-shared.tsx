import * as React from "react";
import { cn } from "@/lib/utils";
import { Label } from "@/components/ui/label";
import type { CrmLeadStage } from "@/lib/crm-store";
import type { Tone } from "@/lib/loads-display";

export function generateCrmId(prefix: string) {
  const n = Math.floor(1000 + Math.random() * 8999);
  return `${prefix}-${n}`;
}

export function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("rounded-xl border border-border/70 bg-card/60 p-5 shadow-sm", className)}>
      {children}
    </div>
  );
}

export function SectionTitle({
  title,
  hint,
  icon: Icon,
}: {
  title: string;
  hint?: string;
  icon?: React.ComponentType<{ className?: string }>;
}) {
  return (
    <div className="mb-3 flex items-center gap-2">
      {Icon && (
        <span className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/10 text-primary">
          <Icon className="h-3.5 w-3.5" />
        </span>
      )}
      <div className="min-w-0">
        <div className="text-sm font-semibold tracking-tight text-foreground">{title}</div>
        {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
      </div>
    </div>
  );
}

export function FieldShell({
  label,
  required,
  hint,
  error,
  children,
  className,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  error?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <div className="flex items-center justify-between gap-2">
        <Label className="text-xs font-medium text-foreground">
          {label}
          {required && <span className="ml-1 text-destructive">*</span>}
        </Label>
        {hint && <span className="text-[10px] text-muted-foreground">{hint}</span>}
      </div>
      {children}
      {error && <div className="text-[11px] font-medium text-destructive">This field is required.</div>}
    </div>
  );
}

export function GridSection({
  cols = 2,
  children,
  className,
}: {
  cols?: 1 | 2 | 3 | 4;
  children: React.ReactNode;
  className?: string;
}) {
  const map = {
    1: "grid-cols-1",
    2: "sm:grid-cols-2",
    3: "sm:grid-cols-2 lg:grid-cols-3",
    4: "sm:grid-cols-2 lg:grid-cols-4",
  };
  return <div className={cn("grid gap-4", map[cols], className)}>{children}</div>;
}

export const CRM_STAGE_TONE: Record<CrmLeadStage, Tone> = {
  Prospect: "info",
  Quoted: "warning",
  Won: "success",
  Lost: "default",
};

export const CRM_STAGE_BADGE_CLASS: Record<Tone, string> = {
  default: "bg-muted text-foreground border-border/60",
  success: "bg-success/15 text-success border-success/30",
  warning: "bg-warning/20 text-warning-foreground border-warning/30",
  info: "bg-info/15 text-info border-info/30",
  destructive: "bg-destructive/15 text-destructive border-destructive/30",
};

export function formatCurrency(value: number | undefined | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return value.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

export function formatTimestamp(iso: string | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}
