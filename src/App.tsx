// ─────────────────────────────────────────────────────────────────────────────
// APP SHELL  —  top-level layout: auth gate, header, mode navigation.
// Shows AuthPage when the user is not logged in; the full dashboard otherwise.
//
// Country data state lives here (not in DashboardMode) so that a fetch started
// in one tab continues running even after the user switches to another tab.
// ─────────────────────────────────────────────────────────────────────────────
import { useState, useEffect, useCallback } from "react";
import type { Mode, User, CountryDataset } from "./types";
import { useMobile } from "./utils/useMobile";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { fetchMe, getCountryData, refreshCountryData } from "./utils/api";
import { identifyUser, resetUser, track } from "./analytics";
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
  const isMobile = useMobile();

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
      .then(u => { setToken(stored); setUser(u); if (!u.isGuest) identifyUser(u.id, u.email, u.name); })
      .catch(() => { localStorage.removeItem("ec_token"); })
      .finally(() => setAuthReady(true));
  }, []);

  const handleAuth = (t: string, u: User) => {
    localStorage.setItem("ec_token", t);
    setToken(t);
    setUser(u);
    if (!u.isGuest) identifyUser(u.id, u.email, u.name);
  };

  const logout = () => {
    localStorage.removeItem("ec_token");
    resetUser();
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
    <div className="bg-background h-screen flex flex-col text-foreground" style={{ fontFamily: "Inter,sans-serif" }}>

      {/* ── Header ── */}
      <header className="ec-header px-5 py-2 border-b border-muted flex items-center gap-3 shrink-0 flex-wrap bg-popover">

        {/* Brand */}
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center text-[15px] shadow-[0_0_12px_#00AAFF44]"
            style={{ background: "linear-gradient(135deg,#00AAFF,#8B5CF6)" }}>
            📊
          </div>
          <span className="text-sm font-extrabold text-white tracking-[-0.3px]">EconChart</span>
        </div>

        {/* Mode tabs */}
        <nav className="ec-tabs ml-3.5 flex bg-card rounded-xl p-[3px] border border-border gap-px flex-nowrap">
          {MODES.map(([m, lbl]) => {
            const isBgFetch = m === "dashboard" && fetchingInBg;
            const [emoji, ...words] = lbl.split(" ");
            const isActive = mode === m;
            return (
              <button
                key={m}
                onClick={() => { setMode(m); track("mode_viewed", { mode: m }); }}
                className={cn(
                  "rounded-md px-3 py-1.5 text-[11.5px] font-medium transition-all duration-150 whitespace-nowrap flex items-center border-none cursor-pointer",
                  isActive
                    ? "text-white font-bold"
                    : "bg-transparent text-muted-foreground hover:text-foreground"
                )}
                style={isActive ? {
                  background: MODE_META[m].color,
                  boxShadow: `0 2px 8px ${MODE_META[m].color}55`,
                } : {}}
              >
                <span>{emoji}</span>
                <span className={cn("ec-tab-text", isMobile ? "hidden" : "")}> {words.join(" ")}</span>
                {isBgFetch && (
                  <span className="w-1.5 h-1.5 rounded-full bg-primary inline-block ml-1" style={{ animation: "ecPulse 1.2s ease-in-out infinite" }} />
                )}
              </button>
            );
          })}
        </nav>

        {/* User chip */}
        <div className="ec-user-chip ml-auto flex items-center gap-2">
          {user.isGuest ? (
            <>
              <span className="text-[11px] text-muted-foreground">Guest mode</span>
              <Button size="sm" onClick={logout}
                className="bg-gradient-to-r from-[#00AAFF] to-[#0088DD] shadow-[0_2px_8px_#00AAFF44] font-bold text-xs">
                Sign up free
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" size="sm" onClick={() => setSettingsOpen(true)} className="gap-2 pl-1.5">
                <div className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold text-white shrink-0"
                  style={{ background: "linear-gradient(135deg,#00AAFF,#8B5CF6)" }}>
                  {user.name.charAt(0).toUpperCase()}
                </div>
                <span className="ec-user-name max-w-[120px] overflow-hidden text-ellipsis whitespace-nowrap">{user.name}</span>
                <span className="text-[9px] text-muted-foreground">▼</span>
              </Button>
              <Button variant="outline" size="sm" onClick={logout}
                className="text-muted-foreground hover:text-destructive hover:border-destructive/50">
                Sign out
              </Button>
            </>
          )}
        </div>
      </header>

      {/* ── Mode badge + description ── */}
      <div className="px-5 py-1.5 border-b border-muted shrink-0 flex items-center gap-2.5 bg-[#0d1018]">
        <div className="w-[3px] h-[18px] rounded-sm shrink-0" style={{ background: color }} />
        <span className="text-[11px] rounded px-2 py-px font-bold tracking-[0.3px]"
          style={{ background: color + "18", color }}>
          {modeIcon} {label}
        </span>
        <span className="ec-mode-desc text-[11px] text-muted-foreground">{desc}</span>
        {fetchingInBg && (
          <span className="ml-auto text-[11px] text-primary flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-primary inline-block" style={{ animation: "ecPulse 1.2s ease-in-out infinite" }} />
            Fetching country data in background…
          </span>
        )}
      </div>

      {/* ── Main content ── */}
      <main className={cn("flex-1", mode === "chat" ? "overflow-hidden p-4 pb-0 px-5" : "overflow-y-auto p-5")}>
        {mode === "chat"      && <div className="max-w-[1060px] mx-auto h-full flex flex-col"><ChatMode token={token} isGuest={user.isGuest ?? false} /></div>}
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
          <div className="max-w-[1100px] mx-auto">
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
          <div className="max-w-[1100px] mx-auto">
            <ExportMode dashDataset={countryData} analyticsDataset={analyticsData} />
          </div>
        )}
      </main>

      {settingsOpen && !user.isGuest && (
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
