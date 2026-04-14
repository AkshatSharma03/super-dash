import React from 'react'
import ReactDOM from 'react-dom/client'
import { ClerkProvider } from '@clerk/react'
import { Toaster } from 'sonner'
import App from './App'
import './index.css'
import { initAnalytics } from './analytics'

initAnalytics();

const clerkPublishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

const isValidClerkKey = (key?: string) => {
  if (!key) return false;
  const trimmed = key.trim();
  if (!trimmed) return false;
  if (!trimmed.startsWith('pk_')) return false;
  if (/x{4,}/i.test(trimmed)) return false;
  return true;
};

const ConfigNotice = ({ message }: { message: string }) => (
  <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: '#FAF9F6', padding: '24px' }}>
    <div style={{ maxWidth: '560px', width: '100%', border: '4px solid #1A1A2E', background: '#FFFFFF', padding: '20px', boxShadow: '8px 8px 0 #1A1A2E', fontFamily: 'Inter, sans-serif' }}>
      <h1 style={{ margin: 0, fontSize: '20px', fontWeight: 900, color: '#1A1A2E' }}>Configuration required</h1>
      <p style={{ marginTop: '10px', marginBottom: 0, fontSize: '14px', color: '#1A1A2E' }}>{message}</p>
    </div>
  </div>
);

class RootErrorBoundary extends React.Component<React.PropsWithChildren, { hasError: boolean }> {
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
        <ConfigNotice message="Clerk failed to initialize in production. Ensure VITE_CLERK_PUBLISHABLE_KEY is set at build time and redeploy from Railway." />
      );
    }

    return this.props.children;
  }
}

const Root = isValidClerkKey(clerkPublishableKey) ? (
  <RootErrorBoundary>
    <ClerkProvider afterSignOutUrl="/">
      <App />
      <Toaster position="bottom-center" theme="dark" richColors />
    </ClerkProvider>
  </RootErrorBoundary>
) : (
  <ConfigNotice message="Missing or placeholder VITE_CLERK_PUBLISHABLE_KEY. Add your real Clerk publishable key in Railway Variables and redeploy." />
);

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    {Root}
  </React.StrictMode>,
)
