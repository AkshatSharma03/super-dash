import { createHash } from 'crypto';

const QUERY_PHRASES = [
  [/gross domestic product/g, 'gdp'],
  [/consumer price index/g, 'inflation'],
  [/foreign direct investment/g, 'fdi'],
  [/current account/g, 'currentaccount'],
  [/trade (?:deficit|surplus|balance)/g, 'tradebalance'],
  [/balance of (?:trade|payments)/g, 'tradebalance'],
  [/purchasing power parity/g, 'ppp'],
  [/(?:government|public|national) debt/g, 'debt'],
  [/debt.to.gdp/g, 'debt gdp'],
  [/debt (?:percentage|percent|pct|ratio|share)/g, 'debt gdp'],
  [/interest rate/g, 'interestrate'],
  [/exchange rate/g, 'exchangerate'],
  [/labour|labor market/g, 'unemployment'],
  [/market capitalisation|market cap/g, 'marketcap'],
  [/united states(?: of america)?/g, 'us'],
  [/united kingdom/g, 'uk'],
  [/european unions?/g, 'eu'],
  [/great britain/g, 'uk'],
  [/euro ?zone|euro ?area/g, 'eu'],
  [/south korea/g, 'southkorea'],
  [/north korea/g, 'northkorea'],
  [/saudi arabia/g, 'saudiarabia'],
  [/south africa/g, 'southafrica'],
  [/new zealand/g, 'newzealand'],
  [/czech republic/g, 'czechia'],
  [/last two decades?|past two decades?/g, '20year'],
  [/last decade|past decade/g, '10year'],
  [/last (\d+) years?/g, (_, n) => `${n}year`],
  [/past (\d+) years?/g, (_, n) => `${n}year`],
  [/over (?:the )?(?:last|past) (\d+) years?/g, (_, n) => `${n}year`],
];

const QUERY_STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'in', 'of', 'to', 'for', 'on', 'at', 'by', 'as',
  'with', 'from', 'after', 'since', 'until', 'before', 'between', 'about', 'into',
  'through', 'during', 'per',
  'balance', 'surplus', 'deficit',
  'how', 'what', 'when', 'where', 'which', 'who', 'why', 'whose',
  'has', 'have', 'had', 'is', 'are', 'was', 'were', 'been', 'be', 'will', 'would',
  'could', 'should', 'do', 'does', 'did', 'can', 'may', 'might', 'shall', 'need',
  'tell', 'me', 'show', 'give', 'please', 'explain', 'describe', 'analyze', 'analyse',
  'compare', 'look', 'get', 'find', 'check', 'let', 'know', 'think', 'consider',
  'you', 'i', 'we', 'they', 'it', 'its', 'my', 'your', 'our', 'their',
  'this', 'that', 'these', 'those', 'here', 'there',
  'much', 'many', 'more', 'most', 'less', 'least', 'some', 'any', 'all', 'each',
  'also', 'just', 'very', 'really', 'quite', 'rather', 'even', 'still', 'already',
  'now', 'then', 'ago', 'onwards', 'onward', 'overall', 'general', 'generally',
  'become', 'became', 'went', 'go', 'came', 'come', 'got',
  'rate', 'rates', 'ratio', 'ratios', 'percentage', 'pct', 'level', 'levels',
  'figure', 'figures', 'number', 'numbers', 'data', 'statistics', 'stat', 'stats',
  'value', 'values', 'amount', 'amounts', 'index', 'indices', 'indicator', 'metric',
  'inflow', 'inflows', 'outflow', 'outflows', 'volume', 'volumes',
  'economic', 'fiscal', 'monetary', 'financial', 'macro', 'macroeconomic',
  'recent', 'latest', 'current', 'annual', 'yearly', 'monthly', 'total',
  'overall', 'aggregate', 'average', 'key', 'main', 'major', 'top',
]);

const QUERY_SYNONYMS = {
  usa: 'us', america: 'us', american: 'us', americans: 'us',
  british: 'uk', britain: 'uk', england: 'uk', english: 'uk',
  german: 'germany', deutsch: 'germany', deutschland: 'germany',
  french: 'france',
  japanese: 'japan',
  chinese: 'china', prc: 'china',
  indian: 'india',
  brazilian: 'brazil',
  russian: 'russia',
  korean: 'southkorea',
  cpi: 'inflation', inflationary: 'inflation', prices: 'inflation',
  economic: 'gdp',
  unemployment: 'unemployment', jobless: 'unemployment', unemployed: 'unemployment',
  jobs: 'employment', employed: 'employment', employment: 'employment',
  shifted: 'change', shift: 'change', shifts: 'change',
  changed: 'change', changes: 'change', changing: 'change',
  evolved: 'change', evolve: 'change', evolution: 'change',
  moved: 'change', move: 'change', movement: 'change',
  transformed: 'change', transformation: 'change',
  transitioned: 'change', transition: 'change',
  developed: 'change', development: 'change',
  happened: 'change', happen: 'change', happens: 'change',
  grown: 'growth', grew: 'growth', growing: 'growth',
  increase: 'growth', increased: 'growth', increasing: 'growth',
  rise: 'growth', rose: 'growth', risen: 'growth', rising: 'growth',
  surge: 'growth', surged: 'growth', expand: 'growth', expanded: 'growth',
  declined: 'decline', decreasing: 'decline', decreased: 'decline',
  fell: 'decline', fall: 'decline', fallen: 'decline', falling: 'decline',
  dropped: 'decline', drop: 'decline', contraction: 'decline', contracted: 'decline',
  versus: null, vs: null, compared: null, against: null, comparison: null,
  composition: 'composition', structure: 'composition', makeup: 'composition',
  breakdown: 'composition', mix: 'composition',
  exports: 'export', exported: 'export', exporting: 'export',
  imports: 'import', imported: 'import', importing: 'import',
  gross: null, domestic: null, product: null,
  government: null, public: null, national: null,
};

const KIMI_CANON_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const KIMI_SYSTEM_PROMPT = `You are a query canonicalization engine for an economics dashboard.
Extract the canonical meaning of a user query as compact JSON.
Output ONLY valid JSON — no explanation, no markdown, no extra text.

Schema:
{
  "countries":      string[],
  "indicators":     string[],
  "timeframe":      string|null,
  "question_type":  string
}`;

function semanticKey(text) {
  if (typeof text !== 'string') return text;

  let t = text.toLowerCase().replace(/'s\b/g, '').replace(/'/g, '');
  for (const [re, rep] of QUERY_PHRASES) t = t.replace(re, rep);

  const keywords = [...new Set(
    t.replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(Boolean)
      .map((w) => (w in QUERY_SYNONYMS ? QUERY_SYNONYMS[w] : w))
      .filter((w) => w !== null && !QUERY_STOPWORDS.has(w) && w.length > 1)
  )].sort();

  return keywords.join(' ');
}

export function createQueryCanonicalizer({ KIMI_API_KEY, KIMI_BASE, KIMI_MODEL, IS_DEV, canonCache }) {
  return async function canonicalizeQuery(text) {
    if (typeof text !== 'string') return text;
    if (!KIMI_API_KEY) return semanticKey(text);

    const hit = canonCache.get(text);
    if (hit) return hit;

    try {
      const res = await fetch(KIMI_BASE, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${KIMI_API_KEY}`,
        },
        body: JSON.stringify({
          model: KIMI_MODEL,
          messages: [
            { role: 'system', content: KIMI_SYSTEM_PROMPT },
            { role: 'user', content: text },
          ],
          max_tokens: 150,
          temperature: 0,
        }),
        signal: AbortSignal.timeout(5_000),
      });

      if (!res.ok) throw new Error(`Kimi API ${res.status}`);

      const data = await res.json();
      const raw = data.choices?.[0]?.message?.content?.trim() ?? '';
      JSON.parse(raw);
      canonCache.put(text, raw, KIMI_CANON_TTL_MS);
      if (IS_DEV) console.log('[canonicalize] Kimi →', raw);
      return raw;
    } catch (err) {
      if (IS_DEV) console.warn('[canonicalize] Kimi fallback:', err.message);
      return semanticKey(text);
    }
  };
}

export function createCacheKeyBuilder({ canonicalizeQuery }) {
  return async function cacheKey(endpoint, messages) {
    let normalized;
    if (Array.isArray(messages)) {
      normalized = await Promise.all(
        messages.map(async (m) => {
          if (m.role !== 'user' || typeof m.content !== 'string') return m;
          return { ...m, content: await canonicalizeQuery(m.content) };
        })
      );
    } else if (messages && typeof messages === 'object') {
      normalized = { ...messages };
      if (typeof normalized.query === 'string') {
        normalized.query = await canonicalizeQuery(normalized.query);
      }
    } else {
      normalized = messages;
    }

    return createHash('sha256').update(endpoint + JSON.stringify(normalized)).digest('hex');
  };
}
