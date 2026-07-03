export interface RuntimePublicConfig {
  VITE_CLERK_PUBLISHABLE_KEY?: string;
  VITE_POSTHOG_KEY?: string;
}

declare global {
  interface Window {
    __SUPERDASH_CONFIG__?: RuntimePublicConfig;
  }
}

const viteEnv = import.meta.env as Record<string, string | undefined>;

export function getRuntimeEnv(key: keyof RuntimePublicConfig): string {
  return viteEnv[key] || window.__SUPERDASH_CONFIG__?.[key] || "";
}
