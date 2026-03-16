import 'dotenv/config';
import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { createHash } from 'crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Configuration ─────────────────────────────────────────────────────────────
// All tuneable numbers live here — never scattered as inline magic values.
const PORT              = process.env.PORT || 3000;
const MODEL             = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514';
const ANTHROPIC_BASE    = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const IS_DEV            = process.env.NODE_ENV !== 'production';

// LRU cache
const CACHE_CAP         = 200;                // max entries before LRU eviction
const TTL_CHAT_MS       = 60 * 60 * 1000;    // 1 h — chat responses are stable within a session
const TTL_SEARCH_MS     = 30 * 60 * 1000;    // 30 min — web data changes faster

// Rate limiting
const RL_WINDOW_MS      = 15 * 60 * 1000;    // 15-min sliding window
const RL_MAX            = 20;                 // max API calls per window per IP

// Input sanitization limits (prevent excessively large prompts / DoS)
const MAX_HISTORY       = 40;                 // conversation turns kept per request
const MAX_MSG_CHARS     = 12_000;             // per-message content truncation
const MAX_QUERY_CHARS   = 1_000;             // search query cap
const MAX_CSV_COLS      = 50;
const MAX_CSV_ROWS      = 500;
const MAX_CONTEXT_CHARS = 2_000;
const CSV_SAMPLE_ROWS   = 30;                 // rows included in the prompt (keep under ~4k tokens)
const MAX_SEARCH_TURNS  = 8;                  // tool-use loop guard — prevents infinite Anthropic loops
const ANTHROPIC_TIMEOUT_MS = 55_000;          // 55 s — Anthropic's own limit is 60 s

// Auth
const JWT_SECRET     = process.env.JWT_SECRET || 'dev-secret-change-in-production';
const BCRYPT_ROUNDS  = 10;
// ─────────────────────────────────────────────────────────────────────────────

if (!ANTHROPIC_API_KEY) {
  console.error('ERROR: ANTHROPIC_API_KEY environment variable is not set.');
  console.error('Add it to your .env file or set it in your hosting platform.');
  process.exit(1);
}

// ── LRU Cache ─────────────────────────────────────────────────────────────────
// Doubly-linked list + HashMap gives O(1) get and put.
// Evicts the least-recently-used entry when capacity is reached.
// Each entry carries a TTL so stale responses are never served.
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
    this.map      = new Map();         // key → LRUNode
    // Sentinel head/tail — never evicted, simplify boundary pointer updates
    this.head = new LRUNode(null, null, Infinity);
    this.tail = new LRUNode(null, null, Infinity);
    this.head.next = this.tail;
    this.tail.prev = this.head;
  }

  /** Remove a node from its current list position. */
  _detach(node) {
    node.prev.next = node.next;
    node.next.prev = node.prev;
  }

  /** Insert a node immediately after the sentinel head (most-recently-used position). */
  _attachFront(node) {
    node.next           = this.head.next;
    node.prev           = this.head;
    this.head.next.prev = node;
    this.head.next      = node;
  }

  /** O(1) — HashMap lookup + move to MRU position. Returns null on miss or TTL expiry. */
  get(key) {
    const node = this.map.get(key);
    if (!node) return null;
    if (Date.now() > node.expiresAt) {   // expired — evict and return miss
      this._detach(node);
      this.map.delete(key);
      return null;
    }
    this._detach(node);
    this._attachFront(node);
    return node.value;
  }

  /** O(1) — insert or update, then evict LRU tail if over capacity. */
  put(key, value, ttlMs) {
    if (this.map.has(key)) {
      this._detach(this.map.get(key));
      this.map.delete(key);
    }
    const node = new LRUNode(key, value, ttlMs);
    this._attachFront(node);
    this.map.set(key, node);
    if (this.map.size > this.capacity) {  // evict least-recently-used (node before tail)
      const lru = this.tail.prev;
      this._detach(lru);
      this.map.delete(lru.key);
    }
  }

  get size() { return this.map.size; }
}

const apiCache = new LRUCache(CACHE_CAP);

// ── In-memory stores ───────────────────────────────────────────────────────────
// NOTE: These reset on server restart. Replace with a database for production.
const users        = new Map(); // email → { id, email, name, hashedPassword, createdAt }
const chatSessions = new Map(); // sessionId → { id, userId, title, messages, createdAt, updatedAt }
const userSessions = new Map(); // userId → Set<sessionId>

/** Validate and normalize a parsed Claude AIResponse object.
 *  Returns a safe object with correct types, or null if input is not an object.
 *  Normalizes sources to [{title, url}] — handles both old string[] and new object[]. */
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

/** SHA-256 of endpoint + serialized body — deterministic, collision-resistant cache key. */
function cacheKey(endpoint, body) {
  return createHash('sha256').update(endpoint + JSON.stringify(body)).digest('hex');
}

/** Verify Bearer JWT and attach req.user. Returns 401 if missing or invalid. */
function requireAuth(req, res, next) {
  const auth  = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) return res.status(401).json({ error: 'Authentication required' });
  try { req.user = jwt.verify(token, JWT_SECRET); next(); }
  catch { res.status(401).json({ error: 'Invalid or expired token' }); }
}

// ── Express setup ─────────────────────────────────────────────────────────────

const app = express();

// CORS: allowlisted origins — exact-match only (no regex). Covers Vite dev (5173) and
// alternate HMR port (5174). Production serves same-origin so this block is a no-op.
// Override with CORS_ORIGINS env var for non-standard ports (comma-separated).
const DEV_ORIGINS = new Set(
  (process.env.CORS_ORIGINS || 'http://localhost:5173,http://localhost:5174')
    .split(',').map(o => o.trim()).filter(Boolean)
);

app.use((req, res, next) => {
  const origin = req.headers.origin || '';
  if (DEV_ORIGINS.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Max-Age', '600');  // 10 min
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

// Rate limiter: RL_MAX requests per RL_WINDOW_MS per IP.
const apiLimiter = rateLimit({
  windowMs: RL_WINDOW_MS,
  max:      RL_MAX,
  standardHeaders: true,
  legacyHeaders:   false,
  message: { error: 'Too many requests. Please wait a few minutes and try again.' },
});

// Static files can be fetched more frequently than API calls (browsers fan out
// requests for JS/CSS/images), but still need a ceiling against abusive hammering.
const staticLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,  // 1-min window
  max:      200,             // generous for legitimate browser fan-out
  standardHeaders: true,
  legacyHeaders:   false,
  message: { error: 'Too many requests.' },
});

// ── Anthropic helper ──────────────────────────────────────────────────────────

/**
 * POST to the Anthropic Messages API with shared auth headers.
 * Throws on non-2xx so callers can use a single try/catch.
 * @param {object} body         - Request body per Anthropic Messages API spec
 * @param {object} extraHeaders - Additional headers (e.g. beta feature flags)
 * @returns {Promise<object>}   - Parsed JSON response from Anthropic
 */
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

// ── System prompts ────────────────────────────────────────────────────────────
// Kept as named constants so they can be versioned separately from routing logic.

// Instructs Claude to return ONLY a JSON AIResponse — no markdown wrapper.
// Client-side DynChart depends on the exact shape: { insight, charts[], sources[], followUps[] }.
const CHAT_SYSTEM = `You are an expert data analyst and economist with comprehensive knowledge of global economics, international trade, financial markets, macroeconomic policy, and economic history across all countries and regions.

When a user asks a question, respond ONLY with a valid JSON object (no markdown, no preamble):
{
  "insight": "2-3 sentence expert analysis",
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
    {"title":"World Bank – Kazakhstan GDP","url":"https://data.worldbank.org/indicator/NY.GDP.MKTP.CD?locations=KZ"},
    {"title":"IMF – Kazakhstan Article IV","url":"https://www.imf.org/en/Publications/CR?country=KAZ"}
  ],
  "followUps": ["Follow-up question 1","Follow-up question 2","Follow-up question 3"]
}

Rules:
- 1-3 charts per response. Choose types intelligently: trends->line/area, comparisons->bar, composition->pie, multi-metric->composed
- Use real, accurate data from your knowledge (World Bank, IMF, UN Comtrade, stat.gov.kz, OECD)
- sources: array of {title, url} where url is the DEEPEST possible link to the exact dataset or report page — never just a homepage. Use these known deep-link patterns:
  * World Bank indicator: https://data.worldbank.org/indicator/<INDICATOR_CODE>?locations=KZ
    Common codes: NY.GDP.MKTP.CD (GDP), NY.GDP.MKTP.KD.ZG (GDP growth), NY.GDP.PCAP.CD (GDP per capita),
    NE.TRD.GNFS.ZS (trade % GDP), BX.GSR.GNFS.CD (exports), BM.GSR.GNFS.CD (imports)
  * IMF country reports: https://www.imf.org/en/Publications/CR?country=KAZ
  * IMF World Economic Outlook data: https://www.imf.org/en/Publications/WEO
  * IMF Direction of Trade Statistics: https://data.imf.org/?sk=9d6028d4-f14a-464c-a2f2-59b2cd424b85
  * UN Comtrade: https://comtradeplus.un.org/TradeFlow?Frequency=A&Flows=X&CommodityCodes=TOTAL&Partners=0&Reporters=398&period=2023&AggregateBy=none&BreakdownMode=plus
  * Kazakhstan Bureau of Statistics: https://stat.gov.kz/en/industries/economy/national-accounts/
  * Kazakhstan National Bank: https://www.nationalbank.kz/en/page/statistics
  * OECD Kazakhstan: https://data.oecd.org/kazakhstan.htm
- For pie charts: each data item needs 'name' and 'value'
- Dense data: 8-15 points per chart when possible
- Colors: #00AAFF, #F59E0B, #10B981, #EF4444, #8B5CF6, #F97316, #06B6D4`;

// Instructs Claude to return structured markdown with section headers.
// SearchMode renders this via MarkdownText which handles ##, bullets, bold.
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
What the data means for Kazakhstan's economic trajectory and outlook.

Be specific — include exact figures, percentages, dates, and growth rates wherever possible.`;

// CSV analysis prompt — Claude must use exact column names from the uploaded data.
const CSV_SYSTEM = `You are an expert data analyst and visualization specialist. Analyze CSV datasets and generate Recharts-compatible chart configurations using real values from the data. Never use placeholder values. Return only valid JSON without any markdown wrapper.`;

// ── API Routes ────────────────────────────────────────────────────────────────

// POST /api/chat
// Accepts: { messages: Array<{role: string, content: string}> }
// Returns: AIResponse — { insight?, charts?, sources?, followUps?, error? }
// Caches single-turn queries for TTL_CHAT_MS (multi-turn skipped — context changes each call).
app.post('/api/chat', apiLimiter, async (req, res) => {
  let { messages } = req.body;
  if (!Array.isArray(messages) || messages.length === 0)
    return res.status(400).json({ error: 'messages array is required' });

  // Sanitize: cap history depth and per-message content size
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
    if (ck) apiCache.put(ck, parsed, TTL_CHAT_MS);
    res.json(parsed);
  } catch (e) {
    console.error('/api/chat error:', e.message);
    res.status(502).json({ error: e.message });
  }
});

// POST /api/search
// Accepts: { query: string }
// Returns: SearchResult — { text, sources[], webSearchUsed }
// Strategy: attempt Anthropic web_search beta tool first; fall back to model knowledge on failure.
app.post('/api/search', apiLimiter, async (req, res) => {
  const query = String(req.body.query || '').trim().slice(0, MAX_QUERY_CHARS);
  if (!query) return res.status(400).json({ error: 'query is required' });

  const ck = cacheKey('/search', { query });
  const cached = apiCache.get(ck);
  if (cached) { if (IS_DEV) console.log('[cache hit] /api/search:', query.slice(0, 40)); return res.json(cached); }

  let text = '', sources = [], webSearchUsed = false;

  try {
    // Anthropic tool-use follows a multi-turn loop: the model requests web_search,
    // we return a dummy tool_result, and it continues until stop_reason === 'end_turn'.
    // MAX_SEARCH_TURNS guards against runaway loops if the model repeatedly calls the tool.
    const msgs = [{ role: 'user', content: query }];
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
    // Fallback: answer from Claude's training knowledge when the beta tool is unavailable
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

  const result = { text, sources, webSearchUsed };
  apiCache.put(ck, result, TTL_SEARCH_MS);
  res.json(result);
});

// POST /api/analyze-csv
// Accepts: { headers: string[], rows: object[], context?: string }
// Returns: AIResponse with charts derived from actual CSV column values (not placeholder data).
app.post('/api/analyze-csv', apiLimiter, async (req, res) => {
  let { headers, rows, context } = req.body;
  if (!Array.isArray(headers) || !Array.isArray(rows))
    return res.status(400).json({ error: 'headers and rows arrays are required' });

  // Sanitize to prevent oversized prompts
  headers = headers.slice(0, MAX_CSV_COLS).map(h => String(h).slice(0, 100));
  rows    = rows.slice(0, MAX_CSV_ROWS);
  context = String(context || '').slice(0, MAX_CONTEXT_CHARS);

  // Build a compact CSV text sample — Claude only needs enough rows to understand the data shape
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
      "id": "c1",
      "title": "Descriptive chart title",
      "type": "line|bar|area|pie|composed|radar",
      "description": "One sentence describing what this chart shows",
      "data": [ ...array of objects with real values from the CSV... ],
      "xKey": "exact_column_name_for_x_axis",
      "series": [{"key": "exact_col_name", "name": "Display Name", "color": "#hex", "stacked": false, "rightAxis": false}]
    }
  ],
  "sources": ["Uploaded CSV — ${rows.length} rows"],
  "followUps": ["Follow-up question 1", "Follow-up question 2", "Follow-up question 3"]
}

Rules:
- Use EXACT column names from the CSV as object keys (not placeholders)
- Include REAL data values from the CSV, not invented numbers
- For pie charts: data items must have 'name' and 'value' keys; aggregate/sum if needed
- For time-series: sort data by the time/date column ascending
- Choose chart types that best reveal patterns: trends→line/area, comparisons→bar, distribution→pie
- Colors to use: #00AAFF, #F59E0B, #10B981, #EF4444, #8B5CF6, #F97316, #06B6D4`;

  try {
    const data = await callAnthropic({ model: MODEL, max_tokens: 4000, system: CSV_SYSTEM, messages: [{ role: 'user', content: prompt }] });
    const txt  = data.content?.map(b => b.text || '').join('') || '{}';
    try {
      const raw = JSON.parse(txt.replace(/```json|```/g, '').trim());
      res.json(validateAIResponse(raw) ?? { insight: txt, charts: [], sources: [{ title: 'Uploaded CSV', url: null }], followUps: [] });
    } catch {
      res.json({ insight: txt, charts: [], sources: [{ title: 'Uploaded CSV', url: null }], followUps: [] });
    }
  } catch (e) {
    console.error('/api/analyze-csv error:', e.message);
    res.status(502).json({ error: e.message });
  }
});

// ── Auth routes ───────────────────────────────────────────────────────────────

// POST /api/auth/register
app.post('/api/auth/register', apiLimiter, async (req, res) => {
  const { email, password, name } = req.body;
  if (!email || !password || !name)
    return res.status(400).json({ error: 'email, password, and name are required' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email)))
    return res.status(400).json({ error: 'Invalid email address' });
  if (String(password).length < 8)
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  const em = String(email).toLowerCase().trim();
  if (users.has(em)) return res.status(409).json({ error: 'Email already registered' });
  const hashedPassword = await bcrypt.hash(String(password), BCRYPT_ROUNDS);
  const id   = `u_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const user = { id, email: em, name: String(name).slice(0, 80).trim(), hashedPassword, createdAt: new Date().toISOString() };
  users.set(em, user);
  userSessions.set(id, new Set());
  const token = jwt.sign({ id, email: em, name: user.name }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, user: { id, email: em, name: user.name } });
});

// POST /api/auth/login
app.post('/api/auth/login', apiLimiter, async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'email and password are required' });
  const em   = String(email).toLowerCase().trim();
  const user = users.get(em);
  if (!user) return res.status(401).json({ error: 'Invalid email or password' });
  const match = await bcrypt.compare(String(password), user.hashedPassword);
  if (!match) return res.status(401).json({ error: 'Invalid email or password' });
  const token = jwt.sign({ id: user.id, email: user.email, name: user.name }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, user: { id: user.id, email: user.email, name: user.name } });
});

// GET /api/auth/me — validate token and return user
app.get('/api/auth/me', requireAuth, (req, res) => {
  res.json({ id: req.user.id, email: req.user.email, name: req.user.name });
});

// ── Chat session routes ────────────────────────────────────────────────────────

// GET /api/sessions — list sessions for logged-in user (summaries only, no messages)
app.get('/api/sessions', requireAuth, (req, res) => {
  const ids    = userSessions.get(req.user.id) || new Set();
  const result = [...ids]
    .map(id => chatSessions.get(id))
    .filter(Boolean)
    .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
    .map(({ id, title, createdAt, updatedAt }) => ({ id, title, createdAt, updatedAt }));
  res.json(result);
});

// POST /api/sessions — create a new session
app.post('/api/sessions', requireAuth, (req, res) => {
  const title = String(req.body.title || 'New Chat').slice(0, 100);
  const id    = `s_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const now   = new Date().toISOString();
  const session = { id, userId: req.user.id, title, messages: [], createdAt: now, updatedAt: now };
  chatSessions.set(id, session);
  if (!userSessions.has(req.user.id)) userSessions.set(req.user.id, new Set());
  userSessions.get(req.user.id).add(id);
  res.json(session);
});

// GET /api/sessions/:id — load full session with messages
app.get('/api/sessions/:id', requireAuth, (req, res) => {
  const session = chatSessions.get(req.params.id);
  if (!session || session.userId !== req.user.id) return res.status(404).json({ error: 'Session not found' });
  res.json(session);
});

// PATCH /api/sessions/:id — update messages and/or title
app.patch('/api/sessions/:id', requireAuth, (req, res) => {
  const session = chatSessions.get(req.params.id);
  if (!session || session.userId !== req.user.id) return res.status(404).json({ error: 'Session not found' });
  if (Array.isArray(req.body.messages)) session.messages = req.body.messages;
  if (typeof req.body.title === 'string') session.title = req.body.title.slice(0, 100);
  session.updatedAt = new Date().toISOString();
  res.json({ id: session.id, title: session.title, updatedAt: session.updatedAt });
});

// DELETE /api/sessions/:id
app.delete('/api/sessions/:id', requireAuth, (req, res) => {
  const session = chatSessions.get(req.params.id);
  if (!session || session.userId !== req.user.id) return res.status(404).json({ error: 'Session not found' });
  chatSessions.delete(req.params.id);
  userSessions.get(req.user.id)?.delete(req.params.id);
  res.json({ ok: true });
});

// ── Static file serving ───────────────────────────────────────────────────────
// In production, Express serves the Vite-built dist/ folder.
// SPA fallback: all non-API routes return index.html so React Router works.
const DIST = join(__dirname, 'dist');
app.use(staticLimiter);
app.use(express.static(DIST));
app.use((_req, res) => res.sendFile(join(DIST, 'index.html')));

app.listen(PORT, () => {
  console.log(`Kazakhstan Dashboard server running on http://localhost:${PORT}`);
});
