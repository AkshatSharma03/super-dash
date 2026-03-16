import { describe, it, expect } from "vitest";
import { kmeans, labelClusters } from "../kmeans";

// ── kmeans ────────────────────────────────────────────────────────────────────

describe("kmeans", () => {
  // Two well-separated clusters in 2D
  const clusterA = [[0, 0], [0.1, 0.1], [-0.1, 0.1], [0, 0.2]];
  const clusterB = [[10, 10], [10.1, 9.9], [9.9, 10.1], [10, 10.2]];
  const separated = [...clusterA, ...clusterB];

  it("assigns 2 clear groups to distinct clusters", () => {
    const r = kmeans(separated, 2);
    const labelA = r.assignments[0];
    const labelB = r.assignments[4];
    expect(labelA).not.toBe(labelB);
    // All points within each group share the same label
    clusterA.forEach((_, i) => expect(r.assignments[i]).toBe(labelA));
    clusterB.forEach((_, i) => expect(r.assignments[4 + i]).toBe(labelB));
  });

  it("returns exactly k centroids", () => {
    expect(kmeans(separated, 2).centroids).toHaveLength(2);
    expect(kmeans(separated, 3).centroids).toHaveLength(3);
  });

  it("assignments array has same length as input data", () => {
    const r = kmeans(separated, 2);
    expect(r.assignments).toHaveLength(separated.length);
  });

  it("all assignments are valid cluster indices [0, k)", () => {
    const k = 2;
    const r = kmeans(separated, k);
    r.assignments.forEach(a => {
      expect(a).toBeGreaterThanOrEqual(0);
      expect(a).toBeLessThan(k);
    });
  });

  it("WCSS is non-negative", () => {
    expect(kmeans(separated, 2).wcss).toBeGreaterThanOrEqual(0);
  });

  it("WCSS decreases as k increases (with enough data)", () => {
    // More clusters = tighter fit
    const w1 = kmeans(separated, 1).wcss;
    const w2 = kmeans(separated, 2).wcss;
    expect(w2).toBeLessThan(w1);
  });

  it("is deterministic for the same seed", () => {
    const r1 = kmeans(separated, 2, 200, 42);
    const r2 = kmeans(separated, 2, 200, 42);
    expect(r1.assignments).toEqual(r2.assignments);
    expect(r1.wcss).toBeCloseTo(r2.wcss, 10);
  });

  it("k=1 assigns every point to cluster 0", () => {
    const r = kmeans(separated, 1);
    expect(r.assignments.every(a => a === 0)).toBe(true);
    expect(r.centroids).toHaveLength(1);
  });

  it("converges for well-separated data", () => {
    const r = kmeans(separated, 2);
    expect(r.converged).toBe(true);
    expect(r.iterations).toBeLessThan(50);
  });

  it("iterations is positive", () => {
    expect(kmeans(separated, 2).iterations).toBeGreaterThan(0);
  });

  it("centroids have same dimensionality as input points", () => {
    const data3D = [[1, 2, 3], [4, 5, 6], [7, 8, 9], [10, 11, 12],
                    [0, 0, 0], [1, 1, 1], [0.5, 0.5, 0.5]];
    const r = kmeans(data3D, 2);
    r.centroids.forEach(c => expect(c).toHaveLength(3));
  });

  it("handles single-feature data", () => {
    const data = [[1], [2], [3], [10], [11], [12]];
    const r = kmeans(data, 2);
    expect(r.assignments).toHaveLength(6);
    expect(r.centroids).toHaveLength(2);
  });
});

// ── labelClusters ─────────────────────────────────────────────────────────────

describe("labelClusters", () => {
  const years   = [2010, 2011, 2012, 2013, 2014, 2015];
  const growths = [8, 9, 2, 3, -1, -2]; // clearly three groups

  it("returns k labeled clusters", () => {
    const { assignments } = kmeans(growths.map(g => [g]), 3);
    const labels = labelClusters(years, growths, assignments, 3);
    expect(labels).toHaveLength(3);
  });

  it("Expansion cluster has strictly higher avgGrowth than Contraction", () => {
    const { assignments } = kmeans(growths.map(g => [g]), 3);
    const labels = labelClusters(years, growths, assignments, 3);
    const expansion  = labels.find(l => l.label === "Expansion");
    const contraction = labels.find(l => l.label === "Contraction");
    if (expansion && contraction) {
      expect(expansion.avgGrowth).toBeGreaterThan(contraction.avgGrowth);
    }
  });

  it("every input year appears in exactly one cluster", () => {
    const { assignments } = kmeans(growths.map(g => [g]), 3);
    const labels = labelClusters(years, growths, assignments, 3);
    const allYears = labels.flatMap(l => l.years).sort((a, b) => a - b);
    expect(allYears).toEqual([...years].sort((a, b) => a - b));
  });

  it("each cluster has a hex color string", () => {
    const { assignments } = kmeans(growths.map(g => [g]), 2);
    const labels = labelClusters(years, growths, assignments, 2);
    labels.forEach(l => expect(l.color).toMatch(/^#[0-9A-Fa-f]{6}$/));
  });

  it("each cluster has a non-empty label string", () => {
    const { assignments } = kmeans(growths.map(g => [g]), 3);
    const labels = labelClusters(years, growths, assignments, 3);
    labels.forEach(l => expect(l.label.length).toBeGreaterThan(0));
  });

  it("avgGrowth values are finite numbers", () => {
    const { assignments } = kmeans(growths.map(g => [g]), 3);
    const labels = labelClusters(years, growths, assignments, 3);
    labels.forEach(l => expect(Number.isFinite(l.avgGrowth)).toBe(true));
  });
});
