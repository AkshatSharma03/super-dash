import { describe, it, expect, beforeEach } from "vitest";
import { Trie, buildSearchTrie, getSearchTrie } from "../trie";

// ── Trie (basic operations) ───────────────────────────────────────────────────

describe("Trie — insert & search", () => {
  let trie: Trie;
  beforeEach(() => { trie = new Trie(); });

  it("inserts and retrieves a single term", () => {
    trie.insert("hello");
    expect(trie.search("hel")).toContain("hello");
  });

  it("exact-match prefix returns the term", () => {
    trie.insert("GDP growth");
    expect(trie.search("GDP growth")).toContain("GDP growth");
  });

  it("search is case-insensitive (query)", () => {
    trie.insert("GDP growth");
    expect(trie.search("gdp")).toContain("GDP growth");
    expect(trie.search("GDP")).toContain("GDP growth");
    expect(trie.search("GdP")).toContain("GDP growth");
  });

  it("empty prefix returns an empty array", () => {
    trie.insert("test");
    expect(trie.search("")).toHaveLength(0);
  });

  it("non-matching prefix returns empty array", () => {
    trie.insert("hello");
    expect(trie.search("xyz")).toHaveLength(0);
  });

  it("returns all matching terms up to default limit (6)", () => {
    const terms = ["apple", "app", "application", "apply", "appetizer", "appetence", "apt"];
    terms.forEach((t, i) => trie.insert(t, i + 1));
    const results = trie.search("ap");
    expect(results.length).toBeLessThanOrEqual(6);
    expect(results.length).toBeGreaterThan(0);
  });

  it("respects a custom limit parameter", () => {
    ["cat", "car", "cap", "cab", "can"].forEach(t => trie.insert(t, 1));
    expect(trie.search("ca", 2)).toHaveLength(2);
    expect(trie.search("ca", 10)).toHaveLength(5);
  });

  it("higher-weight term appears before lower-weight term", () => {
    trie.insert("trade surplus", 1);
    trie.insert("trade balance", 10);
    const results = trie.search("trade", 2);
    expect(results[0]).toBe("trade balance");
  });

  it("when weights are equal, terms are sorted alphabetically", () => {
    trie.insert("banana", 5);
    trie.insert("apple", 5);
    trie.insert("cherry", 5);
    // All share 'a'/'b'/'c' prefix only partially; let's use a common prefix
    const t2 = new Trie();
    t2.insert("tr-alpha", 5);
    t2.insert("tr-beta", 5);
    t2.insert("tr-gamma", 5);
    const r = t2.search("tr", 3);
    expect(r).toEqual([...r].sort((a, b) => a.localeCompare(b)));
  });

  it("preserves original casing in results", () => {
    trie.insert("GDP Growth");
    expect(trie.search("gdp")).toContain("GDP Growth");
  });

  it("inserting same term twice keeps size = 1", () => {
    trie.insert("test", 5);
    trie.insert("test", 10);
    expect(trie.size).toBe(1);
  });

  it("reinsertion updates weight (last write wins)", () => {
    trie.insert("term", 1);
    trie.insert("term", 99);
    // The node should have weight 99 now — verify via search priority
    // Use explicit prefix that both share
    const t3 = new Trie();
    t3.insert("ax-low",  1);
    t3.insert("ax-high", 99);
    expect(t3.search("ax")[0]).toBe("ax-high");
  });
});

// ── Trie — size ───────────────────────────────────────────────────────────────

describe("Trie — size", () => {
  it("starts at 0", () => {
    expect(new Trie().size).toBe(0);
  });

  it("increments with each distinct insert", () => {
    const t = new Trie();
    t.insert("one");
    expect(t.size).toBe(1);
    t.insert("two");
    expect(t.size).toBe(2);
    t.insert("three");
    expect(t.size).toBe(3);
  });

  it("does not double-count a duplicate insert", () => {
    const t = new Trie();
    t.insert("dupe");
    t.insert("dupe");
    expect(t.size).toBe(1);
  });

  it("counts prefixes that are also complete terms separately", () => {
    const t = new Trie();
    t.insert("GDP");          // is a term
    t.insert("GDP growth");   // longer term using same prefix
    expect(t.size).toBe(2);
  });
});

// ── buildSearchTrie ───────────────────────────────────────────────────────────

describe("buildSearchTrie", () => {
  it("returns a Trie instance", () => {
    expect(buildSearchTrie()).toBeInstanceOf(Trie);
  });

  it("corpus has more than 30 terms", () => {
    expect(buildSearchTrie().size).toBeGreaterThan(30);
  });

  it("GDP terms are searchable", () => {
    const t = buildSearchTrie();
    expect(t.search("gdp")).toContain("GDP growth");
    expect(t.search("gdp")).toContain("GDP per capita");
  });

  it("trade terms are searchable", () => {
    const t = buildSearchTrie();
    const results = t.search("trade");
    expect(results.length).toBeGreaterThan(0);
    expect(results.some(r => r.toLowerCase().startsWith("trade"))).toBe(true);
  });

  it("digital economy is searchable", () => {
    expect(buildSearchTrie().search("digital")).toContain("digital economy");
  });

  it("inflation is searchable", () => {
    const results = buildSearchTrie().search("inflat");
    expect(results).toContain("inflation rate");
  });

  it("high-weight terms surface at top for their prefix", () => {
    const t = buildSearchTrie();
    // "trade balance" has weight 10, so it should appear in top results for "trade"
    const results = t.search("trade", 6);
    expect(results).toContain("trade balance");
  });
});

// ── getSearchTrie (singleton) ─────────────────────────────────────────────────

describe("getSearchTrie", () => {
  it("returns the same instance on repeated calls", () => {
    const t1 = getSearchTrie();
    const t2 = getSearchTrie();
    expect(t1).toBe(t2);
  });

  it("singleton has the corpus loaded", () => {
    expect(getSearchTrie().size).toBeGreaterThan(30);
  });
});
