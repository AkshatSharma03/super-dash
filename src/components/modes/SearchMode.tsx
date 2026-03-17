// ─────────────────────────────────────────────────────────────────────────────
// SEARCH MODE  —  live web search backed by /api/search (Anthropic web_search
// beta tool). Falls back to model knowledge when live search is unavailable.
// Includes Trie-powered O(m) autocomplete from a weighted economic term corpus.
// ─────────────────────────────────────────────────────────────────────────────
import { useState } from "react";
import { useMobile } from "../../utils/useMobile";
import { SEARCH_SUGGESTIONS } from "../../data/suggestions";
import { performWebSearch } from "../../utils/api";
import { getSearchTrie } from "../../algorithms/trie";
import type { SearchResult } from "../../types";
import { MarkdownText } from "../ui";

export default function SearchMode() {
  const isMobile = useMobile();
  // ── State
  const [query,           setQuery]           = useState("");
  const [loading,         setLoading]         = useState(false);
  const [result,          setResult]          = useState<SearchResult | null>(null);
  const [error,           setError]           = useState<string | null>(null);
  const [searched,        setSearched]        = useState("");   // display label for the current result
  const [followQuery,     setFollowQuery]     = useState("");
  const [suggestions,     setSuggestions]     = useState<string[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);

  // Singleton Trie — built once from the weighted corpus in algorithms/trie.ts.
  const trie = getSearchTrie();

  // ── Handlers
  const handleQueryChange = (val: string) => {
    setQuery(val);
    // Show Trie suggestions for queries ≥2 chars (avoids spammy single-char matches).
    if (val.trim().length >= 2) {
      const hits = trie.search(val.trim()); // O(m) where m = query length
      setSuggestions(hits);
      setShowSuggestions(hits.length > 0);
    } else {
      setSuggestions([]);
      setShowSuggestions(false);
    }
  };

  const doSearch = async (q: string) => {
    if (!q?.trim() || loading) return;
    const trimmed = q.trim();
    setShowSuggestions(false);
    setSuggestions([]);
    setLoading(true);
    setResult(null);
    setError(null);
    setSearched(trimmed);
    setQuery("");
    setFollowQuery("");
    try {
      const res = await performWebSearch(trimmed);
      setResult(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setLoading(false);
  };

  // ── Render
  return (
    <div style={{ maxWidth: 860, margin: "0 auto" }}>

      {/* ── Search bar with Trie autocomplete dropdown ── */}
      <div style={{ position: "relative", marginBottom: 18 }}>
        <div style={{ display: "flex", gap: 8, flexDirection: isMobile ? "column" : "row" }}>
          <input
            value={query}
            onChange={e => handleQueryChange(e.target.value)}
            onKeyDown={e => {
              if (e.key === "Enter")  doSearch(query);
              if (e.key === "Escape") setShowSuggestions(false);
            }}
            // onBlur: restore border AND hide suggestions (setTimeout lets onMouseDown fire first)
            onBlur={e => { e.currentTarget.style.borderColor = "#2d3348"; e.currentTarget.style.boxShadow = "none"; setTimeout(() => setShowSuggestions(false), 150); }}
            onFocus={e => { e.currentTarget.style.borderColor = "#10B981"; e.currentTarget.style.boxShadow = "0 0 0 3px #10B98118"; }}
            disabled={loading}
            placeholder="Search for US, China, EU, Japan economic data, trade stats, news…"
            style={{ flex: 1, background: "#161929", border: "1px solid #2d3348", borderRadius: 10, padding: "12px 16px", color: "#e2e8f0", fontSize: 14, outline: "none", transition: "border-color .15s, box-shadow .15s" }}
          />
          <button onClick={() => doSearch(query)} disabled={loading || !query.trim()}
            style={{ background: loading || !query.trim() ? "#161929" : "linear-gradient(135deg,#10B981,#059669)", border: "none", borderRadius: 10, padding: "12px 22px", color: loading || !query.trim() ? "#334155" : "#fff", fontSize: 13, fontWeight: 700, cursor: loading || !query.trim() ? "not-allowed" : "pointer", transition: "all .15s", whiteSpace: "nowrap", boxShadow: !loading && query.trim() ? "0 2px 10px #10B98144" : "none" }}>
            {loading ? "…" : "Search →"}
          </button>
        </div>

        {/* Trie autocomplete dropdown — uses onMouseDown (not onClick) so it fires before the input's onBlur */}
        {showSuggestions && suggestions.length > 0 && (
          <div style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, right: 54, background: "#1e2130", border: "1px solid #10B98155", borderRadius: 10, zIndex: 100, overflow: "hidden" }}>
            <div style={{ padding: "6px 12px", fontSize: 10, color: "#10B981", fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.8, borderBottom: "1px solid #2d3348" }}>
              Trie Suggestions — O(m) prefix match
            </div>
            {suggestions.map((s, i) => (
              <button key={i} onMouseDown={() => doSearch(s)}
                style={{ display: "block", width: "100%", textAlign: "left", background: "transparent", border: "none", padding: "9px 14px", fontSize: 13, color: "#94a3b8", cursor: "pointer", borderBottom: i < suggestions.length - 1 ? "1px solid #2d334844" : "none" }}
                onMouseEnter={e => { e.currentTarget.style.background = "#10B98118"; e.currentTarget.style.color = "#e2e8f0"; }}
                onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "#94a3b8"; }}>
                {s}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ── Suggested searches (shown before first search) ── */}
      {!result && !loading && !error && (
        <>
          <p style={{ fontSize: 10, color: "#475569", marginBottom: 8, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.6px" }}>Suggested searches</p>
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 7, marginBottom: 24 }}>
            {SEARCH_SUGGESTIONS.map((s, i) => (
              <button key={i} onClick={() => doSearch(s)}
                style={{ background: "#161929", border: "1px solid #2d3348", borderRadius: 8, padding: "10px 14px", fontSize: 12, color: "#64748b", cursor: "pointer", textAlign: "left", lineHeight: 1.45, transition: "all .15s" }}
                onMouseEnter={e => { const el = e.currentTarget; el.style.borderColor = "#10B98166"; el.style.color = "#cbd5e1"; el.style.background = "#10B98108"; }}
                onMouseLeave={e => { const el = e.currentTarget; el.style.borderColor = "#2d3348"; el.style.color = "#64748b"; el.style.background = "#161929"; }}>
                {s}
              </button>
            ))}
          </div>
        </>
      )}

      {/* ── Loading state ── */}
      {loading && (
        <div style={{ background: "#161929", border: "1px solid #10B98133", borderLeft: "3px solid #10B981", borderRadius: "0 12px 12px 0", padding: "18px 20px", display: "flex", alignItems: "center", gap: 14, animation: "fadeInUp .2s ease-out" }}>
          <div style={{ width: 32, height: 32, borderRadius: "50%", border: "2.5px solid #1e2130", borderTop: "2.5px solid #10B981", animation: "spin 0.8s linear infinite", flexShrink: 0 }} />
          <div>
            <p style={{ margin: "0 0 3px", fontSize: 14, color: "#e2e8f0", fontWeight: 600 }}>Searching the web…</p>
            <p style={{ margin: 0, fontSize: 12, color: "#475569" }}>Querying World Bank, IMF, Reuters, Bloomberg and authoritative sources</p>
          </div>
        </div>
      )}

      {/* ── Error state ── */}
      {error && (
        <div style={{ background: "#EF444422", border: "1px solid #EF4444", borderRadius: 10, padding: 16, fontSize: 13, color: "#EF4444" }}>
          <strong>Search error:</strong> {error}
        </div>
      )}

      {/* ── Results ── */}
      {result && (
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
            <span style={{ fontSize: 11, background: result.webSearchUsed ? "#10B98122" : "#F59E0B22", color: result.webSearchUsed ? "#10B981" : "#F59E0B", border: `1px solid ${result.webSearchUsed ? "#10B98144" : "#F59E0B44"}`, borderRadius: 5, padding: "2px 10px", fontWeight: 600 }}>
              {result.webSearchUsed ? "🌐 Live Web Search" : "📚 Model Knowledge"}
            </span>
            <span style={{ fontSize: 12, color: "#64748b", fontStyle: "italic" }}>"{searched}"</span>
            <button onClick={() => { setResult(null); setError(null); setSearched(""); }}
              style={{ marginLeft: "auto", background: "transparent", border: "1px solid #2d3348", borderRadius: 6, padding: "4px 12px", fontSize: 11, color: "#64748b", cursor: "pointer" }}>
              Clear
            </button>
          </div>

          <div style={{ background: "#161929", border: `1px solid ${result.webSearchUsed ? "#10B98133" : "#F59E0B33"}`, borderLeft: `3px solid ${result.webSearchUsed ? "#10B981" : "#F59E0B"}`, borderRadius: "0 12px 12px 0", padding: 22, marginBottom: 14, animation: "fadeInUp .25s ease-out" }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 14 }}>
              <span style={{ fontSize: 14 }}>{result.webSearchUsed ? "🌐" : "📚"}</span>
              <span style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.7px", color: result.webSearchUsed ? "#10B981" : "#F59E0B" }}>Research Summary</span>
              {!result.webSearchUsed && (
                <span style={{ fontSize: 9, color: "#F59E0B", background: "#F59E0B11", border: "1px solid #F59E0B33", borderRadius: 4, padding: "1px 7px", fontWeight: 600 }}>
                  Training data — may be outdated
                </span>
              )}
            </div>
            <MarkdownText text={result.text} />
          </div>

          {/* Source list */}
          {result.sources.length > 0 && (
            <div style={{ background: "#1e2130", border: "1px solid #2d3348", borderRadius: 10, padding: 16, marginBottom: 16 }}>
              <p style={{ margin: "0 0 10px", fontSize: 11, color: "#64748b", fontWeight: 600, textTransform: "uppercase" }}>
                Sources ({result.sources.length})
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                {result.sources.slice(0, 8).map((s, i) =>
                  s.url
                    ? <a key={i} href={s.url} target="_blank" rel="noopener noreferrer"
                        style={{ fontSize: 12, color: "#00AAFF", textDecoration: "none", display: "flex", alignItems: "flex-start", gap: 6 }}
                        onMouseEnter={e => { e.currentTarget.style.textDecoration = "underline"; }}
                        onMouseLeave={e => { e.currentTarget.style.textDecoration = "none"; }}>
                        <span style={{ color: "#64748b", flexShrink: 0 }}>↗</span>{s.title}
                      </a>
                    : <span key={i} style={{ fontSize: 12, color: "#64748b", display: "flex", alignItems: "center", gap: 6 }}>
                        <span>📚</span>{s.title}
                      </span>
                )}
              </div>
            </div>
          )}

          {/* Follow-up search bar */}
          <div style={{ background: "#161929", border: "1px solid #2d3348", borderRadius: 10, padding: 14 }}>
            <p style={{ margin: "0 0 8px", fontSize: 10, color: "#475569", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.6px" }}>Refine or follow up</p>
            <div style={{ display: "flex", gap: 8, flexDirection: isMobile ? "column" : "row" }}>
              <input value={followQuery} onChange={e => setFollowQuery(e.target.value)}
                onKeyDown={e => e.key === "Enter" && doSearch(followQuery)}
                disabled={loading}
                placeholder="Enter a follow-up or related search…"
                style={{ flex: 1, background: "#0f1117", border: "1px solid #2d3348", borderRadius: 8, padding: "9px 14px", color: "#e2e8f0", fontSize: 13, outline: "none", transition: "border-color .15s" }}
                onFocus={e => { e.target.style.borderColor = "#10B981"; }}
                onBlur={e => { e.target.style.borderColor = "#2d3348"; }} />
              <button onClick={() => doSearch(followQuery)} disabled={loading || !followQuery.trim()}
                style={{ background: loading || !followQuery.trim() ? "#0f1117" : "#10B981", border: "none", borderRadius: 8, padding: "9px 18px", color: loading || !followQuery.trim() ? "#334155" : "#fff", fontSize: 13, fontWeight: 700, cursor: loading || !followQuery.trim() ? "not-allowed" : "pointer" }}>
                Search
              </button>
            </div>
          </div>
        </div>
      )}

      <p style={{ textAlign: "center", fontSize: 10, color: "#2d3348", marginTop: 20 }}>
        Powered by Claude · Web search via Anthropic · Sources: World Bank · IMF · Reuters · Bloomberg
      </p>
    </div>
  );
}
