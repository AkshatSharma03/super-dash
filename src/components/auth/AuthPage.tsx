// ─────────────────────────────────────────────────────────────────────────────
// AUTH PAGE  —  landing page shown to unauthenticated visitors.
// Left: hero explaining the product. Right: login / register form.
// ─────────────────────────────────────────────────────────────────────────────
import { useState, type ComponentType } from "react";
import { SignIn, SignUp } from "@clerk/react";
import { guestLogin } from "../../utils/api";
import type { User } from "../../types";
import { useMobile } from "../../utils/useMobile";
import { Button }  from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertTriangle, MessageSquare, Search, Database, LineChart, Globe2, BarChart3 } from "lucide-react";
import { cn } from "@/lib/utils";

interface AuthPageProps {
  onGuestAuth: (token: string, user: User) => void;
}

const FEATURES: [ComponentType<{ className?: string }>, string, string][] = [
  [MessageSquare, "AI-powered charts", "Ask any economic question in plain language — get publication-ready interactive charts in seconds"],
  [Search, "Live web search",   "Pull current data directly from World Bank, IMF, OECD, and national statistics offices"],
  [Database, "Your own data",     "Upload any CSV and get instant AI-powered charts and expert analysis"],
  [LineChart, "Deep analytics",    "OLS regression, K-Means clustering, HHI concentration, and anomaly detection on real data"],
  [Globe2, "Global dashboards",  "Instant dashboards for any country — US, China, EU, Japan and more — 15+ years of GDP, trade, and sector data"],
];

type View = "login" | "register";

const clerkAppearance = {
  variables: {
    colorPrimary: "#FF006E",
    colorText: "#1A1A2E",
    colorBackground: "#FFFFFF",
    colorInputBackground: "#FFFFFF",
    colorInputText: "#1A1A2E",
    colorDanger: "#FB5607",
  },
  elements: {
    card: "shadow-none border-0 p-0 bg-transparent",
    rootBox: "w-full",
    headerTitle: "hidden",
    headerSubtitle: "hidden",
    socialButtonsBlockButton: "border-3 border-memphis-black rounded-none shadow-hard text-memphis-black font-black",
    socialButtonsBlockButtonText: "font-black",
    formFieldLabel: "text-[11px] uppercase tracking-wide font-black text-memphis-black",
    formFieldInput:
      "h-11 border-3 border-memphis-black/20 rounded-none text-memphis-black placeholder:text-memphis-black/40 focus:border-memphis-pink focus:ring-0",
    formButtonPrimary:
      "h-10 rounded-none border-3 border-memphis-black bg-memphis-pink text-white font-black uppercase tracking-wide shadow-hard hover:bg-memphis-pink",
    footerActionLink: "text-memphis-pink font-black",
    identityPreviewText: "text-memphis-black",
    formResendCodeLink: "text-memphis-pink font-black",
    otpCodeFieldInput: "border-3 border-memphis-black/20 rounded-none",
    alertText: "text-memphis-black",
  },
} as const;

export default function AuthPage({ onGuestAuth }: AuthPageProps) {
  const isMobile = useMobile();
  const [view,         setView]        = useState<View>("login");
  const [guestLoading, setGuestLoading] = useState(false);
  const [error,        setError]       = useState<string | null>(null);
  const visibleFeatures = isMobile ? FEATURES.slice(0, 3) : FEATURES;

  const switchToLogin = () => { setView("login"); setError(null); };
  const switchToRegister = () => { setView("register"); setError(null); };

  const continueAsGuest = async () => {
    if (guestLoading) return;
    setGuestLoading(true);
    setError(null);
    try {
      const result = await guestLogin();
      onGuestAuth(result.token, result.user);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start guest session");
    } finally {
      setGuestLoading(false);
    }
  };
  const renderAuthForm = () => (
    <>
      <div className="mb-5">
        <h2 className="text-xl font-extrabold text-memphis-black tracking-[-0.3px] mb-1.5">
          {view === "login" ? "Welcome back" : "Create your account"}
        </h2>
        <p className="text-xs text-muted-foreground">
          {view === "login"
            ? "Sign in to access your dashboard and chat history"
            : "Create your account and start generating charts"}
        </p>
      </div>

      {/* Tab toggle */}
      <div className="flex bg-white border-3 border-memphis-black p-1 mb-5 shadow-hard">
        {(["login", "register"] as const).map(t => (
          <button key={t} onClick={() => t === "login" ? switchToLogin() : switchToRegister()}
            className={cn(
              "flex-1 py-2 text-xs font-black transition-snap border-3 cursor-pointer uppercase tracking-wide",
              view === t ? "bg-memphis-pink text-white border-memphis-black shadow-hard-sm" : "bg-transparent text-memphis-black border-transparent"
            )}>
            {t === "login" ? "Sign in" : "Register"}
          </button>
        ))}
      </div>

      <div className="border-3 border-memphis-black bg-white p-3 shadow-hard">
        {view === "login" ? (
          <SignIn
            routing="hash"
            signUpUrl="#register"
            forceRedirectUrl="/"
            appearance={clerkAppearance}
          />
        ) : (
          <SignUp
            routing="hash"
            signInUrl="#login"
            forceRedirectUrl="/"
            appearance={clerkAppearance}
          />
        )}
      </div>

      {error && (
        <Alert variant="destructive" className="mt-3.5">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="flex items-center gap-2.5 mt-4">
        <div className="flex-1 h-1 bg-memphis-black" />
        <span className="text-[11px] text-memphis-black/50 font-bold">or</span>
        <div className="flex-1 h-1 bg-memphis-black" />
      </div>
      <Button variant="outline" onClick={continueAsGuest} disabled={guestLoading} className="mt-3 w-full">
        {guestLoading ? "Starting…" : "Continue without account →"}
      </Button>
      <p className="text-center text-[10px] text-border mt-2">No email required · Chat history not saved</p>
    </>
  );

  return (
    <div className="bg-background min-h-[100dvh] text-foreground" style={{ fontFamily: "Inter,sans-serif" }}>

      {/* ── Top nav ── */}
      <nav className="px-3 sm:px-8 py-3 border-b-3 border-memphis-black flex items-center gap-2 sm:gap-3 bg-white">
        <div className="w-8 h-8 border-3 border-memphis-black flex items-center justify-center text-base shadow-hard-sm"
          style={{ background: "#FF006E" }}>
          <BarChart3 className="w-4 h-4 text-white" />
        </div>
        <span className="text-[13px] sm:text-[15px] font-black text-memphis-black tracking-tight uppercase">EconChart</span>
        <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
          {view !== "login" && (
            <Button onClick={switchToLogin} size="sm" className="px-3 sm:px-4 whitespace-nowrap">
              Sign in
            </Button>
          )}
          <Button onClick={continueAsGuest} disabled={guestLoading} size="sm" className="px-3 sm:px-4 whitespace-nowrap">
            {guestLoading ? "Starting…" : <><span className="sm:hidden">Start free</span><span className="hidden sm:inline">Get started free</span></>}
          </Button>
        </div>
      </nav>

      {/* ── Body: hero + form ── */}
      <div className="flex min-h-[calc(100dvh-63px)] flex-col lg:flex-row">

        {/* Left: hero */}
        <div className="order-2 lg:order-1 flex-1 min-w-0 px-5 sm:px-8 lg:px-14 py-6 sm:py-10 lg:py-[60px] flex flex-col justify-center">
          <div className="max-w-[540px]">
            <div className="text-[10px] font-black uppercase tracking-[2px] mb-5 bg-memphis-pink/10 border-2 border-memphis-pink inline-flex items-center gap-1.5 px-3.5 py-1.5 text-memphis-pink">
              <span className="w-2 h-2 bg-memphis-pink inline-block" style={{ animation: "pulse 2s ease-in-out infinite" }} />
              Economic Intelligence Platform
            </div>
            <h1 className="text-[28px] sm:text-[32px] lg:text-[38px] font-black leading-[1.15] text-memphis-black tracking-[-0.5px] mb-4">
              Generate accurate dynamic charts for any economic query
            </h1>
            <p className="text-sm text-memphis-black/70 leading-[1.8] mb-8 lg:mb-10">
              Ask questions in plain language. Get interactive, publication-ready charts backed by World Bank, IMF, UN Comtrade, and OECD data — for any country or region in the world.
            </p>
            <div className="flex flex-col gap-3.5">
              {visibleFeatures.map(([Icon, title, desc]) => (
                <div key={title} className="flex gap-3 items-start">
                  <div className="w-8 h-8 sm:w-9 sm:h-9 border-2 border-memphis-black bg-white flex items-center justify-center shrink-0 shadow-hard-sm">
                    <Icon className="w-4 h-4 sm:w-5 sm:h-5 text-memphis-black" />
                  </div>
                  <div>
                    <div className="text-[13px] font-semibold text-memphis-black mb-0.5">{title}</div>
                    <div className="text-xs text-memphis-black/60 leading-[1.55]">{desc}</div>
                  </div>
                </div>
              ))}
              {isMobile && FEATURES.length > visibleFeatures.length && (
                <p className="text-[11px] text-memphis-black/60 font-semibold">
                  +{FEATURES.length - visibleFeatures.length} more capabilities after sign-in
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Right: auth form */}
        <div className="order-1 lg:order-2 w-full lg:w-[420px] shrink-0 px-5 sm:px-8 lg:px-11 py-6 sm:py-10 lg:py-[60px] border-b-3 lg:border-b-0 lg:border-l-3 border-memphis-black flex flex-col justify-center bg-white">
          {renderAuthForm()}
        </div>
      </div>
    </div>
  );
}
