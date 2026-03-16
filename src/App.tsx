// ─────────────────────────────────────────────────────────────────────────────
// APP SHELL  —  top-level layout: auth gate, header, mode navigation.
// Shows AuthPage when the user is not logged in; the full dashboard otherwise.
// ─────────────────────────────────────────────────────────────────────────────
import { useState, useEffect } from "react";
import type { Mode, User } from "./types";
import { fetchMe } from "./utils/api";
import AuthPage    from "./components/auth/AuthPage";
import DashboardMode from "./components/modes/DashboardMode";
import ChatMode      from "./components/modes/ChatMode";
import SearchMode    from "./components/modes/SearchMode";
import DataMode      from "./components/modes/DataMode";
import AnalyticsMode from "./components/modes/AnalyticsMode";

const MODES: [Mode, string][] = [
  ["chat",      "💬 AI Chat"],
  ["search",    "🔍 Search"],
  ["data",      "📁 Data"],
  ["analytics", "🧮 Analytics"],
  ["dashboard", "🇰🇿 KZ Data"],
];

const MODE_META: Record<Mode, { label: string; desc: string; color: string }> = {
  chat:      { label: "AI Chat",            color: "#8B5CF6", desc: "Ask any economic question — Claude generates interactive charts and analysis from your query" },
  search:    { label: "Web Search",         color: "#10B981", desc: "Live web search · Claude pulls and summarises current data from authoritative sources" },
  data:      { label: "Data Upload",        color: "#F59E0B", desc: "Upload a CSV file · Claude analyses your data and creates charts automatically" },
  analytics: { label: "Analytics",          color: "#EF4444", desc: "Algorithms from scratch: OLS Regression · HHI Concentration · K-Means Clustering · Z-Score Anomaly Detection" },
  dashboard: { label: "Kazakhstan Data",    color: "#00AAFF", desc: "Pre-built charts with 15 years of Kazakhstan economic data — GDP, trade, exports, imports" },
};

export default function App() {
  const [user,      setUser]      = useState<User | null>(null);
  const [token,     setToken]     = useState<string | null>(null);
  const [authReady, setAuthReady] = useState(false);   // prevents flash of auth page on refresh
  const [mode,      setMode]      = useState<Mode>("chat");
  const [yearRange, setYearRange] = useState<[number, number]>([2010, 2024]);

  // On mount: restore session from localStorage and validate the token
  useEffect(() => {
    const stored = localStorage.getItem("ec_token");
    if (!stored) { setAuthReady(true); return; }
    fetchMe(stored)
      .then(u => { setToken(stored); setUser(u); })
      .catch(() => { localStorage.removeItem("ec_token"); })
      .finally(() => setAuthReady(true));
  }, []);

  const handleAuth = (t: string, u: User) => {
    localStorage.setItem("ec_token", t);
    setToken(t);
    setUser(u);
  };

  const logout = () => {
    localStorage.removeItem("ec_token");
    setToken(null);
    setUser(null);
  };

  // Don't render until we've checked localStorage (avoids auth page flash)
  if (!authReady) return null;

  // Unauthenticated: show landing + login/register
  if (!user || !token) return <AuthPage onAuth={handleAuth} />;

  const { label, desc, color } = MODE_META[mode];
  const modeIcon = MODES.find(m => m[0] === mode)?.[1].split(" ")[0] ?? "";

  return (
    <div style={{ fontFamily: "Inter,sans-serif", background: "#0f1117", height: "100vh", display: "flex", flexDirection: "column", color: "#e2e8f0" }}>

      {/* ── Header ── */}
      <div style={{ padding: "10px 20px", borderBottom: "1px solid #1e2130", display: "flex", alignItems: "center", gap: 12, flexShrink: 0, flexWrap: "wrap" }}>

        {/* Brand */}
        <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
          <div style={{ width: 32, height: 32, borderRadius: 8, background: "linear-gradient(135deg,#00AAFF,#8B5CF6)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>📊</div>
          <span style={{ fontSize: 15, fontWeight: 800, color: "#fff" }}>EconChart</span>
        </div>

        {/* Mode tabs */}
        <div style={{ marginLeft: 16, display: "flex", background: "#1e2130", borderRadius: 9, padding: 3, border: "1px solid #2d3348", gap: 2, flexWrap: "nowrap" }}>
          {MODES.map(([m, lbl]) => (
            <button key={m} onClick={() => setMode(m)} style={{
              background: mode === m ? MODE_META[m].color : "transparent",
              color: mode === m ? "#fff" : "#94a3b8",
              border: "none", borderRadius: 7, padding: "6px 13px",
              fontSize: 12, fontWeight: 600, cursor: "pointer", transition: "all .2s", whiteSpace: "nowrap",
            }}>{lbl}</button>
          ))}
        </div>

        {/* Year filter — dashboard only */}
        {mode === "dashboard" && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, background: "#1e2130", border: "1px solid #2d3348", borderRadius: 8, padding: "6px 14px" }}>
            <span style={{ fontSize: 11, color: "#64748b" }}>Years:</span>
            <input type="range" min="2010" max="2024" value={yearRange[0]} onChange={e => setYearRange([+e.target.value, yearRange[1]])} style={{ width: 65, accentColor: "#00AAFF", cursor: "pointer" }} />
            <span style={{ fontSize: 11, color: "#00AAFF", minWidth: 28 }}>{yearRange[0]}</span>
            <span style={{ fontSize: 11, color: "#64748b" }}>–</span>
            <input type="range" min="2010" max="2024" value={yearRange[1]} onChange={e => setYearRange([yearRange[0], +e.target.value])} style={{ width: 65, accentColor: "#00AAFF", cursor: "pointer" }} />
            <span style={{ fontSize: 11, color: "#00AAFF", minWidth: 28 }}>{yearRange[1]}</span>
          </div>
        )}

        {/* User + logout */}
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, background: "#1e2130", border: "1px solid #2d3348", borderRadius: 8, padding: "6px 12px" }}>
            <div style={{ width: 22, height: 22, borderRadius: "50%", background: "linear-gradient(135deg,#00AAFF,#8B5CF6)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, color: "#fff", flexShrink: 0 }}>
              {user.name.charAt(0).toUpperCase()}
            </div>
            <span style={{ fontSize: 12, color: "#e2e8f0", maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{user.name}</span>
          </div>
          <button onClick={logout}
            style={{ background: "transparent", border: "1px solid #2d3348", borderRadius: 7, padding: "6px 12px", fontSize: 11, color: "#64748b", cursor: "pointer", transition: "all .15s" }}
            onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = "#EF4444"; (e.currentTarget as HTMLButtonElement).style.borderColor = "#EF4444"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = "#64748b"; (e.currentTarget as HTMLButtonElement).style.borderColor = "#2d3348"; }}>
            Sign out
          </button>
        </div>
      </div>

      {/* ── Mode badge + description ── */}
      <div style={{ padding: "6px 20px", borderBottom: "1px solid #1e2130", flexShrink: 0, display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ fontSize: 11, borderRadius: 5, padding: "2px 10px", fontWeight: 600, background: color + "22", color, border: `1px solid ${color}44` }}>
          {modeIcon} {label}
        </span>
        <span style={{ fontSize: 11, color: "#64748b" }}>{desc}</span>
      </div>

      {/* ── Main content ── */}
      <div style={{ flex: 1, overflowY: mode === "chat" ? "hidden" : "auto", padding: mode === "chat" ? "16px 20px 0" : "20px 20px" }}>
        {mode === "chat"       && <div style={{ maxWidth: 1060, margin: "0 auto", height: "100%", display: "flex", flexDirection: "column" }}><ChatMode token={token} /></div>}
        {mode === "search"     && <SearchMode />}
        {mode === "data"       && <DataMode />}
        {mode === "analytics"  && <AnalyticsMode />}
        {mode === "dashboard"  && <div style={{ maxWidth: 1100, margin: "0 auto" }}><DashboardMode yearRange={yearRange} setYearRange={setYearRange} /></div>}
      </div>

      <style>{`
        @keyframes spin { 0%{transform:rotate(0deg)} 100%{transform:rotate(360deg)} }
        ::-webkit-scrollbar { width:6px }
        ::-webkit-scrollbar-track { background:#0f1117 }
        ::-webkit-scrollbar-thumb { background:#2d3348; border-radius:3px }
      `}</style>
    </div>
  );
}
