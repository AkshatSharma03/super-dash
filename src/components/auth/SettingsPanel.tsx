// ─────────────────────────────────────────────────────────────────────────────
// SETTINGS PANEL  —  slide-in overlay from the right.
// Sections: profile summary + usage stats · change password · delete account.
// ─────────────────────────────────────────────────────────────────────────────
import { useState, useEffect } from "react";
import { getUsage, changePassword, deleteAccount } from "../../utils/api";
import type { User } from "../../types";

interface Props {
  user:     User;
  token:    string;
  onClose:  () => void;
  onLogout: () => void;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 26 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
        <div style={{ flex: 1, height: 1, background: "#1e2130" }} />
        <h3 style={{ margin: 0, fontSize: 10, fontWeight: 700, color: "#475569", textTransform: "uppercase", letterSpacing: "1px", whiteSpace: "nowrap" }}>{title}</h3>
        <div style={{ flex: 1, height: 1, background: "#1e2130" }} />
      </div>
      {children}
    </div>
  );
}

const inp: React.CSSProperties = {
  background: "#0f1117", border: "1px solid #2d3348", borderRadius: 7,
  padding: "10px 12px", color: "#e2e8f0", fontSize: 13, outline: "none",
  width: "100%", boxSizing: "border-box", transition: "border-color .15s",
};

export default function SettingsPanel({ user, token, onClose, onLogout }: Props) {
  // ── Usage state
  const [usage,        setUsage]        = useState<{ sessionCount: number; messageCount: number; memberSince: string } | null>(null);
  const [usageError,   setUsageError]   = useState(false);

  // ── Change password state
  const [curPwd,       setCurPwd]       = useState("");
  const [newPwd,       setNewPwd]       = useState("");
  const [confirmPwd,   setConfirmPwd]   = useState("");
  const [pwdLoading,   setPwdLoading]   = useState(false);
  const [pwdError,     setPwdError]     = useState<string | null>(null);
  const [pwdSuccess,   setPwdSuccess]   = useState(false);

  // ── Delete account state
  const [deletePhase,  setDeletePhase]  = useState<"idle" | "confirm" | "typing">("idle");
  const [deletePwd,    setDeletePwd]    = useState("");
  const [deleteLoading,setDeleteLoading]= useState(false);
  const [deleteError,  setDeleteError]  = useState<string | null>(null);

  useEffect(() => {
    getUsage(token)
      .then(setUsage)
      .catch(() => setUsageError(true));
  }, [token]);

  // ── Helpers
  const parseError = (e: unknown) => {
    const msg = e instanceof Error ? e.message : String(e);
    try { return JSON.parse(msg).error ?? msg; } catch { return msg; }
  };

  const handleChangePassword = async () => {
    setPwdError(null);
    setPwdSuccess(false);
    if (!curPwd || !newPwd || !confirmPwd) { setPwdError("All fields are required."); return; }
    if (newPwd !== confirmPwd) { setPwdError("New passwords do not match."); return; }
    if (newPwd.length < 8) { setPwdError("New password must be at least 8 characters."); return; }
    setPwdLoading(true);
    try {
      await changePassword(token, curPwd, newPwd);
      setPwdSuccess(true);
      setCurPwd(""); setNewPwd(""); setConfirmPwd("");
    } catch (e) { setPwdError(parseError(e)); }
    setPwdLoading(false);
  };

  const handleDeleteAccount = async () => {
    setDeleteError(null);
    setDeleteLoading(true);
    try {
      await deleteAccount(token, deletePwd);
      onLogout();
    } catch (e) { setDeleteError(parseError(e)); }
    setDeleteLoading(false);
  };

  const memberSince = usage
    ? new Date(usage.memberSince).toLocaleDateString("en-US", { month: "long", year: "numeric" })
    : null;

  return (
    <>
      {/* Backdrop */}
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "#00000070", zIndex: 40, animation: "fadeInUp .15s ease-out", backdropFilter: "blur(2px)" }} />

      {/* Panel */}
      <div style={{ position: "fixed", top: 0, right: 0, bottom: 0, width: 360, background: "#0a0d14", borderLeft: "1px solid #1e2130", zIndex: 50, display: "flex", flexDirection: "column", overflowY: "auto", animation: "slideInRight .22s cubic-bezier(0.4, 0, 0.2, 1)" }}>

        {/* Header */}
        <div style={{ padding: "14px 20px", borderBottom: "1px solid #1e2130", display: "flex", alignItems: "center", gap: 10, flexShrink: 0, background: "#080b10" }}>
          <div style={{ width: 28, height: 28, borderRadius: 8, background: "linear-gradient(135deg,#00AAFF,#8B5CF6)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13 }}>⚙</div>
          <span style={{ fontSize: 13, fontWeight: 700, color: "#fff", flex: 1, letterSpacing: "-0.2px" }}>Account Settings</span>
          <button onClick={onClose}
            style={{ background: "#161929", border: "1px solid #2d3348", color: "#64748b", fontSize: 14, cursor: "pointer", lineHeight: 1, padding: "5px 8px", borderRadius: 6, transition: "all .15s" }}
            onMouseEnter={e => { const el = e.currentTarget as HTMLButtonElement; el.style.color = "#e2e8f0"; el.style.borderColor = "#3d4460"; }}
            onMouseLeave={e => { const el = e.currentTarget as HTMLButtonElement; el.style.color = "#64748b"; el.style.borderColor = "#2d3348"; }}>
            ✕
          </button>
        </div>

        <div style={{ padding: "20px", flex: 1 }}>

          {/* ── Profile + Usage ── */}
          <Section title="Profile">
            <div style={{ background: "#161929", border: "1px solid #2d3348", borderRadius: 10, padding: "16px", marginBottom: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: memberSince ? 10 : 0 }}>
                <div style={{ width: 40, height: 40, borderRadius: "50%", background: "linear-gradient(135deg,#00AAFF,#8B5CF6)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 17, fontWeight: 700, color: "#fff", flexShrink: 0, boxShadow: "0 0 14px #00AAFF33" }}>
                  {user.name.charAt(0).toUpperCase()}
                </div>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "#e2e8f0", letterSpacing: "-0.2px" }}>{user.name}</div>
                  <div style={{ fontSize: 12, color: "#475569" }}>{user.email}</div>
                </div>
              </div>
              {memberSince && (
                <div style={{ fontSize: 11, color: "#3d4460", paddingTop: 10, borderTop: "1px solid #1e2130" }}>Member since {memberSince}</div>
              )}
            </div>

            {/* Usage stats */}
            {usageError ? (
              <p style={{ fontSize: 12, color: "#64748b" }}>Could not load usage stats.</p>
            ) : !usage ? (
              <p style={{ fontSize: 12, color: "#334155" }}>Loading…</p>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                {[
                  ["💬", "Conversations", usage.sessionCount.toString()],
                  ["✉️", "Messages sent", usage.messageCount.toString()],
                ].map(([icon, label, value]) => (
                  <div key={label} style={{ background: "#1e2130", border: "1px solid #2d3348", borderRadius: 8, padding: "12px 14px" }}>
                    <div style={{ fontSize: 18, marginBottom: 4 }}>{icon}</div>
                    <div style={{ fontSize: 20, fontWeight: 800, color: "#e2e8f0" }}>{value}</div>
                    <div style={{ fontSize: 11, color: "#64748b" }}>{label}</div>
                  </div>
                ))}
              </div>
            )}
          </Section>

          {/* ── Change password ── */}
          <Section title="Change Password">
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <input type="password" value={curPwd} onChange={e => setCurPwd(e.target.value)}
                placeholder="Current password" style={inp}
                onFocus={e => { (e.target as HTMLInputElement).style.borderColor = "#8B5CF6"; }}
                onBlur={e  => { (e.target as HTMLInputElement).style.borderColor = "#2d3348"; }} />
              <input type="password" value={newPwd} onChange={e => setNewPwd(e.target.value)}
                placeholder="New password (min. 8 characters)" style={inp}
                onFocus={e => { (e.target as HTMLInputElement).style.borderColor = "#8B5CF6"; }}
                onBlur={e  => { (e.target as HTMLInputElement).style.borderColor = "#2d3348"; }} />
              <input type="password" value={confirmPwd} onChange={e => setConfirmPwd(e.target.value)}
                placeholder="Confirm new password"
                onKeyDown={e => e.key === "Enter" && handleChangePassword()}
                style={inp}
                onFocus={e => { (e.target as HTMLInputElement).style.borderColor = "#8B5CF6"; }}
                onBlur={e  => { (e.target as HTMLInputElement).style.borderColor = "#2d3348"; }} />

              {pwdError   && <p style={{ margin: 0, fontSize: 12, color: "#EF4444" }}>{pwdError}</p>}
              {pwdSuccess  && <p style={{ margin: 0, fontSize: 12, color: "#10B981" }}>Password updated successfully.</p>}

              <button onClick={handleChangePassword} disabled={pwdLoading}
                style={{ background: pwdLoading ? "#1e2130" : "#8B5CF6", border: "none", borderRadius: 7, padding: "10px", fontSize: 13, fontWeight: 700, color: pwdLoading ? "#334155" : "#fff", cursor: pwdLoading ? "not-allowed" : "pointer", transition: "all .15s" }}>
                {pwdLoading ? "Updating…" : "Update password"}
              </button>
            </div>
          </Section>

          {/* ── Danger zone ── */}
          <Section title="Danger Zone">
            <div style={{ border: "1px solid #EF444433", borderRadius: 10, padding: 16, background: "#EF444408" }}>
              <p style={{ margin: "0 0 12px", fontSize: 13, color: "#94a3b8", lineHeight: 1.6 }}>
                Permanently delete your account and all saved chat history. This cannot be undone.
              </p>

              {deletePhase === "idle" && (
                <button onClick={() => setDeletePhase("confirm")}
                  style={{ background: "transparent", border: "1px solid #EF4444", borderRadius: 7, padding: "8px 16px", fontSize: 12, fontWeight: 600, color: "#EF4444", cursor: "pointer", transition: "all .15s" }}>
                  Delete my account
                </button>
              )}

              {deletePhase === "confirm" && (
                <div style={{ display: "flex", gap: 8 }}>
                  <button onClick={() => setDeletePhase("typing")}
                    style={{ background: "#EF4444", border: "none", borderRadius: 7, padding: "8px 16px", fontSize: 12, fontWeight: 700, color: "#fff", cursor: "pointer" }}>
                    Yes, continue
                  </button>
                  <button onClick={() => setDeletePhase("idle")}
                    style={{ background: "transparent", border: "1px solid #2d3348", borderRadius: 7, padding: "8px 16px", fontSize: 12, color: "#64748b", cursor: "pointer" }}>
                    Cancel
                  </button>
                </div>
              )}

              {deletePhase === "typing" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <p style={{ margin: 0, fontSize: 12, color: "#EF4444" }}>Enter your password to confirm deletion:</p>
                  <input type="password" value={deletePwd} onChange={e => setDeletePwd(e.target.value)}
                    placeholder="Your password"
                    onKeyDown={e => e.key === "Enter" && handleDeleteAccount()}
                    style={{ ...inp, borderColor: "#EF444466" }}
                    onFocus={e => { (e.target as HTMLInputElement).style.borderColor = "#EF4444"; }}
                    onBlur={e  => { (e.target as HTMLInputElement).style.borderColor = "#EF444466"; }} />
                  {deleteError && <p style={{ margin: 0, fontSize: 12, color: "#EF4444" }}>{deleteError}</p>}
                  <div style={{ display: "flex", gap: 8 }}>
                    <button onClick={handleDeleteAccount} disabled={deleteLoading || !deletePwd}
                      style={{ background: deleteLoading ? "#1e2130" : "#EF4444", border: "none", borderRadius: 7, padding: "9px 16px", fontSize: 12, fontWeight: 700, color: deleteLoading ? "#334155" : "#fff", cursor: deleteLoading || !deletePwd ? "not-allowed" : "pointer" }}>
                      {deleteLoading ? "Deleting…" : "Delete account"}
                    </button>
                    <button onClick={() => { setDeletePhase("idle"); setDeletePwd(""); setDeleteError(null); }}
                      style={{ background: "transparent", border: "1px solid #2d3348", borderRadius: 7, padding: "9px 16px", fontSize: 12, color: "#64748b", cursor: "pointer" }}>
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          </Section>

        </div>
      </div>
    </>
  );
}
