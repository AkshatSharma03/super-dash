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
  ["🌍", "Global dashboards",  "Instant dashboards for any country — US, China, EU, Japan and more — 15+ years of GDP, trade, and sector data"],
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
    background: "#161929", border: "1px solid #2d3348", borderRadius: 8,
    padding: "10px 14px", color: "#e2e8f0", fontSize: 13, outline: "none",
    transition: "border-color .15s, box-shadow .15s", width: "100%", boxSizing: "border-box",
  };
  const lbl: React.CSSProperties = {
    fontSize: 11, fontWeight: 600, color: "#64748b", display: "block",
    marginBottom: 5, textTransform: "uppercase", letterSpacing: "0.6px",
  };

  return (
    <div style={{ fontFamily: "Inter,sans-serif", background: "#0f1117", minHeight: "100vh", color: "#e2e8f0" }}>

      {/* ── Top nav ── */}
      <div style={{ padding: "12px 32px", borderBottom: "1px solid #1e2130", display: "flex", alignItems: "center", gap: 12, background: "#0a0d14" }}>
        <div style={{ width: 32, height: 32, borderRadius: 8, background: "linear-gradient(135deg,#00AAFF,#8B5CF6)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, boxShadow: "0 0 12px #00AAFF44" }}>📊</div>
        <span style={{ fontSize: 15, fontWeight: 800, color: "#fff", letterSpacing: "-0.3px" }}>EconChart</span>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          <button onClick={() => switchTab("login")}
            style={{ background: "transparent", border: "1px solid #2d3348", borderRadius: 7, padding: "7px 18px", fontSize: 12, color: "#94a3b8", cursor: "pointer", transition: "all .15s" }}
            onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = "#64748b"; (e.currentTarget as HTMLButtonElement).style.color = "#e2e8f0"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = "#2d3348"; (e.currentTarget as HTMLButtonElement).style.color = "#94a3b8"; }}>
            Sign in
          </button>
          <button onClick={() => switchTab("register")}
            style={{ background: "linear-gradient(135deg,#00AAFF,#0088DD)", border: "none", borderRadius: 7, padding: "7px 18px", fontSize: 12, fontWeight: 700, color: "#fff", cursor: "pointer", boxShadow: "0 2px 10px #00AAFF44" }}>
            Get started free
          </button>
        </div>
      </div>

      {/* ── Body: hero + form ── */}
      <div style={{ display: "flex", minHeight: "calc(100vh - 63px)", flexWrap: "wrap" }}>

        {/* Left: hero */}
        <div style={{ flex: 1, minWidth: 320, padding: "60px 56px", display: "flex", flexDirection: "column", justifyContent: "center" }}>
          <div style={{ maxWidth: 540 }}>
            <div style={{ fontSize: 10, color: "#00AAFF", fontWeight: 700, textTransform: "uppercase", letterSpacing: 2, marginBottom: 20, background: "#00AAFF12", border: "1px solid #00AAFF30", borderRadius: 20, display: "inline-flex", alignItems: "center", gap: 6, padding: "5px 14px" }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#00AAFF", display: "inline-block", animation: "pulse 2s ease-in-out infinite" }} />
              Economic Intelligence Platform
            </div>
            <h1 style={{ margin: "0 0 16px", fontSize: 38, fontWeight: 900, lineHeight: 1.15, color: "#fff", letterSpacing: "-0.5px" }}>
              Generate accurate dynamic charts for any economic query
            </h1>
            <p style={{ margin: "0 0 40px", fontSize: 14, color: "#64748b", lineHeight: 1.8 }}>
              Ask questions in plain language. Get interactive, publication-ready charts backed by World Bank, IMF, UN Comtrade, and OECD data — for any country or region in the world.
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {FEATURES.map(([icon, title, desc]) => (
                <div key={title} style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
                  <div style={{ width: 34, height: 34, borderRadius: 8, background: "#161929", border: "1px solid #2d3348", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, flexShrink: 0 }}>
                    {icon}
                  </div>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "#cbd5e1", marginBottom: 2 }}>{title}</div>
                    <div style={{ fontSize: 12, color: "#475569", lineHeight: 1.55 }}>{desc}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right: auth form */}
        <div style={{ width: 420, flexShrink: 0, padding: "60px 44px", borderLeft: "1px solid #1e2130", display: "flex", flexDirection: "column", justifyContent: "center", background: "#0a0d14" }}>
          <div style={{ marginBottom: 22 }}>
            <h2 style={{ margin: "0 0 6px", fontSize: 20, fontWeight: 800, color: "#fff", letterSpacing: "-0.3px" }}>
              {tab === "login" ? "Welcome back" : "Create your account"}
            </h2>
            <p style={{ margin: 0, fontSize: 12, color: "#475569" }}>
              {tab === "login"
                ? "Sign in to access your dashboard and chat history"
                : "Start generating economic charts — it's free"}
            </p>
          </div>

          {/* Tab toggle */}
          <div style={{ display: "flex", background: "#161929", borderRadius: 9, padding: 3, marginBottom: 22, border: "1px solid #2d3348" }}>
            {(["login", "register"] as const).map(t => (
              <button key={t} onClick={() => switchTab(t)}
                style={{ flex: 1, background: tab === t ? "#2a3045" : "transparent", border: "none", borderRadius: 7, padding: "7px 0", fontSize: 12, fontWeight: 600, color: tab === t ? "#e2e8f0" : "#475569", cursor: "pointer", transition: "all .15s" }}>
                {t === "login" ? "Sign in" : "Register"}
              </button>
            ))}
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {tab === "register" && (
              <div>
                <label style={lbl}>Full Name</label>
                <input value={name} onChange={e => setName(e.target.value)} placeholder="Your name"
                  style={inp}
                  onFocus={e => { (e.target as HTMLInputElement).style.borderColor = "#00AAFF"; (e.target as HTMLInputElement).style.boxShadow = "0 0 0 3px #00AAFF18"; }}
                  onBlur={e  => { (e.target as HTMLInputElement).style.borderColor = "#2d3348"; (e.target as HTMLInputElement).style.boxShadow = "none"; }} />
              </div>
            )}
            <div>
              <label style={lbl}>Email Address</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com"
                style={inp}
                onFocus={e => { (e.target as HTMLInputElement).style.borderColor = "#00AAFF"; (e.target as HTMLInputElement).style.boxShadow = "0 0 0 3px #00AAFF18"; }}
                onBlur={e  => { (e.target as HTMLInputElement).style.borderColor = "#2d3348"; (e.target as HTMLInputElement).style.boxShadow = "none"; }} />
            </div>
            <div>
              <label style={lbl}>Password</label>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Min. 8 characters"
                onKeyDown={e => e.key === "Enter" && submit()}
                style={inp}
                onFocus={e => { (e.target as HTMLInputElement).style.borderColor = "#00AAFF"; (e.target as HTMLInputElement).style.boxShadow = "0 0 0 3px #00AAFF18"; }}
                onBlur={e  => { (e.target as HTMLInputElement).style.borderColor = "#2d3348"; (e.target as HTMLInputElement).style.boxShadow = "none"; }} />
            </div>
          </div>

          {error && (
            <div style={{ background: "#EF444418", border: "1px solid #EF444455", borderRadius: 8, padding: "10px 14px", fontSize: 12, color: "#EF4444", marginTop: 14, display: "flex", gap: 8, alignItems: "flex-start" }}>
              <span style={{ flexShrink: 0 }}>⚠</span> {error}
            </div>
          )}

          <button onClick={submit} disabled={loading}
            style={{ marginTop: 16, background: loading ? "#1e2130" : "linear-gradient(135deg, #00AAFF, #0088DD)", border: "none", borderRadius: 9, padding: "12px", fontSize: 13, fontWeight: 700, color: loading ? "#334155" : "#fff", cursor: loading ? "not-allowed" : "pointer", transition: "all .15s", width: "100%", boxShadow: loading ? "none" : "0 4px 14px #00AAFF44" }}>
            {loading ? "Please wait…" : tab === "login" ? "Sign in →" : "Create account →"}
          </button>

          <p style={{ textAlign: "center", fontSize: 11, color: "#334155", marginTop: 18 }}>
            {tab === "login" ? "Don't have an account? " : "Already have an account? "}
            <button onClick={() => switchTab(tab === "login" ? "register" : "login")}
              style={{ background: "transparent", border: "none", color: "#00AAFF", fontSize: 11, cursor: "pointer", padding: 0, fontWeight: 600 }}>
              {tab === "login" ? "Register free" : "Sign in"}
            </button>
          </p>
        </div>
      </div>
    </div>
  );
}
