// ─────────────────────────────────────────────────────────────────────────────
// AI CHAT MODE  —  conversational interface backed by Claude via /api/chat.
// Left sidebar: persistent chat history (sessions). Right: active conversation.
// Sessions are created on the first message and synced to the backend after
// each assistant response.
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
import { AlertTriangle } from "lucide-react";

// ── ChatMessage sub-component ─────────────────────────────────────────────────

function ChatMessage({ msg, onFollowUp }: { msg: Message; onFollowUp: (q: string) => void }) {
  if (msg.role === "user") return (
    <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 14 }}>
      <div style={{ background: "linear-gradient(135deg, #0099EE, #0077CC)", color: "#fff", borderRadius: "14px 14px 3px 14px", padding: "10px 16px", maxWidth: "72%", fontSize: 14, lineHeight: 1.55, boxShadow: "0 2px 8px #00AAFF30" }}>
        {msg.content}
      </div>
    </div>
  );

  const { insight, charts = [], sources = [], followUps = [], error }: AIResponse = msg.content ?? {};
  return (
    <div style={{ marginBottom: 22, animation: "fadeInUp .25s ease-out" }}>
      {insight && (
        <div style={{ background: "#1a1d2e", border: "1px solid #2d3348", borderLeft: "3px solid #8B5CF6", borderRadius: "0 12px 12px 0", padding: 16, marginBottom: 14 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
            <div style={{ width: 20, height: 20, borderRadius: "50%", background: "linear-gradient(135deg,#8B5CF6,#6D28D9)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, flexShrink: 0 }}>✦</div>
            <span style={{ fontSize: 10, color: "#8B5CF6", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.8px" }}>Analysis</span>
          </div>
          <p style={{ margin: 0, fontSize: 14, color: "#cbd5e1", lineHeight: 1.75 }}>{insight}</p>
        </div>
      )}
      {error && (
        <Alert variant="destructive" className="mb-3.5">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {charts.map(chart => <ChartCard key={chart.id} chart={chart} />)}
      <SourceList sources={sources} style={{ marginBottom: 10 }} />
      {followUps.length > 0 && (
        <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
          {followUps.map((q, i) => (
            <button key={i} onClick={() => onFollowUp(q)}
              style={{ background: "#161929", border: "1px solid #2d3348", borderRadius: 20, padding: "5px 12px", fontSize: 12, color: "#64748b", cursor: "pointer", transition: "all .15s" }}
              onMouseEnter={e => { const el = e.currentTarget as HTMLButtonElement; el.style.borderColor = "#8B5CF666"; el.style.color = "#8B5CF6"; el.style.background = "#8B5CF610"; }}
              onMouseLeave={e => { const el = e.currentTarget as HTMLButtonElement; el.style.borderColor = "#2d3348"; el.style.color = "#64748b"; el.style.background = "#161929"; }}>
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

  // Auto-scroll when messages change (not on every loading toggle to avoid stutter)
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  // ── Start a brand-new chat ──────────────────────────────────────────────────
  const newChat = () => {
    setMessages([]);
    setActiveSessionId(null);
    setInput("");
    inputRef.current?.focus();
  };

  // ── Load an existing session ────────────────────────────────────────────────
  const loadSession = async (sessionId: string) => {
    if (sessionId === activeSessionId) return;
    try {
      const session = await getSession(token, sessionId);
      setMessages(session.messages as Message[]);
      setActiveSessionId(sessionId);
    } catch { /* silently ignore — session still selectable */ }
  };

  // ── Delete a session ────────────────────────────────────────────────────────
  const removeSession = async (e: React.MouseEvent, sessionId: string) => {
    e.stopPropagation();
    await deleteSession(token, sessionId).catch(() => {});
    setSessions(prev => prev.filter(s => s.id !== sessionId));
    if (activeSessionId === sessionId) newChat();
  };

  // ── Send a message ──────────────────────────────────────────────────────────
  const send = async (query: string) => {
    if (!query.trim() || loading) return;
    const q = query.trim();
    setInput("");
    const nextMessages: Message[] = [...messages, { role: "user", content: q }];
    setMessages(nextMessages);
    setLoading(true);

    try {
      // Serialize history for Claude
      const history = nextMessages.map(m => ({
        role:    m.role,
        content: m.role === "user" ? m.content as string : JSON.stringify(m.content),
      }));
      const result = await askClaude(history);
      const finalMessages: Message[] = [...nextMessages, { role: "assistant", content: result }];
      setMessages(finalMessages);

      // Guests: chat works fully but history is not persisted to the server
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

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div style={{ display: "flex", height: "100%", gap: 0, overflow: "hidden" }}>

      {/* Mobile sidebar backdrop */}
      {isMobile && sidebarOpen && (
        <div onClick={() => setSidebarOpen(false)}
          style={{ position: "fixed", inset: 0, background: "#000000aa", zIndex: 99 }} />
      )}

      {/* ── Left sidebar: session history ── */}
      <div style={isMobile ? {
        position: "fixed", top: 0, left: sidebarOpen ? 0 : -260, width: 260,
        height: "100%", background: "#0a0d14", borderRight: "1px solid #1e2130",
        zIndex: 100, display: "flex", flexDirection: "column",
        padding: "12px 12px", transition: "left .25s ease",
      } : {
        width: 210, flexShrink: 0, display: "flex", flexDirection: "column",
        borderRight: "1px solid #1e2130", paddingRight: 0, marginRight: 16,
      }}>

        <div className="flex gap-1.5 mb-2.5">
          <Button variant="outline" size="sm" onClick={newChat} className="flex-1 justify-start gap-1.5 text-xs">
            <span>✦</span> New chat
          </Button>
          {isMobile && (
            <Button variant="ghost" size="icon" onClick={() => setSidebarOpen(false)} className="text-muted-foreground text-base">✕</Button>
          )}
        </div>

        <div style={{ flex: 1, overflowY: "auto" }}>
          {isGuest ? (
            <div style={{ background: "#161929", border: "1px solid #2d3348", borderRadius: 8, padding: "12px 12px", marginBottom: 8 }}>
              <p style={{ margin: "0 0 8px", fontSize: 12, color: "#94a3b8", lineHeight: 1.55 }}>
                You're in guest mode. Chats are not saved between sessions.
              </p>
              <a href="#" onClick={e => { e.preventDefault(); window.location.reload(); }}
                style={{ fontSize: 11, fontWeight: 700, color: "#00AAFF", textDecoration: "none" }}>
                Sign up free to save history →
              </a>
            </div>
          ) : sessionsLoading ? (
            <p style={{ fontSize: 11, color: "#334155", padding: "4px 2px" }}>Loading…</p>
          ) : sessions.length === 0 ? (
            <p style={{ fontSize: 11, color: "#334155", padding: "4px 2px", lineHeight: 1.5 }}>No saved chats yet.<br />Your conversations will appear here.</p>
          ) : (
            sessions.map(s => {
              const isActive  = s.id === activeSessionId;
              const isHovered = s.id === hoveredSession;
              return (
                <div key={s.id} onClick={() => loadSession(s.id)}
                  onMouseEnter={() => setHoveredSession(s.id)}
                  onMouseLeave={() => setHoveredSession(null)}
                  style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 10px", marginBottom: 2, borderRadius: 7, cursor: "pointer", background: isActive ? "#8B5CF622" : isHovered ? "#1e2130" : "transparent", border: `1px solid ${isActive ? "#8B5CF644" : "transparent"}`, transition: "all .1s" }}>
                  <span style={{ flex: 1, fontSize: 12, color: isActive ? "#e2e8f0" : "#94a3b8", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", lineHeight: 1.4 }}>
                    {s.title}
                  </span>
                  {isHovered && (
                    <button onClick={e => removeSession(e, s.id)}
                      style={{ background: "transparent", border: "none", color: "#64748b", cursor: "pointer", fontSize: 14, padding: "0 2px", lineHeight: 1, flexShrink: 0 }}
                      onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = "#EF4444"; }}
                      onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = "#64748b"; }}>
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
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <div style={{ flex: 1, overflowY: "auto", paddingBottom: 8 }}>

          {isEmpty ? (
            <div style={{ maxWidth: 640, margin: "0 auto", paddingTop: 20, animation: "fadeInUp .3s ease-out" }}>
              <div style={{ textAlign: "center", marginBottom: 28 }}>
                <div style={{ width: 56, height: 56, borderRadius: 16, background: "linear-gradient(135deg,#8B5CF6,#00AAFF)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 26, margin: "0 auto 14px", boxShadow: "0 0 24px #8B5CF644" }}>💬</div>
                <h2 style={{ margin: "0 0 8px", fontSize: 18, fontWeight: 800, color: "#fff", letterSpacing: "-0.3px" }}>Ask anything about any economy</h2>
                <p style={{ margin: 0, fontSize: 13, color: "#475569", lineHeight: 1.65 }}>
                  Generate interactive charts and expert analysis from World Bank, IMF, UN Comtrade, and OECD data.<br />
                  Ask about any country, sector, or time period.
                </p>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 8 }}>
                {CHAT_SUGGESTIONS.map((s, i) => (
                  <button key={i} onClick={() => send(s)}
                    style={{ background: "#161929", border: "1px solid #2d3348", borderRadius: 10, padding: "12px 14px", fontSize: 12, color: "#64748b", cursor: "pointer", textAlign: "left", lineHeight: 1.5, transition: "all .15s" }}
                    onMouseEnter={e => { const el = e.currentTarget as HTMLButtonElement; el.style.borderColor = "#8B5CF666"; el.style.color = "#cbd5e1"; el.style.background = "#1a1d2e"; }}
                    onMouseLeave={e => { const el = e.currentTarget as HTMLButtonElement; el.style.borderColor = "#2d3348"; el.style.color = "#64748b"; el.style.background = "#161929"; }}>
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div style={{ maxWidth: 820, margin: "0 auto" }}>
              {messages.map((m, i) => (
                <ChatMessage key={i} msg={m} onFollowUp={q => { setInput(q); inputRef.current?.focus(); }} />
              ))}
              {loading && (
                <div style={{ background: "#1a1d2e", border: "1px solid #8B5CF633", borderLeft: "3px solid #8B5CF6", borderRadius: "0 12px 12px 0", padding: "12px 16px", display: "inline-flex", gap: 10, alignItems: "center", marginBottom: 16 }}>
                  <div style={{ width: 20, height: 20, borderRadius: "50%", background: "linear-gradient(135deg,#8B5CF6,#6D28D9)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, flexShrink: 0 }}>✦</div>
                  <span style={{ fontSize: 13, color: "#64748b" }}>Generating charts and analysis</span>
                  <div style={{ display: "flex", gap: 3, alignItems: "center" }}>
                    {[0, 1, 2].map(i => (
                      <span key={i} style={{ width: 6, height: 6, borderRadius: "50%", background: "#8B5CF6", display: "block", animation: `typingDot 1.2s ease-in-out ${i * 0.22}s infinite` }} />
                    ))}
                  </div>
                </div>
              )}
              <div ref={bottomRef} />
            </div>
          )}
        </div>

        {/* ── Input bar ── */}
        <div style={{ borderTop: "1px solid #1e2130", paddingTop: 12, flexShrink: 0 }}>
          <div style={{ maxWidth: 820, margin: "0 auto", display: "flex", gap: 8 }}>
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
          <p style={{ textAlign: "center", fontSize: 10, color: "#2d3348", marginTop: 8 }}>
            Powered by Claude · World Bank · IMF · UN Comtrade · OECD · Enter to send
          </p>
        </div>
      </div>
    </div>
  );
}
