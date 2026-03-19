// ─────────────────────────────────────────────────────────────────────────────
// SETTINGS PANEL  —  slide-in Sheet from the right.
// Sections: profile summary + usage stats · change password · delete account.
// ─────────────────────────────────────────────────────────────────────────────
import { useState, useEffect } from "react";
import { getUsage, changePassword, deleteAccount } from "../../utils/api";
import type { User } from "../../types";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button }  from "@/components/ui/button";
import { Input }   from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertTriangle, CheckCircle2 } from "lucide-react";

interface Props {
  user:     User;
  token:    string;
  onClose:  () => void;
  onLogout: () => void;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-6">
      <div className="flex items-center gap-2 mb-3.5">
        <div className="flex-1 h-px bg-muted" />
        <h3 className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest whitespace-nowrap">{title}</h3>
        <div className="flex-1 h-px bg-muted" />
      </div>
      {children}
    </div>
  );
}

export default function SettingsPanel({ user, token, onClose, onLogout }: Props) {
  const [usage,         setUsage]        = useState<{ sessionCount: number; messageCount: number; memberSince: string } | null>(null);
  const [usageError,    setUsageError]   = useState(false);
  const [curPwd,        setCurPwd]       = useState("");
  const [newPwd,        setNewPwd]       = useState("");
  const [confirmPwd,    setConfirmPwd]   = useState("");
  const [pwdLoading,    setPwdLoading]   = useState(false);
  const [pwdError,      setPwdError]     = useState<string | null>(null);
  const [pwdSuccess,    setPwdSuccess]   = useState(false);
  const [deletePhase,   setDeletePhase]  = useState<"idle" | "confirm" | "typing">("idle");
  const [deletePwd,     setDeletePwd]    = useState("");
  const [deleteLoading, setDeleteLoading]= useState(false);
  const [deleteError,   setDeleteError]  = useState<string | null>(null);

  useEffect(() => {
    getUsage(token).then(setUsage).catch(() => setUsageError(true));
  }, [token]);

  const parseError = (e: unknown) => {
    const msg = e instanceof Error ? e.message : String(e);
    try { return JSON.parse(msg).error ?? msg; } catch { return msg; }
  };

  const handleChangePassword = async () => {
    setPwdError(null); setPwdSuccess(false);
    if (!curPwd || !newPwd || !confirmPwd) { setPwdError("All fields are required."); return; }
    if (newPwd !== confirmPwd) { setPwdError("New passwords do not match."); return; }
    if (newPwd.length < 8) { setPwdError("New password must be at least 8 characters."); return; }
    setPwdLoading(true);
    try {
      await changePassword(token, curPwd, newPwd);
      setPwdSuccess(true);
      setCurPwd(""); setNewPwd(""); setConfirmPwd("");
    } catch (e) {
      setPwdError(parseError(e));
    } finally { setPwdLoading(false); }
  };

  const handleDeleteAccount = async () => {
    setDeleteError(null); setDeleteLoading(true);
    try { await deleteAccount(token, deletePwd); onLogout(); }
    catch (e) { setDeleteError(parseError(e)); }
    finally { setDeleteLoading(false); }
  };

  const memberSince = usage
    ? new Date(usage.memberSince).toLocaleDateString("en-US", { month: "long", year: "numeric" })
    : null;

  return (
    <Sheet open onOpenChange={open => { if (!open) onClose(); }}>
      <SheetContent side="right" className="w-[360px] bg-popover border-l border-border p-0 flex flex-col overflow-y-auto">

        {/* Header */}
        <SheetHeader className="px-5 py-3.5 border-b border-border bg-[#080b10] flex-row items-center gap-2.5 space-y-0">
          <div style={{ width: 28, height: 28, borderRadius: 8, background: "linear-gradient(135deg,#00AAFF,#8B5CF6)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13 }}>⚙</div>
          <SheetTitle className="text-sm font-bold flex-1">Account Settings</SheetTitle>
        </SheetHeader>

        <div className="p-5 flex-1">

          {/* Profile + Usage */}
          <Section title="Profile">
            <div style={{ background: "#161929", border: "1px solid #2d3348", borderRadius: 10, padding: 16, marginBottom: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: memberSince ? 10 : 0 }}>
                <div style={{ width: 40, height: 40, borderRadius: "50%", background: "linear-gradient(135deg,#00AAFF,#8B5CF6)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 17, fontWeight: 700, color: "#fff", flexShrink: 0, boxShadow: "0 0 14px #00AAFF33" }}>
                  {user.name.charAt(0).toUpperCase()}
                </div>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "#e2e8f0" }}>{user.name}</div>
                  <div style={{ fontSize: 12, color: "#475569" }}>{user.email}</div>
                </div>
              </div>
              {memberSince && (
                <div style={{ fontSize: 11, color: "#3d4460", paddingTop: 10, borderTop: "1px solid #1e2130" }}>Member since {memberSince}</div>
              )}
            </div>
            {usageError ? (
              <p className="text-xs text-muted-foreground">Could not load usage stats.</p>
            ) : !usage ? (
              <p className="text-xs text-muted-foreground/50">Loading…</p>
            ) : (
              <div className="grid grid-cols-2 gap-2.5">
                {[["💬", "Conversations", usage.sessionCount.toString()], ["✉️", "Messages sent", usage.messageCount.toString()]].map(([icon, label, value]) => (
                  <div key={label} style={{ background: "#1e2130", border: "1px solid #2d3348", borderRadius: 8, padding: "12px 14px" }}>
                    <div style={{ fontSize: 18, marginBottom: 4 }}>{icon}</div>
                    <div style={{ fontSize: 20, fontWeight: 800, color: "#e2e8f0" }}>{value}</div>
                    <div style={{ fontSize: 11, color: "#64748b" }}>{label}</div>
                  </div>
                ))}
              </div>
            )}
          </Section>

          {/* Change password */}
          <Section title="Change Password">
            <div className="flex flex-col gap-2">
              <Input type="password" value={curPwd} onChange={e => setCurPwd(e.target.value)} placeholder="Current password" />
              <Input type="password" value={newPwd} onChange={e => setNewPwd(e.target.value)} placeholder="New password (min. 8 characters)" />
              <Input type="password" value={confirmPwd} onChange={e => setConfirmPwd(e.target.value)}
                placeholder="Confirm new password" onKeyDown={e => e.key === "Enter" && handleChangePassword()} />
              {pwdError && (
                <Alert variant="destructive" className="py-2">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertDescription className="text-xs">{pwdError}</AlertDescription>
                </Alert>
              )}
              {pwdSuccess && (
                <Alert variant="success" className="py-2">
                  <CheckCircle2 className="h-4 w-4" />
                  <AlertDescription className="text-xs">Password updated successfully.</AlertDescription>
                </Alert>
              )}
              <Button onClick={handleChangePassword} disabled={pwdLoading}
                className="bg-accent hover:bg-accent/90 text-white font-bold">
                {pwdLoading ? "Updating…" : "Update password"}
              </Button>
            </div>
          </Section>

          {/* Danger zone */}
          <Section title="Danger Zone">
            <div style={{ border: "1px solid #EF444433", borderRadius: 10, padding: 16, background: "#EF444408" }}>
              <p className="text-sm text-muted-foreground mb-3 leading-relaxed">
                Permanently delete your account and all saved chat history. This cannot be undone.
              </p>
              {deletePhase === "idle" && (
                <Button variant="outline" size="sm" onClick={() => setDeletePhase("confirm")}
                  className="border-destructive text-destructive hover:bg-destructive hover:text-white">
                  Delete my account
                </Button>
              )}
              {deletePhase === "confirm" && (
                <div className="flex gap-2">
                  <Button size="sm" variant="destructive" onClick={() => setDeletePhase("typing")}>Yes, continue</Button>
                  <Button size="sm" variant="outline" onClick={() => setDeletePhase("idle")}>Cancel</Button>
                </div>
              )}
              {deletePhase === "typing" && (
                <div className="flex flex-col gap-2">
                  <p className="text-xs text-destructive">Enter your password to confirm deletion:</p>
                  <Input type="password" value={deletePwd} onChange={e => setDeletePwd(e.target.value)}
                    placeholder="Your password" className="border-destructive/50 focus-visible:ring-destructive"
                    onKeyDown={e => e.key === "Enter" && handleDeleteAccount()} />
                  {deleteError && (
                    <Alert variant="destructive" className="py-2">
                      <AlertTriangle className="h-4 w-4" />
                      <AlertDescription className="text-xs">{deleteError}</AlertDescription>
                    </Alert>
                  )}
                  <div className="flex gap-2">
                    <Button size="sm" variant="destructive" disabled={deleteLoading || !deletePwd} onClick={handleDeleteAccount}>
                      {deleteLoading ? "Deleting…" : "Delete account"}
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => { setDeletePhase("idle"); setDeletePwd(""); setDeleteError(null); }}>
                      Cancel
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </Section>

        </div>
      </SheetContent>
    </Sheet>
  );
}
