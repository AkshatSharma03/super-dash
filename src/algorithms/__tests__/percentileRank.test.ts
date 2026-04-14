import { describe, it, expect } from "vitest";
import {
  computeAverage,
  computeMedian,
  computePercentileRank,
  computeRank,
  buildPeerSummary,
} from "../percentileRank";

describe("computeAverage", () => {
  it("returns average with two decimals", () => {
    expect(computeAverage([1, 2, 3])).toBe(2);
  });

  it("filters nulls and non-numbers", () => {
    expect(computeAverage([1, null, undefined, 4])).toBe(2.5);
  });

  it("returns null for an empty series", () => {
    expect(computeAverage([])).toBeNull();
    expect(computeAverage([null, undefined])).toBeNull();
  });
});

describe("computeMedian", () => {
  it("returns center value for odd sample", () => {
    expect(computeMedian([3, 1, 2])).toBe(2);
  });

  it("returns average of middle pair for even sample", () => {
    expect(computeMedian([4, 1, 2, 3])).toBe(2.5);
  });

  it("ignores invalid values", () => {
    expect(computeMedian([10, null, 20, undefined, 30])).toBe(20);
  });
});

describe("computePercentileRank", () => {
  it("places highest value near the 100th percentile", () => {
    const p = computePercentileRank([100, 90, 80], 100);
    expect(p).not.toBeNull();
    expect(p!).toBeGreaterThan(80);
    expect(p!).toBeLessThanOrEqual(100);
  });

  it("places lowest value near the 0th percentile", () => {
    const p = computePercentileRank([100, 90, 80], 80);
    expect(p).not.toBeNull();
    expect(p!).toBeLessThan(30);
    expect(p!).toBeGreaterThanOrEqual(0);
  });

  it("supports ties with half-rank behavior", () => {
    const p = computePercentileRank([10, 10, 20, 20], 10);
    expect(p).toBe(25);
  });
});

describe("computeRank", () => {
  it("gives shared rank for ties", () => {
    const r = computeRank([100, 90, 90, 80], 90);
    expect(r).toBe(2);
  });

  it("returns null when target cannot be ranked", () => {
    expect(computeRank([], 100)).toBeNull();
  });
});

describe("buildPeerSummary", () => {
  it("builds rank, median, average for target code", () => {
    const summary = buildPeerSummary([
      { code: "IN", value: 100 },
      { code: "US", value: 200 },
      { code: "CN", value: 120 },
    ], "IN");

    expect(summary).not.toBeNull();
    expect(summary?.rank).toBe(3);
    expect(summary?.total).toBe(3);
    expect(summary?.median).toBe(120);
    expect(summary?.average).toBe(140);
  });

  it("returns null if target code is not present", () => {
    const summary = buildPeerSummary([
      { code: "US", value: 100 },
      { code: "DE", value: 200 },
    ], "IN");

    expect(summary).toBeNull();
  });
});
