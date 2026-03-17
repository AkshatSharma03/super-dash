// ─────────────────────────────────────────────────────────────────────────────
// COMPOUND ANNUAL GROWTH RATE  (implemented from scratch)
// CAGR = (end / start)^(1 / years) − 1
//
// Computes CAGR for multiple time periods across several economic series
// (GDP, exports, imports, per-capita income) and returns chart-ready output.
// ─────────────────────────────────────────────────────────────────────────────

export interface CAGREntry {
  label: string;       // e.g. "2010–2015"
  years: number;       // number of years in the period
  startYear: number;
  endYear: number;
  gdp:       number | null;   // CAGR % or null if data unavailable
  exports:   number | null;
  imports:   number | null;
  perCapita: number | null;
}

export interface CAGRResult {
  periods: CAGREntry[];
  fullPeriod: CAGREntry;          // whole dataset span
  fastestGDPPeriod: string;       // label of the period with highest GDP CAGR
  slowestGDPPeriod: string;
}

/** Compute CAGR between two values. Returns null when data is missing or zero. */
export function computeCAGR(start: number, end: number, years: number): number | null {
  if (!start || !end || years <= 0 || start <= 0 || end <= 0) return null;
  return +((Math.pow(end / start, 1 / years) - 1) * 100).toFixed(2);
}

/** Build a lookup map from year → series value for fast O(1) access. */
function makeIndex<T extends { year: number }>(
  arr: T[],
  key: keyof T,
): Map<number, number> {
  const m = new Map<number, number>();
  for (const row of arr) {
    const v = row[key];
    if (typeof v === "number") m.set(row.year, v);
  }
  return m;
}

export function buildCAGRSeries(
  gdpData:    Array<{ year: number; gdp_bn: number; gdp_per_capita: number }>,
  exportData: Array<{ year: number; total: number }>,
  importData: Array<{ year: number; total: number }>,
): CAGRResult {
  const gdpIdx  = makeIndex(gdpData, "gdp_bn");
  const pcIdx   = makeIndex(gdpData, "gdp_per_capita");
  const expIdx  = makeIndex(exportData, "total");
  const impIdx  = makeIndex(importData, "total");

  const years = gdpData.map(d => d.year).sort((a, b) => a - b);
  const minY  = years[0];
  const maxY  = years[years.length - 1];

  // Build standard 5-year periods that fit within the data range
  const periodBoundaries: [number, number][] = [];
  let start = minY;
  while (start + 5 <= maxY) {
    periodBoundaries.push([start, start + 5]);
    start += 5;
  }
  // Remaining years as a partial period if at least 2 years remain
  if (maxY - start >= 2) periodBoundaries.push([start, maxY]);

  function makeEntry(s: number, e: number): CAGREntry {
    const n = e - s;
    return {
      label:     `${s}–${e}`,
      years:     n,
      startYear: s,
      endYear:   e,
      gdp:       computeCAGR(gdpIdx.get(s) ?? 0, gdpIdx.get(e) ?? 0, n),
      exports:   computeCAGR(expIdx.get(s) ?? 0, expIdx.get(e) ?? 0, n),
      imports:   computeCAGR(impIdx.get(s) ?? 0, impIdx.get(e) ?? 0, n),
      perCapita: computeCAGR(pcIdx.get(s)  ?? 0, pcIdx.get(e)  ?? 0, n),
    };
  }

  const periods    = periodBoundaries.map(([s, e]) => makeEntry(s, e));
  const fullPeriod = makeEntry(minY, maxY);

  // Identify fastest / slowest GDP growth periods
  const ranked = [...periods]
    .filter(p => p.gdp !== null)
    .sort((a, b) => (b.gdp ?? -Infinity) - (a.gdp ?? -Infinity));

  return {
    periods,
    fullPeriod,
    fastestGDPPeriod: ranked[0]?.label ?? "—",
    slowestGDPPeriod: ranked[ranked.length - 1]?.label ?? "—",
  };
}
