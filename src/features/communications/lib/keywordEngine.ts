import type { ChannelId, Direction, KeywordHit, KeywordRule } from "../types";

const MAX_REGEX_LENGTH = 200;
/** Reject patterns that commonly cause catastrophic backtracking. */
const DANGEROUS_REGEX = /(\(\?[^)]*\)|\+\+|(\*\*)|(\{\d+,\})|(\([^)]*[+*][^)]*\))[+*])/;

export type KeywordMatchContext = {
  channel: ChannelId;
  direction: Direction;
};

export function validateRegexTerm(pattern: string): { ok: true } | { ok: false; reason: string } {
  const trimmed = pattern.trim();
  if (!trimmed) return { ok: false, reason: "Regex pattern is empty." };
  if (trimmed.length > MAX_REGEX_LENGTH) {
    return { ok: false, reason: `Regex must be ${MAX_REGEX_LENGTH} characters or fewer.` };
  }
  if (DANGEROUS_REGEX.test(trimmed)) {
    return { ok: false, reason: "Regex rejected: pattern risks catastrophic backtracking." };
  }
  try {
    new RegExp(trimmed);
  } catch {
    return { ok: false, reason: "Regex is invalid." };
  }
  return { ok: true };
}

function findContains(haystack: string, needle: string, caseSensitive: boolean): number {
  if (!needle) return -1;
  if (caseSensitive) return haystack.indexOf(needle);
  return haystack.toLowerCase().indexOf(needle.toLowerCase());
}

function findWord(haystack: string, needle: string, caseSensitive: boolean): number {
  if (!needle) return -1;
  const flags = caseSensitive ? "g" : "gi";
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`\\b${escaped}\\b`, flags);
  const match = re.exec(haystack);
  return match ? match.index : -1;
}

function findRegex(haystack: string, pattern: string, caseSensitive: boolean): number {
  const validation = validateRegexTerm(pattern);
  if (!validation.ok) return -1;
  try {
    const flags = caseSensitive ? "" : "i";
    const re = new RegExp(pattern, flags);
    const match = re.exec(haystack);
    return match ? match.index : -1;
  } catch {
    return -1;
  }
}

/**
 * Pure keyword matcher. Returns hits with character offsets for highlighting.
 */
export function keywordEngine(
  text: string,
  rules: KeywordRule[],
  ctx: KeywordMatchContext,
): KeywordHit[] {
  const hits: KeywordHit[] = [];
  if (!text) return hits;

  for (const rule of rules) {
    if (!rule.enabled) continue;
    if (rule.channels.length > 0 && !rule.channels.includes(ctx.channel)) continue;
    if (rule.direction !== "both" && rule.direction !== ctx.direction) continue;

    for (const term of rule.terms) {
      let offset = -1;
      if (rule.matchType === "contains") {
        offset = findContains(text, term, rule.caseSensitive);
      } else if (rule.matchType === "word") {
        offset = findWord(text, term, rule.caseSensitive);
      } else {
        offset = findRegex(text, term, rule.caseSensitive);
      }
      if (offset < 0) continue;
      hits.push({
        ruleId: rule.id,
        label: rule.label,
        severity: rule.severity,
        matchedTerm: term,
        offset,
      });
    }
  }

  return hits.sort((a, b) => a.offset - b.offset || a.label.localeCompare(b.label));
}

export const KEYWORD_PRESETS: Omit<KeywordRule, "id">[] = [
  {
    label: "Detention",
    terms: ["detention", "waiting", "detained"],
    matchType: "word",
    caseSensitive: false,
    channels: ["email", "sms", "voice", "chat"],
    direction: "both",
    severity: "warning",
    actions: [{ type: "flag-thread" }, { type: "create-task", title: "Review detention claim" }],
    enabled: false,
  },
  {
    label: "Breakdown",
    terms: ["breakdown", "broke down", "mechanical"],
    matchType: "contains",
    caseSensitive: false,
    channels: ["email", "sms", "voice", "chat"],
    direction: "both",
    severity: "critical",
    actions: [{ type: "flag-thread" }, { type: "escalate-to-human" }],
    enabled: false,
  },
  {
    label: "Rate increase",
    terms: ["rate increase", "need more money", "higher rate"],
    matchType: "contains",
    caseSensitive: false,
    channels: ["email", "sms", "chat"],
    direction: "both",
    severity: "warning",
    actions: [{ type: "flag-thread" }, { type: "notify", userIds: [] }],
    enabled: false,
  },
  {
    label: "Accident",
    terms: ["accident", "crash", "collision"],
    matchType: "word",
    caseSensitive: false,
    channels: ["email", "sms", "voice", "chat"],
    direction: "both",
    severity: "critical",
    actions: [{ type: "escalate-to-human" }, { type: "create-task", title: "Accident response" }],
    enabled: false,
  },
  {
    label: "Late delivery",
    terms: ["running late", "delayed", "ETA slip"],
    matchType: "contains",
    caseSensitive: false,
    channels: ["email", "sms", "chat"],
    direction: "both",
    severity: "warning",
    actions: [{ type: "flag-thread" }],
    enabled: false,
  },
  {
    label: "Temperature deviation",
    terms: ["temp out", "temperature", "reefer alarm"],
    matchType: "contains",
    caseSensitive: false,
    channels: ["email", "sms", "chat"],
    direction: "both",
    severity: "critical",
    actions: [{ type: "escalate-to-human" }, { type: "flag-thread" }],
    enabled: false,
  },
  {
    label: "Legal/claim",
    terms: ["claim", "lawsuit", "attorney", "legal action"],
    matchType: "word",
    caseSensitive: false,
    channels: ["email", "sms", "chat"],
    direction: "both",
    severity: "critical",
    actions: [{ type: "escalate-to-human" }, { type: "apply-tag", tag: "legal" }],
    enabled: false,
  },
];
