// ─────────────────────────────────────────────────────────────────────────────
// TRIE DATA STRUCTURE  (implemented from scratch)
// Enables O(m) prefix-based autocomplete where m = query length.
// Each node stores its children in a Map<char, TrieNode>.
// ─────────────────────────────────────────────────────────────────────────────

class TrieNode {
  children: Map<string, TrieNode> = new Map();
  isEnd = false;
  term  = "";          // full original term (stored at leaf for retrieval)
  weight = 0;          // higher = shown first in suggestions
}

export class Trie {
  private root = new TrieNode();

  insert(term: string, weight = 1): void {
    let node = this.root;
    for (const ch of term.toLowerCase()) {
      if (!node.children.has(ch)) node.children.set(ch, new TrieNode());
      node = node.children.get(ch)!;
    }
    node.isEnd  = true;
    node.term   = term;           // store original casing
    node.weight = weight;
  }

  // Traverse to the node matching the prefix, then collect all leaf terms
  search(prefix: string, limit = 6): string[] {
    if (!prefix) return [];
    let node = this.root;
    for (const ch of prefix.toLowerCase()) {
      if (!node.children.has(ch)) return [];
      node = node.children.get(ch)!;
    }
    return this._collect(node, limit);
  }

  // DFS collection of all terms reachable from a given node
  private _collect(start: TrieNode, limit: number): string[] {
    const results: Array<{ term: string; weight: number }> = [];
    const stack: TrieNode[] = [start];
    while (stack.length && results.length < limit * 3) {
      const curr = stack.pop()!;
      if (curr.isEnd) results.push({ term: curr.term, weight: curr.weight });
      // Push children in reverse alphabetical order so stack pops alphabetically
      const children = [...curr.children.values()].reverse();
      for (const child of children) stack.push(child);
    }
    // Sort by weight descending, then alphabetically
    return results
      .sort((a, b) => b.weight - a.weight || a.term.localeCompare(b.term))
      .slice(0, limit)
      .map(r => r.term);
  }

  get size(): number {
    let count = 0;
    const stack = [this.root];
    while (stack.length) {
      const node = stack.pop()!;
      if (node.isEnd) count++;
      for (const child of node.children.values()) stack.push(child);
    }
    return count;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// CORPUS  — Kazakhstan economic terms, weighted by relevance
// ─────────────────────────────────────────────────────────────────────────────
const CORPUS: Array<[string, number]> = [
  // GDP (weight 10 = highest priority)
  ["GDP growth", 10], ["GDP per capita", 10], ["nominal GDP", 9], ["real GDP growth", 9],
  ["GDP forecast 2025", 8], ["GDP forecast 2026", 8],

  // Oil & energy
  ["oil and gas exports", 10], ["crude oil production", 9], ["petroleum revenues", 8],
  ["Tengiz oil field", 7], ["Kashagan oil field", 7], ["Karachaganak gas", 7],
  ["oil price impact Kazakhstan", 9], ["energy sector Kazakhstan", 8],

  // Trade
  ["trade balance", 10], ["trade surplus", 9], ["total exports", 9], ["total imports", 9],
  ["export diversification", 8], ["import partners", 8], ["trade concentration", 7],
  ["China imports Kazakhstan", 9], ["Russia imports Kazakhstan", 8], ["EU imports Kazakhstan", 7],
  ["metals exports", 7], ["agriculture exports", 7], ["chemicals exports", 6],

  // Macroeconomics
  ["inflation rate", 9], ["interest rate", 9], ["monetary policy", 8],
  ["tenge exchange rate", 9], ["currency depreciation", 8], ["foreign exchange reserves", 7],
  ["foreign direct investment", 9], ["FDI inflows", 8], ["capital account", 7],
  ["sovereign wealth fund", 9], ["National Fund Kazakhstan", 9], ["AIFC", 7],

  // Digital & tech
  ["digital economy", 10], ["digital GDP share", 9], ["fintech Kazakhstan", 8],
  ["digital transformation", 7], ["tech sector growth", 7], ["AI governance Kazakhstan", 8],
  ["Silicon Steppes", 6], ["startup ecosystem", 6],

  // Policy & institutions
  ["Astana International Financial Centre", 7], ["Belt and Road Initiative", 8],
  ["BRI investment Kazakhstan", 8], ["EAEU trade", 7], ["Eurasian Economic Union", 7],
  ["IMF Kazakhstan outlook", 8], ["World Bank Kazakhstan", 8],

  // Social
  ["unemployment rate", 7], ["poverty rate", 7], ["population growth", 6],
  ["labor market Kazakhstan", 6], ["wage growth", 5],

  // Resources
  ["uranium production", 7], ["copper exports", 6], ["grain exports", 6],
  ["wheat production", 5], ["renewable energy", 6], ["solar power Kazakhstan", 5],

  // Forecasts
  ["Kazakhstan 2025 outlook", 9], ["Kazakhstan economic forecast", 9],
  ["Kazakhstan growth projection", 8], ["Central Asia GDP", 7],
];

export function buildSearchTrie(): Trie {
  const trie = new Trie();
  for (const [term, weight] of CORPUS) {
    trie.insert(term, weight);
  }
  return trie;
}

// Singleton — built once, reused across renders
let _trieInstance: Trie | null = null;
export function getSearchTrie(): Trie {
  if (!_trieInstance) _trieInstance = buildSearchTrie();
  return _trieInstance;
}
