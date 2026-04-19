export function createAIClients({
  ANTHROPIC_BASE,
  ANTHROPIC_API_KEY,
  ANTHROPIC_TIMEOUT_MS,
  KAGI_BASE,
  KAGI_API_KEY,
  KAGI_TIMEOUT_MS,
}) {
  async function callAnthropic(body, extraHeaders = {}) {
    const res = await fetch(ANTHROPIC_BASE, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        ...extraHeaders,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(ANTHROPIC_TIMEOUT_MS),
    });

    if (!res.ok) throw new Error(`Anthropic ${res.status}: ${await res.text()}`);
    return res.json();
  }

  async function callKagi(path, { method = 'GET', body = null, timeoutMs = KAGI_TIMEOUT_MS } = {}) {
    if (!KAGI_API_KEY) throw new Error('KAGI_API_KEY not configured');

    const res = await fetch(`${KAGI_BASE}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bot ${KAGI_API_KEY}`,
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    });

    let payload = null;
    try {
      payload = await res.json();
    } catch {
      payload = null;
    }

    if (!res.ok) {
      const detail = payload?.error?.[0]?.msg || payload?.message || `${res.status} ${res.statusText}`;
      throw new Error(`Kagi ${res.status}: ${detail}`);
    }

    if (Array.isArray(payload?.error) && payload.error.length > 0) {
      throw new Error(`Kagi error: ${payload.error.map((e) => e.msg).join('; ')}`);
    }

    return payload;
  }

  return { callAnthropic, callKagi };
}
