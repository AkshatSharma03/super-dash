import { describe, it, expect } from "vitest";
import { computeHHI, buildHHITimeSeries, buildGenericHHITimeSeries } from "../hhi";

// ── computeHHI ────────────────────────────────────────────────────────────────

describe("computeHHI", () => {
  it("equal duopoly (2 × 50%) → HHI = 5000", () => {
    const r = computeHHI({ A: 50, B: 50 });
    expect(r.hhi).toBe(5000);
  });

  it("4 equal players (25% each) → HHI = 2500", () => {
    const r = computeHHI({ A: 25, B: 25, C: 25, D: 25 });
    expect(r.hhi).toBe(2500);
  });

  it("10 equal players → HHI = 1000 (competitive)", () => {
    const comps = Object.fromEntries(
      Array.from({ length: 10 }, (_, i) => [`P${i}`, 10]),
    );
    expect(computeHHI(comps).hhi).toBe(1000);
    expect(computeHHI(comps).level).toBe("Competitive");
  });

  it("monopoly (one player, others zero) → HHI = 10000", () => {
    const r = computeHHI({ A: 100, B: 0, C: 0 });
    // 100% share → 100² = 10000; zero-share players contribute 0
    expect(r.hhi).toBe(10000);
  });

  it("classifies < 1500 as Competitive", () => {
    const r = computeHHI(
      Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`P${i}`, 10])),
    );
    expect(r.level).toBe("Competitive");
  });

  it("classifies 1500–2500 as Moderate", () => {
    // 5 equal: 5 × 20² = 2000
    const r = computeHHI({ A: 20, B: 20, C: 20, D: 20, E: 20 });
    expect(r.level).toBe("Moderate");
  });

  it("classifies > 2500 as Concentrated", () => {
    // 70% dominant player: 70² + 15² + 15² = 4900 + 225 + 225 = 5350
    const r = computeHHI({ A: 70, B: 15, C: 15 });
    expect(r.level).toBe("Concentrated");
  });

  it("identifies dominant player by name and share", () => {
    const r = computeHHI({ China: 40, Russia: 30, EU: 20, US: 10 });
    expect(r.dominantName).toBe("China");
    expect(r.dominantShare).toBeCloseTo(40, 1);
  });

  it("shares are sorted descending by share", () => {
    const r = computeHHI({ Small: 10, Big: 60, Medium: 30 });
    expect(r.shares[0].name).toBe("Big");
    expect(r.shares[1].name).toBe("Medium");
    expect(r.shares[2].name).toBe("Small");
  });

  it("shares sum to 100%", () => {
    const r = computeHHI({ A: 40, B: 35, C: 25 });
    const total = r.shares.reduce((acc, s) => acc + s.share, 0);
    expect(total).toBeCloseTo(100, 5);
  });

  it("normalizedHHI is between 0 and 1", () => {
    const r = computeHHI({ A: 40, B: 35, C: 25 });
    expect(r.normalizedHHI).toBeGreaterThanOrEqual(0);
    expect(r.normalizedHHI).toBeLessThanOrEqual(1);
  });

  it("normalizedHHI = 1 for a monopoly", () => {
    const r = computeHHI({ A: 100 });
    expect(r.normalizedHHI).toBeCloseTo(1, 5);
  });

  it("normalizedHHI ≈ 0 for many equal players", () => {
    const comps = Object.fromEntries(
      Array.from({ length: 100 }, (_, i) => [`P${i}`, 1]),
    );
    expect(computeHHI(comps).normalizedHHI).toBeCloseTo(0, 1);
  });

  it("handles zero total gracefully (returns HHI = 0, level = Competitive)", () => {
    const r = computeHHI({ A: 0, B: 0 });
    expect(r.hhi).toBe(0);
    expect(r.level).toBe("Competitive");
    expect(r.shares).toHaveLength(0);
  });

  it("contribution equals share²", () => {
    const r = computeHHI({ A: 60, B: 40 });
    r.shares.forEach(s => {
      expect(s.contribution).toBeCloseTo(s.share ** 2, 5);
    });
  });
});

// ── buildHHITimeSeries ────────────────────────────────────────────────────────

describe("buildHHITimeSeries", () => {
  const mockImports = [
    { year: 2020, china: 39, russia: 19, eu: 16, us: 4, turkey: 5, uk: 2, other: 15 },
    { year: 2021, china: 41, russia: 18, eu: 15, us: 4, turkey: 5, uk: 2, other: 15 },
    { year: 2022, china: 43, russia: 17, eu: 14, us: 4, turkey: 5, uk: 2, other: 15 },
  ];
  const mockExports = [
    { year: 2020, oil_gas: 70, metals: 15, chemicals: 5, machinery: 2, agriculture: 5, other: 3 },
    { year: 2021, oil_gas: 72, metals: 13, chemicals: 5, machinery: 2, agriculture: 5, other: 3 },
    { year: 2022, oil_gas: 74, metals: 11, chemicals: 5, machinery: 2, agriculture: 5, other: 3 },
  ];

  it("returns one time-point per input row", () => {
    const series = buildHHITimeSeries(mockImports, mockExports);
    expect(series).toHaveLength(3);
  });

  it("year field matches the imports data", () => {
    const series = buildHHITimeSeries(mockImports, mockExports);
    expect(series.map(s => s.year)).toEqual([2020, 2021, 2022]);
  });

  it("exportLevel is Concentrated due to oil dominance", () => {
    const series = buildHHITimeSeries(mockImports, mockExports);
    series.forEach(p => expect(p.exportLevel).toBe("Concentrated"));
  });

  it("importHHI and exportHHI are strictly positive", () => {
    const series = buildHHITimeSeries(mockImports, mockExports);
    series.forEach(p => {
      expect(p.importHHI).toBeGreaterThan(0);
      expect(p.exportHHI).toBeGreaterThan(0);
    });
  });

  it("importLevel and exportLevel are valid strings", () => {
    const valid = new Set(["Competitive", "Moderate", "Concentrated"]);
    const series = buildHHITimeSeries(mockImports, mockExports);
    series.forEach(p => {
      expect(valid.has(p.importLevel)).toBe(true);
      expect(valid.has(p.exportLevel)).toBe(true);
    });
  });

  it("growing China share increases import HHI over time", () => {
    const series = buildHHITimeSeries(mockImports, mockExports);
    expect(series[2].importHHI).toBeGreaterThanOrEqual(series[0].importHHI);
  });
});

// ── buildGenericHHITimeSeries ─────────────────────────────────────────────────

describe("buildGenericHHITimeSeries", () => {
  const exportSectors = [
    { key: "oil",   label: "Oil & Gas", color: "#F59E0B" },
    { key: "metals",label: "Metals",    color: "#94a3b8" },
    { key: "other", label: "Other",     color: "#64748b" },
  ];
  const importPartners = [
    { key: "china",  label: "China",  color: "#EF4444" },
    { key: "russia", label: "Russia", color: "#F59E0B" },
    { key: "other",  label: "Other",  color: "#64748b" },
  ];

  const exportData = [
    { year: 2020, total: 60, oil: 45, metals: 10, other: 5 },
    { year: 2021, total: 65, oil: 50, metals: 10, other: 5 },
    { year: 2022, total: 70, oil: 55, metals: 10, other: 5 },
  ];
  const importData = [
    { year: 2020, total: 40, china: 18, russia: 12, other: 10 },
    { year: 2021, total: 42, china: 20, russia: 12, other: 10 },
    { year: 2022, total: 45, china: 22, russia: 12, other: 11 },
  ];

  it("returns one point per aligned year", () => {
    const s = buildGenericHHITimeSeries(exportData, importData, exportSectors, importPartners);
    expect(s).toHaveLength(3);
  });

  it("years are in ascending order", () => {
    const s = buildGenericHHITimeSeries(exportData, importData, exportSectors, importPartners);
    expect(s.map(p => p.year)).toEqual([2020, 2021, 2022]);
  });

  it("exportLevel is Concentrated due to oil dominance (>75%)", () => {
    const s = buildGenericHHITimeSeries(exportData, importData, exportSectors, importPartners);
    s.forEach(p => expect(p.exportLevel).toBe("Concentrated"));
  });

  it("importHHI and exportHHI are positive", () => {
    const s = buildGenericHHITimeSeries(exportData, importData, exportSectors, importPartners);
    s.forEach(p => {
      expect(p.importHHI).toBeGreaterThan(0);
      expect(p.exportHHI).toBeGreaterThan(0);
    });
  });

  it("only returns years present in both export and import data", () => {
    const partialExport = exportData.slice(0, 2); // 2020, 2021 only
    const s = buildGenericHHITimeSeries(partialExport, importData, exportSectors, importPartners);
    expect(s.map(p => p.year)).toEqual([2020, 2021]);
  });

  it("growing China share increases import HHI over time", () => {
    const s = buildGenericHHITimeSeries(exportData, importData, exportSectors, importPartners);
    expect(s[2].importHHI).toBeGreaterThanOrEqual(s[0].importHHI);
  });
});
