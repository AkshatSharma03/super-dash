import React from 'react'
import ReactDOM from 'react-dom/client'
import { ClerkProvider } from '@clerk/clerk-react'
import { Toaster } from 'sonner'
import App from './App'
import './index.css'
import { initAnalytics } from './analytics'

initAnalytics();

const clerkPublishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

const Root = clerkPublishableKey ? (
  <ClerkProvider publishableKey={clerkPublishableKey}>
    <App />
    <Toaster position="bottom-center" theme="dark" richColors />
  </ClerkProvider>
) : (
  <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: '#FAF9F6', padding: '24px' }}>
    <div style={{ maxWidth: '560px', width: '100%', border: '4px solid #1A1A2E', background: '#FFFFFF', padding: '20px', boxShadow: '8px 8px 0 #1A1A2E', fontFamily: 'Inter, sans-serif' }}>
      <h1 style={{ margin: 0, fontSize: '20px', fontWeight: 900, color: '#1A1A2E' }}>Configuration required</h1>
      <p style={{ marginTop: '10px', marginBottom: 0, fontSize: '14px', color: '#1A1A2E' }}>
        Missing <code>VITE_CLERK_PUBLISHABLE_KEY</code>. Add it in Railway Variables and redeploy.
      </p>
    </div>
  </div>
);

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    {Root}
  </React.StrictMode>,
)
