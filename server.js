import 'dotenv/config';
import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { createHash } from 'crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import Database from 'better-sqlite3';
import { mkdirSync } from 'fs';
import countries from 'i18n-iso-countries';

import enLocale from 'i18n-iso-countries/langs/en.json' with { type: 'json' };

countries.registerLocale(enLocale);
const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Configuration ─────────────────────────────────────────────────────────────
const PORT              = process.env.PORT || 3000;
const MODEL             = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6';
const ANTHROPIC_BASE    = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const IS_DEV            = process.env.NODE_ENV !== 'production';
const NEWS_API_KEY      = process.env.NEWS_API_KEY; 
const TRUSTED_NEWS_DOMAINS = 'reuters.com,bloomberg.com,ft.com,wsj.com,economist.com,apnews.com';

// LRU cache
const CACHE_CAP         = 200;
const TTL_CHAT_MS       = 60 * 60 * 1000;
const TTL_SEARCH_MS     = 30 * 60 * 1000;

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
const ANTHROPIC_TIMEOUT_MS = 55_000;

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

const apiCache = new LRUCache(CACHE_CAP);

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
`);

// ── Prepared statements ──────────────────────────────────────────────────────
const stmtCountry = {
  get:    db.prepare('SELECT data_json, cached_at FROM country_cache WHERE code = ?'),
  upsert: db.prepare('INSERT OR REPLACE INTO country_cache (code, data_json, cached_at) VALUES (?, ?, ?)'),
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
};

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

function cacheKey(endpoint, body) {
  return createHash('sha256').update(endpoint + JSON.stringify(body)).digest('hex');
}

function requireAuth(req, res, next) {
  const auth  = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) return res.status(401).json({ error: 'Authentication required' });
  try { req.user = jwt.verify(token, JWT_SECRET); next(); }
  catch { res.status(401).json({ error: 'Invalid or expired token' }); }
}

function iso2ToFlag(code) {
  return [...code.toUpperCase()]
    .map(c => String.fromCodePoint(c.charCodeAt(0) - 65 + 0x1F1E6))
    .join('');
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
    console.error('Failed to fetch news:', error.message);
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

async function fetchWithRetry(url, options, retries = 2, baseDelay = 1000) {
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetch(url, options);
      if (res.ok) return res;
      if ((res.status === 503 || res.status === 429) && i < retries) {
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
    const url = `${cfg.baseUrl}/country/${code}/indicator/${indicator}?date=2010:2024&format=json&per_page=30`;
    
    const res = await fetchWithRetry(url, { 
      signal: AbortSignal.timeout(cfg.timeout) 
    }, cfg.retries);
    
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
  try {
    const cfg = DATA_SOURCES.imf;
    const indicator = cfg.indicators[indicatorType];
    const iso3 = countries.alpha2ToAlpha3(code);
    if (!iso3) throw new Error(`No ISO3 code for ${code}`);
    
    const url = `${cfg.baseUrl}/${indicator}/${iso3}?periods=2010:2024`;
    
    const res = await fetchWithRetry(url, {
      signal: AbortSignal.timeout(cfg.timeout),
      headers: { 'Accept': 'application/json' },
    }, cfg.retries);
    
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
        signal: AbortSignal.timeout(cfg.timeout),
        headers: { 'Accept': 'application/json' },
      }, cfg.retries);
      
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
  "pieImports": [{"name":"Label","value":X}, ...],
  "digitalPctByYear": {"2010":1.2,"2011":1.4,...}
}

Rules:
1. 5–6 export sectors; last key must be "other".
2. 5–6 import partners/regions; last key must be "other".
3. Values must SUM to match totals for each year (±0.2 rounding OK).
4. "total" field = exactly the provided value.
5. Include ONLY years present in the provided totals.
6. Export sector colors: #F59E0B #94a3b8 #10B981 #8B5CF6 #06B6D4 #64748b
7. Import partner colors: #EF4444 #F59E0B #10B981 #F97316 #8B5CF6 #64748b
8. pieExports/pieImports use the most recent year available.
9. digitalPctByYear: estimate for ALL years 2010–2024 (annual).`;

  const bdRes = await callAnthropic({
    model: MODEL, max_tokens: 4000,
    system: 'Return only valid JSON matching the schema given. No markdown, no explanation.',
    messages: [{ role: 'user', content: breakdownPrompt }],
  });
  const bdText = bdRes.content?.map(b => b.text || '').join('') || '{}';
  let bd;
  try { bd = JSON.parse(bdText.replace(/```json|```/g, '').trim()); }
  catch { throw new Error(`Claude breakdown parse failed for ${code}: ${bdText.slice(0, 200)}`); }

  // Merge digital_pct into gdpData
  const digMap = bd.digitalPctByYear ?? {};
  const gdpDataFinal = gdpData.map(d => ({
    ...d,
    digital_pct: digMap[String(d.year)] != null ? +Number(digMap[String(d.year)]).toFixed(1) : undefined,
  }));

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
  const lastDigPct = digMap[String(lastGDP?.year)];

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
    { label: 'Digital GDP%', value: lastDigPct != null ? `${lastDigPct}%` : 'N/A',
      sub: 'of total GDP', trend: null, color: '#F97316' },
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
        scriptSrc:      ["'self'"],
        styleSrc:       ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc:        ["'self'", 'https://fonts.gstatic.com'],
        connectSrc:     ["'self'"],
        imgSrc:         ["'self'", 'data:'],
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

// ── Generic system prompts (no hardcoded country) ──────────────────────────────

const CHAT_SYSTEM = `You are an expert data analyst and economist with comprehensive knowledge of global economics, international trade, financial markets, macroeconomic policy, and economic history across all countries and regions.

IMPORTANT: The user's message may contain a "Recent Verified News" section with live articles fetched from trusted sources. When present, treat this news as your PRIMARY source of truth for current events and projections — it supersedes your training knowledge. Use it to answer questions about ongoing conflicts, 2025/2026 developments, and current economic conditions. Never refuse to answer based on a knowledge cutoff when live news context has been provided.

When a user asks a question, respond ONLY with a valid JSON object (no markdown, no preamble):
{
  "insight": "2-3 sentence expert analysis. When news context is available, lead with insights drawn directly from those articles and cite specific figures from them.",
  "charts": [
    {
      "id": "unique_id",
      "title": "Chart title",
      "type": "line|bar|area|pie|composed|radar",
      "description": "One sentence description",
      "data": [{"label":"...","value":123}],
      "xKey": "year or label or country",
      "series": [{"key":"fieldname","name":"Display Name","color":"#hex","chartType":"bar|line","stacked":false,"rightAxis":false}]
    }
  ],
  "sources": [
    {"title":"Source name","url":"https://..."}
  ],
  "followUps": ["Follow-up question 1","Follow-up question 2","Follow-up question 3"]
}

Rules:
- 1-3 charts per response. Choose types intelligently: trends->line/area, comparisons->bar, composition->pie, multi-metric->composed
- When news context is provided, build charts using figures and projections from those articles
- When no news context is available, use real, accurate data from your knowledge (World Bank, IMF, UN Comtrade, national statistics, OECD)
- sources: always include the news article URLs provided in context first, then add deep-link dataset URLs. Use these patterns:
  * World Bank indicator: https://data.worldbank.org/indicator/<INDICATOR_CODE>?locations=<ISO2>
    Common codes: NY.GDP.MKTP.CD (GDP), NY.GDP.MKTP.KD.ZG (GDP growth), NY.GDP.PCAP.CD (GDP per capita),
    NE.TRD.GNFS.ZS (trade % GDP), BX.GSR.GNFS.CD (exports), BM.GSR.GNFS.CD (imports)
  * IMF country reports: https://www.imf.org/en/Publications/CR?country=<ISO3>
  * IMF World Economic Outlook: https://www.imf.org/en/Publications/WEO
  * IMF Direction of Trade Statistics: https://data.imf.org/?sk=9d6028d4-f14a-464c-a2f2-59b2cd424b85
  * UN Comtrade: https://comtradeplus.un.org/TradeFlow?Frequency=A&Flows=X&CommodityCodes=TOTAL&Partners=0&Reporters=<ISO3_NUMERIC>&period=<YEAR>&AggregateBy=none&BreakdownMode=plus
  * OECD country data: https://data.oecd.org/<ISO3>.htm
- For pie charts: each data item needs 'name' and 'value'
- Dense data: 8-15 points per chart when possible
- Colors: #00AAFF, #F59E0B, #10B981, #EF4444, #8B5CF6, #F97316, #06B6D4`;

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

// ── API Routes (same as before, using updated CHAT_SYSTEM) ─────────────────────

app.post('/api/chat', apiLimiter, async (req, res) => {
  let { messages } = req.body;
  if (!Array.isArray(messages) || messages.length === 0)
    return res.status(400).json({ error: 'messages array is required' });

  messages = messages.slice(-MAX_HISTORY).map(m => ({
    role:    m.role === 'assistant' ? 'assistant' : 'user',
    content: String(m.content || '').slice(0, MAX_MSG_CHARS),
  }));

  const isSingleTurn = messages.length === 1;
  const ck = isSingleTurn ? cacheKey('/chat', messages) : null;
  if (ck) {
    const cached = apiCache.get(ck);
    if (cached) { if (IS_DEV) console.log('[cache hit] /api/chat'); return res.json(cached); }
  }

  // Fetch news before calling AI, inject as context and retain as explicit sources
  let fetchedNewsSources = [];
  const lastUserMsg = [...messages].reverse().find(m => m.role === 'user');
  if (lastUserMsg) {
    try {
      const recentNews = await fetchVerifiedNews(lastUserMsg.content.slice(0, 200));
      if (recentNews.length > 0) {
        const newsContext = `\n\nRecent Verified News (use these for context and cite them in sources):\n${JSON.stringify(recentNews)}`;
        lastUserMsg.content = lastUserMsg.content + newsContext;
        fetchedNewsSources = recentNews.map(a => ({ title: `${a.source}: ${a.title}`, url: a.url }));
      }
    } catch (e) {
      console.error('News fetch error in /api/chat:', e.message);
    }
  }

  try {
    const data = await callAnthropic({ model: MODEL, max_tokens: 4000, system: CHAT_SYSTEM, messages });
    const text = data.content?.map(b => b.text || '').join('') || '{}';
    let parsed;
    try {
      const raw = JSON.parse(text.replace(/```json|```/g, '').trim());
      parsed = validateAIResponse(raw) ?? { insight: text, charts: [], sources: [], followUps: [] };
    } catch {
      parsed = { insight: text, charts: [], sources: [], followUps: [] };
    }
    // Merge fetched news URLs into sources (deduplicate by URL)
    const existingUrls = new Set((parsed.sources || []).map(s => s.url).filter(Boolean));
    for (const ns of fetchedNewsSources) {
      if (ns.url && !existingUrls.has(ns.url)) {
        parsed.sources = [...(parsed.sources || []), ns];
        existingUrls.add(ns.url);
      }
    }
    if (ck) apiCache.put(ck, parsed, TTL_CHAT_MS);
    res.json(parsed);
  } catch (e) {
    console.error('/api/chat error:', e.message);
    res.status(502).json({ error: e.message });
  }
});

app.post('/api/search', apiLimiter, async (req, res) => {
  const query = String(req.body.query || '').trim().slice(0, MAX_QUERY_CHARS);
  if (!query) return res.status(400).json({ error: 'query is required' });

  const ck = cacheKey('/search', { query });
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
        { model: MODEL, max_tokens: 4000, system: SEARCH_SYSTEM, tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 5 }], messages: msgs },
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
        model: MODEL, max_tokens: 4000,
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
  res.json(result);
});

app.post('/api/analyze-csv', apiLimiter, async (req, res) => {
  let { headers, rows, context } = req.body;
  if (!Array.isArray(headers) || !Array.isArray(rows))
    return res.status(400).json({ error: 'headers and rows arrays are required' });

  headers = headers.slice(0, MAX_CSV_COLS).map(h => String(h).slice(0, 100));
  rows    = rows.slice(0, MAX_CSV_ROWS);
  context = String(context || '').slice(0, MAX_CONTEXT_CHARS);

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
      model: MODEL, max_tokens: 4000,
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
    res.json(parsed);
  } catch (e) {
    console.error('/api/analyze-csv error:', e.message);
    res.status(502).json({ error: e.message });
  }
});

// ── Auth routes ───────────────────────────────────────────────────────────────

// Guest access — issues a short-lived JWT without creating a DB record.
// Grants full read access to all AI/country endpoints; sessions are in-memory only.
app.post('/api/auth/guest', authLimiter, (req, res) => {
  const token = jwt.sign(
    { id: 'guest', name: 'Guest', email: '', isGuest: true },
    JWT_SECRET,
    { expiresIn: '24h' }
  );
  res.json({ token, user: { id: 'guest', name: 'Guest', email: '', isGuest: true } });
});

app.post('/api/auth/register', authLimiter, async (req, res) => {
  const { email, password, name } = req.body;
  if (!email || !password || !name)
    return res.status(400).json({ error: 'email, password, and name are required' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email)))
    return res.status(400).json({ error: 'Invalid email address' });
  if (String(password).length < 8)
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  const em = String(email).toLowerCase().trim();
  if (stmt.userByEmail.get(em)) return res.status(409).json({ error: 'Email already registered' });
  const hashedPassword = await bcrypt.hash(String(password), BCRYPT_ROUNDS);
  const id   = `u_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const uname = String(name).slice(0, 80).trim();
  stmt.insertUser.run(id, em, uname, hashedPassword, new Date().toISOString());
  const token = jwt.sign({ id, email: em, name: uname }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, user: { id, email: em, name: uname } });
});

app.post('/api/auth/login', authLimiter, async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'email and password are required' });
  const em   = String(email).toLowerCase().trim();
  const user = stmt.userByEmail.get(em);
  if (!user) return res.status(401).json({ error: 'Invalid email or password' });
  const match = await bcrypt.compare(String(password), user.hashed_password);
  if (!match) return res.status(401).json({ error: 'Invalid email or password' });
  const token = jwt.sign({ id: user.id, email: user.email, name: user.name }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, user: { id: user.id, email: user.email, name: user.name } });
});

app.get('/api/auth/me', requireAuth, (req, res) => {
  const user = stmt.userById.get(req.user.id);
  if (!user) return res.status(401).json({ error: 'User not found' });
  res.json(user);
});

app.get('/api/auth/usage', requireAuth, (req, res) => {
  const user     = stmt.userById.get(req.user.id);
  if (!user) return res.status(401).json({ error: 'User not found' });
  const rows     = stmt.sessionMessages.all(req.user.id);
  const sessionCount = rows.length;
  const messageCount = rows.reduce((sum, r) => {
    const msgs = JSON.parse(r.messages);
    return sum + msgs.filter(m => m.role === 'user').length;
  }, 0);
  res.json({ sessionCount, messageCount, memberSince: user.created_at });
});

app.patch('/api/auth/password', requireAuth, authLimiter, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword)
    return res.status(400).json({ error: 'currentPassword and newPassword are required' });
  if (String(newPassword).length < 8)
    return res.status(400).json({ error: 'New password must be at least 8 characters' });
  const user = stmt.userByIdFull.get(req.user.id);
  if (!user) return res.status(401).json({ error: 'User not found' });
  const match = await bcrypt.compare(String(currentPassword), user.hashed_password);
  if (!match) return res.status(401).json({ error: 'Current password is incorrect' });
  const hashed = await bcrypt.hash(String(newPassword), BCRYPT_ROUNDS);
  stmt.updatePassword.run(hashed, req.user.id);
  res.json({ ok: true });
});

app.delete('/api/auth/account', requireAuth, authLimiter, async (req, res) => {
  const { password } = req.body;
  if (!password) return res.status(400).json({ error: 'Password confirmation is required' });
  const user = stmt.userByIdFull.get(req.user.id);
  if (!user) return res.status(401).json({ error: 'User not found' });
  const match = await bcrypt.compare(String(password), user.hashed_password);
  if (!match) return res.status(401).json({ error: 'Password is incorrect' });
  stmt.deleteUser.run(req.user.id);
  res.json({ ok: true });
});

// ── Chat session routes ───────────────────────────────────────────────────────

app.get('/api/sessions', requireAuth, (req, res) => {
  if (req.user.isGuest) return res.json([]);
  res.json(stmt.sessionsByUser.all(req.user.id));
});

app.post('/api/sessions', requireAuth, (req, res) => {
  const title = String(req.body.title || 'New Chat').slice(0, 100);
  const id    = `s_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const now   = new Date().toISOString();
  // Guests have no DB record — return a fake session without inserting
  if (!req.user.isGuest) stmt.insertSession.run(id, req.user.id, title, '[]', now, now);
  res.json({ id, userId: req.user.id, title, messages: [], createdAt: now, updatedAt: now });
});

app.get('/api/sessions/:id', requireAuth, (req, res) => {
  const row = stmt.sessionById.get(req.params.id, req.user.id);
  if (!row) return res.status(404).json({ error: 'Session not found' });
  res.json({ ...row, messages: JSON.parse(row.messages) });
});

app.patch('/api/sessions/:id', requireAuth, (req, res) => {
  // Guest sessions are in-memory only — silently acknowledge the update
  if (req.user.isGuest) return res.json({ id: req.params.id, title: '', updatedAt: new Date().toISOString() });
  const row = stmt.sessionById.get(req.params.id, req.user.id);
  if (!row) return res.status(404).json({ error: 'Session not found' });
  const newMessages = Array.isArray(req.body.messages) ? JSON.stringify(req.body.messages) : row.messages;
  const newTitle    = typeof req.body.title === 'string' ? req.body.title.slice(0, 100) : row.title;
  const now         = new Date().toISOString();
  stmt.updateSession.run(newMessages, newTitle, now, req.params.id, req.user.id);
  res.json({ id: row.id, title: newTitle, updatedAt: now });
});

app.delete('/api/sessions/:id', requireAuth, (req, res) => {
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
  const q = String(req.query.q || '').trim().slice(0, 100);
  if (q.length < 2) return res.json([]);

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
    const data = await r.json();
    const hits = (data[1] ?? [])
      // region.id === 'NA' marks World Bank aggregates (not sovereign countries)
      .filter(c => c.region?.id !== 'NA' &&
        (c.name.toLowerCase().includes(qLower) || c.name.toLowerCase().includes(canonicalQ)))
      .slice(0, 15)
      .map(c => ({ code: c.iso2Code, name: c.name, flag: iso2ToFlag(c.iso2Code), region: c.region?.value ?? '' }));
    res.json(hits);
  } catch (e) {
    console.error('/api/country/search:', e.message);
    res.status(502).json({ error: e.message });
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
  if (row && (Date.now() - row.cached_at) < COUNTRY_CACHE_TTL_MS)
    return res.json(JSON.parse(row.data_json));
  
  try {
    const dataset = await buildCountryDataset(code);
    stmtCountry.upsert.run(code, JSON.stringify(dataset), Date.now());
    res.json(dataset);
  } catch (e) {
    console.error(`/api/country/${code}:`, e.message);
    if (row) return res.json({ ...JSON.parse(row.data_json), _meta: { ...JSON.parse(row.data_json)._meta, stale: true } });
    res.status(502).json({ error: e.message });
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
    console.error(`/api/country/${code}/refresh:`, e.message);
    res.status(502).json({ error: e.message });
  }
});

app.post('/api/analytics', requireAuth, apiLimiter, async (req, res) => {
  const query = String(req.body.query || '')
    .trim()
    .slice(0, MAX_MSG_CHARS);
  const context = String(req.body.context || '')
    .trim()
    .slice(0, 8_000);
  if (!query) return res.status(400).json({ error: 'query is required' });

  const ck = cacheKey('/analytics', { query, context: context.slice(0, 500) });
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
      apiCache.put(ck, parsed, TTL_CHAT_MS);
      return res.json(parsed);
    }
  } catch (e) {
    console.error('News fetch or AI error in /api/analytics:', e.message);
  }

  // Fallback: call AI without news context
  const userMessage = context
    ? `Country economic data:\n${context}\n\nUser question: ${query}`
    : query;

  try {
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
      parsed = validateAIResponse(raw) ?? {
        insight: text,
        charts: [],
        sources: [],
        followUps: [],
      };
    } catch {
      parsed = { insight: text, charts: [], sources: [], followUps: [] };
    }
    apiCache.put(ck, parsed, TTL_CHAT_MS);
    res.json(parsed);
  } catch (e) {
    console.error('/api/analytics error:', e.message);
    res.status(502).json({ error: e.message });
  }
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
