// ─────────────────────────────────────────────────────────────────────────────
// K-MEANS CLUSTERING  (implemented from scratch with K-Means++ initialization)
// Features are z-score normalized before clustering so no single dimension
// dominates purely due to scale differences.
// ─────────────────────────────────────────────────────────────────────────────

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

function euclidean(a: number[], b: number[]): number {
  return Math.sqrt(a.reduce((acc, ai, i) => acc + (ai - b[i]) ** 2, 0));
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

// Seeded LCG for reproducible initialization across runs
function makeLCG(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(1664525, s) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

// ── K-Means++ initialization ──────────────────────────────────────────────────
function kmeanspp(data: number[][], k: number, rand: () => number): number[][] {
  const n = data.length;
  const centroids: number[][] = [data[Math.floor(rand() * n)]];

  while (centroids.length < k) {
    // D²-weighted probability: probability ∝ dist² to nearest centroid
    const dists = data.map(p => {
      const nearest = centroids.reduce(
        (best, c) => Math.min(best, euclidean(p, c)),
        Infinity,
      );
      return nearest * nearest;
    });
    const total = dists.reduce((a, b) => a + b, 0);
    let r = rand() * total;
    for (let i = 0; i < n; i++) {
      r -= dists[i];
      if (r <= 0) { centroids.push(data[i]); break; }
    }
  }
  return centroids;
}

// ── Main K-Means algorithm ────────────────────────────────────────────────────
export function kmeans(
  data: number[][],
  k: number,
  maxIterations = 200,
  seed = 42,
): KMeansResult {
  const { normalized } = zNormalize(data);
  const n = normalized.length;
  const rand = makeLCG(seed);

  let centroids = kmeanspp(normalized, k, rand);
  let assignments = new Array<number>(n).fill(0);
  let iterations = 0;
  let converged = false;

  for (iterations = 0; iterations < maxIterations; iterations++) {
    // Assignment step: assign each point to nearest centroid
    const newAssignments = normalized.map(p =>
      centroids.reduce(
        (bestIdx, c, ci) =>
          euclidean(p, c) < euclidean(p, centroids[bestIdx]) ? ci : bestIdx,
        0,
      ),
    );

    converged = newAssignments.every((a, i) => a === assignments[i]);
    assignments = newAssignments;
    if (converged) break;

    // Update step: recompute centroids as mean of assigned points
    const dims = centroids[0].length;
    for (let c = 0; c < k; c++) {
      const members = normalized.filter((_, i) => assignments[i] === c);
      if (members.length === 0) continue; // empty cluster — keep old centroid
      centroids[c] = Array.from({ length: dims }, (_, j) =>
        members.reduce((acc, p) => acc + p[j], 0) / members.length,
      );
    }
  }

  // WCSS: within-cluster sum of squares
  const wcss = normalized.reduce((acc, p, i) =>
    acc + euclidean(p, centroids[assignments[i]]) ** 2, 0);

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
