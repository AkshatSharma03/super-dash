// ─────────────────────────────────────────────────────────────────────────────
// AI CHAT MODE  —  conversational interface backed by Claude via /api/chat.
// Left sidebar: persistent chat history (sessions). Right: active conversation.
// Sessions are created on the first message and synced to the backend after
// each assistant response.
// ─────────────────────────────────────────────────────────────────────────────
import { useState, useRef, useEffect } from "react";
import { CHAT_SUGGESTIONS } from "../../data/kazakhstan";
import { askClaude, getSessions, getSession, createSession, updateSession, deleteSession } from "../../utils/api";
import type { Message, AIResponse, ChatSession } from "../../types";
import { DynChart } from "../ui";

// ── ChatMessage sub-component ─────────────────────────────────────────────────

function ChatMessage({ msg, onFollowUp }: { msg: Message; onFollowUp: (q: string) => void }) {
  if (msg.role === "user") return (
    <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 14 }}>
      <div style={{ background: "#00AAFF", color: "#fff", borderRadius: "12px 12px 3px 12px", padding: "10px 16px", maxWidth: "72%", fontSize: 14 }}>
        {msg.content}
      </div>
    </div>
  );

  const { insight, charts = [], sources = [], followUps = [], error }: AIResponse = msg.content ?? {};
  return (
    <div style={{ marginBottom: 22 }}>
      {insight && (
        <div style={{ background: "#1e2130", border: "1px solid #2d3348", borderRadius: 12, padding: 16, marginBottom: 14 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
            <span style={{ fontSize: 15 }}>🤖</span>
            <span style={{ fontSize: 11, color: "#8B5CF6", fontWeight: 700, textTransform: "uppercase" }}>Analysis</span>
          </div>
          <p style={{ margin: 0, fontSize: 14, color: "#cbd5e1", lineHeight: 1.75 }}>{insight}</p>
        </div>
      )}
      {error && (
        <div style={{ background: "#EF444422", border: "1px solid #EF4444", borderRadius: 10, padding: 14, marginBottom: 14, fontSize: 13, color: "#EF4444" }}>
          {error}
        </div>
      )}
      {charts.map(chart => (
        <div key={chart.id} style={{ background: "#1e2130", border: "1px solid #2d3348", borderRadius: 12, padding: 18, marginBottom: 12 }}>
          <h3 style={{ margin: "0 0 4px", fontSize: 14, color: "#e2e8f0", fontWeight: 600 }}>{chart.title}</h3>
          {chart.description && <p style={{ margin: "0 0 12px", fontSize: 12, color: "#64748b" }}>{chart.description}</p>}
          <DynChart chart={chart} />
        </div>
      ))}
      {sources.length > 0 && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10, alignItems: "center" }}>
          <span style={{ fontSize: 11, color: "#64748b" }}>Sources:</span>
          {sources.map((s, i) =>
            s.url ? (
              <a key={i} href={s.url} target="_blank" rel="noopener noreferrer"
                style={{ fontSize: 11, color: "#00AAFF", background: "#1e2130", border: "1px solid #2d334880", borderRadius: 4, padding: "2px 8px", textDecoration: "none", transition: "border-color .15s" }}
                onMouseEnter={e => { (e.currentTarget as HTMLAnchorElement).style.borderColor = "#00AAFF"; }}
                onMouseLeave={e => { (e.currentTarget as HTMLAnchorElement).style.borderColor = "#2d334880"; }}>
                {s.title} ↗
              </a>
            ) : (
              <span key={i} style={{ fontSize: 11, color: "#64748b", background: "#1e2130", border: "1px solid #2d3348", borderRadius: 4, padding: "2px 8px" }}>{s.title}</span>
            )
          )}
        </div>
      )}
      {followUps.length > 0 && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {followUps.map((q, i) => (
            <button key={i} onClick={() => onFollowUp(q)}
              style={{ background: "transparent", border: "1px solid #2d3348", borderRadius: 20, padding: "5px 12px", fontSize: 12, color: "#94a3b8", cursor: "pointer", transition: "all .15s" }}
              onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = "#8B5CF6"; (e.currentTarget as HTMLButtonElement).style.color = "#8B5CF6"; }}
              onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = "#2d3348"; (e.currentTarget as HTMLButtonElement).style.color = "#94a3b8"; }}>
              {q}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── ChatMode root ─────────────────────────────────────────────────────────────

interface ChatModeProps { token: string; }

export default function ChatMode({ token }: ChatModeProps) {
  const [messages,         setMessages]         = useState<Message[]>([]);
  const [input,            setInput]            = useState("");
  const [loading,          setLoading]          = useState(false);
  const [sessions,         setSessions]         = useState<ChatSession[]>([]);
  const [activeSessionId,  setActiveSessionId]  = useState<string | null>(null);
  const [sessionsLoading,  setSessionsLoading]  = useState(true);
  const [hoveredSession,   setHoveredSession]   = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef  = useRef<HTMLInputElement>(null);

  // Load session list on mount
  useEffect(() => {
    getSessions(token)
      .then(setSessions)
      .catch(() => {})
      .finally(() => setSessionsLoading(false));
  }, [token]);

  // Auto-scroll on new messages
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, loading]);

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

      // Persist: create session on first message, then patch on subsequent ones
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
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setMessages(prev => [...prev, { role: "assistant", content: { error: "Error: " + msg, charts: [], followUps: [] } }]);
    }
    setLoading(false);
  };

  const isEmpty = messages.length === 0;

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div style={{ display: "flex", height: "100%", gap: 0, overflow: "hidden" }}>

      {/* ── Left sidebar: session history ── */}
      <div style={{ width: 210, flexShrink: 0, display: "flex", flexDirection: "column", borderRight: "1px solid #1e2130", paddingRight: 0, marginRight: 16 }}>

        <button onClick={newChat}
          style={{ margin: "0 0 10px", background: "#1e2130", border: "1px solid #2d3348", borderRadius: 8, padding: "9px 14px", fontSize: 12, fontWeight: 600, color: "#e2e8f0", cursor: "pointer", textAlign: "left", transition: "all .15s" }}
          onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = "#8B5CF6"; }}
          onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = "#2d3348"; }}>
          ✦ New chat
        </button>

        <div style={{ flex: 1, overflowY: "auto" }}>
          {sessionsLoading ? (
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
            <div style={{ maxWidth: 640, margin: "0 auto", paddingTop: 16 }}>
              <div style={{ textAlign: "center", marginBottom: 28 }}>
                <div style={{ fontSize: 38, marginBottom: 10 }}>💬</div>
                <h2 style={{ margin: "0 0 8px", fontSize: 18, fontWeight: 800, color: "#fff" }}>Ask anything about any economy</h2>
                <p style={{ margin: 0, fontSize: 13, color: "#64748b", lineHeight: 1.6 }}>
                  Generate interactive charts and expert analysis from World Bank, IMF, UN Comtrade, and OECD data.<br />
                  Ask about any country, sector, or time period.
                </p>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                {CHAT_SUGGESTIONS.map((s, i) => (
                  <button key={i} onClick={() => send(s)}
                    style={{ background: "#1e2130", border: "1px solid #2d3348", borderRadius: 10, padding: "12px 14px", fontSize: 13, color: "#94a3b8", cursor: "pointer", textAlign: "left", lineHeight: 1.4, transition: "all .15s" }}
                    onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = "#8B5CF6"; (e.currentTarget as HTMLButtonElement).style.color = "#e2e8f0"; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = "#2d3348"; (e.currentTarget as HTMLButtonElement).style.color = "#94a3b8"; }}>
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
                <div style={{ background: "#1e2130", border: "1px solid #2d3348", borderRadius: 12, padding: "14px 18px", display: "inline-flex", gap: 10, alignItems: "center", marginBottom: 16 }}>
                  <span style={{ fontSize: 14 }}>🤖</span>
                  <span style={{ fontSize: 13, color: "#64748b" }}>Generating charts and analysis…</span>
                  <span style={{ animation: "spin 1s linear infinite", display: "inline-block" }}>⏳</span>
                </div>
              )}
              <div ref={bottomRef} />
            </div>
          )}
        </div>

        {/* ── Input bar ── */}
        <div style={{ borderTop: "1px solid #1e2130", paddingTop: 12, flexShrink: 0 }}>
          <div style={{ maxWidth: 820, margin: "0 auto", display: "flex", gap: 10 }}>
            {messages.length > 0 && (
              <button onClick={newChat}
                style={{ background: "transparent", border: "1px solid #2d3348", borderRadius: 8, padding: "10px 14px", fontSize: 12, color: "#64748b", cursor: "pointer", whiteSpace: "nowrap" }}>
                Clear
              </button>
            )}
            <input ref={inputRef} value={input} onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === "Enter" && !e.shiftKey && send(input)}
              placeholder="Ask about GDP, trade flows, inflation, interest rates, any country…"
              disabled={loading}
              style={{ flex: 1, background: "#1e2130", border: "1px solid #2d3348", borderRadius: 10, padding: "11px 16px", color: "#e2e8f0", fontSize: 13, outline: "none", transition: "border-color .15s" }}
              onFocus={e => { (e.target as HTMLInputElement).style.borderColor = "#8B5CF6"; }}
              onBlur={e  => { (e.target as HTMLInputElement).style.borderColor = "#2d3348"; }} />
            <button onClick={() => send(input)} disabled={loading || !input.trim()}
              style={{ background: loading || !input.trim() ? "#1e2130" : "#8B5CF6", border: "none", borderRadius: 10, padding: "11px 20px", color: loading || !input.trim() ? "#334155" : "#fff", fontSize: 13, fontWeight: 700, cursor: loading || !input.trim() ? "not-allowed" : "pointer", transition: "all .15s", whiteSpace: "nowrap" }}>
              {loading ? "⏳" : "Generate →"}
            </button>
          </div>
          <p style={{ textAlign: "center", fontSize: 11, color: "#334155", marginTop: 8 }}>
            Powered by Claude · Data: World Bank · IMF · UN Comtrade · OECD · Press Enter to send
          </p>
        </div>
      </div>
    </div>
  );
}
