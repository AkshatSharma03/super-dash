import express from 'express';
import countries from 'i18n-iso-countries';

export function createPeersRouter(deps) {
  const {
    requireAuth,
    apiLimiter,
    validate,
    PeerComparisonSchema,
    normalizeCountryCode,
    normalizePeerMetricMetric,
    fetchWorldBankCountryCatalog,
    resolvePeerGroupMembers,
    resolvePeerComparisonYear,
    fetchPeerMetricRows,
    buildCountryValuesByCode,
    API_INDICATOR_LABELS,
    computeRank,
    percentileRank,
    computeMedian,
    computeAverage,
    groupTypeLabel,
    errorMessage,
  } = deps;

  const router = express.Router();

  router.get('/:countryCode', requireAuth, apiLimiter, async (req, res) => {
    const query = validate(PeerComparisonSchema, req.query, res);
    if (!query) return;

    const countryCode = normalizeCountryCode(req.params.countryCode);
    if (!countryCode || !countries.isValid(countryCode)) {
      return res.status(400).json({ error: `Invalid country code: ${req.params.countryCode}` });
    }

    const metric = normalizePeerMetricMetric(query.metric);
    const groupType = query.groupType || 'region';
    const requestedYear = Number.isFinite(query.year) ? query.year : null;

    try {
      const catalog = await fetchWorldBankCountryCatalog();
      const selectedMeta = catalog.find((item) => item.code === countryCode);
      if (!selectedMeta) {
        return res.status(404).json({ error: `Country catalog entry not found for ${countryCode}` });
      }

      const peers = resolvePeerGroupMembers(selectedMeta, groupType, catalog);

      const peerCodes = peers.map((p) => p.code);
      const peerCodesSet = new Set(peerCodes);

      const year = requestedYear ?? (await resolvePeerComparisonYear(countryCode, metric));
      if (!Number.isFinite(year)) {
        return res.status(404).json({ error: `No ${metric} data found for ${countryCode} in recent years` });
      }

      const peerRows = await fetchPeerMetricRows(metric, peerCodes, year, year);
      const valuesByCode = buildCountryValuesByCode(peerRows, year, peerCodesSet);
      const targetEntry = valuesByCode.get(countryCode);
      if (!targetEntry) {
        return res.status(404).json({ error: `No ${metric} value found for ${countryCode} in ${year}` });
      }

      const peerList = [];

      for (const peer of peers) {
        const item = valuesByCode.get(peer.code);
        if (!item) continue;
        peerList.push({
          code: peer.code,
          name: peer.name,
          flag: peer.flag,
          value: item.value,
        });
      }

      if (!peerList.length) {
        return res.status(404).json({ error: `No peers found for metric ${metric} in ${year}` });
      }

      const metricLabel = API_INDICATOR_LABELS[metric] || metric;
      const metricUnits = {
        gdp: 'USD',
        gdp_growth: '%',
        gdp_per_capita: 'USD',
        exports: 'USD',
        imports: 'USD',
        trade_openness: '%',
      };

      const peerValues = peerList.map((peer) => peer.value);

      const rowsWithRanks = peerList
        .map((peer) => ({
          ...peer,
          rank: computeRank(peerValues, peer.value) || 0,
          percentile: percentileRank(peerValues, peer.value) || 0,
        }))
        .sort((a, b) => a.rank - b.rank);

      const summary = {
        metric,
        metricLabel,
        metricUnit: metricUnits[metric] || '',
        groupType,
        groupName: groupTypeLabel(groupType, groupType === 'income' ? selectedMeta.incomeLevel : selectedMeta.region),
        year,
        peerCount: rowsWithRanks.length,
        totalPeerCount: peerList.length,
        isCapped: false,
        planLimit: null,
        excludedPeerCount: peers.length - peerList.length,
        excludedPeers: peers
          .filter((peer) => !valuesByCode.has(peer.code))
          .map((peer) => ({ code: peer.code, name: peer.name })),
        selectedCountryCode: countryCode,
        selectedCountryValue: targetEntry.value,
        selectedCountryRank: computeRank(peerValues, targetEntry.value),
        selectedCountryPercentile: percentileRank(peerValues, targetEntry.value),
        median: computeMedian(peerValues),
        average: computeAverage(peerValues),
      };

      if (summary.selectedCountryRank === null || summary.selectedCountryPercentile === null) {
        return res.status(500).json({ error: 'Failed to build peer ranking summary.' });
      }

      return res.json({
        peers: rowsWithRanks.map((row) => ({
          ...row,
          isTarget: row.code === countryCode,
        })),
        summary,
      });
    } catch (err) {
      const message = errorMessage(err, `Failed to build peer comparison for ${req.params.countryCode}`);
      console.error(`/api/peers/${req.params.countryCode}:`, message);
      return res.status(502).json({ error: message });
    }
  });

  return router;
}
