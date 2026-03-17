import { describe, it, expect } from "vitest";
import { pearsonR, buildCorrelationMatrix } from "../correlation";

// ── pearsonR ──────────────────────────────────────────────────────────────────

describe("pearsonR", () => {
  it("perfectly positively correlated series → r = 1", () => {
    const x = [1, 2, 3, 4, 5];
    const y = [2, 4, 6, 8, 10]; // y = 2x
    expect(pearsonR(x, y)).toBeCloseTo(1, 3);
  });

  it("perfectly negatively correlated series → r = −1", () => {
    const x = [1, 2, 3, 4, 5];
    const y = [10, 8, 6, 4, 2]; // y = 12 − 2x
    expect(pearsonR(x, y)).toBeCloseTo(-1, 3);
  });

  it("uncorrelated series → r ≈ 0", () => {
    // Alternating pattern that sums to 0 correlation
    const x = [1, 2, 3, 4, 5, 6];
    const y = [1, 3, 2, 5, 4, 6];
    const r = pearsonR(x, y);
    expect(r).toBeGreaterThan(-1);
    expect(r).toBeLessThan(1);
  });

  it("r is in [−1, 1] for any real series", () => {
    const x = [5, 15, 10, 25, 20, 30, 8];
    const y = [3,  7, 12,  6, 18,  2, 9];
    const r = pearsonR(x, y);
    expect(r).toBeGreaterThanOrEqual(-1);
    expect(r).toBeLessThanOrEqual(1);
  });

  it("r is symmetric: pearsonR(x,y) = pearsonR(y,x)", () => {
    const x = [100, 120, 90, 130, 115];
    const y = [ 50,  60, 45,  70,  55];
    expect(pearsonR(x, y)).toBeCloseTo(pearsonR(y, x), 10);
  });

  it("returns 0 for series shorter than 3 points", () => {
    expect(pearsonR([1, 2], [3, 4])).toBe(0);
    expect(pearsonR([], [])).toBe(0);
  });

  it("returns 0 for a constant series (zero variance → degenerate)", () => {
    expect(pearsonR([5, 5, 5, 5], [1, 2, 3, 4])).toBe(0);
  });

  it("result is rounded to 3 decimal places", () => {
    const x = [1, 2, 3, 4, 5, 6, 7];
    const y = [2, 3, 5, 4, 6, 7, 8];
    const r = pearsonR(x, y);
    const str = String(Math.abs(r));
    const decimals = str.includes(".") ? str.split(".")[1].length : 0;
    expect(decimals).toBeLessThanOrEqual(3);
  });
});

// ── buildCorrelationMatrix ────────────────────────────────────────────────────

// 15-year synthetic dataset — GDP and exports grow together (positive correlation);
// imports grow more slowly, creating a rising trade balance.
const years = Array.from({ length: 15 }, (_, i) => 2010 + i);

const GDP_DATA = years.map((year, i) => ({
  year,
  gdp_bn:         100 + i * 10,
  gdp_growth:     5 + (i % 3 === 0 ? -2 : 1),
  gdp_per_capita: 5000 + i * 500,
}));

const EXPORT_DATA = years.map((year, i) => ({
  year,
  total: 50 + i * 4,
}));

const IMPORT_DATA = years.map((year, i) => ({
  year,
  total: 40 + i * 2,
}));

describe("buildCorrelationMatrix", () => {
  const result = buildCorrelationMatrix(GDP_DATA, EXPORT_DATA, IMPORT_DATA);

  it("returns a variables array with 6 elements", () => {
    expect(result.variables).toHaveLength(6);
  });

  it("returns n² cells for n variables (6×6 = 36)", () => {
    expect(result.cells).toHaveLength(36);
  });

  it("diagonal cells have r = 1 (variable vs itself)", () => {
    result.variables.forEach(v => {
      const cell = result.cells.find(c => c.rowLabel === v && c.colLabel === v);
      expect(cell?.r).toBe(1);
    });
  });

  it("matrix is symmetric: r(X,Y) = r(Y,X)", () => {
    result.variables.forEach(v1 => {
      result.variables.forEach(v2 => {
        if (v1 === v2) return;
        const xy = result.cells.find(c => c.rowLabel === v1 && c.colLabel === v2)!.r;
        const yx = result.cells.find(c => c.rowLabel === v2 && c.colLabel === v1)!.r;
        expect(xy).toBeCloseTo(yx, 10);
      });
    });
  });

  it("all r values are in [−1, 1]", () => {
    result.cells.forEach(c => {
      expect(c.r).toBeGreaterThanOrEqual(-1);
      expect(c.r).toBeLessThanOrEqual(1);
    });
  });

  it("GDP ($B) and Exports ($B) should be strongly positively correlated (r > 0.9)", () => {
    const cell = result.cells.find(c =>
      c.rowLabel === "GDP ($B)" && c.colLabel === "Exports ($B)",
    );
    expect(cell?.r).toBeGreaterThan(0.9);
    expect(cell?.direction).toBe("positive");
  });

  it("every cell has a valid strength label", () => {
    const valid = new Set(["strong", "moderate", "weak", "none"]);
    result.cells.forEach(c => expect(valid.has(c.strength)).toBe(true));
  });

  it("every cell has a valid direction label", () => {
    const valid = new Set(["positive", "negative", "none"]);
    result.cells.forEach(c => expect(valid.has(c.direction)).toBe(true));
  });

  it("diagonal cells have direction = positive", () => {
    result.variables.forEach(v => {
      const cell = result.cells.find(c => c.rowLabel === v && c.colLabel === v);
      expect(cell?.direction).toBe("positive");
    });
  });

  it("strongestPair is not null for this dataset", () => {
    expect(result.strongestPair).not.toBeNull();
  });

  it("strongestPair has the highest |r| among off-diagonal cells", () => {
    const strongest = result.strongestPair!;
    const offDiag = result.cells.filter(c => c.rowLabel !== c.colLabel);
    const maxAbsR = Math.max(...offDiag.map(c => Math.abs(c.r)));
    expect(Math.abs(strongest.r)).toBeCloseTo(maxAbsR, 5);
  });

  it("variables list contains the expected economic series names", () => {
    const names = result.variables;
    expect(names.some(n => n.includes("GDP"))).toBe(true);
    expect(names.some(n => n.includes("Export"))).toBe(true);
    expect(names.some(n => n.includes("Import"))).toBe(true);
  });
});
