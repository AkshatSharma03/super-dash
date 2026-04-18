// Builds per-algorithm CSV exports for the Analytics dataset.

import type { CountryDataset } from "@/types";
import { toCSVString } from "@/utils/export";
import { buildForecast } from "@/algorithms/regression";
import { buildGenericHHITimeSeries } from "@/algorithms/hhi";
import { kmeans, labelClusters } from "@/algorithms/kmeans";
import { detectAllAnomaliesGeneric } from "@/algorithms/anomaly";
import { hpFilter } from "@/algorithms/hp_filter";
import { buildCAGRSeries } from "@/algorithms/cagr";
import { buildCorrelationMatrix } from "@/algorithms/correlation";

function tryBuildCsv(
  out: Record<string, string>,
  key: string,
  build: () => string,
) {
  try {
    out[key] = build();
  } catch {
    // Skip one failed algorithm export so the rest still download.
  }
}

function buildRegressionCsv(ds: CountryDataset) {
  const { points } = buildForecast(
    ds.gdpData.map((entry) => ({ year: entry.year, value: entry.gdp_bn })),
    [],
  );

  return toCSVString(
    [
      "year",
      "actual_gdp_bn",
      "trend_gdp_bn",
      "ci_low",
      "ci_high",
      "is_forecast",
    ],
    points.map((point) => [
      point.year,
      point.actual ?? "",
      point.trend ?? "",
      point.ciLow ?? "",
      point.ciHigh ?? "",
      point.isForecast ? 1 : 0,
    ]),
  );
}

function buildCagrCsv(ds: CountryDataset) {
  const { periods, fullPeriod } = buildCAGRSeries(
    ds.gdpData,
    ds.exportData,
    ds.importData,
  );

  return toCSVString(
    [
      "period",
      "start_year",
      "end_year",
      "gdp_cagr_pct",
      "exports_cagr_pct",
      "imports_cagr_pct",
      "per_capita_cagr_pct",
    ],
    [...periods, fullPeriod].map((series) => [
      series.label,
      series.startYear,
      series.endYear,
      series.gdp ?? "",
      series.exports ?? "",
      series.imports ?? "",
      series.perCapita ?? "",
    ]),
  );
}

function buildHpCsv(ds: CountryDataset) {
  const { points } = hpFilter(
    ds.gdpData.map((entry) => ({ year: entry.year, value: entry.gdp_bn })),
  );

  return toCSVString(
    ["year", "actual_gdp_bn", "trend_gdp_bn", "cycle_gdp_bn"],
    points.map((point) => [
      point.year,
      point.actual,
      +point.trend.toFixed(2),
      +point.cycle.toFixed(2),
    ]),
  );
}

function buildCorrelationCsv(ds: CountryDataset) {
  const { cells } = buildCorrelationMatrix(
    ds.gdpData,
    ds.exportData,
    ds.importData,
  );

  return toCSVString(
    ["variable_1", "variable_2", "pearson_r", "strength", "direction"],
    cells
      .filter((cell) => cell.rowLabel !== cell.colLabel)
      .map((cell) => [
        cell.rowLabel,
        cell.colLabel,
        +cell.r.toFixed(4),
        cell.strength,
        cell.direction,
      ]),
  );
}

function buildHhiCsv(ds: CountryDataset) {
  const hhi = buildGenericHHITimeSeries(
    ds.exportData,
    ds.importData,
    ds.exportSectors,
    ds.importPartners,
  );

  return toCSVString(
    ["year", "export_hhi", "export_level", "import_hhi", "import_level"],
    hhi.map((row) => [
      row.year,
      row.exportHHI,
      row.exportLevel,
      row.importHHI,
      row.importLevel,
    ]),
  );
}

function buildAnomalyCsv(ds: CountryDataset) {
  const anomalies = detectAllAnomaliesGeneric(
    ds.gdpData,
    ds.exportData,
    ds.importData,
  );

  return toCSVString(
    ["year", "metric", "value", "z_score", "direction", "severity"],
    anomalies.map((anomaly) => [
      anomaly.year,
      anomaly.metric,
      anomaly.value,
      +anomaly.zScore.toFixed(3),
      anomaly.direction,
      anomaly.severity,
    ]),
  );
}

function buildKmeansCsv(ds: CountryDataset) {
  const valid = ds.gdpData.filter((entry) => entry.gdp_growth != null);
  const years = valid.map((entry) => entry.year);
  const growths = valid.map((entry) => entry.gdp_growth!);
  const features = valid.map((entry) => [entry.gdp_growth!, entry.gdp_bn]);

  const { assignments } = kmeans(features, 3);
  const clusters = labelClusters(years, growths, assignments, 3);

  const yearCluster = new Map<number, string>();
  clusters.forEach((cluster) => {
    cluster.years.forEach((year) => {
      yearCluster.set(year, cluster.label);
    });
  });

  return toCSVString(
    ["year", "gdp_bn", "gdp_growth_pct", "cluster"],
    valid.map((entry) => [
      entry.year,
      entry.gdp_bn,
      entry.gdp_growth!,
      yearCluster.get(entry.year) ?? "",
    ]),
  );
}

function buildOpennessCsv(ds: CountryDataset) {
  const exportByYear = new Map(
    ds.exportData.map((entry) => [entry.year, entry.total]),
  );
  const importByYear = new Map(
    ds.importData.map((entry) => [entry.year, entry.total]),
  );

  return toCSVString(
    ["year", "exports_bn", "imports_bn", "gdp_bn", "openness_pct"],
    ds.gdpData.map((entry) => {
      const exp = exportByYear.get(entry.year) ?? 0;
      const imp = importByYear.get(entry.year) ?? 0;
      const openness =
        entry.gdp_bn > 0
          ? +(((exp + imp) / entry.gdp_bn) * 100).toFixed(1)
          : "";

      return [entry.year, exp || "", imp || "", entry.gdp_bn, openness];
    }),
  );
}

export function buildAlgoCSVs(ds: CountryDataset): Record<string, string> {
  const out: Record<string, string> = {};

  tryBuildCsv(out, "regression", () => buildRegressionCsv(ds));
  tryBuildCsv(out, "cagr", () => buildCagrCsv(ds));
  tryBuildCsv(out, "hp_filter", () => buildHpCsv(ds));
  tryBuildCsv(out, "correlation", () => buildCorrelationCsv(ds));
  tryBuildCsv(out, "hhi", () => buildHhiCsv(ds));
  tryBuildCsv(out, "anomaly", () => buildAnomalyCsv(ds));
  tryBuildCsv(out, "kmeans", () => buildKmeansCsv(ds));
  tryBuildCsv(out, "openness", () => buildOpennessCsv(ds));

  return out;
}

