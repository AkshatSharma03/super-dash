// ─────────────────────────────────────────────────────────────────────────────
// APP SHELL — Memphis Design Edition — Bold colors, thick borders, geometric patterns
// ─────────────────────────────────────────────────────────────────────────────
import { useState, useEffect, useCallback } from "react";
import type { Mode, User, CountryDataset } from "./types";
import { useMobile } from "./utils/useMobile";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { fetchMe, getCountryData, refreshCountryData, logoutApi } from "./utils/api";
import { identifyUser, resetUser, track } from "./analytics";
import AuthPage from "./components/auth/AuthPage";
import SettingsPanel from "./components/auth/SettingsPanel";
import DashboardMode from "./components/modes/DashboardMode";
import ChatMode from "./components/modes/ChatMode";
import SearchMode from "./components/modes/SearchMode";
import DataMode from "./components/modes/DataMode";
import AnalyticsMode from "./components/modes/AnalyticsMode";
import ExportMode from "./components/modes/ExportMode";

const MODES: [Mode, string][] = [
  ["chat", "💬 AI Chat"],
  ["search", "🔍 Search"],
  ["data", "📁 Data"],
  ["analytics", "🧮 Analytics"],
  ["dashboard", "🌍 Country Data"],
  ["export", "📤 Export"],
];

/* Unified Memphis Color Palette for all modes */
const MODE_META: Record<Mode, { label: string; desc: string; color: string; bg: string }> = {
  chat:      { label: "AI Chat",       color: "#FF006E", bg: "#FF006E", desc: "Ask any economic question — Claude generates interactive charts and analysis from your query" },
  search:    { label: "Web Search",    color: "#00D9FF", bg: "#00D9FF", desc: "Live web search · Claude pulls and summarises current data from authoritative sources" },
  data:      { label: "Data Upload",   color: "#FB5607", bg: "#FB5607", desc: "Upload a CSV file · Claude analyses your data and creates charts automatically" },
  analytics: { label: "Analytics",     color: "#FFBE0B", bg: "#FFBE0B", desc: "Algorithms from scratch: OLS Regression · HHI Concentration · K-Means Clustering · Z-Score Anomaly Detection" },
  dashboard: { label: "Country Data",  color: "#8338EC", bg: "#8338EC", desc: "Select any country — real GDP & trade data from World Bank, cached locally · sector breakdown AI-estimated" },
  export:    { label: "Export",        color: "#00F5D4", bg: "#00F5D4", desc: "Download data as CSV / JSON · Generate standalone HTML reports with embedded SVG charts · Print to PDF" },
};

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [mode, setMode] = useState<Mode>("chat");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const isMobile = useMobile();

  // ── Country data — lives here so fetches survive tab switches ───────────────
  const [countryData, setCountryData] = useState<CountryDataset | null>(null);
  const [countryLoading, setCountryLoading] = useState(false);
  const [countryError, setCountryError] = useState<string | null>(null);

  const [analyticsData, setAnalyticsData] = useState<CountryDataset | null>(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [analyticsError, setAnalyticsError] = useState<string | null>(null);

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
    if (token) logoutApi(token).catch(() => {});
    localStorage.removeItem("ec_token");
    resetUser();
    setToken(null);
    setUser(null);
    setCountryData(null);
  };

  if (!authReady) return null;
  if (!user || !token) return <AuthPage onAuth={handleAuth} />;

  const { label, desc } = MODE_META[mode];
  const modeIcon = MODES.find(m => m[0] === mode)?.[1].split(" ")[0] ?? "";
  const fetchingInBg = countryLoading && mode !== "dashboard";

  return (
    <div className="bg-memphis-offwhite h-screen flex flex-col text-memphis-black" style={{ fontFamily: "Inter,sans-serif" }}>

      {/* ── Memphis Header with Zigzag Pattern ── */}
      <header className="ec-header px-6 py-4 border-b-4 border-memphis-black flex items-center gap-4 shrink-0 flex-wrap bg-white relative">
        {/* Zigzag decoration at bottom */}
        <div className="absolute bottom-0 left-0 right-0 h-3 bg-repeating-linear-gradient pattern-zigzag" 
          style={{
            background: `repeating-linear-gradient(
              45deg,
              #FF006E 0px,
              #FF006E 6px,
              transparent 6px,
              transparent 12px
            )`
          }}
        />

        {/* Brand — Bold Memphis Style */}
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 border-3 border-memphis-black flex items-center justify-center text-lg font-black shadow-hard"
            style={{ background: "#FF006E" }}>
            📊
          </div>
          <span className="text-lg font-black text-memphis-black tracking-tight uppercase">EconChart</span>
        </div>

        {/* Mode tabs — Memphis Bold Tabs */}
        <nav className="ec-tabs ml-4 flex bg-memphis-offwhite border-3 border-memphis-black shadow-hard p-1 gap-1 flex-nowrap">
          {MODES.map(([m, lbl]) => {
            const isBgFetch = m === "dashboard" && fetchingInBg;
            const [emoji, ...words] = lbl.split(" ");
            const isActive = mode === m;
            return (
              <button
                key={m}
                onClick={() => { setMode(m); track("mode_viewed", { mode: m }); }}
                className={cn(
                  "border-3 px-4 py-2 text-xs font-black uppercase tracking-wide transition-snap whitespace-nowrap flex items-center gap-2 shadow-hard-sm",
                  isActive
                    ? "bg-memphis-black text-white border-memphis-black shadow-hard"
                    : "bg-white text-memphis-black border-memphis-black hover:-translate-x-px hover:-translate-y-px hover:shadow-hard"
                )}
              >
                <span className="text-base">{emoji}</span>
                <span className={cn("ec-tab-text", isMobile ? "hidden" : "")}>{words.join(" ")}</span>
                {isBgFetch && (
                  <span className="w-2 h-2 border-2 border-white inline-block" style={{ animation: "ecPulse 1s steps(1) infinite" }} />
                )}
              </button>
            );
          })}
        </nav>

        {/* User chip */}
        <div className="ec-user-chip ml-auto flex items-center gap-3">
          {user.isGuest ? (
            <>
              <span className="text-xs font-bold text-memphis-black/60 uppercase tracking-wide">Guest</span>
              <Button size="sm" onClick={logout}>
                Sign Up
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" size="sm" onClick={() => setSettingsOpen(true)} className="gap-2">
                <div className="w-7 h-7 border-2 border-memphis-black flex items-center justify-center text-xs font-black text-white shrink-0 shadow-hard-sm"
                  style={{ background: "#FF006E" }}>
                  {user.name.charAt(0).toUpperCase()}
                </div>
                <span className="ec-user-name max-w-[120px] overflow-hidden text-ellipsis whitespace-nowrap font-bold">{user.name}</span>
                <span className="text-xs">▼</span>
              </Button>
              <Button variant="outline" size="sm" onClick={logout}>
                Out
              </Button>
            </>
          )}
        </div>
      </header>

      {/* ── Mode badge + description with Stripe Pattern ── */}
      <div className="px-6 py-3 border-b-4 border-memphis-black shrink-0 flex items-center gap-3 bg-memphis-yellow relative">
        {/* Stripe decoration */}
        <div className="absolute top-0 left-0 right-0 h-2"
          style={{
            background: `repeating-linear-gradient(
              90deg,
              #FF006E 0px,
              #FF006E 8px,
              #00D9FF 8px,
              #00D9FF 16px,
              #FB5607 16px,
              #FB5607 24px
            )`
          }}
        />
        <div className="w-1 h-6 bg-memphis-black mt-2" />
        <span className="mt-2 text-xs border-3 border-memphis-black px-3 py-1 font-black uppercase tracking-wider bg-white shadow-hard-sm">
          {modeIcon} {label}
        </span>
        <span className="ec-mode-desc mt-2 text-xs font-semibold text-memphis-black/70">{desc}</span>
        {fetchingInBg && (
          <span className="mt-2 ml-auto text-xs font-bold text-memphis-pink flex items-center gap-2 uppercase">
            <span className="w-2 h-2 bg-memphis-pink border-2 border-memphis-black inline-block" style={{ animation: "ecPulse 1s steps(1) infinite" }} />
            Loading Data…
          </span>
        )}
      </div>

      {/* ── Main content with Dot Pattern ── */}
      <main className={cn(
        "flex-1 relative",
        mode === "chat" ? "overflow-hidden p-6 pb-0" : "overflow-y-auto p-6"
      )}>
        {/* Dot pattern background */}
        <div className="absolute inset-0 opacity-30 pointer-events-none"
          style={{
            backgroundImage: `radial-gradient(#00D9FF 2px, transparent 2px)`,
            backgroundSize: '24px 24px'
          }}
        />
        <div className="relative z-10">
          {mode === "chat" && <div className="max-w-[1060px] mx-auto h-full flex flex-col"><ChatMode token={token} isGuest={user.isGuest ?? false} /></div>}
          {mode === "search" && <SearchMode />}
          {mode === "data" && <DataMode />}
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
        </div>
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
