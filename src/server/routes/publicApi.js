import express from 'express';
import countries from 'i18n-iso-countries';

export function createPublicApiRouter(deps) {
  const {
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
  } = deps;

  const router = express.Router();

  router.get('/countries', authenticateApiKey, async (req, res) => {
    const query = validate(DataApiSchema, req.query, res);
    if (!query) return;

    const search = (query.search || '').trim().toLowerCase();
    const requestedFormat = query.format || 'json';

    try {
      const countriesCatalog = await fetchWorldBankCountryCatalog();
      const items = countriesCatalog
        .filter((item) => {
          if (!search) return true;
          const name = String(item.name || '').toLowerCase();
          return name.includes(search);
        })
        .slice(0, 500);

      const payload = {
        query: search || null,
        count: items.length,
        countries: items,
      };

      if (requestedFormat === 'csv') {
        const csvRows = toCsvString(items.map((item) => ({
          code: item.code,
          alpha3: item.alpha3,
          name: item.name,
          flag: item.flag,
          region: item.region,
        })));
        return sendApiDataResponse(res, req, csvRows, requestedFormat);
      }

      sendApiDataResponse(res, req, payload, requestedFormat);
    } catch (err) {
      const message = errorMessage(err, 'Failed to load country list');
      console.error('/api/data/countries:', message);
      res.status(502).json({ error: message });
    }
  });

  router.get('/batch', authenticateApiKey, async (req, res) => {
    const query = validate(DataApiSchema, req.query, res);
    if (!query) return;

    const requestedIndicators = parseIndicatorKeys(query.indicators);
    const requestedFormat = query.format || 'json';
    const rawCountries = query.countries || '';

    const normalizedCountries = normalizeApiCountries(rawCountries)
      .map((code) => normalizeCountryCode(code))
      .filter(Boolean)
      .filter((value, index, all) => all.indexOf(value) === index);

    const { startYear, endYear } = parseApiYears(query.start_year, query.end_year, query.years);

    if (!normalizedCountries.length) {
      return res.status(400).json({ error: 'Invalid countries list. Use ISO-2 or ISO-3 codes, e.g. countries=US,CN,IN.' });
    }

    const invalid = [];
    const requestedCountryMap = normalizedCountries.filter((code) => {
      const valid = countries.isValid(code);
      if (!valid) invalid.push(code);
      return valid;
    });

    if (!requestedCountryMap.length) {
      return res.status(400).json({ error: `Invalid country codes: ${invalid.join(', ')}` });
    }

    const settled = await Promise.allSettled(
      requestedCountryMap.map(async (code) => {
        return buildApiCountryPayload(
          await buildApiSeriesForCountry(code, requestedIndicators, startYear, endYear),
          requestedIndicators,
          startYear,
          endYear,
        );
      }),
    );

    const countriesPayload = [];
    const fetchErrors = [];

    settled.forEach((result, idx) => {
      const code = requestedCountryMap[idx];
      if (result.status === 'fulfilled') {
        countriesPayload.push(result.value);
        return;
      }
      fetchErrors.push({ code, error: result.reason?.message || 'Failed to fetch data' });
    });

    if (!countriesPayload.length) {
      return res.status(502).json({
        error: 'Failed to fetch data for requested countries',
        errors: fetchErrors,
      });
    }

    const payload = {
      period: { startYear, endYear },
      requestedIndicators,
      requestedCountries: requestedCountryMap,
      countries: countriesPayload,
      failed: fetchErrors,
      invalid,
    };

    if (requestedFormat === 'csv') {
      const csvRows = buildApiBatchCsvPayload(countriesPayload);
      return sendApiDataResponse(res, req, toCsvString(csvRows), requestedFormat);
    }

    sendApiDataResponse(res, req, payload, requestedFormat);
  });

  router.get('/:code', authenticateApiKey, async (req, res) => {
    const query = validate(DataApiSchema, req.query, res);
    if (!query) return;

    const requestedFormat = query.format || 'json';
    const requestedIndicators = parseIndicatorKeys(query.indicators);
    const countryCode = normalizeCountryCode(req.params.code);

    if (!countryCode || !countries.isValid(countryCode)) {
      return res.status(400).json({ error: `Invalid country code: ${req.params.code}` });
    }

    const { startYear, endYear } = parseApiYears(query.start_year, query.end_year, query.years);

    try {
      const payload = buildApiCountryPayload(
        await buildApiSeriesForCountry(countryCode, requestedIndicators, startYear, endYear),
        requestedIndicators,
        startYear,
        endYear,
      );

      if (requestedFormat === 'csv') {
        const rows = buildApiCountrySeriesRows(payload);
        return sendApiDataResponse(res, req, toCsvString(rows), requestedFormat);
      }

      sendApiDataResponse(res, req, payload, requestedFormat);
    } catch (err) {
      const message = errorMessage(err, `Failed to build API data for ${req.params.code}`);
      console.error(`/api/data/${req.params.code}:`, message);
      res.status(502).json({ error: message });
    }
  });

  return router;
}
