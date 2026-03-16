import { describe, it, expect } from "vitest";
import { detectAnomalies, detectAllAnomalies } from "../anomaly";

// ── detectAnomalies ───────────────────────────────────────────────────────────

describe("detectAnomalies", () => {
  // A series where 2014 is an extreme high outlier
  const seriesHighOutlier = [
    { year: 2010, value: 5 },
    { year: 2011, value: 5.5 },
    { year: 2012, value: 4.8 },
    { year: 2013, value: 5.2 },
    { year: 2014, value: 100 }, // massive spike
    { year: 2015, value: 5.1 },
  ];

  // A series where 2014 is an extreme low outlier
  const seriesLowOutlier = [
    { year: 2010, value: 50 },
    { year: 2011, value: 52 },
    { year: 2012, value: 51 },
    { year: 2013, value: 49 },
    { year: 2014, value: -100 }, // crash
    { year: 2015, value: 50 },
  ];

  it("detects the obvious high outlier in seriesHighOutlier", () => {
    const result = detectAnomalies(seriesHighOutlier, "Test", 1.5);
    expect(result.length).toBeGreaterThan(0);
    expect(result[0].year).toBe(2014);
  });

  it("direction is 'high' for a positive spike", () => {
    const result = detectAnomalies(seriesHighOutlier, "Test", 1.5);
    expect(result[0].direction).toBe("high");
  });

  it("direction is 'low' for a negative crash", () => {
    const result = detectAnomalies(seriesLowOutlier, "Test", 1.5);
    const crashResult = result.find(r => r.year === 2014);
    expect(crashResult?.direction).toBe("low");
  });

  it("returns empty array when std = 0 (uniform series)", () => {
    const uniform = Array.from({ length: 6 }, (_, i) => ({ year: 2010 + i, value: 42 }));
    expect(detectAnomalies(uniform, "Flat")).toHaveLength(0);
  });

  it("results are sorted by |zScore| descending", () => {
    const result = detectAnomalies(seriesHighOutlier, "Test", 1.0);
    for (let i = 1; i < result.length; i++) {
      expect(Math.abs(result[i - 1].zScore)).toBeGreaterThanOrEqual(
        Math.abs(result[i].zScore),
      );
    }
  });

  it("nothing detected with an impossibly high threshold", () => {
    expect(detectAnomalies(seriesHighOutlier, "Test", 999)).toHaveLength(0);
  });

  it("lowers threshold → detects more points", () => {
    const loose  = detectAnomalies(seriesHighOutlier, "T", 0.5);
    const strict = detectAnomalies(seriesHighOutlier, "T", 1.5);
    expect(loose.length).toBeGreaterThanOrEqual(strict.length);
  });

  it("severity is 'extreme' when |z| ≥ 2.5", () => {
    const result = detectAnomalies(seriesHighOutlier, "Test", 1.5);
    const extreme = result.filter(r => Math.abs(r.zScore) >= 2.5);
    extreme.forEach(r => expect(r.severity).toBe("extreme"));
  });

  it("severity is 'strong' when 1.9 ≤ |z| < 2.5", () => {
    const result = detectAnomalies(seriesHighOutlier, "Test", 1.0);
    const strong = result.filter(
      r => Math.abs(r.zScore) >= 1.9 && Math.abs(r.zScore) < 2.5,
    );
    strong.forEach(r => expect(r.severity).toBe("strong"));
  });

  it("severity is 'moderate' when threshold ≤ |z| < 1.9", () => {
    const result = detectAnomalies(seriesHighOutlier, "Test", 1.0);
    const moderate = result.filter(
      r => Math.abs(r.zScore) >= 1.0 && Math.abs(r.zScore) < 1.9,
    );
    moderate.forEach(r => expect(r.severity).toBe("moderate"));
  });

  it("annotation for high outlier contains 'above average'", () => {
    const result = detectAnomalies(seriesHighOutlier, "Test", 1.5);
    const high = result.find(r => r.direction === "high");
    expect(high?.annotation).toContain("above average");
  });

  it("annotation for low outlier contains 'below average'", () => {
    const result = detectAnomalies(seriesLowOutlier, "Test", 1.5);
    const low = result.find(r => r.direction === "low");
    expect(low?.annotation).toContain("below average");
  });

  it("metric name is preserved on every returned point", () => {
    const result = detectAnomalies(seriesHighOutlier, "GDP Growth (%)", 1.5);
    result.forEach(r => expect(r.metric).toBe("GDP Growth (%)"));
  });

  it("result points include mean and std fields", () => {
    const result = detectAnomalies(seriesHighOutlier, "Test", 1.5);
    result.forEach(r => {
      expect(typeof r.mean).toBe("number");
      expect(typeof r.std).toBe("number");
      expect(r.std).toBeGreaterThan(0);
    });
  });

  it("zScore sign matches direction", () => {
    const result = detectAnomalies(seriesHighOutlier, "T", 1.0);
    result.forEach(r => {
      if (r.direction === "high") expect(r.zScore).toBeGreaterThan(0);
      else expect(r.zScore).toBeLessThan(0);
    });
  });
});

// ── detectAllAnomalies ────────────────────────────────────────────────────────

describe("detectAllAnomalies", () => {
  // Build synthetic multi-metric input with known spikes
  const years = Array.from({ length: 12 }, (_, i) => 2010 + i);

  const mockInput = {
    gdpData: years.map((year, i) => ({
      year,
      gdp_bn:        100 + i * 8  + (i === 6 ? 200 : 0), // large spike at 2016
      gdp_growth:    5   + (i === 4 ? -10 : 0),           // crash at 2014
      gdp_per_capita: 5000 + i * 200,
    })),
    exportsData: years.map((year, i) => ({
      year,
      total: 50 + i * 3,
    })),
    importsData: years.map((year, i) => ({
      year,
      total: 40 + i * 2,
    })),
    tradeData: years.map((year, i) => ({
      year,
      balance: 10 + i,
    })),
  };

  it("returns an array", () => {
    expect(Array.isArray(detectAllAnomalies(mockInput))).toBe(true);
  });

  it("no duplicate year+metric pairs", () => {
    const result = detectAllAnomalies(mockInput);
    const keys = result.map(r => `${r.year}:${r.metric}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("results are sorted by |zScore| descending", () => {
    const result = detectAllAnomalies(mockInput);
    for (let i = 1; i < result.length; i++) {
      expect(Math.abs(result[i - 1].zScore)).toBeGreaterThanOrEqual(
        Math.abs(result[i].zScore),
      );
    }
  });

  it("detects the GDP growth crash at 2014", () => {
    const result = detectAllAnomalies(mockInput);
    const crash = result.find(
      r => r.metric === "GDP Growth (%)" && r.year === 2014,
    );
    expect(crash).toBeDefined();
    expect(crash?.direction).toBe("low");
  });

  it("detects the nominal GDP spike at 2016", () => {
    const result = detectAllAnomalies(mockInput);
    const spike = result.find(
      r => r.metric === "Nominal GDP ($B)" && r.year === 2016,
    );
    expect(spike).toBeDefined();
    expect(spike?.direction).toBe("high");
  });

  it("all returned points have valid severity values", () => {
    const valid = new Set(["moderate", "strong", "extreme"]);
    detectAllAnomalies(mockInput).forEach(r =>
      expect(valid.has(r.severity)).toBe(true),
    );
  });
});
