// ─────────────────────────────────────────────────────────────────────────────
// HERFINDAHL-HIRSCHMAN INDEX  (implemented from scratch)
// Measures market/trade concentration: HHI = Σ(sᵢ × 100)²
// Scale: 0–10000.  <1500 = competitive · 1500–2500 = moderate · >2500 = concentrated
// ─────────────────────────────────────────────────────────────────────────────

export type ConcentrationLevel = "Competitive" | "Moderate" | "Concentrated";

export interface HHIResult {
  hhi: number;                   // raw HHI (0–10000)
  normalizedHHI: number;         // normalized to 0–1 (removes effect of n)
  level: ConcentrationLevel;
  dominantShare: number;         // largest single share (%)
  dominantName: string;
  shares: Array<{ name: string; share: number; contribution: number }>;
}

export function computeHHI(
  components: Record<string, number>,
): HHIResult {
  const entries = Object.entries(components);
  const total = entries.reduce((acc, [, v]) => acc + v, 0);
  if (total === 0) return { hhi: 0, normalizedHHI: 0, level: "Competitive", dominantShare: 0, dominantName: "", shares: [] };

  const n = entries.length;

  const shares = entries.map(([name, v]) => {
    const share = (v / total) * 100;           // percentage share
    return { name, share, contribution: share * share };
  });

  const hhi = shares.reduce((acc, s) => acc + s.contribution, 0);

  // Normalized HHI: maps [1/n, 1] → [0, 1]
  // Formula: (HHI/10000 - 1/n) / (1 - 1/n)
  const hhiNorm   = hhi / 10000;
  const minPossible = 1 / n;
  const normalizedHHI = n > 1 ? (hhiNorm - minPossible) / (1 - minPossible) : 1;

  const level: ConcentrationLevel =
    hhi < 1500 ? "Competitive" :
    hhi < 2500 ? "Moderate"    : "Concentrated";

  const dominant = shares.reduce((best, s) => s.share > best.share ? s : best, shares[0]);

  return {
    hhi: Math.round(hhi),
    normalizedHHI: +Math.max(0, normalizedHHI).toFixed(3),
    level,
    dominantShare: +dominant.share.toFixed(1),
    dominantName: dominant.name,
    shares: shares.sort((a, b) => b.share - a.share),
  };
}

// Compute HHI time series from the import data array
export interface HHITimePoint {
  year: number;
  importHHI: number;
  exportHHI: number;
  importLevel: ConcentrationLevel;
  exportLevel: ConcentrationLevel;
}

export function buildHHITimeSeries(
  importsData: Array<{ year: number; china: number; russia: number; eu: number; us: number; turkey: number; uk: number; other: number }>,
  exportsData: Array<{ year: number; oil_gas: number; metals: number; chemicals: number; machinery: number; agriculture: number; other: number }>,
): HHITimePoint[] {
  return importsData.map((imp, i) => {
    const exp = exportsData[i];
    const impResult = computeHHI({ China: imp.china, Russia: imp.russia, EU: imp.eu, US: imp.us, Turkey: imp.turkey, UK: imp.uk, Other: imp.other });
    const expResult = computeHHI({ "Oil & Gas": exp.oil_gas, Metals: exp.metals, Chemicals: exp.chemicals, Machinery: exp.machinery, Agriculture: exp.agriculture, Other: exp.other });
    return {
      year: imp.year,
      importHHI: impResult.hhi,
      exportHHI: expResult.hhi,
      importLevel: impResult.level,
      exportLevel: expResult.level,
    };
  });
}
