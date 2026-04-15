import 'dotenv/config';
import express from 'express';
import { join } from 'path';
import helmet from 'helmet';
import { createHash, randomBytes } from 'crypto';
import bcrypt from 'bcryptjs';
import countries from 'i18n-iso-countries';
import {
  ROOT_DIR,
  PORT,
  MODEL,
  ANTHROPIC_BASE,
  ANTHROPIC_API_KEY,
  KAGI_API_KEY,
  KAGI_BASE,
  IS_DEV,
  CLERK_SECRET_KEY,
  CLERK_JWT_KEY,
  CLERK_AUTH_ENABLED,
  NEWS_API_KEY,
  TRUSTED_NEWS_DOMAINS,
  KIMI_API_KEY,
  KIMI_BASE,
  KIMI_MODEL,
  TTL_SEARCH_MS,
  chatCacheTtlMs,
  RL_WINDOW_MS,
  RL_MAX,
  MAX_HISTORY,
  MAX_MSG_CHARS,
  MAX_QUERY_CHARS,
  MAX_CSV_COLS,
  MAX_CSV_ROWS,
  MAX_CONTEXT_CHARS,
  CSV_SAMPLE_ROWS,
  MAX_SEARCH_TURNS,
  MAX_SEARCH_HISTORY,
  ANTHROPIC_TIMEOUT_MS,
  ANTHROPIC_STREAM_TIMEOUT_MS,
  KAGI_TIMEOUT_MS,
  JWT_SECRET,
  BCRYPT_ROUNDS,
  DB_PATH,
  COUNTRY_CACHE_TTL_MS,
  RAW_DATA_TTL_MS,
} from './src/server/config.js';
import { apiCache, canonCache, rawDataCache } from './src/server/cache/index.js';
import { createDb } from './src/server/db/index.js';
import { initSchema } from './src/server/db/schema.js';
import { prepareStatements } from './src/server/db/statements.js';
import { createApiLimiter, createAuthLimiter, createStaticLimiter } from './src/server/auth/limits.js';
import { createAuthenticateApiKey, createMcpAuth, createRequireAuth } from './src/server/auth/middleware.js';
import { createAnalyticsRouter } from './src/server/routes/analytics.js';
import { createAuthRouter } from './src/server/routes/auth.js';
import { createBillingRouter, createBillingWebhookRouter } from './src/server/routes/billing.js';
import { createChatRouter, createCsvRouter } from './src/server/routes/chat.js';
import { createCountryRouter } from './src/server/routes/country.js';
import { createDeveloperRouter } from './src/server/routes/developer.js';
import { createMcpRouter } from './src/server/routes/mcp.js';
import { createMetricsRouter } from './src/server/routes/metrics.js';
import { createPeersRouter } from './src/server/routes/peers.js';
import { createPublicApiRouter } from './src/server/routes/publicApi.js';
import { createPublicSnapshotRouter, createSnapshotsRouter } from './src/server/routes/snapshots.js';
import { createSearchRouter } from './src/server/routes/search.js';
import { createSessionsRouter } from './src/server/routes/sessions.js';
import { createTelemetry } from './src/server/services/telemetry.js';
import { errorMessage } from './src/server/utils/errors.js';
import { sseWrite } from './src/server/utils/http.js';

import enLocale from 'i18n-iso-countries/langs/en.json' with { type: 'json' };
import {
  validate,
  ChatSchema, SearchSchema, AnalyzeCsvSchema, AnalyticsSchema,
  SearchHistorySchema,
  CreateSessionSchema, UpdateSessionSchema,
  CreateSearchSessionSchema, UpdateSearchSessionSchema,
  CountrySearchQuerySchema,
  DataApiSchema,
  PeerComparisonSchema,
  ApiKeyCreateSchema,
  ApiKeyDeleteSchema,
  SnapshotCreateSchema,
  SnapshotRegenerateSchema,
} from './schemas.js';

countries.registerLocale(enLocale);

if (!ANTHROPIC_API_KEY) {
  console.error('ERROR: ANTHROPIC_API_KEY environment variable is not set.');
  process.exit(1);
}

// ── PostHog telemetry ─────────────────────────────────────────────────────────
const { ph, track } = createTelemetry();
// ─────────────────────────────────────────────────────────────────────────────

if (!process.env.JWT_SECRET && !IS_DEV) {
  console.error('ERROR: JWT_SECRET environment variable is not set in production.');
  process.exit(1);
}

// ── SQLite database ────────────────────────────────────────────────────────────
const db = createDb(DB_PATH);
initSchema(db);

// ── Prepared statements ──────────────────────────────────────────────────────
const { stmt, stmtCountry } = prepareStatements(db);

const CLERK_PLACEHOLDER_HASH = bcrypt.hashSync(randomBytes(24).toString('hex'), BCRYPT_ROUNDS);

function ensureClerkUserRecord(user) {
  const existing = stmt.userByIdFull.get(user.id);
  if (existing) return;

  const baseEmail = (user.email || '').toLowerCase().trim();
  let email = baseEmail || `${user.id}@clerk.local`;
  const sameEmailUser = stmt.userByEmail.get(email);
  if (sameEmailUser && sameEmailUser.id !== user.id) {
    email = `${user.id}@clerk.local`;
  }

  const name = (user.name || 'User').slice(0, 80).trim() || 'User';
  const createdAt = user.iat ? new Date(user.iat * 1000).toISOString() : new Date().toISOString();

  stmt.insertUser.run(user.id, email, name, CLERK_PLACEHOLDER_HASH, createdAt);
}

// ── Validation and utilities ─────────────────────────────────────────────────


function validateAIResponse(parsed) {
  if (typeof parsed !== 'object' || parsed === null) return null;
  const rawSources = Array.isArray(parsed.sources) ? parsed.sources : [];
  const sources = rawSources.map(s =>
    typeof s === 'string'
      ? { title: s, url: null }
      : { title: String(s.title || ''), url: s.url ? String(s.url) : null }
  );
  return {
    insight:   typeof parsed.insight   === 'string'  ? parsed.insight   : '',
    charts:    Array.isArray(parsed.charts)           ? parsed.charts    : [],
    sources,
    followUps: Array.isArray(parsed.followUps)        ? parsed.followUps : [],
  };
}

const API_INDICATORS = {
  gdp: 'NY.GDP.MKTP.CD',
  gdp_growth: 'NY.GDP.MKTP.KD.ZG',
  gdppercapita: 'NY.GDP.PCAP.CD',
  gdp_per_capita: 'NY.GDP.PCAP.CD',
  exports: 'NE.EXP.GNFS.CD',
  imports: 'NE.IMP.GNFS.CD',
  trade_openness: 'custom:trade_openness',
};

const API_INDICATOR_LABELS = {
  gdp: 'GDP (current USD)',
  gdp_growth: 'GDP growth (%)',
  gdp_per_capita: 'GDP per capita (USD)',
  exports: 'Exports (current USD)',
  imports: 'Imports (current USD)',
  trade_openness: 'Trade openness (%)',
};

const BRICS_COUNTRY_CODES = ['BR', 'RU', 'IN', 'CN', 'ZA'];

function normalizeIndicatorKey(input) {
  return String(input || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_');
}

function normalizeApiCountries(raw) {
  return (raw || '').split(',')
    .map((item) => item.trim().toUpperCase().replace(/[^A-Z0-9]/g, ''))
    .filter(Boolean);
}

function isISO3(code) {
  return /^[A-Z]{3}$/.test(code);
}

function toISO2(code) {
  if (isISO3(code)) {
    const alpha2 = countries.alpha3ToAlpha2(code);
    return alpha2 || code;
  }
  return code;
}

function monthBucket(date = new Date()) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function getApiMonthlyLimitForUser(userId) {
  const plan = getPlanForUser(userId);
  const planLimits = {
    free: 500,
    pro: 5000,
    enterprise: Number.POSITIVE_INFINITY,
  };
  return planLimits[plan] ?? 500;
}

// ── Semantic query normalisation for cache keys ───────────────────────────────
//
// Two-phase approach so phrasing variants always resolve to the same key:
//   Phase 1 – multi-word phrase replacement (before tokenising)
//   Phase 2 – word-level synonym mapping + stopword removal + sort
//
// The ORIGINAL text is always sent to Claude unchanged.

// Phase 1: ordered list of [regex, replacement] applied before splitting.
// Longer / more specific phrases must come before shorter ones.
const QUERY_PHRASES = [
  // ── Economic indicators (multi-word → single token) ──────────────────────
  [/gross domestic product/g,               'gdp'],
  [/consumer price index/g,                 'inflation'],
  [/foreign direct investment/g,            'fdi'],
  [/current account/g,                      'currentaccount'],
  [/trade (?:deficit|surplus|balance)/g,    'tradebalance'],
  [/balance of (?:trade|payments)/g,        'tradebalance'],
  [/purchasing power parity/g,              'ppp'],
  [/(?:government|public|national) debt/g,  'debt'],
  [/debt.to.gdp/g,                          'debt gdp'],
  [/debt (?:percentage|percent|pct|ratio|share)/g, 'debt gdp'], // "debt percentage" ≡ "debt-to-GDP"
  [/interest rate/g,                        'interestrate'],
  [/exchange rate/g,                        'exchangerate'],
  [/labour|labor market/g,                  'unemployment'],
  [/market capitalisation|market cap/g,     'marketcap'],
  // ── Country / region names (multi-word → single token) ───────────────────
  [/united states(?: of america)?/g,        'us'],
  [/united kingdom/g,                       'uk'],
  [/european unions?/g,                      'eu'],
  [/great britain/g,                        'uk'],
  [/euro ?zone|euro ?area/g,                'eu'],
  [/south korea/g,                          'southkorea'],
  [/north korea/g,                          'northkorea'],
  [/saudi arabia/g,                         'saudiarabia'],
  [/south africa/g,                         'southafrica'],
  [/new zealand/g,                          'newzealand'],
  [/czech republic/g,                       'czechia'],
  // ── Time-period shorthands ────────────────────────────────────────────────
  [/last two decades?|past two decades?/g,  '20year'],
  [/last decade|past decade/g,              '10year'],
  [/last (\d+) years?/g,                    (_, n) => `${n}year`],
  [/past (\d+) years?/g,                    (_, n) => `${n}year`],
  [/over (?:the )?(?:last|past) (\d+) years?/g, (_, n) => `${n}year`],
];

// Phase 2: words that carry no semantic content in an economics context.
const QUERY_STOPWORDS = new Set([
  // articles / prepositions / conjunctions
  'a','an','the','and','or','but','in','of','to','for','on','at','by','as',
  'with','from','after','since','until','before','between','about','into',
  'through','during','per',
  // standalone financial terms that are noise without context
  // ("trade deficit/surplus/balance" is handled by the phrase step above)
  'balance','surplus','deficit',
  // question words / discourse markers
  'how','what','when','where','which','who','why','whose',
  'has','have','had','is','are','was','were','been','be','will','would',
  'could','should','do','does','did','can','may','might','shall','need',
  'tell','me','show','give','please','explain','describe','analyze','analyse',
  'compare','look','get','find','check','let','know','think','consider',
  'you','i','we','they','it','its','my','your','our','their',
  'this','that','these','those','here','there',
  'much','many','more','most','less','least','some','any','all','each',
  'also','just','very','really','quite','rather','even','still','already',
  'now','then','ago','onwards','onward','overall','general','generally',
  'become','became','went','go','came','come','got',
  // measurement words that don't distinguish queries on an economics platform
  'rate','rates','ratio','ratios','percentage','pct','level','levels',
  'figure','figures','number','numbers','data','statistics','stat','stats',
  'value','values','amount','amounts','index','indices','indicator','metric',
  'inflow','inflows','outflow','outflows','volume','volumes',
  // generic economic adjectives (everything on this platform is economic)
  'economic','fiscal','monetary','financial','macro','macroeconomic',
  // hedge/filler words
  'recent','latest','current','annual','yearly','monthly','total',
  'overall','aggregate','average','key','main','major','top',
]);

// Phase 2: word-level synonym map (applied after phrase replacement + tokenising).
const QUERY_SYNONYMS = {
  // ── Country adjectives / aliases → canonical lowercase name ──────────────
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
  // ── Economic indicator aliases ────────────────────────────────────────────
  cpi: 'inflation', inflationary: 'inflation', prices: 'inflation',
  economic: 'gdp',  // "India economic growth" ≡ "India GDP growth"
  unemployment: 'unemployment', jobless: 'unemployment', unemployed: 'unemployment',
  jobs: 'employment', employed: 'employment', employment: 'employment',
  // Note: deficit/surplus/balance are handled by phrase step ("trade deficit" → "tradebalance")
  // Standalone uses are dropped via stopwords to avoid false matches.
  // ── Change / movement verbs → 'change' ───────────────────────────────────
  shifted: 'change', shift: 'change', shifts: 'change',
  changed: 'change', changes: 'change', changing: 'change',
  evolved:  'change', evolve: 'change', evolution: 'change',
  moved:    'change', move: 'change', movement: 'change',
  transformed: 'change', transformation: 'change',
  transitioned: 'change', transition: 'change',
  developed: 'change', development: 'change',
  happened:  'change', happen: 'change', happens: 'change',
  // ── Growth / increase → 'growth' ─────────────────────────────────────────
  grown:    'growth', grew: 'growth', growing: 'growth',
  increase: 'growth', increased: 'growth', increasing: 'growth',
  rise:     'growth', rose: 'growth', risen: 'growth', rising: 'growth',
  surge:    'growth', surged: 'growth', expand: 'growth', expanded: 'growth',
  // ── Decline → 'decline' ───────────────────────────────────────────────────
  declined: 'decline', decreasing: 'decline', decreased: 'decline',
  fell:     'decline', fall: 'decline', fallen: 'decline', falling: 'decline',
  dropped:  'decline', drop: 'decline', contraction: 'decline', contracted: 'decline',
  // ── Comparison words — drop entirely (subjects already captured) ──────────
  versus: null, vs: null, compared: null, against: null, comparison: null,
  // ── Composition / structure ───────────────────────────────────────────────
  composition: 'composition', structure: 'composition', makeup: 'composition',
  breakdown: 'composition', mix: 'composition',
  // ── Trade ────────────────────────────────────────────────────────────────
  exports: 'export', exported: 'export', exporting: 'export',
  imports: 'import', imported: 'import', importing: 'import',
  // ── Measurement words not in stopwords ───────────────────────────────────
  gross: null, domestic: null, product: null,   // residue after phrase step
  government: null, public: null, national: null, // residue after phrase step
};

/**
 * Extract a sorted canonical keyword set from a user query.
 * Used only for the cache key — the original text still goes to Claude.
 *
 * Phase 1: replace known multi-word phrases with a single token.
 * Phase 2: tokenise, apply word synonyms, drop stopwords, sort.
 */
function semanticKey(text) {
  if (typeof text !== 'string') return text;

  // Phase 1 — phrase replacement
  let t = text.toLowerCase().replace(/'s\b/g, '').replace(/'/g, '');
  for (const [re, rep] of QUERY_PHRASES) t = t.replace(re, rep);

  // Phase 2 — tokenise, map synonyms, filter, sort
  const keywords = [...new Set(
    t.replace(/[^a-z0-9\s]/g, ' ')
     .split(/\s+/)
     .filter(Boolean)
     .map(w => {
       if (w in QUERY_SYNONYMS) return QUERY_SYNONYMS[w]; // null = drop
       return w;
     })
     .filter(w => w !== null && !QUERY_STOPWORDS.has(w) && w.length > 1)
  )].sort();

  return keywords.join(' ');
}

const KIMI_CANON_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

const KIMI_SYSTEM_PROMPT = `You are a query canonicalization engine for an economics dashboard.
Extract the canonical meaning of a user query as compact JSON.
Output ONLY valid JSON — no explanation, no markdown, no extra text.

Schema:
{
  "countries":      string[],  // lowercase canonical names: "us","uk","germany","china", etc. Empty array if none.
  "indicators":     string[],  // 1–3 items from: gdp, inflation, unemployment, trade, debt, fdi, exchangerate, interestrate, ppp, marketcap, other
  "timeframe":      string|null, // "YYYY", "YYYY-YYYY", or null if not specified
  "question_type":  string     // one of: level, change, growth, decline, comparison, composition, forecast, other
}`;

/**
 * Use Kimi 2.5 to extract a canonical JSON representation of a user query.
 * Falls back to semanticKey() if KIMI_API_KEY is not set or the call fails.
 * Results are cached locally for 7 days to avoid repeated API calls.
 */
async function canonicalizeQuery(text) {
  if (typeof text !== 'string') return text;

  if (!KIMI_API_KEY) return semanticKey(text);

  const hit = canonCache.get(text);
  if (hit) return hit;

  try {
    const res = await fetch(KIMI_BASE, {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${KIMI_API_KEY}`,
      },
      body: JSON.stringify({
        model:       KIMI_MODEL,
        messages: [
          { role: 'system', content: KIMI_SYSTEM_PROMPT },
          { role: 'user',   content: text },
        ],
        max_tokens:  150,
        temperature: 0,
      }),
      signal: AbortSignal.timeout(5_000),
    });

    if (!res.ok) throw new Error(`Kimi API ${res.status}`);

    const data     = await res.json();
    const raw      = data.choices?.[0]?.message?.content?.trim() ?? '';
    JSON.parse(raw); // validate — throws if Kimi returned non-JSON
    canonCache.put(text, raw, KIMI_CANON_TTL_MS);
    if (IS_DEV) console.log('[canonicalize] Kimi →', raw);
    return raw;
  } catch (err) {
    if (IS_DEV) console.warn('[canonicalize] Kimi fallback:', err.message);
    return semanticKey(text); // graceful degradation
  }
}

/**
 * Build a stable cache key for a /chat, /search, or /analytics request.
 * User message text is first canonicalized via Kimi 2.5 (or semanticKey as
 * fallback) so phrasing variants resolve to the same key.
 */
async function cacheKey(endpoint, messages) {
  let normalized;
  if (Array.isArray(messages)) {
    normalized = await Promise.all(
      messages.map(async m => {
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
}

const authenticateApiKey = createAuthenticateApiKey({
  stmt,
  getApiMonthlyLimitForUser,
  monthBucket,
});

const requireAuth = createRequireAuth({
  JWT_SECRET,
  CLERK_AUTH_ENABLED,
  CLERK_SECRET_KEY,
  CLERK_JWT_KEY,
  stmt,
  ensureClerkUserRecord,
});

function iso2ToFlag(code) {
  return [...code.toUpperCase()]
    .map(c => String.fromCodePoint(c.charCodeAt(0) - 65 + 0x1F1E6))
    .join('');
}

function normalizeSessionTitle(title, fallback = 'New Chat') {
  if (typeof title !== 'string') return fallback;
  const normalized = title.trim().replace(/\s+/g, ' ').slice(0, 100);
  return normalized || fallback;
}

async function fetchVerifiedNews(query) {
  if (!NEWS_API_KEY) return [];

  const url = new URL('https://newsapi.org/v2/everything');
  url.searchParams.append('q', query);
  url.searchParams.append('domains', TRUSTED_NEWS_DOMAINS);
  url.searchParams.append('sortBy', 'publishedAt');
  url.searchParams.append('language', 'en');
  url.searchParams.append('pageSize', '5'); // Get top 5 most recent articles

  try {
    const res = await fetch(url.toString(), {
      headers: { 'X-Api-Key': NEWS_API_KEY },
      signal: AbortSignal.timeout(10_000)
    });

    if (!res.ok) throw new Error(`NewsAPI Error: ${res.status}`);
    
    const data = await res.json();
    return (data.articles || []).map((article) => ({
      title: article.title,
      source: article.source.name,
      date: article.publishedAt,
      summary: article.description,
      url: article.url
    }));
  } catch (error) {
    console.error('Failed to fetch news:', errorMessage(error));
    return [];
  }
}

// ── Multi-source data fetching with fallback ──────────────────────────────────

const DATA_SOURCES = {
  worldbank: {
    name: 'World Bank',
    baseUrl: 'https://api.worldbank.org/v2',
    indicators: {
      gdp: 'NY.GDP.MKTP.CD',
      gdpGrowth: 'NY.GDP.MKTP.KD.ZG',
      gdpPerCapita: 'NY.GDP.PCAP.CD',
      exports: 'NE.EXP.GNFS.CD',
      imports: 'NE.IMP.GNFS.CD',
    },
    timeout: 15_000,
    retries: 2,
  },
  imf: {
    name: 'IMF DataMapper',
    baseUrl: 'https://www.imf.org/external/datamapper/api/v1',
    indicators: {
      gdp: 'NGDPD',
      gdpGrowth: 'NGDP_RPCH',
      gdpPerCapita: 'NGDPDPC',
      // IMF uses growth rates for trade, not absolute values
      exports: 'TXG_RPCH',
      imports: 'TMG_RPCH',
    },
    timeout: 15_000,
    retries: 2,
    note: 'Trade data shows volume growth %, not USD values',
  },
  oecd: {
    name: 'OECD',
    baseUrl: 'https://stats.oecd.org/SDMX-JSON/data',
    // OECD has limited country coverage — mainly members + key partners
    indicators: {
      gdp: 'QNA/AUT+BEL+CAN+CHL+COL+CRI+CZE+DNK+EST+FIN+FRA+DEU+GRC+HUN+ISL+IRL+ISR+ITA+JPN+KOR+LVA+LTU+LUX+MEX+NLD+NZL+NOR+POL+PRT+SVK+SVN+ESP+SWE+CHE+TUR+GBR+USA.B1_GE.HVPVOBARSA.Q/all?startTime=2010&endTime=2024',
    },
    timeout: 20_000,
    retries: 1,
    coverage: new Set(['AU', 'AT', 'BE', 'CA', 'CL', 'CO', 'CR', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IS', 'IE', 'IL', 'IT', 'JP', 'KR', 'LV', 'LT', 'LU', 'MX', 'NL', 'NZ', 'NO', 'PL', 'PT', 'SK', 'SI', 'ES', 'SE', 'CH', 'TR', 'GB', 'US']),
  },
};

async function fetchWithRetry(url, options, retries = 2, baseDelay = 1000, retryStatuses = [429, 503], timeoutMs = null) {
  for (let i = 0; i <= retries; i++) {
    try {
      // Create a fresh AbortSignal for every attempt so a timed-out signal
      // from attempt N doesn't poison attempt N+1.
      const signal = timeoutMs ? AbortSignal.timeout(timeoutMs) : options.signal;
      const res = await fetch(url, { ...options, signal });
      if (res.ok) return res;
      if (retryStatuses.includes(res.status) && i < retries) {
        const delay = baseDelay * Math.pow(2, i);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      throw new Error(`HTTP ${res.status}`);
    } catch (err) {
      if (i === retries) throw err;
      await new Promise(r => setTimeout(r, baseDelay * Math.pow(2, i)));
    }
  }
  throw new Error('Max retries exceeded');
}

async function fetchIndicatorWithFallback(isoCode, indicatorType) {
  const errors = [];
  const code = isoCode.toUpperCase();

  // Try World Bank first (most comprehensive)
  try {
    const cfg = DATA_SOURCES.worldbank;
    const indicator = cfg.indicators[indicatorType];
    const url = `${cfg.baseUrl}/country/${code}/indicator/${indicator}?date=2010:2024&format=json&per_page=100`;
    
    const res = await fetchWithRetry(url, {}, cfg.retries, 1000, [429, 503], cfg.timeout);
    
    const data = await res.json();
    if (!Array.isArray(data) || !Array.isArray(data[1])) {
      throw new Error('Invalid World Bank response structure');
    }
    
    return {
      source: 'worldbank',
      data: data[1].filter(e => e.value !== null).sort((a, b) => +a.date - +b.date),
    };
  } catch (err) {
    errors.push(`World Bank: ${err.message}`);
  }

  // Try IMF second (good coverage, different methodology)
  // Skip IMF for trade data: IMF exports/imports are volume growth rates (%), not absolute USD.
  // Mixing these with World Bank USD values produces completely inconsistent numbers.
  if (indicatorType === 'exports' || indicatorType === 'imports') {
    return { source: 'unavailable', data: [], note: 'World Bank unavailable; IMF trade data skipped (growth % ≠ USD)' };
  }
  try {
    const cfg = DATA_SOURCES.imf;
    const indicator = cfg.indicators[indicatorType];
    const iso3 = countries.alpha2ToAlpha3(code);
    if (!iso3) throw new Error(`No ISO3 code for ${code}`);
    
    const url = `${cfg.baseUrl}/${indicator}/${iso3}?periods=2010:2024`;
    
    const res = await fetchWithRetry(url, {
      headers: { 'Accept': 'application/json' },
    }, cfg.retries, 2000, [403, 429, 503], cfg.timeout);
    
    const json = await res.json();
    const values = json.values?.[iso3];
    if (!values) throw new Error('No data for country');
    
    // Normalize to World Bank-like format
    const normalized = Object.entries(values)
      .map(([year, value]) => ({
        date: year,
        value: value !== 'NA' && value !== '' ? Number(value) : null,
      }))
      .filter(e => e.value !== null && !isNaN(e.value))
      .sort((a, b) => +a.date - +b.date);
    
    return {
      source: 'imf',
      data: normalized,
      note: indicatorType === 'exports' || indicatorType === 'imports' 
        ? 'IMF trade data shows volume growth %, not absolute USD values' 
        : 'IMF methodology may differ from World Bank',
    };
  } catch (err) {
    errors.push(`IMF: ${err.message}`);
  }

  // Try OECD third (limited coverage, high quality for members)
  if (DATA_SOURCES.oecd.coverage.has(code)) {
    try {
      const cfg = DATA_SOURCES.oecd;
      // OECD SDMX-JSON is complex — simplified GDP fetch
      const url = `${cfg.baseUrl}/QNA/${code}.B1_GE.HVPVOBARSA.Q/all?startTime=2010&endTime=2024&dimensionAtObservation=AllDimensions`;
      
      const res = await fetchWithRetry(url, {
        headers: { 'Accept': 'application/json' },
      }, cfg.retries, 1000, [429, 503], cfg.timeout);
      
      const json = await res.json();
      // Parse SDMX-JSON structure (simplified)
      const observations = json.dataSets?.[0]?.series?.['0:0:0:0']?.observations;
      if (!observations) throw new Error('No OECD data found');
      
      // Convert quarterly to annual (take Q4 values)
      const annualData = {};
      Object.entries(observations).forEach(([key, val]) => {
        const period = json.structure?.dimensions?.observation?.[0]?.values?.[key]?.id;
        if (period && period.endsWith('-Q4')) {
          const year = period.slice(0, 4);
          annualData[year] = val[0]; // value is array
        }
      });
      
      const normalized = Object.entries(annualData)
        .map(([year, value]) => ({ date: year, value: Number(value) }))
        .filter(e => !isNaN(e.value))
        .sort((a, b) => +a.date - +b.date);
      
      return {
        source: 'oecd',
        data: normalized,
        note: 'OECD QNA data — annualized from quarterly',
      };
    } catch (err) {
      errors.push(`OECD: ${err.message}`);
    }
  }

  // All sources failed
  throw new Error(`All data sources failed: ${errors.join('; ')}`);
}

// ── Updated buildCountryDataset with full fallback chain ──────────────────────
async function buildCountryDataset(isoCode) {
  const code = isoCode.toUpperCase().trim();

  // Validate country code using i18n-iso-countries
  if (!countries.isValid(code)) {
    throw new Error(`Invalid country code: ${code}`);
  }
  const countryName = countries.getName(code, 'en') || code;

  // Fetch country region from World Bank (non-fatal)
  let region = 'Unknown';
  try {
    const infoRes = await fetch(
      `https://api.worldbank.org/v2/country/${code}?format=json`,
      { signal: AbortSignal.timeout(5000) }
    );
    const infoData = await infoRes.json();
    region = infoData[1]?.[0]?.region?.value ?? 'Unknown';
  } catch { /* region stays 'Unknown' */ }

  // Fetch all indicators with fallback chain
  const indicatorTypes = ['gdp', 'gdpGrowth', 'gdpPerCapita', 'exports', 'imports'];
  const results = await Promise.all(
    indicatorTypes.map(type => 
      fetchIndicatorWithFallback(code, type).catch(err => ({
        error: err.message,
        source: 'failed',
        data: [],
      }))
    )
  );

  // Build source tracking
  const sourcesUsed = new Set();
  const errors = [];
  const dataMap = {};

  results.forEach((result, idx) => {
    const type = indicatorTypes[idx];
    if (result.error) {
      errors.push(`${type}: ${result.error}`);
      dataMap[type] = [];
    } else {
      sourcesUsed.add(result.source);
      dataMap[type] = result.data;
      if (result.note) console.log(`[${type}] ${result.note}`);
    }
  });

  // Transform to common format (same as before)
  const toMap = arr => Object.fromEntries(arr.map(e => [+e.date, e.value]));
  const gdpMap = toMap(dataMap.gdp);
  const growthMap = toMap(dataMap.gdpGrowth);
  const perCapMap = toMap(dataMap.gdpPerCapita);
  const expMap = toMap(dataMap.exports);
  const impMap = toMap(dataMap.imports);

  // Build unified year list
  const allYears = [...new Set([
    ...Object.keys(gdpMap), ...Object.keys(growthMap), ...Object.keys(perCapMap),
  ].map(Number))].filter(y => y >= 2010 && y <= 2024).sort((a, b) => a - b);

  const gdpData = allYears.map(year => ({
    year,
    gdp_bn: gdpMap[year] ? +(gdpMap[year] / 1e9).toFixed(1) : null,
    gdp_growth: growthMap[year] ? +growthMap[year].toFixed(2) : null,
    gdp_per_capita: perCapMap[year] ? +perCapMap[year].toFixed(0) : null,
  })).filter(d => d.gdp_bn !== null);

  // Trade data handling (IMF may return growth rates, not absolute values)
  const tradeYears = [...new Set([...Object.keys(expMap), ...Object.keys(impMap)].map(Number))]
    .filter(y => y >= 2010 && y <= 2024).sort((a, b) => a - b);

  // Detect if we have absolute values (World Bank) or growth rates (IMF)
  const isAbsoluteValues = tradeYears.length > 0 && 
    (Object.values(expMap).some(v => v > 100) || Object.values(impMap).some(v => v > 100));

  const exportTotals = isAbsoluteValues 
    ? Object.fromEntries(tradeYears.filter(y => expMap[y]).map(y => [y, +(expMap[y] / 1e9).toFixed(1)]))
    : Object.fromEntries(tradeYears.filter(y => expMap[y]).map(y => [y, `${expMap[y]}%`]));

  const importTotals = isAbsoluteValues
    ? Object.fromEntries(tradeYears.filter(y => impMap[y]).map(y => [y, +(impMap[y] / 1e9).toFixed(1)]))
    : Object.fromEntries(tradeYears.filter(y => impMap[y]).map(y => [y, `${impMap[y]}%`]));

  // Claude breakdown prompt (generic, no hardcoded country)
  const breakdownPrompt = `Generate trade composition breakdown for ${countryName} (ISO-2: ${code}).

${isAbsoluteValues ? `Real World Bank total exports (USD billions):
${JSON.stringify(exportTotals)}

Real World Bank total imports (USD billions):
${JSON.stringify(importTotals)}` : `IMF trade volume growth rates (%):
Exports: ${JSON.stringify(exportTotals)}
Imports: ${JSON.stringify(importTotals)}

Note: IMF provides growth rates, not absolute values. Estimate relative proportions based on typical trade patterns for ${countryName}.`}

Return ONLY this JSON (no markdown, no explanation):
{
  "exportSectors": [{"key":"snake_key","label":"Label","color":"#hex"}, ...],
  "importPartners": [{"key":"snake_key","label":"Label","color":"#hex"}, ...],
  "exportData": [{"year":2010,"total":X,"<sector_key>":X,...}, ...],
  "importData": [{"year":2010,"total":X,"<partner_key>":X,...}, ...],
  "pieExports": [{"name":"Label","value":X}, ...],
  "pieImports": [{"name":"Label","value":X}, ...]
}

Rules:
1. 5–6 export sectors; last key must be "other".
2. 5–6 import partners/regions; last key must be "other".
3. Values must SUM to match totals for each year (±0.2 rounding OK).
4. "total" field = exactly the provided value.
5. Include ONLY years present in the provided totals.
6. Export sector colors: #F59E0B #94a3b8 #10B981 #8B5CF6 #06B6D4 #64748b
7. Import partner colors: #EF4444 #F59E0B #10B981 #F97316 #8B5CF6 #64748b
8. pieExports/pieImports use the most recent year available.`;

  const bdRes = await callAnthropic({
    model: MODEL, max_tokens: 4000, temperature: 0,
    system: 'Return only valid JSON matching the schema given. No markdown, no explanation.',
    messages: [{ role: 'user', content: breakdownPrompt }],
  });
  const bdText = bdRes.content?.map(b => b.text || '').join('') || '{}';
  let bd;
  try { bd = JSON.parse(bdText.replace(/```json|```/g, '').trim()); }
  catch { throw new Error(`Claude breakdown parse failed for ${code}: ${bdText.slice(0, 200)}`); }

  const gdpDataFinal = gdpData;

  // Build KPIs
  const lastGDP  = gdpDataFinal[gdpDataFinal.length - 1];
  const prevGDP  = gdpDataFinal[gdpDataFinal.length - 2];
  const sortedExpYears = Object.entries(exportTotals).sort((a, b) => +b[0] - +a[0]);
  const sortedImpYears = Object.entries(importTotals).sort((a, b) => +b[0] - +a[0]);
  const expTotal = sortedExpYears[0] ? +sortedExpYears[0][1] : 0;
  const impTotal = sortedImpYears[0] ? +sortedImpYears[0][1] : 0;
  const expYear  = sortedExpYears[0]?.[0] ?? '';
  const balance  = isAbsoluteValues ? +(expTotal - impTotal).toFixed(1) : null;
  const gdpDelta = lastGDP && prevGDP ? +(lastGDP.gdp_bn - prevGDP.gdp_bn).toFixed(1) : null;
  const topPartner = (bd.importPartners ?? []).find(p => p.key !== 'other');
  const topPie     = (bd.pieImports   ?? []).find(p => p.name !== 'Other' && p.name !== 'other');
  const topPct     = topPie && isAbsoluteValues && impTotal > 0 ? Math.round((topPie.value / impTotal) * 100) : null;

  const kpis = [
    { label: `GDP ${lastGDP?.year ?? ''}`, value: `$${lastGDP?.gdp_bn}B`,
      sub: 'Nominal USD', trend: gdpDelta != null ? `${gdpDelta >= 0 ? '+' : ''}$${gdpDelta}B YoY` : null, color: '#00AAFF' },
    { label: 'GDP Growth', value: `${lastGDP?.gdp_growth ?? 'N/A'}%`,
      sub: `Real ${lastGDP?.year ?? ''}`, trend: null, color: '#10B981' },
    { label: 'GDP/Capita', value: lastGDP?.gdp_per_capita ? `$${Number(lastGDP.gdp_per_capita).toLocaleString()}` : 'N/A',
      sub: `${lastGDP?.year ?? ''} estimate`, trend: null, color: '#8B5CF6' },
    { label: 'Total Exports', value: isAbsoluteValues ? `$${expTotal}B` : `${expTotal}`,
      sub: isAbsoluteValues ? expYear : 'volume growth %', trend: null, color: '#F59E0B' },
    { label: 'Total Imports', value: isAbsoluteValues ? `$${impTotal}B` : `${impTotal}`,
      sub: isAbsoluteValues ? expYear : 'volume growth %', trend: null, color: '#EF4444' },
    ...(isAbsoluteValues ? [{
      label: 'Trade Balance', value: `${balance >= 0 ? '+' : ''}$${balance}B`, sub: expYear,
      trend: balance >= 0 ? '↑ Surplus' : '↓ Deficit', color: '#06B6D4'
    }] : []),
    { label: '#1 Importer', value: topPartner?.label ?? 'N/A',
      sub: topPie && topPct != null ? `$${topPie.value}B · ${topPct}% share` : '',
      trend: null, color: '#EF4444' },
  ];

  return {
    code,
    name: countryName,
    flag: iso2ToFlag(code),
    region,
    gdpData: gdpDataFinal,
    exportData:    bd.exportData    ?? [],
    importData:    bd.importData    ?? [],
    exportSectors: bd.exportSectors ?? [],
    importPartners:bd.importPartners?? [],
    kpis,
    pieExports: bd.pieExports ?? [],
    pieImports: bd.pieImports ?? [],
    _meta: {
      sources: Array.from(sourcesUsed).map(s => {
        const src = Object.values(DATA_SOURCES).find(ds => ds.name.toLowerCase().replace(/\s/g, '') === s);
        return src ? src.name : s;
      }),
      fallbackUsed: sourcesUsed.has('imf') || sourcesUsed.has('oecd'),
      dataQuality: sourcesUsed.has('worldbank') ? 'high' : sourcesUsed.has('imf') ? 'good' : 'limited',
      cachedAt: Date.now(),
    },
  };
}

// ── Express setup ─────────────────────────────────────────────────────────────

const app = express();
app.set('trust proxy', 1); // Railway / other reverse proxies set X-Forwarded-For
const DEV_ORIGINS = new Set(
  (process.env.CORS_ORIGINS || 'http://localhost:5173,http://localhost:5174')
    .split(',').map(o => o.trim()).filter(Boolean)
);

app.use((req, res, next) => {
  const origin = req.headers.origin || '';
  if (DEV_ORIGINS.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Max-Age', '600');
  }
  if (req.method === 'OPTIONS') return res.status(204).end();
  next();
});

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc:     ["'self'"],
        scriptSrc:      [
          "'self'",
          'https://*.clerk.com',
          'https://*.clerk.accounts.dev',
          'https://*.clerk.dev',
          'https://challenges.cloudflare.com',
          'https://*.hcaptcha.com',
          'https://*.google.com',
          'https://*.gstatic.com',
        ],
        styleSrc:       ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc:        ["'self'", 'https://fonts.gstatic.com'],
        connectSrc:     [
          "'self'",
          'https://*.i.posthog.com',
          'https://*.posthog.com',
          'https://*.clerk.com',
          'https://*.clerk.accounts.dev',
          'https://*.clerk.dev',
          'https://challenges.cloudflare.com',
          'https://*.hcaptcha.com',
          'https://*.google.com',
          'https://*.gstatic.com',
        ],
        imgSrc:         [
          "'self'",
          'data:',
          'blob:',
          'https://*.clerk.com',
          'https://*.clerk.accounts.dev',
          'https://*.clerk.dev',
          'https://*.hcaptcha.com',
          'https://*.google.com',
          'https://*.gstatic.com',
        ],
        frameSrc:       ["'self'", 'https://*.clerk.com', 'https://*.clerk.accounts.dev', 'https://*.clerk.dev', 'https://challenges.cloudflare.com', 'https://*.hcaptcha.com', 'https://*.google.com', 'https://*.gstatic.com'],
        workerSrc:      ["'self'", 'blob:'],
        frameAncestors: ["'none'"],
      },
    },
    crossOriginEmbedderPolicy: false,
  })
);

app.use(express.json({ limit: '2mb' }));

const apiLimiter = createApiLimiter({ windowMs: RL_WINDOW_MS, max: RL_MAX });
const authLimiter = createAuthLimiter();

app.use('/api/auth', createAuthRouter({
  authLimiter,
  requireAuth,
  track,
  ph,
  stmt,
  validate,
  schemas: {
    RegisterSchema,
    LoginSchema,
    ChangePasswordSchema,
    DeleteAccountSchema,
    ForgotPasswordSchema,
    ResetPasswordSchema,
  },
  BCRYPT_ROUNDS,
  JWT_SECRET,
  PORT,
  revokeCurrentToken,
}));

app.use('/api', createSessionsRouter({
  requireAuth,
  stmt,
  db,
  validate,
  schemas: {
    SearchHistorySchema,
    CreateSearchSessionSchema,
    UpdateSearchSessionSchema,
    CreateSessionSchema,
    UpdateSessionSchema,
  },
  normalizeSessionTitle,
  MAX_SEARCH_HISTORY,
}));

app.use('/api/country', createCountryRouter({
  requireAuth,
  apiLimiter,
  db,
  stmtCountry,
  validate,
  CountrySearchQuerySchema,
  iso2ToFlag,
  errorMessage,
  buildCountryDataset,
  track,
  COUNTRY_CACHE_TTL_MS,
}));

app.use('/api/data', createPublicApiRouter({
  authenticateApiKey,
  validate,
  DataApiSchema,
  fetchWorldBankCountryCatalog,
  parseIndicatorKeys,
  normalizeApiCountries,
  normalizeCountryCode,
  parseApiYears,
  buildApiCountryPayload,
  buildApiSeriesForCountry,
  buildApiBatchCsvPayload,
  buildApiCountrySeriesRows,
  sendApiDataResponse,
  toCsvString,
  errorMessage,
}));

app.use('/api/peers', createPeersRouter({
  requireAuth,
  apiLimiter,
  validate,
  PeerComparisonSchema,
  normalizeCountryCode,
  normalizePeerMetricMetric,
  fetchWorldBankCountryCatalog,
  resolvePeerGroupMembers,
  checkPlanLimit,
  resolvePeerComparisonYear,
  fetchPeerMetricRows,
  buildCountryValuesByCode,
  API_INDICATOR_LABELS,
  computeRank,
  percentileRank,
  computeMedian,
  computeAverage,
  groupTypeLabel,
  errorMessage,
}));

app.use('/api/analytics', createAnalyticsRouter({
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
}));

app.use('/api/developer', createDeveloperRouter({
  requireAuth,
  stmt,
  getApiMonthlyLimitForUser,
  validate,
  ApiKeyCreateSchema,
  ApiKeyDeleteSchema,
}));

app.use('/api/metrics', createMetricsRouter({
  requireAuth,
  stmt,
  checkPlanLimit,
}));

app.use('/api/chat', createChatRouter({
  apiLimiter,
  validate,
  ChatSchema,
  cacheKey,
  apiCache,
  fetchVerifiedNews,
  executeDataTool,
  validateAIResponse,
  chatCacheTtlMs,
  track,
  sseWrite,
  IS_DEV,
  MAX_HISTORY,
  KAGI_API_KEY,
  KAGI_BASE,
  DATA_TOOLS,
  ANTHROPIC_BASE,
  ANTHROPIC_API_KEY,
  ANTHROPIC_STREAM_TIMEOUT_MS,
  MODEL,
}));

app.use('/api/search', createSearchRouter({
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
}));

app.use('/api/analyze-csv', createCsvRouter({
  apiLimiter,
  validate,
  AnalyzeCsvSchema,
  callAnthropic,
  MODEL,
  validateAIResponse,
  track,
  CSV_SAMPLE_ROWS,
}));

app.use('/api/snapshots', createSnapshotsRouter({
  requireAuth,
  stmt,
  validate,
  SnapshotCreateSchema,
  SnapshotRegenerateSchema,
  normalizeCountryCode,
  toISO2,
  countries,
  checkPlanLimit,
  buildCountryDataset,
  errorMessage,
}));

app.use('/api/snapshot', createPublicSnapshotRouter({ stmt }));

app.use('/api/billing', createBillingRouter({
  requireAuth,
  stmt,
  STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY || '',
  STRIPE_PRICE_PRO: process.env.STRIPE_PRICE_PRO || '',
  STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET || '',
}));

app.use('/api/billing/webhook', createBillingWebhookRouter({
  STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY || '',
  STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET || '',
  stmt,
}));

app.use('/mcp', createMcpRouter({
  mcpAuth: createMcpAuth(process.env.MCP_API_KEY),
  fetchWorldBankIndicator,
  fetchIMFIndicator,
  fetchFREDSeries,
}));

const staticLimiter = createStaticLimiter();

// ── Anthropic helper ──────────────────────────────────────────────────────────

async function callAnthropic(body, extraHeaders = {}) {
  const res = await fetch(ANTHROPIC_BASE, {
    method: 'POST',
    headers: {
      'Content-Type':       'application/json',
      'x-api-key':          ANTHROPIC_API_KEY,
      'anthropic-version':  '2023-06-01',
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
    throw new Error(`Kagi error: ${payload.error.map(e => e.msg).join('; ')}`);
  }

  return payload;
}

// ── Real data fetchers — World Bank, IMF DataMapper, FRED ────────────────────

/**
 * Fetch indicator data from the World Bank Open Data API.
 * Returns sorted array of { country, countryCode, year, value, indicator, indicatorName }.
 * No API key required. Country codes are ISO2 (US, CN, DE …).
 */
async function fetchWorldBankIndicator(countryCodes, indicator, startYear, endYear) {
  const codes = Array.isArray(countryCodes) ? countryCodes.join(';') : countryCodes;
  const url = `https://api.worldbank.org/v2/country/${codes}/indicator/${indicator}?format=json&date=${startYear}:${endYear}&per_page=1000`;
  const ck = `wb:${url}`;
  const hit = rawDataCache.get(ck);
  if (hit) return hit;
  const res = await fetchWithRetry(url, { headers: { Accept: 'application/json' } }, 2, 1500, [429, 503], 20000);
  const json = await res.json();
  if (!Array.isArray(json) || !json[1]) return [];
  const result = json[1]
    .filter(d => d.value !== null && d.value !== undefined)
    .map(d => ({
      country:       d.country?.value ?? codes,
      countryCode:   d.countryiso3code ?? codes,
      year:          parseInt(d.date, 10),
      value:         d.value,
      indicator:     d.indicator?.id ?? indicator,
      indicatorName: d.indicator?.value ?? indicator,
    }))
    .sort((a, b) => a.year - b.year);
  rawDataCache.put(ck, result, RAW_DATA_TTL_MS);
  return result;
}

function parseYears(rawStart, rawEnd) {
  const now = new Date();
  const endYear = Math.min(now.getUTCFullYear(), Number.parseInt(rawEnd, 10) || now.getUTCFullYear());
  const startYear = Number.parseInt(rawStart, 10) || 2010;
  const finalStart = Math.max(1960, Math.min(startYear, endYear));
  return { startYear: finalStart, endYear };
}

function parseApiYears(rawStart, rawEnd, rawYears) {
  if (typeof rawYears === 'string') {
    const normalized = rawYears.replace(/\s+/g, '');
    const match = /^([0-9]{4}):([0-9]{4})$/.exec(normalized);
    if (match) {
      return parseYears(match[1], match[2]);
    }
  }

  return parseYears(rawStart, rawEnd);
}

function formatRateLimit(limit) {
  return Number.isFinite(limit) ? String(limit) : 'unlimited';
}

function normalizedRateValue(value) {
  return Number.isFinite(value) ? value : null;
}

function csvEscape(value) {
  const s = value === null || value === undefined ? '' : String(value);
  if (/[",\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function toCsvString(rows) {
  if (!rows.length) return '';
  const headers = Object.keys(rows[0]);
  const headerLine = headers.map(csvEscape).join(',');
  const lines = rows.map((row) => headers.map(h => csvEscape(row[h])).join(','));
  return `${headerLine}\n${lines.join('\n')}`;
}

function buildApiCountrySeriesRows(countryPayload) {
  const { meta, series } = countryPayload;
  const rows = [];
  const indicators = Object.keys(series || {});

  for (const indicatorKey of indicators) {
    const label = API_INDICATOR_LABELS[indicatorKey] || indicatorKey;
    for (const point of series[indicatorKey] || []) {
      if (!Number.isFinite(point.year) || !Number.isFinite(point.value)) continue;
      rows.push({
        country_code: meta.code,
        country_name: meta.name,
        country_alpha3: meta.alpha3,
        indicator: indicatorKey,
        indicator_name: label,
        year: point.year,
        value: point.value,
      });
    }
  }

  return rows;
}

function parseIndicatorKeys(raw) {
  const parsed = String(raw || 'gdp,exports,imports,gdp_growth,gdp_per_capita')
    .split(',')
    .map(normalizeIndicatorKey)
    .filter(Boolean);
  const keys = [];
  for (const k of parsed) {
    const key = k === 'tradeopenness' ? 'trade_openness' : k;
    if (API_INDICATORS[key] && !keys.includes(key)) keys.push(key);
  }
  return keys;
}

function normalizeCountryCode(raw) {
  const candidate = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!candidate) return '';
  if (countries.isValid(candidate)) return candidate;
  const alpha2 = countries.getAlpha2Code?.(candidate, 'en');
  if (alpha2) return alpha2;
  return candidate;
}

function buildCountryMeta(code) {
  const alpha2 = normalizeCountryCode(code);
  const alpha3 = countries.alpha2ToAlpha3(alpha2) || alpha2;
  const name = countries.getName(alpha2, 'en') || alpha2;
  const region = 'Unknown';
  return {
    code: alpha2,
    alpha3,
    name,
    flag: iso2ToFlag(alpha2),
    region,
  };
}

async function buildApiSeriesForCountry(code, indicatorKeys, startYear, endYear) {
  const meta = buildCountryMeta(code);
  const iso2 = meta.code;
  const wbCodes = [iso2];
  const rowsByIndicator = {};

  const sourceRows = await Promise.all(indicatorKeys.map(async (indicatorKey) => {
    const mapTo = API_INDICATORS[indicatorKey];
    if (!mapTo) return { indicatorKey, rows: [] };

    if (mapTo.startsWith('custom:')) {
      return { indicatorKey, rows: [] };
    }

    const rows = await fetchWorldBankIndicator(wbCodes, mapTo, startYear, endYear);
    return { indicatorKey, rows };
  }));

  const yearSet = new Set();
  for (const item of sourceRows) {
    for (const row of item.rows) yearSet.add(row.year);
  }

  const hasDerived = indicatorKeys.includes('trade_openness');
  if (hasDerived) {
    const importsRows = rowsByKey(sourceRows, 'imports');
    const exportsRows = rowsByKey(sourceRows, 'exports');
    const gdpRows = rowsByKey(sourceRows, 'gdp');
    for (const r of [...importsRows, ...exportsRows, ...gdpRows]) yearSet.add(r.year);
    const importMap = rowsToMap(importsRows);
    const exportMap = rowsToMap(exportsRows);
    const gdpMap = rowsToMap(gdpRows);
    for (const year of yearSet) {
      const imports = importMap.get(year);
      const exports = exportMap.get(year);
      const gdp = gdpMap.get(year);
      if (imports != null && exports != null && gdp && gdp !== 0) {
        sourceRows.push({
          indicatorKey: 'trade_openness',
          rows: [{
            country: meta.name,
            countryCode: meta.code,
            year,
            value: ((exports + imports) / gdp) * 100,
            indicator: 'trade_openness',
            indicatorName: API_INDICATOR_LABELS.trade_openness,
          }],
        });
      }
    }
  }

  const series = {};
  for (const { indicatorKey, rows } of sourceRows) {
    if (!rows.length) continue;
    rowsByIndicator[indicatorKey] = rows
      .map((row) => ({ year: row.year, value: Number(row.value) }))
      .filter((row) => Number.isFinite(row.year) && Number.isFinite(row.value))
      .sort((a, b) => a.year - b.year);
    if (!rowsByIndicator[indicatorKey].length) continue;
    series[indicatorKey] = rowsByIndicator[indicatorKey];
  }

  return { meta, series };
}

function rowsByKey(sourceRows, key) {
  const match = sourceRows.find(item => item.indicatorKey === key);
  return match?.rows ?? [];
}

function rowsToMap(rows) {
  const m = new Map();
  for (const row of rows) {
    m.set(row.year, Number(row.value));
  }
  return m;
}

async function fetchWorldBankCountryCatalog() {
  const ck = 'wb_country_catalog_v1';
  const cached = rawDataCache.get(ck);
  if (cached) return cached;

  const res = await fetch('https://api.worldbank.org/v2/country?format=json&per_page=500', { signal: AbortSignal.timeout(12_000) });
  if (!res.ok) {
    throw new Error(`World Bank country list HTTP ${res.status}`);
  }

  const json = await res.json();
  const countriesPayload = Array.isArray(json) ? json[1] : [];
  const rows = (countriesPayload || [])
      .filter(c => typeof c === 'object' && c.region?.id !== 'NA' && typeof c.iso2Code === 'string' && c.iso2Code.length === 2)
      .map(c => ({
        code: c.iso2Code,
        alpha3: c.iso3Code || c.iso2Code,
        name: c.name,
        flag: iso2ToFlag(c.iso2Code),
        region: c.region?.value || 'Unknown',
        income: c.incomeLevel?.value || 'Unknown',
        incomeLevel: c.incomeLevel?.value || c.incomeLevel?.id || 'Unknown',
      }));

  rawDataCache.put(ck, rows, RAW_DATA_TTL_MS);
  return rows;
}

function normalizeIncomeGroup(raw) {
  const value = String(raw || '').trim().toLowerCase();
  if (!value) return 'Other income';
  if (value.includes('high income')) return 'High income';
  if (value.includes('low income')) return 'Low income';
  if (value.includes('middle income')) return 'Middle income';
  return 'Other income';
}

function peerCodeFromRow(row) {
  const code = String(row?.countryCode || '').toUpperCase();
  if (code.length === 2) return code;
  const alpha2 = countries.alpha3ToAlpha2(code);
  return alpha2 || code;
}

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function percentileRank(values, target) {
  if (!values.length) return null;
  const sorted = values.slice().sort((a, b) => a - b);
  const below = sorted.filter((value) => value < target).length;
  const equal = sorted.filter((value) => value === target).length;
  const n = sorted.length;
  if (!Number.isFinite(n) || n === 0) return null;
  return +(((below + equal / 2) / n) * 100).toFixed(2);
}

function computeRank(values, target) {
  if (!values.length) return null;
  const sortedDesc = values.slice().sort((a, b) => b - a);
  const idx = sortedDesc.findIndex((value) => value <= target);
  return idx >= 0 ? idx + 1 : null;
}

function computeAverage(values) {
  if (!values.length) return null;
  const sum = values.reduce((total, value) => total + value, 0);
  return +(sum / values.length).toFixed(2);
}

function computeMedian(values) {
  if (!values.length) return null;
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return +sorted[mid].toFixed(2);
  return +((sorted[mid - 1] + sorted[mid]) / 2).toFixed(2);
}

function normalizePeerMetricMetric(raw) {
  const metric = String(raw || 'gdp').trim().toLowerCase().replace(/\s+/g, '_');
  return metric === 'tradeopenness' ? 'trade_openness' : metric;
}

function resolvePeerGroupMembers(catalogRow, groupType, catalog) {
  if (groupType === 'brics') {
    const bricsSet = new Set(BRICS_COUNTRY_CODES);
    return catalog.filter((item) => bricsSet.has(item.code));
  }

  if (groupType === 'income') {
    const incomeBucket = normalizeIncomeGroup(catalogRow.incomeLevel || catalogRow.income);
    return catalog.filter((item) => normalizeIncomeGroup(item.incomeLevel || item.income) === incomeBucket);
  }

  const region = catalogRow.region || 'Unknown';
  return catalog.filter((item) => (item.region || 'Unknown') === region);
}

function groupTypeLabel(groupType, groupValue) {
  if (groupType === 'brics') return 'BRICS';
  if (groupType === 'income') return `${normalizeIncomeGroup(groupValue)} economies`;
  return `${groupValue || 'Region'} economies`;
}

async function fetchPeerMetricRows(metric, countryCodes, startYear, endYear) {
  const codes = countryCodes.filter(Boolean).filter((item, idx, all) => all.indexOf(item) === idx);
  if (!codes.length) return [];

  if (metric === 'trade_openness') {
    const [importsRows, exportsRows, gdpRows] = await Promise.all([
      fetchWorldBankIndicator(codes, API_INDICATORS.imports, startYear, endYear),
      fetchWorldBankIndicator(codes, API_INDICATORS.exports, startYear, endYear),
      fetchWorldBankIndicator(codes, API_INDICATORS.gdp, startYear, endYear),
    ]);

    const toMap = (rows) => {
      const m = new Map();
      for (const row of rows) {
        const year = toNumber(row.year);
        if (year == null || year < startYear || year > endYear) continue;
        const code = peerCodeFromRow(row);
        const key = `${code}:${year}`;
        const value = toNumber(row.value);
        if (!Number.isFinite(value)) continue;
        m.set(key, value);
      }
      return m;
    };

    const importMap = toMap(importsRows);
    const exportMap = toMap(exportsRows);
    const gdpMap = toMap(gdpRows);
    const byCodeMap = new Map();

    for (const key of importMap.keys()) {
      const [code, yearText] = String(key).split(':');
      const year = Number(yearText);
      const yearImports = importMap.get(key);
      const yearExports = exportMap.get(key);
      const yearGdp = gdpMap.get(key);
      if (![yearImports, yearExports, yearGdp].every(Number.isFinite) || yearGdp === 0) continue;
      byCodeMap.set(key, ((yearImports + yearExports) / yearGdp) * 100);
    }

    const rows = [];
    for (const [key, value] of byCodeMap.entries()) {
      const [code, yearText] = String(key).split(':');
      rows.push({
        countryCode: code,
        country: null,
        year: Number(yearText),
        value,
        indicator: 'trade_openness',
        indicatorName: API_INDICATOR_LABELS.trade_openness,
      });
    }

    return rows;
  }

  const wbCode = API_INDICATORS[metric];
  if (!wbCode) return [];
  return fetchWorldBankIndicator(codes, wbCode, startYear, endYear);
}

function buildPeerRows(valuesByCode, targetCode, catalogByCode, metricLabel) {
  return valuesByCode
    .map((entry) => {
      const row = catalogByCode.get(entry.code);
      return {
        code: entry.code,
        name: row?.name ?? entry.code,
        flag: row?.flag ?? iso2ToFlag(entry.code),
        value: entry.value,
        isTarget: entry.code === targetCode,
      };
    })
    .sort((a, b) => b.value - a.value);
}

async function resolvePeerComparisonYear(targetCode, metric) {
  const now = new Date();
  const endYear = now.getUTCFullYear();
  const startYear = Math.max(2010, endYear - 8);
  const rows = await fetchPeerMetricRows(metric, [targetCode], startYear, endYear);
  const years = rows
    .map((row) => toNumber(row.year))
    .filter((value) => value != null && value > 0);

  if (!years.length) return null;
  return Math.max(...years);
}

function buildCountryValuesByCode(rows, year, peerCodesSet) {
  const valuesByCode = new Map();
  for (const row of rows) {
    const code = peerCodeFromRow(row);
    const rowYear = toNumber(row.year);
    if (!code || !peerCodesSet.has(code) || rowYear == null) continue;
    if (year != null && rowYear !== year) continue;
    const value = toNumber(row.value);
    if (value == null) continue;

    const existing = valuesByCode.get(code);
    if (!existing || existing.year < rowYear) {
      valuesByCode.set(code, { code, year: rowYear, value: value, name: row.country || code });
    }
  }
  return valuesByCode;
}

/**
 * Fetch cross-country indicator data from the IMF DataMapper API.
 * Returns sorted array of { countryCode, year, value }.
 * No API key required. Country codes are ISO3 (USA, CHN, DEU …).
 */
async function fetchIMFIndicator(indicator, countryCodes) {
  const codes = Array.isArray(countryCodes) ? countryCodes.join('/') : countryCodes;
  const url = `https://www.imf.org/external/datamapper/api/v1/${indicator}/${codes}`;
  const ck = `imf:${url}`;
  const hit = rawDataCache.get(ck);
  if (hit) return hit;
  // IMF DataMapper sometimes returns 403 as a transient anti-scrape measure — retry it.
  const res = await fetchWithRetry(url, { headers: { Accept: 'application/json' } }, 3, 2000, [403, 429, 503], 20000);
  const json = await res.json();
  const values = json?.values?.[indicator];
  if (!values) return [];
  const rows = [];
  for (const [countryCode, yearData] of Object.entries(values)) {
    for (const [year, value] of Object.entries(yearData)) {
      if (value !== null && value !== undefined)
        rows.push({ countryCode, year: parseInt(year, 10), value });
    }
  }
  const result = rows.sort((a, b) => a.year - b.year);
  rawDataCache.put(ck, result, RAW_DATA_TTL_MS);
  return result;
}

/**
 * Fetch US economic series from the FRED API (Federal Reserve Bank of St. Louis).
 * Returns sorted array of { year, value }.
 * Requires FRED_API_KEY environment variable.
 */
async function fetchFREDSeries(seriesId, startYear, endYear) {
  const apiKey = process.env.FRED_API_KEY;
  if (!apiKey) throw new Error('FRED_API_KEY environment variable is not set');
  const url = `https://api.stlouisfed.org/fred/series/observations?series_id=${seriesId}&api_key=${apiKey}&file_type=json&observation_start=${startYear}-01-01&observation_end=${endYear}-12-31&frequency=a&aggregation_method=avg`;
  const res = await fetch(url, { signal: AbortSignal.timeout(12000) });
  if (!res.ok) throw new Error(`FRED API ${res.status}`);
  const json = await res.json();
  return (json.observations || [])
    .filter(o => o.value !== '.' && o.value !== null)
    .map(o => ({ year: parseInt(o.date, 10), value: parseFloat(o.value) }))
    .sort((a, b) => a.year - b.year);
}

function applyApiRateHeaders(res, apiKey) {
  if (!apiKey) return;
  res.setHeader('X-RateLimit-Limit', formatRateLimit(apiKey.monthlyLimit));
  res.setHeader('X-RateLimit-Remaining', formatRateLimit(apiKey.callsRemaining));
  res.setHeader('X-RateLimit-Period', `month:${apiKey.month_key || monthBucket()}`);
}

function sendApiDataResponse(res, req, payload, format) {
  const requestedFormat = format === 'csv' ? 'csv' : 'json';
  applyApiRateHeaders(res, req.apiKey);

  if (requestedFormat === 'csv') {
    const filename = `econchart_data_${Date.now()}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.send(payload);
  }

  const wrapped = payload && typeof payload === 'object'
    ? {
      ...payload,
      _meta: {
        ...(payload._meta || {}),
        apiKeyCallsRemaining: normalizedRateValue(req.apiKey?.callsRemaining),
        apiKeyMonthlyLimit: normalizedRateValue(req.apiKey?.monthlyLimit),
        apiKeyMonth: req.apiKey?.month_key,
      },
    }
    : payload;

  res.json(wrapped);
}

function buildApiIndicatorRows(indicatorKeys, series) {
  const rows = {};
  for (const key of indicatorKeys) {
    const data = series[key] || [];
    rows[key] = {
      label: API_INDICATOR_LABELS[key] || key,
      unit: 'value',
      data,
    };
  }
  return rows;
}

function buildApiCountryPayload(seriesResult, indicatorKeys, startYear, endYear) {
  const { meta, series } = seriesResult;
  return {
    country: {
      code: meta.code,
      alpha3: meta.alpha3,
      name: meta.name,
      flag: meta.flag,
      region: meta.region,
    },
    period: { startYear, endYear },
    indicators: buildApiIndicatorRows(indicatorKeys, series),
  };
}

function buildApiBatchCsvPayload(countryPayloads) {
  const rows = [];
  for (const payload of countryPayloads) {
    const indicators = payload.indicators || {};
    for (const [key, values] of Object.entries(indicators)) {
      const indicatorName = values.label || key;
      for (const point of values.data || []) {
        rows.push({
          country_code: payload.country.code,
          country_alpha3: payload.country.alpha3,
          country_name: payload.country.name,
          region: payload.country.region,
          indicator: key,
          indicator_name: indicatorName,
          year: point.year,
          value: point.value,
        });
      }
    }
  }
  return rows;
}

// ── Cross-source indicator mapping (World Bank ↔ IMF DataMapper) ──────────────
// When one source is unavailable the other is tried automatically.
const WB_TO_IMF_INDICATOR = {
  'NY.GDP.MKTP.KD.ZG': 'NGDP_RPCH',  // GDP growth %
  'NY.GDP.MKTP.CD':    'NGDPD',       // GDP current USD
  'NY.GDP.PCAP.CD':    'NGDPDPC',     // GDP per capita
  'FP.CPI.TOTL.ZG':   'PCPIPCH',     // Inflation
  'SL.UEM.TOTL.ZS':   'LUR',         // Unemployment rate
  'NE.GDI.TOTL.ZS':   'NID_NGDP',   // Investment % GDP
  'NE.EXP.GNFS.CD':   'TXG_RPCH',   // Exports (WB=USD, IMF=growth%)
  'NE.IMP.GNFS.CD':   'TMG_RPCH',   // Imports (WB=USD, IMF=growth%)
  'BX.KLT.DINV.CD.WD':'BX_FDI_DINV_CD_WD', // FDI inflows
  'GC.DOD.TOTL.GD.ZS':'GGXWDG_NGDP', // Government debt % GDP
};
const IMF_TO_WB_INDICATOR = Object.fromEntries(
  Object.entries(WB_TO_IMF_INDICATOR).map(([wb, imf]) => [imf, wb])
);

/** Execute a data tool call and return the result as a string. */
async function executeDataTool(name, input) {
  if (name === 'fetch_world_bank') {
    const { country_codes, indicator, start_year = 2000, end_year = 2024 } = input;
    try {
      const rows = await fetchWorldBankIndicator(country_codes, indicator, start_year, end_year);
      if (rows.length === 0) throw new Error('World Bank returned no data for this query');
      const sourceUrl = `https://data.worldbank.org/indicator/${indicator}?locations=${Array.isArray(country_codes) ? country_codes.join('-') : country_codes}`;
      return JSON.stringify({ rows, source: 'World Bank Open Data', indicator, sourceUrl });
    } catch (wbErr) {
      // Auto-fallback: try IMF DataMapper if a matching indicator exists
      const imfIndicator = WB_TO_IMF_INDICATOR[indicator];
      if (!imfIndicator) throw wbErr;
      const codeList = Array.isArray(country_codes) ? country_codes : [country_codes];
      const iso3Codes = codeList.map(c => countries.alpha2ToAlpha3(c.toUpperCase())).filter(Boolean);
      if (!iso3Codes.length) throw wbErr;
      if (IS_DEV) console.log(`[fallback] WB→IMF: ${indicator} → ${imfIndicator}`);
      const rows = await fetchIMFIndicator(imfIndicator, iso3Codes);
      const sourceUrl = `https://www.imf.org/external/datamapper/${imfIndicator}`;
      return JSON.stringify({ rows, source: 'IMF DataMapper', indicator: imfIndicator, sourceUrl, note: `World Bank unavailable (${wbErr.message}) — using IMF DataMapper equivalent` });
    }
  }
  if (name === 'fetch_imf') {
    const { indicator, country_codes } = input;
    try {
      const rows = await fetchIMFIndicator(indicator, country_codes);
      if (rows.length === 0) throw new Error('IMF returned no data for this query');
      const sourceUrl = `https://www.imf.org/external/datamapper/${indicator}`;
      return JSON.stringify({ rows, source: 'IMF DataMapper', indicator, sourceUrl });
    } catch (imfErr) {
      // Auto-fallback: try World Bank if a matching indicator exists
      const wbIndicator = IMF_TO_WB_INDICATOR[indicator];
      if (!wbIndicator) throw imfErr;
      const codeList = Array.isArray(country_codes) ? country_codes : [country_codes];
      // IMF uses ISO3 codes; World Bank needs ISO2 — convert
      const iso2Codes = codeList.map(c => countries.alpha3ToAlpha2(c.toUpperCase())).filter(Boolean);
      if (!iso2Codes.length) throw imfErr;
      if (IS_DEV) console.log(`[fallback] IMF→WB: ${indicator} → ${wbIndicator}`);
      const rows = await fetchWorldBankIndicator(iso2Codes, wbIndicator, 2000, 2024);
      const sourceUrl = `https://data.worldbank.org/indicator/${wbIndicator}`;
      return JSON.stringify({ rows, source: 'World Bank Open Data', indicator: wbIndicator, sourceUrl, note: `IMF DataMapper unavailable (${imfErr.message}) — using World Bank equivalent` });
    }
  }
  if (name === 'fetch_fred') {
    const { series_id, start_year = 2000, end_year = 2024 } = input;
    const rows = await fetchFREDSeries(series_id, start_year, end_year);
    const sourceUrl = `https://fred.stlouisfed.org/series/${series_id}`;
    return JSON.stringify({ rows, source: 'FRED (Federal Reserve Bank of St. Louis)', series_id, sourceUrl });
  }
  throw new Error(`Unknown tool: ${name}`);
}

// Tool definitions passed to the Anthropic API
const DATA_TOOLS = [
  {
    name: 'fetch_world_bank',
    description: 'Fetch real, verified economic data from the World Bank Open Data API. Works for ALL countries including the USA. No API key required.',
    input_schema: {
      type: 'object',
      properties: {
        country_codes: {
          type: 'array', items: { type: 'string' },
          description: 'ISO2 country codes (e.g. ["US","CN","DE"]). IMPORTANT: for "top N countries" or any ranking/comparison across many countries use ["all"] to fetch every country at once — this is the ONLY way to get a correct global ranking. When using ["all"], always set start_year = end_year (single year) to stay within the 1000-row limit.',
        },
        indicator: {
          type: 'string',
          description: `World Bank indicator code. Key indicators:
MACRO: NY.GDP.MKTP.CD (GDP $), NY.GDP.MKTP.KD.ZG (GDP growth %), NY.GDP.PCAP.CD (GDP/capita $), FP.CPI.TOTL.ZG (inflation %), SL.UEM.TOTL.ZS (unemployment %)
MANUFACTURING (use for US manufacturing questions): NV.IND.MANF.CD (manufacturing value added $), NV.IND.MANF.KD.ZG (manufacturing value added growth %), SL.IND.MANF.ZS (employment in manufacturing % of total), NV.IND.TOTL.ZS (industry value added % GDP)
TRADE: NE.EXP.GNFS.CD (exports $), NE.IMP.GNFS.CD (imports $), NE.TRD.GNFS.ZS (trade % GDP), BM.GSR.MNFCS.CD (imports of manufactures $), BX.GSR.MNFCS.CD (exports of manufactures $), TM.TAX.MANF.SM.AR.ZS (tariff rate on manufactured goods %)
OTHER: BN.CAB.XOKA.CD (current account $), GC.DOD.TOTL.GD.ZS (govt debt % GDP), SP.POP.TOTL (population)`,
        },
        start_year: { type: 'number', description: 'Start year (default 2000)' },
        end_year:   { type: 'number', description: 'End year (default 2024)' },
      },
      required: ['country_codes', 'indicator'],
    },
  },
  {
    name: 'fetch_imf',
    description: 'Fetch verified data from the IMF DataMapper API including WEO projections. No API key required. Best for cross-country comparisons and forward projections.',
    input_schema: {
      type: 'object',
      properties: {
        indicator: {
          type: 'string',
          description: 'IMF indicator code. Common: NGDP_RPCH (real GDP growth %), PCPIPCH (inflation %), LUR (unemployment %), BCA_NGDPD (current account % GDP), GGXWDG_NGDP (govt debt % GDP), NID_NGDP (investment % GDP)',
        },
        country_codes: {
          type: 'array', items: { type: 'string' },
          description: 'ISO3 country codes (e.g. ["USA","CHN","DEU"]). Up to 6 countries.',
        },
      },
      required: ['indicator', 'country_codes'],
    },
  },
  {
    name: 'fetch_fred',
    description: 'Fetch US economic time series from FRED (Federal Reserve Bank of St. Louis). Requires FRED_API_KEY env var. Use fetch_world_bank instead if unsure whether FRED is available.',
    input_schema: {
      type: 'object',
      properties: {
        series_id: {
          type: 'string',
          description: 'FRED series ID. Common: GDP (nominal GDP $B), GDPC1 (real GDP $B), UNRATE (unemployment %), CPIAUCSL (CPI index), FEDFUNDS (fed funds rate %), DGS10 (10-year treasury %), PAYEMS (non-farm payrolls), INDPRO (industrial production), MANEMP (manufacturing employees thousands), CES3000000008 (manufacturing hourly wages)',
        },
        start_year: { type: 'number', description: 'Start year (default 2000)' },
        end_year:   { type: 'number', description: 'End year (default 2024)' },
      },
      required: ['series_id'],
    },
  },
];

/** Build the system prompt dynamically so it reflects which tools are actually available. */
function buildVerifiedChatSystem() {
  const fredAvailable = !!process.env.FRED_API_KEY;
  return `You are EconChart, an AI assistant for economic data analysis and visualisation.

STRICT DATA RULES — NO EXCEPTIONS:
1. Call fetch_world_bank and/or fetch_imf${fredAvailable ? ' and/or fetch_fred' : ''} BEFORE creating any chart.
2. NEVER generate, estimate, or recall any numerical values. Every number must come from a tool result.
3. If a tool returns empty rows or an error, omit that chart and note it in the analysis.
4. Copy values exactly from tool results into chart data. Do not round, interpolate, or fill gaps.

${fredAvailable ? '' : `IMPORTANT: FRED is not configured. For US data use fetch_world_bank with these indicators:
- US manufacturing employment share: SL.IND.MANF.ZS
- US manufacturing value added: NV.IND.MANF.CD
- US manufacturing value added growth: NV.IND.MANF.KD.ZG
- US imports of manufactures: BM.GSR.MNFCS.CD
- US exports of manufactures: BX.GSR.MNFCS.CD
- US trade openness: NE.TRD.GNFS.ZS
- US tariff rate on manufactures: TM.TAX.MANF.SM.AR.ZS
Fetch multiple indicators in separate tool calls and combine them into multi-series charts.

`}WORKFLOW:
- Identify which indicators and countries are needed.
- For "top N", "highest", "lowest", "ranking", or "which countries" queries: ALWAYS use country_codes: ["all"] with start_year = end_year (single year) to fetch the complete global dataset. Never hand-pick countries for a ranking — the correct top-N can only be determined from a full dataset sort.
- Fire all required tool calls (can be parallel).
- Map the returned rows directly into chart data arrays.
- Write your analysis citing specific figures with years from the tool results.

RESPONSE FORMAT (streaming-friendly — two parts):
Part 1 — Write your plain-text analysis directly. No JSON, no markdown.
Part 2 — On a new line write the exact marker CHARTS_DATA: followed immediately by the JSON object.

Example:
China's GDP grew by 4.6 % in 2023 per World Bank data, down from the 8 %+ rates seen in the early 2010s. The slowdown reflects a structural shift from manufacturing toward services and domestic consumption.
CHARTS_DATA:{"charts":[{"id":"cn_gdp","title":"China GDP Growth (%)","type":"line","description":"Source: World Bank · NY.GDP.MKTP.KD.ZG","data":[],"xKey":"year","series":[{"key":"value","name":"GDP Growth %","color":"#00AAFF"}],"_source":{"api":"worldbank","indicator":"NY.GDP.MKTP.KD.ZG","countries":["CN"],"retrievedAt":"2024-01-01T00:00:00Z","url":"https://data.worldbank.org/indicator/NY.GDP.MKTP.KD.ZG"}}],"sources":[{"title":"World Bank · NY.GDP.MKTP.KD.ZG","url":"https://data.worldbank.org/indicator/NY.GDP.MKTP.KD.ZG"}],"followUps":["Compare China and India GDP","Show China per capita GDP","What drove China's slowdown?"]}

Chart schema:
- type: "line"|"bar"|"area"|"pie"|"composed"|"radar"
- _source is required on every chart with api, indicator, countries, retrievedAt, url.
- For composed charts: use "chartType":"bar"/"line" in series; add "rightAxis":true to the line series.
- For pie charts: each data item needs "name" and "value" keys.
- Colors: #00AAFF, #F59E0B, #10B981, #EF4444, #8B5CF6, #F97316, #06B6D4`;
}


const SEARCH_SYSTEM = `You are an expert research analyst and economist with comprehensive knowledge of global economics and financial markets.
When searching, prioritize authoritative sources: World Bank (worldbank.org), IMF (imf.org), OECD (oecd.org), national statistics offices, central banks, Reuters, Bloomberg, Financial Times, and regional economic organizations.

Structure your response clearly with these sections:

**Summary**
Brief executive overview (2-3 sentences with key headline numbers).

**Key Findings**
- Specific data point with exact figure and date
- Another finding with percentage/value
- [4-6 bullet points total with precise statistics]

**Recent Developments**
Important news, policy changes, or events from the most recent period available.

**Economic Implications**
What the data means for the country's economic trajectory and outlook.

Be specific — include exact figures, percentages, dates, and growth rates wherever possible.`;

const CSV_SYSTEM = `You are an expert data analyst and visualization specialist. Analyze CSV datasets and generate Recharts-compatible chart configurations using real values from the data. Never use placeholder values. Return only valid JSON without any markdown wrapper.`;

// ── Auth routes ───────────────────────────────────────────────────────────────

/** Revoke the JWT carried by req.user (no-op if token has no jti or already expired). */
function revokeCurrentToken(user) {
  if (!user?.jti || !user?.exp) return;
  stmt.pruneRevokedTokens.run(Date.now());
  stmt.revokeToken.run(user.jti, user.exp * 1000); // exp is in seconds
}

function getPlanForUser(userId) {
  const sub = stmt.subscriptionByUser.get(userId);
  if (!sub) return 'free';
  if (sub.status !== 'active') return 'free';
  return sub.plan || 'free';
}

function checkPlanLimit(userId, feature) {
  const plan = getPlanForUser(userId);
  const limits = {
    countries: { free: 5, pro: Infinity, enterprise: Infinity },
    customMetrics: { free: 0, pro: 5, enterprise: 50 },
    sessions: { free: 3, pro: 50, enterprise: Infinity },
    snapshots: { free: 2, pro: 50, enterprise: Infinity },
    apiCalls: { free: 500, pro: 5000, enterprise: Infinity },
    peers: { free: 2, pro: 10, enterprise: 50 },
  };
  return { plan, limit: limits[feature]?.[plan] ?? 0 };
}

// ── Static file serving ───────────────────────────────────────────────────────
const DIST = join(ROOT_DIR, 'dist');
app.use(staticLimiter);
app.use(express.static(DIST));
app.use((_req, res) => res.sendFile(join(DIST, 'index.html')));

const shouldStartServer = String(process.env.NODE_ENV) !== 'test' || process.env.VITEST_FORCE_LISTEN === '1';
if (shouldStartServer) {
  app.listen(PORT, () => {
    console.log(`Economic Dashboard server running on http://localhost:${PORT}`);
    console.log(`Supported countries: ${countries.getNames('en').length} via i18n-iso-countries`);
  });
}

export { app };
