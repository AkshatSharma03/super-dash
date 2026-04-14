// ─────────────────────────────────────────────────────────────────────────────
// PEER RANKING METRICS  —  helpers for peer benchmarking
// Percentile ranks and basic summary stats used by the dashboard UI.
// ─────────────────────────────────────────────────────────────────────────────

export interface NumericPoint {
  value: number;
  code?: string;
}

export interface PeerRankingSummary {
  rank: number;
  total: number;
  percentile: number; // percentage of peers below/equal the target (0–100)
  median: number | null;
  average: number | null;
}

function normalizeValues(values: Array<number | null | undefined>): number[] {
  return values
    .map((value) => (typeof value === "number" && Number.isFinite(value) ? value : null))
    .filter((value): value is number => value !== null)
    .map((value) => Number(value));
}

/**
 * Compute average of all finite values. Returns null if list is empty.
 */
export function computeAverage(values: Array<number | null | undefined>): number | null {
  const nums = normalizeValues(values);
  if (!nums.length) return null;
  const total = nums.reduce((sum, value) => sum + value, 0);
  return Number((total / nums.length).toFixed(2));
}

/**
 * Compute median of all finite values.
 * Returns null if list is empty.
 */
export function computeMedian(values: Array<number | null | undefined>): number | null {
  const nums = normalizeValues(values).sort((a, b) => a - b);
  if (!nums.length) return null;

  const mid = Math.floor(nums.length / 2);
  if (nums.length % 2 === 1) {
    return Number(nums[mid].toFixed(2));
  }

  return Number(((nums[mid - 1] + nums[mid]) / 2).toFixed(2));
}

/**
 * Percentile rank in ascending order (Excel-style formula approximation).
 * - 0 when target is below all values
 * - 100 when target is at/above all values
 */
export function computePercentileRank(
  values: Array<number | null | undefined>,
  target: number,
): number | null {
  const nums = normalizeValues(values);
  if (!nums.length || !Number.isFinite(target)) return null;

  const sorted = nums.slice().sort((a, b) => a - b);
  const countBelow = sorted.filter((value) => value < target).length;
  const countEqual = sorted.filter((value) => value === target).length;
  const n = sorted.length;

  const percentile = ((countBelow + countEqual / 2) / n) * 100;
  return Number(percentile.toFixed(2));
}

/**
 * 1-based rank when sorting values descending (higher value = better).
 */
export function computeRank(values: Array<number | null | undefined>, target: number): number | null {
  const nums = normalizeValues(values);
  if (!nums.length || !Number.isFinite(target)) return null;

  const sortedDesc = nums.slice().sort((a, b) => b - a);
  const rank = sortedDesc.findIndex((value) => value <= target);
  if (rank < 0) return null;
  return rank + 1;
}

/**
 * Build a compact rank summary for a target country against peers.
 */
export function buildPeerSummary(points: NumericPoint[], targetCode: string): PeerRankingSummary | null {
  if (!points.length) return null;

  const found = points.find((point) => point.code?.toUpperCase() === targetCode.toUpperCase());
  if (!found || !Number.isFinite(found.value)) return null;

  const values = points
    .map((point) => point.value)
    .filter((value) => Number.isFinite(value));

  return {
    rank: computeRank(values, found.value) ?? 0,
    total: points.length,
    percentile: computePercentileRank(values, found.value) ?? 0,
    median: computeMedian(values),
    average: computeAverage(values),
  };
}
