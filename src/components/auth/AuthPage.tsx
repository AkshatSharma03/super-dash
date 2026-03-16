// ─────────────────────────────────────────────────────────────────────────────
// AUTH PAGE  —  landing page shown to unauthenticated visitors.
// Left: hero explaining the product. Right: login / register form.
// ─────────────────────────────────────────────────────────────────────────────
import { useState } from "react";
import { login, register } from "../../utils/api";
import type { User } from "../../types";

interface AuthPageProps {
  onAuth: (token: string, user: User) => void;
}

const FEATURES = [
  ["💬", "AI-powered charts", "Ask any economic question in plain language — get publication-ready interactive charts in seconds"],
  ["🔍", "Live web search",   "Pull current data directly from World Bank, IMF, OECD, and national statistics offices"],
  ["📁", "Your own data",     "Upload any CSV and get instant AI-powered charts and expert analysis"],
  ["🧮", "Deep analytics",    "OLS regression, K-Means clustering, HHI concentration, and anomaly detection on real data"],
  ["🇰🇿", "Kazakhstan data",   "Pre-built dashboard with 15 years of Kazakhstan economic data — GDP, trade, exports, imports"],
];

export default function AuthPage({ onAuth }: AuthPageProps) {
  const [tab,      setTab]      = useState<"login" | "register">("login");
  const [name,     setName]     = useState("");
  const [email,    setEmail]    = useState("");
  const [password, setPassword] = useState("");
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState<string | null>(null);

  const switchTab = (t: "login" | "register") => { setTab(t); setError(null); };

  const submit = async () => {
    if (loading) return;
    setLoading(true);
    setError(null);
    try {
      const result = tab === "login"
        ? await login(email, password)
        : await register(email, password, name);
      onAuth(result.token, result.user);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Something went wrong";
      // Strip JSON wrapping if the server sent a plain error object
      try { setError(JSON.parse(msg).error ?? msg); } catch { setError(msg); }
    }
    setLoading(false);
  };

  const inp: React.CSSProperties = {
    background: "#1a1f2e", border: "1px solid #2d3348", borderRadius: 8,
    padding: "11px 14px", color: "#e2e8f0", fontSize: 13, outline: "none",
    transition: "border-color .15s", width: "100%", boxSizing: "border-box",
  };

  return (
    <div style={{ fontFamily: "Inter,sans-serif", background: "#0f1117", minHeight: "100vh", color: "#e2e8f0" }}>

      {/* ── Top nav ── */}
      <div style={{ padding: "14px 32px", borderBottom: "1px solid #1e2130", display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{ width: 34, height: 34, borderRadius: 8, background: "linear-gradient(135deg,#00AAFF,#8B5CF6)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 17 }}>📊</div>
        <span style={{ fontSize: 16, fontWeight: 800, color: "#fff" }}>EconChart</span>
        <div style={{ marginLeft: "auto", display: "flex", gap: 10 }}>
          <button onClick={() => switchTab("login")}
            style={{ background: "transparent", border: "1px solid #2d3348", borderRadius: 7, padding: "7px 18px", fontSize: 12, color: "#94a3b8", cursor: "pointer" }}>
            Sign in
          </button>
          <button onClick={() => switchTab("register")}
            style={{ background: "#00AAFF", border: "none", borderRadius: 7, padding: "7px 18px", fontSize: 12, fontWeight: 700, color: "#fff", cursor: "pointer" }}>
            Get started free
          </button>
        </div>
      </div>

      {/* ── Body: hero + form ── */}
      <div style={{ display: "flex", minHeight: "calc(100vh - 63px)", flexWrap: "wrap" }}>

        {/* Left: hero */}
        <div style={{ flex: 1, minWidth: 320, padding: "64px 56px", display: "flex", flexDirection: "column", justifyContent: "center" }}>
          <div style={{ maxWidth: 540 }}>
            <div style={{ fontSize: 11, color: "#00AAFF", fontWeight: 700, textTransform: "uppercase", letterSpacing: 1.5, marginBottom: 18, background: "#00AAFF11", border: "1px solid #00AAFF33", borderRadius: 20, display: "inline-block", padding: "4px 14px" }}>
              Economic Intelligence Platform
            </div>
            <h1 style={{ margin: "0 0 18px", fontSize: 40, fontWeight: 900, lineHeight: 1.15, color: "#fff" }}>
              Generate accurate dynamic charts for any economic query
            </h1>
            <p style={{ margin: "0 0 44px", fontSize: 15, color: "#94a3b8", lineHeight: 1.8 }}>
              Ask questions in plain language. Get interactive, publication-ready charts backed by World Bank, IMF, UN Comtrade, and OECD data — for any country or region in the world.
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              {FEATURES.map(([icon, title, desc]) => (
                <div key={title} style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
                  <div style={{ width: 36, height: 36, borderRadius: 8, background: "#1e2130", border: "1px solid #2d3348", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, flexShrink: 0 }}>
                    {icon}
                  </div>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: "#e2e8f0", marginBottom: 2 }}>{title}</div>
                    <div style={{ fontSize: 12, color: "#64748b", lineHeight: 1.55 }}>{desc}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right: auth form */}
        <div style={{ width: 420, flexShrink: 0, padding: "64px 44px", borderLeft: "1px solid #1e2130", display: "flex", flexDirection: "column", justifyContent: "center", background: "#0a0d14" }}>
          <div style={{ marginBottom: 24 }}>
            <h2 style={{ margin: "0 0 6px", fontSize: 20, fontWeight: 800, color: "#fff" }}>
              {tab === "login" ? "Welcome back" : "Create your account"}
            </h2>
            <p style={{ margin: 0, fontSize: 12, color: "#64748b" }}>
              {tab === "login"
                ? "Sign in to access your dashboard and chat history"
                : "Start generating economic charts — it's free"}
            </p>
          </div>

          {/* Tab toggle */}
          <div style={{ display: "flex", background: "#1e2130", borderRadius: 8, padding: 3, marginBottom: 20, border: "1px solid #2d3348" }}>
            {(["login", "register"] as const).map(t => (
              <button key={t} onClick={() => switchTab(t)}
                style={{ flex: 1, background: tab === t ? "#2d3348" : "transparent", border: "none", borderRadius: 6, padding: "7px 0", fontSize: 12, fontWeight: 600, color: tab === t ? "#e2e8f0" : "#64748b", cursor: "pointer", transition: "all .15s" }}>
                {t === "login" ? "Sign in" : "Register"}
              </button>
            ))}
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {tab === "register" && (
              <input value={name} onChange={e => setName(e.target.value)} placeholder="Full name"
                style={inp}
                onFocus={e => { (e.target as HTMLInputElement).style.borderColor = "#00AAFF"; }}
                onBlur={e  => { (e.target as HTMLInputElement).style.borderColor = "#2d3348"; }} />
            )}
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="Email address"
              style={inp}
              onFocus={e => { (e.target as HTMLInputElement).style.borderColor = "#00AAFF"; }}
              onBlur={e  => { (e.target as HTMLInputElement).style.borderColor = "#2d3348"; }} />
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Password (min. 8 characters)"
              onKeyDown={e => e.key === "Enter" && submit()}
              style={inp}
              onFocus={e => { (e.target as HTMLInputElement).style.borderColor = "#00AAFF"; }}
              onBlur={e  => { (e.target as HTMLInputElement).style.borderColor = "#2d3348"; }} />
          </div>

          {error && (
            <div style={{ background: "#EF444422", border: "1px solid #EF4444", borderRadius: 8, padding: "10px 14px", fontSize: 12, color: "#EF4444", marginTop: 12 }}>
              {error}
            </div>
          )}

          <button onClick={submit} disabled={loading}
            style={{ marginTop: 14, background: loading ? "#1e2130" : "#00AAFF", border: "none", borderRadius: 9, padding: "12px", fontSize: 13, fontWeight: 700, color: loading ? "#334155" : "#fff", cursor: loading ? "not-allowed" : "pointer", transition: "all .15s", width: "100%" }}>
            {loading ? "Please wait…" : tab === "login" ? "Sign in →" : "Create account →"}
          </button>

          <p style={{ textAlign: "center", fontSize: 11, color: "#334155", marginTop: 18 }}>
            {tab === "login" ? "Don't have an account? " : "Already have an account? "}
            <button onClick={() => switchTab(tab === "login" ? "register" : "login")}
              style={{ background: "transparent", border: "none", color: "#00AAFF", fontSize: 11, cursor: "pointer", padding: 0 }}>
              {tab === "login" ? "Register free" : "Sign in"}
            </button>
          </p>
        </div>
      </div>
    </div>
  );
}
