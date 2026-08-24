/**
 * Enter a hand-computed tax figure for one load.
 *
 * ## Why this records rather than replaces
 *
 * The estimate stays on screen next to whatever is typed here, and the variance
 * between them is shown. That is deliberate: a manual figure is a *decision*
 * about the calculation, not a substitute for it. Keeping both visible means a
 * ¥900 entry against a ¥185 estimate reads as "someone chose to ignore the input
 * credit" — a question worth asking — rather than silently becoming the truth.
 *
 * ## Why source and note are prominent
 *
 * A number with no provenance is worthless three months later when an accountant
 * asks where it came from. The whole point of doing this manually is that a
 * person looked something up; recording *what* they looked up is what makes the
 * figure defensible. `source` is prefilled with the calculators from the docs so
 * it is faster to record than to skip.
 */
import * as React from "react";
import { Calculator, ExternalLink, Loader2 } from "lucide-react";

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
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { t } from "@/lib/i18n/t";
import { useFormat } from "@/lib/i18n/locale-context";
import type { TaxEstimate } from "@/lib/tax/tax-domain";
import { useTaxOverrideAccess } from "@/features/tax/use-load-tax";

export type TaxOverrideDraft = {
  amount: string;
  currency: string;
  source: string;
  note: string;
};

/**
 * Where a person actually goes to work the number out.
 *
 * In the dialog rather than only in docs: the moment someone needs a calculator
 * is the moment they have this open, and a link they have to go hunting for is a
 * link they do not use.
 */
const CALCULATORS: { label: string; url: string; forRegime: "china-vat" | "us-no-vat" | "any" }[] =
  [
    {
      label: "Avalara — US sales tax rate by address",
      url: "https://www.avalara.com/us/en/taxrates/calculator.html",
      forRegime: "us-no-vat",
    },
    {
      label: "TaxJar sales tax calculator (second opinion)",
      url: "https://www.taxjar.com/sales-tax-calculator",
      forRegime: "us-no-vat",
    },
    {
      label: "IFTA fuel tax calculator (per-state miles)",
      url: "https://iftacalculators.com/",
      forRegime: "us-no-vat",
    },
    {
      label: "IFTA, Inc. official quarterly rate matrix",
      url: "https://www.iftach.org/taxmatrix4/",
      forRegime: "us-no-vat",
    },
    {
      label: "China VAT calculator — 含税 / 不含税",
      url: "https://vatcalcul.com/china-vat-calculator/",
      forRegime: "china-vat",
    },
    {
      label: "增值税计算器 (价税分离)",
      url: "https://smart-calculators.net/zh-CN/tools/vat-calculator",
      forRegime: "china-vat",
    },
    {
      label: "国家税务总局 — 全国增值税发票查验平台",
      url: "https://inv-veri.chinatax.gov.cn/",
      forRegime: "china-vat",
    },
  ];

export function TaxOverrideDialog({
  open,
  onOpenChange,
  estimate,
  draft,
  setDraft,
  saving,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  estimate: TaxEstimate;
  draft: TaxOverrideDraft;
  setDraft: React.Dispatch<React.SetStateAction<TaxOverrideDraft>>;
  saving: boolean;
  onSubmit: () => void;
}) {
  const format = useFormat();
  // Resolved here rather than by the caller: this component only mounts when the
  // dialog opens, so the auth context it needs is not required to render the
  // panel behind it.
  const { canSetTax: canEdit, denyReason } = useTaxOverrideAccess();
  const set = <K extends keyof TaxOverrideDraft>(key: K, value: TaxOverrideDraft[K]) =>
    setDraft((prev) => ({ ...prev, [key]: value }));

  const currency = draft.currency || (estimate.currency === "UNKNOWN" ? "USD" : estimate.currency);
  const entered = draft.amount.trim() === "" ? null : Number(draft.amount);
  const enteredValid = entered !== null && Number.isFinite(entered) && entered >= 0;
  const variance = enteredValid ? entered - estimate.totalTaxCost : null;

  const relevant = CALCULATORS.filter(
    (calculator) => calculator.forRegime === "any" || calculator.forRegime === estimate.regime,
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Calculator className="h-4 w-4 text-primary" />
            {t("Enter tax manually")}
          </DialogTitle>
          <DialogDescription>
            {t(
              "Records a figure you worked out yourself. The estimate stays visible alongside it, and this is what flows onto the invoice.",
            )}
          </DialogDescription>
        </DialogHeader>

        {!canEdit && denyReason ? (
          <div className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2.5">
            <p className="text-xs leading-relaxed text-warning-foreground">{denyReason}</p>
          </div>
        ) : null}

        <div className="space-y-4">
          {/* What the estimator says, so the two are compared rather than swapped. */}
          <div className="rounded-lg border border-border/70 bg-muted/20 p-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              {t("Built-in estimate")}
            </p>
            <p className="mt-1 text-lg font-semibold tabular-nums">
              {estimate.currency === "UNKNOWN"
                ? "—"
                : format.currencyPrecise(estimate.totalTaxCost, estimate.currency)}
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-[1fr_120px]">
            <div>
              <Label htmlFor="tax-amount" className="text-xs font-medium text-muted-foreground">
                {t("Tax amount")}
              </Label>
              <Input
                id="tax-amount"
                className="mt-1.5"
                type="number"
                min={0}
                step="0.01"
                inputMode="decimal"
                value={draft.amount}
                onChange={(event) => set("amount", event.target.value)}
                placeholder="0.00"
                disabled={!canEdit}
                autoFocus
              />
              <p className="mt-1 text-[11px] text-muted-foreground">
                {t("Leave blank to go back to using the estimate.")}
              </p>
            </div>
            <div>
              <Label htmlFor="tax-currency" className="text-xs font-medium text-muted-foreground">
                {t("Currency")}
              </Label>
              <Select
                value={currency}
                onValueChange={(value) => set("currency", value)}
                disabled={!canEdit}
              >
                <SelectTrigger id="tax-currency" className="mt-1.5">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {["USD", "CNY", "CAD", "MXN"].map((code) => (
                    <SelectItem key={code} value={code}>
                      {code}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* The variance is the point of showing both. A large gap is a prompt,
              not an error — but it should never pass unnoticed. */}
          {variance !== null && Math.abs(variance) > 0.01 ? (
            <div
              className={cn(
                "rounded-lg border px-3 py-2.5 text-xs leading-relaxed",
                Math.abs(variance) > Math.max(1, estimate.totalTaxCost * 0.25)
                  ? "border-warning/30 bg-warning/10 text-warning-foreground"
                  : "border-border/70 bg-muted/20 text-muted-foreground",
              )}
            >
              {variance > 0 ? t("Higher than the estimate by") : t("Lower than the estimate by")}{" "}
              <span className="font-semibold tabular-nums">
                {format.currencyPrecise(Math.abs(variance), currency)}
              </span>
              {". "}
              {t("Worth a note below saying why, for whoever reads this later.")}
            </div>
          ) : null}

          <div>
            <Label htmlFor="tax-source" className="text-xs font-medium text-muted-foreground">
              {t("Where the figure came from")}
            </Label>
            <Input
              id="tax-source"
              className="mt-1.5"
              value={draft.source}
              onChange={(event) => set("source", event.target.value)}
              placeholder={t("e.g. Avalara rate lookup, 75201 → 30303")}
              disabled={!canEdit}
            />
          </div>

          <div>
            <Label htmlFor="tax-note" className="text-xs font-medium text-muted-foreground">
              {t("Note")}
            </Label>
            <Textarea
              id="tax-note"
              className="mt-1.5"
              rows={2}
              value={draft.note}
              onChange={(event) => set("note", event.target.value)}
              placeholder={t("Why this differs from the estimate, if it does.")}
              disabled={!canEdit}
            />
          </div>

          {relevant.length > 0 ? (
            <>
              <Separator />
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {t("Work it out")}
                </p>
                <div className="mt-1.5 space-y-1">
                  {relevant.map((calculator) => (
                    <a
                      key={calculator.url}
                      href={calculator.url}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="flex items-center gap-1.5 text-xs font-medium text-primary underline-offset-4 hover:underline"
                    >
                      <ExternalLink className="h-3 w-3 shrink-0" />
                      {calculator.label}
                    </a>
                  ))}
                </div>
              </div>
            </>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            {t("Cancel")}
          </Button>
          <Button
            onClick={onSubmit}
            disabled={saving || !canEdit || (draft.amount.trim() !== "" && !enteredValid)}
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {t("Save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
