// ─────────────────────────────────────────────────────────────────────────────
// AUTH PAGE  —  landing page shown to unauthenticated visitors.
// Left: hero explaining the product. Right: login / register form.
// ─────────────────────────────────────────────────────────────────────────────
import { useState, useEffect } from "react";
import { login, register, guestLogin, requestPasswordReset, resetPassword } from "../../utils/api";
import type { User } from "../../types";
import { Button }  from "@/components/ui/button";
import { Input }   from "@/components/ui/input";
import { Label }   from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface AuthPageProps {
  onAuth: (token: string, user: User) => void;
}

const FEATURES = [
  ["💬", "AI-powered charts", "Ask any economic question in plain language — get publication-ready interactive charts in seconds"],
  ["🔍", "Live web search",   "Pull current data directly from World Bank, IMF, OECD, and national statistics offices"],
  ["📁", "Your own data",     "Upload any CSV and get instant AI-powered charts and expert analysis"],
  ["🧮", "Deep analytics",    "OLS regression, K-Means clustering, HHI concentration, and anomaly detection on real data"],
  ["🌍", "Global dashboards",  "Instant dashboards for any country — US, China, EU, Japan and more — 15+ years of GDP, trade, and sector data"],
];

type View = "login" | "register" | "forgot" | "reset";

export default function AuthPage({ onAuth }: AuthPageProps) {
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
        <h2 className="text-xl font-extrabold text-white tracking-[-0.3px] mb-1.5">Reset your password</h2>
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
        <h2 className="text-xl font-extrabold text-white tracking-[-0.3px] mb-1.5">Choose a new password</h2>
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
        <h2 className="text-xl font-extrabold text-white tracking-[-0.3px] mb-1.5">
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
    <div className="bg-background min-h-screen text-foreground" style={{ fontFamily: "Inter,sans-serif" }}>

      {/* ── Top nav ── */}
      <nav className="px-8 py-3 border-b border-muted flex items-center gap-3 bg-popover">
        <div className="w-8 h-8 rounded-lg flex items-center justify-center text-base shadow-[0_0_12px_#00AAFF44]"
          style={{ background: "linear-gradient(135deg,#00AAFF,#8B5CF6)" }}>
          📊
        </div>
        <span className="text-[15px] font-extrabold text-white tracking-[-0.3px]">EconChart</span>
        <div className="ml-auto flex gap-2">
          <Button variant="outline" size="sm" onClick={switchToLogin}>Sign in</Button>
          <Button size="sm" onClick={continueAsGuest} disabled={guestLoading}
            className="bg-gradient-to-r from-[#00AAFF] to-[#0088DD] shadow-[0_2px_10px_#00AAFF44]">
            {guestLoading ? "Starting…" : "Get started free"}
          </Button>
        </div>
      </nav>

      {/* ── Body: hero + form ── */}
      <div className="flex min-h-[calc(100vh-63px)] flex-wrap">

        {/* Left: hero */}
        <div className="flex-1 min-w-[320px] px-14 py-[60px] flex flex-col justify-center">
          <div className="max-w-[540px]">
            <div className="text-[10px] text-primary font-bold uppercase tracking-[2px] mb-5 bg-primary/10 border border-primary/30 rounded-full inline-flex items-center gap-1.5 px-3.5 py-1">
              <span className="w-1.5 h-1.5 rounded-full bg-primary inline-block" style={{ animation: "pulse 2s ease-in-out infinite" }} />
              Economic Intelligence Platform
            </div>
            <h1 className="text-[38px] font-black leading-[1.15] text-memphis-black tracking-[-0.5px] mb-4">
              Generate accurate dynamic charts for any economic query
            </h1>
            <p className="text-sm text-muted-foreground leading-[1.8] mb-10">
              Ask questions in plain language. Get interactive, publication-ready charts backed by World Bank, IMF, UN Comtrade, and OECD data — for any country or region in the world.
            </p>
            <div className="flex flex-col gap-3.5">
              {FEATURES.map(([icon, title, desc]) => (
                <div key={title} className="flex gap-3.5 items-start">
                  <div className="w-9 h-9 rounded-lg bg-card border border-border flex items-center justify-center text-[15px] shrink-0">
                    {icon}
                  </div>
                  <div>
                    <div className="text-[13px] font-semibold text-memphis-black mb-0.5">{title}</div>
                    <div className="text-xs text-muted-foreground leading-[1.55]">{desc}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right: auth form */}
        <div className="w-[420px] shrink-0 px-11 py-[60px] border-l border-muted flex flex-col justify-center bg-popover">
          {view === "forgot" && renderForgotForm()}
          {view === "reset"  && renderResetForm()}
          {(view === "login" || view === "register") && renderAuthForm()}
        </div>
      </div>
    </div>
  );
}
