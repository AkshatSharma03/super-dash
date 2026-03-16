// ─────────────────────────────────────────────────────────────────────────────
// AI CHAT MODE  —  conversational interface backed by Claude via /api/chat.
// Maintains full message history client-side; sends serialized history on each
// turn. Displays structured AIResponse (insight + chart configs + follow-ups).
// ─────────────────────────────────────────────────────────────────────────────
import { useState, useRef, useEffect } from "react";
import { CHAT_SUGGESTIONS } from "../../data/kazakhstan";
import { askClaude } from "../../utils/api";
import type { Message, AIResponse } from "../../types";
import { DynChart } from "../ui";

// ── ChatMessage sub-component ─────────────────────────────────────────────────
// Kept private to this file — it's an implementation detail of ChatMode.

interface ChatMessageProps {
  msg: Message;
  onFollowUp: (q: string) => void;
}

function ChatMessage({ msg, onFollowUp }: ChatMessageProps) {
  // ── User bubble (right-aligned)
  if (msg.role === "user") return (
    <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 14 }}>
      <div style={{ background: "#00AAFF", color: "#fff", borderRadius: "12px 12px 3px 12px", padding: "10px 16px", maxWidth: "72%", fontSize: 14 }}>
        {msg.content}
      </div>
    </div>
  );

  // ── Assistant response (left-aligned)
  const { insight, charts = [], sources = [], followUps = [], error }: AIResponse = msg.content ?? {};
  return (
    <div style={{ marginBottom: 22 }}>
      {insight && (
        <div style={{ background: "#1e2130", border: "1px solid #2d3348", borderRadius: 12, padding: 16, marginBottom: 14 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
            <span style={{ fontSize: 15 }}>🤖</span>
            <span style={{ fontSize: 11, color: "#00AAFF", fontWeight: 700, textTransform: "uppercase" }}>Analysis</span>
          </div>
          <p style={{ margin: 0, fontSize: 14, color: "#cbd5e1", lineHeight: 1.75 }}>{insight}</p>
        </div>
      )}

      {error && (
        <div style={{ background: "#EF444422", border: "1px solid #EF4444", borderRadius: 10, padding: 14, marginBottom: 14, fontSize: 13, color: "#EF4444" }}>
          {error}
        </div>
      )}

      {/* AI-generated chart cards */}
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

      {/* Follow-up suggestion chips */}
      {followUps.length > 0 && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {followUps.map((q, i) => (
            <button key={i} onClick={() => onFollowUp(q)}
              style={{ background: "transparent", border: "1px solid #2d3348", borderRadius: 20, padding: "5px 12px", fontSize: 12, color: "#94a3b8", cursor: "pointer", transition: "all .15s" }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = "#00AAFF"; e.currentTarget.style.color = "#00AAFF"; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = "#2d3348"; e.currentTarget.style.color = "#94a3b8"; }}>
              {q}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── ChatMode root ─────────────────────────────────────────────────────────────

export default function ChatMode() {
  // ── State
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput]       = useState("");
  const [loading, setLoading]   = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef  = useRef<HTMLInputElement>(null);

  // Auto-scroll to the latest message whenever messages or loading state changes.
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, loading]);

  // ── Handlers
  const send = async (query: string) => {
    if (!query.trim() || loading) return;
    const q = query.trim();
    setInput("");
    setMessages(prev => [...prev, { role: "user", content: q }]);
    setLoading(true);
    try {
      // Serialize history: assistant messages are JSON-stringified AIResponse objects.
      const history = messages.map(m => ({
        role: m.role,
        content: m.role === "user" ? m.content : JSON.stringify(m.content),
      }));
      history.push({ role: "user", content: q });
      const result = await askClaude(history);
      setMessages(prev => [...prev, { role: "assistant", content: result }]);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setMessages(prev => [...prev, { role: "assistant", content: { error: "Error: " + msg, charts: [], followUps: [] } }]);
    }
    setLoading(false);
  };

  const isEmpty = messages.length === 0;

  // ── Render
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div style={{ flex: 1, overflowY: "auto", paddingBottom: 8 }}>

        {/* Empty state: hero + suggestion grid */}
        {isEmpty ? (
          <div style={{ maxWidth: 680, margin: "0 auto", paddingTop: 20 }}>
            <div style={{ textAlign: "center", marginBottom: 28 }}>
              <div style={{ fontSize: 40, marginBottom: 10 }}>💬</div>
              <h2 style={{ margin: "0 0 8px", fontSize: 18, fontWeight: 800, color: "#fff" }}>Ask anything about Kazakhstan's economy</h2>
              <p style={{ margin: 0, fontSize: 13, color: "#64748b", lineHeight: 1.6 }}>
                I generate real charts and expert analysis from World Bank, IMF, UN Comtrade, and policy data.<br />
                Every visualization is built from your query — nothing is pre-loaded.
              </p>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              {CHAT_SUGGESTIONS.map((s, i) => (
                <button key={i} onClick={() => send(s)}
                  style={{ background: "#1e2130", border: "1px solid #2d3348", borderRadius: 10, padding: "12px 14px", fontSize: 13, color: "#94a3b8", cursor: "pointer", textAlign: "left", lineHeight: 1.4, transition: "all .15s" }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = "#00AAFF"; e.currentTarget.style.color = "#e2e8f0"; }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = "#2d3348"; e.currentTarget.style.color = "#94a3b8"; }}>
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

      {/* ── Input bar */}
      <div style={{ borderTop: "1px solid #1e2130", paddingTop: 14, flexShrink: 0 }}>
        <div style={{ maxWidth: 820, margin: "0 auto", display: "flex", gap: 10 }}>
          {messages.length > 0 && (
            <button onClick={() => setMessages([])}
              style={{ background: "transparent", border: "1px solid #2d3348", borderRadius: 8, padding: "10px 14px", fontSize: 12, color: "#64748b", cursor: "pointer", whiteSpace: "nowrap" }}>
              Clear
            </button>
          )}
          <input ref={inputRef} value={input} onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === "Enter" && !e.shiftKey && send(input)}
            placeholder="Ask about GDP, trade flows, imports, exports, digital economy, AI governance…"
            disabled={loading}
            style={{ flex: 1, background: "#1e2130", border: "1px solid #2d3348", borderRadius: 10, padding: "11px 16px", color: "#e2e8f0", fontSize: 13, outline: "none", transition: "border-color .15s" }}
            onFocus={e => { e.target.style.borderColor = "#00AAFF"; }}
            onBlur={e => { e.target.style.borderColor = "#2d3348"; }} />
          <button onClick={() => send(input)} disabled={loading || !input.trim()}
            style={{ background: loading || !input.trim() ? "#1e2130" : "#00AAFF", border: "none", borderRadius: 10, padding: "11px 20px", color: loading || !input.trim() ? "#334155" : "#fff", fontSize: 13, fontWeight: 700, cursor: loading || !input.trim() ? "not-allowed" : "pointer", transition: "all .15s", whiteSpace: "nowrap" }}>
            {loading ? "⏳" : "Generate →"}
          </button>
        </div>
        <p style={{ textAlign: "center", fontSize: 11, color: "#334155", marginTop: 8 }}>
          Powered by Claude · Data: World Bank · IMF · UN Comtrade · stat.gov.kz · Press Enter to send
        </p>
      </div>
    </div>
  );
}
