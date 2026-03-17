import { describe, it, expect } from "vitest";
import { computeCAGR, buildCAGRSeries } from "../cagr";

// ── computeCAGR ───────────────────────────────────────────────────────────────

describe("computeCAGR", () => {
  it("doubling over 10 years ≈ +7.18% CAGR", () => {
    const r = computeCAGR(100, 200, 10);
    expect(r).not.toBeNull();
    expect(r!).toBeCloseTo(7.18, 1);
  });

  it("same value over any period → CAGR = 0%", () => {
    expect(computeCAGR(100, 100, 5)).toBeCloseTo(0, 5);
  });

  it("halving over 10 years ≈ −6.7% CAGR", () => {
    const r = computeCAGR(200, 100, 10);
    expect(r).not.toBeNull();
    expect(r!).toBeLessThan(0);
    expect(r!).toBeCloseTo(-6.7, 1);
  });

  it("returns null when start value is 0", () => {
    expect(computeCAGR(0, 100, 5)).toBeNull();
  });

  it("returns null when end value is 0", () => {
    expect(computeCAGR(100, 0, 5)).toBeNull();
  });

  it("returns null when years is 0", () => {
    expect(computeCAGR(100, 200, 0)).toBeNull();
  });

  it("returns null for negative start value", () => {
    expect(computeCAGR(-50, 100, 5)).toBeNull();
  });

  it("result is rounded to 2 decimal places", () => {
    const r = computeCAGR(100, 150, 3)!;
    const str = String(r);
    const decimals = str.includes(".") ? str.split(".")[1].length : 0;
    expect(decimals).toBeLessThanOrEqual(2);
  });

  it("CAGR is positive when end > start", () => {
    expect(computeCAGR(100, 200, 5)!).toBeGreaterThan(0);
  });

  it("CAGR is negative when end < start", () => {
    expect(computeCAGR(200, 100, 5)!).toBeLessThan(0);
  });
});

// ── buildCAGRSeries ───────────────────────────────────────────────────────────

// Synthetic 15-year dataset with steady 5% annual growth
const baseYear = 2010;
const GDP_DATA = Array.from({ length: 15 }, (_, i) => ({
  year:           baseYear + i,
  gdp_bn:         +(100 * 1.05 ** i).toFixed(2),
  gdp_per_capita: +(5000 * 1.04 ** i).toFixed(0),
  gdp_growth:     5,
}));

const EXPORT_DATA = Array.from({ length: 15 }, (_, i) => ({
  year:  baseYear + i,
  total: +(50 * 1.06 ** i).toFixed(2),
}));

const IMPORT_DATA = Array.from({ length: 15 }, (_, i) => ({
  year:  baseYear + i,
  total: +(40 * 1.04 ** i).toFixed(2),
}));

describe("buildCAGRSeries", () => {
  const result = buildCAGRSeries(GDP_DATA, EXPORT_DATA, IMPORT_DATA);

  it("returns a periods array", () => {
    expect(Array.isArray(result.periods)).toBe(true);
    expect(result.periods.length).toBeGreaterThan(0);
  });

  it("returns a fullPeriod entry", () => {
    expect(result.fullPeriod).toBeDefined();
    expect(result.fullPeriod.startYear).toBe(2010);
    expect(result.fullPeriod.endYear).toBe(2024);
  });

  it("fullPeriod GDP CAGR ≈ 5% for steady 5% annual growth", () => {
    expect(result.fullPeriod.gdp).not.toBeNull();
    expect(result.fullPeriod.gdp!).toBeCloseTo(5, 0);
  });

  it("fullPeriod exports CAGR ≈ 6% for steady 6% annual growth", () => {
    expect(result.fullPeriod.exports).not.toBeNull();
    expect(result.fullPeriod.exports!).toBeCloseTo(6, 0);
  });

  it("each period entry has label, startYear, endYear, years fields", () => {
    result.periods.forEach(p => {
      expect(typeof p.label).toBe("string");
      expect(typeof p.startYear).toBe("number");
      expect(typeof p.endYear).toBe("number");
      expect(typeof p.years).toBe("number");
      expect(p.years).toBeGreaterThan(0);
    });
  });

  it("period years = endYear − startYear", () => {
    result.periods.forEach(p => {
      expect(p.years).toBe(p.endYear - p.startYear);
    });
  });

  it("all CAGR values are positive for a growing series", () => {
    result.periods.forEach(p => {
      if (p.gdp !== null)     expect(p.gdp).toBeGreaterThan(0);
      if (p.exports !== null) expect(p.exports).toBeGreaterThan(0);
      if (p.imports !== null) expect(p.imports).toBeGreaterThan(0);
    });
  });

  it("fastestGDPPeriod and slowestGDPPeriod are non-empty strings", () => {
    expect(typeof result.fastestGDPPeriod).toBe("string");
    expect(result.fastestGDPPeriod.length).toBeGreaterThan(0);
    expect(typeof result.slowestGDPPeriod).toBe("string");
    expect(result.slowestGDPPeriod.length).toBeGreaterThan(0);
  });

  it("first period starts at 2010", () => {
    expect(result.periods[0].startYear).toBe(2010);
  });

  it("label matches startYear–endYear pattern", () => {
    result.periods.forEach(p => {
      expect(p.label).toBe(`${p.startYear}–${p.endYear}`);
    });
  });
});
