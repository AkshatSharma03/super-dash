// ─────────────────────────────────────────────────────────────────────────────
// CLIENT-SIDE ANALYTICS  —  thin wrapper around posthog-js.
//
// All calls are no-ops when VITE_POSTHOG_KEY is not set (dev / CI).
// Import { track, identifyUser, resetUser } from here — never call posthog directly.
// ─────────────────────────────────────────────────────────────────────────────
import posthog from "posthog-js";

const KEY  = import.meta.env.VITE_POSTHOG_KEY as string | undefined;
const HOST = "https://us.i.posthog.com";

export function initAnalytics() {
  if (!KEY) return;
  posthog.init(KEY, {
    api_host:              HOST,
    capture_pageview:      false, // we fire mode_viewed manually
    capture_pageleave:     true,
    autocapture:           false, // keep event volume low
    session_recording:     { maskAllInputs: true },
    persistence:           "localStorage",
  });
}

/** Call after login / register so events are tied to the real user. */
export function identifyUser(id: string, email: string, name: string) {
  if (!KEY) return;
  posthog.identify(id, { email, name });
}

/** Call on logout / account delete to disassociate the browser. */
export function resetUser() {
  if (!KEY) return;
  posthog.reset();
}

/** Generic typed event tracker. */
export function track(event: string, properties?: Record<string, unknown>) {
  if (!KEY) return;
  posthog.capture(event, properties);
}
