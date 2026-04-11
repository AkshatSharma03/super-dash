// ─────────────────────────────────────────────────────────────────────────────
// APP SHELL — Memphis Design Edition — Bold colors, thick borders, geometric patterns
// ─────────────────────────────────────────────────────────────────────────────
import { useState, useEffect, useCallback, lazy, Suspense } from "react";
import type { Mode, User, CountryDataset } from "./types";
import { useMobile } from "./utils/useMobile";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { fetchMe, getCountryData, refreshCountryData, logoutApi } from "./utils/api";
import { identifyUser, resetUser, track } from "./analytics";

const AuthPage = lazy(() => import("./components/auth/AuthPage"));
const SettingsPanel = lazy(() => import("./components/auth/SettingsPanel"));
const DashboardMode = lazy(() => import("./components/modes/DashboardMode"));
const ChatMode = lazy(() => import("./components/modes/ChatMode"));
const SearchMode = lazy(() => import("./components/modes/SearchMode"));
const DataMode = lazy(() => import("./components/modes/DataMode"));
const AnalyticsMode = lazy(() => import("./components/modes/AnalyticsMode"));
const ExportMode = lazy(() => import("./components/modes/ExportMode"));

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
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const isMobile = useMobile();

  const MOBILE_PRIMARY_MODES: Mode[] = ["chat", "search", "data", "analytics", "dashboard"];

  const switchMode = (nextMode: Mode) => {
    setMode(nextMode);
    setMobileMenuOpen(false);
    track("mode_viewed", { mode: nextMode });
  };

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
  if (!user || !token) return (
    <Suspense fallback={null}>
      <AuthPage onAuth={handleAuth} />
    </Suspense>
  );

  const { label, desc } = MODE_META[mode];
  const modeIcon = MODES.find(m => m[0] === mode)?.[1].split(" ")[0] ?? "";
  const fetchingInBg = countryLoading && mode !== "dashboard";

  return (
    <div className="bg-memphis-offwhite h-[100dvh] flex flex-col text-memphis-black" style={{ fontFamily: "Inter,sans-serif" }}>

      {isMobile && mobileMenuOpen && (
        <div className="fixed inset-0 z-[120] bg-black/55" onClick={() => setMobileMenuOpen(false)} />
      )}

      {/* ── Memphis Header with Zigzag Pattern ── */}
      <header className="ec-header px-3 sm:px-6 py-3 sm:py-4 border-b-4 sm:border-b-4 border-b-3 border-memphis-black flex items-center gap-2 sm:gap-4 shrink-0 flex-wrap bg-white relative">
        {/* Zigzag decoration at bottom - hidden on mobile */}
        <div className="absolute bottom-0 left-0 right-0 h-3 bg-repeating-linear-gradient pattern-zigzag hidden sm:block" 
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
        <div className="flex items-center gap-2 sm:gap-3">
          <div className="w-8 h-8 sm:w-10 sm:h-10 border-2 sm:border-3 border-memphis-black flex items-center justify-center text-base sm:text-lg font-black shadow-hard-sm sm:shadow-hard"
            style={{ background: "#FF006E" }}>
            📊
          </div>
          <span className="text-base sm:text-lg font-black text-memphis-black tracking-tight uppercase">EconChart</span>
        </div>

        {isMobile && (
          <Button
            variant="outline"
            size="icon"
            className="ml-auto"
            onClick={() => setMobileMenuOpen(v => !v)}
            aria-label="Open mobile menu"
          >
            ☰
          </Button>
        )}

        {/* Mode tabs — Memphis Bold Tabs */}
        <nav className={cn("ec-tabs ml-4 flex bg-memphis-offwhite border-3 border-memphis-black shadow-hard p-1 gap-1 flex-nowrap", isMobile && "hidden")}>
          {MODES.map(([m, lbl]) => {
            const isBgFetch = m === "dashboard" && fetchingInBg;
            const [emoji, ...words] = lbl.split(" ");
            const isActive = mode === m;
            return (
              <button
                key={m}
                onClick={() => switchMode(m)}
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
        <div className={cn("ec-user-chip ml-auto items-center gap-3", isMobile ? "hidden" : "flex")}>
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

      {isMobile && (
        <aside
          className={cn(
            "fixed top-0 right-0 h-[100dvh] w-[82vw] max-w-[320px] z-[130] bg-white border-l-3 border-memphis-black shadow-hard-lg p-4 transition-transform duration-150",
            mobileMenuOpen ? "translate-x-0" : "translate-x-full"
          )}
        >
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-black uppercase tracking-wide">Menu</span>
            <Button variant="outline" size="icon" onClick={() => setMobileMenuOpen(false)} aria-label="Close mobile menu">✕</Button>
          </div>

          <div className="border-3 border-memphis-black bg-memphis-offwhite p-1 mb-4">
            <button
              onClick={() => switchMode("export")}
              className={cn(
                "w-full min-h-11 text-left px-3 py-2 border-3 font-black text-xs uppercase tracking-wide transition-snap",
                mode === "export" ? "bg-memphis-black text-white border-memphis-black" : "bg-white text-memphis-black border-memphis-black"
              )}
            >
              📤 Export Center
            </button>
          </div>

          <div className="flex flex-col gap-2">
            {!user.isGuest && (
              <Button variant="outline" size="sm" className="justify-start" onClick={() => { setSettingsOpen(true); setMobileMenuOpen(false); }}>
                Settings
              </Button>
            )}
            <Button variant="outline" size="sm" className="justify-start" onClick={logout}>
              {user.isGuest ? "Sign Up" : "Log Out"}
            </Button>
          </div>
        </aside>
      )}

      {/* ── Mode badge + description with Stripe Pattern ── */}
      <div className="px-3 sm:px-6 py-2 sm:py-3 border-b-3 sm:border-b-4 border-memphis-black shrink-0 flex items-center gap-2 sm:gap-3 bg-memphis-yellow relative">
        {/* Stripe decoration - thinner on mobile */}
        <div className="absolute top-0 left-0 right-0 h-1.5 sm:h-2"
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
        <div className="w-1 h-5 sm:h-6 bg-memphis-black mt-1.5 sm:mt-2" />
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
        mode === "chat" ? "overflow-hidden p-3 sm:p-6 pb-20 sm:pb-0" : "overflow-y-auto p-3 sm:p-6 pb-20 sm:pb-6"
      )}>
        {/* Dot pattern background */}
        <div className="absolute inset-0 opacity-30 pointer-events-none"
          style={{
            backgroundImage: `radial-gradient(#00D9FF 2px, transparent 2px)`,
            backgroundSize: '24px 24px'
          }}
        />
        <div className="relative z-10">
          <Suspense
            fallback={
              <div className="max-w-[1100px] mx-auto py-10 text-center">
                <span className="inline-flex items-center gap-2 text-xs font-black uppercase tracking-wide text-memphis-black/60">
                  <span className="w-2 h-2 bg-memphis-pink border-2 border-memphis-black inline-block" style={{ animation: "ecPulse 1s steps(1) infinite" }} />
                  Loading view
                </span>
              </div>
            }
          >
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
          </Suspense>
        </div>
      </main>

      {isMobile && (
        <nav className="fixed bottom-0 left-0 right-0 z-[110] bg-white border-t-3 border-memphis-black px-1 pt-1 pb-[max(8px,env(safe-area-inset-bottom))]">
          <div className="grid grid-cols-5 gap-1">
            {MOBILE_PRIMARY_MODES.map((m) => {
              const def = MODES.find(([modeKey]) => modeKey === m);
              const [emoji, ...labelParts] = (def?.[1] ?? "").split(" ");
              const active = m === mode;
              return (
                <button
                  key={m}
                  onClick={() => switchMode(m)}
                  className={cn(
                    "min-h-11 px-1.5 py-1 border-2 border-memphis-black flex flex-col items-center justify-center text-[10px] font-black uppercase tracking-wide",
                    active ? "bg-memphis-black text-white" : "bg-memphis-offwhite text-memphis-black"
                  )}
                  aria-label={labelParts.join(" ")}
                >
                  <span className="text-sm leading-none">{emoji}</span>
                  <span className="leading-none mt-1">{labelParts[0]}</span>
                </button>
              );
            })}
          </div>
        </nav>
      )}

      {settingsOpen && !user.isGuest && (
        <Suspense fallback={null}>
          <SettingsPanel
            user={user}
            token={token}
            onClose={() => setSettingsOpen(false)}
            onLogout={logout}
          />
        </Suspense>
      )}
    </div>
  );
}
