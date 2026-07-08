import React from "react";
import ReactDOM from "react-dom/client";
import { ClerkProvider } from "@clerk/react";
import { Toaster } from "sonner";
import App, { LocalOnlyApp } from "./App";
import "./index.css";
import { initAnalytics } from "./analytics";
import { getRuntimeEnv } from "./config/runtimeEnv";

initAnalytics();

const clerkPublishableKey = getRuntimeEnv("VITE_CLERK_PUBLISHABLE_KEY");
const CLERK_INIT_ERROR =
  "Clerk failed to initialize. Verify that VITE_CLERK_PUBLISHABLE_KEY is " +
  "available at build time and that the value matches the Clerk instance for " +
  "this deployment.";
const CLERK_MISSING_KEY_ERROR =
  "Missing or placeholder VITE_CLERK_PUBLISHABLE_KEY. Add the Clerk " +
  "publishable key to your local .env file and to your hosting provider's " +
  "build-time environment variables, then rebuild the client.";

const isValidClerkKey = (key?: string): key is string => {
  if (!key) return false;
  const trimmed = key.trim();
  if (!trimmed) return false;
  if (!/^pk_(test|live)_/.test(trimmed)) return false;
  if (/x{4,}/i.test(trimmed)) return false;
  return true;
};

class RootErrorBoundary extends React.Component<
  React.PropsWithChildren,
  { hasError: boolean }
> {
  constructor(props: React.PropsWithChildren) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) {
      return (
        <>
          <LocalOnlyApp authNotice={CLERK_INIT_ERROR} />
          <Toaster position="bottom-center" theme="dark" richColors />
        </>
      );
    }

    return this.props.children;
  }
}

const Root = isValidClerkKey(clerkPublishableKey) ? (
  <RootErrorBoundary>
    <ClerkProvider publishableKey={clerkPublishableKey} afterSignOutUrl="/">
      <App />
      <Toaster position="bottom-center" theme="dark" richColors />
    </ClerkProvider>
  </RootErrorBoundary>
) : (
  <>
    <LocalOnlyApp authNotice={CLERK_MISSING_KEY_ERROR} />
    <Toaster position="bottom-center" theme="dark" richColors />
  </>
);

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>{Root}</React.StrictMode>,
);
