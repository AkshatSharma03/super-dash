// ─────────────────────────────────────────────────────────────────────────────
// K-MEANS CLUSTERING  (library-backed)
// Uses ml-kmeans with deterministic seeding and k-means++ initialization.
// Features are z-score normalized before clustering so no single dimension
// dominates purely due to scale differences.
// ─────────────────────────────────────────────────────────────────────────────

import { kmeans as runKMeans } from "ml-kmeans";

export interface KMeansResult {
  assignments: number[];   // cluster index per point (0..k-1)
  centroids: number[][];   // final centroids in normalized space
  iterations: number;
  converged: boolean;
  wcss: number;            // within-cluster sum of squares (lower = tighter clusters)
}

export interface LabeledCluster {
  id: number;
  label: string;
  color: string;
  years: number[];
  avgGrowth: number;
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function euclideanSquared(a: number[], b: number[]): number {
  return a.reduce((acc, ai, i) => {
    const d = ai - b[i];
    return acc + d * d;
  }, 0);
}

function zNormalize(data: number[][]): { normalized: number[][]; means: number[]; stds: number[] } {
  const dims = data[0].length;
  const means = Array.from({ length: dims }, (_, j) => {
    const col = data.map(d => d[j]);
    return col.reduce((a, b) => a + b, 0) / col.length;
  });
  const stds = Array.from({ length: dims }, (_, j) => {
    const col = data.map(d => d[j]);
    const m = means[j];
    const variance = col.reduce((acc, v) => acc + (v - m) ** 2, 0) / col.length;
    return Math.sqrt(variance) || 1; // avoid division by zero
  });
  const normalized = data.map(row => row.map((v, j) => (v - means[j]) / stds[j]));
  return { normalized, means, stds };
}

// ── Main K-Means algorithm ────────────────────────────────────────────────────
export function kmeans(
  data: number[][],
  k: number,
  maxIterations = 200,
  seed = 42,
): KMeansResult {
  if (!Number.isInteger(k) || k < 1) {
    throw new Error("k must be a positive integer");
  }
  if (data.length === 0) {
    throw new Error("kmeans requires at least one data point");
  }
  if (k > data.length) {
    throw new Error("k cannot exceed number of data points");
  }
  const dims = data[0].length;
  if (dims === 0) {
    throw new Error("kmeans requires points with at least one feature");
  }
  if (data.some(row => row.length !== dims)) {
    throw new Error("All points must have the same dimensionality");
  }
  if (data.some(row => row.some(v => !Number.isFinite(v)))) {
    throw new Error("kmeans input contains non-finite values");
  }

  const { normalized } = zNormalize(data);
  const result = runKMeans(normalized, k, {
    initialization: "kmeans++",
    maxIterations,
    seed,
    tolerance: 1e-6,
  });

  const assignments = result.clusters;
  const centroids = result.centroids;
  const iterations = Math.max(1, result.iterations);
  const converged = result.converged;

  // WCSS: within-cluster sum of squares
  const wcss = normalized.reduce((acc, point, i) => {
    const centroid = centroids[assignments[i]];
    return acc + euclideanSquared(point, centroid);
  }, 0);

  return { assignments, centroids, iterations, converged, wcss };
}

// ── Semantic labeling ─────────────────────────────────────────────────────────
// After clustering, label each cluster by its average GDP growth rate:
// highest → "Expansion", middle → "Transition", lowest → "Contraction"
export function labelClusters(
  years: number[],
  gdpGrowths: number[],
  assignments: number[],
  k: number,
): LabeledCluster[] {
  const COLORS = ["#10B981", "#F59E0B", "#EF4444", "#8B5CF6"];
  const LABELS = ["Expansion", "Transition", "Contraction", "Recovery"];

  // Compute mean GDP growth per cluster
  const clusterGrowths = Array.from({ length: k }, (_, c) => {
    const idxs = assignments.map((a, i) => a === c ? i : -1).filter(i => i >= 0);
    const avg = idxs.reduce((acc, i) => acc + gdpGrowths[i], 0) / (idxs.length || 1);
    return { c, avg };
  });

  // Sort clusters: highest growth = label index 0, lowest = label index k-1
  const sorted = [...clusterGrowths].sort((a, b) => b.avg - a.avg);
  const rankMap: Record<number, number> = {};
  sorted.forEach((item, rank) => { rankMap[item.c] = rank; });

  return Array.from({ length: k }, (_, c) => {
    const rank = rankMap[c];
    const idxs = assignments.map((a, i) => a === c ? i : -1).filter(i => i >= 0);
    return {
      id: c,
      label: LABELS[rank] ?? `Cluster ${c}`,
      color: COLORS[rank] ?? COLORS[c % COLORS.length],
      years: idxs.map(i => years[i]),
      avgGrowth: +clusterGrowths[c].avg.toFixed(2),
    };
  });
}
