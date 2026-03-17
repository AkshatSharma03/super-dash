import { describe, it, expect } from "vitest";
import { hpFilter } from "../hp_filter";

// Synthetic GDP series: linear trend 100, 110, 120 ... with noise injected
const linearTrend = Array.from({ length: 15 }, (_, i) => ({
  year:  2010 + i,
  value: 100 + i * 10,
}));

// Series with a pronounced mid-period boom then crash
const boomBust = [
  { year: 2010, value: 100 },
  { year: 2011, value: 105 },
  { year: 2012, value: 112 },
  { year: 2013, value: 150 }, // boom
  { year: 2014, value: 155 },
  { year: 2015, value: 145 },
  { year: 2016, value: 110 }, // bust
  { year: 2017, value: 108 },
  { year: 2018, value: 115 },
  { year: 2019, value: 120 },
];

describe("hpFilter", () => {
  it("returns one point per input data point", () => {
    const r = hpFilter(linearTrend);
    expect(r.points).toHaveLength(linearTrend.length);
  });

  it("each point has year, actual, trend, and cycle fields", () => {
    const r = hpFilter(linearTrend);
    r.points.forEach(p => {
      expect(typeof p.year).toBe("number");
      expect(typeof p.actual).toBe("number");
      expect(typeof p.trend).toBe("number");
      expect(typeof p.cycle).toBe("number");
    });
  });

  it("cycle = actual − trend for every point", () => {
    const r = hpFilter(linearTrend);
    r.points.forEach(p => {
      expect(p.cycle).toBeCloseTo(p.actual - p.trend, 1);
    });
  });

  it("returns the lambda used", () => {
    expect(hpFilter(linearTrend, 100).lambda).toBe(100);
    expect(hpFilter(linearTrend, 6.25).lambda).toBe(6.25);
  });

  it("avgCycleAmplitude is a non-negative number", () => {
    const r = hpFilter(linearTrend);
    expect(r.avgCycleAmplitude).toBeGreaterThanOrEqual(0);
    expect(typeof r.avgCycleAmplitude).toBe("number");
  });

  it("trend for a perfect linear series closely follows the series", () => {
    const r = hpFilter(linearTrend, 100);
    r.points.forEach(p => {
      expect(Math.abs(p.trend - p.actual)).toBeLessThan(5);
    });
  });

  it("trend is smoother than actual: variance(trend) ≤ variance(actual)", () => {
    const r = hpFilter(boomBust, 100);
    const mean = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;
    const variance = (arr: number[]) => {
      const m = mean(arr);
      return arr.reduce((a, b) => a + (b - m) ** 2, 0) / arr.length;
    };
    const varActual = variance(r.points.map(p => p.actual));
    const varTrend  = variance(r.points.map(p => p.trend));
    expect(varTrend).toBeLessThanOrEqual(varActual);
  });

  it("cycle is positive at the boom peak (above-trend expansion)", () => {
    const r = hpFilter(boomBust, 100);
    const boom = r.points.find(p => p.year === 2013 || p.year === 2014)!;
    expect(boom.cycle).toBeGreaterThan(0);
  });

  it("cycle is negative after the bust (below-trend contraction)", () => {
    const r = hpFilter(boomBust, 100);
    const bust = r.points.find(p => p.year === 2016)!;
    expect(bust.cycle).toBeLessThan(0);
  });

  it("higher lambda produces a smoother (less variable) trend", () => {
    const rLow  = hpFilter(boomBust, 10);
    const rHigh = hpFilter(boomBust, 10_000);
    const variance = (arr: number[]) => {
      const m = arr.reduce((a, b) => a + b, 0) / arr.length;
      return arr.reduce((a, b) => a + (b - m) ** 2, 0);
    };
    const varLow  = variance(rLow.points.map(p => p.trend));
    const varHigh = variance(rHigh.points.map(p => p.trend));
    expect(varHigh).toBeLessThan(varLow);
  });

  it("short series (< 4 points) returns actual = trend and cycle = 0", () => {
    const short = [
      { year: 2020, value: 100 },
      { year: 2021, value: 110 },
      { year: 2022, value: 120 },
    ];
    const r = hpFilter(short);
    r.points.forEach(p => {
      expect(p.trend).toBe(p.actual);
      expect(p.cycle).toBe(0);
    });
  });

  it("preserves year ordering from input", () => {
    const r = hpFilter(linearTrend);
    const years = r.points.map(p => p.year);
    expect(years).toEqual(linearTrend.map(d => d.year));
  });

  it("avgCycleAmplitude is 0 for the short-series fallback", () => {
    const short = [{ year: 2020, value: 50 }, { year: 2021, value: 50 }, { year: 2022, value: 50 }];
    expect(hpFilter(short).avgCycleAmplitude).toBe(0);
  });
});
