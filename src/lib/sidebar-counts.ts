import type { QueryClient } from "@tanstack/react-query";

import { listAllLoads } from "@/lib/loads-store";
import { listAllTrucks } from "@/lib/trucks-store";

export const SIDEBAR_OPERATIONAL_COUNTS_QUERY_KEY = ["sidebar", "operational-counts"] as const;

export async function fetchOperationalCounts(): Promise<{ loads: number; trucks: number }> {
  const [loads, trucks] = await Promise.all([listAllLoads(), listAllTrucks()]);
  return { loads: loads.length, trucks: trucks.length };
}

export function invalidateOperationalCounts(queryClient: QueryClient) {
  void queryClient.invalidateQueries({ queryKey: SIDEBAR_OPERATIONAL_COUNTS_QUERY_KEY });
}
