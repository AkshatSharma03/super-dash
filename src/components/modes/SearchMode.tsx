// ─────────────────────────────────────────────────────────────────────────────
// SEARCH MODE  —  live web search backed by /api/search.
// Includes Trie-powered O(m) autocomplete from a weighted economic term corpus.
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useState } from "react";
import { useMobile } from "../../utils/useMobile";
import { SEARCH_SUGGESTIONS } from "../../data/suggestions";
import {
  clearSearchHistory,
  createSearchSession,
  deleteSearchSession,
  getSearchHistory,
  getSearchSessions,
  performWebSearch,
  saveSearchHistory,
  updateSearchSession,
} from "../../utils/api";
import { getSearchTrie } from "../../algorithms/trie";
import type { SearchHistoryEntry, SearchResult, SearchSession, SearchSessionTurn } from "../../types";
import { MarkdownText } from "../ui";
import { Button }  from "@/components/ui/button";
import { Input }   from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge }   from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { AlertTriangle, Globe2, BookOpen, Menu, X, Plus } from "lucide-react";

const MAX_SEARCH_HISTORY = 10;
const MAX_SEARCH_CONTEXT_TURNS = 8;

type SearchSidebarTab = "history" | "chats";

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
  const [threads,         setThreads]         = useState<SearchSession[]>([]);
  const [activeThreadId,  setActiveThreadId]  = useState<string | null>(null);
  const [sidebarOpen,     setSidebarOpen]     = useState(false);
  const [sidebarTab,      setSidebarTab]      = useState<SearchSidebarTab>("history");
  const [threadsLoading,  setThreadsLoading]  = useState(true);
  const [hoveredThreadId, setHoveredThreadId] = useState<string | null>(null);

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

  useEffect(() => {
    let cancelled = false;
    if (isGuest) {
      setThreads([]);
      setActiveThreadId(null);
      setThreadsLoading(false);
      return;
    }

    setThreadsLoading(true);
    getSearchSessions(token)
      .then(rows => {
        if (cancelled) return;
        setThreads(rows.slice(0, 25));
      })
      .catch(() => {
        if (cancelled) return;
        setThreads([]);
      })
      .finally(() => {
        if (cancelled) return;
        setThreadsLoading(false);
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

  const makeThreadId = (): string => {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
    return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  };

  const resetSearchView = () => {
    setResult(null);
    setError(null);
    setSearched("");
    setFollowQuery("");
    setQuery("");
    setActiveThreadId(null);
  };

  const doSearch = async (q: string, opts: { followUp?: boolean } = {}) => {
    if (!q?.trim() || loading) return;
    const { followUp = false } = opts;
    const trimmed = q.trim();
    const activeThread = activeThreadId ? threads.find(t => t.id === activeThreadId) : null;
    const contextForRequest = followUp && activeThread
      ? activeThread.turns.slice(-MAX_SEARCH_CONTEXT_TURNS).map(turn => ({ query: turn.query, summary: turn.summary }))
      : [];
    setShowSuggestions(false);
    setSuggestions([]);
    setLoading(true);
    setResult(null);
    setError(null);
    setSearched(trimmed);
    addToHistory(trimmed);
    setQuery("");
    setFollowQuery("");
    setSidebarOpen(false);

    try {
      const res = await performWebSearch(trimmed, contextForRequest);
      setResult(res);
      const nextTurn: SearchSessionTurn = {
        query: trimmed,
        summary: summarizeForContext(res.text),
        result: res,
      };
      if (followUp && activeThreadId) {
        const active = threads.find(t => t.id === activeThreadId);
        if (!active) {
          setLoading(false);
          return;
        }
        const updatedTurns = [...active.turns, nextTurn].slice(-MAX_SEARCH_CONTEXT_TURNS);
        const now = new Date().toISOString();
        setThreads(prev => {
          const idx = prev.findIndex(t => t.id === activeThreadId);
          if (idx < 0) return prev;
          const current = prev[idx];
          const updated: SearchSession = {
            ...current,
            turns: updatedTurns,
            updatedAt: now,
          };
          return [updated, ...prev.filter(t => t.id !== activeThreadId)];
        });
        if (!isGuest) {
          updateSearchSession(token, activeThreadId, { turns: updatedTurns, title: active.title }).catch(() => {});
        }
      } else {
        const title = trimmed.length > 60 ? `${trimmed.slice(0, 60)}…` : trimmed;
        const now = new Date().toISOString();

        if (isGuest) {
          const id = makeThreadId();
          const guestThread: SearchSession = { id, title, turns: [nextTurn], createdAt: now, updatedAt: now };
          setActiveThreadId(id);
          setThreads(prev => [guestThread, ...prev.filter(t => t.id !== id)]);
        } else {
          try {
            const created = await createSearchSession(token, title);
            const id = created.id;
            setActiveThreadId(id);
            const persistedThread: SearchSession = {
              ...created,
              turns: [nextTurn],
              title,
              updatedAt: now,
            };
            setThreads(prev => [persistedThread, ...prev.filter(t => t.id !== id)]);
            updateSearchSession(token, id, { turns: [nextTurn], title }).catch(() => {});
          } catch {
            const id = makeThreadId();
            const fallbackThread: SearchSession = { id, title, turns: [nextTurn], createdAt: now, updatedAt: now };
            setActiveThreadId(id);
            setThreads(prev => [fallbackThread, ...prev.filter(t => t.id !== id)]);
          }
        }
      }
    } catch (e) {
      setError(normalizeSearchError(e));
    }
    setLoading(false);
  };

  const loadThread = (threadId: string) => {
    const thread = threads.find(t => t.id === threadId);
    if (!thread || thread.turns.length === 0) return;
    const lastTurn = thread.turns[thread.turns.length - 1];
    setActiveThreadId(threadId);
    setResult(lastTurn.result);
    setSearched(lastTurn.query);
    setError(null);
    setQuery("");
    setFollowQuery("");
    setSidebarOpen(false);
  };

  const removeThread = async (e: React.MouseEvent, threadId: string) => {
    e.stopPropagation();
    if (!isGuest) await deleteSearchSession(token, threadId).catch(() => {});
    setThreads(prev => prev.filter(t => t.id !== threadId));
    if (activeThreadId === threadId) resetSearchView();
  };

  const exportSearch = async () => {
    if (!result) return;
    const { buildSearchReportHTML, printHTML } = await import("../../utils/export");
    const opened = printHTML(buildSearchReportHTML(searched, result));
    if (!opened) toast.error("Popup blocked. Enable popups, then retry export.");
  };

  return (
    <div className="flex min-h-0 gap-0">
      {isMobile && sidebarOpen && (
        <div onClick={() => setSidebarOpen(false)} className="fixed inset-0 bg-black/67 z-[99]" />
      )}

      <div className={cn(
        "flex flex-col",
        isMobile
          ? cn("fixed top-0 h-full w-[85vw] max-w-[320px] bg-popover border-r border-muted z-[100] p-3 transition-[left] duration-250 ease-in-out", sidebarOpen ? "left-0" : "left-[-85vw]")
          : "w-[230px] shrink-0 border-r border-muted mr-4"
      )}>
        <div className="flex gap-1.5 mb-2.5">
          <Button variant="outline" size="sm" onClick={resetSearchView} className="flex-1 justify-start gap-1.5 text-xs">
            <Plus className="w-3.5 h-3.5" /> New search
          </Button>
          {isMobile && (
            <Button variant="ghost" size="icon" onClick={() => setSidebarOpen(false)} className="text-muted-foreground text-base"><X className="w-4 h-4" /></Button>
          )}
        </div>

        <div className="grid grid-cols-1 gap-1 mb-2.5">
          <button
            onClick={() => setSidebarTab("history")}
            className={cn("text-left px-2.5 py-2 text-xs border rounded-md transition-all", sidebarTab === "history" ? "bg-accent/15 border-accent/25 text-foreground" : "bg-transparent border-transparent text-slate-400 hover:bg-muted")}
          >
            Search history
          </button>
          <button
            onClick={() => setSidebarTab("chats")}
            className={cn("text-left px-2.5 py-2 text-xs border rounded-md transition-all", sidebarTab === "chats" ? "bg-accent/15 border-accent/25 text-foreground" : "bg-transparent border-transparent text-slate-400 hover:bg-muted")}
          >
            Search chats
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {sidebarTab === "history" ? (
            <>
              {!isGuest && history.length > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full mb-2 text-[10px] h-7 px-2"
                  onClick={() => clearSearchHistory(token).then(() => setHistory([])).catch(() => {})}
                >
                  Clear history
                </Button>
              )}
              {history.length === 0 ? (
                <p className="text-[11px] text-border px-0.5 py-1 leading-relaxed">
                  {isGuest ? "Guest mode: search history not saved." : "No recent searches yet."}
                </p>
              ) : (
                history.map(h => (
                  <button
                    key={h.id}
                    onClick={() => doSearch(h.query)}
                    className="w-full text-left px-2.5 py-2 mb-0.5 rounded-md cursor-pointer transition-all duration-100 border bg-transparent border-transparent hover:bg-muted text-xs text-slate-400"
                    title={h.query}
                  >
                    {h.query}
                  </button>
                ))
              )}
            </>
          ) : threadsLoading ? (
            <p className="text-[11px] text-border px-0.5 py-1">Loading…</p>
          ) : threads.length === 0 ? (
            <p className="text-[11px] text-border px-0.5 py-1 leading-relaxed">No search chats yet. New search creates one.</p>
          ) : (
            threads.map(thread => {
              const isActive = thread.id === activeThreadId;
              const isHovered = thread.id === hoveredThreadId;
              return (
                <div
                  key={thread.id}
                  onClick={() => loadThread(thread.id)}
                  onMouseEnter={() => setHoveredThreadId(thread.id)}
                  onMouseLeave={() => setHoveredThreadId(null)}
                  className={cn(
                    "w-full text-left px-2.5 py-2 mb-0.5 rounded-md cursor-pointer transition-all duration-100 border flex items-start gap-1.5",
                    isActive ? "bg-accent/15 border-accent/25" : "bg-transparent border-transparent hover:bg-muted"
                  )}
                  title={thread.title}
                >
                  <div className="flex-1 min-w-0">
                    <span className={cn("block text-xs truncate", isActive ? "text-foreground" : "text-slate-400")}>{thread.title}</span>
                    <span className="block text-[10px] text-border mt-0.5">{thread.turns.length} turn{thread.turns.length > 1 ? "s" : ""}</span>
                  </div>
                  {isHovered && (
                    <button
                      onClick={e => removeThread(e, thread.id)}
                      className="bg-transparent border-none text-muted-foreground cursor-pointer text-sm px-0.5 leading-none shrink-0 hover:text-destructive transition-colors"
                      title="Delete search chat"
                    >
                      ×
                    </button>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>

      <div className="flex-1 min-w-0">
        <div className="max-w-[860px] mx-auto px-1 sm:px-0">
          {/* ── Search bar with Trie autocomplete ── */}
          <div className="relative mb-4">
            <div className={cn("flex gap-2", isMobile && "flex-col")}>
              {isMobile && (
                <Button variant="outline" size="icon" onClick={() => setSidebarOpen(true)} title="Search sidebar" className="min-h-11 min-w-11"><Menu className="w-4 h-4" /></Button>
              )}
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

          {loading && (
            <div className="bg-card border border-emerald-500/20 border-l-[3px] border-l-emerald-500 rounded-[0_12px_12px_0] px-5 py-4 flex items-center gap-3.5" style={{ animation: "fadeInUp .2s ease-out" }}>
              <div className="w-8 h-8 rounded-full border-[2.5px] border-muted border-t-emerald-500 animate-spin shrink-0" />
              <div>
                <p className="text-sm text-foreground font-semibold mb-0.5">Searching the web…</p>
                <p className="text-xs text-muted-foreground">Querying World Bank, IMF, Reuters, Bloomberg and authoritative sources</p>
              </div>
            </div>
          )}

          {error && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription><strong>Search error:</strong> {error}</AlertDescription>
            </Alert>
          )}

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
                  <Button variant="outline" size="sm" className="text-xs" onClick={resetSearchView}>
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
                </div>
                <MarkdownText text={result.text} />
              </div>

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
      </div>
    </div>
  );
}
