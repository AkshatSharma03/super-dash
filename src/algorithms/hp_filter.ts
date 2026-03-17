// ─────────────────────────────────────────────────────────────────────────────
// HODRICK-PRESCOTT FILTER  (implemented from scratch)
// Decomposes a time series into a smooth trend τ and a cyclical component c:
//   y_t = τ_t + c_t
//
// Minimisation problem:
//   min_τ  Σ(y_t − τ_t)²  +  λ · Σ[(τ_{t+1} − τ_t) − (τ_t − τ_{t-1})]²
//
// Closed-form solution: (I + λ·D₂ᵀD₂) τ = y
// where D₂ is the (n−2)×n second-difference operator matrix.
//
// For annual data the standard smoothing parameter is λ = 100.
// ─────────────────────────────────────────────────────────────────────────────

export interface HPFilterResult {
  points: Array<{
    year:  number;
    actual: number;
    trend:  number;
    cycle:  number;          // actual − trend (cyclical deviation)
  }>;
  lambda: number;
  avgCycleAmplitude: number; // mean absolute cycle deviation
}

// ── Gaussian elimination with partial pivoting ────────────────────────────────
// Solves A·x = b in-place on the augmented matrix [A|b].
// n is typically small (≤30 years of data) so O(n³) is fast.
function solveLinearSystem(A: number[][], b: number[]): number[] {
  const n = b.length;
  // Build augmented matrix [A | b]
  const M: number[][] = A.map((row, i) => [...row, b[i]]);

  for (let col = 0; col < n; col++) {
    // Partial pivoting: find row with largest absolute value in this column
    let maxRow = col;
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(M[row][col]) > Math.abs(M[maxRow][col])) maxRow = row;
    }
    [M[col], M[maxRow]] = [M[maxRow], M[col]];

    const pivot = M[col][col];
    if (Math.abs(pivot) < 1e-14) continue; // singular / near-singular — skip

    for (let row = col + 1; row < n; row++) {
      const factor = M[row][col] / pivot;
      for (let k = col; k <= n; k++) {
        M[row][k] -= factor * M[col][k];
      }
    }
  }

  // Back-substitution
  const x = new Array<number>(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    x[i] = M[i][n];
    for (let j = i + 1; j < n; j++) x[i] -= M[i][j] * x[j];
    x[i] /= M[i][i];
  }
  return x;
}

// ── Build D₂ᵀD₂ matrix ───────────────────────────────────────────────────────
// The second-difference operator D₂ is (n−2)×n.
// D₂ᵀD₂ is n×n pentadiagonal with closed-form entries:
//   row 0:   [1, −2,  1,  0, ...]
//   row 1:   [−2, 5, −4,  1, ...]
//   row k (2 ≤ k ≤ n-3):  [..., 1, −4, 6, −4, 1, ...]
//   row n-2: [..., 1, −4,  5, −2]
//   row n-1: [..., 1, −2,  1]
function buildD2tD2(n: number): number[][] {
  const M: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));

  for (let k = 0; k < n - 2; k++) {
    // D₂ row k has +1 at k, −2 at k+1, +1 at k+2
    // Contribute outer-product to D₂ᵀD₂
    const entries: [number, number][] = [[k, 1], [k + 1, -2], [k + 2, 1]];
    for (const [i, vi] of entries) {
      for (const [j, vj] of entries) {
        M[i][j] += vi * vj;
      }
    }
  }
  return M;
}

// ── Public API ────────────────────────────────────────────────────────────────

export function hpFilter(
  data: Array<{ year: number; value: number }>,
  lambda = 100,
): HPFilterResult {
  const n = data.length;
  if (n < 4) {
    // Not enough points — return actual as trend, zero cycle
    return {
      points: data.map(d => ({ year: d.year, actual: d.value, trend: d.value, cycle: 0 })),
      lambda,
      avgCycleAmplitude: 0,
    };
  }

  const y = data.map(d => d.value);

  // Build A = I + λ·D₂ᵀD₂
  const D2tD2 = buildD2tD2(n);
  const A: number[][] = D2tD2.map((row, i) =>
    row.map((v, j) => (i === j ? 1 : 0) + lambda * v),
  );

  const trend = solveLinearSystem(A, [...y]);

  let totalCycleAbs = 0;
  const points = data.map((d, i) => {
    const cycle = d.value - trend[i];
    totalCycleAbs += Math.abs(cycle);
    return {
      year:   d.year,
      actual: +d.value.toFixed(2),
      trend:  +trend[i].toFixed(2),
      cycle:  +cycle.toFixed(2),
    };
  });

  return {
    points,
    lambda,
    avgCycleAmplitude: +(totalCycleAbs / n).toFixed(2),
  };
}
