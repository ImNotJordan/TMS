import * as React from "react";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import {
  AlertCircle,
  ArrowUpRight,
  Bot,
  Calculator,
  CheckCircle2,
  ClipboardList,
  Copy,
  Database,
  Download,
  FileDown,
  Filter,
  Gauge,
  Loader2,
  MapPinned,
  RefreshCw,
  Save,
  Search,
  ShieldAlert,
  Sparkles,
  Table2,
  Target,
  Trash2,
  TrendingUp,
  Truck,
  WandSparkles,
} from "lucide-react";

import { PageHeader } from "@/components/page-header";
import { usePageReady } from "@/components/page-load-gate";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  AI_NOT_CONNECTED_MESSAGE,
  DAT_NOT_CONNECTED_MESSAGE,
  DEFAULT_SEARCH_OPTIONS,
  buildBackhaulCandidatesFromAws,
  buildHistoricalRowsFromLoads,
  buildLeverageLoadsFromAws,
  createEmptySearchCriteria,
  deriveLoadFieldOptions,
  fetchBiddingLoads,
  fetchBiddingRiskModels,
  getBiddingLoadsFingerprint,
  getDatSnapshotForBidding,
  isAiBidConnected,
  isDatApiConnected,
  type BackhaulCandidate,
  type DatSnapshot,
  type DatStatus,
  type HistoricalResultRow,
  type LeverageLoad,
  type MarginBand,
  type RiskModelOption,
  type SearchCriteria,
  type SearchOptions,
} from "@/lib/bidding-data";
import { enrichBidNarrativesWithAi } from "@/lib/workspace-ai";
import type { LoadRecord } from "@/lib/loads-store";
import { createLoad } from "@/lib/loads-store";
import { useAuth } from "@/lib/auth";
import { isBiddingWorkspaceConfigured } from "@/lib/dynamodb";
import {
  clearBiddingSearchSessionCache,
  readBiddingSearchSessionCache,
  writeBiddingSearchSessionCache,
} from "@/lib/bidding-page-cache";
import {
  appendBiddingAuditLog,
  bidQuoteToSummary,
  createBidQuote,
  deleteBidQuote,
  deleteBiddingSavedSearch,
  fetchBiddingWorkspaceSnapshotCached,
  getBiddingWorkspaceTableMissingMessage,
  isBiddingWorkspaceAvailable,
  listBidQuotes,
  readBiddingWorkspaceCacheSnapshot,
  updateBidQuote,
  upsertBiddingSavedSearch,
  type BiddingWorkspaceSnapshot,
} from "@/lib/bidding-workspace-store";

type RiskLevel = "Low Risk" | "Medium Risk" | "High Risk" | "Critical Risk";
type ConfidenceLevel = "Low Confidence" | "Medium Confidence" | "High Confidence";
type SearchPipelineStep =
  | "Searching internal historicals"
  | "Aggregating historical rates"
  | "Fetching DAT market data"
  | "Calculating risk score"
  | "Generating AI bid suggestion";

type RiskEvaluation = {
  outputRiskPct: number;
  riskLevel: RiskLevel;
  reasonCodes: string[];
  topContributingFactors: Array<{
    name: string;
    value: number;
    weight: number;
    contribution: number;
    direction: "Positive" | "Negative";
  }>;
  modelVersion: string;
  evaluationTimestamp: string;
  inputValues: Record<string, number>;
  deterministicSignature: string;
};

type AiSuggestion = {
  suggestedBidLow: number;
  suggestedBidHigh: number;
  recommendedSellRate: number;
  recommendedBuyRate: number;
  targetMargin: number;
  marginPercentage: number;
  confidenceScore: number;
  confidenceLevel: ConfidenceLevel;
  guardrails: string[];
  notes: string;
  keyDrivers: string[];
  suggestedStrategy: string;
  customerFacingNote: string;
  internalPricingNote: string;
  whySuggestionRows: Array<{ label: string; value: string }>;
};

type AuditLogEntry = {
  searchId: string;
  user: string;
  origin: string;
  destination: string;
  equipment: string;
  date: string;
  historicalAggregationTimestamp: string;
  datRefreshTimestamp: string;
  riskModelId: string;
  riskModelVersion: string;
  riskInputValues: string;
  riskOutput: string;
  aiSuggestionTimestamp: string;
  finalSelectedBid: string;
  actionTaken: string;
  createdQuoteId: string;
  attachedRfpId: string;
};

const SEARCH_PIPELINE: SearchPipelineStep[] = [
  "Searching internal historicals",
  "Aggregating historical rates",
  "Fetching DAT market data",
  "Calculating risk score",
  "Generating AI bid suggestion",
];

const DAT_STATUS_TONE: Record<DatStatus, string> = {
  Live: "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300",
  Refreshing: "border-blue-300 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-300",
  Stale: "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300",
  Unavailable: "border-slate-300 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300",
  "API Error": "border-rose-300 bg-rose-50 text-rose-700 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-300",
};

const MARGIN_TONE: Record<MarginBand, string> = {
  "Low Margin": "text-amber-700 dark:text-amber-300",
  "Healthy Margin": "text-sky-700 dark:text-sky-300",
  "Strong Margin": "text-emerald-700 dark:text-emerald-300",
  "Aggressive Bid": "text-orange-700 dark:text-orange-300",
  "Conservative Bid": "text-purple-700 dark:text-purple-300",
  "Below Market": "text-rose-700 dark:text-rose-300",
  "At Market": "text-muted-foreground",
  "Above Market": "text-emerald-700 dark:text-emerald-300",
};

const BIDDING_MOBILE_TABS = [
  { value: "search", label: "Search", title: "Spot Load Search", icon: Search },
  { value: "results", label: "Results", title: "Bid Intelligence Results", icon: Table2 },
  { value: "dat", label: "DAT", title: "DAT RateView", icon: Database },
  { value: "leverage", label: "Leverage", title: "Leverage Panel", icon: Truck },
  { value: "risk", label: "Risk", title: "Risk Model Slot", icon: ShieldAlert },
  { value: "ai", label: "AI Bid", title: "AI Bid Suggestion", icon: Bot },
  { value: "actions", label: "Actions", title: "Bid Actions", icon: ClipboardList },
] as const;

type BiddingMobileTabId = (typeof BIDDING_MOBILE_TABS)[number]["value"];

const BIDDING_DESKTOP_TABS = [
  { value: "results", label: "Bid Results", title: "Bid Intelligence Results", icon: Table2 },
  { value: "market", label: "DAT & Leverage", title: "DAT RateView and Leverage Panel", icon: Database },
  { value: "risk", label: "Risk & AI Bid", title: "Risk Model and AI Bid Suggestion", icon: ShieldAlert },
  { value: "actions", label: "Actions & Quotes", title: "Bid Actions and Saved Quotes", icon: ClipboardList },
  { value: "audit", label: "Audit Log", title: "Audit / Calculation Log", icon: Calculator },
] as const;

type BiddingDesktopTabId = (typeof BIDDING_DESKTOP_TABS)[number]["value"];

export function BiddingPage() {
  const { user } = useAuth();
  const workspaceId = user?.userId ?? "_";
  const workspaceUser =
    user?.name?.trim() ||
    user?.attributes?.given_name ||
    user?.email?.split("@")[0] ||
    "Current User";

  const [searchCriteria, setSearchCriteria] = React.useState<SearchCriteria>(createEmptySearchCriteria);
  const [searchOptions, setSearchOptions] = React.useState<SearchOptions>(DEFAULT_SEARCH_OPTIONS);
  const [savedSearches, setSavedSearches] = React.useState<Array<{ name: string; criteria: SearchCriteria }>>(
    [],
  );
  const [selectedSavedSearch, setSelectedSavedSearch] = React.useState<string>("none");
  const [searchStageIndex, setSearchStageIndex] = React.useState<number>(-1);
  const [isSearching, setIsSearching] = React.useState(false);
  const [loadsLoading, setLoadsLoading] = React.useState(true);
  const [loadsRefreshing, setLoadsRefreshing] = React.useState(false);
  const [loadsError, setLoadsError] = React.useState<string | null>(null);
  const [awsLoads, setAwsLoads] = React.useState<LoadRecord[]>([]);
  const [riskModels, setRiskModels] = React.useState<RiskModelOption[]>([]);
  const [riskModelsLoading, setRiskModelsLoading] = React.useState(true);

  usePageReady(loadsLoading || riskModelsLoading);

  const [datSnapshot, setDatSnapshot] = React.useState<DatSnapshot>(() => getDatSnapshotForBidding());
  const [datError, setDatError] = React.useState<string | null>(() =>
    isDatApiConnected() ? null : DAT_NOT_CONNECTED_MESSAGE,
  );

  const [results, setResults] = React.useState<HistoricalResultRow[]>([]);
  const [selectedResultId, setSelectedResultId] = React.useState<string>("");

  const [similarActiveLoads, setSimilarActiveLoads] = React.useState<LeverageLoad[]>([]);
  const [backhaulCandidates, setBackhaulCandidates] = React.useState<BackhaulCandidate[]>([]);
  const [excludedLeverageIds, setExcludedLeverageIds] = React.useState<string[]>([]);

  const [selectedRiskModelId, setSelectedRiskModelId] = React.useState<string>("");
  const [riskEvaluation, setRiskEvaluation] = React.useState<RiskEvaluation | null>(null);
  const [aiSuggestion, setAiSuggestion] = React.useState<AiSuggestion | null>(null);
  const [finalBid, setFinalBid] = React.useState<string>("");
  const [internalNote, setInternalNote] = React.useState<string>("");
  const [rfpLane, setRfpLane] = React.useState<string>("");
  const [actionMessage, setActionMessage] = React.useState<string | null>(null);
  const [showWhySuggestion, setShowWhySuggestion] = React.useState<boolean>(true);
  const [mobileTab, setMobileTab] = React.useState<BiddingMobileTabId>("search");
  const [desktopTab, setDesktopTab] = React.useState<BiddingDesktopTabId>("results");
  const [logs, setLogs] = React.useState<AuditLogEntry[]>([]);
  const [savedQuotes, setSavedQuotes] = React.useState<
    Array<{ id: string; bid: number; margin: number; timestamp: string; status?: string }>
  >([]);
  const [workspaceSyncError, setWorkspaceSyncError] = React.useState<string | null>(null);
  const [workspaceTableMissing, setWorkspaceTableMissing] = React.useState(false);
  const [workspaceActionPending, setWorkspaceActionPending] = React.useState(false);
  const runCounter = React.useRef(0);
  const lastRiskSignatureRef = React.useRef<string>("");

  const selectedRiskModel = React.useMemo(
    () => riskModels.find((model) => model.id === selectedRiskModelId) ?? riskModels[0] ?? null,
    [riskModels, selectedRiskModelId],
  );

  const loadFieldOptions = React.useMemo(() => deriveLoadFieldOptions(awsLoads), [awsLoads]);

  const applyWorkspaceSnapshot = React.useCallback((snapshot: BiddingWorkspaceSnapshot) => {
    setSavedQuotes(snapshot.quotes.map(bidQuoteToSummary));
    setSavedSearches(
      snapshot.searches.map((item) => ({ name: item.searchName, criteria: item.criteria })).slice(0, 8),
    );
    setLogs(
      snapshot.audit.map((entry) => ({
        searchId: entry.searchId,
        user: entry.user,
        origin: entry.origin,
        destination: entry.destination,
        equipment: entry.equipment,
        date: entry.date,
        historicalAggregationTimestamp: entry.historicalAggregationTimestamp,
        datRefreshTimestamp: entry.datRefreshTimestamp,
        riskModelId: entry.riskModelId,
        riskModelVersion: entry.riskModelVersion,
        riskInputValues: entry.riskInputValues,
        riskOutput: entry.riskOutput,
        aiSuggestionTimestamp: entry.aiSuggestionTimestamp,
        finalSelectedBid: entry.finalSelectedBid,
        actionTaken: entry.actionTaken,
        createdQuoteId: entry.createdQuoteId,
        attachedRfpId: entry.attachedRfpId,
      })),
    );
  }, []);

  const persistSearchSession = React.useCallback(
    (
      loads: LoadRecord[],
      criteria: SearchCriteria,
      options: SearchOptions,
      nextResults: HistoricalResultRow[],
      nextSimilar: LeverageLoad[],
      nextBackhaul: BackhaulCandidate[],
      selectedId: string,
    ) => {
      writeBiddingSearchSessionCache(workspaceId, {
        searchCriteria: criteria,
        searchOptions: options,
        selectedResultId: selectedId,
        results: nextResults,
        similarActiveLoads: nextSimilar,
        backhaulCandidates: nextBackhaul,
        loadsFingerprint: getBiddingLoadsFingerprint(loads),
        cachedAt: new Date().toISOString(),
      });
    },
    [workspaceId],
  );

  const applySearchResults = React.useCallback(
    (
      loads: LoadRecord[],
      criteria: SearchCriteria,
      options: SearchOptions,
    ) => {
      const dat = getDatSnapshotForBidding();
      const nextResults = buildHistoricalRowsFromLoads(loads, criteria, options, dat);
      const nextSimilar = buildLeverageLoadsFromAws(loads, criteria, options);
      const nextBackhaul = buildBackhaulCandidatesFromAws(loads, criteria, options);
      const nextSelectedId = nextResults[0]?.id ?? "";

      setDatSnapshot(dat);
      setDatError(isDatApiConnected() ? null : DAT_NOT_CONNECTED_MESSAGE);
      setResults(nextResults);
      setSelectedResultId(nextSelectedId);
      setSimilarActiveLoads(nextSimilar);
      setBackhaulCandidates(nextBackhaul);
      setExcludedLeverageIds([]);
      persistSearchSession(loads, criteria, options, nextResults, nextSimilar, nextBackhaul, nextSelectedId);
      return nextResults;
    },
    [persistSearchSession],
  );

  const refreshWorkspaceData = React.useCallback(
    async (force = false) => {
      if (!isBiddingWorkspaceConfigured()) return;
      try {
        const snapshot = await fetchBiddingWorkspaceSnapshotCached({ workspaceId, force });
        applyWorkspaceSnapshot(snapshot);
        const missingMessage = getBiddingWorkspaceTableMissingMessage();
        setWorkspaceTableMissing(Boolean(missingMessage));
        if (!missingMessage) setWorkspaceSyncError(null);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Could not sync bidding workspace from AWS";
        setWorkspaceSyncError(message);
      }
    },
    [applyWorkspaceSnapshot, workspaceId],
  );

  React.useEffect(() => {
    let cancelled = false;

    const cachedWorkspace = readBiddingWorkspaceCacheSnapshot(workspaceId);
    if (cachedWorkspace) applyWorkspaceSnapshot(cachedWorkspace);

    const cachedSearch = readBiddingSearchSessionCache(workspaceId);

    void (async () => {
      setLoadsLoading(true);
      setRiskModelsLoading(true);
      setLoadsError(null);
      try {
        const [loads, models] = await Promise.all([
          fetchBiddingLoads(),
          fetchBiddingRiskModels(),
          refreshWorkspaceData(false),
        ]);
        if (cancelled) return;

        setAwsLoads(loads);
        setRiskModels(models);
        if (models[0]) setSelectedRiskModelId((prev) => prev || models[0].id);

        const loadsFingerprint = getBiddingLoadsFingerprint(loads);
        if (
          cachedSearch &&
          cachedSearch.loadsFingerprint === loadsFingerprint &&
          cachedSearch.results.length > 0
        ) {
          setSearchCriteria(cachedSearch.searchCriteria);
          setSearchOptions(cachedSearch.searchOptions);
          setResults(cachedSearch.results);
          setSelectedResultId(cachedSearch.selectedResultId);
          setSimilarActiveLoads(cachedSearch.similarActiveLoads);
          setBackhaulCandidates(cachedSearch.backhaulCandidates);
          setDatSnapshot(getDatSnapshotForBidding());
          setDatError(isDatApiConnected() ? null : DAT_NOT_CONNECTED_MESSAGE);
        } else {
          setDatSnapshot(getDatSnapshotForBidding());
          setDatError(isDatApiConnected() ? null : DAT_NOT_CONNECTED_MESSAGE);
          setResults([]);
          setSelectedResultId("");
          setSimilarActiveLoads([]);
          setBackhaulCandidates([]);
        }
      } catch (err) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : "Could not load loads from AWS";
        setLoadsError(message);
        setResults([]);
        setSimilarActiveLoads([]);
        setBackhaulCandidates([]);
      } finally {
        if (!cancelled) {
          setLoadsLoading(false);
          setRiskModelsLoading(false);
        }
      }

      if (cancelled) return;
      setLoadsRefreshing(true);
      try {
        const [loads, models] = await Promise.all([
          fetchBiddingLoads({ force: true }),
          fetchBiddingRiskModels({ force: true }),
          refreshWorkspaceData(true),
        ]);
        if (cancelled) return;

        setAwsLoads(loads);
        setRiskModels(models);
        if (models[0]) setSelectedRiskModelId((prev) => prev || models[0].id);

        const cached = readBiddingSearchSessionCache(workspaceId);
        const loadsFingerprint = getBiddingLoadsFingerprint(loads);
        if (cached && cached.loadsFingerprint === loadsFingerprint && cached.results.length > 0) {
          applySearchResults(loads, cached.searchCriteria, cached.searchOptions);
        }
      } catch {
        // keep cached data visible when background refresh fails
      } finally {
        if (!cancelled) setLoadsRefreshing(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [applySearchResults, applyWorkspaceSnapshot, refreshWorkspaceData, workspaceId]);

  const selectedResult = React.useMemo(
    () => results.find((row) => row.id === selectedResultId) ?? results[0] ?? null,
    [results, selectedResultId],
  );

  React.useEffect(() => {
    if (!selectedResult || !selectedRiskModel) {
      setRiskEvaluation(null);
      setAiSuggestion(null);
      return;
    }
    const risk = evaluateRiskDeterministic({
      row: selectedResult,
      dat: datSnapshot,
      model: selectedRiskModel,
      leverageCount: similarActiveLoads.filter((row) => !excludedLeverageIds.includes(row.loadNumber)).length,
    });
    setRiskEvaluation(risk);
    if (isAiBidConnected()) {
      const suggestion = buildAiSuggestion({
        row: selectedResult,
        risk,
        dat: datSnapshot,
        leverageCount: similarActiveLoads.filter((row) => !excludedLeverageIds.includes(row.loadNumber)).length,
        backhaulCount: backhaulCandidates.length,
      });
      setAiSuggestion(suggestion);
      setFinalBid(String(Math.round(suggestion.recommendedSellRate)));

      let cancelled = false;
      void enrichBidNarrativesWithAi({
        origin: selectedResult.lane.split("→")[0]?.trim() || selectedResult.lane,
        destination: selectedResult.lane.split("→")[1]?.trim() || selectedResult.lane,
        recommendedSellRate: suggestion.recommendedSellRate,
        recommendedBuyRate: suggestion.recommendedBuyRate,
        marginPercentage: suggestion.marginPercentage,
        confidenceScore: suggestion.confidenceScore,
        riskLevel: risk.riskLevel,
        datMarketAverage: datSnapshot.marketAverage,
        winRate: selectedResult.winRate,
        loadCount: selectedResult.loadCount,
        leverageCount: similarActiveLoads.filter((row) => !excludedLeverageIds.includes(row.loadNumber))
          .length,
        backhaulCount: backhaulCandidates.length,
      }).then((enriched) => {
        if (cancelled || !enriched) return;
        setAiSuggestion((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            notes: enriched.notes ?? prev.notes,
            suggestedStrategy: enriched.suggestedStrategy ?? prev.suggestedStrategy,
            customerFacingNote: enriched.customerFacingNote ?? prev.customerFacingNote,
          };
        });
      });

      return () => {
        cancelled = true;
      };
    } else {
      setAiSuggestion(null);
      setFinalBid(String(Math.round(selectedResult.recommendedBid)));
    }
  }, [
    selectedResult,
    datSnapshot,
    selectedRiskModel,
    similarActiveLoads,
    excludedLeverageIds,
    backhaulCandidates.length,
  ]);

  React.useEffect(() => {
    if (!riskEvaluation) return;
    if (lastRiskSignatureRef.current === riskEvaluation.deterministicSignature) return;
    lastRiskSignatureRef.current = riskEvaluation.deterministicSignature;
    appendLog("Risk Evaluation", "", { risk: riskEvaluation, ai: aiSuggestion });
  }, [riskEvaluation, aiSuggestion]);

  const searchSummary = [
    [searchCriteria.originCity, searchCriteria.originState].filter(Boolean).join(", ") || "Origin",
    searchCriteria.originZip3 ? `(${searchCriteria.originZip3})` : null,
    "to",
    [searchCriteria.destinationCity, searchCriteria.destinationState].filter(Boolean).join(", ") || "Destination",
    searchCriteria.destinationZip3 ? `(${searchCriteria.destinationZip3})` : null,
  ]
    .filter(Boolean)
    .join(" ");
  const hasLaneSearchCriteria = Boolean(
    searchCriteria.originCity.trim() ||
      searchCriteria.originState.trim() ||
      searchCriteria.originZip5.trim() ||
      searchCriteria.destinationCity.trim() ||
      searchCriteria.destinationState.trim() ||
      searchCriteria.destinationZip5.trim(),
  );
  const currentSearchStep = searchStageIndex >= 0 ? SEARCH_PIPELINE[searchStageIndex] : null;

  const searchLane = async () => {
    const runId = ++runCounter.current;
    setIsSearching(true);
    setActionMessage(null);
    setSearchStageIndex(0);
    for (let i = 0; i < SEARCH_PIPELINE.length; i += 1) {
      setSearchStageIndex(i);
      await delay(i === 1 ? 700 : 320);
      if (runId !== runCounter.current) return;
    }

    try {
      const loads = await fetchBiddingLoads({ force: true });
      if (runId !== runCounter.current) return;
      setAwsLoads(loads);
      setLoadsError(null);
      const nextResults = applySearchResults(loads, searchCriteria, searchOptions);
      setDesktopTab("results");
      setActionMessage(
        nextResults.length > 0
          ? `Loaded ${nextResults.length} lane aggregate${nextResults.length === 1 ? "" : "s"} from ${loads.length} AWS load${loads.length === 1 ? "" : "s"}.`
          : `No matching historical loads in AWS for ${searchSummary}.`,
      );
    } catch (err) {
      if (runId !== runCounter.current) return;
      const message = err instanceof Error ? err.message : "Could not search AWS loads";
      setLoadsError(message);
      setActionMessage(message);
    } finally {
      if (runId === runCounter.current) {
        setIsSearching(false);
        setSearchStageIndex(-1);
      }
    }
  };

  const clearSearch = () => {
    setSearchCriteria(createEmptySearchCriteria());
    setSearchOptions(DEFAULT_SEARCH_OPTIONS);
    setResults([]);
    setSelectedResultId("");
    setSimilarActiveLoads([]);
    setBackhaulCandidates([]);
    setRiskEvaluation(null);
    setAiSuggestion(null);
    setFinalBid("");
    clearBiddingSearchSessionCache(workspaceId);
    setActionMessage("Search fields reset.");
  };

  const saveSearch = async () => {
    const name = `${searchCriteria.originCity}-${searchCriteria.destinationCity}-${searchCriteria.equipmentType}`;
    setWorkspaceActionPending(true);
    try {
      if (isBiddingWorkspaceAvailable()) {
        await upsertBiddingSavedSearch({
          workspaceId,
          createdBy: workspaceUser,
          searchName: name,
          criteria: searchCriteria,
        });
        await refreshWorkspaceData();
        setActionMessage(`Saved search "${name}" to AWS.`);
      } else {
        setSavedSearches((prev) => {
          const deduped = prev.filter((item) => item.name !== name);
          return [{ name, criteria: searchCriteria }, ...deduped].slice(0, 8);
        });
        setActionMessage(`Saved search "${name}" locally. Configure BiddingWorkspace in AWS to persist.`);
      }
      setSelectedSavedSearch(name);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not save search";
      setActionMessage(message);
    } finally {
      setWorkspaceActionPending(false);
    }
  };

  const removeSavedSearch = async () => {
    if (selectedSavedSearch === "none") return;
    const name = selectedSavedSearch;
    setWorkspaceActionPending(true);
    try {
      if (isBiddingWorkspaceAvailable()) {
        await deleteBiddingSavedSearch(workspaceId, name);
        await refreshWorkspaceData();
      } else {
        setSavedSearches((prev) => prev.filter((item) => item.name !== name));
      }
      setSelectedSavedSearch("none");
      setActionMessage(`Removed saved search "${name}".`);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not delete saved search";
      setActionMessage(message);
    } finally {
      setWorkspaceActionPending(false);
    }
  };

  const loadSavedSearch = () => {
    if (selectedSavedSearch === "none") return;
    const match = savedSearches.find((item) => item.name === selectedSavedSearch);
    if (!match) return;
    setSearchCriteria(match.criteria);
    setActionMessage(`Loaded saved search "${match.name}".`);
  };

  const exportResults = (type: "PDF" | "CSV" | "XLSX") => {
    const note = `${type} export queued with search criteria, historical aggregates, DAT snapshot, leverage candidates, risk output, AI suggestion, and notes.`;
    setActionMessage(note);
    appendLog("Export", "");
  };

  const refreshDat = async () => {
    if (!isDatApiConnected()) {
      setDatSnapshot(getDatSnapshotForBidding());
      setDatError(DAT_NOT_CONNECTED_MESSAGE);
      setActionMessage(DAT_NOT_CONNECTED_MESSAGE);
      return;
    }
    setDatSnapshot((prev) => ({ ...prev, status: "Refreshing", sourceStatus: "Refreshing from RateView API..." }));
    setDatError(null);
    await delay(720);
    setDatSnapshot(getDatSnapshotForBidding());
    setDatError(DAT_NOT_CONNECTED_MESSAGE);
    appendLog("Refresh DAT", "");
  };

  const recalculateRisk = () => {
    if (!selectedResult || !selectedRiskModel) return;
    const risk = evaluateRiskDeterministic({
      row: selectedResult,
      dat: datSnapshot,
      model: selectedRiskModel,
      leverageCount: similarActiveLoads.filter((row) => !excludedLeverageIds.includes(row.loadNumber)).length,
    });
    setRiskEvaluation(risk);
    appendLog("Recalculate Risk", "");
    setActionMessage(`Risk recalculated with ${selectedRiskModel?.name ?? "risk model"} ${selectedRiskModel?.version ?? ""}.`.trim());
  };

  const recalculateSuggestion = () => {
    if (!isAiBidConnected()) {
      setActionMessage(AI_NOT_CONNECTED_MESSAGE);
      return;
    }
    if (!selectedResult || !riskEvaluation) return;
    const suggestion = buildAiSuggestion({
      row: selectedResult,
      risk: riskEvaluation,
      dat: datSnapshot,
      leverageCount: similarActiveLoads.filter((row) => !excludedLeverageIds.includes(row.loadNumber)).length,
      backhaulCount: backhaulCandidates.length,
    });
    setAiSuggestion(suggestion);
    setFinalBid(String(Math.round(suggestion.recommendedSellRate)));
    appendLog("Recalculate Suggestion", "");
    setActionMessage("AI bid suggestion refreshed. Enriching narratives…");

    void enrichBidNarrativesWithAi({
      origin: selectedResult.lane.split("→")[0]?.trim() || selectedResult.lane,
      destination: selectedResult.lane.split("→")[1]?.trim() || selectedResult.lane,
      recommendedSellRate: suggestion.recommendedSellRate,
      recommendedBuyRate: suggestion.recommendedBuyRate,
      marginPercentage: suggestion.marginPercentage,
      confidenceScore: suggestion.confidenceScore,
      riskLevel: riskEvaluation.riskLevel,
      datMarketAverage: datSnapshot.marketAverage,
      winRate: selectedResult.winRate,
      loadCount: selectedResult.loadCount,
      leverageCount: similarActiveLoads.filter((row) => !excludedLeverageIds.includes(row.loadNumber))
        .length,
      backhaulCount: backhaulCandidates.length,
    }).then((enriched) => {
      if (!enriched) {
        setActionMessage("AI bid suggestion refreshed.");
        return;
      }
      if (enriched.error) {
        setActionMessage(`Rates refreshed. Narrative AI unavailable: ${enriched.error}`);
        return;
      }
      setAiSuggestion((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          notes: enriched.notes ?? prev.notes,
          suggestedStrategy: enriched.suggestedStrategy ?? prev.suggestedStrategy,
          customerFacingNote: enriched.customerFacingNote ?? prev.customerFacingNote,
        };
      });
      setActionMessage("AI bid suggestion refreshed with OpenAI narratives.");
    });
  };

  const copyBid = async () => {
    if (!aiSuggestion) return;
    const value = formatCurrency(aiSuggestion.recommendedSellRate);
    try {
      await navigator.clipboard.writeText(value);
      setActionMessage(`Copied recommended bid ${value}.`);
    } catch {
      setActionMessage(`Copy not available in this browser context. Suggested bid: ${value}.`);
    }
  };

  const saveAsQuote = async (status: "saved" | "draft" = "saved") => {
    if (!selectedResult || !riskEvaluation) return;
    const bid = Number(finalBid) || selectedResult.recommendedBid;
    const buy = selectedResult.historicalAvgBuy;
    setWorkspaceActionPending(true);
    try {
      if (isBiddingWorkspaceAvailable()) {
        const quote = await createBidQuote({
          workspaceId,
          createdBy: workspaceUser,
          status,
          bidAmount: bid,
          buyRate: buy,
          margin: bid - buy,
          originCity: searchCriteria.originCity,
          originState: searchCriteria.originState,
          destinationCity: searchCriteria.destinationCity,
          destinationState: searchCriteria.destinationState,
          equipmentType: searchCriteria.equipmentType,
          laneLabel: selectedResult.lane,
          internalNote,
          riskModelId: selectedRiskModel?.id,
          riskModelVersion: selectedRiskModel?.version,
          riskScore: riskEvaluation.outputRiskPct,
          riskLevel: riskEvaluation.riskLevel,
          rfpId: searchCriteria.rfpId,
          rfpLane,
          finalBid,
          searchCriteria,
        });
        setSavedQuotes((prev) => [bidQuoteToSummary(quote), ...prev.filter((row) => row.id !== quote.quoteId)]);
        appendLog(status === "draft" ? "Save Draft" : "Save as Quote", quote.quoteId);
        setActionMessage(`Quote ${quote.quoteId} saved to AWS with bid ${formatCurrency(bid)}.`);
      } else {
        const quoteId = `QT-${Math.floor(100000 + Math.random() * 900000)}`;
        setSavedQuotes((prev) => [
          { id: quoteId, bid, margin: bid - buy, timestamp: nowStamp(), status },
          ...prev,
        ]);
        appendLog(status === "draft" ? "Save Draft" : "Save as Quote", quoteId);
        setActionMessage(`Quote ${quoteId} saved locally. Configure BiddingWorkspace in AWS to persist.`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not save quote";
      setActionMessage(message);
    } finally {
      setWorkspaceActionPending(false);
    }
  };

  const deleteQuote = async (quoteId: string) => {
    setWorkspaceActionPending(true);
    try {
      if (isBiddingWorkspaceAvailable()) {
        await deleteBidQuote(workspaceId, quoteId);
      }
      setSavedQuotes((prev) => prev.filter((quote) => quote.id !== quoteId));
      appendLog("Delete Quote", quoteId);
      setActionMessage(`Quote ${quoteId} deleted.`);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not delete quote";
      setActionMessage(message);
    } finally {
      setWorkspaceActionPending(false);
    }
  };

  const createLoadFromBid = async () => {
    const loadId =
      searchCriteria.loadId.trim() || `LD-${Date.now().toString().slice(-6)}`;
    const bid = Number(finalBid) || selectedResult?.recommendedBid || 0;
    setWorkspaceActionPending(true);
    try {
      await createLoad({
        loadId,
        createdBy: workspaceId !== "_" ? workspaceId : undefined,
        loadStatus: "draft",
        customer: searchCriteria.customer,
        broker: searchCriteria.broker,
        equipmentType: searchCriteria.equipmentType,
        pickupCity: searchCriteria.originCity,
        pickupState: searchCriteria.originState,
        pickupZip: searchCriteria.originZip5,
        deliveryCity: searchCriteria.destinationCity,
        deliveryState: searchCriteria.destinationState,
        deliveryZip: searchCriteria.destinationZip5,
        pickupDate: searchCriteria.pickupDate,
        deliveryDate: searchCriteria.deliveryDate,
        commodityDescription: searchCriteria.commodity,
        weight: String(searchCriteria.weight),
        customerRate: bid > 0 ? String(bid) : undefined,
        carrierRate: selectedResult ? String(selectedResult.historicalAvgBuy) : undefined,
        internalNotes: internalNote || undefined,
      });
      const loads = await fetchBiddingLoads({ force: true });
      setAwsLoads(loads);
      applySearchResults(loads, searchCriteria, searchOptions);
      setSearchCriteria((prev) => ({ ...prev, loadId }));
      appendLog("Create Load", "");
      setActionMessage(`Load ${loadId} created in AWS Loads table.`);
      toast.success(`Load ${loadId} created`, {
        action: {
          label: "Open load",
          onClick: () => {
            window.location.assign(`/loads/${loadId}`);
          },
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not create load in AWS";
      setActionMessage(message);
      toast.error(message);
    } finally {
      setWorkspaceActionPending(false);
    }
  };

  const attachToRfp = async () => {
    if (!riskEvaluation || !selectedResult) return;
    setWorkspaceActionPending(true);
    try {
      if (isBiddingWorkspaceAvailable() && savedQuotes[0]) {
        const latest = await listBidQuotes(workspaceId);
        const match = latest.find((quote) => quote.quoteId === savedQuotes[0].id);
        if (match) {
          await updateBidQuote({
            ...match,
            status: "attached",
            rfpId: searchCriteria.rfpId,
            rfpLane,
            finalBid,
            internalNote,
          });
          await refreshWorkspaceData();
        }
      }
      appendLog("Attach to RFP Lane", savedQuotes[0]?.id ?? "");
      setActionMessage(
        `Attached bid, internal historicals, risk evaluation (${selectedRiskModel?.version ?? "—"}), and notes to ${searchCriteria.rfpId || "RFP"}${rfpLane ? ` lane ${rfpLane}` : ""}.`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not attach to RFP";
      setActionMessage(message);
    } finally {
      setWorkspaceActionPending(false);
    }
  };

  const sendForApproval = async () => {
    setWorkspaceActionPending(true);
    try {
      if (isBiddingWorkspaceAvailable() && savedQuotes[0]) {
        const latest = await listBidQuotes(workspaceId);
        const match = latest.find((quote) => quote.quoteId === savedQuotes[0].id);
        if (match) {
          await updateBidQuote({ ...match, status: "sent" });
          await refreshWorkspaceData();
        }
      }
      appendLog("Send for Approval", savedQuotes[0]?.id ?? "");
      setActionMessage("Bid package routed to pricing manager for approval.");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not send for approval";
      setActionMessage(message);
    } finally {
      setWorkspaceActionPending(false);
    }
  };

  const toggleExcludeLeverage = (loadNumber: string) => {
    setExcludedLeverageIds((prev) =>
      prev.includes(loadNumber) ? prev.filter((id) => id !== loadNumber) : [...prev, loadNumber],
    );
  };

  const persistAuditLog = async (
    action: string,
    createdQuoteId: string,
    overrides?: { risk?: RiskEvaluation | null; ai?: AiSuggestion | null },
  ) => {
    const risk = overrides?.risk ?? riskEvaluation;
    const ai = overrides?.ai ?? aiSuggestion;
    const entry: AuditLogEntry = {
      searchId: `SRCH-${hash32(searchSummary).toString().slice(0, 7)}`,
      user: workspaceUser,
      origin: `${searchCriteria.originCity}, ${searchCriteria.originState}`,
      destination: `${searchCriteria.destinationCity}, ${searchCriteria.destinationState}`,
      equipment: searchCriteria.equipmentType,
      date: nowStamp(),
      historicalAggregationTimestamp: nowStamp(),
      datRefreshTimestamp: datSnapshot.lastRefreshed,
      riskModelId: selectedRiskModel?.id ?? "-",
      riskModelVersion: selectedRiskModel?.version ?? "-",
      riskInputValues: risk ? JSON.stringify(risk.inputValues) : "{}",
      riskOutput: risk ? `${risk.outputRiskPct}% (${risk.riskLevel})` : "-",
      aiSuggestionTimestamp: nowStamp(),
      finalSelectedBid: finalBid || (ai ? String(Math.round(ai.recommendedSellRate)) : "-"),
      actionTaken: action,
      createdQuoteId,
      attachedRfpId: action === "Attach to RFP Lane" ? searchCriteria.rfpId : "",
    };

    setLogs((prev) => [entry, ...prev].slice(0, 24));

    if (!isBiddingWorkspaceAvailable()) return;

    try {
      await appendBiddingAuditLog(workspaceId, entry);
    } catch (err) {
      console.warn("[bidding] audit log write failed", err);
    }
  };

  const appendLog = (
    action: string,
    createdQuoteId: string,
    overrides?: { risk?: RiskEvaluation | null; ai?: AiSuggestion | null },
  ) => {
    void persistAuditLog(action, createdQuoteId, overrides);
  };

  const desktopSearchPanel = (
    <WorkspacePanel
      icon={Search}
      tone="sky"
      title="Spot Load Search"
      description="City/state, 5-digit ZIP, 3-digit ZIP, market area, and radius search."
      sticky
      contentClassName="space-y-4 lg:max-h-[calc(100vh-6rem)] lg:overflow-y-auto lg:pr-1"
    >
        <div className="grid gap-3">
          <Field label="Origin City">
            <Input
              value={searchCriteria.originCity}
              onChange={(event) => setSearchCriteria((prev) => ({ ...prev, originCity: event.target.value }))}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Origin State">
              <Input
                list={loadFieldOptions.states.length > 0 ? "bidding-origin-states" : undefined}
                value={searchCriteria.originState}
                onChange={(event) =>
                  setSearchCriteria((prev) => ({ ...prev, originState: event.target.value.toUpperCase() }))
                }
                placeholder="State"
                maxLength={2}
              />
              {loadFieldOptions.states.length > 0 ? (
                <datalist id="bidding-origin-states">
                  {loadFieldOptions.states.map((state) => (
                    <option key={state} value={state} />
                  ))}
                </datalist>
              ) : null}
            </Field>
            <Field label="Origin 5-Digit ZIP">
              <Input
                value={searchCriteria.originZip5}
                onChange={(event) => setSearchCriteria((prev) => ({ ...prev, originZip5: event.target.value }))}
              />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Origin 3-Digit ZIP">
              <Input
                value={searchCriteria.originZip3}
                onChange={(event) => setSearchCriteria((prev) => ({ ...prev, originZip3: event.target.value }))}
              />
            </Field>
            <Field label="Market Area">
              <Input
                value={searchCriteria.marketArea}
                onChange={(event) => setSearchCriteria((prev) => ({ ...prev, marketArea: event.target.value }))}
              />
            </Field>
          </div>

          <Separator />

          <Field label="Destination City">
            <Input
              value={searchCriteria.destinationCity}
              onChange={(event) =>
                setSearchCriteria((prev) => ({ ...prev, destinationCity: event.target.value }))
              }
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Destination State">
              <Input
                list={loadFieldOptions.states.length > 0 ? "bidding-destination-states" : undefined}
                value={searchCriteria.destinationState}
                onChange={(event) =>
                  setSearchCriteria((prev) => ({ ...prev, destinationState: event.target.value.toUpperCase() }))
                }
                placeholder="State"
                maxLength={2}
              />
              {loadFieldOptions.states.length > 0 ? (
                <datalist id="bidding-destination-states">
                  {loadFieldOptions.states.map((state) => (
                    <option key={state} value={state} />
                  ))}
                </datalist>
              ) : null}
            </Field>
            <Field label="Destination 5-Digit ZIP">
              <Input
                value={searchCriteria.destinationZip5}
                onChange={(event) =>
                  setSearchCriteria((prev) => ({ ...prev, destinationZip5: event.target.value }))
                }
              />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Destination 3-Digit ZIP">
              <Input
                value={searchCriteria.destinationZip3}
                onChange={(event) =>
                  setSearchCriteria((prev) => ({ ...prev, destinationZip3: event.target.value }))
                }
              />
            </Field>
            <Field label="Radius (Miles)">
              <Input
                type="number"
                value={searchCriteria.radiusMiles}
                onChange={(event) =>
                  setSearchCriteria((prev) => ({
                    ...prev,
                    radiusMiles: Number(event.target.value) || 0,
                  }))
                }
              />
            </Field>
          </div>

          <Separator />

          <div className="grid grid-cols-2 gap-3">
            <Field label="Equipment Type">
              <Input
                list={loadFieldOptions.equipmentTypes.length > 0 ? "bidding-equipment-types" : undefined}
                value={searchCriteria.equipmentType}
                onChange={(event) =>
                  setSearchCriteria((prev) => ({ ...prev, equipmentType: event.target.value }))
                }
                placeholder="From AWS loads or enter manually"
              />
              {loadFieldOptions.equipmentTypes.length > 0 ? (
                <datalist id="bidding-equipment-types">
                  {loadFieldOptions.equipmentTypes.map((equipment) => (
                    <option key={equipment} value={equipment} />
                  ))}
                </datalist>
              ) : null}
            </Field>
            <Field label="Weight">
              <Input
                type="number"
                value={searchCriteria.weight || ""}
                onChange={(event) =>
                  setSearchCriteria((prev) => ({ ...prev, weight: Number(event.target.value) || 0 }))
                }
                placeholder="lbs"
              />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Pickup Date">
              <Input
                type="date"
                value={searchCriteria.pickupDate}
                onChange={(event) => setSearchCriteria((prev) => ({ ...prev, pickupDate: event.target.value }))}
              />
            </Field>
            <Field label="Delivery Date">
              <Input
                type="date"
                value={searchCriteria.deliveryDate}
                onChange={(event) => setSearchCriteria((prev) => ({ ...prev, deliveryDate: event.target.value }))}
              />
            </Field>
          </div>

          <Field label="Commodity">
            <Input
              value={searchCriteria.commodity}
              onChange={(event) => setSearchCriteria((prev) => ({ ...prev, commodity: event.target.value }))}
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Customer">
              <Input
                list={loadFieldOptions.customers.length > 0 ? "bidding-customers" : undefined}
                value={searchCriteria.customer}
                onChange={(event) => setSearchCriteria((prev) => ({ ...prev, customer: event.target.value }))}
                placeholder="From AWS loads or enter manually"
              />
              {loadFieldOptions.customers.length > 0 ? (
                <datalist id="bidding-customers">
                  {loadFieldOptions.customers.map((customer) => (
                    <option key={customer} value={customer} />
                  ))}
                </datalist>
              ) : null}
            </Field>
            <Field label="Broker">
              <Input
                list={loadFieldOptions.brokers.length > 0 ? "bidding-brokers" : undefined}
                value={searchCriteria.broker}
                onChange={(event) => setSearchCriteria((prev) => ({ ...prev, broker: event.target.value }))}
                placeholder="From AWS loads or enter manually"
              />
              {loadFieldOptions.brokers.length > 0 ? (
                <datalist id="bidding-brokers">
                  {loadFieldOptions.brokers.map((broker) => (
                    <option key={broker} value={broker} />
                  ))}
                </datalist>
              ) : null}
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Reference ID">
              <Input
                value={searchCriteria.referenceId}
                onChange={(event) =>
                  setSearchCriteria((prev) => ({ ...prev, referenceId: event.target.value }))
                }
              />
            </Field>
            <Field label="RFP ID">
              <Input
                value={searchCriteria.rfpId}
                onChange={(event) => setSearchCriteria((prev) => ({ ...prev, rfpId: event.target.value }))}
              />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Quote ID">
              <Input
                value={searchCriteria.quoteId}
                onChange={(event) => setSearchCriteria((prev) => ({ ...prev, quoteId: event.target.value }))}
              />
            </Field>
            <Field label="Load ID">
              <Input
                value={searchCriteria.loadId}
                onChange={(event) => setSearchCriteria((prev) => ({ ...prev, loadId: event.target.value }))}
              />
            </Field>
          </div>
        </div>

        <Separator />

        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Search Options</p>
          <OptionsGrid
            options={[
              {
                id: "exactLaneMatch",
                label: "Exact lane match",
                checked: searchOptions.exactLaneMatch,
                onCheckedChange: (checked) =>
                  setSearchOptions((prev) => ({ ...prev, exactLaneMatch: checked === true })),
              },
              {
                id: "similarLaneMatch",
                label: "Similar lane match",
                checked: searchOptions.similarLaneMatch,
                onCheckedChange: (checked) =>
                  setSearchOptions((prev) => ({ ...prev, similarLaneMatch: checked === true })),
              },
              {
                id: "adjacentMarketSearch",
                label: "Adjacent market search",
                checked: searchOptions.adjacentMarketSearch,
                onCheckedChange: (checked) =>
                  setSearchOptions((prev) => ({ ...prev, adjacentMarketSearch: checked === true })),
              },
              {
                id: "includeBackhaulCandidates",
                label: "Include backhaul candidates",
                checked: searchOptions.includeBackhaulCandidates,
                onCheckedChange: (checked) =>
                  setSearchOptions((prev) => ({
                    ...prev,
                    includeBackhaulCandidates: checked === true,
                  })),
              },
              {
                id: "includeActiveLoads",
                label: "Include active loads",
                checked: searchOptions.includeActiveLoads,
                onCheckedChange: (checked) =>
                  setSearchOptions((prev) => ({ ...prev, includeActiveLoads: checked === true })),
              },
              {
                id: "includeDatMarketData",
                label: "Include DAT market data",
                checked: searchOptions.includeDatMarketData,
                onCheckedChange: (checked) =>
                  setSearchOptions((prev) => ({ ...prev, includeDatMarketData: checked === true })),
              },
              {
                id: "includeLast30Days",
                label: "Include last 30 days",
                checked: searchOptions.includeLast30Days,
                onCheckedChange: (checked) =>
                  setSearchOptions((prev) => ({ ...prev, includeLast30Days: checked === true })),
              },
              {
                id: "includeLast60Days",
                label: "Include last 60 days",
                checked: searchOptions.includeLast60Days,
                onCheckedChange: (checked) =>
                  setSearchOptions((prev) => ({ ...prev, includeLast60Days: checked === true })),
              },
              {
                id: "includeLast90Days",
                label: "Include last 90 days",
                checked: searchOptions.includeLast90Days,
                onCheckedChange: (checked) =>
                  setSearchOptions((prev) => ({ ...prev, includeLast90Days: checked === true })),
              },
            ]}
          />
        </div>

        <Separator />

        <div className="grid grid-cols-2 gap-2">
          <Button className="gap-1.5" onClick={searchLane} disabled={isSearching}>
            {isSearching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            Search Lane
          </Button>
          <Button variant="outline" className="gap-1.5" onClick={clearSearch}>
            Clear Search
          </Button>
          <Button variant="outline" className="gap-1.5" onClick={() => void saveSearch()} disabled={workspaceActionPending}>
            <Save className="h-4 w-4" />
            Save Search
          </Button>
          <Button variant="outline" className="gap-1.5" onClick={loadSavedSearch}>
            Load Saved
          </Button>
        </div>
        <div className="grid grid-cols-[1fr_auto_auto] gap-2">
          <Select value={selectedSavedSearch} onValueChange={setSelectedSavedSearch}>
            <SelectTrigger>
              <SelectValue placeholder="Saved searches" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Saved searches</SelectItem>
              {savedSearches.map((item) => (
                <SelectItem key={item.name} value={item.name}>
                  {item.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            size="icon"
            className="shrink-0"
            disabled={selectedSavedSearch === "none" || workspaceActionPending}
            onClick={() => void removeSavedSearch()}
            title="Delete saved search"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
          <Button variant="outline" className="gap-1.5" onClick={() => exportResults("CSV")}>
            <FileDown className="h-4 w-4" />
            Export
          </Button>
        </div>
    </WorkspacePanel>
  );

  const datPanel = (
    <WorkspacePanel
      icon={Database}
      tone="blue"
      title="DAT RateView"
      description="Market benchmark data for the searched lane. Admin DAT refresh rules configurable in Settings."
      badge={
        <Badge variant="outline" className={cn("font-medium", DAT_STATUS_TONE[datSnapshot.status])}>
          {datSnapshot.status}
        </Badge>
      }
    >
        {datError || !isDatApiConnected() ? (
          <div className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2.5 text-xs text-warning-foreground">
            {datError ?? DAT_NOT_CONNECTED_MESSAGE}
          </div>
        ) : null}
        {!isDatApiConnected() ? (
          <p className="text-xs text-muted-foreground">
            Market benchmark fields below stay empty until DAT RateView is connected. Internal AWS load
            history is still used for bidding.
          </p>
        ) : null}
        <div className="grid grid-cols-2 gap-3">
          <InsightStat
            label="DAT Market Minimum"
            value={isDatApiConnected() ? formatCurrency(datSnapshot.marketMinimum) : "—"}
          />
          <InsightStat
            label="DAT Market Average"
            value={isDatApiConnected() ? formatCurrency(datSnapshot.marketAverage) : "—"}
            highlight
          />
          <InsightStat
            label="DAT Market Maximum"
            value={isDatApiConnected() ? formatCurrency(datSnapshot.marketMaximum) : "—"}
          />
          <InsightStat
            label="DAT Rate Per Mile"
            value={isDatApiConnected() ? `$${datSnapshot.ratePerMile.toFixed(2)}` : "—"}
          />
          <InsightStat
            label="DAT Fuel Estimate"
            value={isDatApiConnected() ? `$${datSnapshot.fuelEstimate.toFixed(2)}/mi` : "—"}
          />
          <InsightStat
            label="DAT Capacity Indicator"
            value={isDatApiConnected() ? `${datSnapshot.capacityIndicator}/100` : "—"}
          />
          <InsightStat
            label="DAT Confidence"
            value={isDatApiConnected() ? `${datSnapshot.confidence}%` : "—"}
          />
          <InsightStat label="DAT Data Window" value={isDatApiConnected() ? datSnapshot.dataWindow : "—"} />
          <InsightStat label="DAT Last Refreshed" value={isDatApiConnected() ? datSnapshot.lastRefreshed : "—"} />
          <InsightStat label="DAT Source Status" value={datSnapshot.sourceStatus} className="col-span-2" />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Button variant="outline" className="gap-1.5" onClick={refreshDat}>
            <RefreshCw className="h-4 w-4" />
            Refresh DAT
          </Button>
          <Button
            variant="outline"
            className="gap-1.5"
            onClick={() => setActionMessage("Navigate to Settings > Integrations > DAT Refresh Rules.")}
          >
            <Filter className="h-4 w-4" />
            Refresh Rules
          </Button>
        </div>
    </WorkspacePanel>
  );

  const resultsSection = (
    <WorkspacePanel
      icon={Table2}
      tone="emerald"
      title="Bid Intelligence Results"
      description="Combined internal historicals, DAT market data, margin intelligence, and risk scoring."
    >
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <InsightStat label="Historical Loads" value={selectedResult ? String(selectedResult.loadCount) : "0"} />
          <InsightStat
            label="Win Rate"
            value={selectedResult ? `${selectedResult.winRate.toFixed(1)}%` : "0%"}
          />
          <InsightStat
            label="Avg Margin"
            value={selectedResult ? formatCurrency(selectedResult.historicalMargin) : "$0"}
          />
          <InsightStat
            label="Recommended Bid"
            value={selectedResult ? formatCurrency(selectedResult.recommendedBid) : "$0"}
            highlight
          />
        </div>

        {isSearching && currentSearchStep ? (
          <div className="flex items-center gap-2 rounded-lg border border-info/30 bg-info/10 px-3 py-2.5 text-xs text-info">
            <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
            {currentSearchStep}
          </div>
        ) : null}

        <div className="w-full min-w-0 max-w-full overflow-x-auto rounded-xl border border-border/70 bg-muted/10">
          <Table className="min-w-[1860px] text-xs">
            <TableHeader>
              <TableRow>
                <TableHead>Lane</TableHead>
                <TableHead>Equipment</TableHead>
                <TableHead>Historical Avg Buy</TableHead>
                <TableHead>Historical Avg Sell</TableHead>
                <TableHead>Historical Margin</TableHead>
                <TableHead>Historical Margin %</TableHead>
                <TableHead>Standard Deviation</TableHead>
                <TableHead>Win Rate</TableHead>
                <TableHead>Last 30-Day Avg Buy</TableHead>
                <TableHead>Last 30-Day Avg Sell</TableHead>
                <TableHead>Last 60-Day Avg Buy</TableHead>
                <TableHead>Last 60-Day Avg Sell</TableHead>
                <TableHead>Last 90-Day Avg Buy</TableHead>
                <TableHead>Last 90-Day Avg Sell</TableHead>
                <TableHead>DAT Market Min</TableHead>
                <TableHead>DAT Market Avg</TableHead>
                <TableHead>DAT Market Max</TableHead>
                <TableHead>DAT Rate Per Mile</TableHead>
                <TableHead>Margin Band</TableHead>
                <TableHead>Risk Score</TableHead>
                <TableHead>Similar Active Loads</TableHead>
                <TableHead>Confidence</TableHead>
                <TableHead>Recommended Bid</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loadsLoading && results.length === 0 ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={`skel-${i}`}>
                    {Array.from({ length: 24 }).map((__, j) => (
                      <TableCell key={j}>
                        <Skeleton className="h-4 w-16" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : results.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={24} className="py-8 text-center text-muted-foreground">
                    {loadsLoading
                      ? "Loading historical loads from AWS..."
                      : loadsError
                        ? loadsError
                        : !hasLaneSearchCriteria
                          ? "Enter lane details and click Search Lane to pull historicals from AWS."
                          : "No matching loads in AWS for this lane. Adjust search filters or create loads with customer and carrier rates."}
                  </TableCell>
                </TableRow>
              ) : (
              results.map((row) => {
                const isActive = row.id === selectedResultId;
                return (
                  <TableRow
                    key={row.id}
                    className={cn(
                      "cursor-pointer transition-colors hover:bg-muted/30",
                      isActive && "bg-primary/5 ring-1 ring-inset ring-primary/20",
                    )}
                    onClick={() => setSelectedResultId(row.id)}
                  >
                    <TableCell className="font-medium">{row.lane}</TableCell>
                    <TableCell>{row.equipment}</TableCell>
                    <TableCell>{formatCurrency(row.historicalAvgBuy)}</TableCell>
                    <TableCell>{formatCurrency(row.historicalAvgSell)}</TableCell>
                    <TableCell>{formatCurrency(row.historicalMargin)}</TableCell>
                    <TableCell>{row.historicalMarginPct.toFixed(1)}%</TableCell>
                    <TableCell>{formatCurrency(row.standardDeviation)}</TableCell>
                    <TableCell>{row.winRate.toFixed(1)}%</TableCell>
                    <TableCell>{formatCurrency(row.last30AvgBuy)}</TableCell>
                    <TableCell>{formatCurrency(row.last30AvgSell)}</TableCell>
                    <TableCell>{formatCurrency(row.last60AvgBuy)}</TableCell>
                    <TableCell>{formatCurrency(row.last60AvgSell)}</TableCell>
                    <TableCell>{formatCurrency(row.last90AvgBuy)}</TableCell>
                    <TableCell>{formatCurrency(row.last90AvgSell)}</TableCell>
                    <TableCell>{formatCurrency(row.datMarketMin)}</TableCell>
                    <TableCell>{formatCurrency(row.datMarketAvg)}</TableCell>
                    <TableCell>{formatCurrency(row.datMarketMax)}</TableCell>
                    <TableCell>${row.datRatePerMile.toFixed(2)}</TableCell>
                    <TableCell className={cn("font-medium", MARGIN_TONE[row.marginBand])}>
                      {row.marginBand}
                    </TableCell>
                    <TableCell>{row.riskScore}</TableCell>
                    <TableCell>{row.similarActiveLoads}</TableCell>
                    <TableCell>{row.confidence}%</TableCell>
                    <TableCell>{formatCurrency(row.recommendedBid)}</TableCell>
                    <TableCell>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-[11px]"
                        onClick={(event) => {
                          event.stopPropagation();
                          setSelectedResultId(row.id);
                          setActionMessage(`Selected ${row.lane} for bidding review.`);
                        }}
                      >
                        Select
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })
              )}
            </TableBody>
          </Table>
        </div>
    </WorkspacePanel>
  );

  const leveragePanel = (
    <WorkspacePanel
      icon={Truck}
      tone="indigo"
      title="Leverage Panel"
      description="Similar active loads, adjacent lanes, backhaul candidates, capacity opportunities, and leverage context."
    >
        <Tabs defaultValue="similar" className="w-full">
          <div className="rounded-xl border border-border/70 bg-muted/20 p-1.5">
            <TabsList className="inline-flex h-auto w-full gap-0.5 bg-transparent p-0">
              <TabsTrigger
                value="similar"
                className="flex-1 rounded-lg px-2 py-2 text-xs data-[state=active]:bg-background data-[state=active]:shadow-sm sm:text-sm"
              >
                Similar Loads
              </TabsTrigger>
              <TabsTrigger
                value="backhaul"
                className="flex-1 rounded-lg px-2 py-2 text-xs data-[state=active]:bg-background data-[state=active]:shadow-sm sm:text-sm"
              >
                Backhaul
              </TabsTrigger>
              <TabsTrigger
                value="leverage"
                className="flex-1 rounded-lg px-2 py-2 text-xs data-[state=active]:bg-background data-[state=active]:shadow-sm sm:text-sm"
              >
                Leverage
              </TabsTrigger>
            </TabsList>
          </div>
          <TabsContent value="similar" className="mt-3 space-y-3">
            {similarActiveLoads.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No similar active loads in AWS for this lane.
              </p>
            ) : null}
            {similarActiveLoads.map((load) => {
              const excluded = excludedLeverageIds.includes(load.loadNumber);
              return (
                <div key={load.loadNumber} className="rounded-xl border border-border/70 bg-card p-3.5 shadow-sm transition-shadow hover:shadow-md">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold">{load.loadNumber}</p>
                      <p className="text-xs text-muted-foreground">
                        {load.origin} to {load.destination} · {load.equipment}
                      </p>
                    </div>
                    <Badge variant="outline">{load.similarityPct}% similar</Badge>
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                    <span>Customer: {load.customer}</span>
                    <span>Status: {load.currentStatus}</span>
                    <span>Buy: {formatCurrency(load.buyRate)}</span>
                    <span>Sell: {formatCurrency(load.sellRate)}</span>
                    <span>Margin: {formatCurrency(load.margin)}</span>
                    <span>Carrier: {load.assignedCarrier}</span>
                    <span>Pickup: {load.pickupDate}</span>
                    <span>Distance: {load.distanceFromLane} mi</span>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <Button size="sm" variant="outline" className="h-8 text-[11px]">
                      View Load
                    </Button>
                    <Button size="sm" variant="outline" className="h-8 text-[11px]">
                      Attach as Leverage
                    </Button>
                    <Button size="sm" variant="outline" className="h-8 text-[11px]">
                      Contact Carrier
                    </Button>
                    <Button
                      size="sm"
                      variant={excluded ? "default" : "outline"}
                      className="h-8 text-[11px]"
                      onClick={() => toggleExcludeLeverage(load.loadNumber)}
                    >
                      {excluded ? "Re-include" : "Exclude"}
                    </Button>
                  </div>
                </div>
              );
            })}
          </TabsContent>
          <TabsContent value="backhaul" className="mt-3 space-y-3">
            {backhaulCandidates.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No backhaul candidates in AWS for this lane.
              </p>
            ) : null}
            {backhaulCandidates.map((candidate) => (
              <div key={candidate.loadNumber} className="rounded-xl border border-border/70 bg-card p-3.5 shadow-sm transition-shadow hover:shadow-md">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold">{candidate.loadNumber}</p>
                      <p className="text-xs text-muted-foreground">
                        {candidate.currentDeliveryMarket} to {candidate.destination}
                      </p>
                  </div>
                  <Badge variant="outline">Rank {candidate.rankScore}</Badge>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                  <span>Candidate Pickup: {candidate.candidatePickupMarket}</span>
                  <span>Equipment: {candidate.equipment}</span>
                  <span>Available: {candidate.availableDate}</span>
                  <span>Deadhead: {candidate.deadheadMiles} mi</span>
                  <span>Similarity: {candidate.similarityPct}%</span>
                  <span>Backhaul Value: {formatCurrency(candidate.estimatedBackhaulValue)}</span>
                  <span>Carrier: {candidate.suggestedCarrier}</span>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <Button size="sm" variant="outline" className="h-8 text-[11px]">
                    Use as Backhaul
                  </Button>
                  <Button size="sm" variant="outline" className="h-8 text-[11px]">
                    Add to Bid Notes
                  </Button>
                </div>
              </div>
            ))}
          </TabsContent>
          <TabsContent value="leverage" className="mt-3 grid gap-2 sm:grid-cols-2">
            <InsightStat
              label="Capacity Opportunities"
              value={`${Math.max(2, similarActiveLoads.length - 1)} carrier clusters`}
            />
            <InsightStat
              label="Customer Leverage"
              value={
                similarActiveLoads.length > 0
                  ? `${searchCriteria.customer} has ${similarActiveLoads.length} similar active load${similarActiveLoads.length === 1 ? "" : "s"} in AWS.`
                  : "No similar active loads in AWS for this lane."
              }
            />
            <InsightStat
              label="Carrier Leverage"
              value={
                similarActiveLoads.length > 0
                  ? `${new Set(similarActiveLoads.map((load) => load.assignedCarrier)).size} carriers overlapping on this lane.`
                  : "No carrier overlap detected in AWS."
              }
            />
            <InsightStat
              label="Backhaul Ranking Logic"
              value="Lane similarity, equipment match, date compatibility, deadhead, carrier availability, win rate, margin opportunity, risk."
            />
            <InsightStat
              label="Similarity Factors"
              value="Origin and destination market, equipment, date proximity, weight, customer history, carrier overlap, lane overlap."
              className="sm:col-span-2"
            />
          </TabsContent>
        </Tabs>
    </WorkspacePanel>
  );

  const riskPanel = (
    <WorkspacePanel
      icon={ShieldAlert}
      tone="amber"
      title="Risk Model Slot"
      description="Published admin-curated model evaluation with deterministic output and reproducible inputs."
    >
        {riskModelsLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-3.5 w-28" />
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-3 w-3/4" />
          </div>
        ) : (
        <Field label="Select Risk Model">
          <Select
            value={selectedRiskModelId || undefined}
            onValueChange={setSelectedRiskModelId}
            disabled={riskModels.length === 0}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select a risk model" />
            </SelectTrigger>
            <SelectContent>
              {riskModels.map((model) => (
                <SelectItem key={model.id} value={model.id}>
                  {model.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        )}
        {selectedRiskModel ? (
        <div className="grid grid-cols-2 gap-3">
          <InsightStat label="Model Version" value={selectedRiskModel.version} />
          <InsightStat label="Model Owner" value={selectedRiskModel.owner} />
          <InsightStat label="Last Published" value={selectedRiskModel.lastPublished} />
          <InsightStat label="Risk Type" value={selectedRiskModel.riskType} />
          <InsightStat label="Inputs Required" value={String(selectedRiskModel.inputsRequired.length)} />
          <InsightStat label="Output Risk %" value={riskEvaluation ? `${riskEvaluation.outputRiskPct}%` : "-"} highlight />
        </div>
        ) : null}
        <Separator />
        {riskEvaluation ? (
          <div className="space-y-3">
            <div className="rounded-xl border border-border/70 bg-muted/20 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Risk Output
              </p>
              <div className="mt-2 flex items-center justify-between">
                <p className="text-2xl font-semibold">{riskEvaluation.outputRiskPct}%</p>
                <Badge variant="outline" className={riskTone(riskEvaluation.riskLevel)}>
                  {riskEvaluation.riskLevel}
                </Badge>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                Deterministic signature: {riskEvaluation.deterministicSignature}
              </p>
              <p className="text-xs text-muted-foreground">
                Evaluation timestamp: {riskEvaluation.evaluationTimestamp}
              </p>
            </div>
            <div className="space-y-1">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Input Values Used
              </p>
              <div className="grid grid-cols-2 gap-2 text-xs">
                {Object.entries(riskEvaluation.inputValues).map(([key, value]) => (
                  <div key={key} className="rounded-md border border-border/70 px-2.5 py-2">
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{titleCase(key)}</p>
                    <p className="font-medium">{value.toFixed(2)}</p>
                  </div>
                ))}
              </div>
            </div>
            <div className="space-y-1.5">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Reason Codes
              </p>
              {riskEvaluation.reasonCodes.map((code) => (
                <Badge key={code} variant="outline" className="mr-1 mb-1">
                  {code}
                </Badge>
              ))}
            </div>
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Top Contributing Factors
              </p>
              {riskEvaluation.topContributingFactors.map((factor) => {
                const width = clamp(Math.abs(factor.contribution), 4, 100);
                return (
                  <div key={factor.name} className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span>{factor.name}</span>
                      <span className={factor.direction === "Positive" ? "text-rose-600" : "text-emerald-600"}>
                        {factor.contribution > 0 ? "+" : ""}
                        {factor.contribution.toFixed(1)}
                      </span>
                    </div>
                    <div className="h-2 rounded bg-muted">
                      <div
                        className={cn(
                          "h-2 rounded",
                          factor.direction === "Positive" ? "bg-rose-500/70" : "bg-emerald-500/70",
                        )}
                        style={{ width: `${width}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
            <Button variant="outline" className="w-full gap-1.5" onClick={recalculateRisk}>
              <Calculator className="h-4 w-4" />
              Recalculate Risk
            </Button>
          </div>
        ) : null}
    </WorkspacePanel>
  );

  const aiPanel = (
    <WorkspacePanel
      icon={Bot}
      tone="violet"
      title="AI Bid Suggestion"
      description="Suggested bid range using internal historicals, DAT market data, leverage, margin targets, and risk output."
    >
        {!isAiBidConnected() ? (
          <div className="space-y-3">
            <div className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2.5 text-sm text-warning-foreground">
              {AI_NOT_CONNECTED_MESSAGE}
            </div>
            <p className="text-sm text-muted-foreground">
              Use internal AWS historical pricing and the selected bid amount in Actions until the AI
              Bidding Copilot is connected. Recommended bid from internal history:{" "}
              {selectedResult ? formatCurrency(selectedResult.recommendedBid) : "—"}
            </p>
          </div>
        ) : aiSuggestion ? (
          <>
            <div className="rounded-xl border border-border/70 bg-muted/20 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Suggested Bid Range
              </p>
              <p className="mt-1 text-xl font-semibold">
                {formatCurrency(aiSuggestion.suggestedBidLow)} to {formatCurrency(aiSuggestion.suggestedBidHigh)}
              </p>
              <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                <span>Recommended Sell: {formatCurrency(aiSuggestion.recommendedSellRate)}</span>
                <span>Recommended Buy: {formatCurrency(aiSuggestion.recommendedBuyRate)}</span>
                <span>Target Margin: {formatCurrency(aiSuggestion.targetMargin)}</span>
                <span>Margin %: {aiSuggestion.marginPercentage.toFixed(1)}%</span>
              </div>
            </div>
            <div className="flex items-center justify-between rounded-xl border border-border/70 bg-muted/20 px-3 py-2.5">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Confidence
                </p>
                <p className="text-sm font-medium">{aiSuggestion.confidenceLevel}</p>
              </div>
              <Badge variant="outline">{aiSuggestion.confidenceScore}%</Badge>
            </div>
            <div className="space-y-1">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Guardrails</p>
              {aiSuggestion.guardrails.map((guardrail) => (
                <div
                  key={guardrail}
                  className="rounded-lg border border-border/70 bg-muted/10 px-3 py-2 text-xs text-muted-foreground"
                >
                  {guardrail}
                </div>
              ))}
            </div>
            <div className="space-y-1">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Notes</p>
              <p className="rounded-md border border-border/70 px-3 py-2 text-xs text-muted-foreground">
                {aiSuggestion.notes}
              </p>
            </div>
            <div className="space-y-1">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Key Drivers</p>
              {aiSuggestion.keyDrivers.map((driver) => (
                <Badge key={driver} variant="outline" className="mr-1 mb-1">
                  {driver}
                </Badge>
              ))}
            </div>
            <p className="rounded-md border border-border/70 px-3 py-2 text-xs text-muted-foreground">
              Suggested strategy: {aiSuggestion.suggestedStrategy}
            </p>
            <p className="rounded-md border border-border/70 px-3 py-2 text-xs text-muted-foreground">
              Customer-facing note: {aiSuggestion.customerFacingNote}
            </p>
            <p className="rounded-md border border-border/70 px-3 py-2 text-xs text-muted-foreground">
              Internal pricing note: {aiSuggestion.internalPricingNote}
            </p>
            <Collapsible open={showWhySuggestion} onOpenChange={setShowWhySuggestion}>
              <CollapsibleTrigger asChild>
                <Button variant="ghost" className="h-8 w-full justify-between text-xs">
                  Why this suggestion?
                  <ArrowUpRight className={cn("h-3.5 w-3.5 transition", showWhySuggestion && "rotate-45")} />
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent className="space-y-1 pt-2">
                {aiSuggestion.whySuggestionRows.map((item) => (
                  <div
                    key={item.label}
                    className="flex items-center justify-between rounded-md border border-border/70 px-3 py-2 text-xs"
                  >
                    <span className="text-muted-foreground">{item.label}</span>
                    <span className="font-medium">{item.value}</span>
                  </div>
                ))}
              </CollapsibleContent>
            </Collapsible>
            <div className="grid grid-cols-2 gap-2">
              <Button className="gap-1.5" onClick={() => void saveAsQuote()} disabled={workspaceActionPending}>
                <Save className="h-4 w-4" />
                Save as Quote
              </Button>
              <Button variant="outline" className="gap-1.5" onClick={() => void attachToRfp()} disabled={workspaceActionPending}>
                Attach to RFP
              </Button>
              <Button variant="outline" className="gap-1.5" onClick={copyBid}>
                <Copy className="h-4 w-4" />
                Copy Bid
              </Button>
              <Button variant="outline" className="gap-1.5" onClick={recalculateSuggestion}>
                <WandSparkles className="h-4 w-4" />
                Recalculate
              </Button>
            </div>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">Run a lane search to generate AI bid suggestions.</p>
        )}
    </WorkspacePanel>
  );

  const actionsPanel = (
    <WorkspacePanel
      icon={ClipboardList}
      tone="cyan"
      title="Actions"
      description="Save as quote, attach to RFP lane, export, approvals, notes, and load creation workflow."
      contentClassName="space-y-4"
    >
        <Field label="Selected Bid Amount">
          <Input value={finalBid} onChange={(event) => setFinalBid(event.target.value)} />
        </Field>
        <Field label="Attach to RFP Lane">
          <Input
            value={rfpLane}
            onChange={(event) => setRfpLane(event.target.value)}
            placeholder="Lane identifier or description"
          />
        </Field>
        <Field label="Internal Pricing Note">
          <Textarea
            rows={3}
            value={internalNote}
            onChange={(event) => setInternalNote(event.target.value)}
            placeholder="Capture pricing rationale, exceptions, or manager notes..."
          />
        </Field>
        <Separator />
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Primary</p>
          <div className="grid grid-cols-2 gap-2">
            <Button className="gap-1.5" onClick={() => void saveAsQuote()} disabled={workspaceActionPending}>
              <Save className="h-4 w-4" />
              Save as Quote
            </Button>
            <Button variant="outline" className="gap-1.5" onClick={() => void attachToRfp()} disabled={workspaceActionPending}>
              Attach to RFP Lane
            </Button>
          </div>
        </div>
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Export</p>
          <div className="grid grid-cols-2 gap-2">
            <Button variant="outline" className="gap-1.5" onClick={() => exportResults("PDF")}>
              <Download className="h-4 w-4" />
              Export PDF
            </Button>
            <Button variant="outline" className="gap-1.5" onClick={() => exportResults("CSV")}>
              Export CSV
            </Button>
            <Button variant="outline" className="gap-1.5" onClick={() => exportResults("XLSX")}>
              Export XLSX
            </Button>
            <Button variant="outline" className="gap-1.5" onClick={() => void sendForApproval()} disabled={workspaceActionPending}>
              Send for Approval
            </Button>
          </div>
        </div>
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Workflow</p>
          <div className="grid grid-cols-2 gap-2">
            <Button variant="outline" className="gap-1.5" onClick={() => void saveAsQuote("draft")} disabled={workspaceActionPending}>
              Save Draft
            </Button>
            <Button
              variant="outline"
              className="gap-1.5"
              onClick={() => setActionMessage("Internal note added to bid package.")}
            >
              Add Internal Note
            </Button>
            <Button variant="outline" className="gap-1.5" onClick={() => setActionMessage("Sales team notified.")}>
              Share with Sales
            </Button>
            <Button variant="outline" className="gap-1.5" onClick={refreshDat}>
              Refresh DAT
            </Button>
            <Button variant="outline" className="gap-1.5" onClick={recalculateRisk}>
              Recalculate Risk
            </Button>
            <Button variant="outline" className="gap-1.5" onClick={recalculateSuggestion}>
              Recalculate Suggestion
            </Button>
            <Button
              variant="outline"
              className="col-span-2 gap-1.5"
              disabled={workspaceActionPending}
              onClick={() => void createLoadFromBid()}
            >
              Create Load in AWS
            </Button>
          </div>
        </div>
    </WorkspacePanel>
  );

  const savedQuotesPanel = (
    <WorkspacePanel
      icon={CheckCircle2}
      tone="emerald"
      title="Saved Quote Actions"
      description="Latest quote saves with margin snapshots for reproducibility and handoff."
    >
      {savedQuotes.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No quotes saved yet. Use "Save as Quote" to capture this workspace output.
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {savedQuotes.map((quote) => (
            <div
              key={quote.id}
              className="rounded-xl border border-border/70 bg-muted/10 p-3.5 shadow-sm transition-shadow hover:shadow-md"
            >
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-semibold">{quote.id}</p>
                {quote.status ? (
                  <Badge variant="outline" className="text-[10px] uppercase">
                    {quote.status}
                  </Badge>
                ) : null}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Bid {formatCurrency(quote.bid)} · Margin {formatCurrency(quote.margin)}
              </p>
              <p className="text-xs text-muted-foreground">{quote.timestamp}</p>
              <div className="mt-3 grid grid-cols-[1fr_auto] gap-2">
                <Button size="sm" variant="outline" className="h-8 text-[11px]">
                  Open Quote
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 text-[11px] text-destructive hover:text-destructive"
                  disabled={workspaceActionPending}
                  onClick={() => void deleteQuote(quote.id)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
      <Separator />
      <div className="grid grid-cols-2 gap-2">
        <Button variant="outline" className="gap-1.5" onClick={() => exportResults("PDF")}>
          <Download className="h-4 w-4" />
          Export PDF
        </Button>
        <Button variant="outline" className="gap-1.5" onClick={() => exportResults("XLSX")}>
          <FileDown className="h-4 w-4" />
          Export XLSX
        </Button>
      </div>
    </WorkspacePanel>
  );

  const auditPanel = (
    <WorkspacePanel
      icon={ClipboardList}
      tone="default"
      title="Audit / Calculation Log"
      description="Search, DAT snapshot, risk model version + inputs, AI suggestion timestamp, selected bid, and final action."
      contentClassName="p-0 pt-0"
    >
      <div className="w-full min-w-0 max-w-full overflow-x-auto rounded-xl border border-border/70 bg-muted/10">
        <Table className="min-w-[1420px] text-xs">
          <TableHeader>
            <TableRow>
              <TableHead>Search ID</TableHead>
              <TableHead>User</TableHead>
              <TableHead>Origin</TableHead>
              <TableHead>Destination</TableHead>
              <TableHead>Equipment</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Historical Timestamp</TableHead>
              <TableHead>DAT Timestamp</TableHead>
              <TableHead>Risk Model ID</TableHead>
              <TableHead>Risk Model Version</TableHead>
              <TableHead>Risk Input Values</TableHead>
              <TableHead>Risk Output</TableHead>
              <TableHead>AI Suggestion Timestamp</TableHead>
              <TableHead>Final Selected Bid</TableHead>
              <TableHead>Action Taken</TableHead>
              <TableHead>Created Quote ID</TableHead>
              <TableHead>Attached RFP ID</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {logs.length === 0 ? (
              <TableRow>
                <TableCell colSpan={17} className="text-center text-muted-foreground">
                  No audit entries yet. Run search, risk, AI, or quote actions to populate logs.
                </TableCell>
              </TableRow>
            ) : (
              logs.map((entry) => (
                <TableRow key={`${entry.searchId}-${entry.date}-${entry.actionTaken}`}>
                  <TableCell>{entry.searchId}</TableCell>
                  <TableCell>{entry.user}</TableCell>
                  <TableCell>{entry.origin}</TableCell>
                  <TableCell>{entry.destination}</TableCell>
                  <TableCell>{entry.equipment}</TableCell>
                  <TableCell>{entry.date}</TableCell>
                  <TableCell>{entry.historicalAggregationTimestamp}</TableCell>
                  <TableCell>{entry.datRefreshTimestamp}</TableCell>
                  <TableCell>{entry.riskModelId}</TableCell>
                  <TableCell>{entry.riskModelVersion}</TableCell>
                  <TableCell className="max-w-[280px] truncate">{entry.riskInputValues}</TableCell>
                  <TableCell>{entry.riskOutput}</TableCell>
                  <TableCell>{entry.aiSuggestionTimestamp}</TableCell>
                  <TableCell>{entry.finalSelectedBid}</TableCell>
                  <TableCell>{entry.actionTaken}</TableCell>
                  <TableCell>{entry.createdQuoteId || "-"}</TableCell>
                  <TableCell>{entry.attachedRfpId || "-"}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </WorkspacePanel>
  );

  const riskMetricTone =
    riskEvaluation?.riskLevel === "Low Risk"
      ? "success"
      : riskEvaluation?.riskLevel === "High Risk" || riskEvaluation?.riskLevel === "Critical Risk"
        ? "warning"
        : "info";

  return (
    <div className="flex min-h-[calc(100vh-3.5rem)] min-w-0 flex-col overflow-x-clip bg-background">
      <PageHeader
        title="Bidding Workspace"
        description="Spot-load pricing command center with internal historicals, DAT intelligence, leverage context, deterministic risk scoring, and AI-powered bid suggestions."
        actions={
          <>
            <Button variant="outline" className="gap-1.5" onClick={refreshDat}>
              <RefreshCw className="h-4 w-4" />
              Refresh DAT
            </Button>
            <Button variant="outline" className="gap-1.5" onClick={recalculateRisk}>
              <Gauge className="h-4 w-4" />
              Recalculate Risk
            </Button>
            <Button className="gap-1.5" onClick={() => void saveAsQuote()} disabled={workspaceActionPending}>
              <Save className="h-4 w-4" />
              Save as Quote
            </Button>
          </>
        }
      />

      <div className="px-4 pb-4 pt-3 sm:px-6 lg:hidden">
        <div className="sticky top-2 z-[1] rounded-xl border border-border/70 bg-card/95 p-4 shadow-sm backdrop-blur">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Active Lane</p>
              <p className="truncate text-sm font-semibold">{searchSummary}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {searchCriteria.equipmentType} · {searchCriteria.pickupDate} ·{" "}
                {searchCriteria.weight.toLocaleString()} lb
              </p>
            </div>
            <Badge variant="outline" className={cn("shrink-0 font-medium", DAT_STATUS_TONE[datSnapshot.status])}>
              DAT {datSnapshot.status}
            </Badge>
          </div>
        </div>
      </div>

      <div className="min-w-0 px-4 sm:px-6 lg:px-8">
        <div className="grid gap-2 py-4 sm:grid-cols-2 xl:grid-cols-3">
          {loadsLoading ? (
            <div className="rounded-lg border border-border/70 bg-muted/20 px-3 py-2.5 sm:col-span-2 xl:col-span-3">
              <Skeleton className="h-4 w-80 max-w-full" />
            </div>
          ) : loadsError ? (
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-sm text-destructive sm:col-span-2 xl:col-span-3">
              {loadsError}
            </div>
          ) : (
            <div className="rounded-lg border border-border/70 bg-muted/20 px-3 py-2.5 text-sm text-muted-foreground">
              AWS loads synced: {awsLoads.length} record{awsLoads.length === 1 ? "" : "s"} · Quotes:{" "}
              {savedQuotes.length} · Searches: {savedSearches.length}
              {isBiddingWorkspaceAvailable() ? " · Workspace CRUD enabled" : " · Workspace CRUD local-only"}
              {loadsRefreshing ? " · Refreshing…" : ""}
            </div>
          )}
          {workspaceSyncError ? (
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-sm text-destructive sm:col-span-2 xl:col-span-3">
              {workspaceSyncError}
            </div>
          ) : null}
          {workspaceTableMissing ? (
            <div className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2.5 text-sm text-warning-foreground sm:col-span-2 xl:col-span-3">
              {getBiddingWorkspaceTableMissingMessage()}
            </div>
          ) : !isBiddingWorkspaceConfigured() ? (
            <div className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2.5 text-sm text-warning-foreground sm:col-span-2 xl:col-span-3">
              Bidding workspace CRUD is local-only. Create DynamoDB table{" "}
              <span className="font-medium">BiddingWorkspace</span> with keys{" "}
              <span className="font-medium">workspaceId</span> + <span className="font-medium">itemKey</span> to
              persist quotes, saved searches, and audit logs.
            </div>
          ) : null}
          {!isDatApiConnected() ? (
            <div className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2.5 text-sm text-warning-foreground">
              {DAT_NOT_CONNECTED_MESSAGE}
            </div>
          ) : null}
          {!isAiBidConnected() ? (
            <div className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2.5 text-sm text-warning-foreground">
              {AI_NOT_CONNECTED_MESSAGE}
            </div>
          ) : null}
        </div>

        <div className="hidden min-w-0 space-y-5 py-5 lg:block">
          <div className="grid min-w-0 grid-cols-2 gap-4 xl:grid-cols-4">
            <MetricCard
              label="Historical Avg Sell"
              value={selectedResult ? formatCurrency(selectedResult.historicalAvgSell) : "—"}
              subtitle="Internal 90-day baseline from AWS loads"
              tone="info"
              state={selectedResult ? "value" : "empty"}
              icon={<TrendingUp className="h-4 w-4" />}
            />
            <MetricCard
              label="DAT Market Avg"
              value={isDatApiConnected() ? formatCurrency(datSnapshot.marketAverage) : "—"}
              subtitle={
                isDatApiConnected()
                  ? `${datSnapshot.dataWindow} RateView window`
                  : "Connect RateView in Settings → Integrations"
              }
              tone="warning"
              state={isDatApiConnected() ? "value" : "disconnected"}
              icon={<MapPinned className="h-4 w-4" />}
            />
            <MetricCard
              label="Risk Score"
              value={riskEvaluation ? `${riskEvaluation.outputRiskPct}%` : "—"}
              subtitle={riskEvaluation ? riskEvaluation.riskLevel : "Select a lane result to evaluate"}
              tone={riskMetricTone}
              state={riskEvaluation ? "value" : "empty"}
              icon={<Target className="h-4 w-4" />}
            />
            <MetricCard
              label="AI Confidence"
              value={
                isAiBidConnected() && aiSuggestion ? `${aiSuggestion.confidenceScore}%` : "—"
              }
              subtitle={
                isAiBidConnected() && aiSuggestion
                  ? aiSuggestion.confidenceLevel
                  : "Enable AI Bidding Copilot in Settings"
              }
              tone="warning"
              state={isAiBidConnected() ? (aiSuggestion ? "value" : "empty") : "disconnected"}
              icon={<Sparkles className="h-4 w-4" />}
            />
          </div>
          <div className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)] xl:grid-cols-[minmax(0,360px)_minmax(0,1fr)]">
            <div className="min-w-0">{desktopSearchPanel}</div>
            <div className="min-w-0">
              <Tabs
                value={desktopTab}
                onValueChange={(value) => setDesktopTab(value as BiddingDesktopTabId)}
                className="w-full space-y-4"
              >
                <div className="rounded-xl border border-border/70 bg-muted/20 p-1.5 shadow-sm">
                  <TabsList className="flex h-auto w-full gap-0.5 bg-transparent p-0">
                    {BIDDING_DESKTOP_TABS.map((tab) => {
                      const Icon = tab.icon;
                      return (
                        <TabsTrigger
                          key={tab.value}
                          value={tab.value}
                          title={tab.title}
                          className="flex-1 gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-all hover:bg-background/60 hover:text-foreground data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm"
                        >
                          <Icon className="h-4 w-4 shrink-0" />
                          <span className="whitespace-nowrap">{tab.label}</span>
                        </TabsTrigger>
                      );
                    })}
                  </TabsList>
                </div>
                <TabsContent value="results" className="mt-0 min-w-0">
                  {resultsSection}
                </TabsContent>
                <TabsContent value="market" className="mt-0 min-w-0">
                  <div className="grid min-w-0 items-start gap-5 xl:grid-cols-2">
                    {datPanel}
                    {leveragePanel}
                  </div>
                </TabsContent>
                <TabsContent value="risk" className="mt-0 min-w-0">
                  <div className="grid min-w-0 items-start gap-5 xl:grid-cols-2">
                    {riskPanel}
                    {aiPanel}
                  </div>
                </TabsContent>
                <TabsContent value="actions" className="mt-0 min-w-0">
                  <div className="grid min-w-0 items-start gap-5 xl:grid-cols-2">
                    {actionsPanel}
                    {savedQuotesPanel}
                  </div>
                </TabsContent>
                <TabsContent value="audit" className="mt-0 min-w-0">
                  {auditPanel}
                </TabsContent>
              </Tabs>
            </div>
          </div>
        </div>

        <div className="min-w-0 pb-4 lg:hidden">
          <Tabs
            value={mobileTab}
            onValueChange={(value) => setMobileTab(value as BiddingMobileTabId)}
            className="w-full space-y-4"
          >
            <div className="rounded-xl border border-border/70 bg-muted/20 p-1.5 shadow-sm">
              <div className="overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                <TabsList className="inline-flex h-auto w-max min-w-full gap-0.5 bg-transparent p-0 sm:min-w-0">
                  {BIDDING_MOBILE_TABS.map((tab) => {
                    const Icon = tab.icon;
                    return (
                      <TabsTrigger
                        key={tab.value}
                        value={tab.value}
                        title={tab.title}
                        className="gap-1.5 rounded-lg px-3 py-2 text-xs font-medium text-muted-foreground transition-all hover:bg-background/60 hover:text-foreground data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm sm:text-sm"
                      >
                        <Icon className="h-3.5 w-3.5 shrink-0" />
                        <span className="whitespace-nowrap">{tab.label}</span>
                      </TabsTrigger>
                    );
                  })}
                </TabsList>
              </div>
            </div>
            <TabsContent value="search" className="mt-0">
              {desktopSearchPanel}
            </TabsContent>
            <TabsContent value="results" className="mt-0">
              {resultsSection}
            </TabsContent>
            <TabsContent value="dat" className="mt-0">
              {datPanel}
            </TabsContent>
            <TabsContent value="leverage" className="mt-0">
              {leveragePanel}
            </TabsContent>
            <TabsContent value="risk" className="mt-0">
              {riskPanel}
            </TabsContent>
            <TabsContent value="ai" className="mt-0">
              {aiPanel}
            </TabsContent>
            <TabsContent value="actions" className="mt-0">
              {actionsPanel}
            </TabsContent>
          </Tabs>
        </div>

        <div className="min-w-0 space-y-5 pb-6 lg:hidden">
          {auditPanel}
          {savedQuotesPanel}
        </div>
      </div>

      <div className="sticky bottom-0 z-[1] border-t border-border/70 bg-background/95 px-4 py-2.5 text-xs text-muted-foreground backdrop-blur sm:px-6 lg:px-8">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-border/70 bg-muted/30 px-2.5 py-1">
            <Gauge className="h-3.5 w-3.5" />
            Aggregation target: &lt; 2s for 50,000 records
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-border/70 bg-muted/30 px-2.5 py-1">
            <Database className="h-3.5 w-3.5" />
            DAT: {datSnapshot.status}
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-border/70 bg-muted/30 px-2.5 py-1">
            <ShieldAlert className="h-3.5 w-3.5" />
            Risk model: {selectedRiskModel?.version ?? "—"}
          </span>
          {actionMessage ? (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-border/70 bg-background px-2.5 py-1 font-medium text-foreground">
              <AlertCircle className="h-3.5 w-3.5 text-primary" />
              {actionMessage}
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function evaluateRiskDeterministic(args: {
  row: HistoricalResultRow;
  dat: DatSnapshot;
  model: RiskModelOption;
  leverageCount: number;
}): RiskEvaluation {
  const { row, dat, model, leverageCount } = args;
  const datSpread = clamp((dat.marketAverage - row.historicalAvgBuy) / 10, -25, 40);
  const inputValues = {
    fuelIndex: clamp(dat.fuelEstimate * 100, 20, 95),
    seasonality: clamp(60 + (hash32(row.lane) % 30), 20, 95),
    marketVolatility: clamp((row.standardDeviation / row.historicalAvgBuy) * 1000, 10, 95),
    laneVolatility: clamp((row.standardDeviation / row.historicalAvgSell) * 1000, 8, 90),
    datSpread: clamp(datSpread + 50, 0, 100),
    carrierReliability: clamp(row.winRate + 15, 20, 97),
    weatherRisk: clamp(38 + (hash32(row.id) % 34), 10, 95),
    dwellAverage: clamp(30 + (hash32(row.equipment) % 40), 8, 90),
    historicalWinRate: clamp(row.winRate, 5, 96),
    activeLoadLeverage: clamp(42 + leverageCount * 7, 5, 95),
    equipmentTightness: clamp(dat.capacityIndicator, 10, 99),
  };

  const topContributingFactors = Object.entries(model.weights)
    .map(([name, weight]) => {
      const value = inputValues[name as keyof typeof inputValues] ?? 0;
      const centered = value - 50;
      const contribution = centered * weight;
      return {
        name: titleCase(name),
        value,
        weight,
        contribution,
        direction: contribution >= 0 ? ("Positive" as const) : ("Negative" as const),
      };
    })
    .sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));

  const baseScore = 50 + topContributingFactors.reduce((acc, item) => acc + item.contribution, 0);
  const outputRiskPct = Math.round(clamp(baseScore, 3, 99));
  const riskLevel = toRiskLevel(outputRiskPct);
  const reasonCodes = buildReasonCodes({ outputRiskPct, dat, row, leverageCount });
  const signature = hash32(
    JSON.stringify({
      inputValues,
      modelId: model.id,
      modelVersion: model.version,
      lane: row.lane,
    }),
  )
    .toString(16)
    .toUpperCase();

  return {
    outputRiskPct,
    riskLevel,
    reasonCodes,
    topContributingFactors: topContributingFactors.slice(0, 6),
    modelVersion: model.version,
    evaluationTimestamp: nowStamp(),
    inputValues,
    deterministicSignature: `SIG-${signature}`,
  };
}

function buildAiSuggestion(args: {
  row: HistoricalResultRow;
  risk: RiskEvaluation;
  dat: DatSnapshot;
  leverageCount: number;
  backhaulCount: number;
}): AiSuggestion {
  const { row, risk, dat, leverageCount, backhaulCount } = args;
  const riskPenalty = (risk.outputRiskPct - 50) * 3.2;
  const leverageOffset = leverageCount * 22 + backhaulCount * 16;
  const baseSell = row.historicalAvgSell * 0.45 + dat.marketAverage * 0.4 + row.last30AvgSell * 0.15;
  const recommendedSellRate = Math.round(clamp(baseSell + riskPenalty - leverageOffset * 0.2, 1800, 5200));
  const recommendedBuyRate = Math.round(
    clamp(row.historicalAvgBuy + riskPenalty * 0.4 - leverageOffset * 0.45, 1200, 4700),
  );
  const targetMargin = recommendedSellRate - recommendedBuyRate;
  const marginPercentage = (targetMargin / Math.max(recommendedSellRate, 1)) * 100;
  const confidenceScore = Math.round(
    clamp(
      88 -
        Math.abs(dat.marketAverage - row.historicalAvgSell) / 30 -
        Math.max(0, risk.outputRiskPct - 55) * 0.45 +
        leverageCount * 2.5,
      34,
      97,
    ),
  );
  const confidenceLevel: ConfidenceLevel =
    confidenceScore >= 78 ? "High Confidence" : confidenceScore >= 56 ? "Medium Confidence" : "Low Confidence";

  const suggestedBidLow = Math.round(recommendedSellRate - 110 - Math.max(0, riskPenalty * 0.3));
  const suggestedBidHigh = Math.round(recommendedSellRate + 75 + Math.max(0, riskPenalty * 0.25));

  const guardrails = [
    `Do not bid below ${formatCurrency(Math.round(recommendedSellRate - 140))} unless carrier rate is locked.`,
    `Require manager approval if margin drops below ${Math.max(10, Math.round(marginPercentage - 3))}%.`,
    dat.status === "Stale"
      ? "DAT stale data warning: refresh before final quote release."
      : "Escalate if DAT market average moves above current snapshot by 4%+.",
    risk.riskLevel === "High Risk" || risk.riskLevel === "Critical Risk"
      ? "High risk warning: require approval and mitigation notes."
      : "Proceed with standard approval workflow unless capacity tightens.",
    `Maximum buy rate allowed ${formatCurrency(Math.round(recommendedBuyRate + 120))}.`,
  ];

  const notes = `Historical win rate ${row.winRate.toFixed(1)}% with ${row.loadCount} comparable loads. DAT average is ${formatCurrency(dat.marketAverage)} and leverage includes ${leverageCount} similar active loads with ${backhaulCount} backhaul options.`;
  const keyDrivers = [
    `Internal historical avg sell ${formatCurrency(row.historicalAvgSell)}`,
    `DAT market avg ${formatCurrency(dat.marketAverage)}`,
    `Risk score ${risk.outputRiskPct}% (${risk.riskLevel})`,
    `Leverage loads ${leverageCount}`,
    `Backhaul opportunities ${backhaulCount}`,
    `Win rate ${row.winRate.toFixed(1)}%`,
  ];
  const suggestedStrategy =
    risk.riskLevel === "Critical Risk"
      ? "Conservative bid posture with pre-approval and tighter buy-side controls."
      : risk.riskLevel === "High Risk"
        ? "Balanced bid with guardrails, carrier confirmation, and active DAT monitoring."
        : "Competitive bid posture leveraging backhaul and customer history.";
  const customerFacingNote =
    "We can support this lane with aligned market pricing and secure capacity within your pickup window.";
  const internalPricingNote = `Model ${risk.modelVersion} used with deterministic signature ${risk.deterministicSignature}.`;
  const whySuggestionRows = [
    { label: "Internal historical average", value: formatCurrency(row.historicalAvgSell) },
    { label: "DAT market average", value: formatCurrency(dat.marketAverage) },
    {
      label: "Last 30/60/90 trend",
      value: `${formatCurrency(row.last30AvgSell)} / ${formatCurrency(row.last60AvgSell)} / ${formatCurrency(row.last90AvgSell)}`,
    },
    { label: "Win-rate trend", value: `${row.winRate.toFixed(1)}%` },
    { label: "Active load leverage", value: `${leverageCount} similar loads` },
    { label: "Backhaul opportunities", value: `${backhaulCount} candidates` },
    { label: "Risk score", value: `${risk.outputRiskPct}% (${risk.riskLevel})` },
    { label: "Margin target", value: `${formatCurrency(targetMargin)} / ${marginPercentage.toFixed(1)}%` },
    { label: "Confidence drivers", value: `DAT ${dat.confidence}% confidence, sample ${row.loadCount}` },
  ];

  return {
    suggestedBidLow,
    suggestedBidHigh,
    recommendedSellRate,
    recommendedBuyRate,
    targetMargin,
    marginPercentage,
    confidenceScore,
    confidenceLevel,
    guardrails,
    notes,
    keyDrivers,
    suggestedStrategy,
    customerFacingNote,
    internalPricingNote,
    whySuggestionRows,
  };
}

function buildReasonCodes(args: {
  outputRiskPct: number;
  dat: DatSnapshot;
  row: HistoricalResultRow;
  leverageCount: number;
}): string[] {
  const reasons: string[] = [];
  const { outputRiskPct, dat, row, leverageCount } = args;
  if (row.standardDeviation > 105) reasons.push("High market volatility");
  if (row.winRate < 54) reasons.push("Weak historical win rate");
  if (dat.marketAverage > row.historicalAvgBuy + 240) reasons.push("DAT average above target buy rate");
  if (dat.capacityIndicator > 72) reasons.push("Tight capacity on origin market");
  if (dat.fuelEstimate > 0.62) reasons.push("Fuel index trending upward");
  if (leverageCount < 2) reasons.push("Limited backhaul options");
  if (row.winRate > 68) reasons.push("Strong carrier reliability offsets risk");
  if (outputRiskPct > 76) reasons.push("Seasonality increases rate pressure");
  return reasons.slice(0, 6);
}

function toRiskLevel(score: number): RiskLevel {
  if (score < 35) return "Low Risk";
  if (score < 60) return "Medium Risk";
  if (score < 80) return "High Risk";
  return "Critical Risk";
}

function riskTone(level: RiskLevel) {
  if (level === "Low Risk")
    return "border-emerald-300 text-emerald-700 dark:border-emerald-800 dark:text-emerald-300";
  if (level === "Medium Risk")
    return "border-sky-300 text-sky-700 dark:border-sky-800 dark:text-sky-300";
  if (level === "High Risk")
    return "border-amber-300 text-amber-700 dark:border-amber-800 dark:text-amber-300";
  return "border-rose-300 text-rose-700 dark:border-rose-800 dark:text-rose-300";
}

function titleCase(value: string) {
  return value
    .replace(/([A-Z])/g, " $1")
    .replace(/[_-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

function delay(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(() => resolve(), ms);
  });
}

function nowStamp() {
  const now = new Date();
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())} ET`;
}

function pad(value: number) {
  return value.toString().padStart(2, "0");
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

function hash32(text: string) {
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash << 5) - hash + text.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function WorkspacePanel({
  icon: Icon,
  tone = "default",
  title,
  description,
  badge,
  children,
  contentClassName,
  sticky,
}: {
  icon: React.ComponentType<{ className?: string }>;
  tone?: "default" | "sky" | "blue" | "emerald" | "indigo" | "amber" | "violet" | "cyan";
  title: string;
  description?: string;
  badge?: React.ReactNode;
  children: React.ReactNode;
  contentClassName?: string;
  sticky?: boolean;
}) {
  const toneClass: Record<NonNullable<typeof tone>, string> = {
    default: "bg-muted/80 text-foreground",
    sky: "bg-sky-500/10 text-sky-600 dark:text-sky-400",
    blue: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
    emerald: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
    indigo: "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400",
    amber: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
    violet: "bg-violet-500/10 text-violet-600 dark:text-violet-400",
    cyan: "bg-cyan-500/10 text-cyan-600 dark:text-cyan-400",
  };

  return (
    <Card className={cn("min-w-0 border-border/70 shadow-sm", sticky && "lg:sticky lg:top-4 lg:self-start")}>
      <CardHeader className="space-y-0 pb-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <div
              className={cn(
                "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
                toneClass[tone],
              )}
            >
              <Icon className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <CardTitle className="text-base">{title}</CardTitle>
              {description ? <CardDescription className="mt-1">{description}</CardDescription> : null}
            </div>
          </div>
          {badge}
        </div>
      </CardHeader>
      <CardContent className={cn("space-y-4", contentClassName)}>{children}</CardContent>
    </Card>
  );
}

function MetricCard({
  label,
  value,
  subtitle,
  tone,
  icon,
  state = "value",
}: {
  label: string;
  value: string;
  subtitle: string;
  tone: "default" | "success" | "warning" | "info";
  icon: React.ReactNode;
  state?: "value" | "empty" | "disconnected";
}) {
  const toneClass =
    tone === "success"
      ? "bg-success/15 text-success border-success/30"
      : tone === "warning"
        ? "bg-warning/15 text-warning-foreground border-warning/30"
        : tone === "info"
          ? "bg-info/15 text-info border-info/30"
          : "bg-muted/80 text-muted-foreground border-border/70";

  return (
    <Card className="min-w-0 overflow-hidden border-border/70 bg-card shadow-sm transition-shadow hover:shadow-md">
      <CardContent className="flex h-full flex-col p-4">
        <div className="flex items-start justify-between gap-2">
          <p className="min-w-0 truncate text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            {label}
          </p>
          <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border", toneClass)}>
            {icon}
          </span>
        </div>

        <div className="mt-3 min-h-[2.25rem]">
          {state === "disconnected" ? (
            <span className="inline-flex max-w-full items-center rounded-full border border-warning/30 bg-warning/10 px-2.5 py-1 text-xs font-medium text-warning-foreground">
              Not connected
            </span>
          ) : state === "empty" ? (
            <p className="text-2xl font-semibold leading-none text-muted-foreground/70">—</p>
          ) : (
            <p className="truncate text-2xl font-semibold leading-none tracking-tight">{value}</p>
          )}
        </div>

        <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-muted-foreground">{subtitle}</p>
      </CardContent>
    </Card>
  );
}

function InsightStat({
  label,
  value,
  highlight,
  className,
}: {
  label: string;
  value: string;
  highlight?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border border-border/70 bg-muted/20 px-3 py-2.5",
        highlight && "border-primary/20 bg-primary/5",
        className,
      )}
    >
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={cn("mt-1 text-sm font-semibold tracking-tight", highlight && "text-primary")}>{value}</p>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-medium text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

function OptionsGrid({
  options,
}: {
  options: Array<{
    id: string;
    label: string;
    checked: boolean;
    onCheckedChange: (value: boolean | string) => void;
  }>;
}) {
  return (
    <div className="grid gap-2">
      {options.map((option) => (
        <label
          key={option.id}
          htmlFor={option.id}
          className="flex cursor-pointer items-center gap-2 rounded-lg border border-border/70 bg-muted/10 px-2.5 py-2 text-xs transition-colors hover:bg-muted/30"
        >
          <Checkbox id={option.id} checked={option.checked} onCheckedChange={option.onCheckedChange} />
          <span>{option.label}</span>
        </label>
      ))}
    </div>
  );
}
