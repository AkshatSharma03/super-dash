import { Router } from 'express';

const DEFAULT_DYNAMIC_SUGGESTIONS = [
  'US GDP growth forecast 2026',
  'China exports and trade surplus latest data',
  'Euro area inflation and ECB policy outlook',
  'Federal Reserve interest rate path and labor market',
  'India manufacturing growth and investment trends',
  'Global supply chain shifts and nearshoring update',
  'Oil prices, shipping costs, and inflation pass-through',
  'G7 growth divergence and recession risk indicators',
];

const SUGGESTION_TOPIC_SEEDS = [
  'Federal Reserve interest rates',
  'US inflation',
  'China trade',
  'Eurozone growth',
  'India manufacturing',
  'oil market',
  'global supply chain',
  'emerging markets debt',
];

let suggestionsCache = { expiresAt: 0, items: DEFAULT_DYNAMIC_SUGGESTIONS };

function headlineToSuggestion(title = '') {
  const clean = String(title)
    .replace(/\s+/g, ' ')
    .replace(/\s*[-|:]\s*Reuters.*$/i, '')
    .replace(/\s*[-|:]\s*Bloomberg.*$/i, '')
    .trim();
  if (!clean) return null;
  const noTrailing = clean.replace(/[.?!,:;]+$/g, '');
  if (noTrailing.length < 24) return null;
  const prompt = noTrailing.length > 92 ? `${noTrailing.slice(0, 92).trim()}…` : noTrailing;
  return prompt;
}

function buildKagiSearchPrompt(query, searchNewsSources = [], searchContext = []) {
  const contextTurns = Array.isArray(searchContext)
    ? searchContext
        .filter(turn => turn && typeof turn.query === 'string' && turn.query.trim())
        .slice(-6)
    : [];

  const followUpContext = contextTurns.length > 0
    ? `\n\nConversation context (most recent last):\n${contextTurns
        .map((turn, i) => {
          const q = turn.query.trim();
          const s = typeof turn.summary === 'string' ? turn.summary.trim() : '';
          return s
            ? `${i + 1}. Query: ${q}\n   Prior answer summary: ${s}`
            : `${i + 1}. Query: ${q}`;
        })
        .join('\n')}`
    : '';

  const newsContext = searchNewsSources.length > 0
    ? `\n\nRecent context (verify before use):\n${searchNewsSources
        .slice(0, 6)
        .map((s, i) => `${i + 1}. ${s.title}`)
        .join('\n')}`
    : '';

  return [
    `Research question: ${query}`,
    '',
    'Return comprehensive markdown brief with these sections:',
    '1) Bottom line (2-3 bullets)',
    '2) What happened (timeline + current state)',
    '3) Market impact (oil, shipping, inflation, growth) with numbers/ranges where available',
    '4) Scenario analysis (base/upside/downside with probabilities if possible)',
    '5) 30/90-day watchlist (specific indicators/events to monitor)',
    '6) Risks and unknowns (what could invalidate this view)',
    '',
    'Rules: concise but deep, avoid fluff, include concrete figures and assumptions, clearly mark uncertainty.',
    'If conversation context is provided, treat the research question as a follow-up and preserve continuity with prior turns.',
    followUpContext,
    newsContext,
  ].join('\n');
}

async function callKagi(KAGI_BASE, KAGI_API_KEY, path, { method = 'GET', body = null, timeoutMs = 30000 } = {}) {
  if (!KAGI_API_KEY) throw new Error('KAGI_API_KEY not configured');
  const apiKey = KAGI_API_KEY.trim();

  const url = `${KAGI_BASE}${path}`;
  console.log(`[Kagi] Request: ${method} ${url}`);
  console.log(`[Kagi] API Key present: ${apiKey ? 'Yes (length: ' + apiKey.length + ')' : 'No'}`);

  async function fetchWithAuth(authHeader) {
    try {
      return await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          Authorization: authHeader,
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (fetchError) {
      console.error('[Kagi] Fetch error:', fetchError.message);
      throw new Error(`Kagi network error: ${fetchError.message}`);
    }
  }
  let res = await fetchWithAuth(`Bot ${apiKey}`);
  if (res.status === 401) {
    console.log('[Kagi] Retrying with Bearer auth scheme after 401 on Bot scheme');
    res = await fetchWithAuth(`Bearer ${apiKey}`);
  }

  console.log(`[Kagi] Response status: ${res.status} ${res.statusText}`);

  let payload = null;
  const responseText = await res.text();
  console.log(`[Kagi] Raw response:`, responseText.slice(0, 500));

  try {
    payload = JSON.parse(responseText);
  } catch {
    payload = null;
  }

  if (!res.ok) {
    const detail = payload?.error?.[0]?.msg || payload?.message || `${res.status} ${res.statusText}`;
    console.error('[Kagi] Error response:', detail);
    throw new Error(`Kagi ${res.status}: ${detail}`);
  }

  if (Array.isArray(payload?.error) && payload.error.length > 0) {
    const errorMsg = payload.error.map(e => e.msg).join('; ');
    console.error('[Kagi] API error:', errorMsg);
    throw new Error(`Kagi error: ${errorMsg}`);
  }

  console.log(`[Kagi] Success: output length = ${payload?.data?.output?.length || 0}`);
  return payload;
}

export function createSearchRouter(deps) {
  const {
    apiLimiter,
    validate,
    SearchSchema,
    cacheKey,
    apiCache,
    fetchVerifiedNews,
    track,
    TTL_SEARCH_MS,
    IS_DEV,
    KAGI_API_KEY,
    KAGI_BASE,
  } = deps;

  const router = Router();

  router.get('/suggestions', apiLimiter, async (_req, res) => {
    const now = Date.now();
    if (suggestionsCache.expiresAt > now && suggestionsCache.items.length > 0) {
      return res.json({ suggestions: suggestionsCache.items, source: 'cache' });
    }

    const collected = [];
    for (const seed of SUGGESTION_TOPIC_SEEDS) {
      try {
        const news = await fetchVerifiedNews(seed.slice(0, 200));
        for (const item of news.slice(0, 2)) {
          const suggestion = headlineToSuggestion(item?.title);
          if (!suggestion) continue;
          if (!collected.some((s) => s.toLowerCase() === suggestion.toLowerCase())) {
            collected.push(suggestion);
          }
          if (collected.length >= 8) break;
        }
      } catch {
        // Keep trying remaining seeds.
      }
      if (collected.length >= 8) break;
    }

    const next = collected.length > 0 ? collected : DEFAULT_DYNAMIC_SUGGESTIONS;
    suggestionsCache = { items: next, expiresAt: now + (15 * 60 * 1000) };
    return res.json({ suggestions: next, source: collected.length > 0 ? 'live' : 'fallback' });
  });

  router.post('/', apiLimiter, async (req, res) => {
    const body = validate(SearchSchema, req.body, res);
    if (!body) return;
    const { query, context = [] } = body;

    const ck = await cacheKey('/search', { query, context });
    const cached = apiCache.get(ck);
    if (cached) { if (IS_DEV) console.log('[cache hit] /api/search:', query.slice(0, 40)); return res.json(cached); }

    let text = '', sources = [], webSearchUsed = false;

    // Pre-fetch news to seed context before web search
    let searchNewsSources = [];
    try {
      const recentNews = await fetchVerifiedNews(query.slice(0, 200));
      if (recentNews.length > 0) {
        searchNewsSources = recentNews.map(a => ({ title: `${a.source}: ${a.title}`, url: a.url }));
      }
    } catch (e) {
      console.error('News pre-fetch error in /api/search:', e.message);
    }

    if (!KAGI_API_KEY) {
      return res.status(503).json({
        error: 'Search is configured for Kagi only. Set KAGI_API_KEY on the server.',
      });
    }

    try {
      const kagiPrompt = buildKagiSearchPrompt(query, searchNewsSources, context);
      const kagi = await callKagi(KAGI_BASE, KAGI_API_KEY, '/fastgpt', {
        method: 'POST',
        body: { query: kagiPrompt, cache: true },
      });

      text = kagi?.data?.output?.trim?.() || '';
      const refs = Array.isArray(kagi?.data?.references) ? kagi.data.references : [];
      for (const ref of refs) {
        if (!ref?.url) continue;
        if (!sources.find(s => s.url === ref.url)) {
          sources.push({ title: ref.title || ref.url, url: ref.url });
        }
      }

      if (text) {
        webSearchUsed = true;
      } else {
        return res.status(502).json({
          error: 'Kagi search returned no output.',
          detail: 'The search completed but returned empty results.',
        });
      }
    } catch (e) {
      console.error('/api/search Kagi error:', e.message);
      return res.status(502).json({
        error: 'Kagi search failed.',
        detail: e.message,
      });
    }

    // Merge news sources that weren't already found by web search
    const existingSearchUrls = new Set(sources.map(s => s.url).filter(Boolean));
    for (const ns of searchNewsSources) {
      if (ns.url && !existingSearchUrls.has(ns.url)) {
        sources.push(ns);
        existingSearchUrls.add(ns.url);
      }
    }

    const result = { text, sources, webSearchUsed };
    apiCache.put(ck, result, TTL_SEARCH_MS);
    track(req.user?.id || 'guest', 'search_queried', {
      query_length: query.length,
      web_search_used: webSearchUsed,
      source_count: sources.length,
    });
    res.json(result);
  });

  return router;
}
