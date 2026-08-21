import * as React from "react";
import {
  AlertTriangle,
  ArrowRightCircle,
  Loader2,
  Phone,
  Radar,
  RefreshCcw,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/lib/auth";
import { buildDatSearchUrl, runSimulatedDatScan, simulateBrokerCall } from "@/lib/dat-prospecting";
import {
  createCrmActivity,
  createCrmLead,
  createCrmProspectingRun,
  listAllCrmProspectingRunsCached,
  updateCrmProspectingRun,
  type CrmProspectingMatch,
  type CrmProspectingRunRecord,
} from "@/lib/crm-store";
import {
  Card,
  FieldShell,
  GridSection,
  SectionTitle,
  formatCurrency,
  formatTimestamp,
  generateCrmId,
} from "./crm-shared";
import { t } from "@/lib/i18n/t";

export function ProspectingBotPanel() {
  const { user } = useAuth();
  const [originCity, setOriginCity] = React.useState("");
  const [originState, setOriginState] = React.useState("");
  const [destCity, setDestCity] = React.useState("");
  const [destState, setDestState] = React.useState("");
  const [equipmentType, setEquipmentType] = React.useState("Dry Van");
  const [targetRatePerMile, setTargetRatePerMile] = React.useState("2.50");
  const [estimatedCost, setEstimatedCost] = React.useState("1500");
  const [marginFloorPct, setMarginFloorPct] = React.useState("15");
  const [maxResults, setMaxResults] = React.useState("5");

  const [runs, setRuns] = React.useState<CrmProspectingRunRecord[] | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [scanning, setScanning] = React.useState(false);
  const [callingMatchId, setCallingMatchId] = React.useState<string | null>(null);
  const [convertingMatchId, setConvertingMatchId] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const rows = await listAllCrmProspectingRunsCached();
      rows.sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
      setRuns(rows);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load prospecting runs.");
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  const runScan = async () => {
    setScanning(true);
    setError(null);
    try {
      const params = {
        originCity: originCity || undefined,
        originState: originState || undefined,
        destCity: destCity || undefined,
        destState: destState || undefined,
        equipmentType: equipmentType || undefined,
        targetRatePerMile: targetRatePerMile ? Number(targetRatePerMile) : undefined,
        marginFloorPct: marginFloorPct ? Number(marginFloorPct) : undefined,
        estimatedCost: estimatedCost ? Number(estimatedCost) : undefined,
        maxResults: maxResults ? Number(maxResults) : undefined,
      };
      const seed = Math.floor(Math.random() * 100000);
      const found = runSimulatedDatScan(params, seed);
      const matches: CrmProspectingMatch[] = found.map((m) => ({
        matchId: m.matchId,
        broker: m.broker,
        brokerPhone: m.brokerPhone,
        lane: m.lane,
        postedRate: m.postedRate,
        equipmentType: m.equipmentType,
        callOutcome: "pending",
      }));
      const run = await createCrmProspectingRun({
        runId: generateCrmId("RUN"),
        originCity: params.originCity,
        originState: params.originState,
        destCity: params.destCity,
        destState: params.destState,
        equipmentType: params.equipmentType,
        targetRatePerMile: params.targetRatePerMile,
        marginFloorPct: params.marginFloorPct,
        estimatedCost: params.estimatedCost,
        datSearchUrl: buildDatSearchUrl(params),
        matches,
        createdBy: user?.userId,
      });
      setRuns((prev) => [run, ...(prev ?? [])]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "DAT scan failed.");
    } finally {
      setScanning(false);
    }
  };

  const callBroker = async (run: CrmProspectingRunRecord, match: CrmProspectingMatch) => {
    setCallingMatchId(match.matchId);
    setError(null);
    try {
      const cost = run.estimatedCost ?? 1500;
      const floor = run.marginFloorPct ?? 15;
      const result = simulateBrokerCall(match, cost, floor);
      const updatedMatches = run.matches.map((m) =>
        m.matchId === match.matchId
          ? {
              ...m,
              callOutcome: result.outcome,
              negotiatedRate: result.negotiatedRate,
              transcript: result.transcript,
              guardrailAllowed: result.guardrail.allowed,
              guardrailReason: result.guardrail.reason,
            }
          : m,
      );
      const updatedRun = await updateCrmProspectingRun({ ...run, matches: updatedMatches });
      setRuns((prev) => prev?.map((r) => (r.runId === updatedRun.runId ? updatedRun : r)) ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Broker call failed.");
    } finally {
      setCallingMatchId(null);
    }
  };

  const convertToLead = async (run: CrmProspectingRunRecord, match: CrmProspectingMatch) => {
    setConvertingMatchId(match.matchId);
    setError(null);
    try {
      const [origin, destination] = match.lane.split("→").map((s) => s.trim());
      const lead = await createCrmLead({
        leadId: generateCrmId("LEAD"),
        title: `${match.broker} — ${match.lane}`,
        stage: "Quoted",
        origin,
        destination,
        equipmentType: match.equipmentType,
        quotedRate: match.negotiatedRate ?? match.postedRate,
        estimatedCost: run.estimatedCost,
        marginFloorPct: run.marginFloorPct,
        probabilityPct: 60,
        source: "dat_prospecting",
        notes: `Sourced from Prospecting Bot run ${run.runId}.`,
        createdBy: user?.userId,
      });
      await createCrmActivity({
        activityId: generateCrmId("ACT"),
        entityType: "lead",
        entityId: lead.leadId,
        type: "dat_search",
        subject: `Sourced from DAT scan — ${match.broker}`,
        datSearchUrl: run.datSearchUrl,
        createdBy: user?.userId,
      });
      if (match.transcript) {
        await createCrmActivity({
          activityId: generateCrmId("ACT"),
          entityType: "lead",
          entityId: lead.leadId,
          type: "call",
          subject: `Broker call — ${match.broker}`,
          transcript: match.transcript,
          outcome: match.callOutcome,
          guardrailAllowed: match.guardrailAllowed,
          guardrailReason: match.guardrailReason,
          createdBy: user?.userId,
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to convert match to a lead.");
    } finally {
      setConvertingMatchId(null);
    }
  };

  const latestRun = runs?.[0];

  return (
    <div className="space-y-6">
      <Card>
        <SectionTitle
          title={t("Prospecting Bot")}
          hint={t(
            "Scans DAT by lane/equipment, calls brokers, verifies availability, negotiates within your margin floor",
          )}
          icon={Radar}
        />
        <div className="mb-3 rounded-md border border-info/30 bg-info/8 px-3 py-2 text-[11px] text-info">
          {t(
            "DAT search and broker calls are simulated pending live DAT Load Board and telephony\n          credentials — guardrail logic and activity logging run for real.",
          )}
        </div>
        <GridSection cols={4}>
          <FieldShell label={t("Origin City")}>
            <Input
              value={originCity}
              onChange={(e) => setOriginCity(e.target.value)}
              placeholder={t("Dallas")}
            />
          </FieldShell>
          <FieldShell label={t("Origin State")}>
            <Input
              value={originState}
              onChange={(e) => setOriginState(e.target.value)}
              placeholder="TX"
            />
          </FieldShell>
          <FieldShell label={t("Dest City")}>
            <Input
              value={destCity}
              onChange={(e) => setDestCity(e.target.value)}
              placeholder={t("Atlanta")}
            />
          </FieldShell>
          <FieldShell label={t("Dest State")}>
            <Input
              value={destState}
              onChange={(e) => setDestState(e.target.value)}
              placeholder="GA"
            />
          </FieldShell>
        </GridSection>
        <GridSection cols={4} className="mt-4">
          <FieldShell label={t("Equipment")}>
            <Input value={equipmentType} onChange={(e) => setEquipmentType(e.target.value)} />
          </FieldShell>
          <FieldShell label={t("Target $/mile")}>
            <Input
              type="number"
              step="0.05"
              value={targetRatePerMile}
              onChange={(e) => setTargetRatePerMile(e.target.value)}
            />
          </FieldShell>
          <FieldShell label={t("Est. Cost ($)")}>
            <Input
              type="number"
              value={estimatedCost}
              onChange={(e) => setEstimatedCost(e.target.value)}
            />
          </FieldShell>
          <FieldShell label={t("Margin Floor %")} hint={t("Guardrail")}>
            <Input
              type="number"
              value={marginFloorPct}
              onChange={(e) => setMarginFloorPct(e.target.value)}
            />
          </FieldShell>
        </GridSection>
        <div className="mt-4 flex items-center justify-between">
          <FieldShell label={t("Max results")} className="w-32">
            <Input
              type="number"
              value={maxResults}
              onChange={(e) => setMaxResults(e.target.value)}
            />
          </FieldShell>
          <Button
            type="button"
            className="gap-1.5"
            disabled={scanning}
            onClick={() => void runScan()}
          >
            {scanning ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Radar className="h-4 w-4" />
            )}
            Run DAT scan
          </Button>
        </div>
      </Card>

      {error && (
        <div className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/8 px-3 py-2 text-xs text-destructive">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          {error}
        </div>
      )}

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="rounded-xl border border-border/70 p-4">
              <div className="flex items-center justify-between gap-2">
                <Skeleton className="h-4 w-48" />
                <Skeleton className="h-3.5 w-24" />
              </div>
              <Skeleton className="mt-3 h-3 w-2/3" />
              <Skeleton className="mt-2 h-3 w-1/2" />
            </div>
          ))}
        </div>
      ) : !runs || runs.length === 0 ? (
        <div className="py-8 text-center text-sm text-muted-foreground">
          {t("No scans yet — run one above to find and call brokers.")}
        </div>
      ) : (
        (latestRun ? [latestRun, ...runs.slice(1)] : runs).map((run, idx) => (
          <Card key={run.runId} className={idx === 0 ? "" : "opacity-90"}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                {run.originCity ?? "—"}, {run.originState ?? ""} → {run.destCity ?? "—"},{" "}
                {run.destState ?? ""}
                <Badge variant="secondary">{run.equipmentType ?? "Any"}</Badge>
              </div>
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <span>{formatTimestamp(run.createdAt)}</span>
                <a
                  href={run.datSearchUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 font-medium text-primary underline-offset-2 hover:underline"
                >
                  <Radar className="h-3 w-3" /> {t("DAT search")}
                </a>
              </div>
            </div>
            <div className="mt-3 space-y-2">
              {run.matches.map((match) => {
                const isCalling = callingMatchId === match.matchId;
                const isConverting = convertingMatchId === match.matchId;
                const blocked = match.callOutcome === "guardrail_blocked";
                const negotiated = match.callOutcome === "negotiated";
                return (
                  <div
                    key={match.matchId}
                    className="rounded-lg border border-border/60 bg-card/60 p-3"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-foreground">{match.broker}</div>
                        <div className="text-xs text-muted-foreground">{match.brokerPhone}</div>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold tabular-nums text-foreground">
                          {formatCurrency(match.negotiatedRate ?? match.postedRate)}
                        </span>
                        {match.negotiatedRate && match.negotiatedRate !== match.postedRate && (
                          <span className="text-xs text-muted-foreground line-through">
                            {formatCurrency(match.postedRate)}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="mt-2 flex items-center justify-between gap-2">
                      <div>
                        {match.callOutcome && match.callOutcome !== "pending" && (
                          <span
                            className={cn(
                              "inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium",
                              blocked
                                ? "bg-destructive/12 text-destructive"
                                : "bg-success/12 text-success",
                            )}
                          >
                            {blocked ? (
                              <ShieldAlert className="h-3 w-3" />
                            ) : (
                              <ShieldCheck className="h-3 w-3" />
                            )}
                            {match.callOutcome.replace("_", " ")}
                          </span>
                        )}
                      </div>
                      <div className="flex gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="gap-1.5"
                          disabled={isCalling}
                          onClick={() => void callBroker(run, match)}
                        >
                          {isCalling ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : match.callOutcome && match.callOutcome !== "pending" ? (
                            <RefreshCcw className="h-3.5 w-3.5" />
                          ) : (
                            <Phone className="h-3.5 w-3.5" />
                          )}
                          {match.callOutcome && match.callOutcome !== "pending"
                            ? "Call again"
                            : "Call broker"}
                        </Button>
                        {negotiated && (
                          <Button
                            type="button"
                            size="sm"
                            className="gap-1.5"
                            disabled={isConverting}
                            onClick={() => void convertToLead(run, match)}
                          >
                            {isConverting ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <ArrowRightCircle className="h-3.5 w-3.5" />
                            )}
                            To pipeline
                          </Button>
                        )}
                      </div>
                    </div>
                    {match.transcript && (
                      <pre className="mt-2 whitespace-pre-wrap rounded-md bg-muted/60 px-2 py-1.5 text-[11px] text-muted-foreground">
                        {match.transcript}
                      </pre>
                    )}
                    {match.guardrailReason && (
                      <div
                        className={cn(
                          "mt-1.5 flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-medium",
                          match.guardrailAllowed
                            ? "bg-success/12 text-success"
                            : "bg-destructive/12 text-destructive",
                        )}
                      >
                        {match.guardrailAllowed ? (
                          <ShieldCheck className="h-3 w-3 shrink-0" />
                        ) : (
                          <ShieldAlert className="h-3 w-3 shrink-0" />
                        )}
                        {match.guardrailReason}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </Card>
        ))
      )}
    </div>
  );
}
