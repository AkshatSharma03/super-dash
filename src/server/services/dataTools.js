import countries from 'i18n-iso-countries';

export function createDataToolsService({ rawDataCache, RAW_DATA_TTL_MS, IS_DEV, FRED_API_KEY }) {
  async function fetchWithRetry(url, options, retries = 2, baseDelay = 1000, retryStatuses = [429, 503], timeoutMs = null) {
    for (let i = 0; i <= retries; i += 1) {
      try {
        const signal = timeoutMs ? AbortSignal.timeout(timeoutMs) : options.signal;
        const res = await fetch(url, { ...options, signal });
        if (res.ok) return res;
        if (retryStatuses.includes(res.status) && i < retries) {
          const delay = baseDelay * (2 ** i);
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }
        throw new Error(`HTTP ${res.status}`);
      } catch (err) {
        if (i === retries) throw err;
        await new Promise((r) => setTimeout(r, baseDelay * (2 ** i)));
      }
    }

    throw new Error('Max retries exceeded');
  }

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
      .filter((d) => d.value !== null && d.value !== undefined)
      .map((d) => ({
        country: d.country?.value ?? codes,
        countryCode: d.countryiso3code ?? codes,
        year: parseInt(d.date, 10),
        value: d.value,
        indicator: d.indicator?.id ?? indicator,
        indicatorName: d.indicator?.value ?? indicator,
      }))
      .sort((a, b) => a.year - b.year);

    rawDataCache.put(ck, result, RAW_DATA_TTL_MS);
    return result;
  }

  async function fetchIMFIndicator(indicator, countryCodes) {
    const codes = Array.isArray(countryCodes) ? countryCodes.join('/') : countryCodes;
    const url = `https://www.imf.org/external/datamapper/api/v1/${indicator}/${codes}`;
    const ck = `imf:${url}`;
    const hit = rawDataCache.get(ck);
    if (hit) return hit;

    const res = await fetchWithRetry(url, { headers: { Accept: 'application/json' } }, 3, 2000, [403, 429, 503], 20000);
    const json = await res.json();
    const values = json?.values?.[indicator];
    if (!values) return [];

    const rows = [];
    for (const [countryCode, yearData] of Object.entries(values)) {
      for (const [year, value] of Object.entries(yearData)) {
        if (value !== null && value !== undefined) {
          rows.push({ countryCode, year: parseInt(year, 10), value });
        }
      }
    }

    const result = rows.sort((a, b) => a.year - b.year);
    rawDataCache.put(ck, result, RAW_DATA_TTL_MS);
    return result;
  }

  async function fetchFREDSeries(seriesId, startYear, endYear) {
    if (!FRED_API_KEY) throw new Error('FRED_API_KEY environment variable is not set');

    const url = `https://api.stlouisfed.org/fred/series/observations?series_id=${seriesId}&api_key=${FRED_API_KEY}&file_type=json&observation_start=${startYear}-01-01&observation_end=${endYear}-12-31&frequency=a&aggregation_method=avg`;
    const res = await fetch(url, { signal: AbortSignal.timeout(12000) });
    if (!res.ok) throw new Error(`FRED API ${res.status}`);

    const json = await res.json();
    return (json.observations || [])
      .filter((o) => o.value !== '.' && o.value !== null)
      .map((o) => ({ year: parseInt(o.date, 10), value: parseFloat(o.value) }))
      .sort((a, b) => a.year - b.year);
  }

  const WB_TO_IMF_INDICATOR = {
    'NY.GDP.MKTP.KD.ZG': 'NGDP_RPCH',
    'NY.GDP.MKTP.CD': 'NGDPD',
    'NY.GDP.PCAP.CD': 'NGDPDPC',
    'FP.CPI.TOTL.ZG': 'PCPIPCH',
    'SL.UEM.TOTL.ZS': 'LUR',
    'NE.GDI.TOTL.ZS': 'NID_NGDP',
    'NE.EXP.GNFS.CD': 'TXG_RPCH',
    'NE.IMP.GNFS.CD': 'TMG_RPCH',
    'BX.KLT.DINV.CD.WD': 'BX_FDI_DINV_CD_WD',
    'GC.DOD.TOTL.GD.ZS': 'GGXWDG_NGDP',
  };

  const IMF_TO_WB_INDICATOR = Object.fromEntries(
    Object.entries(WB_TO_IMF_INDICATOR).map(([wb, imf]) => [imf, wb])
  );

  async function executeDataTool(name, input) {
    if (name === 'fetch_world_bank') {
      const { country_codes, indicator, start_year = 2000, end_year = 2024 } = input;
      try {
        const rows = await fetchWorldBankIndicator(country_codes, indicator, start_year, end_year);
        if (rows.length === 0) throw new Error('World Bank returned no data for this query');
        const sourceUrl = `https://data.worldbank.org/indicator/${indicator}?locations=${Array.isArray(country_codes) ? country_codes.join('-') : country_codes}`;
        return JSON.stringify({ rows, source: 'World Bank Open Data', indicator, sourceUrl });
      } catch (wbErr) {
        const imfIndicator = WB_TO_IMF_INDICATOR[indicator];
        if (!imfIndicator) throw wbErr;
        const codeList = Array.isArray(country_codes) ? country_codes : [country_codes];
        const iso3Codes = codeList.map((c) => countries.alpha2ToAlpha3(c.toUpperCase())).filter(Boolean);
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
        const wbIndicator = IMF_TO_WB_INDICATOR[indicator];
        if (!wbIndicator) throw imfErr;
        const codeList = Array.isArray(country_codes) ? country_codes : [country_codes];
        const iso2Codes = codeList.map((c) => countries.alpha3ToAlpha2(c.toUpperCase())).filter(Boolean);
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
          end_year: { type: 'number', description: 'End year (default 2024)' },
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
          end_year: { type: 'number', description: 'End year (default 2024)' },
        },
        required: ['series_id'],
      },
    },
  ];

  return {
    fetchWithRetry,
    fetchWorldBankIndicator,
    fetchIMFIndicator,
    fetchFREDSeries,
    executeDataTool,
    DATA_TOOLS,
  };
}
