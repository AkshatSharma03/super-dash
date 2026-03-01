import 'dotenv/config';
import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { createHash } from 'crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const ANTHROPIC_BASE = 'https://api.anthropic.com/v1/messages';

if (!ANTHROPIC_API_KEY) {
  console.error('ERROR: ANTHROPIC_API_KEY environment variable is not set.');
  console.error('Add it to your .env file or set it in your hosting platform.');
  process.exit(1);
}

// ── LRU Cache (implemented from scratch) ──────────────────────────────────────
// Doubly-linked list + HashMap gives O(1) get and put.
// Evicts the least-recently-used entry when capacity is reached.
// Each entry also carries a TTL so stale responses are never served.
class LRUNode {
  constructor(key, value, ttlMs = 60 * 60 * 1000) {
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
    this.map      = new Map();          // key → node
    // Sentinel head/tail — never evicted, simplify pointer updates
    this.head = new LRUNode(null, null);
    this.tail = new LRUNode(null, null);
    this.head.next = this.tail;
    this.tail.prev = this.head;
  }

  _detach(node) {
    node.prev.next = node.next;
    node.next.prev = node.prev;
  }

  _attachFront(node) {
    node.next       = this.head.next;
    node.prev       = this.head;
    this.head.next.prev = node;
    this.head.next  = node;
  }

  get(key) {
    const node = this.map.get(key);
    if (!node) return null;
    if (Date.now() > node.expiresAt) {   // TTL expired — treat as miss
      this._detach(node);
      this.map.delete(key);
      return null;
    }
    // Move to front (most recently used)
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
    if (this.map.size > this.capacity) {  // evict LRU (node before tail)
      const lru = this.tail.prev;
      this._detach(lru);
      this.map.delete(lru.key);
    }
  }

  get size() { return this.map.size; }
}

// 200-entry cache: chat + search responses (TTL: 1 h chat, 30 min search)
const apiCache = new LRUCache(200);

function cacheKey(endpoint, body) {
  return createHash('sha256')
    .update(endpoint + JSON.stringify(body))
    .digest('hex');
}

const app = express();

// ── CORS for local development ────────────────────────────────────────────
// Allows the Vite dev server (port 5173) to call the API (port 3000)
// In production this is irrelevant since both are served from the same origin
app.use((req, res, next) => {
  const origin = req.headers.origin || '';
  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Max-Age', '86400');
  }
  if (req.method === 'OPTIONS') return res.status(204).end();
  next();
});

// ── Security headers ──────────────────────────────────────────────────────
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc:  ["'self'"],
        styleSrc:   ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc:    ["'self'", 'https://fonts.gstatic.com'],
        connectSrc: ["'self'"],
        imgSrc:     ["'self'", 'data:'],
        frameAncestors: ["'none'"],
      },
    },
    crossOriginEmbedderPolicy: false,
  })
);

app.use(express.json({ limit: '2mb' }));

// ── Rate limiting: 20 API calls per 15 min per IP ─────────────────────────
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please wait a few minutes and try again.' },
});

// ── Anthropic helper ──────────────────────────────────────────────────────
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
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Anthropic ${res.status}: ${text}`);
  }
  return res.json();
}

// ── System prompts ────────────────────────────────────────────────────────
const CHAT_SYSTEM = `You are an expert data analyst and economist specializing in Kazakhstan and Central Asia economics, trade, AI governance, and Silicon Steppes digital strategy research.

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
  "sources": ["World Bank","IMF","UN Comtrade","stat.gov.kz"],
  "followUps": ["Follow-up question 1","Follow-up question 2","Follow-up question 3"]
}

Rules:
- 1-3 charts per response. Choose types intelligently: trends->line/area, comparisons->bar, composition->pie, multi-metric->composed
- Use real, accurate data from your knowledge (World Bank, IMF, UN Comtrade, stat.gov.kz, OECD)
- For pie charts: each data item needs 'name' and 'value'
- Dense data: 8-15 points per chart when possible
- Colors: #00AAFF, #F59E0B, #10B981, #EF4444, #8B5CF6, #F97316, #06B6D4`;

const SEARCH_SYSTEM = `You are an expert research analyst and economist specializing in Kazakhstan and Central Asian economies.
When searching, prioritize authoritative sources: World Bank (worldbank.org), IMF (imf.org), OECD (oecd.org), Kazakhstan Bureau of Statistics (stat.gov.kz), National Bank of Kazakhstan, Reuters, Bloomberg, Financial Times, Eurasianet.

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

const CSV_SYSTEM = `You are an expert data analyst and visualization specialist. Analyze CSV datasets and generate Recharts-compatible chart configurations using real values from the data. Never use placeholder values. Return only valid JSON without any markdown wrapper.`;

// ── POST /api/chat ─────────────────────────────────────────────────────────
app.post('/api/chat', apiLimiter, async (req, res) => {
  let { messages } = req.body;

  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'messages array is required' });
  }

  // Sanitize: cap history and content length
  messages = messages.slice(-40).map(m => ({
    role: m.role === 'assistant' ? 'assistant' : 'user',
    content: String(m.content || '').slice(0, 12000),
  }));

  // LRU cache check (only cache single-turn queries to avoid stale context)
  const isSingleTurn = messages.length === 1;
  const ck = isSingleTurn ? cacheKey('/chat', messages) : null;
  if (ck) {
    const cached = apiCache.get(ck);
    if (cached) {
      console.log('[cache hit] /api/chat');
      return res.json(cached);
    }
  }

  try {
    const data = await callAnthropic({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4000,
      system: CHAT_SYSTEM,
      messages,
    });

    const text = data.content?.map(b => b.text || '').join('') || '{}';
    let parsed;
    try {
      parsed = JSON.parse(text.replace(/```json|```/g, '').trim());
    } catch {
      parsed = { insight: text, charts: [], sources: [], followUps: [] };
    }
    if (ck) apiCache.put(ck, parsed, 60 * 60 * 1000); // 1 h TTL
    res.json(parsed);
  } catch (e) {
    console.error('/api/chat error:', e.message);
    res.status(502).json({ error: e.message });
  }
});

// ── POST /api/search ───────────────────────────────────────────────────────
app.post('/api/search', apiLimiter, async (req, res) => {
  const query = String(req.body.query || '').trim().slice(0, 1000);
  if (!query) return res.status(400).json({ error: 'query is required' });

  // LRU cache check (search results are valid for 30 min)
  const ck = cacheKey('/search', { query });
  const cached = apiCache.get(ck);
  if (cached) {
    console.log('[cache hit] /api/search:', query.slice(0, 40));
    return res.json(cached);
  }

  let text = '', sources = [], webSearchUsed = false;

  // Attempt 1: Web search via Anthropic beta
  try {
    const msgs = [{ role: 'user', content: query }];
    for (let turn = 0; turn < 8; turn++) {
      const data = await callAnthropic(
        {
          model: 'claude-sonnet-4-20250514',
          max_tokens: 4000,
          system: SEARCH_SYSTEM,
          tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 5 }],
          messages: msgs,
        },
        { 'anthropic-beta': 'web-search-2025-03-05' }
      );

      for (const blk of data.content || []) {
        if (blk.type === 'text') { text = blk.text; webSearchUsed = true; }
        const content = Array.isArray(blk.content) ? blk.content : [];
        for (const r of content) {
          if (r.url && !sources.find(s => s.url === r.url)) {
            sources.push({ title: r.title || r.url, url: r.url });
          }
        }
      }

      if (data.stop_reason === 'end_turn') break;

      if (data.stop_reason === 'tool_use') {
        msgs.push({ role: 'assistant', content: data.content });
        const toolUses = (data.content || []).filter(
          b => b.type === 'tool_use' || b.type === 'server_tool_use'
        );
        if (!toolUses.length) break;
        msgs.push({
          role: 'user',
          content: toolUses.map(b => ({
            type: 'tool_result',
            tool_use_id: b.id,
            content: 'Search complete.',
          })),
        });
      } else break;
    }
  } catch (_) {
    // Fallback: Claude knowledge base
    try {
      const data = await callAnthropic({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4000,
        system: SEARCH_SYSTEM + '\n\nNote: Web search unavailable. Answer from training knowledge (data up to early 2025). Clearly note when figures may be outdated.',
        messages: [{ role: 'user', content: query }],
      });
      text = data.content?.map(b => b.text || '').join('') || '';
      sources = [{ title: 'Claude (training knowledge — may be outdated)', url: null }];
    } catch (e2) {
      console.error('/api/search fallback error:', e2.message);
      return res.status(502).json({ error: e2.message });
    }
  }

  const result = { text, sources, webSearchUsed };
  apiCache.put(ck, result, 30 * 60 * 1000); // 30 min TTL
  res.json(result);
});

// ── POST /api/analyze-csv ──────────────────────────────────────────────────
app.post('/api/analyze-csv', apiLimiter, async (req, res) => {
  let { headers, rows, context } = req.body;

  if (!Array.isArray(headers) || !Array.isArray(rows)) {
    return res.status(400).json({ error: 'headers and rows arrays are required' });
  }

  // Sanitize inputs
  headers = headers.slice(0, 50).map(h => String(h).slice(0, 100));
  rows    = rows.slice(0, 500);
  context = String(context || '').slice(0, 2000);

  const sample   = rows.slice(0, 30);
  const csvText  = [
    headers.join(','),
    ...sample.map(r => headers.map(h => String(r[h] ?? '')).join(',')),
  ].join('\n');

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
    const data = await callAnthropic({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4000,
      system: CSV_SYSTEM,
      messages: [{ role: 'user', content: prompt }],
    });

    const txt = data.content?.map(b => b.text || '').join('') || '{}';
    try {
      res.json(JSON.parse(txt.replace(/```json|```/g, '').trim()));
    } catch {
      res.json({ insight: txt, charts: [], sources: ['Uploaded CSV'], followUps: [] });
    }
  } catch (e) {
    console.error('/api/analyze-csv error:', e.message);
    res.status(502).json({ error: e.message });
  }
});

// ── Serve React build ──────────────────────────────────────────────────────
const DIST = join(__dirname, 'dist');
app.use(express.static(DIST));
// SPA fallback — serves index.html for all non-API routes (works in Express 4 & 5)
app.use((_req, res) => res.sendFile(join(DIST, 'index.html')));

app.listen(PORT, () => {
  console.log(`Kazakhstan Dashboard server running on http://localhost:${PORT}`);
});
