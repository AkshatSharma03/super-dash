// ─────────────────────────────────────────────────────────────────────────────
// SEARCH MODE  —  live web search backed by /api/search.
// Includes Trie-powered O(m) autocomplete from a weighted economic term corpus.
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useState } from "react";
import { useMobile } from "../../utils/useMobile";
import { SEARCH_SUGGESTIONS } from "../../data/suggestions";
import { clearSearchHistory, getSearchHistory, performWebSearch, saveSearchHistory } from "../../utils/api";
import { getSearchTrie } from "../../algorithms/trie";
import type { SearchContextTurn, SearchHistoryEntry, SearchResult } from "../../types";
import { MarkdownText } from "../ui";
import { Button }  from "@/components/ui/button";
import { Input }   from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge }   from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { AlertTriangle, Globe2, BookOpen } from "lucide-react";

const MAX_SEARCH_HISTORY = 10;
const MAX_SEARCH_CONTEXT_TURNS = 8;

interface SearchModeProps {
  token: string;
  isGuest?: boolean;
}

export default function SearchMode({ token, isGuest = false }: SearchModeProps) {
  const isMobile = useMobile();
  const [query,           setQuery]           = useState("");
  const [loading,         setLoading]         = useState(false);
  const [result,          setResult]          = useState<SearchResult | null>(null);
  const [error,           setError]           = useState<string | null>(null);
  const [searched,        setSearched]        = useState("");
  const [followQuery,     setFollowQuery]     = useState("");
  const [suggestions,     setSuggestions]     = useState<string[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [history,         setHistory]         = useState<SearchHistoryEntry[]>([]);
  const [searchContext,   setSearchContext]   = useState<SearchContextTurn[]>([]);

  const trie = getSearchTrie();

  const normalizeSearchError = (value: unknown): string => {
    const message = value instanceof Error ? value.message : String(value);
    if (message.toLowerCase().includes("signal timed out")) {
      return "Search timed out. Try narrower query or retry in few seconds.";
    }
    return message;
  };

  useEffect(() => {
    let cancelled = false;
    if (isGuest) {
      setHistory([]);
      return;
    }
    getSearchHistory(token)
      .then(rows => {
        if (cancelled) return;
        setHistory(rows.slice(0, MAX_SEARCH_HISTORY));
      })
      .catch(() => {
        if (cancelled) return;
        setHistory([]);
      });

    return () => {
      cancelled = true;
    };
  }, [token, isGuest]);

  const addToHistory = (term: string) => {
    const normalized = term.trim();
    if (!normalized) return;
    if (isGuest) return;
    saveSearchHistory(token, normalized)
      .then(saved => {
        setHistory(prev => {
          const next = [saved, ...prev.filter(h => h.id !== saved.id && h.query.toLowerCase() !== saved.query.toLowerCase())];
          return next.slice(0, MAX_SEARCH_HISTORY);
        });
      })
      .catch(() => {});
  };

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

  const summarizeForContext = (text: string): string =>
    text.replace(/\s+/g, " ").trim().slice(0, 1200);

  const doSearch = async (q: string, opts: { followUp?: boolean } = {}) => {
    if (!q?.trim() || loading) return;
    const { followUp = false } = opts;
    const trimmed = q.trim();
    const contextForRequest = followUp ? searchContext : [];
    setShowSuggestions(false);
    setSuggestions([]);
    setLoading(true);
    setResult(null);
    setError(null);
    setSearched(trimmed);
    addToHistory(trimmed);
    setQuery("");
    setFollowQuery("");
    if (!followUp) setSearchContext([]);
    try {
      const res = await performWebSearch(trimmed, contextForRequest);
      setResult(res);
      const nextTurn: SearchContextTurn = {
        query: trimmed,
        summary: summarizeForContext(res.text),
      };
      setSearchContext(prev => {
        const base = followUp ? prev : [];
        return [...base, nextTurn].slice(-MAX_SEARCH_CONTEXT_TURNS);
      });
    } catch (e) {
      setError(normalizeSearchError(e));
    }
    setLoading(false);
  };

  const exportSearch = async () => {
    if (!result) return;
    const { buildSearchReportHTML, printHTML } = await import("../../utils/export");
    const opened = printHTML(buildSearchReportHTML(searched, result));
    if (!opened) toast.error("Popup blocked. Enable popups, then retry export.");
  };

  return (
    <div className="max-w-[860px] mx-auto px-1 sm:px-0">

      {/* ── Search bar with Trie autocomplete ── */}
      <div className="sticky top-0 z-30 mb-4 pt-1 pb-2 bg-memphis-offwhite/95 backdrop-blur-sm">
        <div className="relative">
        <div className={cn("flex gap-2", isMobile && "flex-col")}>
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
            className="flex-1 h-11 text-sm focus-visible:ring-emerald-500 focus-visible:border-emerald-500"
          />
          <Button onClick={() => doSearch(query)} disabled={loading || !query.trim()}
            className="h-11 min-h-11 px-6 whitespace-nowrap bg-gradient-to-br from-[#10B981] to-[#059669] shadow-[0_2px_10px_#10B98144] font-bold">
            {loading ? "…" : "Search →"}
          </Button>
        </div>

        {/* Trie autocomplete dropdown */}
        {showSuggestions && suggestions.length > 0 && (
          <div className={cn("absolute top-[calc(100%+4px)] left-0 bg-white border-3 border-memphis-cyan z-[100] overflow-hidden shadow-hard", isMobile ? "right-0" : "right-[54px]")}>
            <div className="px-3 py-1.5 text-[10px] text-memphis-cyan font-black uppercase tracking-[0.8px] border-b-3 border-memphis-black bg-memphis-cyan/10">
              Trie Suggestions — O(m) prefix match
            </div>
            {suggestions.map((s, i) => (
              <button key={i} onPointerDown={() => doSearch(s)}
                className={cn(
                  "block w-full text-left bg-transparent border-none px-3.5 py-2.5 text-[13px] text-memphis-black/70 cursor-pointer transition-snap hover:bg-memphis-cyan/10 hover:text-memphis-black",
                  i < suggestions.length - 1 && "border-b-2 border-memphis-black/10"
                )}>
                <span className="text-memphis-cyan mr-2 font-black">↳</span>{s}
              </button>
            ))}
          </div>
        )}
        </div>
      </div>

      {/* ── Recent searches ── */}
      {history.length > 0 && (
        <div className="bg-white border-3 border-memphis-black p-3 mb-4 shadow-hard-sm">
          <div className="flex items-center gap-2 mb-2.5">
            <p className="text-[10px] font-black uppercase tracking-[0.6px] text-memphis-black/65">Recent searches</p>
            <Button
              variant="outline"
              size="sm"
              className="ml-auto text-[10px] h-7 px-2"
              onClick={() => {
                if (isGuest) {
                  setHistory([]);
                  return;
                }
                clearSearchHistory(token)
                  .then(() => setHistory([]))
                  .catch(() => {});
              }}
            >
              Clear history
            </Button>
          </div>
          <div className={cn("grid gap-1.5", isMobile ? "grid-cols-1" : "grid-cols-2")}>
            {history.map((h) => (
              <button
                key={h.id}
                onClick={() => doSearch(h.query)}
                className="text-left min-h-10 px-3 py-2 bg-memphis-offwhite border-2 border-memphis-black/20 text-[12px] text-memphis-black/85 hover:border-emerald-500/60 hover:bg-emerald-500/5 transition-snap"
                title={h.query}
              >
                {h.query}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Suggested searches ── */}
      {!result && !loading && !error && (
        <>
          <p className="text-[10px] text-muted-foreground mb-2 font-semibold uppercase tracking-[0.6px]">Suggested searches</p>
          <div className={cn("grid gap-1.5 mb-6", isMobile ? "grid-cols-1" : "grid-cols-2")}>
            {SEARCH_SUGGESTIONS.map((s, i) => (
              <button key={i} onClick={() => doSearch(s)}
                className="bg-card border border-border rounded-lg px-3.5 py-3 min-h-11 text-xs text-muted-foreground cursor-pointer text-left leading-[1.45] transition-all hover:border-emerald-500/40 hover:text-slate-300 hover:bg-emerald-500/5">
                {s}
              </button>
            ))}
          </div>
        </>
      )}

      {/* ── Loading ── */}
      {loading && (
        <div className="bg-card border border-emerald-500/20 border-l-[3px] border-l-emerald-500 rounded-[0_12px_12px_0] px-5 py-4 flex items-center gap-3.5" style={{ animation: "fadeInUp .2s ease-out" }}>
          <div className="w-8 h-8 rounded-full border-[2.5px] border-muted border-t-emerald-500 animate-spin shrink-0" />
          <div>
            <p className="text-sm text-foreground font-semibold mb-0.5">Searching the web…</p>
            <p className="text-xs text-muted-foreground">Querying World Bank, IMF, Reuters, Bloomberg and authoritative sources</p>
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
              {result.webSearchUsed ? "Live Web Search" : "Model Knowledge"}
            </Badge>
            <span className="text-xs text-muted-foreground italic">"{searched}"</span>
            <div className="ml-auto flex gap-2">
              <Button variant="outline" size="sm" className="text-xs"
                onClick={exportSearch}
                title="Export research summary with cited sources as PDF/HTML">
                Export ↓
              </Button>
              <Button variant="outline" size="sm" className="text-xs"
                onClick={() => { setResult(null); setError(null); setSearched(""); setSearchContext([]); }}>
                Clear
              </Button>
            </div>
          </div>

          <div
            className={cn(
              "bg-card rounded-[0_12px_12px_0] p-5 mb-3.5 border border-l-[3px]",
              result.webSearchUsed ? "border-emerald-500/20 border-l-emerald-500" : "border-amber-500/20 border-l-amber-500"
            )}
            style={{ animation: "fadeInUp .25s ease-out" }}
          >
            <div className="flex gap-2 items-center mb-3.5">
              {result.webSearchUsed ? <Globe2 className="w-4 h-4 text-emerald-500" /> : <BookOpen className="w-4 h-4 text-amber-500" />}
              <span className={cn("text-[10px] font-bold uppercase tracking-[0.7px]", result.webSearchUsed ? "text-emerald-500" : "text-amber-500")}>
                Research Summary
              </span>
              {!result.webSearchUsed && (
                <Badge variant="warning" className="text-[9px]">Training data — may be outdated</Badge>
              )}
            </div>
            <MarkdownText text={result.text} />
          </div>

          {/* Source list */}
          {result.sources.length > 0 && (
            <div className="bg-muted border border-border rounded-xl p-4 mb-4">
              <p className="text-[11px] text-muted-foreground font-semibold uppercase mb-2.5">
                Sources ({result.sources.length})
              </p>
              <div className="flex flex-col gap-1.5">
                {result.sources.slice(0, 12).map((s, i) =>
                  s.url
                    ? <a key={i} href={s.url} target="_blank" rel="noopener noreferrer"
                        className="text-[13px] text-memphis-black no-underline flex items-start gap-1.5 hover:underline">
                        <span className="text-memphis-black/50 shrink-0">↗</span>{s.title}
                      </a>
                    : <span key={i} className="text-[13px] text-memphis-black/70 flex items-center gap-1.5">
                        <BookOpen className="w-3.5 h-3.5" />{s.title}
                      </span>
                )}
              </div>
              {result.sources.length > 12 && (
                <p className="mt-2 text-[11px] text-memphis-black/60">+ {result.sources.length - 12} more sources available in export</p>
              )}
            </div>
          )}

          {/* Follow-up search */}
          <div className="bg-card border border-border rounded-xl p-3.5">
            <p className="text-[10px] text-muted-foreground font-semibold uppercase tracking-[0.6px] mb-2">Refine or follow up</p>
            <div className={cn("flex gap-2", isMobile && "flex-col")}>
              <Input value={followQuery} onChange={e => setFollowQuery(e.target.value)}
                onKeyDown={e => e.key === "Enter" && doSearch(followQuery, { followUp: true })}
                disabled={loading}
                placeholder="Enter a follow-up or related search…"
                className="flex-1 focus-visible:ring-emerald-500 focus-visible:border-emerald-500" />
              <Button onClick={() => doSearch(followQuery, { followUp: true })} disabled={loading || !followQuery.trim()}
                className="bg-[#10B981] hover:bg-[#059669] font-bold min-h-11">
                Search
              </Button>
            </div>
          </div>
        </div>
      )}

      <p className="text-center text-[10px] text-border mt-5">
        Powered by Kagi FastGPT · Sources: World Bank · IMF · Reuters · Bloomberg
      </p>
    </div>
  );
}
