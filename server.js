import 'dotenv/config';
import express from 'express';
import { join } from 'path';
import helmet from 'helmet';
import { createHash, randomBytes } from 'crypto';
import bcrypt from 'bcryptjs';
import countries from 'i18n-iso-countries';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { z } from 'zod';
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
import { createAuthRouter } from './src/server/routes/auth.js';
import { createCountryRouter } from './src/server/routes/country.js';
import { createPeersRouter } from './src/server/routes/peers.js';
import { createPublicApiRouter } from './src/server/routes/publicApi.js';
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

function buildKagiChatPrompt(messages = [], newsSources = []) {
  const turns = Array.isArray(messages)
    ? messages.slice(-10).map((m) => {
        const role = m?.role === 'assistant' ? 'Assistant' : 'User';
        const content = typeof m?.content === 'string'
          ? m.content
          : JSON.stringify(m?.content ?? '');
        return `${role}: ${content}`;
      }).join('\n\n')
    : '';

  const newsContext = Array.isArray(newsSources) && newsSources.length > 0
    ? `\n\nRecent news context (verify before use):\n${newsSources
        .slice(0, 6)
        .map((s, i) => `${i + 1}. ${s.title}`)
        .join('\n')}`
    : '';

  return [
    'You are EconChart, an economics research and analysis assistant.',
    'Answer latest user request using conversation context.',
    'Provide clear narrative analysis with concrete figures, years, and assumptions where available.',
    'If data is uncertain or unavailable, state uncertainty explicitly.',
    'Keep answer structured with short section headers and bullet points where useful.',
    'Do not output JSON or code fences.',
    newsContext,
    '',
    'Conversation:',
    turns,
    '',
    'Now respond to latest user message.',
  ].join('\n');
}

function defaultChatFollowUps() {
  return [
    'Compare this with peers or regional averages',
    'Show key drivers behind this trend',
    'What could change this outlook in next 12 months?',
  ];
}

// ── SSE + streaming helpers ────────────────────────────────────────────────────

/** Call Anthropic with stream:true; returns the raw fetch Response. */
async function callAnthropicStream(body) {
  const res = await fetch(ANTHROPIC_BASE, {
    method: 'POST',
    headers: {
      'Content-Type':      'application/json',
      'x-api-key':         ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({ ...body, stream: true }),
    signal: AbortSignal.timeout(ANTHROPIC_STREAM_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${await res.text()}`);
  return res;
}

/**
 * Stream one Anthropic turn, calling onTextDelta(delta) for each text token.
 * Returns { text, toolUses, content, stopReason } after the turn completes.
 */
async function streamAnthropicTurn(body, onTextDelta) {
  const streamRes = await callAnthropicStream(body);
  const reader = streamRes.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let text = '';
  const toolUses = [];
  let currentTU = null;
  let currentInput = '';
  let stopReason = null;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const raw = line.slice(6);
        if (raw === '[DONE]') continue;
        let event;
        try { event = JSON.parse(raw); } catch { continue; }
        if (event.type === 'content_block_start' && event.content_block?.type === 'tool_use') {
          currentTU = { type: 'tool_use', id: event.content_block.id, name: event.content_block.name, input: {} };
          currentInput = '';
        } else if (event.type === 'content_block_delta') {
          if (event.delta?.type === 'text_delta') {
            text += event.delta.text;
            onTextDelta?.(event.delta.text);
          } else if (event.delta?.type === 'input_json_delta' && currentTU) {
            currentInput += event.delta.partial_json;
          }
        } else if (event.type === 'content_block_stop') {
          if (currentTU) {
            try { currentTU.input = JSON.parse(currentInput); } catch { currentTU.input = {}; }
            toolUses.push(currentTU);
            currentTU = null;
            currentInput = '';
          }
        } else if (event.type === 'message_delta') {
          if (event.delta?.stop_reason) stopReason = event.delta.stop_reason;
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  const content = [];
  if (text) content.push({ type: 'text', text });
  content.push(...toolUses);
  return { text, toolUses, content, stopReason };
}

/** Human-readable status line shown to the user during a tool call. */
function toolStatusText(name, input) {
  if (name === 'fetch_world_bank') {
    const ind = input.indicator ?? '';
    const cc  = Array.isArray(input.countries) ? input.countries.join(', ') : (input.country ?? '');
    return `Fetching World Bank data (${ind}${cc ? ' · ' + cc : ''})…`;
  }
  if (name === 'fetch_imf') {
    const ind = input.indicator ?? input.series ?? '';
    const cc  = Array.isArray(input.countries) ? input.countries.join(', ') : '';
    return `Fetching IMF data (${ind}${cc ? ' · ' + cc : ''})…`;
  }
  if (name === 'fetch_fred') return `Fetching FRED data (${input.series_id ?? ''})…`;
  return 'Fetching economic data…';
}

// ── Generic system prompts (no hardcoded country) ──────────────────────────────

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

// ── API Routes ───────────────────────────────────────────────────────────────

// Marker Claude writes to separate plain-text insight from the JSON chart blob.
const CHARTS_MARKER = 'CHARTS_DATA:';

app.post('/api/chat', apiLimiter, async (req, res) => {
  const body = validate(ChatSchema, req.body, res);
  if (!body) return;
  let { messages } = body;

  messages = messages.slice(-MAX_HISTORY);

  // ── Set SSE headers ──────────────────────────────────────────────────────────
  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // disable nginx/Railway response buffering
  res.flushHeaders();

  // Cache check — keyed on the full conversation so the same sequence of
  // messages always returns the same response (within the same calendar year).
  const isSingleTurn = messages.length === 1;
  const ck = await cacheKey('/chat', messages);
  if (ck) {
    const cached = apiCache.get(ck);
    if (cached) {
      if (IS_DEV) console.log('[cache hit] /api/chat');
      sseWrite(res, 'done', { result: cached });
      res.end();
      return;
    }
  }

  // Inject recent news as qualitative context only (not for generating chart data)
  let fetchedNewsSources = [];
  const lastUserMsg = [...messages].reverse().find(m => m.role === 'user');
  if (lastUserMsg) {
    try {
      const recentNews = await fetchVerifiedNews(lastUserMsg.content.slice(0, 200));
      if (recentNews.length > 0) {
        lastUserMsg.content += `\n\nRecent News Context (qualitative only — fetch real data via tools for charts):\n${JSON.stringify(recentNews)}`;
        fetchedNewsSources = recentNews.map(a => ({ title: `${a.source}: ${a.title}`, url: a.url }));
      }
    } catch (e) {
      console.error('News fetch error in /api/chat:', e.message);
    }
  }

  const availableTools = process.env.FRED_API_KEY
    ? DATA_TOOLS
    : DATA_TOOLS.filter(t => t.name !== 'fetch_fred');

  // ── Agentic streaming loop ───────────────────────────────────────────────────
  const MAX_DATA_TURNS = 6;
  let loopMessages = [...messages];
  let finalText = '';
  const verifiedIndicators = new Set();
  const kagiSources = [];
  if (KAGI_API_KEY) {
    try {
      const kagiPrompt = buildKagiChatPrompt(messages, fetchedNewsSources);
      const kagi = await callKagi('/fastgpt', {
        method: 'POST',
        body: { query: kagiPrompt, cache: true },
      });
      const refs = Array.isArray(kagi?.data?.references) ? kagi.data.references : [];
      for (const ref of refs) {
        if (!ref?.url) continue;
        if (!kagiSources.find(s => s.url === ref.url)) {
          kagiSources.push({ title: ref.title || ref.url, url: ref.url });
        }
      }
    } catch (e) {
      console.error('/api/chat Kagi enrichment error:', e.message);
    }
  }

  try {
    for (let turn = 0; turn < MAX_DATA_TURNS; turn++) {
      // Per-turn streaming state: forward insight text tokens to client,
      // stopping when the CHARTS_DATA: marker is encountered.
      let turnText   = '';
      let forwarded  = 0;   // chars of turnText already sent as 'text' events
      let markerPos  = -1;  // index of CHARTS_DATA: in turnText, or -1

      const onDelta = (delta) => {
        turnText += delta;
        if (markerPos !== -1) return; // past the marker — buffer silently

        const mi = turnText.indexOf(CHARTS_MARKER);
        if (mi !== -1) {
          markerPos = mi;
          // Forward all insight text before the marker
          if (mi > forwarded) sseWrite(res, 'text', { delta: turnText.slice(forwarded, mi) });
          forwarded = mi;
        } else {
          // Forward chars that can't be part of a split marker (keep a small look-behind buffer)
          const safeEnd = Math.max(forwarded, turnText.length - CHARTS_MARKER.length);
          if (safeEnd > forwarded) {
            sseWrite(res, 'text', { delta: turnText.slice(forwarded, safeEnd) });
            forwarded = safeEnd;
          }
        }
      };

      const { toolUses, content, stopReason } = await streamAnthropicTurn(
        { model: MODEL, max_tokens: 64000, temperature: 0, system: buildVerifiedChatSystem(), tools: availableTools, messages: loopMessages },
        onDelta,
      );

      if (toolUses.length === 0 || stopReason === 'end_turn') {
        // Final turn — flush any insight text not yet forwarded
        const mi = markerPos !== -1 ? markerPos : turnText.indexOf(CHARTS_MARKER);
        if (mi !== -1) {
          if (mi > forwarded) sseWrite(res, 'text', { delta: turnText.slice(forwarded, mi) });
        } else if (forwarded < turnText.length) {
          sseWrite(res, 'text', { delta: turnText.slice(forwarded) });
        }
        finalText = turnText;
        break;
      }

      // Tool call turn — execute tools and report status to the client
      const toolResults = [];
      for (const tu of toolUses) {
        sseWrite(res, 'status', { text: toolStatusText(tu.name, tu.input) });
        let resultContent;
        try {
          resultContent = await executeDataTool(tu.name, tu.input);
          const toolData = JSON.parse(resultContent);
          if (Array.isArray(toolData.rows) && toolData.rows.length > 0) {
            const key = tu.input.indicator ?? tu.input.series_id ?? tu.name;
            verifiedIndicators.add(key);
          }
          if (IS_DEV) console.log(`[data tool] ${tu.name}`, tu.input, `→ ${toolData.rows?.length ?? 0} rows`);
        } catch (err) {
          console.error(`[data tool error] ${tu.name}:`, err.message);
          resultContent = JSON.stringify({ error: err.message, rows: [] });
        }
        toolResults.push({ type: 'tool_result', tool_use_id: tu.id, content: resultContent });
      }

      loopMessages = [
        ...loopMessages,
        { role: 'assistant', content },
        { role: 'user',      content: toolResults },
      ];
    }

    // ── Parse the response ───────────────────────────────────────────────────
    // Prefer the streaming format (plain-text insight + CHARTS_DATA: JSON).
    // Fall back to the legacy format (full JSON blob) when Claude omits the marker,
    // which can happen on complex queries where Claude outputs verbose markdown first.
    let parsed;
    try {
      const mi = finalText.indexOf(CHARTS_MARKER);

      if (mi !== -1) {
        // New format
        const insightText = finalText.slice(0, mi).trim();
        const chartsRaw   = finalText.slice(mi + CHARTS_MARKER.length).trim();

        let chartsData = {};
        if (chartsRaw) {
          try {
            const clean = chartsRaw.replace(/```json|```/g, '');
            const s = clean.indexOf('{'), e = clean.lastIndexOf('}');
            chartsData = JSON.parse(s !== -1 && e > s ? clean.slice(s, e + 1) : clean);
          } catch { /* leave chartsData empty */ }
        }

        parsed = validateAIResponse({
          insight:   insightText,
          charts:    chartsData.charts    ?? [],
          sources:   chartsData.sources   ?? [],
          followUps: chartsData.followUps ?? [],
        }) ?? { insight: insightText, charts: [], sources: [], followUps: [] };

      } else {
        // Legacy fallback: find the outermost JSON block in the full text
        const stripped = finalText.replace(/```json|```/g, '');
        const start = stripped.indexOf('{');
        const end   = stripped.lastIndexOf('}');
        const jsonStr = start !== -1 && end > start ? stripped.slice(start, end + 1) : stripped.trim();
        const raw = JSON.parse(jsonStr);
        parsed = validateAIResponse(raw) ?? { insight: finalText, charts: [], sources: [], followUps: [] };
      }
    } catch {
      parsed = { insight: finalText, charts: [], sources: [], followUps: [] };
    }

    // ── Strip charts not backed by a real tool result ────────────────────────
    if (verifiedIndicators.size > 0 && Array.isArray(parsed.charts)) {
      const before = parsed.charts.length;
      parsed.charts = parsed.charts.filter(chart => {
        if (!chart._source?.indicator) return false;
        const ind = chart._source.indicator;
        return [...verifiedIndicators].some(k => ind === k || ind.includes(k) || k.includes(ind));
      });
      const removed = before - parsed.charts.length;
      if (removed > 0) {
        console.warn(`[verified-data] stripped ${removed} chart(s) with no matching real tool result`);
        if (parsed.charts.length === 0) {
          parsed.insight += ' ⚠ Some charts could not be shown because the underlying data could not be fetched from the official API — no estimated values are displayed.';
        }
      }
    } else if (verifiedIndicators.size === 0 && (parsed.charts ?? []).length > 0) {
      console.warn('[verified-data] no real data fetched — stripping all charts');
      parsed.charts = [];
      parsed.insight += ' ⚠ Charts are not shown because no data could be fetched from the official APIs (World Bank, IMF). Check that the APIs are reachable, or add a FRED_API_KEY environment variable for US data.';
    }

    // Merge Kagi + news source citations
    const existingUrls = new Set((parsed.sources || []).map(s => s.url).filter(Boolean));
    for (const ks of kagiSources) {
      if (ks.url && !existingUrls.has(ks.url)) {
        parsed.sources = [...(parsed.sources || []), ks];
        existingUrls.add(ks.url);
      }
    }
    for (const ns of fetchedNewsSources) {
      if (ns.url && !existingUrls.has(ns.url)) {
        parsed.sources = [...(parsed.sources || []), ns];
        existingUrls.add(ns.url);
      }
    }

    apiCache.put(ck, parsed, chatCacheTtlMs());
    track(req.user?.id || 'guest', 'chat_sent', {
      message_count:    messages.length,
      charts_returned:  parsed.charts?.length ?? 0,
      has_news_context: fetchedNewsSources.length > 0,
    });

    sseWrite(res, 'done', { result: parsed });
    res.end();
  } catch (e) {
    console.error('/api/chat error:', e.message);
    sseWrite(res, 'error', { message: e.message });
    res.end();
  }
});

app.post('/api/search', apiLimiter, async (req, res) => {
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
    const kagi = await callKagi('/fastgpt', {
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
        error: 'Kagi search returned no output. Claude fallback is disabled.',
      });
    }
  } catch (e) {
    console.error('/api/search Kagi error:', e.message);
    return res.status(502).json({
      error: 'Kagi search failed. Claude fallback is disabled.',
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

app.post('/api/analyze-csv', apiLimiter, async (req, res) => {
  const body = validate(AnalyzeCsvSchema, req.body, res);
  if (!body) return;
  let { headers, rows, context } = body;
  context = context ?? '';

  const sample  = rows.slice(0, CSV_SAMPLE_ROWS);
  const csvText = [headers.join(','), ...sample.map(r => headers.map(h => String(r[h] ?? '')).join(','))].join('\n');

  const prompt = `Analyze this dataset and generate 2-3 meaningful charts.

Dataset info: ${rows.length} rows × ${headers.length} columns
Columns: ${headers.join(', ')}
User context: ${context || 'No additional context provided.'}

Data sample (first ${sample.length} rows):
\`\`\`csv
${csvText}
\`\`\`

Respond ONLY with valid JSON (no markdown code block wrapper):
{
  "insight": "2-3 sentence expert analysis of what this data reveals",
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
  "sources": ["Uploaded CSV — ${rows.length} rows"],
  "followUps": ["Follow-up 1","Follow-up 2","Follow-up 3"]
}

Rules:
- Use EXACT column names from the CSV as object keys
- Include REAL data values from the CSV, not invented numbers
- For pie charts: data items must have 'name' and 'value' keys
- For time-series: sort data by the time/date column ascending
- Colors: #00AAFF, #F59E0B, #10B981, #EF4444, #8B5CF6, #F97316, #06B6D4`;

  try {
    const data = await callAnthropic({
      model: MODEL, max_tokens: 4000, temperature: 0,
      system: CSV_SYSTEM,
      messages: [{ role: 'user', content: prompt }],
    });
    const txt  = data.content?.map(b => b.text || '').join('') || '{}';
    let parsed;
    try {
      const raw = JSON.parse(txt.replace(/```json|```/g, '').trim());
      parsed = validateAIResponse(raw) ?? { insight: txt, charts: [], sources: [{ title: 'Uploaded CSV', url: null }], followUps: [] };
    } catch {
      parsed = { insight: txt, charts: [], sources: [{ title: 'Uploaded CSV', url: null }], followUps: [] };
    }
    track(req.user?.id || 'guest', 'csv_analyzed', {
      row_count: rows.length,
      col_count: headers.length,
      charts_returned: parsed.charts?.length ?? 0,
    });
    res.json(parsed);
  } catch (e) {
    console.error('/api/analyze-csv error:', e.message);
    res.status(502).json({ error: e.message });
  }
});

// ── Auth routes ───────────────────────────────────────────────────────────────

/** Revoke the JWT carried by req.user (no-op if token has no jti or already expired). */
function revokeCurrentToken(user) {
  if (!user?.jti || !user?.exp) return;
  stmt.pruneRevokedTokens.run(Date.now());
  stmt.revokeToken.run(user.jti, user.exp * 1000); // exp is in seconds
}

// ── Snapshot routes (analysis freeze + shareable snapshots) ───────────────────

app.get('/api/snapshots', requireAuth, (req, res) => {
  if (req.user.isGuest) return res.json([]);

  const rows = stmt.snapshotsByUser.all(req.user.id);
  res.json(rows.map((row) => mapSnapshotRow(row)));
});

app.post('/api/snapshots', requireAuth, async (req, res) => {
  if (req.user.isGuest) return res.status(403).json({ error: 'Guest users cannot create snapshots' });

  const body = validate(SnapshotCreateSchema, req.body, res);
  if (!body) return;

  const countryCode = normalizeSnapshotCountry(body.countryCode);
  if (!countryCode) {
    return res.status(400).json({ error: `Invalid country code: ${body.countryCode}` });
  }

  const limit = checkPlanLimit(req.user.id, 'snapshots');
  const currentCount = stmt.snapshotsByUser.all(req.user.id).length;
  if (limit.limit !== Number.POSITIVE_INFINITY && currentCount >= limit.limit) {
    return res.status(402).json({ error: `Snapshot limit reached (${limit.limit}). Upgrade your plan for more.` });
  }

  const isPublic = body.isPublic ?? true;
  const payload = body.dataPayload ?? null;
  const title = (body.title || `Snapshot ${countryCode}`).slice(0, 160);
  const description = (body.description || '').trim().slice(0, 1000);
  const now = new Date().toISOString();
  const dataVersion = Number.isFinite(body.dataVersion) ? body.dataVersion : Date.now();
  const id = `snap_${Date.now()}_${randomBytes(4).toString('hex')}`;

  const finalPayload = payload ?? await buildCountryDataset(countryCode).catch((err) => {
    throw err;
  });

  const shareToken = Number(isPublic) === 1 ? randomBytes(8).toString('hex') : null;

  stmt.insertSnapshot.run(
    id,
    req.user.id,
    countryCode,
    null,
    title,
    description,
    JSON.stringify(finalPayload),
    now,
    now,
    dataVersion,
    Number(isPublic) ? 1 : 0,
    shareToken,
  );

  const result = {
    ...mapSnapshotRow({
      id,
      country_code: countryCode,
      session_id: null,
      title,
      description,
      is_public: Number(isPublic) ? 1 : 0,
      share_token: shareToken,
      data_version: dataVersion,
      created_at: now,
      updated_at: now,
      data_payload: JSON.stringify(finalPayload),
    }, { includePayload: true }),
    citation: buildSnapshotCitation({
      country_code: countryCode,
      title,
      data_version: dataVersion,
      created_at: now,
    }, finalPayload),
  };

  res.status(201).json(result);
});

app.get('/api/snapshots/:id', requireAuth, (req, res) => {
  if (req.user.isGuest) return res.status(403).json({ error: 'Guest users cannot view snapshots' });

  const row = stmt.snapshotById.get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Snapshot not found' });
  if (row.user_id !== req.user.id) return res.status(404).json({ error: 'Snapshot not found' });

  const payload = parseSnapshotPayload(row.data_payload);
  res.json({
    ...mapSnapshotRow(row, { includePayload: true }),
    citation: buildSnapshotCitation(row, payload),
  });
});

app.post('/api/snapshots/:id/regenerate', requireAuth, async (req, res) => {
  if (req.user.isGuest) return res.status(403).json({ error: 'Guest users cannot regenerate snapshots' });

  const body = validate(SnapshotRegenerateSchema, req.body, res);
  if (!body) return;

  const row = stmt.snapshotById.get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Snapshot not found' });
  if (row.user_id !== req.user.id) return res.status(404).json({ error: 'Snapshot not found' });

  const previousPayload = parseSnapshotPayload(row.data_payload);
  const countryCode = normalizeSnapshotCountry(row.country_code);
  if (!countryCode) return res.status(400).json({ error: `Invalid country code: ${row.country_code}` });

  try {
    const nextPayload = await buildCountryDataset(countryCode);
    const now = new Date().toISOString();
    const nextVersion = Date.now();
    const nextPayloadText = JSON.stringify(nextPayload);

    stmt.updateSnapshotPayload.run(nextPayloadText, nextVersion, now, row.id, req.user.id);

    const diff = {
      beforeVersion: Number(row.data_version),
      afterVersion: nextVersion,
      forceRefresh: Boolean(body.forceRefresh),
      ...buildSnapshotDiff(previousPayload, nextPayload),
    };

    const updatedRow = {
      ...row,
      data_payload: nextPayloadText,
      data_version: nextVersion,
      updated_at: now,
    };

    res.json({
      snapshot: {
        ...mapSnapshotRow(updatedRow, { includePayload: true }),
        citation: buildSnapshotCitation(updatedRow, nextPayload),
      },
      diff,
    });
  } catch (err) {
    const message = errorMessage(err, `Failed to regenerate snapshot ${req.params.id}`);
    console.error(`/api/snapshots/${req.params.id}/regenerate:`, message);
    res.status(502).json({ error: message });
  }
});

app.get('/api/snapshot/:token', (req, res) => {
  const row = stmt.snapshotByShareToken.get(req.params.token);
  if (!row) return res.status(404).json({ error: 'Snapshot not found' });
  if (Number(row.is_public) !== 1) return res.status(404).json({ error: 'Snapshot is not public' });

  const payload = parseSnapshotPayload(row.data_payload);
  res.json({
    ...mapSnapshotRow(row, { includePayload: true }),
    citation: buildSnapshotCitation(row, payload),
  });
});

// ── Billing / Subscription routes ─────────────────────────────────────────────

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || '';
const STRIPE_PRICE_PRO   = process.env.STRIPE_PRICE_PRO || '';
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || '';

let stripe;
if (STRIPE_SECRET_KEY) {
  const Stripe = (await import('stripe')).default;
  stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: '2024-12-18.acacia' });
}

function getPlanForUser(userId) {
  const sub = stmt.subscriptionByUser.get(userId);
  if (!sub) return 'free';
  if (sub.status !== 'active') return 'free';
  return sub.plan || 'free';
}

app.get('/api/billing/subscription', requireAuth, (req, res) => {
  if (req.user.isGuest) return res.json({ plan: 'free', status: 'active' });
  const sub = stmt.subscriptionByUser.get(req.user.id);
  if (!sub) return res.json({ plan: 'free', status: 'active' });
  res.json({
    plan: sub.plan,
    status: sub.status,
    currentPeriodEnd: sub.current_period_end,
    stripeCustomerId: sub.stripe_customer_id,
  });
});

app.post('/api/billing/create-checkout', requireAuth, async (req, res) => {
  if (req.user.isGuest) return res.status(403).json({ error: 'Please sign up to upgrade' });
  if (!stripe) return res.status(503).json({ error: 'Billing is not configured' });
  if (!STRIPE_PRICE_PRO) return res.status(503).json({ error: 'No Pro plan configured' });

  try {
    let customerId;
    const existing = stmt.subscriptionByUser.get(req.user.id);
    if (existing?.stripe_customer_id) {
      customerId = existing.stripe_customer_id;
    } else {
      const customer = await stripe.customers.create({
        email: req.user.email,
        name: req.user.name,
        metadata: { userId: req.user.id },
      });
      customerId = customer.id;

      if (existing) {
        stmt.updateSubscription.run(existing.plan, existing.status, existing.stripe_subscription_id, existing.current_period_end, new Date().toISOString(), req.user.id);
      } else {
        const id = `sub_${Date.now()}_${randomBytes(4).toString('hex')}`;
        stmt.insertSubscription.run(id, req.user.id, customerId, null, 'free', 'active', null, new Date().toISOString(), new Date().toISOString());
      }
    }

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      payment_method_types: ['card'],
      line_items: [{ price: STRIPE_PRICE_PRO, quantity: 1 }],
      mode: 'subscription',
      success_url: `${req.protocol}://${req.get('host')}/?upgraded=true`,
      cancel_url: `${req.protocol}://${req.get('host')}/?canceled=true`,
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error('Stripe checkout error:', err.message);
    res.status(500).json({ error: 'Failed to create checkout session' });
  }
});

app.post('/api/billing/portal', requireAuth, async (req, res) => {
  if (req.user.isGuest) return res.status(403).json({ error: 'Please sign up first' });
  if (!stripe) return res.status(503).json({ error: 'Billing is not configured' });

  const sub = stmt.subscriptionByUser.get(req.user.id);
  if (!sub?.stripe_customer_id) return res.status(400).json({ error: 'No billing account found' });

  try {
    const session = await stripe.billingPortal.sessions.create({
      customer: sub.stripe_customer_id,
      return_url: `${req.protocol}://${req.get('host')}/`,
    });
    res.json({ url: session.url });
  } catch (err) {
    console.error('Stripe portal error:', err.message);
    res.status(500).json({ error: 'Failed to open billing portal' });
  }
});

app.post('/api/billing/cancel', requireAuth, async (req, res) => {
  if (req.user.isGuest) return res.status(403).json({ error: 'Please sign up first' });
  if (!stripe) return res.status(503).json({ error: 'Billing is not configured' });

  const sub = stmt.subscriptionByUser.get(req.user.id);
  if (!sub?.stripe_subscription_id) return res.status(400).json({ error: 'No active subscription' });

  try {
    await stripe.subscriptions.update(sub.stripe_subscription_id, { cancel_at_period_end: true });
    stmt.updateSubscription.run(sub.plan, 'canceling', sub.stripe_subscription_id, sub.current_period_end, new Date().toISOString(), req.user.id);
    res.json({ status: 'canceling' });
  } catch (err) {
    console.error('Stripe cancel error:', err.message);
    res.status(500).json({ error: 'Failed to cancel subscription' });
  }
});

app.post('/api/billing/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  if (!stripe || !STRIPE_WEBHOOK_SECRET) return res.status(503).json({ error: 'Webhook not configured' });

  const sig = req.headers['stripe-signature'];
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).json({ error: 'Invalid signature' });
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        const customerId = session.customer;
        const subscriptionId = session.subscription;
        const customer = await stripe.customers.retrieve(customerId);
        const userId = customer.metadata?.userId;
        if (!userId) break;
        stmt.updateSubscription.run('pro', 'active', subscriptionId, null, new Date().toISOString(), userId);
        break;
      }
      case 'customer.subscription.updated': {
        const sub = event.data.object;
        const existing = stmt.subscriptionBySubId.get(sub.id);
        if (existing) {
          const periodEnd = sub.current_period_end ? Math.floor(sub.current_period_end) : null;
          stmt.updateSubscription.run(sub.status === 'active' ? existing.plan : 'free', sub.status === 'active' ? 'active' : sub.cancel_at_period_end ? 'canceling' : sub.status, sub.id, periodEnd, new Date().toISOString(), existing.user_id);
        }
        break;
      }
      case 'customer.subscription.deleted': {
        const sub = event.data.object;
        const existing = stmt.subscriptionBySubId.get(sub.id);
        if (existing) {
          stmt.updateSubscription.run('free', 'active', null, null, new Date().toISOString(), existing.user_id);
        }
        break;
      }
    }
  } catch (err) {
    console.error('Webhook handler error:', err.message);
  }

  res.json({ received: true });
});

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

function mapApiKeyRow(row, userPlanLimit) {
  const configuredLimit = Number.isFinite(row.rate_limit) && row.rate_limit > 0 ? row.rate_limit : userPlanLimit;
  const effectiveLimit = Math.min(userPlanLimit, configuredLimit);
  const monthKey = row.month_key || monthBucket();
  const callsThisMonth = row.month_key === monthKey ? row.calls_this_month || 0 : 0;

  return {
    id: row.id,
    name: row.name,
    keyPreview: row.key_preview,
    rateLimit: Number.isFinite(effectiveLimit) ? effectiveLimit : null,
    callsThisMonth,
    callsRemaining: Number.isFinite(effectiveLimit) ? Math.max(effectiveLimit - callsThisMonth, 0) : null,
    monthKey,
    lastUsedAt: row.last_used_at ? new Date(row.last_used_at).toISOString() : null,
    createdAt: row.created_at,
  };
}

function normalizeSnapshotCountry(rawCountryCode) {
  const normalized = normalizeCountryCode(String(rawCountryCode || '').trim());
  if (!normalized) return '';

  const iso2 = toISO2(normalized);
  if (!countries.isValid(iso2)) return '';
  return iso2;
}

function parseSnapshotPayload(raw) {
  if (raw == null) return null;
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function mapSnapshotRow(row, opts = {}) {
  const includePayload = Boolean(opts.includePayload);
  const parsedPayload = includePayload ? parseSnapshotPayload(row.data_payload) : null;

  return {
    id: row.id,
    countryCode: row.country_code,
    sessionId: row.session_id || null,
    title: row.title,
    description: row.description || '',
    isPublic: Number(row.is_public) === 1,
    shareToken: row.share_token || null,
    dataVersion: Number(row.data_version),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(includePayload ? { dataPayload: parsedPayload } : {}),
  };
}

function buildSnapshotCitation(snapshot, payload) {
  const name = (payload && typeof payload.name === 'string' && payload.name.trim()) || snapshot.countryCode;
  const version = Number(snapshot.data_version) || Date.now();
  const publishedYear = new Date(snapshot.created_at || Date.now()).getFullYear();
  const title = snapshot.title || `Snapshot of ${snapshot.country_code}`;
  return `${name}. (${publishedYear}). ${title} [Data set]. EconChart. Data version ${version}.`;
}

function buildSnapshotDiff(previousPayload, nextPayload) {
  const sections = [
    'code',
    'name',
    'flag',
    'region',
    'gdpData',
    'exportData',
    'importData',
    'exportSectors',
    'importPartners',
    'kpis',
    'pieExports',
    'pieImports',
    '_meta',
  ];

  const changedSections = [];
  for (const key of sections) {
    const before = previousPayload?.[key];
    const after = nextPayload?.[key];
    if (JSON.stringify(before) !== JSON.stringify(after)) {
      changedSections.push(key);
    }
  }

  return {
    changedSections,
    changed: changedSections.length > 0,
  };
}

app.get('/api/developer/keys', requireAuth, (req, res) => {
  if (req.user.isGuest) return res.status(403).json({ error: 'Guest users cannot manage API keys' });

  const userLimit = getApiMonthlyLimitForUser(req.user.id);
  const rows = stmt.apiKeysByUser.all(req.user.id).map(row => mapApiKeyRow(row, userLimit));

  res.json({
    planLimit: Number.isFinite(userLimit) ? userLimit : null,
    keys: rows,
  });
});

app.post('/api/developer/keys', requireAuth, (req, res) => {
  if (req.user.isGuest) return res.status(403).json({ error: 'Guest users cannot create API keys' });

  const body = validate(ApiKeyCreateSchema, req.body, res);
  if (!body) return;

  const userLimit = getApiMonthlyLimitForUser(req.user.id);
  const name = (body.name || '').trim() || `API Key ${Date.now()}`;
  const storedLimit = Number.isFinite(userLimit) && userLimit > 0 ? userLimit : 0;
  const raw = `ec_${randomBytes(24).toString('hex')}`;
  const hash = createHash('sha256').update(raw).digest('hex');
  const preview = `${raw.slice(0, 6)}...${raw.slice(-4)}`;
  const id = `key_${Date.now()}_${randomBytes(4).toString('hex')}`;
  const now = new Date().toISOString();
  const monthKey = monthBucket();

  stmt.insertApiKey.run(id, req.user.id, hash, preview, name, storedLimit, 0, monthKey, null, now);

  res.status(201).json({
    id,
    name,
    key: raw,
    keyPreview: preview,
    rateLimit: userLimit,
    callsThisMonth: 0,
    callsRemaining: userLimit,
    createdAt: now,
  });
});

app.delete('/api/developer/keys/:id', requireAuth, (req, res) => {
  if (req.user.isGuest) return res.status(403).json({ error: 'Guest users cannot delete API keys' });

  const params = validate(ApiKeyDeleteSchema, { id: req.params.id }, res);
  if (!params) return;

  const existing = stmt.apiKeyByIdAndUser.get(params.id, req.user.id);
  if (!existing) return res.status(404).json({ error: 'API key not found' });

  stmt.deleteApiKey.run(params.id, req.user.id);
  res.json({ ok: true });
});

// ── Custom metrics routes ─────────────────────────────────────────────────────

app.get('/api/metrics', requireAuth, (req, res) => {
  if (req.user.isGuest) return res.json([]);
  res.json(stmt.metricsByUser.all(req.user.id).map(m => ({
    id: m.id, name: m.name, expression: m.expression, description: m.description,
    createdAt: m.created_at, updatedAt: m.updated_at,
  })));
});

app.post('/api/metrics', requireAuth, (req, res) => {
  if (req.user.isGuest) return res.status(403).json({ error: 'Guest users cannot create custom metrics' });
  const { name, expression, description } = req.body;
  if (!name || !expression) return res.status(400).json({ error: 'Name and expression are required' });
  if (expression.length > 200) return res.status(400).json({ error: 'Expression too long (max 200 chars)' });

  const limit = checkPlanLimit(req.user.id, 'customMetrics');
  const currentCount = stmt.metricsByUser.all(req.user.id).length;
  if (currentCount >= limit.limit) {
    return res.status(402).json({ error: `Custom metric limit reached (${limit.limit}). Upgrade your plan for more.` });
  }

  const id = `metric_${Date.now()}_${randomBytes(4).toString('hex')}`;
  const now = new Date().toISOString();
  stmt.insertMetric.run(id, req.user.id, name.trim(), expression.trim(), (description || '').trim(), now, now);
  res.status(201).json({ id, name, expression, description: description || '', createdAt: now, updatedAt: now });
});

app.patch('/api/metrics/:id', requireAuth, (req, res) => {
  if (req.user.isGuest) return res.status(403).json({ error: 'Guest users cannot modify custom metrics' });
  const { name, expression, description } = req.body;
  const existing = stmt.metricById.get(req.params.id, req.user.id);
  if (!existing) return res.status(404).json({ error: 'Metric not found' });
  const now = new Date().toISOString();
  stmt.updateMetric.run(
    name?.trim() ?? existing.name,
    expression?.trim() ?? existing.expression,
    description?.trim() ?? existing.description,
    now, req.params.id, req.user.id,
  );
  res.json({ id: existing.id, name: name?.trim() ?? existing.name, expression: expression?.trim() ?? existing.expression, updatedAt: now });
});

app.delete('/api/metrics/:id', requireAuth, (req, res) => {
  if (req.user.isGuest) return res.status(403).json({ error: 'Guest users cannot delete custom metrics' });
  stmt.deleteMetric.run(req.params.id, req.user.id);
  res.json({ ok: true });
});



app.post('/api/analytics', requireAuth, apiLimiter, async (req, res) => {
  const body = validate(AnalyticsSchema, req.body, res);
  if (!body) return;
  const { query, context = '' } = body;

  const ck = await cacheKey('/analytics', { query, context: context.slice(0, 500) });
  const cached = apiCache.get(ck);
  if (cached) {
    if (IS_DEV) console.log('[cache hit] /api/analytics');
    return res.json(cached);
  }

  const systemPrompt = `You are an expert econometrician and data scientist specializing in country-level economic analysis.
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
        system: systemPrompt,
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
      system: systemPrompt,
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
// ── MCP SSE server (remote access from Claude Code / other MCP clients) ───────
// Protect with MCP_API_KEY env var (set this in Railway).
// Claude Code config (.mcp.json):
//   { "mcpServers": { "econchart": { "type": "sse", "url": "https://<app>.railway.app/mcp/sse",
//                                    "headers": { "x-mcp-key": "<MCP_API_KEY>" } } } }
const MCP_API_KEY = process.env.MCP_API_KEY; // optional; if unset, endpoint is open
const mcpSessions = new Map(); // sessionId → SSEServerTransport
const mcpAuth = createMcpAuth(MCP_API_KEY);

function createMcpServerInstance() {
  const srv = new McpServer({ name: 'econchart-economic-data', version: '1.0.0' });

  srv.tool('fetch_world_bank',
    'Fetch verified economic indicator data from the World Bank Open Data API for any country. ' +
    'Common indicators: NY.GDP.MKTP.CD (GDP USD), NY.GDP.MKTP.KD.ZG (GDP growth %), ' +
    'NY.GDP.PCAP.CD (GDP per capita), NE.EXP.GNFS.CD (exports USD), NE.IMP.GNFS.CD (imports USD), ' +
    'FP.CPI.TOTL.ZG (inflation), SL.UEM.TOTL.ZS (unemployment).',
    {
      country_codes: z.array(z.string()).min(1).describe('ISO2 codes e.g. ["US","DE"]'),
      indicator:     z.string().describe('World Bank indicator ID e.g. "NY.GDP.MKTP.CD"'),
      start_year:    z.number().int().min(1960).max(2024).default(2000),
      end_year:      z.number().int().min(1960).max(2024).default(2024),
    },
    async ({ country_codes, indicator, start_year, end_year }) => {
      const rows = await fetchWorldBankIndicator(country_codes, indicator, start_year, end_year);
      if (!rows.length) throw new Error(`No World Bank data for ${indicator} / ${country_codes.join(',')}`);
      return { content: [{ type: 'text', text: JSON.stringify({
        rows, source: 'World Bank Open Data', indicator,
        sourceUrl: `https://data.worldbank.org/indicator/${indicator}?locations=${country_codes.join('-')}`,
        count: rows.length,
      }) }] };
    }
  );

  srv.tool('fetch_imf',
    'Fetch IMF DataMapper indicator data. Uses ISO3 country codes. ' +
    'Common indicators: NGDPD (GDP USD bn), NGDP_RPCH (GDP growth %), NGDPDPC (GDP per capita), ' +
    'PCPIPCH (inflation %), LUR (unemployment %), GGXWDG_NGDP (govt debt % GDP). ' +
    'NOTE: trade indicators TXG_RPCH/TMG_RPCH are growth rates NOT absolute values.',
    {
      indicator:     z.string().describe('IMF indicator code e.g. "NGDPD"'),
      country_codes: z.array(z.string()).min(1).describe('ISO3 codes e.g. ["USA","DEU"]'),
    },
    async ({ indicator, country_codes }) => {
      const rows = await fetchIMFIndicator(indicator, country_codes);
      if (!rows.length) throw new Error(`No IMF data for ${indicator} / ${country_codes.join(',')}`);
      return { content: [{ type: 'text', text: JSON.stringify({
        rows, source: 'IMF DataMapper', indicator,
        sourceUrl: `https://www.imf.org/external/datamapper/${indicator}`,
        count: rows.length,
      }) }] };
    }
  );

  srv.tool('fetch_fred',
    'Fetch US economic series from FRED (Federal Reserve Bank of St. Louis). Requires FRED_API_KEY. ' +
    'Common series: GDP, GDPC1, UNRATE, CPIAUCSL, FEDFUNDS, DGS10.',
    {
      series_id:  z.string().describe('FRED series ID e.g. "GDP"'),
      start_year: z.number().int().min(1950).max(2024).default(2000),
      end_year:   z.number().int().min(1950).max(2024).default(2024),
    },
    async ({ series_id, start_year, end_year }) => {
      const rows = await fetchFREDSeries(series_id, start_year, end_year);
      if (!rows.length) throw new Error(`No FRED data for series ${series_id}`);
      return { content: [{ type: 'text', text: JSON.stringify({
        rows, source: 'FRED (Federal Reserve Bank of St. Louis)', series_id,
        sourceUrl: `https://fred.stlouisfed.org/series/${series_id}`,
        count: rows.length,
      }) }] };
    }
  );

  return srv;
}

// GET /mcp/sse — client opens SSE stream
app.get('/mcp/sse', mcpAuth, async (req, res) => {
  const transport = new SSEServerTransport('/mcp/message', res);
  mcpSessions.set(transport.sessionId, transport);
  req.on('close', () => mcpSessions.delete(transport.sessionId));
  const srv = createMcpServerInstance();
  await srv.connect(transport);
});

// POST /mcp/message — client sends JSON-RPC messages
app.post('/mcp/message', mcpAuth, express.json(), async (req, res) => {
  const transport = mcpSessions.get(req.query.sessionId);
  if (!transport) return res.status(404).json({ error: 'MCP session not found' });
  await transport.handlePostMessage(req, res);
});

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
