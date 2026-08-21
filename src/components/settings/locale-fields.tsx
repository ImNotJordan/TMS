/**
 * The Time Zone and Language controls, plus the preview that proves they work.
 *
 * ## Why these are not `type: "select"` rows
 *
 * The settings page renders most fields from a data table, and a plain select
 * would have been a one-line change. It would also have been the reason the
 * setting stayed wrong: `America/Chicago` and `Asia/Shanghai` in a bare list
 * tell you nothing about which one is 9am for the person you are about to call.
 * So each option carries its live UTC offset and the current wall-clock time in
 * that zone, and the zones are grouped by region — the choice is then legible
 * without knowing the IANA database by heart.
 *
 * The preview card exists for the same reason. "It actually changes the system"
 * is a claim the user should be able to check before saving, not after.
 */
import * as React from "react";
import { Check, Clock, Globe, Languages, MapPin } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { createFormatters, type HourCycle } from "@/lib/i18n/format";
import { useT } from "@/lib/i18n/locale-context";
import {
  LOCALE_LIST,
  TIME_ZONE_GROUPS,
  TIME_ZONE_IDS,
  currentTimeInZone,
  describeTimeZone,
  detectTimeZone,
  resolveLocale,
  resolveTimeZone,
  timeZoneOffsetLabel,
  type LocaleCode,
} from "@/lib/i18n/locales";

/**
 * Re-render every 30s so the offsets and clocks in the open dropdown stay
 * honest. Ticking is cheap; a stale clock in a time-zone picker is not.
 */
function useMinuteTick(active = true): Date {
  const [now, setNow] = React.useState(() => new Date());
  React.useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, [active]);
  return now;
}

/* ------------------------------------------------------------------ *
 * Time zone
 * ------------------------------------------------------------------ */

export function TimeZoneField({
  value,
  onChange,
  locale,
  label,
  help,
  disabled = false,
}: {
  value: string;
  onChange: (next: string) => void;
  locale: LocaleCode;
  label: string;
  help?: string;
  disabled?: boolean;
}) {
  const t = useT();
  const now = useMinuteTick();

  const resolved = resolveTimeZone(value);
  const detected = React.useMemo(() => detectTimeZone(), []);
  const detectedIsDifferent = detected !== resolved;

  /**
   * A stored zone outside the curated list still has to be selectable, or
   * opening this control would silently rewrite it to Chicago on the next save.
   */
  const extraZone = TIME_ZONE_IDS.includes(resolved) ? null : resolved;

  return (
    <div className="space-y-1.5 md:col-span-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Label className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <Globe className="h-3.5 w-3.5" />
          {label}
        </Label>
        <div className="flex items-center gap-1.5">
          <Badge variant="outline" className="gap-1 font-normal tabular-nums">
            <Clock className="h-3 w-3" />
            {currentTimeInZone(resolved, locale, now)}
            {timeZoneOffsetLabel(resolved, now) ? ` · ${timeZoneOffsetLabel(resolved, now)}` : ""}
          </Badge>
          {detectedIsDifferent && !disabled ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-xs"
              onClick={() => onChange(detected)}
            >
              <MapPin className="h-3 w-3" />
              {t("locale.useDetected")}: {describeTimeZone(detected)}
            </Button>
          ) : null}
        </div>
      </div>

      <Select value={resolved} onValueChange={onChange} disabled={disabled}>
        <SelectTrigger disabled={disabled}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="max-h-[320px]">
          {extraZone ? (
            <SelectGroup>
              <SelectLabel className="text-[11px] uppercase tracking-wide">
                {describeTimeZone(extraZone)}
              </SelectLabel>
              <ZoneItem
                id={extraZone}
                label={describeTimeZone(extraZone)}
                locale={locale}
                now={now}
              />
            </SelectGroup>
          ) : null}

          {TIME_ZONE_GROUPS.map((group) => (
            <SelectGroup key={group.labelKey}>
              <SelectLabel className="text-[11px] uppercase tracking-wide">
                {t(group.labelKey)}
              </SelectLabel>
              {group.zones.map((zone) => (
                <ZoneItem key={zone.id} id={zone.id} label={zone.label} locale={locale} now={now} />
              ))}
            </SelectGroup>
          ))}
        </SelectContent>
      </Select>

      {help ? <p className="text-xs text-muted-foreground">{help}</p> : null}
    </div>
  );
}

function ZoneItem({
  id,
  label,
  locale,
  now,
}: {
  id: string;
  label: string;
  locale: LocaleCode;
  now: Date;
}) {
  const offset = timeZoneOffsetLabel(id, now);
  return (
    <SelectItem value={id}>
      <span className="flex w-full min-w-0 items-center gap-2">
        <span className="min-w-0 flex-1 truncate">{label}</span>
        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
          {currentTimeInZone(id, locale, now)}
          {offset ? ` · ${offset}` : ""}
        </span>
      </span>
    </SelectItem>
  );
}

/* ------------------------------------------------------------------ *
 * Language
 * ------------------------------------------------------------------ */

export function LanguageField({
  value,
  onChange,
  timeZone,
  label,
  help,
  disabled = false,
}: {
  value: string;
  onChange: (next: LocaleCode) => void;
  timeZone: string;
  label: string;
  help?: string;
  disabled?: boolean;
}) {
  const resolved = resolveLocale(value);

  return (
    <div className="space-y-1.5 md:col-span-2">
      <Label className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <Languages className="h-3.5 w-3.5" />
        {label}
      </Label>

      <Select
        value={resolved}
        onValueChange={(next) => onChange(next as LocaleCode)}
        disabled={disabled}
      >
        <SelectTrigger disabled={disabled}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {LOCALE_LIST.map((definition) => {
            // Each row previews a date in its own language, so the choice is
            // visible before it is committed.
            const sample = createFormatters({
              locale: definition.code,
              timeZone,
            }).date(new Date());
            return (
              <SelectItem key={definition.code} value={definition.code}>
                <span className="flex w-full min-w-0 items-center gap-2">
                  <span aria-hidden className="shrink-0 text-base leading-none">
                    {definition.flag}
                  </span>
                  <span className="min-w-0 flex-1 truncate">
                    {definition.nativeLabel}
                    <span className="ml-1.5 text-xs text-muted-foreground">
                      {definition.englishLabel}
                    </span>
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">{sample}</span>
                </span>
              </SelectItem>
            );
          })}
        </SelectContent>
      </Select>

      {help ? <p className="text-xs text-muted-foreground">{help}</p> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Preview
 * ------------------------------------------------------------------ */

/**
 * Renders the *pending* selection, not the saved one.
 *
 * Reading the live provider here would show the old setting until save, which
 * is precisely the feedback gap that makes people distrust a settings page. So
 * it builds throwaway formatters from the draft values.
 */
export function LocalePreviewCard({
  locale,
  timeZone,
  hourCycle,
  currency,
  dirty,
}: {
  locale: string;
  timeZone: string;
  hourCycle?: string;
  currency?: string;
  dirty?: boolean;
}) {
  const t = useT();
  const now = useMinuteTick();

  const resolvedLocale = resolveLocale(locale);
  const resolvedZone = resolveTimeZone(timeZone);

  const format = React.useMemo(
    () =>
      createFormatters({
        locale: resolvedLocale,
        timeZone: resolvedZone,
        hourCycle:
          hourCycle === "12-hour" || hourCycle === "24-hour" ? (hourCycle as HourCycle) : undefined,
        currency: currency?.trim() || undefined,
      }),
    [currency, hourCycle, resolvedLocale, resolvedZone],
  );

  // A fixed instant three hours back: relative time then has something to say,
  // and the absolute renders stay stable while the card is open.
  const sample = React.useMemo(() => new Date(now.getTime() - 3 * 3_600_000), [now]);

  const rows: { label: string; value: string }[] = [
    { label: t("locale.preview.dateTime"), value: format.dateTimeLong(sample) },
    { label: t("locale.preview.withZone"), value: format.dateTimeWithZone(sample) },
    { label: t("locale.preview.relative"), value: format.relative(sample, now) },
    { label: t("locale.preview.number"), value: format.number(1234567.891) },
    { label: t("locale.preview.currency"), value: format.currencyPrecise(1240.5) },
  ];

  return (
    <Card className="border-border/70 bg-muted/20 shadow-sm md:col-span-2 xl:col-span-3">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <CardTitle className="text-base">{t("locale.preview.title")}</CardTitle>
            <CardDescription className="mt-0.5">{t("locale.preview.description")}</CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge variant="outline" className="gap-1 font-normal">
              <Globe className="h-3 w-3" />
              {describeTimeZone(resolvedZone)}
              {timeZoneOffsetLabel(resolvedZone, now)
                ? ` · ${timeZoneOffsetLabel(resolvedZone, now)}`
                : ""}
            </Badge>
            {dirty ? (
              <Badge
                variant="outline"
                className="border-warning/40 bg-warning/15 font-normal text-warning-foreground"
              >
                {t("settings.unsaved")}
              </Badge>
            ) : (
              <Badge
                variant="outline"
                className="border-success/40 bg-success/15 font-normal text-success"
              >
                <Check className="mr-1 h-3 w-3" />
                {t("state.saved")}
              </Badge>
            )}
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2 xl:grid-cols-3">
          {rows.map((row) => (
            <div key={row.label} className="min-w-0">
              <dt className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                {row.label}
              </dt>
              <dd className="mt-0.5 truncate text-sm font-medium tabular-nums">{row.value}</dd>
            </div>
          ))}
        </dl>

        <Separator />

        <p className={cn("text-xs", dirty ? "text-warning-foreground" : "text-muted-foreground")}>
          {t("locale.preview.appliesNow")}
        </p>
      </CardContent>
    </Card>
  );
}
