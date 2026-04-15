import { PostHog } from 'posthog-node';

export function createTelemetry() {
  const ph = process.env.POSTHOG_API_KEY
    ? new PostHog(process.env.POSTHOG_API_KEY, { host: 'https://us.i.posthog.com', flushAt: 20, flushInterval: 10_000 })
    : null;

  function track(distinctId, event, properties = {}) {
    if (!ph) return;
    ph.capture({ distinctId: String(distinctId), event, properties });
  }

  if (ph) {
    process.on('SIGTERM', async () => { await ph.shutdown(); process.exit(0); });
    process.on('SIGINT', async () => { await ph.shutdown(); process.exit(0); });
  }

  return { ph, track };
}
