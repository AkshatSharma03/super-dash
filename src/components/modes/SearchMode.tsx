// ─────────────────────────────────────────────────────────────────────────────
// SEARCH MODE  —  live web search backed by /api/search.
// Includes Trie-powered O(m) autocomplete from a weighted economic term corpus.
// ─────────────────────────────────────────────────────────────────────────────
import { useState } from "react";
import { useMobile } from "../../utils/useMobile";
import { SEARCH_SUGGESTIONS } from "../../data/suggestions";
import { performWebSearch } from "../../utils/api";
import { getSearchTrie } from "../../algorithms/trie";
import type { SearchResult } from "../../types";
import { MarkdownText } from "../ui";
import { Button }  from "@/components/ui/button";
import { Input }   from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge }   from "@/components/ui/badge";
import { AlertTriangle } from "lucide-react";

export default function SearchMode() {
  const isMobile = useMobile();
  const [query,           setQuery]           = useState("");
  const [loading,         setLoading]         = useState(false);
  const [result,          setResult]          = useState<SearchResult | null>(null);
  const [error,           setError]           = useState<string | null>(null);
  const [searched,        setSearched]        = useState("");
  const [followQuery,     setFollowQuery]     = useState("");
  const [suggestions,     setSuggestions]     = useState<string[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);

  const trie = getSearchTrie();

  const handleQueryChange = (val: string) => {
    setQuery(val);
    if (val.trim().length >= 2) {
      const hits = trie.search(val.trim());
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

  return (
    <div style={{ maxWidth: 860, margin: "0 auto" }}>

      {/* ── Search bar with Trie autocomplete ── */}
      <div style={{ position: "relative", marginBottom: 18 }}>
        <div className={`flex gap-2 ${isMobile ? "flex-col" : ""}`}>
          <Input
            value={query}
            onChange={e => handleQueryChange(e.target.value)}
            onKeyDown={e => {
              if (e.key === "Enter")  doSearch(query);
              if (e.key === "Escape") setShowSuggestions(false);
            }}
            onBlur={e => { e.currentTarget.blur(); setTimeout(() => setShowSuggestions(false), 150); }}
            onFocus={() => query.trim().length >= 2 && suggestions.length > 0 && setShowSuggestions(true)}
            disabled={loading}
            placeholder="Search for US, China, EU, Japan economic data, trade stats, news…"
            className="flex-1 h-11 text-sm focus-visible:ring-green-500 focus-visible:border-green-500"
          />
          <Button onClick={() => doSearch(query)} disabled={loading || !query.trim()}
            className="h-11 px-6 whitespace-nowrap bg-gradient-to-br from-[#10B981] to-[#059669] shadow-[0_2px_10px_#10B98144] font-bold">
            {loading ? "…" : "Search →"}
          </Button>
        </div>

        {/* Trie autocomplete dropdown */}
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

      {/* ── Suggested searches ── */}
      {!result && !loading && !error && (
        <>
          <p style={{ fontSize: 10, color: "#475569", marginBottom: 8, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.6px" }}>Suggested searches</p>
          <div className={`grid gap-1.5 mb-6 ${isMobile ? "grid-cols-1" : "grid-cols-2"}`}>
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

      {/* ── Loading ── */}
      {loading && (
        <div style={{ background: "#161929", border: "1px solid #10B98133", borderLeft: "3px solid #10B981", borderRadius: "0 12px 12px 0", padding: "18px 20px", display: "flex", alignItems: "center", gap: 14, animation: "fadeInUp .2s ease-out" }}>
          <div style={{ width: 32, height: 32, borderRadius: "50%", border: "2.5px solid #1e2130", borderTop: "2.5px solid #10B981", animation: "spin 0.8s linear infinite", flexShrink: 0 }} />
          <div>
            <p style={{ margin: "0 0 3px", fontSize: 14, color: "#e2e8f0", fontWeight: 600 }}>Searching the web…</p>
            <p style={{ margin: 0, fontSize: 12, color: "#475569" }}>Querying World Bank, IMF, Reuters, Bloomberg and authoritative sources</p>
          </div>
        </div>
      )}

      {/* ── Error ── */}
      {error && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription><strong>Search error:</strong> {error}</AlertDescription>
        </Alert>
      )}

      {/* ── Results ── */}
      {result && (
        <div>
          <div className="flex items-center gap-2.5 mb-3.5 flex-wrap">
            <Badge variant={result.webSearchUsed ? "success" : "warning"}>
              {result.webSearchUsed ? "🌐 Live Web Search" : "📚 Model Knowledge"}
            </Badge>
            <span style={{ fontSize: 12, color: "#64748b", fontStyle: "italic" }}>"{searched}"</span>
            <Button variant="outline" size="sm" className="ml-auto text-xs"
              onClick={() => { setResult(null); setError(null); setSearched(""); }}>
              Clear
            </Button>
          </div>

          <div style={{ background: "#161929", border: `1px solid ${result.webSearchUsed ? "#10B98133" : "#F59E0B33"}`, borderLeft: `3px solid ${result.webSearchUsed ? "#10B981" : "#F59E0B"}`, borderRadius: "0 12px 12px 0", padding: 22, marginBottom: 14, animation: "fadeInUp .25s ease-out" }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 14 }}>
              <span style={{ fontSize: 14 }}>{result.webSearchUsed ? "🌐" : "📚"}</span>
              <span style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.7px", color: result.webSearchUsed ? "#10B981" : "#F59E0B" }}>Research Summary</span>
              {!result.webSearchUsed && (
                <Badge variant="warning" className="text-[9px]">Training data — may be outdated</Badge>
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
              <div className="flex flex-col gap-1.5">
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

          {/* Follow-up search */}
          <div style={{ background: "#161929", border: "1px solid #2d3348", borderRadius: 10, padding: 14 }}>
            <p style={{ margin: "0 0 8px", fontSize: 10, color: "#475569", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.6px" }}>Refine or follow up</p>
            <div className={`flex gap-2 ${isMobile ? "flex-col" : ""}`}>
              <Input value={followQuery} onChange={e => setFollowQuery(e.target.value)}
                onKeyDown={e => e.key === "Enter" && doSearch(followQuery)}
                disabled={loading}
                placeholder="Enter a follow-up or related search…"
                className="flex-1 focus-visible:ring-green-500 focus-visible:border-green-500" />
              <Button onClick={() => doSearch(followQuery)} disabled={loading || !followQuery.trim()}
                className="bg-[#10B981] hover:bg-[#059669] font-bold">
                Search
              </Button>
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
