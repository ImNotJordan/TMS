import type { LoadDraft } from "@/components/loads/create-load-dialog";

export type StoredLoadDraft = {
  /** Stable key in localStorage (usually matches draft.loadId). */
  id: string;
  savedAt: string;
  step: number;
  draft: LoadDraft;
};

const STORAGE_KEY = "titan-freight:create-load-drafts";

function canUseBrowserStorage() {
  return typeof window !== "undefined" && typeof localStorage !== "undefined";
}

function readAll(): StoredLoadDraft[] {
  if (!canUseBrowserStorage()) return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isStoredLoadDraft);
  } catch {
    return [];
  }
}

function writeAll(drafts: StoredLoadDraft[]) {
  if (!canUseBrowserStorage()) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(drafts));
  } catch {
    // ignore quota / private mode errors
  }
}

function isStoredLoadDraft(value: unknown): value is StoredLoadDraft {
  if (!value || typeof value !== "object") return false;
  const v = value as StoredLoadDraft;
  return (
    typeof v.id === "string" &&
    typeof v.savedAt === "string" &&
    typeof v.step === "number" &&
    v.draft !== null &&
    typeof v.draft === "object" &&
    typeof (v.draft as LoadDraft).loadId === "string"
  );
}

/** True when the user entered something worth keeping as a draft. */
export function isMeaningfulLoadDraft(draft: LoadDraft): boolean {
  const text = (v: string | undefined) => Boolean(v?.trim());
  if (text(draft.customer) || text(draft.broker) || text(draft.dispatcher)) return true;
  if (text(draft.loadType) || text(draft.equipmentType) || text(draft.trailerType)) return true;
  if (text(draft.internalNotes) || text(draft.commodityDescription)) return true;
  if (
    text(draft.pickupFacility) ||
    text(draft.pickupAddress) ||
    text(draft.pickupCity) ||
    text(draft.pickupState) ||
    text(draft.pickupZip)
  ) {
    return true;
  }
  if (
    text(draft.deliveryFacility) ||
    text(draft.deliveryAddress) ||
    text(draft.deliveryCity) ||
    text(draft.deliveryState) ||
    text(draft.deliveryZip)
  ) {
    return true;
  }
  if (
    text(draft.customerRate) ||
    text(draft.carrierRate) ||
    text(draft.weight) ||
    text(draft.assignedCarrier) ||
    text(draft.assignedDriver)
  ) {
    return true;
  }
  if (draft.hazmat || draft.specialHandling.length > 0 || draft.documents.length > 0) {
    return true;
  }
  return false;
}

/** Whether closing the wizard should write/update a local draft. */
export function shouldPersistLoadDraft(
  draft: LoadDraft,
  step: number,
  options?: { hasStoredDraft?: boolean },
): boolean {
  if (options?.hasStoredDraft) return true;
  if (step > 1) return true;
  return isMeaningfulLoadDraft(draft);
}

export function listStoredLoadDrafts(): StoredLoadDraft[] {
  return readAll().sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}

export function upsertStoredLoadDraft(entry: StoredLoadDraft): void {
  const drafts = readAll();
  const idx = drafts.findIndex((d) => d.id === entry.id);
  if (idx >= 0) drafts[idx] = entry;
  else drafts.push(entry);
  writeAll(drafts);
}

export function removeStoredLoadDraft(id: string): void {
  writeAll(readAll().filter((d) => d.id !== id));
}

export function getStoredLoadDraft(id: string): StoredLoadDraft | undefined {
  return readAll().find((d) => d.id === id);
}

export function formatDraftLane(draft: LoadDraft): string {
  const from = [draft.pickupCity, draft.pickupState].filter(Boolean).join(", ");
  const to = [draft.deliveryCity, draft.deliveryState].filter(Boolean).join(", ");
  if (!from && !to) return "—";
  return `${from || "—"} → ${to || "—"}`;
}

export function formatDraftSavedAt(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
