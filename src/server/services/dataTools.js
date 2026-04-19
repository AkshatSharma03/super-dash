import countries from 'i18n-iso-countries';

export function createDataToolsService({
  rawDataCache,
  RAW_DATA_TTL_MS,
  IS_DEV,
  FRED_API_KEY,
  BOTMARKET_API_KEY,
  OECD_API_KEY,
  UN_COMTRADE_API_KEY,
}) {
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

  async function fetchOECDData(dataset, filter, startYear = 2000, endYear = 2024) {
    if (!OECD_API_KEY) throw new Error('OECD_API_KEY environment variable is not set');
    const url = `https://stats.oecd.org/SDMX-JSON/data/${dataset}/${filter}/all?startTime=${startYear}&endTime=${endYear}&dimensionAtObservation=AllDimensions`;
    const ck = `oecd:${url}`;
    const hit = rawDataCache.get(ck);
    if (hit) return hit;

    const res = await fetchWithRetry(
      url,
      {
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${OECD_API_KEY}`,
          'X-API-Key': OECD_API_KEY,
        },
      },
      2,
      1500,
      [429, 503],
      20000
    );
    const json = await res.json();
    const dataSet = json?.dataSets?.[0];
    const obsDims = json?.structure?.dimensions?.observation ?? [];
    const obsValues = obsDims.map((d) => d?.values ?? []);
    if (!dataSet?.observations || !obsDims.length) return [];

    const rows = [];
    for (const [obsKey, obsValue] of Object.entries(dataSet.observations)) {
      if (!Array.isArray(obsValue) || obsValue[0] == null) continue;
      const idx = String(obsKey).split(':').map((v) => Number.parseInt(v, 10));
      const dimensions = {};
      obsDims.forEach((dim, i) => {
        const val = obsValues[i]?.[idx[i]];
        const dimId = dim?.id || `dim_${i}`;
        dimensions[dimId] = val?.id ?? val?.name ?? null;
      });
      const period = dimensions.TIME_PERIOD || dimensions.time_period || null;
      const year = period ? Number.parseInt(String(period).slice(0, 4), 10) : null;
      rows.push({
        ...dimensions,
        period,
        year: Number.isFinite(year) ? year : null,
        value: Number(obsValue[0]),
      });
    }

    const result = rows
      .filter((r) => Number.isFinite(r.value))
      .sort((a, b) => (a.year ?? 0) - (b.year ?? 0));

    rawDataCache.put(ck, result, RAW_DATA_TTL_MS);
    return result;
  }

  function normalizeBotMarketRows(payload) {
    if (Array.isArray(payload)) return payload;
    if (!payload || typeof payload !== 'object') return [];
    if (Array.isArray(payload.rows)) return payload.rows;
    if (Array.isArray(payload.data)) return payload.data;
    if (Array.isArray(payload.results)) return payload.results;
    return [];
  }

  async function fetchBotMarketData({
    slug,
    filters = {},
    limit = 1000,
    offset = 0,
    format = 'json',
  }) {
    if (!BOTMARKET_API_KEY) {
      throw new Error('BOTMARKET_API_KEY environment variable is not set');
    }
    if (!slug || typeof slug !== 'string') {
      throw new Error('BotMarket dataset slug is required');
    }

    const url = new URL(`https://botmarket.oec.world/api/datasets/${encodeURIComponent(slug)}/query`);
    url.searchParams.set('limit', String(limit));
    url.searchParams.set('offset', String(offset));
    if (format && format !== 'json') {
      url.searchParams.set('format', String(format));
    }

    if (filters && typeof filters === 'object') {
      for (const [key, rawValue] of Object.entries(filters)) {
        if (rawValue == null || key === 'limit' || key === 'offset' || key === 'format') continue;
        if (Array.isArray(rawValue)) {
          for (const v of rawValue) {
            if (v == null || v === '') continue;
            url.searchParams.append(key, String(v));
          }
          continue;
        }
        if (rawValue === '') continue;
        url.searchParams.set(key, String(rawValue));
      }
    }

    const requestUrl = url.toString();
    const ck = `botmarket:${requestUrl}`;
    const hit = rawDataCache.get(ck);
    if (hit) return hit;

    const res = await fetchWithRetry(
      requestUrl,
      {
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${BOTMARKET_API_KEY}`,
        },
      },
      2,
      1500,
      [402, 429, 500, 502, 503, 504],
      25000
    );
    const json = await res.json();
    const rows = normalizeBotMarketRows(json);
    const result = {
      rows,
      meta: {
        balance_remaining: json?.balance_remaining ?? null,
        max_rows_per_query: json?.max_rows_per_query ?? null,
      },
    };

    rawDataCache.put(ck, result, RAW_DATA_TTL_MS);
    return result;
  }

  async function fetchUNComtrade({
    reporterCode,
    partnerCode = '0',
    flowCode = 'X',
    cmdCode = 'TOTAL',
    period = '2023',
    frequency = 'A',
    type = 'C',
    classification = 'HS',
  }) {
    if (!UN_COMTRADE_API_KEY) throw new Error('UN_COMTRADE_API_KEY environment variable is not set');
    const url = new URL(`https://api.uncomtrade.org/data/v1/get/${type}/${frequency}/${classification}`);
    url.searchParams.set('reporterCode', String(reporterCode));
    url.searchParams.set('partnerCode', String(partnerCode));
    url.searchParams.set('flowCode', String(flowCode));
    url.searchParams.set('cmdCode', String(cmdCode));
    url.searchParams.set('period', String(period));
    url.searchParams.set('format', 'json');

    const ck = `comtrade:${url.toString()}`;
    const hit = rawDataCache.get(ck);
    if (hit) return hit;

    const res = await fetchWithRetry(
      url.toString(),
      {
        headers: {
          Accept: 'application/json',
          'Ocp-Apim-Subscription-Key': UN_COMTRADE_API_KEY,
          'X-API-Key': UN_COMTRADE_API_KEY,
        },
      },
      2,
      1500,
      [429, 503],
      25000
    );
    const json = await res.json();
    const records = Array.isArray(json?.data) ? json.data : [];

    const rows = records
      .map((r) => {
        const periodStr = String(r.period ?? '');
        const year = Number.parseInt(periodStr.slice(0, 4), 10);
        const value = r.primaryValue ?? r.tradeValue ?? r.TradeValue ?? null;
        return {
          year: Number.isFinite(year) ? year : null,
          period: r.period ?? null,
          flowCode: r.flowCode ?? flowCode,
          flow: r.flowDesc ?? null,
          reporterCode: r.reporterCode ?? reporterCode,
          reporter: r.reporterDesc ?? null,
          partnerCode: r.partnerCode ?? partnerCode,
          partner: r.partnerDesc ?? null,
          cmdCode: r.cmdCode ?? cmdCode,
          commodity: r.cmdDesc ?? null,
          value: value != null ? Number(value) : null,
        };
      })
      .filter((r) => Number.isFinite(r.value))
      .sort((a, b) => (a.year ?? 0) - (b.year ?? 0));

    rawDataCache.put(ck, rows, RAW_DATA_TTL_MS);
    return rows;
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

    if (name === 'fetch_oecd') {
      const { dataset, filter, start_year = 2000, end_year = 2024 } = input;
      const rows = await fetchOECDData(dataset, filter, start_year, end_year);
      if (rows.length === 0) throw new Error('OECD returned no data for this query');
      const sourceUrl = `https://stats.oecd.org/`;
      return JSON.stringify({ rows, source: 'OECD Data', dataset, filter, sourceUrl });
    }

    if (name === 'fetch_botmarket') {
      const {
        slug,
        filters = {},
        limit = 1000,
        offset = 0,
        format = 'json',
      } = input;
      const result = await fetchBotMarketData({ slug, filters, limit, offset, format });
      if (!Array.isArray(result.rows) || result.rows.length === 0) {
        throw new Error('BotMarket returned no data for this query');
      }
      return JSON.stringify({
        rows: result.rows,
        source: 'OEC BotMarket',
        slug,
        filters,
        sourceUrl: `https://botmarket.oec.world/api/datasets/${encodeURIComponent(slug)}/query`,
        ...result.meta,
      });
    }

    if (name === 'fetch_un_comtrade') {
      const {
        reporter_code,
        partner_code = '0',
        flow_code = 'X',
        cmd_code = 'TOTAL',
        period = '2023',
        frequency = 'A',
        type = 'C',
        classification = 'HS',
      } = input;
      const rows = await fetchUNComtrade({
        reporterCode: reporter_code,
        partnerCode: partner_code,
        flowCode: flow_code,
        cmdCode: cmd_code,
        period,
        frequency,
        type,
        classification,
      });
      if (rows.length === 0) throw new Error('UN Comtrade returned no data for this query');
      const sourceUrl = `https://comtradeplus.un.org/`;
      return JSON.stringify({
        rows,
        source: 'UN Comtrade',
        reporter_code,
        partner_code,
        flow_code,
        cmd_code,
        period,
        sourceUrl,
      });
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
    {
      name: 'fetch_un_comtrade',
      description: 'Fetch verified merchandise trade data from UN Comtrade. Use for bilateral trade flows and commodity-level trade values.',
      input_schema: {
        type: 'object',
        properties: {
          reporter_code: {
            type: 'string',
            description: 'UN Comtrade reporter numeric code, e.g. "840" (USA), "156" (China), "276" (Germany).',
          },
          partner_code: {
            type: 'string',
            description: 'Partner numeric code. Use "0" for world aggregate. Default "0".',
          },
          flow_code: {
            type: 'string',
            description: 'Trade flow: "X" exports, "M" imports. Default "X".',
          },
          cmd_code: {
            type: 'string',
            description: 'Commodity code, e.g. "TOTAL" for all products or HS code. Default "TOTAL".',
          },
          period: {
            type: 'string',
            description: 'Year(s), e.g. "2023" or "2020,2021,2022,2023". Default "2023".',
          },
          frequency: {
            type: 'string',
            description: 'Frequency, usually "A" for annual. Default "A".',
          },
          type: {
            type: 'string',
            description: 'Trade type: "C" commodities (default) or "S" services.',
          },
          classification: {
            type: 'string',
            description: 'Commodity classification, default "HS".',
          },
        },
        required: ['reporter_code'],
      },
    },
  ];

  if (BOTMARKET_API_KEY) {
    DATA_TOOLS.push({
      name: 'fetch_botmarket',
      description: 'Fetch data from OEC BotMarket (Datawheel) using your BotMarket API key. Use this for OECD-like and broader datasets (trade, demographics, debt, labor, education, health, housing, governance, fiscal policy, productivity, skills, social indicators, US ACS).',
      input_schema: {
        type: 'object',
        properties: {
          slug: {
            type: 'string',
            description: 'BotMarket dataset slug from catalog, e.g. "oec_..."',
          },
          filters: {
            type: 'object',
            description: 'Optional query filters as key-value pairs. Values can be a string/number/boolean or an array for multi-value filters.',
          },
          limit: {
            type: 'number',
            description: 'Max rows to return (default 1000).',
          },
          offset: {
            type: 'number',
            description: 'Pagination offset (default 0).',
          },
          format: {
            type: 'string',
            description: 'Response format: "json" (default), or "csv"/"parquet" when supported.',
          },
        },
        required: ['slug'],
      },
    });
  }

  if (OECD_API_KEY) {
    DATA_TOOLS.push({
      name: 'fetch_oecd',
      description: 'Fetch verified OECD SDMX data. Best for OECD economies and structural indicators when World Bank/IMF series are not sufficient.',
      input_schema: {
        type: 'object',
        properties: {
          dataset: {
            type: 'string',
            description: 'OECD SDMX dataset code (e.g. "MEI", "QNA").',
          },
          filter: {
            type: 'string',
            description: 'OECD SDMX filter path segment (e.g. "USA.CPALTT01.IXOB.A").',
          },
          start_year: { type: 'number', description: 'Start year (default 2000)' },
          end_year: { type: 'number', description: 'End year (default 2024)' },
        },
        required: ['dataset', 'filter'],
      },
    });
  }

  return {
    fetchWithRetry,
    fetchWorldBankIndicator,
    fetchIMFIndicator,
    fetchFREDSeries,
    fetchBotMarketData,
    fetchOECDData,
    fetchUNComtrade,
    executeDataTool,
    DATA_TOOLS,
  };
}
