/**
 * Keep a Maps key that already worked.
 *
 * The dashboard poll can return `maps: null` for a beat (settings read blip).
 * Treating that as "no key" unmounts Google Maps and `setOptions` will not run
 * again, so the next load click paints an empty canvas.
 */
export function retainMapsApiKey(
  held: string,
  incoming: string | null | undefined,
): string {
  const next = incoming?.trim() ?? "";
  return next || held;
}
