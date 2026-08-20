import type { LoadRecord } from "@/lib/loads-store";
import type { TrackingSession } from "@/lib/tracking-workflow-store";
import type { TruckRecord } from "@/lib/trucks-store";

export type GlobalSearchResultType = "load" | "carrier" | "lane" | "contact" | "document";

export type GlobalSearchResult = {
  id: string;
  type: GlobalSearchResultType;
  title: string;
  subtitle: string;
  keywords: string[];
  loadId?: string;
  truckBoardId?: string;
};

type GlobalSearchIndexInput = {
  loads: LoadRecord[];
  trucks: TruckRecord[];
  sessions: TrackingSession[];
};

const OCR_HINT_FIELD_RE = /(ocr|extract|parsed|document|doc|bol|pod|invoice|proof)/i;

function text(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

function unique(values: unknown[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of values) {
    const v = text(raw);
    if (!v) continue;
    const key = v.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(v);
  }
  return out;
}

function formatPlace(city?: string, state?: string): string {
  if (city && state) return `${city}, ${state}`;
  return city || state || "";
}

function formatLoadLane(load: LoadRecord): string {
  const origin = formatPlace(load.pickupCity, load.pickupState) || load.pickupFacility || "Origin";
  const destination =
    formatPlace(load.deliveryCity, load.deliveryState) || load.deliveryFacility || "Destination";
  return `${origin} -> ${destination}`;
}

function collectDocumentHints(value: unknown, path: string, out: string[], depth = 0): void {
  if (depth > 5) return;

  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    const v = text(value);
    if (!v) return;
    if (OCR_HINT_FIELD_RE.test(path) || OCR_HINT_FIELD_RE.test(v)) {
      out.push(v);
    }
    return;
  }

  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) {
      collectDocumentHints(value[i], `${path}[${i}]`, out, depth + 1);
    }
    return;
  }

  if (!value || typeof value !== "object") return;

  for (const [key, next] of Object.entries(value as Record<string, unknown>)) {
    const nextPath = path ? `${path}.${key}` : key;
    collectDocumentHints(next, nextPath, out, depth + 1);
  }
}

function buildLoadResults(loads: LoadRecord[]): GlobalSearchResult[] {
  const out: GlobalSearchResult[] = [];
  const carrierByName = new Map<string, GlobalSearchResult>();
  const laneByKey = new Map<string, GlobalSearchResult>();
  const contactByKey = new Map<string, GlobalSearchResult>();
  const docByKey = new Map<string, GlobalSearchResult>();

  for (const load of loads) {
    const lane = formatLoadLane(load);
    out.push({
      id: `load:${load.loadId}`,
      type: "load",
      title: load.loadId,
      subtitle: `${lane}${load.customer ? ` • ${load.customer}` : ""}`,
      keywords: unique([
        lane,
        load.customer ?? "",
        load.broker ?? "",
        load.assignedCarrier ?? "",
        load.commodityDescription ?? "",
        load.pickupZip ?? "",
        load.deliveryZip ?? "",
      ]),
      loadId: load.loadId,
    });

    if (load.assignedCarrier?.trim()) {
      const key = load.assignedCarrier.trim().toLowerCase();
      if (!carrierByName.has(key)) {
        carrierByName.set(key, {
          id: `carrier:load:${key}`,
          type: "carrier",
          title: load.assignedCarrier.trim(),
          subtitle: `Carrier on ${load.loadId}`,
          keywords: unique([
            load.assignedCarrier,
            load.customer ?? "",
            load.loadId,
            lane,
            load.broker ?? "",
          ]),
          loadId: load.loadId,
        });
      }
    }

    const laneKey = lane.toLowerCase();
    if (!laneByKey.has(laneKey)) {
      laneByKey.set(laneKey, {
        id: `lane:load:${laneKey}`,
        type: "lane",
        title: lane,
        subtitle: `Load lane • ${load.loadId}`,
        keywords: unique([
          load.loadId,
          load.customer ?? "",
          load.pickupZip ?? "",
          load.deliveryZip ?? "",
          load.equipmentType ?? "",
        ]),
        loadId: load.loadId,
      });
    }

    const loadContacts: Array<{ name?: string; phone?: string; email?: string; label: string }> = [
      {
        name: load.pickupContactName,
        phone: load.pickupContactPhone,
        email: load.pickupContactEmail,
        label: "Pickup contact",
      },
      {
        name: load.deliveryContactName,
        phone: load.deliveryContactPhone,
        email: load.deliveryContactEmail,
        label: "Delivery contact",
      },
    ];

    for (const contact of loadContacts) {
      const name = contact.name?.trim();
      if (!name) continue;
      const key = `${name.toLowerCase()}|${contact.email?.toLowerCase() ?? ""}|${contact.phone ?? ""}`;
      if (!contactByKey.has(key)) {
        contactByKey.set(key, {
          id: `contact:load:${key}`,
          type: "contact",
          title: name,
          subtitle: `${contact.label} • ${load.loadId}`,
          keywords: unique([contact.phone ?? "", contact.email ?? "", load.loadId, lane]),
          loadId: load.loadId,
        });
      }
    }

    const documentKeywords = unique([
      ...(load.documents ?? []),
      (() => {
        const hints: string[] = [];
        collectDocumentHints(load as Record<string, unknown>, "load", hints);
        return hints;
      })(),
    ]);
    if (documentKeywords.length > 0) {
      const key = `load-doc:${load.loadId}`;
      docByKey.set(key, {
        id: `document:${key}`,
        type: "document",
        title: `Load documents • ${load.loadId}`,
        subtitle: "Includes OCR/extracted document fields when present",
        keywords: unique([load.loadId, lane, ...documentKeywords]),
        loadId: load.loadId,
      });
    }
  }

  out.push(...carrierByName.values());
  out.push(...laneByKey.values());
  out.push(...contactByKey.values());
  out.push(...docByKey.values());
  return out;
}

function buildTruckResults(trucks: TruckRecord[]): GlobalSearchResult[] {
  const out: GlobalSearchResult[] = [];
  const carrierByName = new Map<string, GlobalSearchResult>();
  const laneByKey = new Map<string, GlobalSearchResult>();
  const contactByKey = new Map<string, GlobalSearchResult>();
  const docByKey = new Map<string, GlobalSearchResult>();

  for (const truck of trucks) {
    if (truck.carrierName?.trim()) {
      const name = truck.carrierName.trim();
      const key = name.toLowerCase();
      if (!carrierByName.has(key)) {
        carrierByName.set(key, {
          id: `carrier:truck:${key}`,
          type: "carrier",
          title: name,
          subtitle: `Carrier profile • ${truck.truckBoardId}`,
          keywords: unique([
            truck.carrierMcNumber ?? "",
            truck.carrierDotNumber ?? "",
            truck.contactName ?? "",
            truck.contactPhone ?? "",
            truck.contactEmail ?? "",
          ]),
          truckBoardId: truck.truckBoardId,
        });
      }
    }

    const origin = formatPlace(truck.currentCity, truck.currentState);
    const destination = formatPlace(
      truck.preferredDestinationCity,
      truck.preferredDestinationState,
    );
    const preferred = truck.preferredLanes?.trim();
    const laneCandidates = unique([
      origin && destination ? `${origin} -> ${destination}` : "",
      preferred ?? "",
      truck.avoidedLanes ?? "",
    ]);

    for (const lane of laneCandidates) {
      const key = lane.toLowerCase();
      if (!laneByKey.has(key)) {
        laneByKey.set(key, {
          id: `lane:truck:${key}`,
          type: "lane",
          title: lane,
          subtitle: `Truck lane preference • ${truck.truckBoardId}`,
          keywords: unique([
            truck.truckBoardId,
            truck.carrierName ?? "",
            truck.equipmentType ?? "",
            truck.currentZip ?? "",
          ]),
          truckBoardId: truck.truckBoardId,
        });
      }
    }

    const truckContacts: Array<{ name?: string; phone?: string; email?: string; label: string }> = [
      {
        name: truck.contactName,
        phone: truck.contactPhone,
        email: truck.contactEmail,
        label: "Carrier contact",
      },
      {
        name: truck.driverName,
        phone: truck.driverPhone,
        email: undefined,
        label: "Driver",
      },
      {
        name: truck.dispatcherName,
        phone: truck.dispatcherPhone,
        email: truck.dispatcherEmail,
        label: "Dispatcher",
      },
    ];

    for (const contact of truckContacts) {
      const name = contact.name?.trim();
      if (!name) continue;
      const key = `${name.toLowerCase()}|${contact.email?.toLowerCase() ?? ""}|${contact.phone ?? ""}`;
      if (!contactByKey.has(key)) {
        contactByKey.set(key, {
          id: `contact:truck:${key}`,
          type: "contact",
          title: name,
          subtitle: `${contact.label} • ${truck.truckBoardId}`,
          keywords: unique([
            truck.truckBoardId,
            truck.carrierName ?? "",
            contact.phone ?? "",
            contact.email ?? "",
          ]),
          truckBoardId: truck.truckBoardId,
        });
      }
    }

    const documentKeywords = unique([
      ...(truck.documents ?? []),
      (() => {
        const hints: string[] = [];
        collectDocumentHints(truck as Record<string, unknown>, "truck", hints);
        return hints;
      })(),
    ]);
    if (documentKeywords.length > 0) {
      const key = `truck-doc:${truck.truckBoardId}`;
      docByKey.set(key, {
        id: `document:${key}`,
        type: "document",
        title: `Carrier documents • ${truck.truckBoardId}`,
        subtitle: "Includes OCR/extracted document fields when present",
        keywords: unique([truck.truckBoardId, truck.carrierName ?? "", ...documentKeywords]),
        truckBoardId: truck.truckBoardId,
      });
    }
  }

  out.push(...carrierByName.values());
  out.push(...laneByKey.values());
  out.push(...contactByKey.values());
  out.push(...docByKey.values());
  return out;
}

function buildSessionDocumentResults(sessions: TrackingSession[]): GlobalSearchResult[] {
  const out: GlobalSearchResult[] = [];
  const seen = new Set<string>();

  for (const session of sessions) {
    for (const doc of session.documents) {
      const key = `${session.loadId}|${doc.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        id: `document:tracking:${key}`,
        type: "document",
        title: `${doc.name} • ${session.loadId}`,
        subtitle: `${doc.type} • ${doc.status}${doc.uploadedAt ? ` • ${doc.uploadedAt.slice(0, 10)}` : ""}`,
        keywords: unique([
          session.loadId,
          session.customer ?? "",
          session.carrier ?? "",
          session.pickup.city,
          session.delivery.city,
          doc.type,
          doc.status,
        ]),
        loadId: session.loadId,
      });
    }
  }

  return out;
}

export function buildGlobalSearchIndex(input: GlobalSearchIndexInput): GlobalSearchResult[] {
  return [
    ...buildLoadResults(input.loads),
    ...buildTruckResults(input.trucks),
    ...buildSessionDocumentResults(input.sessions),
  ];
}

function scoreResult(result: GlobalSearchResult, query: string, tokens: string[]): number {
  const haystack = `${result.title} ${result.subtitle} ${result.keywords.join(" ")}`.toLowerCase();
  let score = 0;
  if (result.title.toLowerCase() === query) score += 140;
  else if (result.title.toLowerCase().startsWith(query)) score += 90;
  else if (result.title.toLowerCase().includes(query)) score += 60;
  else if (haystack.includes(query)) score += 30;

  for (const token of tokens) {
    if (result.title.toLowerCase().includes(token)) score += 12;
    else if (result.subtitle.toLowerCase().includes(token)) score += 7;
    else if (haystack.includes(token)) score += 4;
  }

  if (result.type === "load") score += 2;
  return score;
}

export function searchGlobalIndex(
  index: GlobalSearchResult[],
  rawQuery: unknown,
  limit = 40,
): GlobalSearchResult[] {
  const query = (typeof rawQuery === "string" ? rawQuery : String(rawQuery ?? ""))
    .trim()
    .toLowerCase();
  if (!query) return index.slice(0, limit);
  const tokens = query.split(/\s+/).filter(Boolean);

  const matches = index
    .filter((result) => {
      const hay = `${result.title} ${result.subtitle} ${result.keywords.join(" ")}`.toLowerCase();
      return tokens.every((token) => hay.includes(token));
    })
    .map((result) => ({ result, score: scoreResult(result, query, tokens) }))
    .sort((a, b) => b.score - a.score || a.result.title.localeCompare(b.result.title))
    .slice(0, limit)
    .map((row) => row.result);

  return matches;
}
