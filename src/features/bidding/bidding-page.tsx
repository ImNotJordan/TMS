import * as React from "react";
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
import { DAT_DISABLED_IN_SETTINGS_MESSAGE, useDatFeatureFlags } from "@/lib/dat-feature-flags";
import {
  AI_NOT_CONNECTED_MESSAGE,
  DAT_NOT_CONNECTED_MESSAGE,
  DEFAULT_SEARCH_OPTIONS,
  createEmptySearchCriteria,
  fetchBiddingFieldOptions,
  fetchBiddingRiskModels,
  getDatSnapshotForBidding,
  hasSearchableLane,
  isAiBidConnected,
  isDatApiConnected,
  searchBiddingLanes,
  type BackhaulCandidate,
  type BiddingFieldOptions,
  type BiddingSearchResponse,
  type DatSnapshot,
  type DatStatus,
  type HistoricalResultRow,
  type LeverageLoad,
  type MarginBand,
  type RiskModelOption,
  type SearchCriteria,
  type SearchOptions,
} from "@/lib/bidding-data";
import {
  buildAiSuggestion,
  clamp,
  evaluateRiskDeterministic,
  hash32,
  titleCase,
  type AiSuggestion,
  type RiskEvaluation,
  type RiskLevel,
} from "@/lib/bidding-suggestion";
import { enrichBidNarrativesWithAi } from "@/lib/workspace-ai";
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
  getWorkspaceTruncation,
  isBiddingWorkspaceAvailable,
  isWorkspaceCachePersisted,
  listBidQuotes,
  readBiddingWorkspaceCacheSnapshot,
  updateBidQuote,
  upsertBiddingSavedSearch,
  type BiddingAuditInput,
  type BiddingWorkspaceSnapshot,
} from "@/lib/bidding-workspace-store";
import { t } from "@/lib/i18n/t";

type SearchPipelineStep =
  | "Querying internal historicals"
  | "Aggregating lane rates"
  | "Scoring risk and leverage";

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

const DAT_STATUS_TONE: Record<DatStatus, string> = {
  Live: "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300",
  Refreshing:
    "border-blue-300 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-300",
  Stale:
    "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300",
  Unavailable:
    "border-slate-300 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300",
  "API Error":
    "border-rose-300 bg-rose-50 text-rose-700 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-300",
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
  {
    value: "market",
    label: "DAT & Leverage",
    title: "DAT RateView and Leverage Panel",
    icon: Database,
  },
  {
    value: "risk",
    label: "Risk & AI Bid",
    title: "Risk Model and AI Bid Suggestion",
    icon: ShieldAlert,
  },
  {
    value: "actions",
    label: "Actions & Quotes",
    title: "Bid Actions and Saved Quotes",
    icon: ClipboardList,
  },
  { value: "audit", label: "Audit Log", title: "Audit / Calculation Log", icon: Calculator },
] as const;

type BiddingDesktopTabId = (typeof BIDDING_DESKTOP_TABS)[number]["value"];

const EMPTY_FIELD_OPTIONS: BiddingFieldOptions = {
  customers: [],
  brokers: [],
  states: [],
  equipmentTypes: [],
};

export function BiddingPage() {
  const { user } = useAuth();
  // Only ever a cache key in this tab. The server takes the real workspace id
  // from the token; nothing here is sent.
  const workspaceId = user?.userId ?? "_";
  const workspaceUser =
    user?.name?.trim() ||
    user?.attributes?.given_name ||
    user?.email?.split("@")[0] ||
    "Current User";

  const [searchCriteria, setSearchCriteria] =
    React.useState<SearchCriteria>(createEmptySearchCriteria);
  const [searchOptions, setSearchOptions] = React.useState<SearchOptions>(DEFAULT_SEARCH_OPTIONS);
  const datFlags = useDatFeatureFlags();
  const datApiLive = isDatApiConnected();
  const datRatesEnabled = datApiLive && datFlags.rateData;
  const datCapacityEnabled = datApiLive && datFlags.capacityData;
  const datDataEnabled = datRatesEnabled || datCapacityEnabled;
  const datBlockedMessage = !datApiLive
    ? DAT_NOT_CONNECTED_MESSAGE
    : !datDataEnabled
      ? DAT_DISABLED_IN_SETTINGS_MESSAGE
      : null;
  const [savedSearches, setSavedSearches] = React.useState<
    Array<{ name: string; criteria: SearchCriteria }>
  >([]);
  const [selectedSavedSearch, setSelectedSavedSearch] = React.useState<string>("none");
  const [searchStage, setSearchStage] = React.useState<SearchPipelineStep | null>(null);
  const [isSearching, setIsSearching] = React.useState(false);
  const [loadsLoading, setLoadsLoading] = React.useState(true);
  const [loadsError, setLoadsError] = React.useState<string | null>(null);
  const [fieldOptions, setFieldOptions] = React.useState<BiddingFieldOptions>(EMPTY_FIELD_OPTIONS);
  const [loadsConsidered, setLoadsConsidered] = React.useState<number | null>(null);
  const [riskModels, setRiskModels] = React.useState<RiskModelOption[]>([]);
  const [riskModelsLoading, setRiskModelsLoading] = React.useState(true);

  usePageReady(loadsLoading || riskModelsLoading);

  const [datSnapshot, setDatSnapshot] = React.useState<DatSnapshot>(() =>
    getDatSnapshotForBidding(),
  );
  const [datError, setDatError] = React.useState<string | null>(() =>
    isDatApiConnected() ? null : DAT_NOT_CONNECTED_MESSAGE,
  );

  React.useEffect(() => {
    if (!datFlags.rateData) {
      setSearchOptions((prev) =>
        prev.includeDatMarketData ? { ...prev, includeDatMarketData: false } : prev,
      );
    }
  }, [datFlags.rateData]);

  React.useEffect(() => {
    setDatError(datBlockedMessage);
  }, [datBlockedMessage]);

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
  const [selectedQuoteId, setSelectedQuoteId] = React.useState<string>("");
  const [workspaceSyncError, setWorkspaceSyncError] = React.useState<string | null>(null);
  const [workspaceTableMissing, setWorkspaceTableMissing] = React.useState(false);
  const [workspaceActionPending, setWorkspaceActionPending] = React.useState(false);
  const [workspaceNotice, setWorkspaceNotice] = React.useState<string | null>(null);
  const runCounter = React.useRef(0);

  /**
   * Whether the bid field holds a number the user typed.
   *
   * The suggestion effect below re-runs whenever the risk inputs move — a
   * leverage exclusion, a background refresh — and it used to call
   * `setFinalBid` every time, wiping a considered number the user had entered
   * seconds earlier with no warning.
   */
  const finalBidEditedRef = React.useRef(false);

  const selectedRiskModel = React.useMemo(
    () => riskModels.find((model) => model.id === selectedRiskModelId) ?? riskModels[0] ?? null,
    [riskModels, selectedRiskModelId],
  );

  const loadFieldOptions = fieldOptions;

  const activeLeverageCount = React.useMemo(
    () => similarActiveLoads.filter((row) => !excludedLeverageIds.includes(row.loadNumber)).length,
    [similarActiveLoads, excludedLeverageIds],
  );

  const applyWorkspaceSnapshot = React.useCallback((snapshot: BiddingWorkspaceSnapshot) => {
    setSavedQuotes(snapshot.quotes.map(bidQuoteToSummary));
    setSelectedQuoteId((prev) =>
      prev && snapshot.quotes.some((quote) => quote.quoteId === prev)
        ? prev
        : (snapshot.quotes[0]?.quoteId ?? ""),
    );
    // No slice here any more: capping the list at 8 left the rest on the server
    // where they could be neither loaded nor deleted.
    setSavedSearches(
      snapshot.searches.map((item) => ({ name: item.searchName, criteria: item.criteria })),
    );
    setLogs(
      snapshot.audit.map((entry) => ({
        searchId: entry.searchId,
        user: entry.userDisplayName || entry.user,
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
      criteria: SearchCriteria,
      options: SearchOptions,
      response: BiddingSearchResponse,
      selectedId: string,
    ) => {
      writeBiddingSearchSessionCache(workspaceId, {
        searchCriteria: criteria,
        searchOptions: options,
        selectedResultId: selectedId,
        results: response.results,
        similarActiveLoads: response.similarActiveLoads,
        backhaulCandidates: response.backhaulCandidates,
        loadsConsidered: response.loadsConsidered,
        cachedAt: new Date().toISOString(),
      });
    },
    [workspaceId],
  );

  const applySearchResponse = React.useCallback(
    (criteria: SearchCriteria, options: SearchOptions, response: BiddingSearchResponse) => {
      const dat = getDatSnapshotForBidding();
      const nextSelectedId = response.results[0]?.id ?? "";

      setDatSnapshot(dat);
      setDatError(datBlockedMessage);
      setResults(response.results);
      setSelectedResultId(nextSelectedId);
      setSimilarActiveLoads(response.similarActiveLoads);
      setBackhaulCandidates(response.backhaulCandidates);
      setExcludedLeverageIds([]);
      setLoadsConsidered(response.loadsConsidered);
      persistSearchSession(criteria, options, response, nextSelectedId);
      return response.results;
    },
    [datBlockedMessage, persistSearchSession],
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

        // Say when a read was capped, rather than implying the list is complete.
        const truncation = getWorkspaceTruncation();
        const notices: string[] = [];
        if (truncation.audit) notices.push("showing the most recent audit entries only");
        if (truncation.quotes) notices.push("showing the most recent quotes only");
        if (!isWorkspaceCachePersisted()) {
          notices.push("this tab's workspace cache is full, so data is refetched on each visit");
        }
        setWorkspaceNotice(notices.length > 0 ? `Workspace: ${notices.join("; ")}.` : null);
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Could not sync bidding workspace from AWS";
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
    if (cachedSearch) {
      // Restore what the user was looking at without a round trip. The next
      // explicit search is what refreshes it.
      setSearchCriteria(cachedSearch.searchCriteria);
      setSearchOptions(cachedSearch.searchOptions);
      setResults(cachedSearch.results);
      setSelectedResultId(cachedSearch.selectedResultId);
      setSimilarActiveLoads(cachedSearch.similarActiveLoads);
      setBackhaulCandidates(cachedSearch.backhaulCandidates);
      setLoadsConsidered(cachedSearch.loadsConsidered);
    }

    void (async () => {
      setLoadsLoading(true);
      setRiskModelsLoading(true);
      setLoadsError(null);
      try {
        // Field options and risk models are small. The loads table itself is no
        // longer fetched here — searching is a server call now.
        const [options, models] = await Promise.all([
          fetchBiddingFieldOptions(),
          fetchBiddingRiskModels(),
          refreshWorkspaceData(false),
        ]);
        if (cancelled) return;

        setFieldOptions(options);
        setRiskModels(models);
        if (models[0]) setSelectedRiskModelId((prev) => prev || models[0].id);
      } catch (err) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : "Could not load bidding data from AWS";
        setLoadsError(message);
      } finally {
        if (!cancelled) {
          setLoadsLoading(false);
          setRiskModelsLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [applyWorkspaceSnapshot, refreshWorkspaceData, workspaceId]);

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
      leverageCount: activeLeverageCount,
    });
    setRiskEvaluation(risk);

    if (!isAiBidConnected()) {
      setAiSuggestion(null);
      if (!finalBidEditedRef.current) {
        setFinalBid(String(Math.round(selectedResult.recommendedBid)));
      }
      return;
    }

    const suggestion = buildAiSuggestion({
      row: selectedResult,
      risk,
      dat: datSnapshot,
      leverageCount: activeLeverageCount,
      backhaulCount: backhaulCandidates.length,
    });
    setAiSuggestion(suggestion);
    if (!finalBidEditedRef.current) {
      setFinalBid(String(Math.round(suggestion.recommendedSellRate)));
    }

    let cancelled = false;
    void enrichBidNarrativesWithAi({
      origin: selectedResult.lane.split(" to ")[0]?.trim() || selectedResult.lane,
      destination: selectedResult.lane.split(" to ")[1]?.trim() || selectedResult.lane,
      recommendedSellRate: suggestion.recommendedSellRate,
      recommendedBuyRate: suggestion.recommendedBuyRate,
      marginPercentage: suggestion.marginPercentage,
      confidenceScore: suggestion.confidenceScore,
      riskLevel: risk.riskLevel,
      datMarketAverage: datSnapshot.marketAverage ?? 0,
      winRate: selectedResult.winRate ?? 0,
      loadCount: selectedResult.loadCount,
      leverageCount: activeLeverageCount,
      backhaulCount: backhaulCandidates.length,
    }).then((enriched) => {
      if (cancelled || !enriched || enriched.error) return;
      setAiSuggestion((prev) =>
        prev
          ? {
              ...prev,
              notes: enriched.notes ?? prev.notes,
              suggestedStrategy: enriched.suggestedStrategy ?? prev.suggestedStrategy,
              customerFacingNote: enriched.customerFacingNote ?? prev.customerFacingNote,
            }
          : prev,
      );
    });

    return () => {
      cancelled = true;
    };
  }, [
    selectedResult,
    datSnapshot,
    selectedRiskModel,
    activeLeverageCount,
    backhaulCandidates.length,
  ]);

  const searchSummary = [
    [searchCriteria.originCity, searchCriteria.originState].filter(Boolean).join(", ") || "Origin",
    searchCriteria.originZip3 ? `(${searchCriteria.originZip3})` : null,
    "to",
    [searchCriteria.destinationCity, searchCriteria.destinationState].filter(Boolean).join(", ") ||
      "Destination",
    searchCriteria.destinationZip3 ? `(${searchCriteria.destinationZip3})` : null,
  ]
    .filter(Boolean)
    .join(" ");

  const hasLaneSearchCriteria = hasSearchableLane(searchCriteria);
  const currentSearchStep = searchStage;

  const searchLane = async () => {
    // Every match rule needs both ends of the lane, so a half-filled form can
    // only ever come back empty. Say so instead of spending a round trip.
    if (!hasLaneSearchCriteria) {
      setActionMessage("Enter an origin and a destination (city or state) before searching.");
      return;
    }

    const runId = ++runCounter.current;
    setIsSearching(true);
    setActionMessage(null);
    setSearchStage("Querying internal historicals");

    try {
      const response = await searchBiddingLanes(searchCriteria, searchOptions);
      if (runId !== runCounter.current) return;

      setSearchStage("Aggregating lane rates");
      setLoadsError(null);
      const nextResults = applySearchResponse(searchCriteria, searchOptions, response);
      setSearchStage("Scoring risk and leverage");
      setDesktopTab("results");
      setActionMessage(
        nextResults.length > 0
          ? `${nextResults.length} lane aggregate${nextResults.length === 1 ? "" : "s"} from ${response.matchedLoads} matching load${response.matchedLoads === 1 ? "" : "s"} of ${response.loadsConsidered} searched.`
          : `No matching historical loads for ${searchSummary}.`,
      );
    } catch (err) {
      if (runId !== runCounter.current) return;
      const message = err instanceof Error ? err.message : "Could not search loads";
      setLoadsError(message);
      setActionMessage(message);
    } finally {
      if (runId === runCounter.current) {
        setIsSearching(false);
        setSearchStage(null);
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
    finalBidEditedRef.current = false;
    setLoadsConsidered(null);
    clearBiddingSearchSessionCache(workspaceId);
    setActionMessage("Search fields reset.");
  };

  /**
   * A name for the saved search that distinguishes searches the lane label
   * cannot.
   *
   * The name doubles as the storage key, and it used to be just
   * `origin-destination-equipment` — so two searches on the same lane with
   * different dates, customers or radius silently replaced one another.
   */
  const savedSearchName = (criteria: SearchCriteria) => {
    const lane =
      [
        criteria.originCity || criteria.originState,
        criteria.destinationCity || criteria.destinationState,
      ]
        .filter(Boolean)
        .join(" to ") || "Unnamed lane";
    const equipment = criteria.equipmentType ? ` · ${criteria.equipmentType}` : "";
    const discriminators = [
      criteria.customer,
      criteria.pickupDate,
      criteria.radiusMiles ? `${criteria.radiusMiles}mi` : "",
      criteria.weight ? `${criteria.weight}lb` : "",
    ]
      .filter(Boolean)
      .join("|");
    const suffix = discriminators ? ` #${hash32(discriminators).toString(36).slice(0, 4)}` : "";
    return `${lane}${equipment}${suffix}`.slice(0, 120);
  };

  const saveSearch = async () => {
    if (!hasLaneSearchCriteria) {
      setActionMessage("Enter an origin and a destination before saving this search.");
      return;
    }
    const name = savedSearchName(searchCriteria);
    setWorkspaceActionPending(true);
    try {
      if (isBiddingWorkspaceAvailable()) {
        await upsertBiddingSavedSearch({
          workspaceId,
          createdBy: workspaceUser,
          searchName: name,
          criteria: searchCriteria,
        });
        await refreshWorkspaceData(true);
        setActionMessage(`Saved search "${name}".`);
      } else {
        setSavedSearches((prev) => [
          { name, criteria: searchCriteria },
          ...prev.filter((item) => item.name !== name),
        ]);
        setActionMessage(
          `Saved search "${name}" locally. Configure BiddingWorkspace in AWS to persist.`,
        );
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
        await refreshWorkspaceData(true);
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
    setActionMessage(`Loaded saved search "${match.name}". Run Search Lane to refresh the rates.`);
  };

  const exportResults = (type: "PDF" | "CSV" | "XLSX") => {
    if (results.length === 0) {
      setActionMessage("Run a search before exporting — there is nothing to export yet.");
      return;
    }
    setActionMessage(
      `${type} export queued with search criteria, historical aggregates, DAT snapshot, leverage candidates, risk output, AI suggestion, and notes.`,
    );
    appendLog("Export", "");
  };

  const refreshDat = async () => {
    if (!datDataEnabled) {
      setDatSnapshot(getDatSnapshotForBidding());
      setDatError(datBlockedMessage ?? DAT_NOT_CONNECTED_MESSAGE);
      setActionMessage(datBlockedMessage ?? DAT_NOT_CONNECTED_MESSAGE);
      return;
    }
    setDatSnapshot((prev) => ({
      ...prev,
      status: "Refreshing",
      sourceStatus: "Refreshing from RateView API...",
    }));
    setDatError(null);
    setDatSnapshot(getDatSnapshotForBidding());
    setDatError(DAT_NOT_CONNECTED_MESSAGE);
    appendLog("Refresh DAT", "");
  };

  const recalculateRisk = () => {
    if (!selectedResult || !selectedRiskModel) {
      setActionMessage("Select a lane result before recalculating risk.");
      return;
    }
    const risk = evaluateRiskDeterministic({
      row: selectedResult,
      dat: datSnapshot,
      model: selectedRiskModel,
      leverageCount: activeLeverageCount,
    });
    setRiskEvaluation(risk);
    appendLog("Recalculate Risk", "", { risk });
    setActionMessage(
      `Risk recalculated with ${selectedRiskModel.name} ${selectedRiskModel.version}.`.trim(),
    );
  };

  const recalculateSuggestion = () => {
    if (!isAiBidConnected()) {
      setActionMessage(AI_NOT_CONNECTED_MESSAGE);
      return;
    }
    if (!selectedResult || !riskEvaluation) {
      setActionMessage("Select a lane result before recalculating the suggestion.");
      return;
    }
    const suggestion = buildAiSuggestion({
      row: selectedResult,
      risk: riskEvaluation,
      dat: datSnapshot,
      leverageCount: activeLeverageCount,
      backhaulCount: backhaulCandidates.length,
    });
    setAiSuggestion(suggestion);
    // An explicit "recalculate" is the one place overwriting a typed bid is
    // what the user asked for.
    setFinalBid(String(Math.round(suggestion.recommendedSellRate)));
    finalBidEditedRef.current = false;
    appendLog("Recalculate Suggestion", "", { ai: suggestion });
    setActionMessage("AI bid suggestion refreshed. Enriching narratives…");

    void enrichBidNarrativesWithAi({
      origin: selectedResult.lane.split(" to ")[0]?.trim() || selectedResult.lane,
      destination: selectedResult.lane.split(" to ")[1]?.trim() || selectedResult.lane,
      recommendedSellRate: suggestion.recommendedSellRate,
      recommendedBuyRate: suggestion.recommendedBuyRate,
      marginPercentage: suggestion.marginPercentage,
      confidenceScore: suggestion.confidenceScore,
      riskLevel: riskEvaluation.riskLevel,
      datMarketAverage: datSnapshot.marketAverage ?? 0,
      winRate: selectedResult.winRate ?? 0,
      loadCount: selectedResult.loadCount,
      leverageCount: activeLeverageCount,
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
      setAiSuggestion((prev) =>
        prev
          ? {
              ...prev,
              notes: enriched.notes ?? prev.notes,
              suggestedStrategy: enriched.suggestedStrategy ?? prev.suggestedStrategy,
              customerFacingNote: enriched.customerFacingNote ?? prev.customerFacingNote,
            }
          : prev,
      );
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

  /** The bid the user actually intends, or `null` if the field is unusable. */
  const resolveFinalBid = (): number | null => {
    const typed = finalBid.trim();
    if (typed) {
      const parsed = Number(typed);
      if (!Number.isFinite(parsed) || parsed <= 0) return null;
      return Math.round(parsed);
    }
    if (selectedResult) return Math.round(selectedResult.recommendedBid);
    return null;
  };

  const saveAsQuote = async (status: "saved" | "draft" = "saved") => {
    if (!selectedResult || !riskEvaluation) {
      setActionMessage("Run a search and select a lane before saving a quote.");
      return;
    }
    const bid = resolveFinalBid();
    if (bid == null) {
      setActionMessage("Enter a bid amount greater than zero before saving.");
      return;
    }
    const buy = selectedResult.historicalAvgBuy;
    if (bid < buy) {
      // Not blocked — a broker may knowingly bid under cost — but never silent.
      setActionMessage(
        `Warning: ${formatCurrency(bid)} is below the historical average buy rate of ${formatCurrency(buy)}.`,
      );
    }

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
          finalBid: String(bid),
          searchCriteria,
        });
        setSavedQuotes((prev) => [
          bidQuoteToSummary(quote),
          ...prev.filter((row) => row.id !== quote.quoteId),
        ]);
        setSelectedQuoteId(quote.quoteId);
        appendLog(status === "draft" ? "Save Draft" : "Save as Quote", quote.quoteId);
        setActionMessage(`Quote ${quote.quoteId} saved with bid ${formatCurrency(bid)}.`);
      } else {
        const quoteId = localQuoteId();
        setSavedQuotes((prev) => [
          { id: quoteId, bid, margin: bid - buy, timestamp: nowStamp(), status },
          ...prev,
        ]);
        setSelectedQuoteId(quoteId);
        appendLog(status === "draft" ? "Save Draft" : "Save as Quote", quoteId);
        setActionMessage(
          `Quote ${quoteId} saved locally. Configure BiddingWorkspace in AWS to persist.`,
        );
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
      setSelectedQuoteId((prev) => (prev === quoteId ? "" : prev));
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
    const bid = resolveFinalBid();
    const loadId = searchCriteria.loadId.trim() || newLoadId();
    setWorkspaceActionPending(true);
    try {
      await createLoad({
        loadId,
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
        customerRate: bid != null && bid > 0 ? String(bid) : undefined,
        carrierRate: selectedResult ? String(selectedResult.historicalAvgBuy) : undefined,
        internalNotes: internalNote || undefined,
      });
      // The new load changes the lane's history, so re-run the search rather
      // than re-downloading the table.
      if (hasLaneSearchCriteria) {
        const response = await searchBiddingLanes(searchCriteria, searchOptions);
        applySearchResponse(searchCriteria, searchOptions, response);
      }
      setSearchCriteria((prev) => ({ ...prev, loadId }));
      appendLog("Create Load", "");
      setActionMessage(`Load ${loadId} created in the Loads table.`);
      toast.success(`Load ${loadId} created`, {
        action: {
          label: "Open load",
          onClick: () => {
            window.location.assign(`/loads/${loadId}`);
          },
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not create load";
      setActionMessage(message);
      toast.error(message);
    } finally {
      setWorkspaceActionPending(false);
    }
  };

  /**
   * The quote these workflow actions apply to.
   *
   * They used to act on `savedQuotes[0]` — the most recent save, not the one on
   * screen — and to report success even when the lookup found nothing.
   */
  const targetQuoteId = selectedQuoteId || savedQuotes[0]?.id || "";

  const attachToRfp = async () => {
    if (!targetQuoteId) {
      setActionMessage("Save a quote first — there is nothing to attach yet.");
      return;
    }
    if (!searchCriteria.rfpId.trim()) {
      setActionMessage("Enter an RFP ID before attaching.");
      return;
    }

    setWorkspaceActionPending(true);
    try {
      if (!isBiddingWorkspaceAvailable()) {
        appendLog("Attach to RFP Lane", targetQuoteId);
        setActionMessage(
          `Attached quote ${targetQuoteId} to ${searchCriteria.rfpId} locally. Configure BiddingWorkspace in AWS to persist.`,
        );
        return;
      }

      // Forced: acting on a cached copy is how a stale quote got "attached"
      // with nothing written.
      const latest = await listBidQuotes(workspaceId, { force: true });
      const match = latest.find((quote) => quote.quoteId === targetQuoteId);
      if (!match) {
        setActionMessage(
          `Quote ${targetQuoteId} is no longer in the workspace. Reload and try again.`,
        );
        return;
      }

      await updateBidQuote({
        ...match,
        status: "attached",
        rfpId: searchCriteria.rfpId,
        rfpLane,
        finalBid,
        internalNote,
      });
      await refreshWorkspaceData(true);
      appendLog("Attach to RFP Lane", targetQuoteId);
      setActionMessage(
        `Quote ${targetQuoteId} attached to ${searchCriteria.rfpId}${rfpLane ? ` lane ${rfpLane}` : ""} with risk evaluation ${selectedRiskModel?.version ?? "—"}.`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not attach to RFP";
      setActionMessage(message);
    } finally {
      setWorkspaceActionPending(false);
    }
  };

  const sendForApproval = async () => {
    if (!targetQuoteId) {
      setActionMessage("Save a quote first — there is nothing to send for approval.");
      return;
    }

    setWorkspaceActionPending(true);
    try {
      if (!isBiddingWorkspaceAvailable()) {
        appendLog("Send for Approval", targetQuoteId);
        setActionMessage(
          `Quote ${targetQuoteId} marked for approval locally. Configure BiddingWorkspace in AWS to persist.`,
        );
        return;
      }

      const latest = await listBidQuotes(workspaceId, { force: true });
      const match = latest.find((quote) => quote.quoteId === targetQuoteId);
      if (!match) {
        setActionMessage(
          `Quote ${targetQuoteId} is no longer in the workspace. Reload and try again.`,
        );
        return;
      }

      await updateBidQuote({ ...match, status: "sent" });
      await refreshWorkspaceData(true);
      appendLog("Send for Approval", targetQuoteId);
      setActionMessage(`Quote ${targetQuoteId} routed to the pricing manager for approval.`);
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

  /**
   * Record an action in the audit trail.
   *
   * Only ever called from a real action. A `useEffect` used to fire this on
   * every risk re-evaluation, which wrote a row on each page visit, each row
   * selection and each leverage toggle — none of them decisions worth
   * recording, all of them permanent.
   */
  const persistAuditLog = async (
    action: string,
    createdQuoteId: string,
    overrides?: { risk?: RiskEvaluation | null; ai?: AiSuggestion | null },
  ) => {
    const risk = overrides?.risk ?? riskEvaluation;
    const ai = overrides?.ai ?? aiSuggestion;
    const entry: BiddingAuditInput = {
      searchId: `SRCH-${hash32(searchSummary).toString(36).toUpperCase().slice(0, 8)}`,
      userDisplayName: workspaceUser,
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

    setLogs((prev) => [{ ...entry, user: workspaceUser }, ...prev].slice(0, 24));

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
      title={t("Spot Load Search")}
      description={t("City/state, 5-digit ZIP, 3-digit ZIP, market area, and radius search.")}
      sticky
      contentClassName="space-y-4 lg:max-h-[calc(100vh-6rem)] lg:overflow-y-auto lg:pr-1"
    >
      <div className="grid gap-3">
        <Field label={t("Origin City")}>
          <Input
            value={searchCriteria.originCity}
            onChange={(event) =>
              setSearchCriteria((prev) => ({ ...prev, originCity: event.target.value }))
            }
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t("Origin State")}>
            <Input
              list={loadFieldOptions.states.length > 0 ? "bidding-origin-states" : undefined}
              value={searchCriteria.originState}
              onChange={(event) =>
                setSearchCriteria((prev) => ({
                  ...prev,
                  originState: event.target.value.toUpperCase(),
                }))
              }
              placeholder={t("State")}
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
          <Field label={t("Origin 5-Digit ZIP")}>
            <Input
              value={searchCriteria.originZip5}
              onChange={(event) =>
                setSearchCriteria((prev) => ({ ...prev, originZip5: event.target.value }))
              }
            />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t("Origin 3-Digit ZIP")}>
            <Input
              value={searchCriteria.originZip3}
              onChange={(event) =>
                setSearchCriteria((prev) => ({ ...prev, originZip3: event.target.value }))
              }
            />
          </Field>
          <Field label={t("Market Area")}>
            <Input
              value={searchCriteria.marketArea}
              onChange={(event) =>
                setSearchCriteria((prev) => ({ ...prev, marketArea: event.target.value }))
              }
            />
          </Field>
        </div>

        <Separator />

        <Field label={t("Destination City")}>
          <Input
            value={searchCriteria.destinationCity}
            onChange={(event) =>
              setSearchCriteria((prev) => ({ ...prev, destinationCity: event.target.value }))
            }
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t("Destination State")}>
            <Input
              list={loadFieldOptions.states.length > 0 ? "bidding-destination-states" : undefined}
              value={searchCriteria.destinationState}
              onChange={(event) =>
                setSearchCriteria((prev) => ({
                  ...prev,
                  destinationState: event.target.value.toUpperCase(),
                }))
              }
              placeholder={t("State")}
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
          <Field label={t("Destination 5-Digit ZIP")}>
            <Input
              value={searchCriteria.destinationZip5}
              onChange={(event) =>
                setSearchCriteria((prev) => ({ ...prev, destinationZip5: event.target.value }))
              }
            />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t("Destination 3-Digit ZIP")}>
            <Input
              value={searchCriteria.destinationZip3}
              onChange={(event) =>
                setSearchCriteria((prev) => ({ ...prev, destinationZip3: event.target.value }))
              }
            />
          </Field>
          <Field label={t("Radius (Miles)")}>
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
          <Field label={t("Equipment Type")}>
            <Input
              list={
                loadFieldOptions.equipmentTypes.length > 0 ? "bidding-equipment-types" : undefined
              }
              value={searchCriteria.equipmentType}
              onChange={(event) =>
                setSearchCriteria((prev) => ({ ...prev, equipmentType: event.target.value }))
              }
              placeholder={t("From AWS loads or enter manually")}
            />
            {loadFieldOptions.equipmentTypes.length > 0 ? (
              <datalist id="bidding-equipment-types">
                {loadFieldOptions.equipmentTypes.map((equipment) => (
                  <option key={equipment} value={equipment} />
                ))}
              </datalist>
            ) : null}
          </Field>
          <Field label={t("Weight")}>
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
          <Field label={t("Pickup Date")}>
            <Input
              type="date"
              value={searchCriteria.pickupDate}
              onChange={(event) =>
                setSearchCriteria((prev) => ({ ...prev, pickupDate: event.target.value }))
              }
            />
          </Field>
          <Field label={t("Delivery Date")}>
            <Input
              type="date"
              value={searchCriteria.deliveryDate}
              onChange={(event) =>
                setSearchCriteria((prev) => ({ ...prev, deliveryDate: event.target.value }))
              }
            />
          </Field>
        </div>

        <Field label={t("Commodity")}>
          <Input
            value={searchCriteria.commodity}
            onChange={(event) =>
              setSearchCriteria((prev) => ({ ...prev, commodity: event.target.value }))
            }
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label={t("Customer")}>
            <Input
              list={loadFieldOptions.customers.length > 0 ? "bidding-customers" : undefined}
              value={searchCriteria.customer}
              onChange={(event) =>
                setSearchCriteria((prev) => ({ ...prev, customer: event.target.value }))
              }
              placeholder={t("From AWS loads or enter manually")}
            />
            {loadFieldOptions.customers.length > 0 ? (
              <datalist id="bidding-customers">
                {loadFieldOptions.customers.map((customer) => (
                  <option key={customer} value={customer} />
                ))}
              </datalist>
            ) : null}
          </Field>
          <Field label={t("Broker")}>
            <Input
              list={loadFieldOptions.brokers.length > 0 ? "bidding-brokers" : undefined}
              value={searchCriteria.broker}
              onChange={(event) =>
                setSearchCriteria((prev) => ({ ...prev, broker: event.target.value }))
              }
              placeholder={t("From AWS loads or enter manually")}
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
          <Field label={t("Reference ID")}>
            <Input
              value={searchCriteria.referenceId}
              onChange={(event) =>
                setSearchCriteria((prev) => ({ ...prev, referenceId: event.target.value }))
              }
            />
          </Field>
          <Field label={t("RFP ID")}>
            <Input
              value={searchCriteria.rfpId}
              onChange={(event) =>
                setSearchCriteria((prev) => ({ ...prev, rfpId: event.target.value }))
              }
            />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t("Quote ID")}>
            <Input
              value={searchCriteria.quoteId}
              onChange={(event) =>
                setSearchCriteria((prev) => ({ ...prev, quoteId: event.target.value }))
              }
            />
          </Field>
          <Field label={t("Load ID")}>
            <Input
              value={searchCriteria.loadId}
              onChange={(event) =>
                setSearchCriteria((prev) => ({ ...prev, loadId: event.target.value }))
              }
            />
          </Field>
        </div>
      </div>

      <Separator />

      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {t("Search Options")}
        </p>
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
            ...(datFlags.rateData
              ? [
                  {
                    id: "includeDatMarketData",
                    label: "Include DAT market data",
                    checked: searchOptions.includeDatMarketData,
                    onCheckedChange: (checked: boolean | string) =>
                      setSearchOptions((prev) => ({
                        ...prev,
                        includeDatMarketData: checked === true,
                      })),
                  },
                ]
              : []),
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
          {isSearching ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Search className="h-4 w-4" />
          )}
          Search Lane
        </Button>
        <Button variant="outline" className="gap-1.5" onClick={clearSearch}>
          {t("Clear Search")}
        </Button>
        <Button
          variant="outline"
          className="gap-1.5"
          onClick={() => void saveSearch()}
          disabled={workspaceActionPending}
        >
          <Save className="h-4 w-4" />
          {t("Save Search")}
        </Button>
        <Button variant="outline" className="gap-1.5" onClick={loadSavedSearch}>
          {t("Load Saved")}
        </Button>
      </div>
      <div className="grid grid-cols-[1fr_auto_auto] gap-2">
        <Select value={selectedSavedSearch} onValueChange={setSelectedSavedSearch}>
          <SelectTrigger>
            <SelectValue placeholder={t("Saved searches")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">{t("Saved searches")}</SelectItem>
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
          title={t("Delete saved search")}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
        <Button variant="outline" className="gap-1.5" onClick={() => exportResults("CSV")}>
          <FileDown className="h-4 w-4" />
          {t("Export")}
        </Button>
      </div>
    </WorkspacePanel>
  );

  const datPanel = (
    <WorkspacePanel
      icon={Database}
      tone="blue"
      title={t("DAT RateView")}
      description={t(
        "Market benchmark data for the searched lane. Admin DAT refresh rules configurable in Settings.",
      )}
      badge={
        <Badge variant="outline" className={cn("font-medium", DAT_STATUS_TONE[datSnapshot.status])}>
          {datSnapshot.status}
        </Badge>
      }
    >
      {datBlockedMessage ? (
        <div className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2.5 text-xs text-warning-foreground">
          {datError ?? datBlockedMessage}
        </div>
      ) : datError ? (
        <div className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2.5 text-xs text-warning-foreground">
          {datError}
        </div>
      ) : null}
      {datBlockedMessage ? (
        <p className="text-xs text-muted-foreground">
          {t(
            "Market benchmark fields below stay empty until DAT RateView is connected. Internal AWS\r\n          load history is still used for bidding.",
          )}
        </p>
      ) : null}
      <div className="grid grid-cols-2 gap-3">
        {datFlags.rateData ? (
          <>
            <InsightStat label={t("DAT Market Minimum")} value={money(datSnapshot.marketMinimum)} />
            <InsightStat
              label={t("DAT Market Average")}
              value={money(datSnapshot.marketAverage)}
              highlight
            />
            <InsightStat label={t("DAT Market Maximum")} value={money(datSnapshot.marketMaximum)} />
            <InsightStat label={t("DAT Rate Per Mile")} value={perMile(datSnapshot.ratePerMile)} />
            <InsightStat
              label={t("DAT Fuel Estimate")}
              value={
                datSnapshot.fuelEstimate == null
                  ? "—"
                  : `$${datSnapshot.fuelEstimate.toFixed(2)}/mi`
              }
            />
          </>
        ) : null}
        {datFlags.capacityData ? (
          <InsightStat
            label={t("DAT Capacity Indicator")}
            value={
              datSnapshot.capacityIndicator == null ? "—" : `${datSnapshot.capacityIndicator}/100`
            }
          />
        ) : null}
        {datFlags.rateData || datFlags.capacityData ? (
          <>
            <InsightStat label={t("DAT Confidence")} value={percent(datSnapshot.confidence, 0)} />
            <InsightStat label={t("DAT Data Window")} value={datFlags.dataWindow} />
            <InsightStat label={t("DAT Last Refreshed")} value={datSnapshot.lastRefreshed} />
            <InsightStat
              label={t("DAT Source Status")}
              value={datSnapshot.sourceStatus}
              className="col-span-2"
            />
          </>
        ) : null}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Button
          variant="outline"
          className="gap-1.5"
          onClick={refreshDat}
          disabled={!datDataEnabled}
        >
          <RefreshCw className="h-4 w-4" />
          {t("Refresh DAT")}
        </Button>
        <Button
          variant="outline"
          className="gap-1.5"
          onClick={() =>
            setActionMessage("Navigate to Settings > Integrations > DAT Refresh Rules.")
          }
        >
          <Filter className="h-4 w-4" />
          {t("Refresh Rules")}
        </Button>
      </div>
    </WorkspacePanel>
  );

  const resultsSection = (
    <WorkspacePanel
      icon={Table2}
      tone="emerald"
      title={t("Bid Intelligence Results")}
      description={t(
        "Combined internal historicals, DAT market data, margin intelligence, and risk scoring.",
      )}
    >
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <InsightStat
          label={t("Historical Loads")}
          value={
            selectedResult
              ? selectedResult.droppedForMissingRates > 0
                ? `${selectedResult.loadCount} (${selectedResult.droppedForMissingRates} skipped)`
                : String(selectedResult.loadCount)
              : "—"
          }
        />
        <InsightStat
          label={t("Win Rate")}
          value={selectedResult ? percent(selectedResult.winRate) : "—"}
        />
        <InsightStat
          label={t("Avg Margin")}
          value={selectedResult ? formatCurrency(selectedResult.historicalMargin) : "—"}
        />
        <InsightStat
          label={t("Recommended Bid")}
          value={selectedResult ? formatCurrency(selectedResult.recommendedBid) : "—"}
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
              <TableHead>{t("Lane")}</TableHead>
              <TableHead>{t("Equipment")}</TableHead>
              <TableHead>{t("Historical Avg Buy")}</TableHead>
              <TableHead>{t("Historical Avg Sell")}</TableHead>
              <TableHead>{t("Historical Margin")}</TableHead>
              <TableHead>{t("Historical Margin %")}</TableHead>
              <TableHead>{t("Standard Deviation")}</TableHead>
              <TableHead>{t("Win Rate")}</TableHead>
              <TableHead>{t("Last 30-Day Avg Buy")}</TableHead>
              <TableHead>{t("Last 30-Day Avg Sell")}</TableHead>
              <TableHead>{t("Last 60-Day Avg Buy")}</TableHead>
              <TableHead>{t("Last 60-Day Avg Sell")}</TableHead>
              <TableHead>{t("Last 90-Day Avg Buy")}</TableHead>
              <TableHead>{t("Last 90-Day Avg Sell")}</TableHead>
              <TableHead>{t("DAT Market Min")}</TableHead>
              <TableHead>{t("DAT Market Avg")}</TableHead>
              <TableHead>{t("DAT Market Max")}</TableHead>
              <TableHead>{t("DAT Rate Per Mile")}</TableHead>
              <TableHead>{t("Margin Band")}</TableHead>
              <TableHead>{t("Risk Score")}</TableHead>
              <TableHead>{t("Similar Active Loads")}</TableHead>
              <TableHead>{t("Confidence")}</TableHead>
              <TableHead>{t("Recommended Bid")}</TableHead>
              <TableHead>{t("Actions")}</TableHead>
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
                    <TableCell>{percent(row.winRate)}</TableCell>
                    <TableCell>{money(row.last30AvgBuy)}</TableCell>
                    <TableCell>{money(row.last30AvgSell)}</TableCell>
                    <TableCell>{money(row.last60AvgBuy)}</TableCell>
                    <TableCell>{money(row.last60AvgSell)}</TableCell>
                    <TableCell>{money(row.last90AvgBuy)}</TableCell>
                    <TableCell>{money(row.last90AvgSell)}</TableCell>
                    <TableCell>{money(row.datMarketMin)}</TableCell>
                    <TableCell>{money(row.datMarketAvg)}</TableCell>
                    <TableCell>{money(row.datMarketMax)}</TableCell>
                    <TableCell>{perMile(row.datRatePerMile)}</TableCell>
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
                        {t("Select")}
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
      title={t("Leverage Panel")}
      description={t(
        "Similar active loads, adjacent lanes, backhaul candidates, capacity opportunities, and leverage context.",
      )}
    >
      <Tabs defaultValue="similar" className="w-full">
        <div className="rounded-xl border border-border/70 bg-muted/20 p-1.5">
          <TabsList className="inline-flex h-auto w-full gap-0.5 bg-transparent p-0">
            <TabsTrigger
              value="similar"
              className="flex-1 rounded-lg px-2 py-2 text-xs data-[state=active]:bg-background data-[state=active]:shadow-sm sm:text-sm"
            >
              {t("Similar Loads")}
            </TabsTrigger>
            <TabsTrigger
              value="backhaul"
              className="flex-1 rounded-lg px-2 py-2 text-xs data-[state=active]:bg-background data-[state=active]:shadow-sm sm:text-sm"
            >
              {t("Backhaul")}
            </TabsTrigger>
            <TabsTrigger
              value="leverage"
              className="flex-1 rounded-lg px-2 py-2 text-xs data-[state=active]:bg-background data-[state=active]:shadow-sm sm:text-sm"
            >
              {t("Leverage")}
            </TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="similar" className="mt-3 space-y-3">
          {similarActiveLoads.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t("No similar active loads in AWS for this lane.")}
            </p>
          ) : null}
          {similarActiveLoads.map((load) => {
            const excluded = excludedLeverageIds.includes(load.loadNumber);
            return (
              <div
                key={load.loadNumber}
                className="rounded-xl border border-border/70 bg-card p-3.5 shadow-sm transition-shadow hover:shadow-md"
              >
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
                  <span>Buy: {money(load.buyRate)}</span>
                  <span>Sell: {money(load.sellRate)}</span>
                  <span>Margin: {money(load.margin)}</span>
                  <span>Carrier: {load.assignedCarrier}</span>
                  <span>Pickup: {load.pickupDate}</span>
                  <span>Match: {load.matchType}</span>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <Button size="sm" variant="outline" className="h-8 text-[11px]">
                    {t("View Load")}
                  </Button>
                  <Button size="sm" variant="outline" className="h-8 text-[11px]">
                    {t("Attach as Leverage")}
                  </Button>
                  <Button size="sm" variant="outline" className="h-8 text-[11px]">
                    {t("Contact Carrier")}
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
              {t("No backhaul candidates in AWS for this lane.")}
            </p>
          ) : null}
          {backhaulCandidates.map((candidate) => (
            <div
              key={candidate.loadNumber}
              className="rounded-xl border border-border/70 bg-card p-3.5 shadow-sm transition-shadow hover:shadow-md"
            >
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
                <span>Repositions from: {candidate.currentDeliveryMarket}</span>
                <span>Equipment: {candidate.equipment}</span>
                <span>Available: {candidate.availableDate}</span>
                <span>Returns to: {candidate.destination}</span>
                <span>Similarity: {candidate.similarityPct}%</span>
                <span>Backhaul Value: {money(candidate.estimatedBackhaulValue)}</span>
                <span>Carrier: {candidate.suggestedCarrier}</span>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <Button size="sm" variant="outline" className="h-8 text-[11px]">
                  {t("Use as Backhaul")}
                </Button>
                <Button size="sm" variant="outline" className="h-8 text-[11px]">
                  {t("Add to Bid Notes")}
                </Button>
              </div>
            </div>
          ))}
        </TabsContent>
        <TabsContent value="leverage" className="mt-3 grid gap-2 sm:grid-cols-2">
          <InsightStat
            label={t("Capacity Opportunities")}
            value={`${Math.max(2, similarActiveLoads.length - 1)} carrier clusters`}
          />
          <InsightStat
            label={t("Customer Leverage")}
            value={
              similarActiveLoads.length > 0
                ? `${searchCriteria.customer} has ${similarActiveLoads.length} similar active load${similarActiveLoads.length === 1 ? "" : "s"} in AWS.`
                : "No similar active loads in AWS for this lane."
            }
          />
          <InsightStat
            label={t("Carrier Leverage")}
            value={
              similarActiveLoads.length > 0
                ? `${new Set(similarActiveLoads.map((load) => load.assignedCarrier)).size} carriers overlapping on this lane.`
                : "No carrier overlap detected in AWS."
            }
          />
          <InsightStat
            label={t("Backhaul Ranking Logic")}
            value="Lane similarity, equipment match, date compatibility, deadhead, carrier availability, win rate, margin opportunity, risk."
          />
          <InsightStat
            label={t("Similarity Factors")}
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
      title={t("Risk Model Slot")}
      description={t(
        "Published admin-curated model evaluation with deterministic output and reproducible inputs.",
      )}
    >
      {riskModelsLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-3.5 w-28" />
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-3 w-3/4" />
        </div>
      ) : (
        <Field label={t("Select Risk Model")}>
          <Select
            value={selectedRiskModelId || undefined}
            onValueChange={setSelectedRiskModelId}
            disabled={riskModels.length === 0}
          >
            <SelectTrigger>
              <SelectValue placeholder={t("Select a risk model")} />
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
          <InsightStat label={t("Model Version")} value={selectedRiskModel.version} />
          <InsightStat label={t("Model Owner")} value={selectedRiskModel.owner} />
          <InsightStat label={t("Last Published")} value={selectedRiskModel.lastPublished} />
          <InsightStat label={t("Risk Type")} value={selectedRiskModel.riskType} />
          <InsightStat
            label={t("Inputs Required")}
            value={String(selectedRiskModel.inputsRequired.length)}
          />
          <InsightStat
            label={t("Output Risk %")}
            value={riskEvaluation ? `${riskEvaluation.outputRiskPct}%` : "-"}
            highlight
          />
        </div>
      ) : null}
      <Separator />
      {riskEvaluation ? (
        <div className="space-y-3">
          <div className="rounded-xl border border-border/70 bg-muted/20 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {t("Risk Output")}
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
              {t("Input Values Used")}
            </p>
            <div className="grid grid-cols-2 gap-2 text-xs">
              {Object.entries(riskEvaluation.inputValues).map(([key, value]) => (
                <div key={key} className="rounded-md border border-border/70 px-2.5 py-2">
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    {titleCase(key)}
                  </p>
                  <p className="font-medium">{value.toFixed(2)}</p>
                </div>
              ))}
            </div>
          </div>
          <div className="space-y-1.5">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {t("Reason Codes")}
            </p>
            {riskEvaluation.reasonCodes.map((code) => (
              <Badge key={code} variant="outline" className="mr-1 mb-1">
                {code}
              </Badge>
            ))}
          </div>
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {t("Top Contributing Factors")}
            </p>
            {riskEvaluation.topContributingFactors.map((factor) => {
              const width = clamp(Math.abs(factor.contribution), 4, 100);
              return (
                <div key={factor.name} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span>{factor.name}</span>
                    <span
                      className={
                        factor.direction === "Positive" ? "text-rose-600" : "text-emerald-600"
                      }
                    >
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
            {t("Recalculate Risk")}
          </Button>
        </div>
      ) : null}
    </WorkspacePanel>
  );

  const aiPanel = (
    <WorkspacePanel
      icon={Bot}
      tone="violet"
      title={t("AI Bid Suggestion")}
      description={t(
        "Suggested bid range using internal historicals, DAT market data, leverage, margin targets, and risk output.",
      )}
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
              {t("Suggested Bid Range")}
            </p>
            <p className="mt-1 text-xl font-semibold">
              {formatCurrency(aiSuggestion.suggestedBidLow)} to{" "}
              {formatCurrency(aiSuggestion.suggestedBidHigh)}
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
                {t("Confidence")}
              </p>
              <p className="text-sm font-medium">{aiSuggestion.confidenceLevel}</p>
            </div>
            <Badge variant="outline">{aiSuggestion.confidenceScore}%</Badge>
          </div>
          <div className="space-y-1">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {t("Guardrails")}
            </p>
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
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {t("Notes")}
            </p>
            <p className="rounded-md border border-border/70 px-3 py-2 text-xs text-muted-foreground">
              {aiSuggestion.notes}
            </p>
          </div>
          <div className="space-y-1">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {t("Key Drivers")}
            </p>
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
                {t("Why this suggestion?")}
                <ArrowUpRight
                  className={cn("h-3.5 w-3.5 transition", showWhySuggestion && "rotate-45")}
                />
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
            <Button
              className="gap-1.5"
              onClick={() => void saveAsQuote()}
              disabled={workspaceActionPending}
            >
              <Save className="h-4 w-4" />
              {t("Save as Quote")}
            </Button>
            <Button
              variant="outline"
              className="gap-1.5"
              onClick={() => void attachToRfp()}
              disabled={workspaceActionPending}
            >
              {t("Attach to RFP")}
            </Button>
            <Button variant="outline" className="gap-1.5" onClick={copyBid}>
              <Copy className="h-4 w-4" />
              {t("Copy Bid")}
            </Button>
            <Button variant="outline" className="gap-1.5" onClick={recalculateSuggestion}>
              <WandSparkles className="h-4 w-4" />
              {t("Recalculate")}
            </Button>
          </div>
        </>
      ) : (
        <p className="text-sm text-muted-foreground">
          {t("Run a lane search to generate AI bid suggestions.")}
        </p>
      )}
    </WorkspacePanel>
  );

  const actionsPanel = (
    <WorkspacePanel
      icon={ClipboardList}
      tone="cyan"
      title={t("Actions")}
      description={t(
        "Save as quote, attach to RFP lane, export, approvals, notes, and load creation workflow.",
      )}
      contentClassName="space-y-4"
    >
      <Field
        label={t("Selected Bid Amount")}
        hint={
          finalBidEditedRef.current && aiSuggestion
            ? `Your figure. The suggestion was ${formatCurrency(aiSuggestion.recommendedSellRate)} — "Recalculate" restores it.`
            : undefined
        }
      >
        <Input
          inputMode="decimal"
          value={finalBid}
          onChange={(event) => {
            // Arms the guard in the suggestion effect: once the desk has typed a
            // number, a leverage toggle or a background refresh must not silently
            // replace it.
            finalBidEditedRef.current = true;
            setFinalBid(event.target.value);
          }}
        />
      </Field>
      <Field label={t("Attach to RFP Lane")}>
        <Input
          value={rfpLane}
          onChange={(event) => setRfpLane(event.target.value)}
          placeholder={t("Lane identifier or description")}
        />
      </Field>
      <Field label={t("Internal Pricing Note")}>
        <Textarea
          rows={3}
          value={internalNote}
          onChange={(event) => setInternalNote(event.target.value)}
          placeholder={t("Capture pricing rationale, exceptions, or manager notes...")}
        />
      </Field>
      <Separator />
      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {t("Primary")}
        </p>
        <div className="grid grid-cols-2 gap-2">
          <Button
            className="gap-1.5"
            onClick={() => void saveAsQuote()}
            disabled={workspaceActionPending}
          >
            <Save className="h-4 w-4" />
            {t("Save as Quote")}
          </Button>
          <Button
            variant="outline"
            className="gap-1.5"
            onClick={() => void attachToRfp()}
            disabled={workspaceActionPending}
          >
            {t("Attach to RFP Lane")}
          </Button>
        </div>
      </div>
      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {t("Export")}
        </p>
        <div className="grid grid-cols-2 gap-2">
          <Button variant="outline" className="gap-1.5" onClick={() => exportResults("PDF")}>
            <Download className="h-4 w-4" />
            {t("Export PDF")}
          </Button>
          <Button variant="outline" className="gap-1.5" onClick={() => exportResults("CSV")}>
            {t("Export CSV")}
          </Button>
          <Button variant="outline" className="gap-1.5" onClick={() => exportResults("XLSX")}>
            {t("Export XLSX")}
          </Button>
          <Button
            variant="outline"
            className="gap-1.5"
            onClick={() => void sendForApproval()}
            disabled={workspaceActionPending}
          >
            {t("Send for Approval")}
          </Button>
        </div>
      </div>
      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {t("Workflow")}
        </p>
        <div className="grid grid-cols-2 gap-2">
          <Button
            variant="outline"
            className="gap-1.5"
            onClick={() => void saveAsQuote("draft")}
            disabled={workspaceActionPending}
          >
            {t("Save Draft")}
          </Button>
          <Button
            variant="outline"
            className="gap-1.5"
            onClick={() => setActionMessage("Internal note added to bid package.")}
          >
            {t("Add Internal Note")}
          </Button>
          <Button
            variant="outline"
            className="gap-1.5"
            onClick={() => setActionMessage("Sales team notified.")}
          >
            {t("Share with Sales")}
          </Button>
          <Button
            variant="outline"
            className="gap-1.5"
            onClick={refreshDat}
            disabled={!datDataEnabled}
          >
            {t("Refresh DAT")}
          </Button>
          <Button variant="outline" className="gap-1.5" onClick={recalculateRisk}>
            {t("Recalculate Risk")}
          </Button>
          <Button variant="outline" className="gap-1.5" onClick={recalculateSuggestion}>
            {t("Recalculate Suggestion")}
          </Button>
          <Button
            variant="outline"
            className="col-span-2 gap-1.5"
            disabled={workspaceActionPending}
            onClick={() => void createLoadFromBid()}
          >
            {t("Create Load in AWS")}
          </Button>
        </div>
      </div>
    </WorkspacePanel>
  );

  const savedQuotesPanel = (
    <WorkspacePanel
      icon={CheckCircle2}
      tone="emerald"
      title={t("Saved Quote Actions")}
      description={t("Latest quote saves with margin snapshots for reproducibility and handoff.")}
    >
      {savedQuotes.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {t('No quotes saved yet. Use "Save as Quote" to capture this workspace output.')}
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
                  {t("Open Quote")}
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
          {t("Export PDF")}
        </Button>
        <Button variant="outline" className="gap-1.5" onClick={() => exportResults("XLSX")}>
          <FileDown className="h-4 w-4" />
          {t("Export XLSX")}
        </Button>
      </div>
    </WorkspacePanel>
  );

  const auditPanel = (
    <WorkspacePanel
      icon={ClipboardList}
      tone="default"
      title={t("Audit / Calculation Log")}
      description={t(
        "Search, DAT snapshot, risk model version + inputs, AI suggestion timestamp, selected bid, and final action.",
      )}
      contentClassName="p-0 pt-0"
    >
      <div className="w-full min-w-0 max-w-full overflow-x-auto rounded-xl border border-border/70 bg-muted/10">
        <Table className="min-w-[1420px] text-xs">
          <TableHeader>
            <TableRow>
              <TableHead>{t("Search ID")}</TableHead>
              <TableHead>{t("User")}</TableHead>
              <TableHead>{t("Origin")}</TableHead>
              <TableHead>{t("Destination")}</TableHead>
              <TableHead>{t("Equipment")}</TableHead>
              <TableHead>{t("Date")}</TableHead>
              <TableHead>{t("Historical Timestamp")}</TableHead>
              <TableHead>{t("DAT Timestamp")}</TableHead>
              <TableHead>{t("Risk Model ID")}</TableHead>
              <TableHead>{t("Risk Model Version")}</TableHead>
              <TableHead>{t("Risk Input Values")}</TableHead>
              <TableHead>{t("Risk Output")}</TableHead>
              <TableHead>{t("AI Suggestion Timestamp")}</TableHead>
              <TableHead>{t("Final Selected Bid")}</TableHead>
              <TableHead>{t("Action Taken")}</TableHead>
              <TableHead>{t("Created Quote ID")}</TableHead>
              <TableHead>{t("Attached RFP ID")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {logs.length === 0 ? (
              <TableRow>
                <TableCell colSpan={17} className="text-center text-muted-foreground">
                  {t(
                    "No audit entries yet. Run search, risk, AI, or quote actions to populate logs.",
                  )}
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
        title={t("Bidding Workspace")}
        description={t(
          "Spot-load pricing command center with internal historicals, DAT intelligence, leverage context, deterministic risk scoring, and AI-powered bid suggestions.",
        )}
        actions={
          <>
            <Button
              variant="outline"
              className="gap-1.5"
              onClick={refreshDat}
              disabled={!datDataEnabled}
            >
              <RefreshCw className="h-4 w-4" />
              {t("Refresh DAT")}
            </Button>
            <Button variant="outline" className="gap-1.5" onClick={recalculateRisk}>
              <Gauge className="h-4 w-4" />
              {t("Recalculate Risk")}
            </Button>
            <Button
              className="gap-1.5"
              onClick={() => void saveAsQuote()}
              disabled={workspaceActionPending}
            >
              <Save className="h-4 w-4" />
              {t("Save as Quote")}
            </Button>
          </>
        }
      />

      <div className="px-4 pb-4 pt-3 sm:px-6 lg:hidden">
        <div className="sticky top-2 z-[1] rounded-xl border border-border/70 bg-card/95 p-4 shadow-sm backdrop-blur">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                {t("Active Lane")}
              </p>
              <p className="truncate text-sm font-semibold">{searchSummary}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {searchCriteria.equipmentType} · {searchCriteria.pickupDate} ·{" "}
                {searchCriteria.weight.toLocaleString()} lb
              </p>
            </div>
            <Badge
              variant="outline"
              className={cn("shrink-0 font-medium", DAT_STATUS_TONE[datSnapshot.status])}
            >
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
              Loads searched: {loadsConsidered ?? "—"} · Quotes: {savedQuotes.length} · Searches:{" "}
              {savedSearches.length}
              {isBiddingWorkspaceAvailable()
                ? " · Workspace CRUD enabled"
                : " · Workspace CRUD local-only"}
              {isSearching ? " · Searching…" : ""}
            </div>
          )}
          {workspaceSyncError ? (
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-sm text-destructive sm:col-span-2 xl:col-span-3">
              {workspaceSyncError}
            </div>
          ) : null}
          {workspaceNotice ? (
            <div className="rounded-lg border border-border/70 bg-muted/20 px-3 py-2.5 text-sm text-muted-foreground sm:col-span-2 xl:col-span-3">
              {workspaceNotice}
            </div>
          ) : null}
          {workspaceTableMissing ? (
            <div className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2.5 text-sm text-warning-foreground sm:col-span-2 xl:col-span-3">
              {getBiddingWorkspaceTableMissingMessage()}
            </div>
          ) : !isBiddingWorkspaceConfigured() ? (
            <div className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2.5 text-sm text-warning-foreground sm:col-span-2 xl:col-span-3">
              Bidding workspace CRUD is local-only. Create DynamoDB table{" "}
              <span className="font-medium">{t("BiddingWorkspace")}</span> with keys{" "}
              <span className="font-medium">workspaceId</span> +{" "}
              <span className="font-medium">itemKey</span> to persist quotes, saved searches, and
              audit logs.
            </div>
          ) : null}
          {!datDataEnabled ? (
            <div className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2.5 text-sm text-warning-foreground">
              {datBlockedMessage}
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
              label={t("Historical Avg Sell")}
              value={selectedResult ? formatCurrency(selectedResult.historicalAvgSell) : "—"}
              subtitle={t("Internal 90-day baseline from AWS loads")}
              tone="info"
              state={selectedResult ? "value" : "empty"}
              icon={<TrendingUp className="h-4 w-4" />}
            />
            <MetricCard
              label={t("DAT Market Avg")}
              value={money(datSnapshot.marketAverage)}
              subtitle={
                datRatesEnabled
                  ? `${datFlags.dataWindow} RateView window`
                  : datFlags.rateData
                    ? "Connect RateView in Settings → Integrations"
                    : "DAT rate data is disabled in Settings → Integrations"
              }
              tone="warning"
              state={datRatesEnabled ? "value" : "disconnected"}
              icon={<MapPinned className="h-4 w-4" />}
            />
            <MetricCard
              label={t("Risk Score")}
              value={riskEvaluation ? `${riskEvaluation.outputRiskPct}%` : "—"}
              subtitle={
                riskEvaluation ? riskEvaluation.riskLevel : "Select a lane result to evaluate"
              }
              tone={riskMetricTone}
              state={riskEvaluation ? "value" : "empty"}
              icon={<Target className="h-4 w-4" />}
            />
            <MetricCard
              label={t("AI Confidence")}
              value={isAiBidConnected() && aiSuggestion ? `${aiSuggestion.confidenceScore}%` : "—"}
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

function riskTone(level: RiskLevel) {
  if (level === "Low Risk")
    return "border-emerald-300 text-emerald-700 dark:border-emerald-800 dark:text-emerald-300";
  if (level === "Medium Risk")
    return "border-sky-300 text-sky-700 dark:border-sky-800 dark:text-sky-300";
  if (level === "High Risk")
    return "border-amber-300 text-amber-700 dark:border-amber-800 dark:text-amber-300";
  return "border-rose-300 text-rose-700 dark:border-rose-800 dark:text-rose-300";
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

/**
 * Currency, or an em dash when the engine had nothing to compute from.
 *
 * The results table used to print a hard $0 for a disconnected DAT feed while
 * the DAT panel beside it printed an em dash for the same value.
 */
function money(value: number | null | undefined) {
  return value == null ? "—" : formatCurrency(value);
}

function percent(value: number | null | undefined, digits = 1) {
  return value == null ? "—" : `${value.toFixed(digits)}%`;
}

function perMile(value: number | null | undefined) {
  return value == null ? "—" : `$${value.toFixed(2)}`;
}

/** Collision-resistant id for a new load. */
function newLoadId() {
  return `LD-${randomSuffix(8)}`;
}

function localQuoteId() {
  return `QT-${randomSuffix(6)}`;
}

/**
 * Random, not time-derived.
 *
 * Ids used to be the last six digits of `Date.now()`, which repeats every 16.7
 * minutes — and the server's `attribute_not_exists` guard turned each repeat
 * into a failed create the user had to retry.
 */
function randomSuffix(length: number) {
  const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  const bytes = new Uint8Array(length);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
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
    <Card
      className={cn(
        "min-w-0 border-border/70 shadow-sm",
        sticky && "lg:sticky lg:top-4 lg:self-start",
      )}
    >
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
              {description ? (
                <CardDescription className="mt-1">{description}</CardDescription>
              ) : null}
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
          <span
            className={cn(
              "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border",
              toneClass,
            )}
          >
            {icon}
          </span>
        </div>

        <div className="mt-3 min-h-[2.25rem]">
          {state === "disconnected" ? (
            <span className="inline-flex max-w-full items-center rounded-full border border-warning/30 bg-warning/10 px-2.5 py-1 text-xs font-medium text-warning-foreground">
              {t("Not connected")}
            </span>
          ) : state === "empty" ? (
            <p className="text-2xl font-semibold leading-none text-muted-foreground/70">—</p>
          ) : (
            <p className="truncate text-2xl font-semibold leading-none tracking-tight">{value}</p>
          )}
        </div>

        <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
          {subtitle}
        </p>
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
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className={cn("mt-1 text-sm font-semibold tracking-tight", highlight && "text-primary")}>
        {value}
      </p>
    </div>
  );
}

/**
 * A labelled control.
 *
 * The label is bound to the control with a generated id: this used to render a
 * bare `<Label>` next to children that carried no `id`, so nothing associated
 * them. Every input on this page announced as unlabelled, and clicking a label
 * did not focus its field — WCAG 1.3.1 and 4.1.2, on the page's main workflow.
 */
function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
}) {
  const id = React.useId();
  const hintId = `${id}-hint`;

  // Several fields render an <Input> plus a <datalist>, so children is an
  // array. Bind the label to the first non-datalist element — the control.
  let bound = false;
  const control = React.Children.map(children, (child) => {
    if (bound || !React.isValidElement(child) || child.type === "datalist") return child;
    bound = true;
    return React.cloneElement(child as React.ReactElement<Record<string, unknown>>, {
      id,
      ...(hint ? { "aria-describedby": hintId } : {}),
    });
  });

  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-xs font-medium text-muted-foreground">
        {label}
      </Label>
      {control}
      {hint ? (
        <p id={hintId} className="text-[11px] text-muted-foreground">
          {hint}
        </p>
      ) : null}
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
          <Checkbox
            id={option.id}
            checked={option.checked}
            onCheckedChange={option.onCheckedChange}
          />
          <span>{option.label}</span>
        </label>
      ))}
    </div>
  );
}
