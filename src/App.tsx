// App shell: mode navigation, auth state, and shared dataset loading.
import {
  useState,
  useEffect,
  useCallback,
  useRef,
  lazy,
  Suspense,
  type MutableRefObject,
} from "react";
import { useAuth, useClerk, useUser } from "@clerk/react";
import type { Mode, User, CountryDataset } from "./types";
import { useMobile } from "./utils/useMobile";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  getCountryData,
  refreshCountryData,
  logoutApi,
  setAuthTokenGetter,
} from "./utils/api";
import { identifyUser, resetUser, track } from "./analytics";
import { BarChart3, ChevronDown, Download, Menu, X } from "lucide-react";
import { MOBILE_PRIMARY_MODES, MODE_META, MODES } from "./config/modes";

const AuthPage = lazy(() => import("./components/auth/AuthPage"));
const SettingsPanel = lazy(() => import("./components/auth/SettingsPanel"));
const DashboardMode = lazy(() => import("./components/modes/DashboardMode"));
const ChatMode = lazy(() => import("./components/modes/ChatMode"));
const SearchMode = lazy(() => import("./components/modes/SearchMode"));
const DataMode = lazy(() => import("./components/modes/DataMode"));
const AnalyticsMode = lazy(() => import("./components/modes/AnalyticsMode"));
const ExportMode = lazy(() => import("./components/modes/ExportMode"));
const MethodologyMode = lazy(
  () => import("./components/modes/MethodologyMode"),
);

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

async function runDatasetRequest(params: {
  nextRequestId: number;
  latestRequestIdRef: MutableRefObject<number>;
  setLoading: (value: boolean) => void;
  setError: (value: string | null) => void;
  setData: (value: CountryDataset) => void;
  request: () => Promise<CountryDataset>;
  fallbackError: string;
}) {
  const {
    nextRequestId,
    latestRequestIdRef,
    setLoading,
    setError,
    setData,
    request,
    fallbackError,
  } = params;

  setLoading(true);
  setError(null);

  try {
    const data = await request();
    if (nextRequestId !== latestRequestIdRef.current) return;
    setData(data);
  } catch (error) {
    if (nextRequestId !== latestRequestIdRef.current) return;
    setError(getErrorMessage(error, fallbackError));
  } finally {
    if (nextRequestId !== latestRequestIdRef.current) return;
    setLoading(false);
  }
}

interface ModeContentParams {
  mode: Mode;
  token: string;
  user: User;
  countryData: CountryDataset | null;
  countryLoading: boolean;
  countryError: string | null;
  analyticsData: CountryDataset | null;
  analyticsLoading: boolean;
  analyticsError: string | null;
  loadCountry: (code: string, token: string) => Promise<void>;
  loadAnalyticsCountry: (code: string, token: string) => Promise<void>;
  handleRefreshCountry: (token: string, countryCode: string) => Promise<void>;
}

function renderModeContent(params: ModeContentParams) {
  const {
    mode,
    token,
    user,
    countryData,
    countryLoading,
    countryError,
    analyticsData,
    analyticsLoading,
    analyticsError,
    loadCountry,
    loadAnalyticsCountry,
    handleRefreshCountry,
  } = params;

  if (mode === "chat") {
    return (
      <div className="max-w-[1060px] mx-auto h-full flex flex-col">
        <ChatMode token={token} isGuest={user.isGuest ?? false} />
      </div>
    );
  }

  if (mode === "search") {
    return <SearchMode token={token} isGuest={user.isGuest ?? false} />;
  }

  if (mode === "data") {
    return <DataMode />;
  }

  if (mode === "analytics") {
    return (
      <AnalyticsMode
        token={token}
        dataset={analyticsData}
        loading={analyticsLoading}
        error={analyticsError}
        onSelectCountry={(code) => loadAnalyticsCountry(code, token)}
      />
    );
  }

  if (mode === "dashboard") {
    return (
      <div className="max-w-[1100px] mx-auto">
        <DashboardMode
          token={token}
          dataset={countryData}
          loading={countryLoading}
          error={countryError}
          onSelectCountry={(code) => loadCountry(code, token)}
          onRefresh={() =>
            countryData && handleRefreshCountry(token, countryData.code)
          }
        />
      </div>
    );
  }

  if (mode === "export") {
    return (
      <div className="max-w-[1100px] mx-auto">
        <ExportMode
          dashDataset={countryData}
          analyticsDataset={analyticsData}
        />
      </div>
    );
  }

  return (
    <div className="max-w-[1100px] mx-auto">
      <MethodologyMode />
    </div>
  );
}

export default function App() {
  const { isLoaded: clerkLoaded, isSignedIn, getToken } = useAuth();
  const { user: clerkUser } = useUser();
  const { signOut } = useClerk();

  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string>("");
  const [authReady, setAuthReady] = useState(false);
  const [mode, setMode] = useState<Mode>("chat");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const isMobile = useMobile();

  const switchMode = (nextMode: Mode) => {
    setMode(nextMode);
    setMobileMenuOpen(false);
    track("mode_viewed", { mode: nextMode });
  };

  // Country data lives in App so it survives mode switches.
  const [countryData, setCountryData] = useState<CountryDataset | null>(null);
  const [countryLoading, setCountryLoading] = useState(false);
  const [countryError, setCountryError] = useState<string | null>(null);

  const [analyticsData, setAnalyticsData] = useState<CountryDataset | null>(
    null,
  );
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [analyticsError, setAnalyticsError] = useState<string | null>(null);
  const countryReqIdRef = useRef(0);
  const analyticsReqIdRef = useRef(0);

  const loadCountry = useCallback(async (code: string, tok: string) => {
    const nextRequestId = ++countryReqIdRef.current;

    await runDatasetRequest({
      nextRequestId,
      latestRequestIdRef: countryReqIdRef,
      setLoading: setCountryLoading,
      setError: setCountryError,
      setData: setCountryData,
      request: () => getCountryData(code, tok),
      fallbackError: "Failed to load country data",
    });
  }, []);

  const loadAnalyticsCountry = useCallback(
    async (code: string, tok: string) => {
      const nextRequestId = ++analyticsReqIdRef.current;

      await runDatasetRequest({
        nextRequestId,
        latestRequestIdRef: analyticsReqIdRef,
        setLoading: setAnalyticsLoading,
        setError: setAnalyticsError,
        setData: setAnalyticsData,
        request: () => getCountryData(code, tok),
        fallbackError: "Failed to load country data",
      });
    },
    [],
  );

  const handleRefreshCountry = useCallback(
    async (tok: string, currentCode: string) => {
      const nextRequestId = ++countryReqIdRef.current;

      await runDatasetRequest({
        nextRequestId,
        latestRequestIdRef: countryReqIdRef,
        setLoading: setCountryLoading,
        setError: setCountryError,
        setData: setCountryData,
        request: () => refreshCountryData(currentCode, tok),
        fallbackError: "Refresh failed",
      });
    },
    [],
  );

  // Restore guest session on mount
  useEffect(() => {
    const guestToken = localStorage.getItem("ec_guest_token");
    const guestUserRaw = localStorage.getItem("ec_guest_user");
    if (!guestToken || !guestUserRaw) return;
    try {
      const parsed = JSON.parse(guestUserRaw) as User;
      setToken(guestToken);
      setUser(parsed);
    } catch {
      localStorage.removeItem("ec_guest_token");
      localStorage.removeItem("ec_guest_user");
    }
  }, []);

  useEffect(() => {
    setAuthTokenGetter(async () => {
      if (token) return token;
      if (!isSignedIn) return null;
      return await getToken();
    });

    return () => {
      setAuthTokenGetter(null);
    };
  }, [token, isSignedIn, getToken]);

  useEffect(() => {
    if (!clerkLoaded) return;

    if (token) {
      setAuthReady(true);
      return;
    }

    if (isSignedIn && clerkUser) {
      const primaryEmail = clerkUser.primaryEmailAddress?.emailAddress ?? "";
      const fullName =
        clerkUser.fullName || clerkUser.firstName || primaryEmail || "User";
      const mappedUser: User = {
        id: clerkUser.id,
        email: primaryEmail,
        name: fullName,
      };
      setUser(mappedUser);
      identifyUser(mappedUser.id, mappedUser.email, mappedUser.name);
    } else {
      setUser(null);
      resetUser();
    }

    setAuthReady(true);
  }, [clerkLoaded, isSignedIn, clerkUser, token]);

  const handleGuestAuth = (t: string, u: User) => {
    localStorage.setItem("ec_guest_token", t);
    localStorage.setItem("ec_guest_user", JSON.stringify(u));
    setToken(t);
    setUser(u);
  };

  const logout = async () => {
    countryReqIdRef.current += 1;
    analyticsReqIdRef.current += 1;
    if (user?.isGuest && token) {
      await logoutApi(token).catch(() => {});
    }
    localStorage.removeItem("ec_guest_token");
    localStorage.removeItem("ec_guest_user");
    if (!user?.isGuest && isSignedIn) {
      await signOut();
    }
    setToken("");
    setUser(null);
    resetUser();
    setCountryData(null);
    setCountryLoading(false);
    setCountryError(null);
    setAnalyticsData(null);
    setAnalyticsLoading(false);
    setAnalyticsError(null);
    setSettingsOpen(false);
    setMobileMenuOpen(false);
    setMode("chat");
  };

  if (!authReady) return null;
  if (!user)
    return (
      <Suspense fallback={null}>
        <AuthPage onGuestAuth={handleGuestAuth} />
      </Suspense>
    );

  const { label, desc } = MODE_META[mode];
  const ActiveModeIcon = MODES.find((m) => m.mode === mode)?.Icon ?? BarChart3;
  const fetchingInBg = countryLoading && mode !== "dashboard";

  return (
    <div
      className="bg-memphis-offwhite h-[100dvh] flex flex-col text-memphis-black"
      style={{ fontFamily: "Inter,sans-serif" }}
    >
      {isMobile && mobileMenuOpen && (
        <div
          className="fixed inset-0 z-[120] bg-black/55"
          onClick={() => setMobileMenuOpen(false)}
        />
      )}

      {/* ── Memphis Header with Zigzag Pattern ── */}
      <header
        className={cn(
          "ec-header px-3 sm:px-6 py-3 sm:py-4 border-b-4 sm:border-b-4",
          "border-b-3 border-memphis-black flex items-center gap-2 sm:gap-4",
          "shrink-0 flex-wrap bg-white relative",
        )}
      >
        {/* Zigzag decoration at bottom - hidden on mobile */}
        <div
          className={cn(
            "absolute bottom-0 left-0 right-0 h-3 bg-repeating-linear-gradient",
            "pattern-zigzag hidden sm:block",
          )}
          style={{
            background: `repeating-linear-gradient(
              45deg,
              #FF006E 0px,
              #FF006E 6px,
              transparent 6px,
              transparent 12px
            )`,
          }}
        />

        {/* Brand — Bold Memphis Style */}
        <div className="flex items-center gap-2 sm:gap-3">
          <div
            className={cn(
              "w-8 h-8 sm:w-10 sm:h-10 border-2 sm:border-3 border-memphis-black",
              "flex items-center justify-center text-base sm:text-lg font-black",
              "shadow-hard-sm sm:shadow-hard",
            )}
            style={{ background: "#FF006E" }}
          >
            <BarChart3 className="w-4 h-4 sm:w-5 sm:h-5" />
          </div>
          <span
            className={cn(
              "text-base sm:text-lg font-black text-memphis-black",
              "tracking-tight uppercase",
            )}
          >
            EconChart
          </span>
        </div>

        {isMobile && (
          <Button
            variant="outline"
            size="icon"
            className="ml-auto"
            onClick={() => setMobileMenuOpen((v) => !v)}
            aria-label="Open mobile menu"
          >
            <Menu className="w-4 h-4" />
          </Button>
        )}

        {/* Mode tabs — Memphis Bold Tabs */}
        <nav
          className={cn(
            "ec-tabs ml-4 flex bg-memphis-offwhite border-3 border-memphis-black",
            "shadow-hard p-1 gap-1 flex-nowrap",
            isMobile && "hidden",
          )}
        >
          {MODES.map(({ mode: m, label: modeLabel, Icon }) => {
            const isBgFetch = m === "dashboard" && fetchingInBg;
            const isActive = mode === m;
            return (
              <button
                key={m}
                onClick={() => switchMode(m)}
                className={cn(
                  "border-3 px-4 py-2 text-xs font-black uppercase tracking-wide",
                  "transition-snap whitespace-nowrap flex items-center gap-2",
                  "shadow-hard-sm",
                  isActive
                    ? "bg-memphis-black text-white border-memphis-black shadow-hard"
                    : cn(
                        "bg-white text-memphis-black border-memphis-black",
                        "hover:-translate-x-px hover:-translate-y-px",
                        "hover:shadow-hard",
                      ),
                )}
              >
                <Icon className="w-4 h-4" />
                <span className={cn("ec-tab-text", isMobile ? "hidden" : "")}>
                  {modeLabel}
                </span>
                {isBgFetch && (
                  <span
                    className="w-2 h-2 border-2 border-white inline-block"
                    style={{ animation: "ecPulse 1s steps(1) infinite" }}
                  />
                )}
              </button>
            );
          })}
        </nav>

        {/* User chip */}
        <div
          className={cn(
            "ec-user-chip ml-auto items-center gap-3",
            isMobile ? "hidden" : "flex",
          )}
        >
          {user.isGuest ? (
            <>
              <span className="text-xs font-bold text-memphis-black/60 uppercase tracking-wide">
                Guest
              </span>
              <Button size="sm" onClick={logout}>
                Sign Up
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setSettingsOpen(true)}
                className="gap-2"
              >
                <div
                  className={cn(
                    "w-7 h-7 border-2 border-memphis-black flex items-center",
                    "justify-center text-xs font-black text-white shrink-0",
                    "shadow-hard-sm",
                  )}
                  style={{ background: "#FF006E" }}
                >
                  {user.name.charAt(0).toUpperCase()}
                </div>
                <span
                  className={cn(
                    "ec-user-name max-w-[120px] overflow-hidden text-ellipsis",
                    "whitespace-nowrap font-bold",
                  )}
                >
                  {user.name}
                </span>
                <ChevronDown className="w-3.5 h-3.5" />
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
            "fixed top-0 right-0 h-[100dvh] w-[82vw] max-w-[320px]",
            "z-[130] bg-white border-l-3 border-memphis-black shadow-hard-lg",
            "p-4 transition-transform duration-150",
            mobileMenuOpen ? "translate-x-0" : "translate-x-full",
          )}
        >
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-black uppercase tracking-wide">
              Menu
            </span>
            <Button
              variant="outline"
              size="icon"
              onClick={() => setMobileMenuOpen(false)}
              aria-label="Close mobile menu"
            >
              <X className="w-4 h-4" />
            </Button>
          </div>

          <div className="border-3 border-memphis-black bg-memphis-offwhite p-1 mb-4">
            <button
              onClick={() => switchMode("export")}
              className={cn(
                "w-full min-h-11 text-left px-3 py-2 border-3 font-black",
                "text-xs uppercase tracking-wide transition-snap",
                mode === "export"
                  ? "bg-memphis-black text-white border-memphis-black"
                  : "bg-white text-memphis-black border-memphis-black",
              )}
            >
              <span className="inline-flex items-center gap-2">
                <Download className="w-4 h-4" /> Export Center
              </span>
            </button>
          </div>

          <div className="flex flex-col gap-2">
            {!user.isGuest && (
              <Button
                variant="outline"
                size="sm"
                className="justify-start"
                onClick={() => {
                  setSettingsOpen(true);
                  setMobileMenuOpen(false);
                }}
              >
                Settings
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              className="justify-start"
              onClick={logout}
            >
              {user.isGuest ? "Sign Up" : "Log Out"}
            </Button>
          </div>
        </aside>
      )}

      {/* ── Mode badge + description with Stripe Pattern ── */}
      <div
        className={cn(
          "px-3 sm:px-6 py-2 sm:py-3 border-b-3 sm:border-b-4",
          "border-memphis-black shrink-0 flex items-center gap-2 sm:gap-3",
          "bg-memphis-yellow relative",
        )}
      >
        {/* Stripe decoration - thinner on mobile */}
        <div
          className="absolute top-0 left-0 right-0 h-1.5 sm:h-2"
          style={{
            background: `repeating-linear-gradient(
              90deg,
              #FF006E 0px,
              #FF006E 8px,
              #00D9FF 8px,
              #00D9FF 16px,
              #FB5607 16px,
              #FB5607 24px
            )`,
          }}
        />
        <div className="w-1 h-5 sm:h-6 bg-memphis-black mt-1.5 sm:mt-2" />
        <span
          className={cn(
            "mt-2 text-xs border-3 border-memphis-black px-3 py-1",
            "font-black uppercase tracking-wider bg-white shadow-hard-sm",
          )}
        >
          <span className="inline-flex items-center gap-2">
            <ActiveModeIcon className="w-3.5 h-3.5" /> {label}
          </span>
        </span>
        <span className="ec-mode-desc mt-2 text-xs font-semibold text-memphis-black/70">
          {desc}
        </span>
        {fetchingInBg && (
          <span
            className={cn(
              "mt-2 ml-auto text-xs font-bold text-memphis-pink",
              "flex items-center gap-2 uppercase",
            )}
          >
            <span
              className="w-2 h-2 bg-memphis-pink border-2 border-memphis-black inline-block"
              style={{ animation: "ecPulse 1s steps(1) infinite" }}
            />
            Loading Data…
          </span>
        )}
      </div>

      {/* ── Main content with Dot Pattern ── */}
      <main
        className={cn(
          "flex-1 relative",
          mode === "chat"
            ? "overflow-hidden p-3 sm:p-6 pb-[calc(5rem+env(safe-area-inset-bottom))] sm:pb-0"
            : "overflow-y-auto p-3 sm:p-6 pb-[calc(5rem+env(safe-area-inset-bottom))] sm:pb-6",
        )}
      >
        {/* Dot pattern background */}
        <div
          className="absolute inset-0 opacity-30 pointer-events-none"
          style={{
            backgroundImage: `radial-gradient(#00D9FF 2px, transparent 2px)`,
            backgroundSize: "24px 24px",
          }}
        />
        <div className={cn("relative z-10", mode === "chat" && "h-full")}>
          <Suspense
            fallback={
              <div className="max-w-[1100px] mx-auto py-10 text-center">
                <span
                  className={cn(
                    "inline-flex items-center gap-2 text-xs font-black",
                    "uppercase tracking-wide text-memphis-black/60",
                  )}
                >
                  <span
                    className="w-2 h-2 bg-memphis-pink border-2 border-memphis-black inline-block"
                    style={{ animation: "ecPulse 1s steps(1) infinite" }}
                  />
                  Loading view
                </span>
              </div>
            }
          >
            {renderModeContent({
              mode,
              token,
              user,
              countryData,
              countryLoading,
              countryError,
              analyticsData,
              analyticsLoading,
              analyticsError,
              loadCountry,
              loadAnalyticsCountry,
              handleRefreshCountry,
            })}
          </Suspense>
        </div>
      </main>

      {isMobile && (
        <nav
          className={cn(
            "fixed bottom-0 left-0 right-0 z-[110] bg-white border-t-3",
            "border-memphis-black px-1 pt-1",
            "pb-[max(8px,env(safe-area-inset-bottom))]",
          )}
        >
          <div className="grid grid-cols-3 gap-1">
            {MOBILE_PRIMARY_MODES.map((m) => {
              const def = MODES.find((modeDef) => modeDef.mode === m);
              const Icon = def?.Icon ?? BarChart3;
              const active = m === mode;
              return (
                <button
                  key={m}
                  onClick={() => switchMode(m)}
                  className={cn(
                    "min-h-11 px-1.5 py-1 border-2 border-memphis-black",
                    "flex flex-col items-center justify-center text-[10px]",
                    "font-black uppercase tracking-wide",
                    active
                      ? "bg-memphis-black text-white"
                      : "bg-memphis-offwhite text-memphis-black",
                  )}
                  aria-label={def?.label ?? m}
                >
                  <Icon className="w-4 h-4 leading-none" />
                  <span className="leading-none mt-1">
                    {def?.label.split(" ")[0]}
                  </span>
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
          />
        </Suspense>
      )}
    </div>
  );
}
