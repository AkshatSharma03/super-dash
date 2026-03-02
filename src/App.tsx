// ─────────────────────────────────────────────────────────────────────────────
// APP SHELL  —  top-level layout: header, mode navigation, year-range filter.
// Each mode is a self-contained component imported from components/modes/.
// This file intentionally contains no business logic — only routing and layout.
// ─────────────────────────────────────────────────────────────────────────────
import { useState } from "react";
import { COUNTRY } from "./data/kazakhstan";
import type { Mode } from "./types";
import { Btn } from "./components/ui";
import DashboardMode from "./components/modes/DashboardMode";
import ChatMode      from "./components/modes/ChatMode";
import SearchMode    from "./components/modes/SearchMode";
import DataMode      from "./components/modes/DataMode";
import AnalyticsMode from "./components/modes/AnalyticsMode";

// Tab labels shown in the top navigation bar.
const MODES: [Mode, string][] = [
  ["dashboard", "📊 Dashboard"],
  ["chat",      "💬 AI Chat"],
  ["search",    "🔍 Search"],
  ["data",      "📁 Data"],
  ["analytics", "🧮 Analytics"],
];

// Header badge text and description strip for the active mode.
const MODE_META: Record<Mode, { label: string; desc: string; color: string }> = {
  dashboard: { label: "Dashboard Mode",   color: "#00AAFF", desc: "Pre-built charts with filterable static data — great for overview and reference" },
  chat:      { label: "AI Chat Mode",     color: "#8B5CF6", desc: "Prompt-driven · Claude generates charts and analysis dynamically from your query" },
  search:    { label: "Web Search Mode",  color: "#10B981", desc: "Live web search · Claude pulls and summarizes current data from reliable sources" },
  data:      { label: "Data Upload Mode", color: "#F59E0B", desc: "Upload a CSV file · Claude analyzes your data and creates charts automatically" },
  analytics: { label: "Analytics Mode",   color: "#EF4444", desc: "Algorithms from scratch: OLS Regression · HHI Concentration · K-Means Clustering · Z-Score Anomaly Detection" },
};

export default function App() {
  const [mode,      setMode]      = useState<Mode>("dashboard");
  const [yearRange, setYearRange] = useState<[number, number]>([2010, 2024]);
  const { label, desc, color } = MODE_META[mode];
  const modeIcon = MODES.find(m => m[0] === mode)?.[1].split(" ")[0] ?? "";

  return (
    <div style={{ fontFamily: "Inter,sans-serif", background: "#0f1117", height: "100vh", display: "flex", flexDirection: "column", color: "#e2e8f0" }}>

      {/* ── Header ── */}
      <div style={{ padding: "12px 24px", borderBottom: "1px solid #1e2130", display: "flex", alignItems: "center", gap: 14, flexShrink: 0, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 38, height: 38, borderRadius: 9, background: "linear-gradient(135deg,#00AAFF,#8B5CF6)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20 }}>🇰🇿</div>
          <div>
            <h1 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: "#fff" }}>{COUNTRY.flag} {COUNTRY.name} Economic Intelligence</h1>
            <p style={{ margin: 0, fontSize: 11, color: "#64748b" }}>{COUNTRY.description}</p>
          </div>
        </div>

        {/* Mode toggle */}
        <div style={{ marginLeft: "auto", display: "flex", background: "#1e2130", borderRadius: 9, padding: 3, border: "1px solid #2d3348", gap: 3, flexWrap: "nowrap" }}>
          {MODES.map(([m, lbl]) => (
            <button key={m} onClick={() => setMode(m)} style={{
              background: mode === m ? MODE_META[m].color : "transparent",
              color: mode === m ? "#fff" : "#94a3b8",
              border: "none", borderRadius: 7, padding: "6px 14px",
              fontSize: 12, fontWeight: 600, cursor: "pointer", transition: "all .2s", whiteSpace: "nowrap",
            }}>{lbl}</button>
          ))}
        </div>

        {/* Year-range filter — Dashboard only */}
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
      </div>

      {/* ── Mode badge + description strip ── */}
      <div style={{ padding: "7px 24px", borderBottom: "1px solid #1e2130", flexShrink: 0, display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ fontSize: 11, borderRadius: 5, padding: "2px 10px", fontWeight: 600, background: color + "22", color, border: `1px solid ${color}44` }}>
          {modeIcon} {label}
        </span>
        <span style={{ fontSize: 11, color: "#64748b" }}>{desc}</span>
      </div>

      {/* ── Main content area — each mode fills the remaining space ── */}
      <div style={{ flex: 1, overflowY: "auto", padding: mode === "chat" ? "16px 24px 0" : "20px 24px" }}>
        {mode === "dashboard"  && <div style={{ maxWidth: 1100, margin: "0 auto" }}><DashboardMode yearRange={yearRange} setYearRange={setYearRange} /></div>}
        {mode === "chat"       && <div style={{ maxWidth: 900, margin: "0 auto", height: "100%", display: "flex", flexDirection: "column" }}><ChatMode /></div>}
        {mode === "search"     && <SearchMode />}
        {mode === "data"       && <DataMode />}
        {mode === "analytics"  && <AnalyticsMode />}
      </div>

      {/* Global animation keyframe + scrollbar styling */}
      <style>{`
        @keyframes spin { 0%{transform:rotate(0deg)} 100%{transform:rotate(360deg)} }
        ::-webkit-scrollbar { width:6px }
        ::-webkit-scrollbar-track { background:#0f1117 }
        ::-webkit-scrollbar-thumb { background:#2d3348; border-radius:3px }
      `}</style>
    </div>
  );
}
