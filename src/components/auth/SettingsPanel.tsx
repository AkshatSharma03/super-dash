// ─────────────────────────────────────────────────────────────────────────────
// SETTINGS PANEL  —  slide-in Sheet from the right.
// Sections: profile summary + usage stats + Clerk-managed account controls.
// ─────────────────────────────────────────────────────────────────────────────
import { useState, useEffect } from "react";
import { UserProfile } from "@clerk/clerk-react";
import { getUsage } from "../../utils/api";
import type { User } from "../../types";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Settings, MessageSquare, Send } from "lucide-react";

interface Props {
  user:     User;
  token:    string;
  onClose:  () => void;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-6">
      <div className="flex items-center gap-2 mb-3.5">
        <div className="flex-1 h-1 bg-memphis-black" />
        <h3 className="text-[10px] font-black text-memphis-black/50 uppercase tracking-widest whitespace-nowrap">{title}</h3>
        <div className="flex-1 h-1 bg-memphis-black" />
      </div>
      {children}
    </div>
  );
}

const clerkAppearance = {
  variables: {
    colorPrimary: "#FF006E",
    colorText: "#1A1A2E",
    colorBackground: "#FAFAFA",
    colorInputBackground: "#FFFFFF",
    colorInputText: "#1A1A2E",
    colorDanger: "#FB5607",
  },
  elements: {
    rootBox: "w-full",
    card: "shadow-none border-0 rounded-none bg-transparent",
    navbar: "hidden",
    pageScrollBox: "p-0",
    profileSectionPrimaryButton:
      "rounded-none border-3 border-memphis-black bg-memphis-pink text-white font-black uppercase tracking-wide shadow-hard hover:bg-memphis-pink",
    profileSectionSecondaryButton:
      "rounded-none border-3 border-memphis-black bg-white text-memphis-black font-black uppercase tracking-wide shadow-hard",
    formButtonPrimary:
      "rounded-none border-3 border-memphis-black bg-memphis-pink text-white font-black uppercase tracking-wide shadow-hard hover:bg-memphis-pink",
    formFieldInput:
      "h-11 border-3 border-memphis-black/20 rounded-none text-memphis-black placeholder:text-memphis-black/40 focus:border-memphis-pink focus:ring-0",
    formFieldLabel: "text-[11px] uppercase tracking-wide font-black text-memphis-black",
    accordionTriggerButton:
      "rounded-none border-3 border-memphis-black bg-white text-memphis-black font-black uppercase tracking-wide",
    dangerSection: "border-3 border-destructive/50 bg-destructive/5",
    badge: "rounded-none border-2 border-memphis-black",
    breadcrumbs: "hidden",
    profileSection: "border-3 border-memphis-black bg-white p-4 shadow-hard-sm",
  },
} as const;

export default function SettingsPanel({ user, token, onClose }: Props) {
  const [usage,         setUsage]        = useState<{ sessionCount: number; messageCount: number; memberSince: string } | null>(null);
  const [usageError,    setUsageError]   = useState(false);

  useEffect(() => {
    getUsage(token).then(setUsage).catch(() => setUsageError(true));
  }, [token]);

  const memberSince = usage
    ? new Date(usage.memberSince).toLocaleDateString("en-US", { month: "long", year: "numeric" })
    : null;

  return (
    <Sheet open onOpenChange={open => { if (!open) onClose(); }}>
      <SheetContent side="right" className="w-[96vw] sm:w-[460px] bg-memphis-offwhite border-l-4 border-memphis-black p-0 flex flex-col overflow-y-auto shadow-hard-xl [&>button]:rounded-none [&>button]:border-3 [&>button]:border-memphis-black [&>button]:bg-white [&>button]:p-1 [&>button]:opacity-100 [&>button>svg]:text-memphis-black">

        {/* Header */}
        <SheetHeader className="px-5 py-3.5 border-b-4 border-memphis-black bg-memphis-offwhite flex-row items-center gap-2.5 space-y-0">
          <div className="w-8 h-8 flex items-center justify-center text-[13px] font-black text-white border-3 border-memphis-black shadow-hard-sm" style={{ background: "#FF006E" }}><Settings className="w-4 h-4" /></div>
          <SheetTitle className="text-sm font-black flex-1 uppercase tracking-wide">Account Settings</SheetTitle>
        </SheetHeader>

        <div className="p-5 flex-1">

          {/* Profile + Usage */}
          <Section title="Profile">
            <div className="bg-white border-3 border-memphis-black p-4 mb-3 shadow-hard relative">
              <div className="absolute -top-2 -right-2 w-4 h-4 bg-memphis-cyan border-2 border-memphis-black" />
              <div className={`flex items-center gap-3 ${memberSince ? "mb-2.5" : ""}`}>
                <div className="w-10 h-10 flex items-center justify-center text-[17px] font-black text-white shrink-0 border-3 border-memphis-black shadow-hard-sm"
                  style={{ background: "#FF006E" }}>
                  {user.name.charAt(0).toUpperCase()}
                </div>
                <div>
                  <div className="text-[13px] font-bold text-memphis-black">{user.name}</div>
                  <div className="text-xs text-memphis-black/60">{user.email}</div>
                </div>
              </div>
              {memberSince && (
                <div className="text-[11px] text-memphis-black/60 pt-2.5 border-t-2 border-memphis-black/15">Member since {memberSince}</div>
              )}
            </div>
            {usageError ? (
              <p className="text-xs text-memphis-black/60">Could not load usage stats.</p>
            ) : !usage ? (
              <p className="text-xs text-memphis-black/50">Loading…</p>
            ) : (
              <div className="grid grid-cols-2 gap-2.5">
                {[
                  { Icon: MessageSquare, label: "Conversations", value: usage.sessionCount.toString() },
                  { Icon: Send, label: "Messages sent", value: usage.messageCount.toString() },
                ].map(({ Icon, label, value }) => (
                  <div key={label} className="bg-memphis-offwhite border-3 border-memphis-black px-3.5 py-3 shadow-hard-sm">
                    <div className="mb-1"><Icon className="w-4 h-4 text-memphis-black/70" /></div>
                    <div className="text-xl font-extrabold text-memphis-black">{value}</div>
                    <div className="text-[11px] text-memphis-black/60">{label}</div>
                  </div>
                ))}
              </div>
            )}
          </Section>

          <Section title="Account Security">
            <div className="border-3 border-memphis-black bg-white p-3.5 shadow-hard-sm">
              <UserProfile
                routing="hash"
                appearance={clerkAppearance}
              />
            </div>
          </Section>

        </div>
      </SheetContent>
    </Sheet>
  );
}
