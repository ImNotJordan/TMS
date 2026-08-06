import { askWorkspaceAi, isWorkspaceAiReady } from "@/lib/ai-client";
import type { AnalyticsKpi, ScorecardRow } from "@/lib/analytics-kpis";
import { formatMoneyCompact } from "@/lib/dashboard-data";

const SYSTEM_ANALYTICS = `You are a senior freight brokerage analytics advisor for Titan Freight.
Be concise, operational, and specific to the numbers provided.
No emojis. No markdown fences unless asked. Prefer short bullets or 2–4 tight sentences.`;

export type AnalyticsAiBriefingInput = {
  kpis: AnalyticsKpi[];
  reliability: ScorecardRow[];
  lanes: ScorecardRow[];
  credit: ScorecardRow[];
};

export type BackhaulAiContext = {
  origin: string;
  destination: string;
  emptyMiles: number;
  equipment: string;
  uplift: number;
  fillProbability: number;
  recommendedBid: number;
  baselineNotes: string[];
};

function topRows(rows: ScorecardRow[], n = 5) {
  return rows.slice(0, n).map((r) => ({
    name: r.name,
    score: r.score,
    meta: r.meta,
  }));
}

/** High-level AI Insights briefing from event-table KPIs + scorecards. */
export async function generateAnalyticsAiBriefing(
  input: AnalyticsAiBriefingInput,
  signal?: AbortSignal,
): Promise<{ text: string; usedAi: boolean; error?: string }> {
  const fallback =
    "Connect OpenAI in Settings → Integrations to generate a live briefing. Scores below are still computed from analytics event tables.";

  if (!isWorkspaceAiReady()) {
    return { text: fallback, usedAi: false };
  }

  const result = await askWorkspaceAi({
    feature: "analytics-insights",
    system: SYSTEM_ANALYTICS,
    prompt: `Write an executive briefing for the Analytics → AI Insights tab.

KPIs:
${JSON.stringify(
  input.kpis.map((k) => ({ label: k.label, value: k.value })),
  null,
  2,
)}

Top carrier reliability:
${JSON.stringify(topRows(input.reliability), null, 2)}

Lane profitability:
${JSON.stringify(topRows(input.lanes), null, 2)}

Customer credit watchlist (lower score = higher risk):
${JSON.stringify(topRows(input.credit), null, 2)}

Cover: (1) what looks healthy, (2) what needs attention this week, (3) one concrete action for ops and one for sales/finance.`,
    temperature: 0.4,
    maxTokens: 550,
    signal,
  });

  if (result.status === "ok") {
    return { text: result.text, usedAi: true };
  }

  return { text: fallback, usedAi: false, error: result.message };
}

/** Explain a scorecard domain with the workspace model. */
export async function explainAnalyticsScorecard(params: {
  domain: "reliability" | "lanes" | "credit";
  rows: ScorecardRow[];
  signal?: AbortSignal;
}): Promise<{ text: string; usedAi: boolean; error?: string }> {
  const labels = {
    reliability: "Predictive Carrier Reliability",
    lanes: "Dynamic Lane Profitability & Network Design",
    credit: "Customer Risk & Credit AI",
  } as const;

  const fallback =
    params.rows.length === 0
      ? `No ${labels[params.domain]} rows in this period yet.`
      : `${labels[params.domain]}: leading row is ${params.rows[0]!.name} (score ${params.rows[0]!.score}). Connect OpenAI in Settings → Integrations for a deeper read.`;

  if (!isWorkspaceAiReady()) {
    return { text: fallback, usedAi: false };
  }

  const result = await askWorkspaceAi({
    feature: "analytics-insights",
    system: SYSTEM_ANALYTICS,
    prompt: `Explain ${labels[params.domain]} for a brokerage leadership audience.

Data (from analytics event tables):
${JSON.stringify(topRows(params.rows, 8), null, 2)}

Give: summary, risks, and 2 recommended actions. Keep under 180 words.`,
    temperature: 0.35,
    maxTokens: 400,
    signal: params.signal,
  });

  if (result.status === "ok") {
    return { text: result.text, usedAi: true };
  }

  return { text: fallback, usedAi: false, error: result.message };
}

/**
 * Enrich backhaul what-if with OpenAI while keeping numeric scores deterministic.
 */
export async function enrichBackhaulWhatIfWithAi(
  context: BackhaulAiContext,
  signal?: AbortSignal,
): Promise<{ notes: string[]; strategy?: string; usedAi: boolean; error?: string }> {
  if (!isWorkspaceAiReady()) {
    return { notes: context.baselineNotes, usedAi: false };
  }

  const result = await askWorkspaceAi({
    feature: "analytics-copilot",
    system: `${SYSTEM_ANALYTICS}
Return ONLY valid JSON with keys: notes (string array, 3 items max), strategy (string).
Do not invent different dollar amounts than the provided uplift / bid — interpret them.`,
    prompt: JSON.stringify(
      {
        corridor: `${context.origin} → ${context.destination}`,
        emptyMiles: context.emptyMiles,
        equipment: context.equipment,
        upliftUsd: context.uplift,
        fillProbability: context.fillProbability,
        recommendedBidUsd: context.recommendedBid,
        baselineNotes: context.baselineNotes,
      },
      null,
      2,
    ),
    temperature: 0.35,
    maxTokens: 420,
    signal,
  });

  if (result.status !== "ok") {
    return {
      notes: context.baselineNotes,
      usedAi: false,
      error: result.message,
    };
  }

  try {
    const parsed = JSON.parse(result.text) as {
      notes?: unknown;
      strategy?: unknown;
    };
    const notes = Array.isArray(parsed.notes)
      ? parsed.notes.filter((n): n is string => typeof n === "string" && n.trim().length > 0).slice(0, 4)
      : [];
    return {
      notes: notes.length > 0 ? notes : context.baselineNotes,
      strategy: typeof parsed.strategy === "string" ? parsed.strategy.trim() : undefined,
      usedAi: true,
    };
  } catch {
    return {
      notes: [result.text, ...context.baselineNotes].slice(0, 4),
      usedAi: true,
    };
  }
}

export function formatBackhaulContextLine(context: BackhaulAiContext): string {
  return `${context.origin} → ${context.destination} · empty ${context.emptyMiles} mi · uplift ${formatMoneyCompact(context.uplift)} · fill ${(context.fillProbability * 100).toFixed(0)}%`;
}
