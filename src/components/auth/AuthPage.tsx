// ─────────────────────────────────────────────────────────────────────────────
// AUTH PAGE  —  landing page shown to unauthenticated visitors.
// Left: hero explaining the product. Right: login / register form.
// ─────────────────────────────────────────────────────────────────────────────
import { useState, useEffect, type ComponentType } from "react";
import { login, register, guestLogin, requestPasswordReset, resetPassword } from "../../utils/api";
import type { User } from "../../types";
import { useMobile } from "../../utils/useMobile";
import { Button }  from "@/components/ui/button";
import { Input }   from "@/components/ui/input";
import { Label }   from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertTriangle, CheckCircle2, MessageSquare, Search, Database, LineChart, Globe2, BarChart3 } from "lucide-react";
import { cn } from "@/lib/utils";

interface AuthPageProps {
  onAuth: (token: string, user: User) => void;
}

const FEATURES: [ComponentType<{ className?: string }>, string, string][] = [
  [MessageSquare, "AI-powered charts", "Ask any economic question in plain language — get publication-ready interactive charts in seconds"],
  [Search, "Live web search",   "Pull current data directly from World Bank, IMF, OECD, and national statistics offices"],
  [Database, "Your own data",     "Upload any CSV and get instant AI-powered charts and expert analysis"],
  [LineChart, "Deep analytics",    "OLS regression, K-Means clustering, HHI concentration, and anomaly detection on real data"],
  [Globe2, "Global dashboards",  "Instant dashboards for any country — US, China, EU, Japan and more — 15+ years of GDP, trade, and sector data"],
];

type View = "login" | "register" | "forgot" | "reset";

export default function AuthPage({ onAuth }: AuthPageProps) {
  const isMobile = useMobile();
  const [view,         setView]        = useState<View>("login");
  const [name,         setName]        = useState("");
  const [email,        setEmail]       = useState("");
  const [password,     setPassword]    = useState("");
  const [newPassword,  setNewPassword] = useState("");
  const [confirmPw,    setConfirmPw]   = useState("");
  const [loading,      setLoading]     = useState(false);
  const [guestLoading, setGuestLoading] = useState(false);
  const [error,        setError]       = useState<string | null>(null);
  const [success,      setSuccess]     = useState<string | null>(null);
  const [resetToken,   setResetToken]  = useState<string | null>(null);
  // Dev-mode: server returns reset URL when SMTP is not configured
  const [devResetUrl,  setDevResetUrl] = useState<string | null>(null);
  const visibleFeatures = isMobile ? FEATURES.slice(0, 3) : FEATURES;

  // Detect ?reset=TOKEN in the URL and switch to reset view
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token  = params.get("reset");
    if (token) {
      setResetToken(token);
      setView("reset");
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }, []);

  const switchToLogin    = () => { setView("login");    setError(null); setSuccess(null); };
  const switchToRegister = () => { setView("register"); setError(null); setSuccess(null); };
  const switchToForgot   = () => { setView("forgot");   setError(null); setSuccess(null); setDevResetUrl(null); };

  const continueAsGuest = async () => {
    if (guestLoading) return;
    setGuestLoading(true);
    setError(null);
    try {
      const result = await guestLogin();
      onAuth(result.token, result.user);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start guest session");
    } finally {
      setGuestLoading(false);
    }
  };

  const submit = async () => {
    if (loading) return;
    setLoading(true);
    setError(null);
    try {
      const result = view === "login"
        ? await login(email, password)
        : await register(email, password, name);
      onAuth(result.token, result.user);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Something went wrong";
      try { setError(JSON.parse(msg).error ?? msg); } catch { setError(msg); }
    } finally {
      setLoading(false);
    }
  };

  const submitForgot = async () => {
    if (loading) return;
    setLoading(true);
    setError(null);
    setDevResetUrl(null);
    try {
      const res = await requestPasswordReset(email);
      setSuccess("If an account with that email exists, a reset link has been sent.");
      if (res.resetUrl) setDevResetUrl(res.resetUrl);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Something went wrong";
      try { setError(JSON.parse(msg).error ?? msg); } catch { setError(msg); }
    } finally {
      setLoading(false);
    }
  };

  const submitReset = async () => {
    if (loading) return;
    if (newPassword !== confirmPw) { setError("Passwords do not match"); return; }
    if (!resetToken) { setError("Missing reset token"); return; }
    setLoading(true);
    setError(null);
    try {
      await resetPassword(resetToken, newPassword);
      setSuccess("Password updated! You can now sign in with your new password.");
      setResetToken(null);
      setTimeout(() => { setSuccess(null); setView("login"); }, 2500);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Something went wrong";
      try { setError(JSON.parse(msg).error ?? msg); } catch { setError(msg); }
    } finally {
      setLoading(false);
    }
  };

  // ── Render helpers ──────────────────────────────────────────────────────────

  const renderForgotForm = () => (
    <>
      <div className="mb-5">
        <h2 className="text-xl font-extrabold text-memphis-black tracking-[-0.3px] mb-1.5">Reset your password</h2>
        <p className="text-xs text-muted-foreground">Enter your email and we'll send a reset link</p>
      </div>

      <div className="flex flex-col gap-3.5">
        <div>
          <Label htmlFor="forgot-email">Email Address</Label>
          <Input id="forgot-email" type="email" value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="you@example.com"
            onKeyDown={e => e.key === "Enter" && submitForgot()} />
        </div>
      </div>

      {error && (
        <Alert variant="destructive" className="mt-3.5">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {success && (
        <Alert className="mt-3.5 border-emerald-800 bg-emerald-950 text-emerald-300">
          <CheckCircle2 className="h-4 w-4 text-emerald-400" />
          <AlertDescription>{success}</AlertDescription>
        </Alert>
      )}

      {devResetUrl && (
        <div className="mt-3 p-3 bg-[#1a1f2e] border border-[#2d3860] rounded-lg">
          <p className="text-[11px] text-muted-foreground font-semibold mb-1.5">
            DEV MODE — no SMTP configured. Use this link to reset:
          </p>
          <a href={devResetUrl} className="text-[11px] text-primary break-all">{devResetUrl}</a>
        </div>
      )}

      <Button onClick={submitForgot} disabled={loading || !!success}
        className="mt-4 w-full bg-gradient-to-r from-[#00AAFF] to-[#0088DD] shadow-[0_4px_14px_#00AAFF44] font-bold">
        {loading ? "Sending…" : "Send reset link →"}
      </Button>

      <p className="text-center text-[11px] text-border mt-4">
        Remembered it?{" "}
        <Button variant="link" size="sm" onClick={switchToLogin} className="h-auto p-0 text-xs text-primary">
          Back to sign in
        </Button>
      </p>
    </>
  );

  const renderResetForm = () => (
    <>
      <div className="mb-5">
        <h2 className="text-xl font-extrabold text-memphis-black tracking-[-0.3px] mb-1.5">Choose a new password</h2>
        <p className="text-xs text-muted-foreground">Must be at least 8 characters</p>
      </div>

      <div className="flex flex-col gap-3.5">
        <div>
          <Label htmlFor="new-password">New Password</Label>
          <Input id="new-password" type="password" value={newPassword}
            onChange={e => setNewPassword(e.target.value)}
            placeholder="Min. 8 characters" />
        </div>
        <div>
          <Label htmlFor="confirm-password">Confirm Password</Label>
          <Input id="confirm-password" type="password" value={confirmPw}
            onChange={e => setConfirmPw(e.target.value)}
            placeholder="Repeat your new password"
            onKeyDown={e => e.key === "Enter" && submitReset()} />
        </div>
      </div>

      {error && (
        <Alert variant="destructive" className="mt-3.5">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {success && (
        <Alert className="mt-3.5 border-emerald-800 bg-emerald-950 text-emerald-300">
          <CheckCircle2 className="h-4 w-4 text-emerald-400" />
          <AlertDescription>{success}</AlertDescription>
        </Alert>
      )}

      <Button onClick={submitReset} disabled={loading || !!success}
        className="mt-4 w-full bg-gradient-to-r from-[#00AAFF] to-[#0088DD] shadow-[0_4px_14px_#00AAFF44] font-bold">
        {loading ? "Updating…" : "Set new password →"}
      </Button>
    </>
  );

  const renderAuthForm = () => (
    <>
      <div className="mb-5">
        <h2 className="text-xl font-extrabold text-memphis-black tracking-[-0.3px] mb-1.5">
          {view === "login" ? "Welcome back" : "Create your account"}
        </h2>
        <p className="text-xs text-muted-foreground">
          {view === "login"
            ? "Sign in to access your dashboard and chat history"
            : "Start generating economic charts — it's free"}
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

      <div className="flex flex-col gap-3.5">
        {view === "register" && (
          <div>
            <Label htmlFor="name">Full Name</Label>
            <Input id="name" value={name} onChange={e => setName(e.target.value)} placeholder="Your name" />
          </div>
        )}
        <div>
          <Label htmlFor="email">Email Address</Label>
          <Input id="email" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" />
        </div>
        <div>
          <div className="flex justify-between items-center mb-1.5">
            <Label htmlFor="password">Password</Label>
            {view === "login" && (
              <button onClick={switchToForgot}
                className="bg-transparent border-none p-0 text-[11px] text-primary cursor-pointer leading-none">
                Forgot password?
              </button>
            )}
          </div>
          <Input id="password" type="password" value={password} onChange={e => setPassword(e.target.value)}
            placeholder="Min. 8 characters" onKeyDown={e => e.key === "Enter" && submit()} />
        </div>
      </div>

      {error && (
        <Alert variant="destructive" className="mt-3.5">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Button onClick={submit} disabled={loading} className="mt-4 w-full bg-gradient-to-r from-[#00AAFF] to-[#0088DD] shadow-[0_4px_14px_#00AAFF44] font-bold">
        {loading ? "Please wait…" : view === "login" ? "Sign in →" : "Create account →"}
      </Button>

      <p className="text-center text-[11px] text-border mt-4">
        {view === "login" ? "Don't have an account? " : "Already have an account? "}
        <Button variant="link" size="sm" onClick={() => view === "login" ? switchToRegister() : switchToLogin()}
          className="h-auto p-0 text-xs text-primary">
          {view === "login" ? "Register free" : "Sign in"}
        </Button>
      </p>

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
      <nav className="px-4 sm:px-8 py-3 border-b-3 border-memphis-black flex items-center gap-3 bg-white">
        <div className="w-8 h-8 border-3 border-memphis-black flex items-center justify-center text-base shadow-hard-sm"
          style={{ background: "#FF006E" }}>
          <BarChart3 className="w-4 h-4 text-white" />
        </div>
        <span className="text-[15px] font-black text-memphis-black tracking-tight uppercase">EconChart</span>
        <div className="ml-auto flex gap-2">
          <Button onClick={switchToLogin}>Sign in</Button>
          <Button onClick={continueAsGuest} disabled={guestLoading}>
            {guestLoading ? "Starting…" : "Get started free"}
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
          {view === "forgot" && renderForgotForm()}
          {view === "reset"  && renderResetForm()}
          {(view === "login" || view === "register") && renderAuthForm()}
        </div>
      </div>
    </div>
  );
}
