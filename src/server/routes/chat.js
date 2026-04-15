import { Router } from 'express';

const CHARTS_MARKER = 'CHARTS_DATA:';

const CSV_SYSTEM_PROMPT = `You are an expert data analyst and visualization specialist. Analyze CSV datasets and generate Recharts-compatible chart configurations using real values from the data. Never use placeholder values. Return only valid JSON without any markdown wrapper.`;

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

/** Build the system prompt dynamically so it reflects which tools are actually available. */
function buildVerifiedChatSystem(fredAvailable, DATA_TOOLS) {
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

async function callKagi(KAGI_BASE, KAGI_API_KEY, path, { method = 'GET', body = null, timeoutMs = 15000 } = {}) {
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

/**
 * Stream one Anthropic turn, calling onTextDelta(delta) for each text token.
 * Returns { text, toolUses, content, stopReason } after the turn completes.
 */
async function streamAnthropicTurn(ANTHROPIC_BASE, ANTHROPIC_API_KEY, ANTHROPIC_STREAM_TIMEOUT_MS, body, onTextDelta) {
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

  const reader = res.body.getReader();
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

export function createChatRouter(deps) {
  const {
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
  } = deps;

  const router = Router();

  router.post('/', apiLimiter, async (req, res) => {
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
        const kagi = await callKagi(KAGI_BASE, KAGI_API_KEY, '/fastgpt', {
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
          ANTHROPIC_BASE, ANTHROPIC_API_KEY, ANTHROPIC_STREAM_TIMEOUT_MS,
          { model: MODEL, max_tokens: 64000, temperature: 0, system: buildVerifiedChatSystem(!!process.env.FRED_API_KEY, DATA_TOOLS), tools: availableTools, messages: loopMessages },
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

  return router;
}

export function createCsvRouter(deps) {
  const {
    apiLimiter,
    validate,
    AnalyzeCsvSchema,
    callAnthropic,
    MODEL,
    validateAIResponse,
    track,
    CSV_SAMPLE_ROWS,
  } = deps;

  const router = Router();

  router.post('/', apiLimiter, async (req, res) => {
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
        system: CSV_SYSTEM_PROMPT,
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

  return router;
}
