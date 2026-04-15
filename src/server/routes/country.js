import express from 'express';
import countries from 'i18n-iso-countries';

const COUNTRY_ALIASES = {
  'palestine': 'west bank',
  'taiwan': 'taiwan, china',
  'south korea': 'korea, rep',
  'north korea': 'korea, dem',
  'russia': 'russian federation',
  'iran': 'iran, islamic rep',
  'syria': 'syrian arab republic',
  'laos': 'lao pdr',
  'vietnam': 'viet nam',
  'ivory coast': `côte d'ivoire`,
  'congo': 'congo, dem',
  'czech': 'czechia',
  'slovakia': 'slovak republic',
  'venezuela': 'venezuela, rb',
  'bolivia': 'bolivia',
  'egypt': 'egypt, arab rep',
  'yemen': 'yemen, rep',
  'gambia': 'gambia, the',
  'bahamas': 'bahamas, the',
  'micronesia': 'micronesia, fed',
  'kyrgyzstan': 'kyrgyz republic',
};

export function createCountryRouter(deps) {
  const {
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
  } = deps;

  const router = express.Router();

  router.get('/history', requireAuth, (req, res) => {
    const rows = db.prepare('SELECT code, data_json, cached_at FROM country_cache ORDER BY cached_at DESC').all();
    const history = rows.map((row) => {
      try {
        const data = JSON.parse(row.data_json);
        return { code: data.code, name: data.name, flag: data.flag, region: data.region, cachedAt: row.cached_at };
      } catch {
        return null;
      }
    }).filter(Boolean);
    res.json(history);
  });

  router.get('/search', requireAuth, apiLimiter, async (req, res) => {
    const query = validate(CountrySearchQuerySchema, req.query, res);
    if (!query) return;
    const q = query.q.trim();
    const qLower = q.toLowerCase();
    const canonicalQ = COUNTRY_ALIASES[qLower] ?? qLower;

    try {
      const response = await fetch('https://api.worldbank.org/v2/country?format=json&per_page=500', {
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) throw new Error(`World Bank country list HTTP ${response.status}`);
      const data = await response.json();
      const hits = (data[1] ?? [])
        .filter((country) => country.region?.id !== 'NA'
          && (country.name.toLowerCase().includes(qLower) || country.name.toLowerCase().includes(canonicalQ)))
        .slice(0, 15)
        .map((country) => ({
          code: country.iso2Code,
          name: country.name,
          flag: iso2ToFlag(country.iso2Code),
          region: country.region?.value ?? '',
        }));
      res.json(hits);
    } catch (err) {
      const message = errorMessage(err, 'Failed to fetch country list');
      console.error('/api/country/search:', message);
      res.status(502).json({ error: message });
    }
  });

  router.get('/:code', requireAuth, apiLimiter, async (req, res) => {
    const code = req.params.code.toUpperCase().replace(/[^A-Z]/g, '');
    if (code.length !== 2) return res.status(400).json({ error: 'Expected ISO 2-letter country code' });
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
    } catch (err) {
      const message = errorMessage(err, 'Failed to build country dataset');
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

  router.post('/:code/refresh', requireAuth, apiLimiter, async (req, res) => {
    const code = req.params.code.toUpperCase().replace(/[^A-Z]/g, '');
    if (code.length !== 2) return res.status(400).json({ error: 'Expected ISO 2-letter country code' });
    if (!countries.isValid(code)) {
      return res.status(400).json({ error: `Unknown country code: ${code}` });
    }

    try {
      const dataset = await buildCountryDataset(code);
      stmtCountry.upsert.run(code, JSON.stringify(dataset), Date.now());
      res.json(dataset);
    } catch (err) {
      const message = errorMessage(err, 'Failed to refresh country dataset');
      console.error(`/api/country/${code}/refresh:`, message);
      res.status(502).json({ error: message });
    }
  });

  return router;
}
