/**
 * Prospecting Bot helpers.
 *
 * `buildDatSearchUrl` produces a real DAT One deep link so "DAT finds logged with link
 * back to search" is satisfiable today. `runSimulatedDatScan` and `simulateBrokerCall`
 * are explicit stand-ins for the DAT Load Board API and telephony/transcription
 * providers (e.g. Twilio) — neither is wired to a live account in this repo. Swap their
 * bodies for real API calls once credentials are available; every caller only depends on
 * the return shape below.
 */

export type ProspectingParams = {
  originCity?: string;
  originState?: string;
  destCity?: string;
  destState?: string;
  equipmentType?: string;
  targetRatePerMile?: number;
  marginFloorPct?: number;
  estimatedCost?: number;
  maxResults?: number;
};

export type GuardrailResult = {
  allowed: boolean;
  reason: string;
  marginPct: number | null;
};

/** Builds a DAT One search-loads deep link from the scan parameters. */
export function buildDatSearchUrl(params: ProspectingParams): string {
  const query = new URLSearchParams();
  if (params.originCity) query.set("origCity", params.originCity);
  if (params.originState) query.set("origState", params.originState);
  if (params.destCity) query.set("destCity", params.destCity);
  if (params.destState) query.set("destState", params.destState);
  if (params.equipmentType) query.set("equipment", params.equipmentType);
  return `https://one.dat.com/search-loads-ow?${query.toString()}`;
}

/**
 * Checks a quoted/negotiated rate against the margin floor. Pure guardrail logic —
 * the Prospecting Bot must call this before accepting any negotiated rate.
 */
export function checkMarginGuardrail(
  quotedRate: number,
  estimatedCost: number,
  marginFloorPct: number,
): GuardrailResult {
  if (!Number.isFinite(quotedRate) || quotedRate <= 0) {
    return { allowed: false, reason: "Quoted rate is missing or invalid.", marginPct: null };
  }
  const marginPct = ((quotedRate - estimatedCost) / quotedRate) * 100;
  if (marginPct < marginFloorPct) {
    return {
      allowed: false,
      reason: `Margin ${marginPct.toFixed(1)}% is below the ${marginFloorPct}% floor — blocked to prevent overpaying.`,
      marginPct,
    };
  }
  return {
    allowed: true,
    reason: `Margin ${marginPct.toFixed(1)}% clears the ${marginFloorPct}% floor.`,
    marginPct,
  };
}

export type SimulatedMatch = {
  matchId: string;
  broker: string;
  brokerPhone: string;
  lane: string;
  postedRate: number;
  equipmentType: string;
};

/**
 * STUB — pending DAT Load Board API credentials. Generates plausible candidate loads so
 * the pipeline (log → call → guardrail → outcome) can be exercised end to end today.
 * Replace with a real DAT API call; keep the return shape.
 */
export function runSimulatedDatScan(params: ProspectingParams, seed: number): SimulatedMatch[] {
  const count = Math.min(Math.max(params.maxResults ?? 5, 1), 10);
  const lane =
    params.originCity && params.destCity
      ? `${params.originCity}, ${params.originState ?? ""} → ${params.destCity}, ${params.destState ?? ""}`
      : "Lane unspecified";
  const brokerNames = [
    "Summit Freight Brokers",
    "Redline Logistics",
    "Harbor Point Transport",
    "Ironclad Carriers Co.",
    "Continental Freight Group",
    "Prairie Star Logistics",
    "Bluepeak Transportation",
    "Cascade Freightways",
    "Vantage Point Brokerage",
    "Northgate Shipping Co.",
  ];
  const baseRate = (params.targetRatePerMile ?? 2.5) * 500;
  const matches: SimulatedMatch[] = [];
  for (let i = 0; i < count; i += 1) {
    const jitter = ((seed + i * 37) % 21) - 10; // deterministic -10..+10
    const postedRate = Math.max(300, Math.round(baseRate * (1 + jitter / 100)));
    matches.push({
      matchId: `DAT-${seed}-${i + 1}`,
      broker: brokerNames[(seed + i) % brokerNames.length],
      brokerPhone: `(${200 + ((seed + i) % 700)}) 555-${String(1000 + ((seed + i * 13) % 9000)).slice(0, 4)}`,
      lane,
      postedRate,
      equipmentType: params.equipmentType ?? "Dry Van",
    });
  }
  return matches;
}

export type SimulatedCallResult = {
  transcript: string;
  negotiatedRate: number;
  outcome: "verified_available" | "unavailable" | "negotiated" | "guardrail_blocked";
  guardrail: GuardrailResult;
};

/**
 * STUB — pending telephony/transcription credentials (e.g. Twilio Voice + a
 * transcription provider). Simulates calling the broker, verifying availability, and
 * negotiating within the margin floor. Real integration should record the call, run it
 * through transcription, then call `checkMarginGuardrail` exactly as done here before
 * accepting any negotiated rate.
 */
export function simulateBrokerCall(
  match: SimulatedMatch,
  estimatedCost: number,
  marginFloorPct: number,
): SimulatedCallResult {
  const askDelta = 0.94 + ((match.matchId.length * 7) % 10) / 100; // deterministic ~0.94-1.03
  const negotiatedRate = Math.round(match.postedRate * askDelta);
  const guardrail = checkMarginGuardrail(negotiatedRate, estimatedCost, marginFloorPct);

  const transcriptLines = [
    `Bot: Hi, calling about the ${match.lane} load posted for $${match.postedRate}. Is it still available?`,
    `${match.broker}: Yes, still open. We're asking $${match.postedRate}.`,
  ];

  if (!guardrail.allowed) {
    transcriptLines.push(
      `Bot: That rate doesn't clear our margin floor even after negotiation — we'll pass for now.`,
    );
    return {
      transcript: transcriptLines.join("\n"),
      negotiatedRate,
      outcome: "guardrail_blocked",
      guardrail,
    };
  }

  transcriptLines.push(
    `Bot: Can you do $${negotiatedRate}?`,
    `${match.broker}: We can make that work.`,
    `Bot: Confirmed at $${negotiatedRate}. Logging the outcome now.`,
  );
  return {
    transcript: transcriptLines.join("\n"),
    negotiatedRate,
    outcome: "negotiated",
    guardrail,
  };
}
