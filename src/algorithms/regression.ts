// ─────────────────────────────────────────────────────────────────────────────
// ORDINARY LEAST SQUARES LINEAR REGRESSION  (implemented from scratch)
// β = (XᵀX)⁻¹Xᵀy   →  scalar form for simple linear regression
// ─────────────────────────────────────────────────────────────────────────────

export interface RegressionModel {
  slope: number;
  intercept: number;
  r2: number;
  rse: number; // residual standard error
  predict: (x: number) => number;
  predictionInterval: (x: number, alpha?: number) => [number, number];
}

export interface ForecastPoint {
  year: number;
  actual: number | null;
  trend: number;
  ciLow: number;
  ciHigh: number;
  isForecast: boolean;
}

export function fitLinearRegression(
  xs: number[],
  ys: number[],
): RegressionModel {
  const n = xs.length;
  if (n < 3) throw new Error("Need at least 3 points for regression");

  // Compute means
  const xBar = xs.reduce((a, b) => a + b, 0) / n;
  const yBar = ys.reduce((a, b) => a + b, 0) / n;

  // Sum of squares
  let Sxx = 0, Sxy = 0, Syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - xBar;
    const dy = ys[i] - yBar;
    Sxx += dx * dx;
    Sxy += dx * dy;
    Syy += dy * dy;
  }

  const slope     = Sxy / Sxx;
  const intercept = yBar - slope * xBar;
  const r2        = Sxx > 0 && Syy > 0 ? (Sxy * Sxy) / (Sxx * Syy) : 0;

  // Residual standard error: s = sqrt(SSE / (n-2))
  let sse = 0;
  for (let i = 0; i < n; i++) {
    const resid = ys[i] - (slope * xs[i] + intercept);
    sse += resid * resid;
  }
  const s2  = sse / (n - 2);
  const rse = Math.sqrt(s2);

  const predict = (x: number) => slope * x + intercept;

  // 95% prediction interval: ŷ ± t * s * sqrt(1 + 1/n + (x - x̄)²/Sxx)
  // Using z ≈ 1.96 for large n; caller can override
  const predictionInterval = (x: number, alpha = 1.96): [number, number] => {
    const yhat = predict(x);
    const se   = rse * Math.sqrt(1 + 1 / n + (x - xBar) ** 2 / Sxx);
    return [yhat - alpha * se, yhat + alpha * se];
  };

  return { slope, intercept, r2, rse, predict, predictionInterval };
}

export function buildForecast(
  data: Array<{ year: number; value: number }>,
  futureYears: number[],
): { points: ForecastPoint[]; model: RegressionModel } {
  const xs = data.map(d => d.year);
  const ys = data.map(d => d.value);
  const model = fitLinearRegression(xs, ys);

  const historical: ForecastPoint[] = data.map(d => {
    const [ciLow, ciHigh] = model.predictionInterval(d.year);
    return {
      year: d.year,
      actual: +d.value.toFixed(1),
      trend: +model.predict(d.year).toFixed(1),
      ciLow: +ciLow.toFixed(1),
      ciHigh: +ciHigh.toFixed(1),
      isForecast: false,
    };
  });

  const forecast: ForecastPoint[] = futureYears.map(y => {
    const [ciLow, ciHigh] = model.predictionInterval(y);
    return {
      year: y,
      actual: null,
      trend: +model.predict(y).toFixed(1),
      ciLow: +ciLow.toFixed(1),
      ciHigh: +ciHigh.toFixed(1),
      isForecast: true,
    };
  });

  return { points: [...historical, ...forecast], model };
}
