import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";

import { useAuth } from "./auth";
import { getLoadById, listDriverLoads, patchLoadRecord, type DriverLoadRecord } from "./aws-loads";
import { putTrackingMessage } from "./aws-messages";
import { isAssignedTo, mapLoadRecordToPortalLoad, nextWorkflowStatus } from "./load-mapper";
import {
  createDocumentId,
  documentTagsFromAssets,
  friendlyDocumentFileName,
  kindFromDocType,
  prepareLoadDocumentFile,
  upsertDocumentAsset,
} from "./load-documents";
import { reconcileRecord } from "./record-freshness";
import {
  STATUS_STEPS,
  type ActiveLoadStatus,
  type ActivityItem,
  type Load,
  type LoadDocument,
} from "./mock-data";

const LOCATION_SHARE_KEY = "driver-portal.location-sharing";

function readLocationSharingPref(userId: string): boolean {
  try {
    const raw = localStorage.getItem(`${LOCATION_SHARE_KEY}:${userId}`);
    if (raw == null) return true;
    return raw === "1" || raw === "true";
  } catch {
    return true;
  }
}

function writeLocationSharingPref(userId: string, value: boolean) {
  try {
    localStorage.setItem(`${LOCATION_SHARE_KEY}:${userId}`, value ? "1" : "0");
  } catch {
    /* ignore */
  }
}

async function notifyDispatchChat(
  loadId: string,
  text: string,
  attachment?: {
    docKind: "bol" | "pod";
    fileName: string;
    contentType: string;
    assetId?: string;
  },
) {
  try {
    await putTrackingMessage({
      loadId,
      from: "driver",
      text,
      docKind: attachment?.docKind,
      fileName: attachment?.fileName,
      contentType: attachment?.contentType,
      assetId: attachment?.assetId,
    });
  } catch {
    /* tracking table optional — status history still reaches ops inbox */
  }
}

const ACTIVE_STATUSES: ActiveLoadStatus[] = STATUS_STEPS.map((s) => s.key);
const DECLINED_KEY = "driver-portal.declined-loads";

function readDeclinedIds(userId: string): Set<string> {
  try {
    const raw = localStorage.getItem(`${DECLINED_KEY}:${userId}`);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as string[];
    return new Set(Array.isArray(parsed) ? parsed : []);
  } catch {
    return new Set();
  }
}

function writeDeclinedIds(userId: string, ids: Set<string>) {
  try {
    localStorage.setItem(`${DECLINED_KEY}:${userId}`, JSON.stringify([...ids]));
  } catch {
    /* ignore quota */
  }
}

type LoadsContextValue = {
  loads: Load[];
  recordsById: Record<string, DriverLoadRecord>;
  activeLoad: Load | undefined;
  offeredLoads: Load[];
  myLoads: Load[];
  activity: ActivityItem[];
  locationSharing: boolean;
  setLocationSharing: (value: boolean) => void;
  /** ISO timestamp of last successful GPS publish (local). */
  lastGpsPingAt: string | null;
  lastGpsError: string | null;
  gpsPublishing: boolean;
  publishLocationNow: () => Promise<boolean>;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  ready: boolean;
  refresh: () => Promise<void>;
  getLoad: (id: string) => Load | undefined;
  acceptLoad: (id: string) => Promise<void>;
  declineLoad: (id: string) => Promise<void>;
  advanceStatus: (id: string) => Promise<void>;
  markDocumentUploaded: (id: string, type: LoadDocument["type"], file: File) => Promise<void>;
};

const LoadsContext = createContext<LoadsContextValue | null>(null);

function buildActivity(loads: Load[]): ActivityItem[] {
  return loads
    .filter(
      (l) => l.status === "delivered" || l.status === "assigned" || l.status.startsWith("en-route"),
    )
    .slice(0, 5)
    .map((l, i) => ({
      id: `act-${l.id}-${i}`,
      title:
        l.status === "delivered"
          ? "Load delivered"
          : l.status === "assigned"
            ? "Load assigned"
            : "Load in progress",
      detail: `${l.id} · ${l.pickup.city} → ${l.delivery.city}`,
      time: l.status === "delivered" ? "Recent" : "Live",
    }));
}

export function LoadsProvider({ children }: { children: React.ReactNode }) {
  const { status: authStatus, driver } = useAuth();
  const [recordsById, setRecordsById] = useState<Record<string, DriverLoadRecord>>({});
  const [loads, setLoads] = useState<Load[]>([]);
  const [declinedIds, setDeclinedIds] = useState<Set<string>>(() => new Set());
  const [locationSharing, setLocationSharingState] = useState(true);
  const [lastGpsPingAt, setLastGpsPingAt] = useState<string | null>(null);
  const [lastGpsError, setLastGpsError] = useState<string | null>(null);
  const [gpsPublishing, setGpsPublishing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const fetchGen = useRef(0);
  /**
   * Records this device wrote, by loadId, kept until the backend catches up.
   *
   * `listDriverLoads` queries a GSI, which is eventually consistent: a poll that
   * started before a write — or simply reads a replica that hasn't caught up — comes
   * back holding the pre-write item and rolls the driver's status backwards on screen.
   * Keyed on `updatedAt`, which the writer stamps, so any read older than our own last
   * write is discarded instead of clobbering it.
   */
  const localWrites = useRef(new Map<string, DriverLoadRecord>());
  /** Load ids with a status advance in flight, to swallow double-taps. */
  const advancing = useRef(new Set<string>());

  /** Record a successful write so stale reads can't roll it back. */
  const rememberLocalWrite = useCallback((record: DriverLoadRecord) => {
    localWrites.current.set(record.loadId, record);
  }, []);

  const remap = useCallback(
    (records: DriverLoadRecord[], declined: Set<string>, driverId: string) => {
      const mapped: Load[] = [];
      const byId: Record<string, DriverLoadRecord> = {};
      for (const incoming of records) {
        const { record, settled } = reconcileRecord(
          incoming,
          localWrites.current.get(incoming.loadId),
        );
        if (settled) localWrites.current.delete(incoming.loadId);
        byId[record.loadId] = record;
        const load = mapLoadRecordToPortalLoad(record, driverId, declined);
        if (load) mapped.push(load);
      }
      mapped.sort((a, b) => a.id.localeCompare(b.id));
      setRecordsById(byId);
      setLoads(mapped);
    },
    [],
  );

  const refresh = useCallback(async () => {
    if (authStatus !== "authenticated" || !driver) {
      setLoads([]);
      setRecordsById({});
      setLoading(false);
      setReady(true);
      return;
    }

    const gen = ++fetchGen.current;
    setError(null);
    setRefreshing(true);
    if (!ready) setLoading(true);

    try {
      const declined = readDeclinedIds(driver.userId);
      setDeclinedIds(declined);
      const all = await listDriverLoads();
      if (gen !== fetchGen.current) return;
      remap(all, declined, driver.userId);
      const latestPing = all
        .map((r) => r.driverGps?.lastPingAt)
        .filter((v): v is string => Boolean(v))
        .sort()
        .at(-1);
      if (latestPing) setLastGpsPingAt(latestPing);
    } catch (err) {
      if (gen !== fetchGen.current) return;
      const message = err instanceof Error ? err.message : "Failed to load loads from AWS";
      setError(message);
      toast.error("Couldn’t load loads", { description: message });
    } finally {
      if (gen === fetchGen.current) {
        setLoading(false);
        setRefreshing(false);
        setReady(true);
      }
    }
  }, [authStatus, driver, ready, remap]);

  useEffect(() => {
    if (authStatus === "loading") return;
    // Pending writes belong to the previous identity — never carry them across a
    // sign-out or driver switch.
    localWrites.current.clear();
    if (authStatus === "unauthenticated") {
      setLoads([]);
      setRecordsById({});
      setLoading(false);
      setReady(true);
      setError(null);
      return;
    }
    setReady(false);
    setLoading(true);
    void refresh();
  }, [authStatus, driver?.userId]); // eslint-disable-line react-hooks/exhaustive-deps -- refresh on auth identity

  useEffect(() => {
    if (!driver?.userId) return;
    setLocationSharingState(readLocationSharingPref(driver.userId));
  }, [driver?.userId]);

  const setLocationSharing = useCallback(
    (value: boolean) => {
      setLocationSharingState(value);
      if (driver?.userId) writeLocationSharingPref(driver.userId, value);
      if (!value) setLastGpsError(null);
    },
    [driver?.userId],
  );

  const publishLocationNow = useCallback(async () => {
    if (!driver) return false;
    const targets = Object.values(recordsById).filter((record) => {
      const load = loads.find((l) => l.id === record.loadId);
      if (!load) return false;
      return (
        ACTIVE_STATUSES.includes(load.status as ActiveLoadStatus) && load.status !== "delivered"
      );
    });
    if (targets.length === 0) {
      setLastGpsError("No active load to share location on.");
      return false;
    }

    setGpsPublishing(true);
    try {
      const { describeGeolocationError, positionToDriverGpsPing, readDevicePosition } =
        await import("./device-location");
      const position = await readDevicePosition();
      const ping = positionToDriverGpsPing(position, {
        sharedBy: driver.userId,
        sharedByName: driver.name,
      });

      await Promise.all(
        targets.map(async (existing) => {
          const updated = await patchLoadRecord(existing.loadId, { driverGps: ping });
          rememberLocalWrite(updated);
          setRecordsById((prev) => ({ ...prev, [updated.loadId]: updated }));
        }),
      );

      setLastGpsPingAt(ping.lastPingAt);
      setLastGpsError(null);
      return true;
    } catch (err) {
      const { describeGeolocationError } = await import("./device-location");
      setLastGpsError(describeGeolocationError(err));
      return false;
    } finally {
      setGpsPublishing(false);
    }
  }, [driver, loads, recordsById, rememberLocalWrite]);

  const getLoad = useCallback((id: string) => loads.find((l) => l.id === id), [loads]);

  const acceptLoad = useCallback(
    async (id: string) => {
      if (!driver) return;
      const existing = recordsById[id] ?? (await getLoadById(id));
      if (!existing) {
        toast.error("Load not found");
        return;
      }
      try {
        // No `assignedDriver` here, deliberately.
        //
        // Every load this portal can see is already assigned to this driver —
        // the listing queries `assignedDriver = <their sub>` — so writing it
        // would set the value the row already holds. The API rejects the field
        // outright, and that is the right call: a driver who could write it
        // could hand their load to another driver, or to a string matching
        // nobody, which would orphan it. Accepting is a workflow transition,
        // not a claim of ownership.
        const updated = await patchLoadRecord(id, {
          loadStatus: "driver-assigned",
          driverWorkflowStatus: "assigned",
        });
        rememberLocalWrite(updated);
        setRecordsById((prev) => ({ ...prev, [id]: updated }));
        setLoads((prev) => {
          // Remap from the written record so derived flags (assignedByDispatch) stay
          // in sync with what Dynamo now holds, instead of patching `status` alone.
          const mapped = mapLoadRecordToPortalLoad(updated, driver.userId, declinedIds);
          if (!mapped) return prev.filter((l) => l.id !== id);
          if (!prev.some((l) => l.id === id)) return [...prev, mapped];
          return prev.map((l) => (l.id === id ? mapped : l));
        });
        void notifyDispatchChat(id, `${driver.name} accepted the load.`);
        toast.success(`Load ${id} accepted`, { description: "Head to pickup when you're ready." });
      } catch (err) {
        toast.error("Accept failed", {
          description: err instanceof Error ? err.message : "Try again",
        });
      }
    },
    [declinedIds, driver, recordsById, rememberLocalWrite],
  );

  const declineLoad = useCallback(
    async (id: string) => {
      if (!driver) return;
      const nextDeclined = new Set(declinedIds);
      nextDeclined.add(id);
      setDeclinedIds(nextDeclined);
      writeDeclinedIds(driver.userId, nextDeclined);
      setLoads((prev) => prev.filter((l) => l.id !== id));

      const existing = recordsById[id];
      // Passing on an open marketplace offer is a local-only choice — nothing was
      // assigned, so there is nothing to release back to dispatch.
      if (!existing || !isAssignedTo(existing.assignedDriver, driver.userId)) {
        toast.info(`Load ${id} declined`);
        return;
      }

      try {
        const updated = await patchLoadRecord(id, {
          driverWorkflowStatus: "declined",
        });
        rememberLocalWrite(updated);
        setRecordsById((prev) => ({ ...prev, [id]: updated }));
        void notifyDispatchChat(id, `${driver.name} declined the assignment.`);
        toast.info(`Load ${id} declined`, { description: "Dispatch has been notified." });
      } catch (err) {
        // Roll the local decline back so the load reappears rather than vanishing
        // from the driver's app while dispatch still shows it assigned.
        nextDeclined.delete(id);
        const restored = new Set(nextDeclined);
        setDeclinedIds(restored);
        writeDeclinedIds(driver.userId, restored);
        remap(Object.values(recordsById), restored, driver.userId);
        toast.error("Decline failed", {
          description: err instanceof Error ? err.message : "Try again",
        });
      }
    },
    [declinedIds, driver, recordsById, remap, rememberLocalWrite],
  );

  const advanceStatus = useCallback(
    async (id: string) => {
      const load = loads.find((l) => l.id === id);
      const existing = recordsById[id];
      if (!load || !existing || !driver) return;
      const next = nextWorkflowStatus(load.status);
      if (!next) return;
      // Writes are rate-limited to one per 1.2s, so a double-tap would otherwise queue
      // a second write built from the pre-first-tap record and drop a history entry.
      if (advancing.current.has(id)) return;
      advancing.current.add(id);

      try {
        const label = STATUS_STEPS.find((s) => s.key === next)?.label ?? next;
        const updated = await patchLoadRecord(id, {
          driverWorkflowStatus: next,
          loadStatus:
            next === "delivered"
              ? "delivered"
              : next === "en-route-delivery" || next === "loaded"
                ? "active"
                : existing.loadStatus === "driver-assigned"
                  ? "driver-assigned"
                  : existing.loadStatus,
        });
        rememberLocalWrite(updated);
        setRecordsById((prev) => ({ ...prev, [id]: updated }));
        setLoads((prev) =>
          prev.map((l) =>
            l.id === id ? (mapLoadRecordToPortalLoad(updated, driver.userId, declinedIds) ?? l) : l,
          ),
        );
        void notifyDispatchChat(id, `${driver.name} marked status: ${label}.`);
        toast.success("Status updated", { description: `${id} → ${label}` });
      } catch (err) {
        toast.error("Status update failed", {
          description: err instanceof Error ? err.message : "Try again",
        });
      } finally {
        advancing.current.delete(id);
      }
    },
    [declinedIds, driver, loads, recordsById, rememberLocalWrite],
  );

  const markDocumentUploaded = useCallback(
    async (id: string, type: LoadDocument["type"], file: File) => {
      const existing = recordsById[id];
      if (!existing || !driver) return;

      try {
        const prepared = await prepareLoadDocumentFile(file);
        const kind = kindFromDocType(type);
        const uploadedAt = new Date().toISOString();
        const fileName = friendlyDocumentFileName({
          kind,
          contentType: prepared.contentType,
          originalName: prepared.originalName || prepared.fileName,
          uploadedAt,
        });
        const asset = {
          id: createDocumentId(kind),
          kind,
          fileName,
          contentType: prepared.contentType,
          size: prepared.size,
          uploadedAt,
          uploadedBy: driver.userId,
          uploadedByName: driver.name,
          dataUrl: prepared.dataUrl,
        };
        const documentAssets = upsertDocumentAsset(existing.documentAssets, asset);
        const documents = documentTagsFromAssets(documentAssets);
        const updated = await patchLoadRecord(id, { documentAssets, documents });
        rememberLocalWrite(updated);
        setRecordsById((prev) => ({ ...prev, [id]: updated }));
        setLoads((prev) =>
          prev.map((l) => {
            if (l.id !== id) return l;
            return {
              ...l,
              documents: l.documents.map((d) =>
                d.type === type
                  ? {
                      ...d,
                      fileName: asset.fileName,
                      uploadedAt: "Just now",
                      contentType: asset.contentType,
                      viewUrl: asset.dataUrl,
                      size: asset.size,
                      assetId: asset.id,
                    }
                  : d,
              ),
            };
          }),
        );
        void notifyDispatchChat(id, `${driver.name} uploaded ${type}.`, {
          docKind: kind,
          fileName: asset.fileName,
          contentType: asset.contentType,
          assetId: asset.id,
        });
        toast.success("Document uploaded", {
          description: `${asset.fileName} · visible to dispatch on Tracking`,
        });
      } catch (err) {
        toast.error("Upload failed", {
          description: err instanceof Error ? err.message : "Try again",
        });
        throw err;
      }
    },
    [driver, recordsById, rememberLocalWrite],
  );

  const activeLoad = useMemo(
    () =>
      loads.find(
        (l) => ACTIVE_STATUSES.includes(l.status as ActiveLoadStatus) && l.status !== "delivered",
      ),
    [loads],
  );
  // Loads dispatch assigned to this driver outrank open freight — they're blocking
  // the Tracking board until the driver accepts.
  const offeredLoads = useMemo(
    () =>
      loads
        .filter((l) => l.status === "offered")
        .sort(
          (a, b) => Number(b.assignedByDispatch ?? false) - Number(a.assignedByDispatch ?? false),
        ),
    [loads],
  );
  const myLoads = useMemo(
    () => loads.filter((l) => l.status !== "offered" && l.status !== "declined"),
    [loads],
  );
  const activity = useMemo(() => buildActivity(myLoads), [myLoads]);

  const value = useMemo<LoadsContextValue>(
    () => ({
      loads,
      recordsById,
      activeLoad,
      offeredLoads,
      myLoads,
      activity,
      locationSharing,
      setLocationSharing,
      lastGpsPingAt,
      lastGpsError,
      gpsPublishing,
      publishLocationNow,
      loading,
      refreshing,
      error,
      ready,
      refresh,
      getLoad,
      acceptLoad,
      declineLoad,
      advanceStatus,
      markDocumentUploaded,
    }),
    [
      loads,
      recordsById,
      activeLoad,
      offeredLoads,
      myLoads,
      activity,
      locationSharing,
      setLocationSharing,
      lastGpsPingAt,
      lastGpsError,
      gpsPublishing,
      publishLocationNow,
      loading,
      refreshing,
      error,
      ready,
      refresh,
      getLoad,
      acceptLoad,
      declineLoad,
      advanceStatus,
      markDocumentUploaded,
    ],
  );

  return <LoadsContext.Provider value={value}>{children}</LoadsContext.Provider>;
}

export function useLoads() {
  const ctx = useContext(LoadsContext);
  if (!ctx) throw new Error("useLoads must be used inside <LoadsProvider>");
  return ctx;
}

/** True while auth or loads are still hydrating. */
export function useDriverDataBusy() {
  const { status } = useAuth();
  const { loading, ready } = useLoads();
  return status === "loading" || !ready || loading;
}
