import 'dotenv/config';
import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { createHash, randomBytes } from 'crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { verifyToken as verifyClerkToken } from '@clerk/backend';
import Database from 'better-sqlite3';
import { mkdirSync } from 'fs';
import countries from 'i18n-iso-countries';
import { PostHog } from 'posthog-node';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { z } from 'zod';

import enLocale from 'i18n-iso-countries/langs/en.json' with { type: 'json' };
import {
  validate,
  ChatSchema, SearchSchema, AnalyzeCsvSchema, AnalyticsSchema,
  RegisterSchema, LoginSchema, ChangePasswordSchema, DeleteAccountSchema,
  ForgotPasswordSchema, ResetPasswordSchema,
  CreateSessionSchema, UpdateSessionSchema,
  CountrySearchQuerySchema,
} from './schemas.js';

countries.registerLocale(enLocale);
const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Configuration ─────────────────────────────────────────────────────────────
const PORT              = process.env.PORT || 3000;
const MODEL             = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6';
const ANTHROPIC_BASE    = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const IS_DEV            = process.env.NODE_ENV !== 'production';
const CLERK_SECRET_KEY  = process.env.CLERK_SECRET_KEY;
const CLERK_JWT_KEY     = process.env.CLERK_JWT_KEY;
const CLERK_AUTH_ENABLED = Boolean(CLERK_SECRET_KEY || CLERK_JWT_KEY);
const NEWS_API_KEY      = process.env.NEWS_API_KEY;
const TRUSTED_NEWS_DOMAINS = 'reuters.com,bloomberg.com,ft.com,wsj.com,economist.com,apnews.com';

// ── Kimi 2.5 canonicalization ─────────────────────────────────────────────────
const KIMI_API_KEY = process.env.KIMI_API_KEY;
const KIMI_BASE    = 'https://api.moonshot.cn/v1/chat/completions';
const KIMI_MODEL   = process.env.KIMI_MODEL || 'moonshot-v1-8k';

// LRU cache
const CACHE_CAP         = 200;
const TTL_SEARCH_MS     = 30 * 60 * 1000;

// Chat cache TTL: expires at midnight UTC on Jan 1 of the NEXT calendar year.
// This means the same question returns the same answer all year, then resets when
// new annual data becomes available.
function chatCacheTtlMs() {
  const now  = new Date();
  const flip = Date.UTC(now.getUTCFullYear() + 1, 0, 1); // Jan 1 next year, 00:00 UTC
  return flip - Date.now();
}

// Rate limiting
const RL_WINDOW_MS      = 15 * 60 * 1000;
const RL_MAX            = 20;

// Input sanitization limits
const MAX_HISTORY       = 40;
const MAX_MSG_CHARS     = 12_000;
const MAX_QUERY_CHARS   = 1_000;
const MAX_CSV_COLS      = 50;
const MAX_CSV_ROWS      = 500;
const MAX_CONTEXT_CHARS = 2_000;
const CSV_SAMPLE_ROWS   = 30;
const MAX_SEARCH_TURNS  = 8;
const ANTHROPIC_TIMEOUT_MS        = 55_000;  // non-streaming calls
const ANTHROPIC_STREAM_TIMEOUT_MS = 180_000; // streaming: allow up to 3 min for large responses

// Auth
const JWT_SECRET     = process.env.JWT_SECRET || 'dev-secret-change-in-production';
const BCRYPT_ROUNDS  = 10;

// Database
const DB_PATH = process.env.DB_PATH || join(__dirname, 'data', 'econChart.db');

// Country cache TTL
const COUNTRY_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
// ─────────────────────────────────────────────────────────────────────────────

if (!ANTHROPIC_API_KEY) {
  console.error('ERROR: ANTHROPIC_API_KEY environment variable is not set.');
  process.exit(1);
}

// ── PostHog telemetry ─────────────────────────────────────────────────────────
const ph = process.env.POSTHOG_API_KEY
  ? new PostHog(process.env.POSTHOG_API_KEY, { host: 'https://us.i.posthog.com', flushAt: 20, flushInterval: 10_000 })
  : null;

/** Fire-and-forget event. distinctId is the user's DB id or 'guest'. */
function track(distinctId, event, properties = {}) {
  if (!ph) return;
  ph.capture({ distinctId: String(distinctId), event, properties });
}

if (ph) {
  process.on('SIGTERM', async () => { await ph.shutdown(); process.exit(0); });
  process.on('SIGINT',  async () => { await ph.shutdown(); process.exit(0); });
}
// ─────────────────────────────────────────────────────────────────────────────

if (!process.env.JWT_SECRET && !IS_DEV) {
  console.error('ERROR: JWT_SECRET environment variable is not set in production.');
  process.exit(1);
}

// ── LRU Cache ─────────────────────────────────────────────────────────────────
class LRUNode {
  constructor(key, value, ttlMs) {
    this.key       = key;
    this.value     = value;
    this.expiresAt = Date.now() + ttlMs;
    this.prev      = null;
    this.next      = null;
  }
}

class LRUCache {
  constructor(capacity) {
    this.capacity = capacity;
    this.map      = new Map();
    this.head = new LRUNode(null, null, Infinity);
    this.tail = new LRUNode(null, null, Infinity);
    this.head.next = this.tail;
    this.tail.prev = this.head;
  }

  _detach(node) {
    node.prev.next = node.next;
    node.next.prev = node.prev;
  }

  _attachFront(node) {
    node.next           = this.head.next;
    node.prev           = this.head;
    this.head.next.prev = node;
    this.head.next      = node;
  }

  get(key) {
    const node = this.map.get(key);
    if (!node) return null;
    if (Date.now() > node.expiresAt) {
      this._detach(node);
      this.map.delete(key);
      return null;
    }
    this._detach(node);
    this._attachFront(node);
    return node.value;
  }

  put(key, value, ttlMs) {
    if (this.map.has(key)) {
      this._detach(this.map.get(key));
      this.map.delete(key);
    }
    const node = new LRUNode(key, value, ttlMs);
    this._attachFront(node);
    this.map.set(key, node);
    if (this.map.size > this.capacity) {
      const lru = this.tail.prev;
      this._detach(lru);
      this.map.delete(lru.key);
    }
  }

  get size() { return this.map.size; }
}

const apiCache   = new LRUCache(CACHE_CAP);
const canonCache = new LRUCache(2000); // stores Kimi canonical strings, 7-day TTL
// Shared raw API response cache — ensures chat and country endpoints always see the same data
const rawDataCache  = new LRUCache(500);
const RAW_DATA_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days, same as country SQLite cache

// ── SQLite database ────────────────────────────────────────────────────────────
mkdirSync(join(__dirname, 'data'), { recursive: true });
const db = new Database(DB_PATH);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS country_cache (
    code       TEXT PRIMARY KEY,
    data_json  TEXT NOT NULL,
    cached_at  INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS users (
    id              TEXT PRIMARY KEY,
    email           TEXT UNIQUE NOT NULL,
    name            TEXT NOT NULL,
    hashed_password TEXT NOT NULL,
    created_at      TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS chat_sessions (
    id         TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title      TEXT NOT NULL,
    messages   TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON chat_sessions(user_id);

  CREATE TABLE IF NOT EXISTS password_reset_tokens (
    token      TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL,
    used       INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS revoked_tokens (
    jti        TEXT PRIMARY KEY,
    expires_at INTEGER NOT NULL
  );
`);

// ── Prepared statements ──────────────────────────────────────────────────────
const stmtCountry = {
  get:    db.prepare('SELECT data_json, cached_at FROM country_cache WHERE code = ?'),
  upsert: db.prepare('INSERT OR REPLACE INTO country_cache (code, data_json, cached_at) VALUES (?, ?, ?)'),
  del:    db.prepare('DELETE FROM country_cache WHERE code = ?'),
};

const stmt = {
  userByEmail:     db.prepare('SELECT * FROM users WHERE email = ?'),
  userById:        db.prepare('SELECT id, email, name FROM users WHERE id = ?'),
  insertUser:      db.prepare('INSERT INTO users (id, email, name, hashed_password, created_at) VALUES (?, ?, ?, ?, ?)'),
  sessionsByUser:  db.prepare('SELECT id, title, created_at, updated_at FROM chat_sessions WHERE user_id = ? ORDER BY updated_at DESC'),
  sessionById:     db.prepare('SELECT * FROM chat_sessions WHERE id = ? AND user_id = ?'),
  insertSession:   db.prepare('INSERT INTO chat_sessions (id, user_id, title, messages, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'),
  updateSession:   db.prepare('UPDATE chat_sessions SET messages = ?, title = ?, updated_at = ? WHERE id = ? AND user_id = ?'),
  deleteSession:   db.prepare('DELETE FROM chat_sessions WHERE id = ? AND user_id = ?'),
  userByIdFull:    db.prepare('SELECT * FROM users WHERE id = ?'),
  updatePassword:  db.prepare('UPDATE users SET hashed_password = ? WHERE id = ?'),
  deleteUser:      db.prepare('DELETE FROM users WHERE id = ?'),
  sessionMessages: db.prepare('SELECT messages FROM chat_sessions WHERE user_id = ?'),
  insertResetToken:        db.prepare('INSERT INTO password_reset_tokens (token, user_id, expires_at, used) VALUES (?, ?, ?, 0)'),
  getResetToken:           db.prepare('SELECT * FROM password_reset_tokens WHERE token = ? AND used = 0'),
  markResetTokenUsed:      db.prepare('UPDATE password_reset_tokens SET used = 1 WHERE token = ?'),
  deleteExpiredResetTokens: db.prepare('DELETE FROM password_reset_tokens WHERE expires_at < ?'),
  revokeToken:             db.prepare('INSERT OR IGNORE INTO revoked_tokens (jti, expires_at) VALUES (?, ?)'),
  isTokenRevoked:          db.prepare('SELECT 1 FROM revoked_tokens WHERE jti = ?'),
  pruneRevokedTokens:      db.prepare('DELETE FROM revoked_tokens WHERE expires_at < ?'),
};

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

async function requireAuth(req, res, next) {
  const auth  = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) return res.status(401).json({ error: 'Authentication required' });

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    if (payload.jti && stmt.isTokenRevoked.get(payload.jti)) {
      return res.status(401).json({ error: 'Token has been revoked' });
    }
    req.user = payload;
    return next();
  } catch {
    if (!CLERK_AUTH_ENABLED) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    try {
      const verified = await verifyClerkToken(token, {
        ...(CLERK_SECRET_KEY ? { secretKey: CLERK_SECRET_KEY } : {}),
        ...(CLERK_JWT_KEY ? { jwtKey: CLERK_JWT_KEY } : {}),
      });

      req.user = {
        id: verified.sub,
        email: verified.email || '',
        name: verified.name || 'User',
        isGuest: false,
        iat: verified.iat,
        exp: verified.exp,
        isClerkUser: true,
      };

      try {
        ensureClerkUserRecord(req.user);
      } catch (e) {
        console.error('Failed to provision Clerk user record:', e.message);
        return res.status(500).json({ error: 'Unable to initialize user profile' });
      }

      return next();
    } catch {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }
  }
}

function iso2ToFlag(code) {
  return [...code.toUpperCase()]
    .map(c => String.fromCodePoint(c.charCodeAt(0) - 65 + 0x1F1E6))
    .join('');
}

function errorMessage(err, fallback = 'Unexpected error') {
  return err instanceof Error && err.message ? err.message : fallback;
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

const apiLimiter = rateLimit({
  windowMs: RL_WINDOW_MS,
  max:      RL_MAX,
  standardHeaders: true,
  legacyHeaders:   false,
  message: { error: 'Too many requests. Please wait a few minutes and try again.' },
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max:      10,
  standardHeaders: true,
  legacyHeaders:   false,
  message: { error: 'Too many authentication attempts. Please wait 15 minutes and try again.' },
});

const staticLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max:      200,
  standardHeaders: true,
  legacyHeaders:   false,
  message: { error: 'Too many requests.' },
});

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

// ── SSE + streaming helpers ────────────────────────────────────────────────────

/** Write a named SSE event with JSON payload. */
function sseWrite(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

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

    // Merge news source citations
    const existingUrls = new Set((parsed.sources || []).map(s => s.url).filter(Boolean));
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
  const { query } = body;

  const ck = await cacheKey('/search', { query });
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

  try {
    const newsPrefix = searchNewsSources.length > 0
      ? `Recent news context (use these to inform your answer and cite them):\n${JSON.stringify(searchNewsSources.map(s => s.title))}\n\nQuestion: `
      : '';
    const msgs = [{ role: 'user', content: newsPrefix + query }];
    for (let turn = 0; turn < MAX_SEARCH_TURNS; turn++) {
      const data = await callAnthropic(
        { model: MODEL, max_tokens: 4000, temperature: 0, system: SEARCH_SYSTEM, tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 5 }], messages: msgs },
        { 'anthropic-beta': 'web-search-2025-03-05' }
      );

      for (const blk of data.content || []) {
        if (blk.type === 'text') { text = blk.text; webSearchUsed = true; }
        for (const r of (Array.isArray(blk.content) ? blk.content : [])) {
          if (r.url && !sources.find(s => s.url === r.url))
            sources.push({ title: r.title || r.url, url: r.url });
        }
      }

      if (data.stop_reason === 'end_turn') break;

      if (data.stop_reason === 'tool_use') {
        msgs.push({ role: 'assistant', content: data.content });
        const toolUses = (data.content || []).filter(b => b.type === 'tool_use' || b.type === 'server_tool_use');
        if (!toolUses.length) break;
        msgs.push({ role: 'user', content: toolUses.map(b => ({ type: 'tool_result', tool_use_id: b.id, content: 'Search complete.' })) });
      } else break;
    }
  } catch (_) {
    try {
      const data = await callAnthropic({
        model: MODEL, max_tokens: 4000, temperature: 0,
        system: SEARCH_SYSTEM + '\n\nNote: Web search unavailable. Answer from training knowledge (data up to early 2025). Clearly note when figures may be outdated.',
        messages: [{ role: 'user', content: query }],
      });
      text    = data.content?.map(b => b.text || '').join('') || '';
      sources = [{ title: 'Claude (training knowledge — may be outdated)', url: null }];
    } catch (e2) {
      console.error('/api/search fallback error:', e2.message);
      return res.status(502).json({ error: e2.message });
    }
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

app.post('/api/auth/logout', requireAuth, (req, res) => {
  revokeCurrentToken(req.user);
  track(req.user.id, 'user_logged_out');
  res.json({ ok: true });
});

// Guest access — issues a short-lived JWT without creating a DB record.
// Grants full read access to all AI/country endpoints; sessions are in-memory only.
app.post('/api/auth/guest', authLimiter, (req, res) => {
  const token = jwt.sign(
    { id: 'guest', name: 'Guest', email: '', isGuest: true, jti: randomBytes(16).toString('hex') },
    JWT_SECRET,
    { expiresIn: '24h' }
  );
  track('guest', 'guest_session_started');
  res.json({ token, user: { id: 'guest', name: 'Guest', email: '', isGuest: true } });
});

app.post('/api/auth/register', authLimiter, async (req, res) => {
  const body = validate(RegisterSchema, req.body, res);
  if (!body) return;
  const { email, password, name } = body;
  const em = email.toLowerCase().trim();
  if (stmt.userByEmail.get(em)) return res.status(409).json({ error: 'Email already registered' });
  const hashedPassword = await bcrypt.hash(password, BCRYPT_ROUNDS);
  const id   = `u_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const uname = name.slice(0, 80).trim();
  stmt.insertUser.run(id, em, uname, hashedPassword, new Date().toISOString());
  const token = jwt.sign({ id, email: em, name: uname, jti: randomBytes(16).toString('hex') }, JWT_SECRET, { expiresIn: '7d' });
  if (ph) ph.identify({ distinctId: id, properties: { email: em, name: uname } });
  track(id, 'user_registered', { email: em, name: uname });
  res.json({ token, user: { id, email: em, name: uname } });
});

app.post('/api/auth/login', authLimiter, async (req, res) => {
  const body = validate(LoginSchema, req.body, res);
  if (!body) return;
  const { email, password } = body;
  const em   = email.toLowerCase().trim();
  const user = stmt.userByEmail.get(em);
  if (!user) return res.status(401).json({ error: 'Invalid email or password' });
  const match = await bcrypt.compare(password, user.hashed_password);
  if (!match) return res.status(401).json({ error: 'Invalid email or password' });
  const token = jwt.sign({ id: user.id, email: user.email, name: user.name, jti: randomBytes(16).toString('hex') }, JWT_SECRET, { expiresIn: '7d' });
  track(user.id, 'user_logged_in', { email: user.email });
  res.json({ token, user: { id: user.id, email: user.email, name: user.name } });
});

app.get('/api/auth/me', requireAuth, (req, res) => {
  if (req.user?.isGuest) {
    return res.json({ id: 'guest', name: 'Guest', email: '', isGuest: true });
  }

  if (req.user?.isClerkUser) {
    return res.json({ id: req.user.id, email: req.user.email || '', name: req.user.name || 'User' });
  }

  const user = stmt.userById.get(req.user.id);
  if (!user) return res.status(401).json({ error: 'User not found' });
  return res.json(user);
});

app.get('/api/auth/usage', requireAuth, (req, res) => {
  const user = stmt.userById.get(req.user.id);
  const rows     = stmt.sessionMessages.all(req.user.id);
  const sessionCount = rows.length;
  const messageCount = rows.reduce((sum, r) => {
    try {
      const msgs = JSON.parse(r.messages);
      if (!Array.isArray(msgs)) return sum;
      return sum + msgs.filter(m => m && m.role === 'user').length;
    } catch {
      return sum;
    }
  }, 0);
  const memberSince = user?.created_at
    || (req.user?.iat ? new Date(req.user.iat * 1000).toISOString() : new Date().toISOString());

  return res.json({ sessionCount, messageCount, memberSince });
});

app.patch('/api/auth/password', requireAuth, authLimiter, async (req, res) => {
  if (req.user?.isClerkUser) {
    return res.status(400).json({ error: 'Password is managed by Clerk. Update it from account settings.' });
  }

  const body = validate(ChangePasswordSchema, req.body, res);
  if (!body) return;
  const { currentPassword, newPassword } = body;
  const user = stmt.userByIdFull.get(req.user.id);
  if (!user) return res.status(401).json({ error: 'User not found' });
  const match = await bcrypt.compare(currentPassword, user.hashed_password);
  if (!match) return res.status(401).json({ error: 'Current password is incorrect' });
  const hashed = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
  stmt.updatePassword.run(hashed, req.user.id);
  revokeCurrentToken(req.user);
  res.json({ ok: true });
});

app.delete('/api/auth/account', requireAuth, authLimiter, async (req, res) => {
  if (req.user?.isClerkUser) {
    return res.status(400).json({ error: 'Account deletion is managed by Clerk. Use account settings.' });
  }

  const body = validate(DeleteAccountSchema, req.body, res);
  if (!body) return;
  const { password } = body;
  const user = stmt.userByIdFull.get(req.user.id);
  if (!user) return res.status(401).json({ error: 'User not found' });
  const match = await bcrypt.compare(password, user.hashed_password);
  if (!match) return res.status(401).json({ error: 'Password is incorrect' });
  revokeCurrentToken(req.user);
  stmt.deleteUser.run(req.user.id);
  res.json({ ok: true });
});

// Forgot password — generates a secure reset token (1-hour TTL).
// If SMTP_HOST is configured the link is emailed; otherwise it is returned in
// the response so the feature works in dev / simple deployments without a mail server.
app.post('/api/auth/forgot-password', authLimiter, async (req, res) => {
  const body = validate(ForgotPasswordSchema, req.body, res);
  if (!body) return;
  const em = body.email.toLowerCase().trim();

  // Purge stale tokens first
  stmt.deleteExpiredResetTokens.run(Date.now());

  const user = stmt.userByEmail.get(em);
  // Always return 200 to avoid leaking whether an email is registered
  if (!user) return res.json({ ok: true });

  const token    = randomBytes(32).toString('hex');
  const expiresAt = Date.now() + 60 * 60 * 1000; // 1 hour
  stmt.insertResetToken.run(token, user.id, expiresAt);

  const APP_URL  = process.env.APP_URL || `http://localhost:${PORT}`;
  const resetUrl = `${APP_URL}/?reset=${token}`;

  // If SMTP is configured, send the email; otherwise return the link directly.
  const smtpHost = process.env.SMTP_HOST;
  if (smtpHost) {
    try {
      const nodemailer = await import('nodemailer');
      const transporter = nodemailer.default.createTransport({
        host:   smtpHost,
        port:   Number(process.env.SMTP_PORT  || 587),
        secure: process.env.SMTP_SECURE === 'true',
        auth:   { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
      });
      await transporter.sendMail({
        from:    process.env.SMTP_FROM || `"EconChart" <noreply@${smtpHost}>`,
        to:      em,
        subject: 'Reset your EconChart password',
        text:    `Click the link below to reset your password (valid for 1 hour):\n\n${resetUrl}\n\nIf you didn't request this, you can ignore this email.`,
        html:    `<p>Click the link below to reset your password (valid for 1 hour):</p><p><a href="${resetUrl}">${resetUrl}</a></p><p>If you didn't request this, you can ignore this email.</p>`,
      });
      return res.json({ ok: true });
    } catch (err) {
      console.error('Failed to send reset email:', err);
      return res.status(500).json({ error: 'Failed to send reset email' });
    }
  }

  // No SMTP configured — return the link so the feature works without a mail server
  res.json({ ok: true, resetUrl });
});

// Reset password — validates the token and sets the new password.
app.post('/api/auth/reset-password', authLimiter, async (req, res) => {
  const body = validate(ResetPasswordSchema, req.body, res);
  if (!body) return;
  const { token, newPassword } = body;

  const row = stmt.getResetToken.get(token);
  if (!row)           return res.status(400).json({ error: 'Invalid or already-used reset link' });
  if (row.expires_at < Date.now()) return res.status(400).json({ error: 'Reset link has expired. Please request a new one.' });

  const hashed = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
  stmt.updatePassword.run(hashed, row.user_id);
  stmt.markResetTokenUsed.run(token);
  res.json({ ok: true });
});

// ── Chat session routes ───────────────────────────────────────────────────────

app.get('/api/sessions', requireAuth, (req, res) => {
  if (req.user.isGuest) return res.json([]);
  res.json(stmt.sessionsByUser.all(req.user.id));
});

app.post('/api/sessions', requireAuth, (req, res) => {
  const body = validate(CreateSessionSchema, req.body, res);
  if (!body) return;
  const title = normalizeSessionTitle(body.title, 'New Chat');
  const id    = `s_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const now   = new Date().toISOString();
  // Guests have no DB record — return a fake session without inserting
  if (!req.user.isGuest) stmt.insertSession.run(id, req.user.id, title, '[]', now, now);
  res.json({ id, userId: req.user.id, title, messages: [], createdAt: now, updatedAt: now });
});

app.get('/api/sessions/:id', requireAuth, (req, res) => {
  if (req.user.isGuest) {
    return res.status(404).json({ error: 'Session not found' });
  }

  const row = stmt.sessionById.get(req.params.id, req.user.id);
  if (!row) return res.status(404).json({ error: 'Session not found' });

  try {
    const parsedMessages = JSON.parse(row.messages);
    return res.json({ ...row, messages: Array.isArray(parsedMessages) ? parsedMessages : [] });
  } catch {
    return res.json({ ...row, messages: [] });
  }
});

app.patch('/api/sessions/:id', requireAuth, (req, res) => {
  const body = validate(UpdateSessionSchema, req.body, res);
  if (!body) return;

  // Guest sessions are in-memory only — acknowledge validated payload with normalized title
  if (req.user.isGuest) {
    return res.json({
      id: req.params.id,
      title: body.title !== undefined ? normalizeSessionTitle(body.title) : 'New Chat',
      updatedAt: new Date().toISOString(),
    });
  }

  const row = stmt.sessionById.get(req.params.id, req.user.id);
  if (!row) return res.status(404).json({ error: 'Session not found' });
  const newMessages = body.messages !== undefined ? JSON.stringify(body.messages) : row.messages;
  const newTitle    = body.title    !== undefined ? normalizeSessionTitle(body.title, row.title) : row.title;
  const now         = new Date().toISOString();
  stmt.updateSession.run(newMessages, newTitle, now, req.params.id, req.user.id);
  res.json({ id: row.id, title: newTitle, updatedAt: now });
});

app.delete('/api/sessions/:id', requireAuth, (req, res) => {
  if (req.user.isGuest) return res.json({ ok: true });

  const row = stmt.sessionById.get(req.params.id, req.user.id);
  if (!row) return res.status(404).json({ error: 'Session not found' });
  stmt.deleteSession.run(req.params.id, req.user.id);
  res.json({ ok: true });
});

// ── Country data routes ───────────────────────────────────────────────────────

app.get('/api/country/history', requireAuth, (req, res) => {
  const rows = db.prepare('SELECT code, data_json, cached_at FROM country_cache ORDER BY cached_at DESC').all();
  const history = rows.map(r => {
    try {
      const d = JSON.parse(r.data_json);
      return { code: d.code, name: d.name, flag: d.flag, region: d.region, cachedAt: r.cached_at };
    } catch { return null; }
  }).filter(Boolean);
  res.json(history);
});

app.get('/api/country/search', requireAuth, apiLimiter, async (req, res) => {
  const query = validate(CountrySearchQuerySchema, req.query, res);
  if (!query) return;
  const q = query.q.trim();

  // Common alternative names → World Bank canonical names
  const ALIASES = {
    'palestine':       'west bank',
    'taiwan':          'taiwan, china',
    'south korea':     'korea, rep',
    'north korea':     'korea, dem',
    'russia':          'russian federation',
    'iran':            'iran, islamic rep',
    'syria':           'syrian arab republic',
    'laos':            'lao pdr',
    'vietnam':         'viet nam',
    'ivory coast':     'côte d\'ivoire',
    'congo':           'congo, dem',
    'czech':           'czechia',
    'slovakia':        'slovak republic',
    'venezuela':       'venezuela, rb',
    'bolivia':         'bolivia',
    'egypt':           'egypt, arab rep',
    'yemen':           'yemen, rep',
    'gambia':          'gambia, the',
    'bahamas':         'bahamas, the',
    'micronesia':      'micronesia, fed',
    'kyrgyzstan':      'kyrgyz republic',
  };
  const qLower = q.toLowerCase();
  const canonicalQ = ALIASES[qLower] ?? qLower;

  try {
    const r    = await fetch('https://api.worldbank.org/v2/country?format=json&per_page=500', { signal: AbortSignal.timeout(10_000) });
    if (!r.ok) throw new Error(`World Bank country list HTTP ${r.status}`);
    const data = await r.json();
    const hits = (data[1] ?? [])
      // region.id === 'NA' marks World Bank aggregates (not sovereign countries)
      .filter(c => c.region?.id !== 'NA' &&
        (c.name.toLowerCase().includes(qLower) || c.name.toLowerCase().includes(canonicalQ)))
      .slice(0, 15)
      .map(c => ({ code: c.iso2Code, name: c.name, flag: iso2ToFlag(c.iso2Code), region: c.region?.value ?? '' }));
    res.json(hits);
  } catch (e) {
    const message = errorMessage(e, 'Failed to fetch country list');
    console.error('/api/country/search:', message);
    res.status(502).json({ error: message });
  }
});

app.get('/api/country/:code', requireAuth, apiLimiter, async (req, res) => {
  const code = req.params.code.toUpperCase().replace(/[^A-Z]/g, '');
  if (code.length !== 2) return res.status(400).json({ error: 'Expected ISO 2-letter country code' });
  
  // Validate with i18n-iso-countries
  if (!countries.isValid(code)) {
    return res.status(400).json({ error: `Unknown country code: ${code}` });
  }
  
  const row = stmtCountry.get.get(code);
  if (row && (Date.now() - row.cached_at) < COUNTRY_CACHE_TTL_MS) {
    try {
      const cached = JSON.parse(row.data_json);
      track(req.user?.id || 'guest', 'country_viewed', { country_code: code, cache_hit: true });
      return res.json(cached);
    } catch {
      stmtCountry.del.run(code);
    }
  }

  try {
    const dataset = await buildCountryDataset(code);
    stmtCountry.upsert.run(code, JSON.stringify(dataset), Date.now());
    track(req.user?.id || 'guest', 'country_viewed', {
      country_code: code,
      country_name: dataset.name,
      cache_hit: false,
      sources: dataset._meta?.sources ?? [],
    });
    res.json(dataset);
  } catch (e) {
    const message = errorMessage(e, 'Failed to build country dataset');
    console.error(`/api/country/${code}:`, message);
    if (row) {
      try {
        const stale = JSON.parse(row.data_json);
        return res.json({ ...stale, _meta: { ...stale._meta, stale: true } });
      } catch {
        stmtCountry.del.run(code);
      }
    }
    res.status(502).json({ error: message });
  }
});

app.post('/api/country/:code/refresh', requireAuth, apiLimiter, async (req, res) => {
  const code = req.params.code.toUpperCase().replace(/[^A-Z]/g, '');
  if (code.length !== 2) return res.status(400).json({ error: 'Expected ISO 2-letter country code' });
  if (!countries.isValid(code)) {
    return res.status(400).json({ error: `Unknown country code: ${code}` });
  }
  
  try {
    const dataset = await buildCountryDataset(code);
    stmtCountry.upsert.run(code, JSON.stringify(dataset), Date.now());
    res.json(dataset);
  } catch (e) {
    const message = errorMessage(e, 'Failed to refresh country dataset');
    console.error(`/api/country/${code}/refresh:`, message);
    res.status(502).json({ error: message });
  }
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

function mcpAuth(req, res, next) {
  if (!MCP_API_KEY) return next();
  if (req.headers['x-mcp-key'] === MCP_API_KEY) return next();
  return res.status(401).json({ error: 'Invalid MCP API key' });
}

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
const DIST = join(__dirname, 'dist');
app.use(staticLimiter);
app.use(express.static(DIST));
app.use((_req, res) => res.sendFile(join(DIST, 'index.html')));

app.listen(PORT, () => {
  console.log(`Economic Dashboard server running on http://localhost:${PORT}`);
  console.log(`Supported countries: ${countries.getNames('en').length} via i18n-iso-countries`);
});
