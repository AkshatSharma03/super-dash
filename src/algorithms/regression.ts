// ─────────────────────────────────────────────────────────────────────────────
// ORDINARY LEAST SQUARES LINEAR REGRESSION  (library-backed)
// Uses simple-statistics for line fit and R².
// ─────────────────────────────────────────────────────────────────────────────

import {
  linearRegression,
  linearRegressionLine,
  mean,
  rSquared,
} from "simple-statistics";

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
  if (n !== ys.length) {
    throw new Error("x and y series must have the same length");
  }
  if (n < 3) throw new Error("Need at least 3 points for regression");
  if (!xs.every(Number.isFinite) || !ys.every(Number.isFinite)) {
    throw new Error("Regression input contains non-finite values");
  }

  const xBar = mean(xs);
  const Sxx = xs.reduce((acc, x) => {
    const dx = x - xBar;
    return acc + dx * dx;
  }, 0);

  if (Sxx < 1e-12) {
    throw new Error("Regression requires variability in x values");
  }

  const points = xs.map((x, i) => [x, ys[i]] as [number, number]);
  const fitted = linearRegression(points);
  const line = linearRegressionLine(fitted);

  const slope = fitted.m;
  const intercept = fitted.b;
  const r2Raw = rSquared(points, line);
  const r2 = Number.isFinite(r2Raw) ? Math.max(0, Math.min(1, r2Raw)) : 0;

  // Residual standard error: s = sqrt(SSE / (n-2)).
  const sse = xs.reduce((acc, x, i) => {
    const resid = ys[i] - line(x);
    return acc + resid * resid;
  }, 0);
  const s2  = sse / (n - 2);
  const rse = Math.sqrt(s2);

  const predict = (x: number) => line(x);

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
