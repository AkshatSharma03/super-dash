// ─────────────────────────────────────────────────────────────────────────────
// AI CHAT MODE  —  conversational interface backed by Claude via /api/chat.
// Left sidebar: persistent chat history (sessions). Right: active conversation.
// ─────────────────────────────────────────────────────────────────────────────
import { useState, useRef, useEffect } from "react";
import { CHAT_SUGGESTIONS } from "../../data/suggestions";
import { useMobile } from "../../utils/useMobile";
import { askClaude, getSessions, getSession, createSession, updateSession, deleteSession } from "../../utils/api";
import type { Message, AIResponse, ChatSession } from "../../types";
import { ChartCard, SourceList } from "../ui";
import { buildChatReportHTML, printHTML } from "../../utils/export";
import { Button } from "@/components/ui/button";
import { Input }  from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { cn } from "@/lib/utils";
import { AlertTriangle } from "lucide-react";

// ── ChatMessage sub-component ─────────────────────────────────────────────────

function ChatMessage({ msg, onFollowUp }: { msg: Message; onFollowUp: (q: string) => void }) {
  if (msg.role === "user") return (
    <div className="flex justify-end mb-3.5">
      <div className="text-white rounded-[14px_14px_3px_14px] px-4 py-2.5 max-w-[72%] text-sm leading-[1.55] shadow-[0_2px_8px_#00AAFF30]"
        style={{ background: "linear-gradient(135deg, #0099EE, #0077CC)" }}>
        {msg.content}
      </div>
    </div>
  );

  const { insight, charts = [], sources = [], followUps = [], error }: AIResponse = msg.content ?? {};
  return (
    <div className="mb-5" style={{ animation: "fadeInUp .25s ease-out" }}>
      {insight && (
        <div className="bg-[#1a1d2e] border border-border border-l-[3px] border-l-accent rounded-[0_12px_12px_0] p-4 mb-3.5">
          <div className="flex gap-2 items-center mb-2">
            <div className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] shrink-0"
              style={{ background: "linear-gradient(135deg,#8B5CF6,#6D28D9)" }}>✦</div>
            <span className="text-[10px] text-accent font-bold uppercase tracking-[0.8px]">Analysis</span>
          </div>
          <p className="text-sm text-slate-300 leading-[1.75]">{insight}</p>
        </div>
      )}
      {error && (
        <Alert variant="destructive" className="mb-3.5">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {charts.map(chart => <ChartCard key={chart.id} chart={chart} />)}
      <SourceList sources={sources} className="mb-2.5" />
      {followUps.length > 0 && (
        <div className="flex gap-1.5 flex-wrap">
          {followUps.map((q, i) => (
            <button key={i} onClick={() => onFollowUp(q)}
              className="bg-card border border-border rounded-full px-3 py-1.5 text-xs text-muted-foreground cursor-pointer transition-all hover:border-accent/40 hover:text-accent hover:bg-accent/10">
              {q}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── ChatMode root ─────────────────────────────────────────────────────────────

interface ChatModeProps { token: string; isGuest?: boolean; }

export default function ChatMode({ token, isGuest = false }: ChatModeProps) {
  const [messages,         setMessages]         = useState<Message[]>([]);
  const [input,            setInput]            = useState("");
  const [loading,          setLoading]          = useState(false);
  const [sessions,         setSessions]         = useState<ChatSession[]>([]);
  const [activeSessionId,  setActiveSessionId]  = useState<string | null>(null);
  const [sessionsLoading,  setSessionsLoading]  = useState(true);
  const [hoveredSession,   setHoveredSession]   = useState<string | null>(null);
  const [sidebarOpen,      setSidebarOpen]      = useState(false);
  const isMobile = useMobile();
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef  = useRef<HTMLInputElement>(null);

  // Load session list on mount
  useEffect(() => {
    getSessions(token)
      .then(setSessions)
      .catch(() => {})
      .finally(() => setSessionsLoading(false));
  }, [token]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  const newChat = () => {
    setMessages([]);
    setActiveSessionId(null);
    setInput("");
    inputRef.current?.focus();
  };

  const loadSession = async (sessionId: string) => {
    if (sessionId === activeSessionId) return;
    try {
      const session = await getSession(token, sessionId);
      setMessages(session.messages as Message[]);
      setActiveSessionId(sessionId);
    } catch { /* silently ignore */ }
  };

  const removeSession = async (e: React.MouseEvent, sessionId: string) => {
    e.stopPropagation();
    await deleteSession(token, sessionId).catch(() => {});
    setSessions(prev => prev.filter(s => s.id !== sessionId));
    if (activeSessionId === sessionId) newChat();
  };

  const send = async (query: string) => {
    if (!query.trim() || loading) return;
    const q = query.trim();
    setInput("");
    const nextMessages: Message[] = [...messages, { role: "user", content: q }];
    setMessages(nextMessages);
    setLoading(true);

    try {
      const history = nextMessages.map(m => ({
        role:    m.role,
        content: m.role === "user" ? m.content as string : JSON.stringify(m.content),
      }));
      const result = await askClaude(history);
      const finalMessages: Message[] = [...nextMessages, { role: "assistant", content: result }];
      setMessages(finalMessages);

      if (!isGuest) {
        const sessionTitle = q.slice(0, 60) + (q.length > 60 ? "…" : "");
        if (!activeSessionId) {
          const session = await createSession(token, sessionTitle);
          setActiveSessionId(session.id);
          await updateSession(token, session.id, { messages: finalMessages as unknown[] });
          setSessions(prev => [{ id: session.id, title: session.title, createdAt: session.createdAt, updatedAt: session.updatedAt }, ...prev]);
        } else {
          await updateSession(token, activeSessionId, { messages: finalMessages as unknown[] });
          setSessions(prev => prev.map(s => s.id === activeSessionId ? { ...s, updatedAt: new Date().toISOString() } : s));
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setMessages(prev => [...prev, { role: "assistant", content: { error: "Error: " + msg, charts: [], followUps: [] } }]);
    }
    setLoading(false);
  };

  const exportConversation = () => {
    const title = sessions.find(s => s.id === activeSessionId)?.title ?? "AI Chat Report";
    printHTML(buildChatReportHTML(messages, title));
  };

  const isEmpty = messages.length === 0;

  return (
    <div className="flex h-full gap-0 overflow-hidden">

      {/* Mobile sidebar backdrop */}
      {isMobile && sidebarOpen && (
        <div onClick={() => setSidebarOpen(false)} className="fixed inset-0 bg-black/67 z-[99]" />
      )}

      {/* ── Left sidebar: session history ── */}
      <div className={cn(
        "flex flex-col",
        isMobile
          ? cn("fixed top-0 h-full w-[260px] bg-popover border-r border-muted z-[100] p-3 transition-[left] duration-250 ease-in-out",
              sidebarOpen ? "left-0" : "left-[-260px]")
          : "w-[210px] shrink-0 border-r border-muted mr-4"
      )}>
        <div className="flex gap-1.5 mb-2.5">
          <Button variant="outline" size="sm" onClick={newChat} className="flex-1 justify-start gap-1.5 text-xs">
            <span>✦</span> New chat
          </Button>
          {isMobile && (
            <Button variant="ghost" size="icon" onClick={() => setSidebarOpen(false)} className="text-muted-foreground text-base">✕</Button>
          )}
        </div>

        <div className="flex-1 overflow-y-auto">
          {isGuest ? (
            <div className="bg-card border border-border rounded-lg p-3 mb-2">
              <p className="text-xs text-slate-400 leading-[1.55] mb-2">
                You're in guest mode. Chats are not saved between sessions.
              </p>
              <a href="#" onClick={e => { e.preventDefault(); window.location.reload(); }}
                className="text-[11px] font-bold text-primary no-underline">
                Sign up free to save history →
              </a>
            </div>
          ) : sessionsLoading ? (
            <p className="text-[11px] text-border px-0.5 py-1">Loading…</p>
          ) : sessions.length === 0 ? (
            <p className="text-[11px] text-border px-0.5 py-1 leading-relaxed">No saved chats yet.<br />Your conversations will appear here.</p>
          ) : (
            sessions.map(s => {
              const isActive  = s.id === activeSessionId;
              const isHovered = s.id === hoveredSession;
              return (
                <div key={s.id} onClick={() => loadSession(s.id)}
                  onMouseEnter={() => setHoveredSession(s.id)}
                  onMouseLeave={() => setHoveredSession(null)}
                  className={cn(
                    "flex items-center gap-1.5 px-2.5 py-2 mb-0.5 rounded-md cursor-pointer transition-all duration-100 border",
                    isActive
                      ? "bg-accent/15 border-accent/25"
                      : isHovered
                        ? "bg-muted border-transparent"
                        : "bg-transparent border-transparent"
                  )}>
                  <span className={cn("flex-1 text-xs overflow-hidden text-ellipsis whitespace-nowrap leading-[1.4]",
                    isActive ? "text-foreground" : "text-slate-400")}>
                    {s.title}
                  </span>
                  {isHovered && (
                    <button onClick={e => removeSession(e, s.id)}
                      className="bg-transparent border-none text-muted-foreground cursor-pointer text-sm px-0.5 leading-none shrink-0 hover:text-destructive transition-colors">
                      ×
                    </button>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* ── Right: active conversation ── */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="flex-1 overflow-y-auto pb-2">

          {isEmpty ? (
            <div className="max-w-[640px] mx-auto pt-5" style={{ animation: "fadeInUp .3s ease-out" }}>
              <div className="text-center mb-7">
                <div className="w-14 h-14 rounded-2xl flex items-center justify-center text-[26px] mx-auto mb-3.5 shadow-[0_0_24px_#8B5CF644]"
                  style={{ background: "linear-gradient(135deg,#8B5CF6,#00AAFF)" }}>💬</div>
                <h2 className="text-lg font-extrabold text-white tracking-[-0.3px] mb-2">Ask anything about any economy</h2>
                <p className="text-[13px] text-muted-foreground leading-[1.65]">
                  Generate interactive charts and expert analysis from World Bank, IMF, UN Comtrade, and OECD data.<br />
                  Ask about any country, sector, or time period.
                </p>
              </div>
              <div className={cn("grid gap-2", isMobile ? "grid-cols-1" : "grid-cols-2")}>
                {CHAT_SUGGESTIONS.map((s, i) => (
                  <button key={i} onClick={() => send(s)}
                    className="bg-card border border-border rounded-xl px-3.5 py-3 text-xs text-muted-foreground cursor-pointer text-left leading-relaxed transition-all hover:border-accent/40 hover:text-slate-300 hover:bg-[#1a1d2e]">
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="max-w-[820px] mx-auto">
              {messages.map((m, i) => (
                <ChatMessage key={i} msg={m} onFollowUp={q => { setInput(q); inputRef.current?.focus(); }} />
              ))}
              {loading && (
                <div className="bg-[#1a1d2e] border border-accent/20 border-l-[3px] border-l-accent rounded-[0_12px_12px_0] px-4 py-3 inline-flex gap-2.5 items-center mb-4">
                  <div className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] shrink-0"
                    style={{ background: "linear-gradient(135deg,#8B5CF6,#6D28D9)" }}>✦</div>
                  <span className="text-[13px] text-muted-foreground">Generating charts and analysis</span>
                  <div className="flex gap-0.75 items-center">
                    {[0, 1, 2].map(i => (
                      <span key={i} className="w-1.5 h-1.5 rounded-full bg-accent block"
                        style={{ animation: `typingDot 1.2s ease-in-out ${i * 0.22}s infinite` }} />
                    ))}
                  </div>
                </div>
              )}
              <div ref={bottomRef} />
            </div>
          )}
        </div>

        {/* ── Input bar ── */}
        <div className="border-t border-muted pt-3 shrink-0">
          <div className="max-w-[820px] mx-auto flex gap-2">
            {isMobile && (
              <Button variant="outline" size="icon" onClick={() => setSidebarOpen(true)} title="Chat history">☰</Button>
            )}
            {messages.length > 0 && (
              <>
                <Button variant="outline" size="sm" onClick={newChat} className="whitespace-nowrap">Clear</Button>
                <Button variant="outline" size="sm" onClick={exportConversation} className="whitespace-nowrap" title="Export conversation as PDF/HTML report with charts and citations">
                  Export ↓
                </Button>
              </>
            )}
            <Input ref={inputRef} value={input} onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === "Enter" && !e.shiftKey && send(input)}
              placeholder="Ask about GDP, trade flows, inflation, interest rates, any country…"
              disabled={loading} className="flex-1 h-10 focus-visible:ring-accent" />
            <Button onClick={() => send(input)} disabled={loading || !input.trim()}
              className="whitespace-nowrap bg-gradient-to-br from-[#8B5CF6] to-[#6D28D9] shadow-[0_2px_10px_#8B5CF644] font-bold">
              {loading ? "…" : "Send →"}
            </Button>
          </div>
          <p className="text-center text-[10px] text-border mt-2">
            Powered by Claude · World Bank · IMF · UN Comtrade · OECD · Enter to send
          </p>
        </div>
      </div>
    </div>
  );
}
