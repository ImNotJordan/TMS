import type { ChannelId, ConsentRecord, DncEntry, GuardResult } from "../types";

export type ConsentGuardInput = {
  contactId: string;
  channel: ChannelId;
  address?: string;
  consentRecords: ConsentRecord[];
  dncEntries: DncEntry[];
  now?: Date;
};

function isDncActive(entry: DncEntry, now: Date): boolean {
  if (!entry.expiresAt) return true;
  const expires = new Date(entry.expiresAt).getTime();
  if (Number.isNaN(expires)) return true;
  return expires > now.getTime();
}

function addressMatches(entryAddress: string, address?: string): boolean {
  if (!address) return false;
  const normalize = (v: string) =>
    v
      .trim()
      .toLowerCase()
      .replace(/[\s()-]/g, "");
  return normalize(entryAddress) === normalize(address);
}

/**
 * Pre-send consent / DNC guard. Pure — never dispatches.
 */
export function consentGuard(input: ConsentGuardInput): GuardResult {
  const now = input.now ?? new Date();

  const dncHit = input.dncEntries.find((entry) => {
    if (!isDncActive(entry, now)) return false;
    if (entry.channel !== "all" && entry.channel !== input.channel) return false;
    if (entry.contactId && entry.contactId === input.contactId) return true;
    if (addressMatches(entry.address, input.address)) return true;
    return false;
  });

  if (dncHit) {
    return { status: "blocked-dnc", entry: dncHit };
  }

  const relevant = input.consentRecords
    .filter((r) => r.contactId === input.contactId && r.channel === input.channel)
    .sort((a, b) => b.capturedAt.localeCompare(a.capturedAt));

  const latest = relevant[0];
  if (!latest || latest.state === "unknown") {
    return { status: "warn-unknown-consent" };
  }
  if (latest.state === "revoked") {
    return { status: "blocked-no-consent" };
  }
  return { status: "allowed" };
}
