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

const ConfigNotice = ({ message }: { message: string }) => (
  <div
    style={{
      minHeight: "100vh",
      display: "grid",
      placeItems: "center",
      background: "#FAF9F6",
      padding: "24px",
    }}
  >
    <div
      style={{
        maxWidth: "560px",
        width: "100%",
        border: "4px solid #1A1A2E",
        background: "#FFFFFF",
        padding: "20px",
        boxShadow: "8px 8px 0 #1A1A2E",
        fontFamily: "Inter, sans-serif",
      }}
    >
      <h1
        style={{
          margin: 0,
          fontSize: "20px",
          fontWeight: 900,
          color: "#1A1A2E",
        }}
      >
        Configuration required
      </h1>
      <p
        style={{
          marginTop: "10px",
          marginBottom: 0,
          fontSize: "14px",
          color: "#1A1A2E",
        }}
      >
        {message}
      </p>
      <ol
        style={{
          marginTop: "14px",
          paddingLeft: "20px",
          fontSize: "13px",
          lineHeight: 1.7,
          color: "#1A1A2E",
        }}
      >
        <li>Open the Clerk dashboard and copy the publishable key.</li>
        <li>
          Set <code>VITE_CLERK_PUBLISHABLE_KEY=pk_test_...</code> locally or{" "}
          <code>pk_live_...</code> in production.
        </li>
        <li>Re-run the Vite build so the client bundle receives the value.</li>
      </ol>
    </div>
  </div>
);

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
      return <ConfigNotice message={CLERK_INIT_ERROR} />;
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
