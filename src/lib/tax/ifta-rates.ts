/**
 * Real per-jurisdiction IFTA diesel rates, fetched from the authoritative source.
 *
 * ## Why a scrape and not an API
 *
 * There is no IFTA API. IFTA, Inc. publishes the quarterly rate matrix as a
 * server-rendered HTML table at `iftach.org/taxmatrix4/Taxmatrix.php`, and every
 * commercial IFTA product either parses that or licenses the same data. Given the
 * alternative was a single hardcoded blended rate — a guess — parsing the real
 * table is strictly better even with the fragility that comes with it.
 *
 * ## Failing soft is the whole design
 *
 * A tax figure on a load page must never depend on a third-party website being
 * up. So:
 *
 * - the fetch is server-side, cached for hours, and time-limited;
 * - a failure returns `null`, and the estimator falls back to the blended
 *   constant *and labels the figure as blended*;
 * - a parse that yields implausible values is rejected rather than trusted.
 *
 * The caller can therefore always tell whether it is showing real rates or an
 * approximation, which is the property that makes the number safe to quote.
 *
 * ## What it still does not solve
 *
 * Per-jurisdiction *mileage*. Real IFTA apportions gallons by miles run in each
 * state; a load record has total distance. Having true rates for the origin and
 * destination states is a real improvement over one national average, and it is
 * still an apportionment assumption — stated as such in the estimate's notes.
 */

export const IFTA_MATRIX_URL = "https://www.iftach.org/taxmatrix4/Taxmatrix.php";

export type IftaJurisdictionRate = {
  /** Two-letter jurisdiction code — US state or Canadian province. */
  code: string;
  name: string;
  /** Diesel rate per gallon, in `currency`. */
  diesel: number;
  currency: "USD" | "CAD";
};

export type IftaRateTable = {
  /** Free-text quarter label as published, e.g. "3rd Quarter 2026". */
  quarter: string;
  rates: Record<string, IftaJurisdictionRate>;
  fetchedAt: string;
  source: string;
};

/**
 * Sanity bounds, in USD per gallon.
 *
 * Published rates run roughly $0.19–$0.97. A parse that produces 0, or 45, has
 * matched the wrong column — a very common failure when a table gains a column —
 * and rates outside this band are dropped rather than used. Better to fall back
 * to a labelled approximation than to price freight off a misaligned column.
 */
const PLAUSIBLE_MIN = 0.05;
const PLAUSIBLE_MAX = 2.0;

/** Canadian jurisdictions publish in CAD; their rates are not comparable to USD. */
const CANADIAN_CODES = new Set([
  "AB",
  "BC",
  "MB",
  "NB",
  "NL",
  "NS",
  "NT",
  "NU",
  "ON",
  "PE",
  "QC",
  "SK",
  "YT",
]);

/**
 * Pull `{code, name, rate}` triples out of the matrix HTML.
 *
 * Deliberately tolerant of layout: it looks for a row containing a recognisable
 * jurisdiction code and takes the first plausible decimal in that row, rather
 * than depending on a fixed column index. Column order on that page has changed
 * before, and an index-based parser silently reads gasoline as diesel when it
 * does.
 */
export function parseIftaMatrix(html: string): IftaRateTable | null {
  if (!html || html.length < 500) return null;

  const quarterMatch = html.match(/(\d(?:st|nd|rd|th)\s+Quarter\s+\d{4})/i);
  const quarter = quarterMatch ? quarterMatch[1] : "unknown quarter";

  const rates: Record<string, IftaJurisdictionRate> = {};

  // Row-wise, so a malformed row cannot consume the next one's numbers.
  const rows = html.split(/<tr[^>]*>/i).slice(1);
  for (const row of rows) {
    const cells = row
      .split(/<\/?t[dh][^>]*>/i)
      .map((cell) =>
        cell
          .replace(/<[^>]*>/g, " ")
          .replace(/&nbsp;/g, " ")
          .trim(),
      )
      .filter((cell) => cell.length > 0);
    if (cells.length < 2) continue;

    // A jurisdiction code appears as a standalone two-letter uppercase token,
    // usually alongside the full name.
    const codeCell = cells.find((cell) => /^[A-Z]{2}$/.test(cell));
    if (!codeCell) continue;

    const nameCell =
      cells.find((cell) => /^[A-Za-z][A-Za-z .'-]{3,}$/.test(cell) && cell !== codeCell) ??
      codeCell;

    // First plausible decimal in the row. Rates are published to four places.
    let diesel: number | null = null;
    for (const cell of cells) {
      const match = cell.match(/^\$?\s*(\d+\.\d{2,4})$/);
      if (!match) continue;
      const value = Number(match[1]);
      if (value >= PLAUSIBLE_MIN && value <= PLAUSIBLE_MAX) {
        diesel = value;
        break;
      }
    }
    if (diesel === null) continue;

    rates[codeCell] = {
      code: codeCell,
      name: nameCell,
      diesel,
      currency: CANADIAN_CODES.has(codeCell) ? "CAD" : "USD",
    };
  }

  // A real matrix has ~58 jurisdictions. Anything far below that means the page
  // shape changed and the partial result should not be trusted.
  const usCount = Object.values(rates).filter((rate) => rate.currency === "USD").length;
  if (usCount < 30) return null;

  return {
    quarter,
    rates,
    fetchedAt: new Date().toISOString(),
    source: IFTA_MATRIX_URL,
  };
}

/* ------------------------------------------------------------------ *
 * Fetch + cache
 * ------------------------------------------------------------------ */

/**
 * Rates change quarterly, so this is generous on purpose — the point of the
 * cache is that a load page never waits on iftach.org, not that the data is
 * fresh to the minute.
 */
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 5_000;

let cached: { table: IftaRateTable; expiresAt: number } | null = null;
/** Deduplicates concurrent misses so a cold cache makes one request, not fifty. */
let inflight: Promise<IftaRateTable | null> | null = null;

export function peekIftaCache(): IftaRateTable | null {
  if (cached && cached.expiresAt > Date.now()) return cached.table;
  return null;
}

export function resetIftaCacheForTests(): void {
  cached = null;
  inflight = null;
}

export async function getIftaRates(fetchImpl: typeof fetch = fetch): Promise<IftaRateTable | null> {
  const fresh = peekIftaCache();
  if (fresh) return fresh;
  if (inflight) return inflight;

  inflight = (async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const response = await fetchImpl(IFTA_MATRIX_URL, {
        signal: controller.signal,
        headers: { Accept: "text/html" },
      });
      if (!response.ok) return null;
      const table = parseIftaMatrix(await response.text());
      if (table) cached = { table, expiresAt: Date.now() + CACHE_TTL_MS };
      return table;
    } catch {
      // Never surfaced as an error: the estimator falls back to a labelled
      // approximation, which is a worse number but not a broken page.
      return null;
    } finally {
      clearTimeout(timer);
      inflight = null;
    }
  })();

  return inflight;
}

/**
 * Rate to apply to a lane, given real per-jurisdiction data.
 *
 * Averages the origin and destination states rather than pretending to know the
 * split. That is an assumption, but a far narrower one than a national blend: on
 * a Texas–Georgia run the true answer lies between the two states' rates, and
 * this lands inside that interval. Named `assumption` in the return so the caller
 * has to acknowledge it.
 */
export function laneDieselRate(
  table: IftaRateTable,
  originState: string,
  destinationState: string,
): { rate: number; jurisdictions: string[]; assumption: string } | null {
  const usd = (code: string): number | null => {
    const entry = table.rates[code.trim().toUpperCase()];
    if (!entry || entry.currency !== "USD") return null;
    return entry.diesel;
  };

  const origin = usd(originState);
  const destination = usd(destinationState);
  const found = [origin, destination].filter((value): value is number => value !== null);
  if (found.length === 0) return null;

  const jurisdictions = [originState, destinationState]
    .map((state) => state.trim().toUpperCase())
    .filter((state) => usd(state) !== null);

  return {
    rate: found.reduce((sum, value) => sum + value, 0) / found.length,
    jurisdictions,
    assumption:
      found.length === 2
        ? "Mileage assumed split evenly between the origin and destination states."
        : "Only one endpoint's jurisdiction rate was available; it is applied to the whole lane.",
  };
}
