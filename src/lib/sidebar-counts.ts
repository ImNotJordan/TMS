import type { QueryClient } from "@tanstack/react-query";

import { listAllCarriersCached } from "@/lib/carriers-store";
import { listAllLoadsCached } from "@/lib/loads-store";
import {
  getOperationalCacheScope,
  peekOperationalListLength,
} from "@/lib/operational-data-cache";
import { listAllTrucksCached } from "@/lib/trucks-store";

export const SIDEBAR_OPERATIONAL_COUNTS_QUERY_KEY = ["sidebar", "operational-counts"] as const;

export async function fetchOperationalCounts(): Promise<{
  loads: number;
  trucks: number;
  carriers: number;
}> {
  const scope = getOperationalCacheScope();
  const cachedLoads = peekOperationalListLength("loads", scope);
  const cachedTrucks = peekOperationalListLength("trucks", scope);
  const cachedCarriers = peekOperationalListLength("carriers", scope);

  // Warm-cache hit: avoid cloning full entity lists just to read .length
  if (cachedLoads != null && cachedTrucks != null && cachedCarriers != null) {
    return { loads: cachedLoads, trucks: cachedTrucks, carriers: cachedCarriers };
  }

  const [loads, trucks, carriers] = await Promise.all([
    cachedLoads == null ? listAllLoadsCached({ scope }) : null,
    cachedTrucks == null ? listAllTrucksCached({ scope }) : null,
    cachedCarriers == null ? listAllCarriersCached({ scope }) : null,
  ]);

  return {
    loads: cachedLoads ?? loads!.length,
    trucks: cachedTrucks ?? trucks!.length,
    carriers: cachedCarriers ?? carriers!.length,
  };
}

export function invalidateOperationalCounts(queryClient: QueryClient) {
  void queryClient.invalidateQueries({ queryKey: SIDEBAR_OPERATIONAL_COUNTS_QUERY_KEY });
}
