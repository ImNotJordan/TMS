/**
 * Per-load tax estimate.
 *
 * Two things this panel does that a plain figure would not:
 *
 * 1. **It never shows a number without its provenance.** Confidence and caveats
 *    sit next to the amount, not behind a tooltip. A tax figure travels — into a
 *    quote, into a margin conversation, occasionally into an argument with a
 *    customer — and it should carry its own qualifications when it does.
 *
 * 2. **It separates collected tax from borne tax.** Output VAT is the customer's
 *    money passing through; fuel tax is yours. Summing them into "tax" is how a
 *    pricing screen ends up overstating cost by the whole VAT line.
 */
import * as React from "react";
import {
  AlertTriangle,
  ArrowRight,
  BadgeCheck,
  Building2,
  Calculator,
  SlidersHorizontal,
  Loader2,
  ChevronDown,
  ChevronUp,
  HelpCircle,
  Receipt,
  ShieldQuestion,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { t } from "@/lib/i18n/t";
import { useFormat } from "@/lib/i18n/locale-context";
import { effectiveTaxRate, type TaxConfidence, type TaxEstimate } from "@/lib/tax/tax-domain";
import { providerWouldHelp } from "@/lib/tax/tax-providers";
import type { ProviderComparison, TaxEstimateResponse, TaxSource } from "@/lib/tax/tax-client";

const CONFIDENCE_META: Record<
  TaxConfidence,
  { label: string; tone: string; icon: typeof BadgeCheck; blurb: string }
> = {
  statutory: {
    label: "Statutory",
    tone: "border-success/40 bg-success/15 text-success",
    icon: BadgeCheck,
    blurb:
      "Computed from a statutory rate with determinable arithmetic. Still an estimate, not a filing.",
  },
  estimated: {
    label: "Estimated",
    tone: "border-warning/40 bg-warning/15 text-warning-foreground",
    icon: AlertTriangle,
    blurb: "The rule is settled but some inputs are inferred. Good for pricing, not for filing.",
  },
  indeterminate: {
    label: "Needs review",
    tone: "border-destructive/30 bg-destructive/10 text-destructive",
    icon: ShieldQuestion,
    blurb:
      "This lane needs data or law the built-in estimator does not carry. Treat the figure as incomplete.",
  },
};

export function LoadTaxPanel({
  estimate,
  grossRevenue,
  className,
  source = "internal",
  provider,
  providerError,
  agreement = "not-checked",
  fuelRatesLive = false,
  fuelRateQuarter,
  resolving = false,
  manualAmount,
  manualCurrency,
  manualSource,
  manualNote,
  onEditManual,
}: {
  estimate: TaxEstimate;
  /** Gross billed to the customer, for the effective-rate readout. */
  grossRevenue: number;
  className?: string;
  /**
   * Provenance. All optional and defaulted, so a caller holding only the local
   * estimate still renders — and still labels the figure honestly as built-in.
   */
  source?: TaxSource;
  provider?: TaxEstimateResponse["provider"];
  providerError?: string;
  agreement?: ProviderComparison;
  fuelRatesLive?: boolean;
  fuelRateQuarter?: string;
  resolving?: boolean;
  /**
   * A hand-entered figure. When present it leads, because it is what will be
   * invoiced — but the estimate stays rendered beside it so the two are compared
   * rather than one silently replacing the other.
   */
  manualAmount?: number | null;
  manualCurrency?: string;
  manualSource?: string;
  manualNote?: string;
  /** Absent hides the affordance entirely — read-only surfaces pass nothing. */
  onEditManual?: () => void;
}) {
  const format = useFormat();
  const [showNotes, setShowNotes] = React.useState(false);

  const confidence = CONFIDENCE_META[estimate.confidence];
  const ConfidenceIcon = confidence.icon;
  const rate = effectiveTaxRate(estimate, grossRevenue);
  const hasManual = typeof manualAmount === "number" && Number.isFinite(manualAmount);
  /**
   * Reported by the estimator, not inferred here.
   *
   * This began as a scan of line labels for the word "manual", which silently
   * missed the China VAT override — that path changes the rate but leaves the
   * line label untouched, so the badge went dark on the one case where the
   * number moved most. The estimator knows what it applied; it says so.
   */
  const usesManualRates = estimate.usesManualRates;
  const manualVariance = hasManual ? (manualAmount as number) - estimate.totalTaxCost : null;
  const providerHint = providerWouldHelp(estimate.regime, estimate.confidence);

  // The estimator reports amounts in the jurisdiction's own currency and does no
  // conversion, so the panel must render them in that currency rather than in
  // the workspace default — a CNY figure shown with a dollar sign is worse than
  // no figure.
  const money = (value: number) =>
    estimate.currency === "UNKNOWN" ? "—" : format.currencyPrecise(value, estimate.currency);

  if (estimate.regime === "unsupported") {
    return (
      <Card className={cn("border-border/70 shadow-sm", className)}>
        <CardHeader className="pb-3">
          <div className="flex items-start gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
              <Receipt className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <CardTitle className="text-base">{t("Tax estimate")}</CardTitle>
              <CardDescription className="mt-0.5">
                {t("Not available for this lane")}
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {estimate.notes.map((entry) => (
            <p key={entry.text} className="text-sm text-muted-foreground">
              {t(entry.text)}
              {entry.detail ? <span className="ml-1">{entry.detail}</span> : null}
            </p>
          ))}
        </CardContent>
      </Card>
    );
  }

  const isVat = estimate.regime === "china-vat";

  return (
    /*
      Its own TooltipProvider rather than relying on the one inside
      SidebarProvider. Radix throws outright when a Tooltip has no provider
      above it, and depending on an ancestor from an unrelated component means
      the panel breaks the first time it is rendered somewhere without a sidebar
      — a print view, a standalone dialog, a test. Nested providers are supported
      and cost nothing.
    */
    <TooltipProvider delayDuration={0}>
      <Card className={cn("min-w-0 border-border/70 shadow-sm", className)}>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="flex min-w-0 items-start gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Receipt className="h-4 w-4" />
              </span>
              <div className="min-w-0">
                <CardTitle className="text-base">{t("Tax estimate")}</CardTitle>
                <CardDescription className="mt-0.5">
                  {isVat
                    ? t("China VAT — output tax net of input credit")
                    : t("United States — no VAT; fuel tax is the per-load cost")}
                </CardDescription>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              {estimate.crossBorder ? (
                <Badge
                  variant="outline"
                  className="border-info/40 bg-info/15 font-normal text-info"
                >
                  {t("Cross-border")}
                </Badge>
              ) : estimate.regime === "us-no-vat" ? (
                <Badge variant="outline" className="font-normal">
                  {estimate.intrastate ? t("Intrastate") : t("Interstate")}
                </Badge>
              ) : null}

              {hasManual ? (
                <Badge
                  variant="outline"
                  className="gap-1 border-primary/30 bg-primary/10 font-medium text-primary"
                >
                  <Calculator className="h-3 w-3" />
                  {t("Manual")}
                </Badge>
              ) : null}

              {/* Distinct from "Manual" above: that badge means a figure was
                  typed for *this* load, this one means a rate configured in
                  Settings shaped the calculation. Both can be true, and
                  conflating them would hide which number came from where. */}
              {usesManualRates ? (
                <Badge variant="outline" className="gap-1 font-normal">
                  <SlidersHorizontal className="h-3 w-3" />
                  {t("Settings rate")}
                </Badge>
              ) : null}

              {/* Where the figure came from. Always shown, because "no provider
                  configured" and "provider says zero" are different facts. */}
              <Badge variant="outline" className="gap-1 font-normal">
                {source === "avalara" ? (
                  <>
                    <Building2 className="h-3 w-3" />
                    {t("AvaTax")}
                  </>
                ) : (
                  <>
                    <Calculator className="h-3 w-3" />
                    {t("Built-in")}
                  </>
                )}
              </Badge>
              {resolving ? (
                <Badge variant="outline" className="gap-1 font-normal text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  {t("Checking")}
                </Badge>
              ) : null}

              <Tooltip>
                <TooltipTrigger asChild>
                  <Badge
                    variant="outline"
                    className={cn("cursor-default gap-1 font-medium", confidence.tone)}
                  >
                    <ConfidenceIcon className="h-3 w-3" />
                    {t(confidence.label)}
                  </Badge>
                </TooltipTrigger>
                <TooltipContent side="left">
                  <p className="max-w-[260px] text-xs">{t(confidence.blurb)}</p>
                </TooltipContent>
              </Tooltip>
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          {/* Headline: what this movement actually costs in tax. */}
          <div className="rounded-lg border border-border/70 bg-muted/20 p-3">
            <div className="flex flex-wrap items-end justify-between gap-2">
              <div className="min-w-0">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {hasManual ? t("Tax entered manually") : t("Tax you bear on this load")}
                </p>
                <p className="mt-1 truncate text-2xl font-semibold leading-none tracking-tight tabular-nums">
                  {hasManual
                    ? format.currencyPrecise(
                        manualAmount as number,
                        manualCurrency || estimate.currency,
                      )
                    : money(estimate.totalTaxCost)}
                </p>
                {/* The estimate never disappears — a manual figure is a decision
                    about the calculation, not a replacement for it. */}
                {hasManual ? (
                  <p className="mt-1 text-xs text-muted-foreground tabular-nums">
                    {t("Estimate")} {money(estimate.totalTaxCost)}
                    {manualVariance !== null && Math.abs(manualVariance) > 0.01
                      ? ` · ${manualVariance > 0 ? "+" : "−"}${format.currencyPrecise(
                          Math.abs(manualVariance),
                          manualCurrency || estimate.currency,
                        )}`
                      : ""}
                  </p>
                ) : null}
              </div>
              {rate !== null ? (
                <div className="text-right">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {t("Effective rate")}
                  </p>
                  <p className="mt-1 text-sm font-medium tabular-nums">{format.percent(rate, 2)}</p>
                </div>
              ) : null}
            </div>

            {isVat ? (
              // The whole point of the VAT model, stated as arithmetic the reader
              // can follow: charged − credited = paid.
              <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                <span className="tabular-nums">
                  {t("Output")} {money(estimate.outputTax)}
                </span>
                <span aria-hidden>−</span>
                <span className="tabular-nums">
                  {t("Credit")} {money(estimate.inputCredit)}
                </span>
                <ArrowRight className="h-3 w-3 shrink-0" aria-hidden />
                <span className="font-medium text-foreground tabular-nums">
                  {t("VAT payable")} {money(estimate.netTaxPayable)}
                </span>
                {estimate.surcharges > 0 ? (
                  <>
                    <span aria-hidden>+</span>
                    <span className="tabular-nums">
                      {t("Surcharges")} {money(estimate.surcharges)}
                    </span>
                  </>
                ) : null}
              </div>
            ) : null}

            {/*
              The US counterpart to the VAT arithmetic above.

              `totalTaxCost` deliberately excludes sales tax, because it is
              collected from the customer and remitted rather than borne — so a
              load whose only tax is sales tax headlines as zero cost, which is
              true but reads at a glance as "no tax". Stating the remittance
              beside the headline is what keeps that from being misleading; a
              caveat further down the panel does not, because nobody weighs a
              footnote against a number in 24px type.
            */}
            {!isVat && estimate.netTaxPayable > 0 ? (
              <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                <span className="font-medium text-foreground tabular-nums">
                  {t("Sales tax to collect and remit")} {money(estimate.netTaxPayable)}
                </span>
                <span>{t("— billed to the customer, so not a cost you bear")}</span>
              </div>
            ) : null}
          </div>

          {/* Line detail */}
          {estimate.lines.length > 0 ? (
            <div className="space-y-1.5">
              {estimate.lines.map((line) => (
                <div
                  key={line.id}
                  className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-sm"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate">
                      {t(line.label)}
                      {line.detail ? (
                        <span className="ml-1.5 text-xs text-muted-foreground">{line.detail}</span>
                      ) : null}
                      {line.rate !== undefined && line.rate > 0 && line.rate < 1 ? (
                        <span className="ml-1.5 text-xs text-muted-foreground tabular-nums">
                          {format.percent(line.rate, line.rate < 0.01 ? 2 : 0)}
                        </span>
                      ) : null}
                    </p>
                    {line.labelLocal ? (
                      <p className="truncate text-xs text-muted-foreground">{line.labelLocal}</p>
                    ) : null}
                  </div>
                  <span
                    className={cn(
                      "shrink-0 font-medium tabular-nums",
                      line.credit && "text-success",
                    )}
                  >
                    {line.credit ? "−" : ""}
                    {money(line.amount)}
                  </span>
                </div>
              ))}
            </div>
          ) : null}

          {/* Collected-vs-borne, spelled out. Without this the customer's VAT
            reads as the broker's cost. */}
          {isVat && estimate.outputTax > 0 ? (
            <>
              <Separator />
              <p className="text-xs leading-relaxed text-muted-foreground">
                {t(
                  "Output VAT is collected from the customer and remitted — it is not your cost. What you bear is the payable figure above, after crediting the VAT on purchased carriage.",
                )}
              </p>
            </>
          ) : null}

          {providerHint.helps && providerHint.reason ? (
            <div className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2.5">
              <p className="text-xs leading-relaxed text-warning-foreground">
                {t(providerHint.reason)}
              </p>
              <p className="mt-1 text-xs text-warning-foreground/80">
                {t("Connect a tax provider in Settings → Integrations.")}
              </p>
            </div>
          ) : null}

          {provider && provider.jurisdictions.length > 0 ? (
            <>
              <Separator />
              <div className="space-y-1">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {t("Jurisdictions (AvaTax)")}
                </p>
                {provider.jurisdictions.map((jurisdiction) => (
                  <div
                    key={`${jurisdiction.name}-${jurisdiction.type}`}
                    className="flex items-baseline justify-between gap-3 text-sm"
                  >
                    <span className="min-w-0 truncate">
                      {jurisdiction.name}
                      <span className="ml-1.5 text-xs text-muted-foreground">
                        {jurisdiction.type}
                      </span>
                    </span>
                    <span className="shrink-0 tabular-nums">
                      {format.percent(jurisdiction.rate, 3)} {money(jurisdiction.tax)}
                    </span>
                  </div>
                ))}
              </div>
            </>
          ) : null}

          {agreement === "disagrees" ? (
            <div className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2.5">
              <p className="text-xs leading-relaxed text-warning-foreground">
                {t(
                  "The provider's figure differs materially from the statutory calculation. That usually means a configuration problem — company code, tax code, or an address that geocoded somewhere unexpected — rather than a difference in law. Worth checking before quoting.",
                )}
              </p>
            </div>
          ) : null}

          {providerError ? (
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2.5">
              <p className="text-xs leading-relaxed text-destructive">
                {t("Tax provider unavailable — showing the built-in estimate.")} {providerError}
              </p>
            </div>
          ) : null}

          {fuelRatesLive ? (
            <p className="text-xs text-muted-foreground">
              {t("Fuel tax uses published IFTA rates")}
              {fuelRateQuarter ? ` (${fuelRateQuarter})` : ""}
            </p>
          ) : null}

          {hasManual && (manualSource || manualNote) ? (
            <>
              <Separator />
              <div className="space-y-0.5">
                {manualSource ? (
                  <p className="text-xs text-muted-foreground">
                    <span className="font-medium text-foreground/80">{t("Source")}:</span>{" "}
                    {manualSource}
                  </p>
                ) : null}
                {manualNote ? (
                  <p className="text-xs leading-relaxed text-muted-foreground">{manualNote}</p>
                ) : null}
              </div>
            </>
          ) : null}

          {onEditManual ? (
            <div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 gap-1.5 text-xs"
                onClick={onEditManual}
              >
                <Calculator className="h-3.5 w-3.5" />
                {hasManual ? t("Edit manual tax") : t("Enter tax manually")}
              </Button>
            </div>
          ) : null}

          {/* Caveats. Collapsed, but present and never optional. */}
          <div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 gap-1.5 px-2 text-xs text-muted-foreground"
              onClick={() => setShowNotes((open) => !open)}
              aria-expanded={showNotes}
            >
              <HelpCircle className="h-3.5 w-3.5" />
              {showNotes ? t("Hide assumptions") : t("What this includes and excludes")}
              {showNotes ? (
                <ChevronUp className="h-3.5 w-3.5" />
              ) : (
                <ChevronDown className="h-3.5 w-3.5" />
              )}
            </Button>

            {showNotes ? (
              <ul className="mt-2 space-y-1.5 border-l-2 border-border/70 pl-3">
                {estimate.notes.map((entry) => (
                  <li key={entry.text} className="text-xs leading-relaxed text-muted-foreground">
                    {t(entry.text)}
                    {/* Interpolated specifics stay verbatim — a state code or an
                      amount has no translation. */}
                    {entry.detail ? (
                      <span className="ml-1 font-medium text-foreground/80">{entry.detail}</span>
                    ) : null}
                  </li>
                ))}
                <li className="text-xs leading-relaxed text-muted-foreground">
                  {t("Rate data snapshot")}: {estimate.rateSnapshot}
                </li>
              </ul>
            ) : null}
          </div>

          <p className="text-[11px] leading-relaxed text-muted-foreground/80">
            {t(
              "An estimate for pricing and planning. Not tax advice, and not a substitute for a filing position — confirm with your tax advisor before relying on it.",
            )}
          </p>
        </CardContent>
      </Card>
    </TooltipProvider>
  );
}
