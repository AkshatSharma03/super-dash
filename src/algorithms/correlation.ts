// ─────────────────────────────────────────────────────────────────────────────
// PEARSON CORRELATION MATRIX  (implemented from scratch)
// r(X,Y) = Σ[(xᵢ − x̄)(yᵢ − ȳ)] / √[Σ(xᵢ−x̄)² · Σ(yᵢ−ȳ)²]
//
// Computes pairwise Pearson correlations across key economic variables aligned
// by year, returns a flat list suitable for a heat-map or table display.
// ─────────────────────────────────────────────────────────────────────────────

export interface CorrelationCell {
  rowLabel: string;
  colLabel: string;
  r: number;             // Pearson r ∈ [−1, 1]
  strength: "strong" | "moderate" | "weak" | "none";
  direction: "positive" | "negative" | "none";
}

export interface CorrelationResult {
  variables: string[];           // ordered variable labels (for axes)
  cells: CorrelationCell[];      // all n×n cells (including diagonal r=1)
  strongestPair: { row: string; col: string; r: number } | null;
}

/** Pearson r between two equal-length numeric arrays. Returns 0 if degenerate. */
export function pearsonR(x: number[], y: number[]): number {
  const n = x.length;
  if (n !== y.length) return 0;
  if (n < 3) return 0;
  if (!x.every(Number.isFinite) || !y.every(Number.isFinite)) return 0;

  const xBar = x.reduce((a, b) => a + b, 0) / n;
  const yBar = y.reduce((a, b) => a + b, 0) / n;

  let num = 0, sx2 = 0, sy2 = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i] - xBar;
    const dy = y[i] - yBar;
    num += dx * dy;
    sx2 += dx * dx;
    sy2 += dy * dy;
  }
  const denom = Math.sqrt(sx2 * sy2);
  return denom < 1e-12 ? 0 : +(num / denom).toFixed(3);
}

function strengthLabel(absR: number): CorrelationCell["strength"] {
  if (absR >= 0.7) return "strong";
  if (absR >= 0.4) return "moderate";
  if (absR >= 0.15) return "weak";
  return "none";
}

export function buildCorrelationMatrix(
  gdpData:    Array<{ year: number; gdp_bn: number; gdp_growth: number; gdp_per_capita: number }>,
  exportData: Array<{ year: number; total: number }>,
  importData: Array<{ year: number; total: number }>,
): CorrelationResult {
  const gdpMap  = new Map(gdpData.map(d => [d.year, d]));
  const expMap  = new Map(exportData.map(d => [d.year, d.total]));
  const impMap  = new Map(importData.map(d => [d.year, d.total]));

  // Align all series on the true intersection of available years
  const years = gdpData
    .map(d => d.year)
    .filter(year => expMap.has(year) && impMap.has(year))
    .sort((a, b) => a - b);

  // Build series vectors aligned by year
  const gdpBn:    number[] = [];
  const gdpGr:    number[] = [];
  const gdpPc:    number[] = [];
  const exports:  number[] = [];
  const imports:  number[] = [];
  const balance:  number[] = [];

  for (const y of years) {
    const g = gdpMap.get(y);
    const ex = expMap.get(y);
    const im = impMap.get(y);
    if (!g) continue;
    if (ex === undefined || im === undefined) continue;
    gdpBn.push(g.gdp_bn);
    gdpGr.push(g.gdp_growth);
    gdpPc.push(g.gdp_per_capita);
    exports.push(ex);
    imports.push(im);
    balance.push(ex - im);
  }

  const seriesList: Array<{ label: string; values: number[] }> = [
    { label: "GDP ($B)",       values: gdpBn  },
    { label: "GDP Growth %",   values: gdpGr  },
    { label: "GDP/Capita",     values: gdpPc  },
    { label: "Exports ($B)",   values: exports },
    { label: "Imports ($B)",   values: imports },
    { label: "Trade Balance",  values: balance },
  ];

  const variables = seriesList.map(s => s.label);
  const cells: CorrelationCell[] = [];
  let strongestPair: CorrelationResult["strongestPair"] = null;
  let maxAbsR = 0;

  for (let i = 0; i < seriesList.length; i++) {
    for (let j = 0; j < seriesList.length; j++) {
      const r = i === j ? 1 : pearsonR(seriesList[i].values, seriesList[j].values);
      const absR = Math.abs(r);

      cells.push({
        rowLabel:  seriesList[i].label,
        colLabel:  seriesList[j].label,
        r,
        strength:  strengthLabel(absR),
        direction: r > 0.01 ? "positive" : r < -0.01 ? "negative" : "none",
      });

      // Track strongest off-diagonal pair
      if (i !== j && absR > maxAbsR) {
        maxAbsR = absR;
        strongestPair = { row: seriesList[i].label, col: seriesList[j].label, r };
      }
    }
  }

  return { variables, cells, strongestPair };
}
