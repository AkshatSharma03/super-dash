import express, { Router } from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { z } from 'zod';

export function createMcpServerInstance(deps) {
  const { fetchWorldBankIndicator, fetchIMFIndicator, fetchFREDSeries } = deps;

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

export function createMcpRouter(deps) {
  const {
    mcpAuth,
    fetchWorldBankIndicator,
    fetchIMFIndicator,
    fetchFREDSeries,
  } = deps;

  const router = Router();
  const mcpSessions = new Map(); // sessionId → SSEServerTransport

  // GET /mcp/sse — client opens SSE stream
  router.get('/sse', mcpAuth, async (req, res) => {
    const transport = new SSEServerTransport('/mcp/message', res);
    mcpSessions.set(transport.sessionId, transport);
    req.on('close', () => mcpSessions.delete(transport.sessionId));
    const srv = createMcpServerInstance({ fetchWorldBankIndicator, fetchIMFIndicator, fetchFREDSeries });
    await srv.connect(transport);
  });

  // POST /mcp/message — client sends JSON-RPC messages
  router.post('/message', mcpAuth, express.json(), async (req, res) => {
    const transport = mcpSessions.get(req.query.sessionId);
    if (!transport) return res.status(404).json({ error: 'MCP session not found' });
    await transport.handlePostMessage(req, res);
  });

  return router;
}
