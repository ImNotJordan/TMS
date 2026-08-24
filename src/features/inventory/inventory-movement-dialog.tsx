import * as React from "react";
import { ArrowRight, Loader2, MoveRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  INVENTORY_MOVEMENT_DESCRIPTIONS,
  INVENTORY_MOVEMENT_KINDS,
  applyMovement,
  availableQuantity,
  type InventoryItemRecord,
  type InventoryMovementKind,
} from "@/lib/inventory-domain";
import { movementLabel, signedUnits } from "@/features/inventory/inventory-format";
import { useFormat } from "@/lib/i18n/locale-context";
import { MovementKindBadge, NoticeStrip } from "@/features/inventory/inventory-ui";
import type { MovementFormState } from "@/features/inventory/inventory-forms";
import { t } from "@/lib/i18n/t";

/** The two kinds where "why" is the whole point of the record. */
const REASON_REQUIRED: ReadonlySet<InventoryMovementKind> = new Set<InventoryMovementKind>([
  "adjustment",
  "count",
]);

const QUANTITY_LABEL: Record<InventoryMovementKind, string> = {
  receipt: "Units received",
  shipment: "Units shipped",
  adjustment: "Signed adjustment (negative to write off)",
  count: "Counted total on hand",
  allocate: "Units to commit",
  release: "Units to release",
};

const REASON_PLACEHOLDER: Record<InventoryMovementKind, string> = {
  receipt: "Inbound PO, return, transfer in…",
  shipment: "Outbound load, customer order…",
  adjustment: "Damage in rack 12, shrink, correcting a mis-keyed receipt…",
  count: "Quarterly cycle count, spot check…",
  allocate: "Committed to a booked load",
  release: "Load cancelled, customer deferred",
};

export function InventoryMovementDialog({
  open,
  onOpenChange,
  item,
  form,
  setForm,
  allowedKinds,
  disabledKindReason,
  saving,
  error,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item: InventoryItemRecord | null;
  form: MovementFormState;
  setForm: React.Dispatch<React.SetStateAction<MovementFormState>>;
  /** Kinds this user's role may post. The rest are shown disabled with a reason. */
  allowedKinds: ReadonlySet<InventoryMovementKind>;
  disabledKindReason: (kind: InventoryMovementKind) => string | null;
  saving: boolean;
  error: string | null;
  onSubmit: () => void;
}) {
  const format = useFormat();
  const set = <K extends keyof MovementFormState>(key: K, value: MovementFormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const current = React.useMemo(
    () => ({
      quantityOnHand: item?.quantityOnHand ?? 0,
      quantityAllocated: item?.quantityAllocated ?? 0,
    }),
    [item?.quantityAllocated, item?.quantityOnHand],
  );

  const parsedQuantity = form.quantity.trim() === "" ? Number.NaN : Number(form.quantity);

  /**
   * Preview from `applyMovement` — the *same* function the server authorizes
   * with. Re-deriving the arithmetic here would let the dialog promise an
   * outcome the API then refuses.
   */
  const effect = React.useMemo(() => {
    if (!Number.isFinite(parsedQuantity)) return null;
    return applyMovement(current, { kind: form.kind, quantity: parsedQuantity });
  }, [current, form.kind, parsedQuantity]);

  const reasonMissing = REASON_REQUIRED.has(form.kind) && !form.reason.trim();
  const kindDenied = !allowedKinds.has(form.kind);
  const blocked =
    saving ||
    kindDenied ||
    reasonMissing ||
    !effect ||
    !effect.ok ||
    !Number.isFinite(parsedQuantity);

  const kindReason = disabledKindReason(form.kind);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MoveRight className="h-4 w-4 text-primary" />
            {t("Record stock movement")}
          </DialogTitle>
          <DialogDescription>
            {item
              ? `${item.sku} · ${item.name} · ${item.warehouse || "Unassigned"}`
              : "Select an item first."}
          </DialogDescription>
        </DialogHeader>

        {error ? <NoticeStrip tone="danger">{error}</NoticeStrip> : null}

        {item ? (
          <div className="grid grid-cols-3 gap-2 rounded-lg border border-border/70 bg-muted/20 p-3">
            <Stat label={t("On hand")} value={format.number(item.quantityOnHand)} />
            <Stat label={t("Allocated")} value={format.number(item.quantityAllocated)} />
            <Stat label={t("Available")} value={format.number(availableQuantity(item))} />
          </div>
        ) : null}

        <div className="space-y-4">
          <div>
            <Label className="text-xs font-medium text-muted-foreground">
              {t("Movement type")}
            </Label>
            <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
              {INVENTORY_MOVEMENT_KINDS.map((kind) => {
                const allowed = allowedKinds.has(kind);
                const selected = form.kind === kind;
                return (
                  <button
                    key={kind}
                    type="button"
                    disabled={!allowed}
                    onClick={() => set("kind", kind)}
                    title={allowed ? undefined : (disabledKindReason(kind) ?? undefined)}
                    className={cn(
                      "rounded-lg border px-3 py-2 text-left text-sm transition-colors",
                      selected
                        ? "border-primary bg-primary/10 text-foreground"
                        : "border-border/70 hover:bg-accent",
                      !allowed && "cursor-not-allowed opacity-50 hover:bg-transparent",
                    )}
                  >
                    <span className="font-medium">{movementLabel(kind)}</span>
                  </button>
                );
              })}
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              {INVENTORY_MOVEMENT_DESCRIPTIONS[form.kind]}
            </p>
          </div>

          {kindDenied && kindReason ? <NoticeStrip tone="warning">{kindReason}</NoticeStrip> : null}

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="mv-quantity" className="text-xs font-medium text-muted-foreground">
                {QUANTITY_LABEL[form.kind]}
              </Label>
              <Input
                id="mv-quantity"
                className="mt-1.5"
                type="number"
                step="any"
                inputMode="decimal"
                value={form.quantity}
                onChange={(event) => set("quantity", event.target.value)}
                placeholder={form.kind === "adjustment" ? "-4" : "24"}
                autoFocus
              />
            </div>
            <div>
              <Label htmlFor="mv-reference" className="text-xs font-medium text-muted-foreground">
                {t("Reference")}
              </Label>
              <Input
                id="mv-reference"
                className="mt-1.5"
                value={form.reference}
                onChange={(event) => set("reference", event.target.value)}
                placeholder={t("Load L-2841 · BOL 55210 · PO 8842")}
              />
            </div>
          </div>

          <div>
            <Label htmlFor="mv-reason" className="text-xs font-medium text-muted-foreground">
              Reason {REASON_REQUIRED.has(form.kind) ? "*" : ""}
            </Label>
            <Input
              id="mv-reason"
              className="mt-1.5"
              value={form.reason}
              onChange={(event) => set("reason", event.target.value)}
              placeholder={REASON_PLACEHOLDER[form.kind]}
              aria-invalid={reasonMissing}
            />
            {reasonMissing ? (
              <p className="mt-1 text-[11px] text-destructive">
                An {form.kind === "count" ? "unexplained count" : "unexplained write-off"} is the
                one ledger row nobody can reconcile later. Say why.
              </p>
            ) : null}
          </div>

          <div>
            <Label htmlFor="mv-notes" className="text-xs font-medium text-muted-foreground">
              {t("Notes")}
            </Label>
            <Textarea
              id="mv-notes"
              className="mt-1.5"
              rows={2}
              value={form.notes}
              onChange={(event) => set("notes", event.target.value)}
            />
          </div>

          {/* Preview. Shown as soon as a quantity is typed, refusals included —
              the refusal is the useful half. */}
          {effect ? (
            effect.ok ? (
              <div className="rounded-lg border border-border/70 bg-card p-3">
                <div className="flex items-center justify-between gap-3">
                  <MovementKindBadge kind={form.kind} />
                  <span className="text-xs text-muted-foreground">
                    {signedUnits(format, effect.onHandDelta)} on hand ·{" "}
                    {signedUnits(format, effect.allocatedDelta)} allocated
                  </span>
                </div>
                <div className="mt-3 flex items-center gap-3 text-sm">
                  <PreviewLevel
                    label={t("On hand")}
                    from={current.quantityOnHand}
                    to={effect.next.quantityOnHand}
                  />
                  <PreviewLevel
                    label={t("Allocated")}
                    from={current.quantityAllocated}
                    to={effect.next.quantityAllocated}
                  />
                  <PreviewLevel
                    label={t("Available")}
                    from={current.quantityOnHand - current.quantityAllocated}
                    to={effect.next.quantityOnHand - effect.next.quantityAllocated}
                  />
                </div>
              </div>
            ) : (
              <NoticeStrip tone="danger">{effect.message}</NoticeStrip>
            )
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            {t("Cancel")}
          </Button>
          <Button onClick={onSubmit} disabled={blocked}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Post {movementLabel(form.kind).toLowerCase()}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="mt-0.5 truncate text-base font-semibold tracking-tight">{value}</p>
    </div>
  );
}

function PreviewLevel({ label, from, to }: { label: string; from: number; to: number }) {
  const format = useFormat();
  const changed = from !== to;
  return (
    <div className="min-w-0 flex-1">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="mt-0.5 flex items-center gap-1.5 truncate font-medium">
        <span className={cn(changed && "text-muted-foreground")}>{format.number(from)}</span>
        {changed ? (
          <>
            <ArrowRight className="h-3 w-3 shrink-0 text-muted-foreground" />
            <span className="text-foreground">{format.number(to)}</span>
          </>
        ) : null}
      </p>
    </div>
  );
}
