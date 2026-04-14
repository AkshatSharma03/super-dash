import { describe, it, expect } from "vitest";
import { fitLinearRegression, buildForecast } from "../regression";

// ── fitLinearRegression ───────────────────────────────────────────────────────

describe("fitLinearRegression", () => {
  it("fits a perfect line (y = 2x + 1) with R² = 1 and RSE = 0", () => {
    const xs = [1, 2, 3, 4, 5];
    const ys = [3, 5, 7, 9, 11]; // y = 2x + 1
    const m = fitLinearRegression(xs, ys);
    expect(m.slope).toBeCloseTo(2, 8);
    expect(m.intercept).toBeCloseTo(1, 8);
    expect(m.r2).toBeCloseTo(1, 8);
    expect(m.rse).toBeCloseTo(0, 8);
  });

  it("predict returns slope × x + intercept", () => {
    const m = fitLinearRegression([0, 1, 2, 3], [1, 2, 3, 4]);
    expect(m.predict(10)).toBeCloseTo(11);
    expect(m.predict(0)).toBeCloseTo(1);
    expect(m.predict(-5)).toBeCloseTo(-4);
  });

  it("throws when fewer than 3 points are supplied", () => {
    expect(() => fitLinearRegression([1, 2], [1, 2])).toThrow(
      /at least 3 points/i,
    );
  });

  it("throws on mismatched series lengths", () => {
    expect(() => fitLinearRegression([1, 2, 3], [2, 4])).toThrow(/same length/i);
  });

  it("throws when x has zero variance", () => {
    expect(() => fitLinearRegression([1, 1, 1], [2, 3, 4])).toThrow(/variability in x/i);
  });

  it("R² is between 0 and 1 for noisy data", () => {
    const xs = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const ys = [2.1, 3.9, 6.2, 7.8, 10.1, 12.3, 13.9, 16.2, 18.1, 19.8];
    const m = fitLinearRegression(xs, ys);
    expect(m.r2).toBeGreaterThan(0);
    expect(m.r2).toBeLessThanOrEqual(1);
  });

  it("R² is very high for near-linear data", () => {
    const xs = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const ys = [2.1, 3.9, 6.2, 7.8, 10.1, 12.3, 13.9, 16.2, 18.1, 19.8];
    expect(fitLinearRegression(xs, ys).r2).toBeGreaterThan(0.99);
  });

  it("RSE is positive for noisy data", () => {
    const m = fitLinearRegression(
      [1, 2, 3, 4, 5],
      [1.1, 2.9, 2.8, 4.2, 5.0],
    );
    expect(m.rse).toBeGreaterThan(0);
  });

  it("predictionInterval is symmetric about predict(x)", () => {
    const m = fitLinearRegression([1, 2, 3, 4, 5], [2, 4, 5, 4, 5]);
    const [lo, hi] = m.predictionInterval(3);
    const mid = (lo + hi) / 2;
    expect(mid).toBeCloseTo(m.predict(3), 5);
  });

  it("prediction interval widens as x moves away from mean", () => {
    const xs = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const ys = [2.1, 3.9, 6.2, 7.8, 10.1, 12.3, 13.9, 16.2, 18.1, 19.8];
    const m = fitLinearRegression(xs, ys);
    const widthNear = m.predictionInterval(5.5)[1] - m.predictionInterval(5.5)[0];
    const widthFar  = m.predictionInterval(30)[1]  - m.predictionInterval(30)[0];
    expect(widthFar).toBeGreaterThan(widthNear);
  });

  it("slope matches the known trend in year-indexed GDP-like data", () => {
    // GDP growing by ~$10B/yr from 2010–2024
    const years = Array.from({ length: 15 }, (_, i) => 2010 + i);
    const gdp   = years.map(y => (y - 2010) * 10 + 100);
    const m = fitLinearRegression(years, gdp);
    expect(m.slope).toBeCloseTo(10, 3);
  });
});

// ── buildForecast ─────────────────────────────────────────────────────────────

describe("buildForecast", () => {
  const historicalData = [1, 2, 3, 4, 5].map(i => ({
    year: 2015 + i,
    value: i * 10.0,
  })); // 5 historical points

  it("total points = historical + future years", () => {
    const { points } = buildForecast(historicalData, [2021, 2022, 2023]);
    expect(points).toHaveLength(8);
  });

  it("historical points carry non-null actual values", () => {
    const { points } = buildForecast(historicalData, [2021]);
    points.slice(0, 5).forEach(p => expect(p.actual).not.toBeNull());
  });

  it("forecast points have null actual values", () => {
    const { points } = buildForecast(historicalData, [2021, 2022]);
    points.slice(5).forEach(p => expect(p.actual).toBeNull());
  });

  it("isForecast flag is set correctly", () => {
    const { points } = buildForecast(historicalData, [2021, 2022]);
    expect(points.filter(p => p.isForecast)).toHaveLength(2);
    expect(points.filter(p => !p.isForecast)).toHaveLength(5);
  });

  it("returns a valid RegressionModel", () => {
    const { model } = buildForecast(historicalData, [2021]);
    expect(model).toHaveProperty("slope");
    expect(model).toHaveProperty("intercept");
    expect(model).toHaveProperty("r2");
    expect(model).toHaveProperty("rse");
    expect(typeof model.predict).toBe("function");
  });

  it("R² ≈ 1 for perfectly linear historical data", () => {
    const { model } = buildForecast(historicalData, [2021]);
    expect(model.r2).toBeCloseTo(1, 3);
  });

  it("forecast trend continues beyond last historical point", () => {
    const { points } = buildForecast(historicalData, [2021]);
    const lastTrend = points[4].trend;
    const forecastTrend = points[5].trend;
    expect(forecastTrend).toBeGreaterThan(lastTrend);
  });

  it("years in output match input years + future years in order", () => {
    const { points } = buildForecast(historicalData, [2021, 2022]);
    const years = points.map(p => p.year);
    expect(years).toEqual([2016, 2017, 2018, 2019, 2020, 2021, 2022]);
  });

  it("CI band: ciHigh > ciLow for every point", () => {
    const { points } = buildForecast(historicalData, [2021]);
    points.forEach(p => expect(p.ciHigh).toBeGreaterThanOrEqual(p.ciLow));
  });
});
