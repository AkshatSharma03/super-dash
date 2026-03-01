// ─────────────────────────────────────────────────────────────────────────────
// Z-SCORE ANOMALY DETECTION  (implemented from scratch)
// A value is anomalous if |z| = |(x - μ) / σ| exceeds the threshold.
// We use a modified threshold of 1.6 (vs the typical 2.0) to surface
// economically meaningful events like the 2016 oil crash and 2020 COVID shock.
// ─────────────────────────────────────────────────────────────────────────────

export interface AnomalyPoint {
  year: number;
  metric: string;
  value: number;
  mean: number;
  std: number;
  zScore: number;
  direction: "high" | "low";
  severity: "moderate" | "strong" | "extreme";
  annotation: string;
}

function sampleMean(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function sampleStd(values: number[], mean: number): number {
  const variance = values.reduce((acc, v) => acc + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

function severityLabel(absZ: number): AnomalyPoint["severity"] {
  if (absZ >= 2.5) return "extreme";
  if (absZ >= 1.9) return "strong";
  return "moderate";
}

export function detectAnomalies(
  series: Array<{ year: number; value: number }>,
  metricName: string,
  threshold = 1.6,
): AnomalyPoint[] {
  const values = series.map(d => d.value);
  const mean   = sampleMean(values);
  const std    = sampleStd(values, mean);
  if (std === 0) return [];

  const results: AnomalyPoint[] = [];

  for (const point of series) {
    const zScore = (point.value - mean) / std;
    const absZ   = Math.abs(zScore);
    if (absZ < threshold) continue;

    const direction: AnomalyPoint["direction"] = zScore > 0 ? "high" : "low";
    const severity = severityLabel(absZ);

    const annotation =
      direction === "high"
        ? `${(+absZ.toFixed(1))}σ above average`
        : `${(+absZ.toFixed(1))}σ below average`;

    results.push({
      year: point.year,
      metric: metricName,
      value: +point.value.toFixed(2),
      mean: +mean.toFixed(2),
      std: +std.toFixed(2),
      zScore: +zScore.toFixed(2),
      direction,
      severity,
      annotation,
    });
  }

  return results.sort((a, b) => Math.abs(b.zScore) - Math.abs(a.zScore));
}

// Run anomaly detection across all key metrics and return a unified list
export interface MultiSeriesInput {
  gdpData:     Array<{ year: number; gdp_bn: number; gdp_growth: number; gdp_per_capita: number }>;
  exportsData: Array<{ year: number; total: number }>;
  importsData: Array<{ year: number; total: number }>;
  tradeData:   Array<{ year: number; balance: number }>;
}

export function detectAllAnomalies(input: MultiSeriesInput): AnomalyPoint[] {
  const results: AnomalyPoint[] = [
    ...detectAnomalies(input.gdpData.map(d => ({ year: d.year, value: d.gdp_growth })),      "GDP Growth (%)",       1.5),
    ...detectAnomalies(input.gdpData.map(d => ({ year: d.year, value: d.gdp_bn })),           "Nominal GDP ($B)",     1.6),
    ...detectAnomalies(input.gdpData.map(d => ({ year: d.year, value: d.gdp_per_capita })),   "GDP per Capita ($)",   1.6),
    ...detectAnomalies(input.exportsData.map(d => ({ year: d.year, value: d.total })),         "Total Exports ($B)",   1.6),
    ...detectAnomalies(input.importsData.map(d => ({ year: d.year, value: d.total })),         "Total Imports ($B)",   1.6),
    ...detectAnomalies(input.tradeData.map(d => ({ year: d.year, value: d.balance })),         "Trade Balance ($B)",   1.6),
  ];

  // Deduplicate by year+metric
  const seen = new Set<string>();
  return results.filter(a => {
    const key = `${a.year}:${a.metric}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).sort((a, b) => Math.abs(b.zScore) - Math.abs(a.zScore));
}
