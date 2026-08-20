import { askWorkspaceAi, isWorkspaceAiReady } from "@/lib/ai-client";
import type { CrmCampaignType } from "@/lib/crm-store";

const SYSTEM_FREIGHT_COPYWRITER = `You are a senior freight brokerage marketing copywriter for Titan Freight.
Write clear, professional B2B logistics copy. No emojis. No purple-prose fluff.
Use active voice. Keep claims grounded (capacity, transit reliability, pricing transparency, dispatch).`;

/**
 * Template fallback when AI is disconnected — keeps Content Studio usable offline.
 */
export function draftCampaignContentTemplate(params: {
  name: string;
  type: CrmCampaignType;
  audience?: string;
}): string {
  const audience = params.audience?.trim() || "your target shippers";

  switch (params.type) {
    case "email_sequence":
      return `Subject: Let's simplify your freight — ${params.name}\n\nHi {{first_name}},\n\nWe work with ${audience} to cut transit delays and tighten costs on recurring lanes. Would a 15-minute call this week make sense?\n\nBest,\n{{sender_name}}`;
    case "landing_page":
      return `# ${params.name}\n\nReliable capacity for ${audience}.\n\n- On-time, tracked freight\n- Transparent, margin-aware pricing\n- Dedicated dispatch support\n\n[Get a quote]`;
    case "social":
      return `Looking to tighten up your freight spend this quarter? We're helping ${audience} book capacity faster with fewer surprises. DM us or check the link in bio. #logistics #freight`;
    case "content_studio":
    default:
      return `Draft post — ${params.name}\n\nAngle: why ${audience} are moving away from manual load-board hunting and toward guardrail-driven prospecting.\n\n(Connect OpenAI in Settings → Integrations for live AI drafts.)`;
  }
}

/** @deprecated Prefer draftCampaignContentAsync — sync template for callers that cannot await. */
export function draftCampaignContent(params: {
  name: string;
  type: CrmCampaignType;
  audience?: string;
}): string {
  return draftCampaignContentTemplate(params);
}

export async function draftCampaignContentAsync(params: {
  name: string;
  type: CrmCampaignType;
  audience?: string;
  signal?: AbortSignal;
}): Promise<{ text: string; usedAi: boolean; error?: string }> {
  const fallback = draftCampaignContentTemplate(params);
  if (!isWorkspaceAiReady()) {
    return { text: fallback, usedAi: false };
  }

  const audience = params.audience?.trim() || "mid-market shippers";
  const typeLabel: Record<CrmCampaignType, string> = {
    email_sequence: "email outreach sequence (subject + body with {{first_name}} / {{sender_name}} tokens)",
    landing_page: "landing page markdown (headline, bullets, CTA)",
    social: "short social post",
    content_studio: "thought-leadership post for freight operators",
  };

  const result = await askWorkspaceAi({
    feature: "content-studio",
    system: SYSTEM_FREIGHT_COPYWRITER,
    prompt: `Campaign name: ${params.name || "Untitled"}
Type: ${typeLabel[params.type]}
Audience: ${audience}

Write the full draft only — no preamble.`,
    temperature: 0.55,
    maxTokens: 900,
    signal: params.signal,
  });

  if (result.status === "ok") {
    return { text: result.text, usedAi: true };
  }

  return {
    text: fallback,
    usedAi: false,
    error: result.message,
  };
}

export type BidNarrativeContext = {
  origin: string;
  destination: string;
  recommendedSellRate: number;
  recommendedBuyRate: number;
  marginPercentage: number;
  confidenceScore: number;
  riskLevel: string;
  datMarketAverage: number;
  winRate: number;
  loadCount: number;
  leverageCount: number;
  backhaulCount: number;
};

/**
 * Enrich bidding narratives with OpenAI while keeping numeric rates deterministic.
 */
export async function enrichBidNarrativesWithAi(
  context: BidNarrativeContext,
  signal?: AbortSignal,
): Promise<{
  notes?: string;
  suggestedStrategy?: string;
  customerFacingNote?: string;
  error?: string;
} | null> {
  if (!isWorkspaceAiReady()) return null;

  const result = await askWorkspaceAi({
    feature: "bidding-copilot",
    system: `You are a freight pricing analyst for Titan Freight bidding.
Return ONLY valid JSON with keys: notes, suggestedStrategy, customerFacingNote.
Be concise, operational, and specific to the numbers provided. No markdown fences.`,
    prompt: JSON.stringify(context, null, 2),
    temperature: 0.35,
    maxTokens: 450,
    signal,
  });

  if (result.status !== "ok") {
    return { error: result.message };
  }

  try {
    const parsed = JSON.parse(result.text) as {
      notes?: unknown;
      suggestedStrategy?: unknown;
      customerFacingNote?: unknown;
    };
    return {
      notes: typeof parsed.notes === "string" ? parsed.notes.trim() : undefined,
      suggestedStrategy:
        typeof parsed.suggestedStrategy === "string"
          ? parsed.suggestedStrategy.trim()
          : undefined,
      customerFacingNote:
        typeof parsed.customerFacingNote === "string"
          ? parsed.customerFacingNote.trim()
          : undefined,
    };
  } catch {
    // Model sometimes returns prose — use as notes only
    return { notes: result.text };
  }
}

/**
 * Explain an RFP lane match for brokers (AI Matching panel).
 */
export async function explainRfpLaneMatch(params: {
  laneSummary: string;
  matchScore: number;
  why?: string;
  signal?: AbortSignal;
}): Promise<{ text: string; usedAi: boolean; error?: string }> {
  const fallback =
    params.why?.trim() ||
    `Match score ${params.matchScore}. Review historical pricing, network fit, and capacity before approving.`;

  if (!isWorkspaceAiReady()) {
    return { text: fallback, usedAi: false };
  }

  const result = await askWorkspaceAi({
    feature: "rfp-matching",
    system: `You are a freight RFP analyst. Explain why this lane match makes sense for a broker in 2–4 short sentences. No emojis.`,
    prompt: `Lane: ${params.laneSummary}
Score: ${params.matchScore}
Existing notes: ${params.why ?? "none"}`,
    temperature: 0.4,
    maxTokens: 280,
    signal: params.signal,
  });

  if (result.status === "ok") {
    return { text: result.text, usedAi: true };
  }

  return { text: fallback, usedAi: false, error: result.message };
}
