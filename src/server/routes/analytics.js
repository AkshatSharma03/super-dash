import { Router } from 'express';

const ANALYTICS_SYSTEM_PROMPT = `You are an expert econometrician and data scientist specializing in country-level economic analysis.
The user has selected a country and run several algorithms on its data. They may provide that data as context along with recent verified news articles.
IMPORTANT: When "Recent Verified News" articles are included in the context, treat them as your PRIMARY source for current events and projections. Never refuse based on a knowledge cutoff — use the news to inform your analysis.
Respond ONLY with a valid JSON object matching this exact shape (no markdown wrapper):
{
  "insight": "3-4 sentence expert analysis directly answering the user's question with specific figures",
  "charts": [
    {
      "id": "unique_id",
      "title": "Chart title",
      "type": "line|bar|area|pie|composed",
      "description": "One sentence",
      "data": [...],
      "xKey": "year",
      "series": [{"key":"fieldname","name":"Display Name","color":"#hex","chartType":"bar|line","stacked":false}]
    }
  ],
  "sources": [{"title":"Source name","url":"https://..."}],
  "followUps": ["Follow-up 1","Follow-up 2","Follow-up 3"]
}
Rules:
- 1-2 targeted charts that directly address the user's question using the provided data
- Use real values from the country data context wherever possible
- Colors: #00AAFF #F59E0B #10B981 #EF4444 #8B5CF6 #F97316
- sources: always include deep links — use these patterns:
  * World Bank indicator: https://data.worldbank.org/indicator/<INDICATOR_CODE>?locations=<ISO2>
    Codes: NY.GDP.MKTP.CD (GDP), NY.GDP.MKTP.KD.ZG (GDP growth), NY.GDP.PCAP.CD (GDP per capita), NE.EXP.GNFS.CD (exports), NE.IMP.GNFS.CD (imports)
  * IMF country report: https://www.imf.org/en/Publications/CR?country=<ISO3>
  * IMF World Economic Outlook: https://www.imf.org/en/Publications/WEO
  * UN Comtrade: https://comtradeplus.un.org/TradeFlow?Frequency=A&Flows=X&CommodityCodes=TOTAL&Partners=0&Reporters=<ISO3_NUMERIC>&period=<YEAR>&AggregateBy=none&BreakdownMode=plus
  * OECD: https://data.oecd.org/<ISO3>.htm
- Cite news articles provided in context by including their URLs in sources`;

export function createAnalyticsRouter(deps) {
  const {
    requireAuth,
    apiLimiter,
    validate,
    AnalyticsSchema,
    cacheKey,
    apiCache,
    fetchVerifiedNews,
    callAnthropic,
    MODEL,
    validateAIResponse,
    chatCacheTtlMs,
    track,
    errorMessage,
    IS_DEV,
  } = deps;

  const router = Router();

  router.post('/', requireAuth, apiLimiter, async (req, res) => {
    const body = validate(AnalyticsSchema, req.body, res);
    if (!body) return;
    const { query, context = '' } = body;

    const ck = await cacheKey('/analytics', { query, context: context.slice(0, 500) });
    const cached = apiCache.get(ck);
    if (cached) {
      if (IS_DEV) console.log('[cache hit] /api/analytics');
      return res.json(cached);
    }

    // Fetch news BEFORE calling AI so it can be used as context
    let analyticsNewsSources = [];
    try {
      const searchTerms = `${query} economy`;
      const recentNews = await fetchVerifiedNews(searchTerms);
      if (recentNews.length > 0) {
        const newsContext = `\n\nRecent Verified News (cite relevant articles in your sources array using their URLs):\n${JSON.stringify(recentNews)}`;
        const userMessage = context
          ? `Country economic data:\n${context}${newsContext}\n\nUser question: ${query}`
          : `${query}${newsContext}`;
        analyticsNewsSources = recentNews.map(a => ({ title: `${a.source}: ${a.title}`, url: a.url }));

        const data = await callAnthropic({
          model: MODEL,
          max_tokens: 3000,
          system: ANALYTICS_SYSTEM_PROMPT,
          messages: [{ role: 'user', content: userMessage }],
        });
        const text = data.content?.map((b) => b.text || '').join('') || '{}';
        let parsed;
        try {
          const raw = JSON.parse(text.replace(/```json|```/g, '').trim());
          parsed = validateAIResponse(raw) ?? { insight: text, charts: [], sources: [], followUps: [] };
        } catch {
          parsed = { insight: text, charts: [], sources: [], followUps: [] };
        }
        // Merge fetched news URLs that AI didn't already include
        const existingUrls = new Set((parsed.sources || []).map(s => s.url).filter(Boolean));
        for (const ns of analyticsNewsSources) {
          if (ns.url && !existingUrls.has(ns.url)) {
            parsed.sources = [...(parsed.sources || []), ns];
            existingUrls.add(ns.url);
          }
        }
        apiCache.put(ck, parsed, chatCacheTtlMs());
        return res.json(parsed);
      }
    } catch (e) {
      console.error('News fetch or AI error in /api/analytics:', errorMessage(e));
    }

    // Fallback: call AI without news context
    const userMessage = context
      ? `Country economic data:\n${context}\n\nUser question: ${query}`
      : query;

    try {
      const data = await callAnthropic({
        model: MODEL,
        max_tokens: 3000,
        temperature: 0,
        system: ANALYTICS_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userMessage }],
      });
      const text = data.content?.map((b) => b.text || '').join('') || '{}';
      let parsed;
      try {
        const raw = JSON.parse(text.replace(/```json|```/g, '').trim());
        parsed = validateAIResponse(raw) ?? {
          insight: text,
          charts: [],
          sources: [],
          followUps: [],
        };
      } catch {
        parsed = { insight: text, charts: [], sources: [], followUps: [] };
      }
      apiCache.put(ck, parsed, chatCacheTtlMs());
      track(req.user?.id || 'guest', 'analytics_queried', {
        query_length: query.length,
        has_context: context.length > 0,
        charts_returned: parsed.charts?.length ?? 0,
      });
      res.json(parsed);
    } catch (e) {
      const message = errorMessage(e, 'Failed to generate analytics response');
      console.error('/api/analytics error:', message);
      res.status(502).json({ error: message });
    }
  });

  return router;
}
