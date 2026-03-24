/**
 * EconChart MCP Server
 *
 * Exposes World Bank, IMF DataMapper, and FRED economic data as Model Context
 * Protocol (MCP) tools.  Run with:
 *
 *   node mcp-server.js
 *
 * Or register in .mcp.json:
 *   { "mcpServers": { "econchart": { "command": "node", "args": ["mcp-server.js"] } } }
 *
 * Tools exposed:
 *   fetch_world_bank  – verified indicator data for any country (ISO2 codes)
 *   fetch_imf         – IMF DataMapper indicator data (ISO3 codes)
 *   fetch_fred        – US FRED economic series (requires FRED_API_KEY)
 *   get_country_data  – aggregated GDP + trade snapshot for a country
 */

import 'dotenv/config';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import countries from 'i18n-iso-countries';
import enLocale from 'i18n-iso-countries/langs/en.json' with { type: 'json' };

countries.registerLocale(enLocale);

// ── Shared raw-data cache (TTL-based, no eviction needed for MCP process) ─────
const RAW_DATA_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const rawCache = new Map(); // key → { value, expiresAt }

function cacheGet(key) {
  const entry = rawCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) { rawCache.delete(key); return null; }
  return entry.value;
}
function cachePut(key, value) {
  rawCache.set(key, { value, expiresAt: Date.now() + RAW_DATA_TTL_MS });
}

// ── Fetch helpers ──────────────────────────────────────────────────────────────
async function fetchWithRetry(url, options = {}, retries = 2, baseDelay = 1500) {
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetch(url, { ...options, signal: AbortSignal.timeout(20_000) });
      if (res.ok) return res;
      if ([429, 503].includes(res.status) && i < retries) {
        await new Promise(r => setTimeout(r, baseDelay * Math.pow(2, i)));
        continue;
      }
      throw new Error(`HTTP ${res.status} from ${url}`);
    } catch (err) {
      if (i === retries) throw err;
      await new Promise(r => setTimeout(r, baseDelay * Math.pow(2, i)));
    }
  }
}

/**
 * World Bank Open Data — returns [{country, countryCode, year, value, indicator, indicatorName}]
 * ISO2 country codes, e.g. "US", "DE", "CN"
 */
async function fetchWorldBank(countryCodes, indicator, startYear = 2000, endYear = 2024) {
  const codes = Array.isArray(countryCodes) ? countryCodes.join(';') : countryCodes;
  const url = `https://api.worldbank.org/v2/country/${codes}/indicator/${indicator}?format=json&date=${startYear}:${endYear}&per_page=500`;
  const ck = `wb:${url}`;
  const cached = cacheGet(ck);
  if (cached) return cached;

  const res = await fetchWithRetry(url, { headers: { Accept: 'application/json' } });
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
  cachePut(ck, result);
  return result;
}

/**
 * IMF DataMapper — returns [{countryCode, year, value}]
 * ISO3 country codes, e.g. "USA", "DEU", "CHN"
 */
async function fetchIMF(indicator, countryCodes) {
  const codes = Array.isArray(countryCodes) ? countryCodes.join('/') : countryCodes;
  const url = `https://www.imf.org/external/datamapper/api/v1/${indicator}/${codes}`;
  const ck = `imf:${url}`;
  const cached = cacheGet(ck);
  if (cached) return cached;

  const res = await fetchWithRetry(url, { headers: { Accept: 'application/json' } }, 3, 2000);
  const json = await res.json();
  const values = json?.values?.[indicator];
  if (!values) return [];
  const rows = [];
  for (const [countryCode, yearData] of Object.entries(values)) {
    for (const [year, value] of Object.entries(yearData)) {
      if (value !== null && value !== undefined)
        rows.push({ countryCode, year: parseInt(year, 10), value: Number(value) });
    }
  }
  const result = rows.sort((a, b) => a.year - b.year);
  cachePut(ck, result);
  return result;
}

/**
 * FRED (Federal Reserve Bank of St. Louis) — US economic series.
 * Requires FRED_API_KEY env var. Returns [{year, value}].
 */
async function fetchFRED(seriesId, startYear = 2000, endYear = 2024) {
  const apiKey = process.env.FRED_API_KEY;
  if (!apiKey) throw new Error('FRED_API_KEY environment variable is not set');
  const url = `https://api.stlouisfed.org/fred/series/observations?series_id=${seriesId}&api_key=${apiKey}&file_type=json&observation_start=${startYear}-01-01&observation_end=${endYear}-12-31&frequency=a&aggregation_method=avg`;
  const ck = `fred:${seriesId}:${startYear}:${endYear}`;
  const cached = cacheGet(ck);
  if (cached) return cached;

  const res = await fetch(url, { signal: AbortSignal.timeout(12_000) });
  if (!res.ok) throw new Error(`FRED API HTTP ${res.status}`);
  const json = await res.json();
  const result = (json.observations || [])
    .filter(o => o.value !== '.' && o.value !== null)
    .map(o => ({ year: parseInt(o.date, 10), value: parseFloat(o.value) }))
    .sort((a, b) => a.year - b.year);
  cachePut(ck, result);
  return result;
}

/**
 * Aggregated country snapshot — GDP, growth, per-capita from World Bank.
 * Falls back to IMF for GDP metrics only (not trade, to avoid unit mismatch).
 */
async function getCountryData(iso2Code, startYear = 2010, endYear = 2024) {
  const code = iso2Code.toUpperCase();
  if (!countries.isValid(code)) throw new Error(`Invalid ISO2 code: ${iso2Code}`);
  const name = countries.getName(code, 'en') ?? code;

  const WB_INDICATORS = {
    gdp:         'NY.GDP.MKTP.CD',
    gdpGrowth:   'NY.GDP.MKTP.KD.ZG',
    gdpPerCapita:'NY.GDP.PCAP.CD',
    exports:     'NE.EXP.GNFS.CD',
    imports:     'NE.IMP.GNFS.CD',
  };
  const IMF_FALLBACK = {
    gdp:         'NGDPD',
    gdpGrowth:   'NGDP_RPCH',
    gdpPerCapita:'NGDPDPC',
    // exports/imports skipped — IMF uses growth %, incompatible with WB USD values
  };

  const iso3 = countries.alpha2ToAlpha3(code);
  const results = {};

  for (const [key, wbInd] of Object.entries(WB_INDICATORS)) {
    try {
      const rows = await fetchWorldBank([code], wbInd, startYear, endYear);
      if (rows.length > 0) { results[key] = { rows, source: 'World Bank' }; continue; }
    } catch { /* fall through */ }

    const imfInd = IMF_FALLBACK[key];
    if (imfInd && iso3) {
      try {
        const rows = await fetchIMF(imfInd, [iso3]);
        if (rows.length > 0) { results[key] = { rows, source: 'IMF DataMapper' }; continue; }
      } catch { /* fall through */ }
    }
    results[key] = { rows: [], source: 'unavailable' };
  }

  return { country: name, code, iso3, startYear, endYear, data: results };
}

// ── MCP Server ─────────────────────────────────────────────────────────────────
const server = new McpServer({
  name: 'econchart-economic-data',
  version: '1.0.0',
});

// Tool: fetch_world_bank
server.tool(
  'fetch_world_bank',
  'Fetch verified economic indicator data from the World Bank Open Data API. ' +
  'Works for all 200+ countries. No API key required. ' +
  'Common indicators: NY.GDP.MKTP.CD (GDP USD), NY.GDP.MKTP.KD.ZG (GDP growth %), ' +
  'NY.GDP.PCAP.CD (GDP per capita), NE.EXP.GNFS.CD (exports USD), NE.IMP.GNFS.CD (imports USD), ' +
  'FP.CPI.TOTL.ZG (inflation), SL.UEM.TOTL.ZS (unemployment).',
  {
    country_codes: z.array(z.string()).min(1).describe('ISO2 country codes, e.g. ["US","DE","CN"]'),
    indicator:     z.string().describe('World Bank indicator ID, e.g. "NY.GDP.MKTP.CD"'),
    start_year:    z.number().int().min(1960).max(2024).default(2000).describe('Start year (default 2000)'),
    end_year:      z.number().int().min(1960).max(2024).default(2024).describe('End year (default 2024)'),
  },
  async ({ country_codes, indicator, start_year, end_year }) => {
    const rows = await fetchWorldBank(country_codes, indicator, start_year, end_year);
    if (rows.length === 0) throw new Error(`No World Bank data found for indicator ${indicator} and countries ${country_codes.join(', ')}`);
    const sourceUrl = `https://data.worldbank.org/indicator/${indicator}?locations=${country_codes.join('-')}`;
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({ rows, source: 'World Bank Open Data', indicator, sourceUrl, count: rows.length }),
      }],
    };
  }
);

// Tool: fetch_imf
server.tool(
  'fetch_imf',
  'Fetch economic indicator data from the IMF DataMapper API. ' +
  'Uses ISO3 country codes (USA, DEU, CHN). No API key required. ' +
  'Common indicators: NGDPD (GDP current USD billions), NGDP_RPCH (GDP growth %), ' +
  'NGDPDPC (GDP per capita USD), PCPIPCH (inflation %), LUR (unemployment %), ' +
  'GGXWDG_NGDP (government debt % GDP). ' +
  'NOTE: IMF trade indicators (TXG_RPCH, TMG_RPCH) are growth rates, NOT absolute values.',
  {
    indicator:     z.string().describe('IMF DataMapper indicator code, e.g. "NGDPD"'),
    country_codes: z.array(z.string()).min(1).describe('ISO3 country codes, e.g. ["USA","DEU","CHN"]'),
  },
  async ({ indicator, country_codes }) => {
    const rows = await fetchIMF(indicator, country_codes);
    if (rows.length === 0) throw new Error(`No IMF data found for indicator ${indicator} and countries ${country_codes.join(', ')}`);
    const sourceUrl = `https://www.imf.org/external/datamapper/${indicator}`;
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({ rows, source: 'IMF DataMapper', indicator, sourceUrl, count: rows.length }),
      }],
    };
  }
);

// Tool: fetch_fred
server.tool(
  'fetch_fred',
  'Fetch US economic time-series data from FRED (Federal Reserve Bank of St. Louis). ' +
  'Requires FRED_API_KEY environment variable. Annual frequency, average aggregation. ' +
  'Common series: GDP (nominal GDP billions), GDPC1 (real GDP), UNRATE (unemployment), ' +
  'CPIAUCSL (CPI), FEDFUNDS (fed funds rate), DGS10 (10-yr treasury yield).',
  {
    series_id:  z.string().describe('FRED series ID, e.g. "GDP", "UNRATE", "CPIAUCSL"'),
    start_year: z.number().int().min(1950).max(2024).default(2000).describe('Start year'),
    end_year:   z.number().int().min(1950).max(2024).default(2024).describe('End year'),
  },
  async ({ series_id, start_year, end_year }) => {
    const rows = await fetchFRED(series_id, start_year, end_year);
    if (rows.length === 0) throw new Error(`No FRED data found for series ${series_id}`);
    const sourceUrl = `https://fred.stlouisfed.org/series/${series_id}`;
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({ rows, source: 'FRED (Federal Reserve Bank of St. Louis)', series_id, sourceUrl, count: rows.length }),
      }],
    };
  }
);

// Tool: get_country_data
server.tool(
  'get_country_data',
  'Get a comprehensive economic snapshot for a country: GDP, GDP growth, GDP per capita, ' +
  'exports, and imports. Automatically uses World Bank as primary source with IMF fallback ' +
  'for GDP metrics. Trade data (exports/imports) is World Bank only to ensure consistent ' +
  'absolute USD values. Returns structured data ready for charting.',
  {
    country_code: z.string().length(2).describe('ISO2 country code, e.g. "US", "DE", "IN"'),
    start_year:   z.number().int().min(1960).max(2024).default(2010).describe('Start year (default 2010)'),
    end_year:     z.number().int().min(1960).max(2024).default(2024).describe('End year (default 2024)'),
  },
  async ({ country_code, start_year, end_year }) => {
    const data = await getCountryData(country_code, start_year, end_year);
    return {
      content: [{
        type: 'text',
        text: JSON.stringify(data, null, 2),
      }],
    };
  }
);

// ── Start server ───────────────────────────────────────────────────────────────
const transport = new StdioServerTransport();
await server.connect(transport);
