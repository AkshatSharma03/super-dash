// ─────────────────────────────────────────────────────────────────────────────
// APP SHELL  —  top-level layout: auth gate, header, mode navigation.
// Shows AuthPage when the user is not logged in; the full dashboard otherwise.
//
// Country data state lives here (not in DashboardMode) so that a fetch started
// in one tab continues running even after the user switches to another tab.
// ─────────────────────────────────────────────────────────────────────────────
import { useState, useEffect, useCallback } from "react";
import type { Mode, User, CountryDataset } from "./types";
import { fetchMe, getCountryData, refreshCountryData } from "./utils/api";
import AuthPage      from "./components/auth/AuthPage";
import SettingsPanel from "./components/auth/SettingsPanel";
import DashboardMode from "./components/modes/DashboardMode";
import ChatMode      from "./components/modes/ChatMode";
import SearchMode    from "./components/modes/SearchMode";
import DataMode      from "./components/modes/DataMode";
import AnalyticsMode from "./components/modes/AnalyticsMode";
import ExportMode    from "./components/modes/ExportMode";

const MODES: [Mode, string][] = [
  ["chat",      "💬 AI Chat"],
  ["search",    "🔍 Search"],
  ["data",      "📁 Data"],
  ["analytics", "🧮 Analytics"],
  ["dashboard", "🌍 Country Data"],
  ["export",    "📤 Export"],
];

const MODE_META: Record<Mode, { label: string; desc: string; color: string }> = {
  chat:      { label: "AI Chat",       color: "#8B5CF6", desc: "Ask any economic question — Claude generates interactive charts and analysis from your query" },
  search:    { label: "Web Search",    color: "#10B981", desc: "Live web search · Claude pulls and summarises current data from authoritative sources" },
  data:      { label: "Data Upload",   color: "#F59E0B", desc: "Upload a CSV file · Claude analyses your data and creates charts automatically" },
  analytics: { label: "Analytics",    color: "#EF4444", desc: "Algorithms from scratch: OLS Regression · HHI Concentration · K-Means Clustering · Z-Score Anomaly Detection" },
  dashboard: { label: "Country Data", color: "#00AAFF", desc: "Select any country — real GDP & trade data from World Bank, cached locally · sector breakdown AI-estimated" },
  export:    { label: "Export",        color: "#10B981", desc: "Download data as CSV / JSON · Generate standalone HTML reports with embedded SVG charts · Print to PDF" },
};

export default function App() {
  const [user,      setUser]      = useState<User | null>(null);
  const [token,     setToken]     = useState<string | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [mode,         setMode]         = useState<Mode>("chat");
  const [settingsOpen, setSettingsOpen] = useState(false);

  // ── Country data — lives here so fetches survive tab switches ───────────────
  const [countryData,    setCountryData]    = useState<CountryDataset | null>(null);
  const [countryLoading, setCountryLoading] = useState(false);
  const [countryError,   setCountryError]   = useState<string | null>(null);

  // Analytics tab has its own independent country selection
  const [analyticsData,    setAnalyticsData]    = useState<CountryDataset | null>(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [analyticsError,   setAnalyticsError]   = useState<string | null>(null);

  const loadCountry = useCallback(async (code: string, tok: string) => {
    setCountryLoading(true);
    setCountryError(null);
    try {
      const data = await getCountryData(code, tok);
      setCountryData(data);
    } catch (e) {
      setCountryError(e instanceof Error ? e.message : "Failed to load country data");
    } finally {
      setCountryLoading(false);
    }
  }, []);

  const loadAnalyticsCountry = useCallback(async (code: string, tok: string) => {
    setAnalyticsLoading(true);
    setAnalyticsError(null);
    try {
      const data = await getCountryData(code, tok);
      setAnalyticsData(data);
    } catch (e) {
      setAnalyticsError(e instanceof Error ? e.message : "Failed to load country data");
    } finally {
      setAnalyticsLoading(false);
    }
  }, []);

  const handleRefreshCountry = useCallback(async (tok: string, currentCode: string) => {
    setCountryLoading(true);
    setCountryError(null);
    try {
      const data = await refreshCountryData(currentCode, tok);
      setCountryData(data);
    } catch (e) {
      setCountryError(e instanceof Error ? e.message : "Refresh failed");
    } finally {
      setCountryLoading(false);
    }
  }, []);

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
    setCountryData(null);
  };

  if (!authReady) return null;
  if (!user || !token) return <AuthPage onAuth={handleAuth} />;

  const { label, desc, color } = MODE_META[mode];
  const modeIcon = MODES.find(m => m[0] === mode)?.[1].split(" ")[0] ?? "";

  // Show a pulsing dot on the Country Data tab when a fetch is running in the background
  const fetchingInBg = countryLoading && mode !== "dashboard";

  return (
    <div style={{ fontFamily: "Inter,sans-serif", background: "#0f1117", height: "100vh", display: "flex", flexDirection: "column", color: "#e2e8f0" }}>

      {/* ── Header ── */}
      <div style={{ padding: "8px 20px", borderBottom: "1px solid #1e2130", display: "flex", alignItems: "center", gap: 12, flexShrink: 0, flexWrap: "wrap", background: "#0a0d14" }}>

        {/* Brand */}
        <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
          <div style={{ width: 30, height: 30, borderRadius: 8, background: "linear-gradient(135deg,#00AAFF,#8B5CF6)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, boxShadow: "0 0 12px #00AAFF44" }}>📊</div>
          <span style={{ fontSize: 14, fontWeight: 800, color: "#fff", letterSpacing: "-0.3px" }}>EconChart</span>
        </div>

        {/* Mode tabs */}
        <div style={{ marginLeft: 14, display: "flex", background: "#161929", borderRadius: 10, padding: 3, border: "1px solid #2d3348", gap: 1, flexWrap: "nowrap" }}>
          {MODES.map(([m, lbl]) => {
            const isBgFetch = m === "dashboard" && fetchingInBg;
            return (
              <button key={m} onClick={() => setMode(m)} style={{
                background: mode === m ? MODE_META[m].color : "transparent",
                color: mode === m ? "#fff" : "#64748b",
                border: "none", borderRadius: 7, padding: "5px 12px",
                fontSize: 11.5, fontWeight: mode === m ? 700 : 500,
                cursor: "pointer", transition: "all .18s", whiteSpace: "nowrap",
                boxShadow: mode === m ? `0 2px 8px ${MODE_META[m].color}55` : "none",
                display: "flex", alignItems: "center", gap: 5,
              }}>
                {lbl}
                {isBgFetch && (
                  <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#00AAFF", display: "inline-block", animation: "ecPulse 1.2s ease-in-out infinite" }} />
                )}
              </button>
            );
          })}
        </div>

        {/* User chip */}
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
          <button onClick={() => setSettingsOpen(true)}
            style={{ display: "flex", alignItems: "center", gap: 8, background: "#161929", border: "1px solid #2d3348", borderRadius: 8, padding: "5px 10px 5px 6px", cursor: "pointer", transition: "all .15s" }}
            onMouseEnter={e => { const el = e.currentTarget as HTMLButtonElement; el.style.borderColor = "#8B5CF6"; el.style.background = "#1e2130"; }}
            onMouseLeave={e => { const el = e.currentTarget as HTMLButtonElement; el.style.borderColor = "#2d3348"; el.style.background = "#161929"; }}>
            <div style={{ width: 24, height: 24, borderRadius: "50%", background: "linear-gradient(135deg,#00AAFF,#8B5CF6)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, color: "#fff", flexShrink: 0 }}>
              {user.name.charAt(0).toUpperCase()}
            </div>
            <span style={{ fontSize: 12, color: "#cbd5e1", maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: 500 }}>{user.name}</span>
            <span style={{ fontSize: 9, color: "#475569" }}>▼</span>
          </button>
          <button onClick={logout}
            style={{ background: "transparent", border: "1px solid #2d3348", borderRadius: 7, padding: "5px 12px", fontSize: 11, color: "#64748b", cursor: "pointer", transition: "all .15s", fontWeight: 500 }}
            onMouseEnter={e => { const el = e.currentTarget as HTMLButtonElement; el.style.color = "#EF4444"; el.style.borderColor = "#EF444466"; }}
            onMouseLeave={e => { const el = e.currentTarget as HTMLButtonElement; el.style.color = "#64748b"; el.style.borderColor = "#2d3348"; }}>
            Sign out
          </button>
        </div>
      </div>

      {/* Keyframe for pulsing background-fetch indicator */}
      <style>{`@keyframes ecPulse { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:.4;transform:scale(.7)} }`}</style>

      {/* ── Mode badge + description ── */}
      <div style={{ padding: "5px 20px", borderBottom: "1px solid #1e2130", flexShrink: 0, display: "flex", alignItems: "center", gap: 10, background: "#0d1018" }}>
        <div style={{ width: 3, height: 18, borderRadius: 2, background: color, flexShrink: 0 }} />
        <span style={{ fontSize: 11, borderRadius: 4, padding: "1px 8px", fontWeight: 700, background: color + "18", color, letterSpacing: "0.3px" }}>
          {modeIcon} {label}
        </span>
        <span style={{ fontSize: 11, color: "#475569" }}>{desc}</span>
        {/* In-progress fetch notice visible on all tabs */}
        {fetchingInBg && (
          <span style={{ marginLeft: "auto", fontSize: 11, color: "#00AAFF", display: "flex", alignItems: "center", gap: 5 }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#00AAFF", display: "inline-block", animation: "ecPulse 1.2s ease-in-out infinite" }} />
            Fetching country data in background…
          </span>
        )}
      </div>

      {/* ── Main content ── */}
      <div style={{ flex: 1, overflowY: mode === "chat" ? "hidden" : "auto", padding: mode === "chat" ? "16px 20px 0" : "20px 20px" }}>
        {mode === "chat"      && <div style={{ maxWidth: 1060, margin: "0 auto", height: "100%", display: "flex", flexDirection: "column" }}><ChatMode token={token} /></div>}
        {mode === "search"    && <SearchMode />}
        {mode === "data"      && <DataMode />}
        {mode === "analytics" && (
          <AnalyticsMode
            token={token}
            dataset={analyticsData}
            loading={analyticsLoading}
            error={analyticsError}
            onSelectCountry={code => loadAnalyticsCountry(code, token)}
          />
        )}
        {mode === "dashboard" && (
          <div style={{ maxWidth: 1100, margin: "0 auto" }}>
            <DashboardMode
              token={token}
              dataset={countryData}
              loading={countryLoading}
              error={countryError}
              onSelectCountry={code => loadCountry(code, token)}
              onRefresh={() => countryData && handleRefreshCountry(token, countryData.code)}
            />
          </div>
        )}
        {mode === "export" && (
          <div style={{ maxWidth: 1100, margin: "0 auto" }}>
            <ExportMode dashDataset={countryData} analyticsDataset={analyticsData} />
          </div>
        )}
      </div>

      {settingsOpen && (
        <SettingsPanel
          user={user}
          token={token}
          onClose={() => setSettingsOpen(false)}
          onLogout={logout}
        />
      )}
    </div>
  );
}
