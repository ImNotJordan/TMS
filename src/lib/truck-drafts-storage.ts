import type { TruckDraft } from "@/components/truckboard/create-truck-dialog";

export type StoredTruckDraft = {
  id: string;
  savedAt: string;
  step: number;
  draft: TruckDraft;
};

const STORAGE_KEY = "titan-freight:post-truck-drafts";

function canUseBrowserStorage() {
  return typeof window !== "undefined" && typeof localStorage !== "undefined";
}

function readAll(): StoredTruckDraft[] {
  if (!canUseBrowserStorage()) return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isStoredTruckDraft);
  } catch {
    return [];
  }
}

function writeAll(drafts: StoredTruckDraft[]) {
  if (!canUseBrowserStorage()) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(drafts));
  } catch {
    // ignore storage errors
  }
}

function isStoredTruckDraft(value: unknown): value is StoredTruckDraft {
  if (!value || typeof value !== "object") return false;
  const v = value as StoredTruckDraft;
  return (
    typeof v.id === "string" &&
    typeof v.savedAt === "string" &&
    typeof v.step === "number" &&
    v.draft !== null &&
    typeof v.draft === "object" &&
    typeof (v.draft as TruckDraft).truckBoardId === "string"
  );
}

export function isMeaningfulTruckDraft(draft: TruckDraft): boolean {
  const text = (v: string | undefined) => Boolean(v?.trim());
  if (text(draft.carrierName) || text(draft.carrierMcNumber) || text(draft.carrierDotNumber)) {
    return true;
  }
  if (text(draft.contactName) || text(draft.contactPhone) || text(draft.driverName)) return true;
  if (
    text(draft.currentCity) ||
    text(draft.currentState) ||
    text(draft.currentZip) ||
    text(draft.currentAddress) ||
    text(draft.facilityName)
  ) {
    return true;
  }
  if (text(draft.equipmentType) || text(draft.truckNumber) || text(draft.trailerNumber)) {
    return true;
  }
  if (
    text(draft.preferredDestinationCity) ||
    text(draft.preferredDestinationState) ||
    text(draft.preferredDestinationRegion) ||
    text(draft.preferredLanes)
  ) {
    return true;
  }
  if (text(draft.desiredRate) || text(draft.minimumRate) || text(draft.publicNotes)) return true;
  if (draft.preferredStates.length > 0 || draft.excludedStates.length > 0) return true;
  if (draft.documents.length > 0) return true;
  if (draft.availableNow) return true;
  if (text(draft.availableDate) || text(draft.availableTime)) return true;
  return false;
}

export function shouldPersistTruckDraft(
  draft: TruckDraft,
  step: number,
  options?: { hasStoredDraft?: boolean },
): boolean {
  if (options?.hasStoredDraft) return true;
  if (step > 1) return true;
  return isMeaningfulTruckDraft(draft);
}

export function listStoredTruckDrafts(): StoredTruckDraft[] {
  return readAll().sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}

export function upsertStoredTruckDraft(entry: StoredTruckDraft): void {
  const drafts = readAll();
  const idx = drafts.findIndex((d) => d.id === entry.id);
  if (idx >= 0) drafts[idx] = entry;
  else drafts.push(entry);
  writeAll(drafts);
}

export function removeStoredTruckDraft(id: string): void {
  writeAll(readAll().filter((d) => d.id !== id));
}

export function formatTruckDraftOrigin(draft: TruckDraft): string {
  if (draft.currentCity && draft.currentState) return `${draft.currentCity}, ${draft.currentState}`;
  return draft.currentCity || draft.currentState || "—";
}

export function formatTruckDraftDestination(draft: TruckDraft): string {
  if (draft.preferredDestinationCity || draft.preferredDestinationState) {
    const city = draft.preferredDestinationCity;
    const state = draft.preferredDestinationState;
    if (city && state) return `${city}, ${state}`;
    return city || state || "—";
  }
  if (draft.preferredDestinationRegion) {
    return draft.preferredDestinationRegion
      .replace(/-/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase());
  }
  if (draft.preferredStates.length > 0) {
    return draft.preferredStates.slice(0, 3).join(", ") + (draft.preferredStates.length > 3 ? "…" : "");
  }
  return "—";
}

export function formatTruckDraftSavedAt(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
