// ─────────────────────────────────────────────────────────────────────────────
// ANALYTICS MODE  —  algorithm suite + AI query for any country's data.
//
// 1. Country selector  — same UX as Country Data tab (search + popular picks)
// 2. Algorithm picker  — 8 toggleable algorithms, run reactively on loaded data
// 3. AI query          — free-text question sent with country data as context
//
// Algorithms (all implemented from scratch in src/algorithms/):
//   OLS Regression · HHI Trade Concentration · K-Means Clustering
//   Z-Score Anomaly Detection · Hodrick-Prescott Filter · CAGR Analysis
//   Pearson Correlation Matrix · Trade Openness Index
// ─────────────────────────────────────────────────────────────────────────────
import { useState, useEffect, useRef, useMemo } from "react";
import { useMobile } from "../../utils/useMobile";
import {
  ComposedChart, Bar, Line, Area, BarChart,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, ReferenceLine, Cell,
} from "recharts";
import type { CountryDataset, CountrySearchResult, AIResponse } from "../../types";
import { searchCountries, getCountryHistory, queryAnalytics } from "../../utils/api";
import { TT, GRID, AX, LEG } from "../../config/styles";
import { AnalyticsCard, Stat, DynChart } from "../ui";

// ── Algorithms ────────────────────────────────────────────────────────────────
import { buildForecast }               from "../../algorithms/regression";
import { buildGenericHHITimeSeries }   from "../../algorithms/hhi";
import { kmeans, labelClusters }       from "../../algorithms/kmeans";
import { detectAllAnomaliesGeneric }   from "../../algorithms/anomaly";
import { hpFilter }                    from "../../algorithms/hp_filter";
import { buildCAGRSeries }             from "../../algorithms/cagr";
import { buildCorrelationMatrix }      from "../../algorithms/correlation";
import type { AnomalyPoint }           from "../../algorithms/anomaly";

// ── Popular quick-picks ───────────────────────────────────────────────────────
const POPULAR: CountrySearchResult[] = [
  { code: "US", name: "United States", flag: "🇺🇸", region: "North America" },
  { code: "CN", name: "China",         flag: "🇨🇳", region: "East Asia" },
  { code: "DE", name: "Germany",       flag: "🇩🇪", region: "Europe" },
  { code: "JP", name: "Japan",         flag: "🇯🇵", region: "East Asia" },
  { code: "GB", name: "United Kingdom",flag: "🇬🇧", region: "Europe" },
  { code: "IN", name: "India",         flag: "🇮🇳", region: "South Asia" },
  { code: "BR", name: "Brazil",        flag: "🇧🇷", region: "Latin America" },
  { code: "FR", name: "France",        flag: "🇫🇷", region: "Europe" },
];

// ── Algorithm catalogue ───────────────────────────────────────────────────────
interface AlgoDef { id: string; name: string; desc: string; color: string; }
const ALGOS: AlgoDef[] = [
  { id: "regression",  name: "OLS Regression",    desc: "GDP trend forecast with 95% confidence band",   color: "#00AAFF" },
  { id: "hhi",         name: "HHI Concentration", desc: "Trade concentration index over time",            color: "#8B5CF6" },
  { id: "kmeans",      name: "K-Means Clustering",desc: "Unsupervised economic era detection (k=3)",      color: "#10B981" },
  { id: "anomaly",     name: "Z-Score Anomaly",   desc: "Statistical outliers across 6 economic metrics", color: "#EF4444" },
  { id: "hp",          name: "HP Filter",         desc: "Hodrick-Prescott business cycle decomposition",  color: "#F97316" },
  { id: "cagr",        name: "CAGR Analysis",     desc: "Compound annual growth rates by period",         color: "#F59E0B" },
  { id: "correlation", name: "Correlation Matrix",desc: "Pearson r between GDP, trade, and growth",       color: "#06B6D4" },
  { id: "openness",    name: "Trade Openness",    desc: "(Exports + Imports) / GDP × 100 over time",      color: "#A78BFA" },
];
const DEFAULT_ALGOS = new Set(["regression", "anomaly", "cagr", "hp"]);

// ── Shared custom tooltip ─────────────────────────────────────────────────────
interface TTEntry { dataKey: string; name: string; value: number | null; color?: string; }
function ChartTip({ active, payload, label }: { active?: boolean; payload?: TTEntry[]; label?: string | number }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: "#0f1117", border: "1px solid #2d3348", borderRadius: 8, padding: "10px 14px", fontSize: 12 }}>
      <p style={{ color: "#94a3b8", fontWeight: 600, margin: "0 0 6px" }}>{label}</p>
      {payload.filter(p => p.dataKey !== "ciLow").map((p, i) => (
        <p key={i} style={{ color: "#e2e8f0", margin: "3px 0", display: "flex", gap: 8, alignItems: "center" }}>
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: p.color ?? "#e2e8f0", flexShrink: 0, display: "inline-block" }} />
          <span style={{ color: "#94a3b8" }}>{p.name}:</span>
          <span style={{ fontWeight: 600 }}>{p.value === null ? "—" : p.value}</span>
        </p>
      ))}
    </div>
  );
}

// ── Algorithm panels ──────────────────────────────────────────────────────────

function RegressionPanel({ dataset }: { dataset: CountryDataset }) {
  const { points, model } = useMemo(() => {
    const valid = dataset.gdpData.filter(d => d.gdp_bn != null);
    const lastYear = valid[valid.length - 1]?.year ?? 2024;
    return buildForecast(
      valid.map(d => ({ year: d.year, value: d.gdp_bn })),
      [lastYear + 1, lastYear + 2, lastYear + 3],
    );
  }, [dataset]);

  return (
    <AnalyticsCard title={`${dataset.name} GDP Forecast — OLS Regression`}
      subtitle="β = (XᵀX)⁻¹Xᵀy · dashed region = 95% prediction interval"
      badge="Linear Regression" badgeColor="#00AAFF">
      <div style={{ display: "flex", gap: 24, marginBottom: 14, flexWrap: "wrap" }}>
        <Stat label="Slope"  value={`+$${model.slope.toFixed(1)}B/yr`} color="#00AAFF" />
        <Stat label="R²"     value={`${(model.r2 * 100).toFixed(1)}%`} color="#10B981" />
        <Stat label="+1 yr"  value={`$${model.predict(points[points.length - 2]?.year ?? 2025).toFixed(0)}B`} color="#F59E0B" />
        <Stat label="+2 yr"  value={`$${model.predict(points[points.length - 1]?.year ?? 2026).toFixed(0)}B`} color="#F97316" />
      </div>
      <ResponsiveContainer width="100%" height={240}>
        <ComposedChart data={points} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
          <CartesianGrid {...GRID} />
          <XAxis dataKey="year" tick={AX} />
          <YAxis tick={AX} domain={["auto", "auto"]} />
          <Tooltip content={<ChartTip />} />
          <Legend {...LEG} />
          <Area dataKey="ciLow"  name="CI Low"      fill="transparent" stroke="transparent" legendType="none" />
          <Area dataKey="ciHigh" name="95% CI Band" fill="#00AAFF" fillOpacity={0.08} stroke="none" />
          <Bar  dataKey="actual" name="Actual GDP ($B)" fill="#00AAFF" opacity={0.75} radius={[3, 3, 0, 0]} />
          <Line dataKey="trend"  name="OLS Trend" stroke="#F59E0B" strokeWidth={2} dot={{ r: 3 }} connectNulls strokeDasharray="5 3" />
        </ComposedChart>
      </ResponsiveContainer>
      <p style={{ margin: "10px 0 0", fontSize: 11, color: "#64748b" }}>RSE = ${model.rse.toFixed(1)}B. Forecast bars are blank — only the trend line extends forward.</p>
    </AnalyticsCard>
  );
}

function HHIPanel({ dataset }: { dataset: CountryDataset }) {
  const series = useMemo(() =>
    buildGenericHHITimeSeries(dataset.exportData, dataset.importData, dataset.exportSectors, dataset.importPartners),
    [dataset]);
  const latest = series[series.length - 1];
  if (!latest) return (
    <AnalyticsCard title="HHI" badge="HHI" badgeColor="#8B5CF6">
      <p style={{ color: "#64748b", fontSize: 13 }}>Not enough trade data.</p>
    </AnalyticsCard>
  );

  return (
    <AnalyticsCard title={`${dataset.name} Trade Concentration — HHI`}
      subtitle="HHI = Σ(sᵢ%)². <1500 competitive · 1500–2500 moderate · >2500 concentrated"
      badge="HHI Algorithm" badgeColor="#8B5CF6">
      <div style={{ display: "flex", gap: 24, marginBottom: 14, flexWrap: "wrap" }}>
        <Stat label="Import HHI" value={String(latest.importHHI)} color={latest.importHHI < 1500 ? "#10B981" : latest.importHHI < 2500 ? "#F59E0B" : "#EF4444"} />
        <Stat label="Level"      value={latest.importLevel}       color="#94a3b8" />
        <Stat label="Export HHI" value={String(latest.exportHHI)} color={latest.exportHHI < 2500 ? "#F59E0B" : "#EF4444"} />
        <Stat label="Level"      value={latest.exportLevel}       color="#94a3b8" />
      </div>
      <ResponsiveContainer width="100%" height={220}>
        <ComposedChart data={series} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
          <CartesianGrid {...GRID} />
          <XAxis dataKey="year" tick={AX} />
          <YAxis tick={AX} domain={[0, 7000]} />
          <Tooltip {...TT} />
          <Legend {...LEG} />
          <ReferenceLine y={1500} stroke="#F59E0B" strokeDasharray="4 3" label={{ value: "Moderate", fill: "#F59E0B", fontSize: 10 }} />
          <ReferenceLine y={2500} stroke="#EF4444" strokeDasharray="4 3" label={{ value: "Concentrated", fill: "#EF4444", fontSize: 10 }} />
          <Line dataKey="importHHI" name="Import HHI" stroke="#8B5CF6" strokeWidth={2.5} dot={{ r: 4 }} />
          <Line dataKey="exportHHI" name="Export HHI" stroke="#F97316" strokeWidth={2.5} dot={{ r: 4 }} />
        </ComposedChart>
      </ResponsiveContainer>
    </AnalyticsCard>
  );
}

function KMeansPanel({ dataset }: { dataset: CountryDataset }) {
  const { clusters, chartData } = useMemo(() => {
    const valid = dataset.gdpData.filter(d => d.gdp_growth != null && d.gdp_per_capita != null);
    const features = valid.map(d => [d.gdp_growth!, d.gdp_per_capita! / 1000, d.digital_pct ?? 0]);
    const years    = valid.map(d => d.year);
    const growths  = valid.map(d => d.gdp_growth!);
    const k = 3;
    const result  = kmeans(features, k);
    const labeled = labelClusters(years, growths, result.assignments, k);

    const colorByYear:   Record<number, string> = {};
    const clusterByYear: Record<number, string> = {};
    labeled.forEach(cl => cl.years.forEach(y => { colorByYear[y] = cl.color; clusterByYear[y] = cl.label; }));

    return {
      clusters: labeled,
      chartData: valid.map(d => ({
        year:       d.year,
        gdp_growth: d.gdp_growth,
        cluster:    clusterByYear[d.year] ?? "—",
        fill:       colorByYear[d.year]   ?? "#64748b",
      })),
    };
  }, [dataset]);

  return (
    <AnalyticsCard title={`${dataset.name} Economic Eras — K-Means (k=3)`}
      subtitle="Features: GDP growth, GDP/capita, digital %. K-Means++ init, z-score normalised."
      badge="K-Means" badgeColor="#10B981">
      <div style={{ display: "flex", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
        {clusters.map(cl => (
          <div key={cl.id} style={{ display: "flex", alignItems: "center", gap: 8, background: cl.color + "18", borderRadius: 8, padding: "5px 10px", border: `1px solid ${cl.color}44` }}>
            <div style={{ width: 9, height: 9, borderRadius: "50%", background: cl.color }} />
            <span style={{ fontSize: 11, fontWeight: 700, color: cl.color }}>{cl.label}</span>
            <span style={{ fontSize: 10, color: "#64748b" }}>{cl.years.join(", ")} · avg {cl.avgGrowth > 0 ? "+" : ""}{cl.avgGrowth}%</span>
          </div>
        ))}
      </div>
      <ResponsiveContainer width="100%" height={200}>
        <BarChart data={chartData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
          <CartesianGrid {...GRID} />
          <XAxis dataKey="year" tick={AX} />
          <YAxis tick={AX} />
          <Tooltip {...TT} formatter={(v: number, _n: string, p: { payload?: { cluster?: string } }) =>
            [`${v > 0 ? "+" : ""}${v}%`, `GDP Growth (${p.payload?.cluster ?? ""})`]
          } />
          <ReferenceLine y={0} stroke="#2d3348" />
          <Bar dataKey="gdp_growth" name="GDP Growth %" radius={[3, 3, 0, 0]}>
            {chartData.map((d, i) => <Cell key={i} fill={d.fill} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </AnalyticsCard>
  );
}

const SEV_COLOR: Record<string, string> = { extreme: "#EF4444", strong: "#F97316", moderate: "#F59E0B" };
const DIR_ICON:  Record<string, string> = { high: "▲", low: "▼" };

function AnomalyPanel({ dataset }: { dataset: CountryDataset }) {
  const anomalies: AnomalyPoint[] = useMemo(() =>
    detectAllAnomaliesGeneric(dataset.gdpData, dataset.exportData, dataset.importData),
    [dataset]);

  const yearCounts: Record<number, number> = {};
  anomalies.forEach(a => { yearCounts[a.year] = (yearCounts[a.year] ?? 0) + 1; });
  const allYears  = [...new Set([...dataset.gdpData, ...dataset.exportData].map(d => d.year))].sort();
  const countData = allYears.map(y => ({ year: y, anomalies: yearCounts[y] ?? 0 }));

  return (
    <AnalyticsCard title={`${dataset.name} Anomaly Detection — Z-Score`}
      subtitle="Flags |z| = |(x − μ) / σ| > 1.5 across GDP, trade, and balance metrics"
      badge="Z-Score" badgeColor="#EF4444">
      <ResponsiveContainer width="100%" height={90}>
        <BarChart data={countData} margin={{ top: 0, right: 20, left: 0, bottom: 0 }}>
          <XAxis dataKey="year" tick={AX} />
          <YAxis tick={AX} allowDecimals={false} width={20} />
          <Tooltip {...TT} formatter={(v: number) => [v, "Anomalies"]} />
          <Bar dataKey="anomalies" name="Anomalies" radius={[3, 3, 0, 0]}>
            {countData.map((d, i) => <Cell key={i} fill={d.anomalies === 0 ? "#2d3348" : d.anomalies >= 3 ? "#EF4444" : "#F97316"} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 5, maxHeight: 220, overflowY: "auto" }}>
        {anomalies.slice(0, 12).map((a, i) => {
          const col = SEV_COLOR[a.severity];
          return (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 8px", background: col + "11", border: `1px solid ${col}33`, borderRadius: 7 }}>
              <span style={{ color: col, fontWeight: 700, minWidth: 16, fontSize: 11 }}>{DIR_ICON[a.direction]}</span>
              <span style={{ color: "#00AAFF", fontWeight: 700, minWidth: 32, fontSize: 11 }}>{a.year}</span>
              <span style={{ color: "#94a3b8", flex: 1, fontSize: 11 }}>{a.metric}</span>
              <span style={{ color: col, fontWeight: 700, fontSize: 10 }}>z={a.zScore > 0 ? "+" : ""}{a.zScore}σ</span>
              <span style={{ color: "#64748b", fontSize: 10 }}>{a.annotation}</span>
            </div>
          );
        })}
      </div>
      <p style={{ margin: "8px 0 0", fontSize: 11, color: "#64748b" }}>
        {anomalies.length} anomalous data points across {Object.keys(yearCounts).length} years.
      </p>
    </AnalyticsCard>
  );
}

function HPPanel({ dataset }: { dataset: CountryDataset }) {
  const result = useMemo(() => {
    const valid = dataset.gdpData.filter(d => d.gdp_bn != null);
    return hpFilter(valid.map(d => ({ year: d.year, value: d.gdp_bn })), 100);
  }, [dataset]);

  return (
    <AnalyticsCard title={`${dataset.name} Business Cycle — HP Filter`}
      subtitle="Decomposes GDP into trend τ and cycle c = y − τ  (λ = 100 for annual data)"
      badge="HP Filter" badgeColor="#F97316">
      <div style={{ display: "flex", gap: 16, marginBottom: 14, flexWrap: "wrap" }}>
        <Stat label="λ"           value="100"                              color="#F97316" />
        <Stat label="Avg |cycle|" value={`$${result.avgCycleAmplitude}B`}  color="#EF4444" />
        <Stat label="Points"      value={String(result.points.length)}      color="#94a3b8" />
      </div>
      <ResponsiveContainer width="100%" height={220}>
        <ComposedChart data={result.points} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
          <CartesianGrid {...GRID} />
          <XAxis dataKey="year" tick={AX} />
          <YAxis yAxisId="left"  tick={AX} />
          <YAxis yAxisId="right" orientation="right" tick={AX} />
          <Tooltip {...TT} />
          <Legend {...LEG} />
          <ReferenceLine yAxisId="right" y={0} stroke="#2d3348" />
          <Bar  yAxisId="left"  dataKey="actual" name="Actual GDP ($B)"      fill="#F97316" opacity={0.55} radius={[3, 3, 0, 0]} />
          <Line yAxisId="left"  dataKey="trend"  name="Trend (τ)"            stroke="#00AAFF" strokeWidth={2.5} dot={false} />
          <Line yAxisId="right" dataKey="cycle"  name="Cycle (right axis)"   stroke="#EF4444" strokeWidth={1.5} dot={{ r: 2 }} strokeDasharray="4 2" />
        </ComposedChart>
      </ResponsiveContainer>
      <p style={{ margin: "8px 0 0", fontSize: 11, color: "#64748b" }}>Positive cycle = above-trend expansion; negative = below-trend contraction.</p>
    </AnalyticsCard>
  );
}

function CAGRPanel({ dataset }: { dataset: CountryDataset }) {
  const result = useMemo(() =>
    buildCAGRSeries(dataset.gdpData, dataset.exportData, dataset.importData),
    [dataset]);

  const chartData = [result.fullPeriod, ...result.periods].map(p => ({
    label:   p.label,
    GDP:     p.gdp,
    Exports: p.exports,
    Imports: p.imports,
    PerCap:  p.perCapita,
  }));

  return (
    <AnalyticsCard title={`${dataset.name} CAGR Analysis`}
      subtitle="CAGR = (end/start)^(1/years) − 1  ·  all figures in % per year"
      badge="CAGR" badgeColor="#F59E0B">
      <div style={{ display: "flex", gap: 24, marginBottom: 14, flexWrap: "wrap" }}>
        <Stat label="Full period GDP CAGR" value={result.fullPeriod.gdp != null ? `${result.fullPeriod.gdp > 0 ? "+" : ""}${result.fullPeriod.gdp}%` : "—"} color="#F59E0B" />
        <Stat label="Fastest period"       value={result.fastestGDPPeriod} color="#10B981" />
        <Stat label="Slowest period"       value={result.slowestGDPPeriod} color="#EF4444" />
      </div>
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={chartData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
          <CartesianGrid {...GRID} />
          <XAxis dataKey="label" tick={{ ...AX, fontSize: 10 }} />
          <YAxis tick={AX} unit="%" />
          <Tooltip {...TT} formatter={(v: unknown) => { const n = v as number | null; return n != null ? [`${n > 0 ? "+" : ""}${n}%`, "CAGR"] : ["N/A", "CAGR"]; }} />
          <Legend {...LEG} />
          <ReferenceLine y={0} stroke="#2d3348" />
          <Bar dataKey="GDP"     name="GDP CAGR"         fill="#F59E0B" radius={[3, 3, 0, 0]} />
          <Bar dataKey="Exports" name="Exports CAGR"     fill="#10B981" radius={[3, 3, 0, 0]} />
          <Bar dataKey="Imports" name="Imports CAGR"     fill="#EF4444" radius={[3, 3, 0, 0]} />
          <Bar dataKey="PerCap"  name="Per Capita CAGR"  fill="#8B5CF6" radius={[3, 3, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </AnalyticsCard>
  );
}

function rToColor(r: number): string {
  const a = Math.abs(r);
  if (a < 0.15) return "#2d3348";
  if (r > 0)    return `rgba(16,185,129,${Math.min(1, a * 0.9)})`;
  return             `rgba(239,68,68,${Math.min(1, a * 0.9)})`;
}

function CorrelationPanel({ dataset }: { dataset: CountryDataset }) {
  const result = useMemo(() =>
    buildCorrelationMatrix(dataset.gdpData, dataset.exportData, dataset.importData),
    [dataset]);

  return (
    <AnalyticsCard title={`${dataset.name} Correlation Matrix — Pearson r`}
      subtitle="r(X,Y) = Σ[(xᵢ−x̄)(yᵢ−ȳ)] / √[Σ(xᵢ−x̄)²·Σ(yᵢ−ȳ)²]  ·  green = positive, red = negative"
      badge="Correlation" badgeColor="#06B6D4">
      {result.strongestPair && (
        <p style={{ margin: "0 0 12px", fontSize: 12, color: "#94a3b8" }}>
          Strongest pair: <span style={{ color: "#06B6D4", fontWeight: 700 }}>{result.strongestPair.row} ↔ {result.strongestPair.col}</span>
          {" "}(r = {result.strongestPair.r > 0 ? "+" : ""}{result.strongestPair.r})
        </p>
      )}
      <div style={{ overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", fontSize: 11, width: "100%", borderSpacing: 2 }}>
          <thead>
            <tr>
              <th style={{ padding: "4px 8px", color: "#475569", textAlign: "left" }} />
              {result.variables.map(v => (
                <th key={v} title={v} style={{ padding: "4px 6px", color: "#475569", fontWeight: 600, textAlign: "center", maxWidth: 70, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {v.replace(" ($B)", "").replace(" (%)", "")}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {result.variables.map(row => (
              <tr key={row}>
                <td style={{ padding: "4px 8px", color: "#94a3b8", fontWeight: 600, whiteSpace: "nowrap" }}>
                  {row.replace(" ($B)", "").replace(" (%)", "")}
                </td>
                {result.variables.map(col => {
                  const cell = result.cells.find(c => c.rowLabel === row && c.colLabel === col);
                  const r = cell?.r ?? 0;
                  const isDiag = row === col;
                  return (
                    <td key={col} title={`${row} ↔ ${col}: r = ${r}`} style={{
                      padding: "5px 6px", textAlign: "center",
                      background: isDiag ? "#1e2130" : rToColor(r),
                      color: isDiag ? "#64748b" : Math.abs(r) > 0.3 ? "#e2e8f0" : "#94a3b8",
                      fontWeight: Math.abs(r) > 0.6 ? 700 : 500, borderRadius: 4,
                    }}>
                      {isDiag ? "—" : (r > 0 ? "+" : "") + r.toFixed(2)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </AnalyticsCard>
  );
}

function OpennessPanel({ dataset }: { dataset: CountryDataset }) {
  const chartData = useMemo(() => {
    const gdpMap = new Map(dataset.gdpData.map(d => [d.year, d.gdp_bn]));
    const expMap = new Map(dataset.exportData.map(d => [d.year, d.total]));
    const impMap = new Map(dataset.importData.map(d => [d.year, d.total]));

    return [...gdpMap.keys()].sort().map(year => {
      const gdp = gdpMap.get(year) ?? 0;
      const exp = expMap.get(year) ?? 0;
      const imp = impMap.get(year) ?? 0;
      const openness = gdp > 0 ? +((exp + imp) / gdp * 100).toFixed(1) : null;
      return { year, openness, exports: exp, imports: imp };
    }).filter(d => d.openness != null);
  }, [dataset]);

  const avg    = chartData.length ? +(chartData.reduce((s, d) => s + (d.openness ?? 0), 0) / chartData.length).toFixed(1) : 0;
  const latest = chartData[chartData.length - 1];

  return (
    <AnalyticsCard title={`${dataset.name} Trade Openness`}
      subtitle="Openness = (Exports + Imports) / GDP × 100  ·  > 100% = highly globalised economy"
      badge="Openness" badgeColor="#A78BFA">
      <div style={{ display: "flex", gap: 16, marginBottom: 14, flexWrap: "wrap" }}>
        <Stat label="Latest"  value={latest ? `${latest.openness}%` : "—"} color="#A78BFA" />
        <Stat label="Average" value={`${avg}%`}                             color="#94a3b8" />
      </div>
      <ResponsiveContainer width="100%" height={200}>
        <ComposedChart data={chartData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
          <CartesianGrid {...GRID} />
          <XAxis dataKey="year" tick={AX} />
          <YAxis tick={AX} unit="%" domain={["auto", "auto"]} />
          <Tooltip {...TT} formatter={(v: number) => [`${v}%`, "Trade Openness"]} />
          <Legend {...LEG} />
          <ReferenceLine y={100} stroke="#F59E0B" strokeDasharray="4 3" label={{ value: "100%", fill: "#F59E0B", fontSize: 10 }} />
          <Area dataKey="openness" name="Openness %" fill="#A78BFA" fillOpacity={0.15} stroke="#A78BFA" strokeWidth={2.5} dot={{ r: 3 }} />
        </ComposedChart>
      </ResponsiveContainer>
    </AnalyticsCard>
  );
}

// ── AI Query result panel ─────────────────────────────────────────────────────
function AIResultPanel({ result }: { result: AIResponse }) {
  return (
    <div style={{ background: "#161929", borderRadius: 12, padding: 20, border: "1px solid #2d3348", borderTop: "2px solid #8B5CF644" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
        <span style={{ fontSize: 9, fontWeight: 700, padding: "2px 8px", borderRadius: 4, background: "#8B5CF622", color: "#8B5CF6", border: "1px solid #8B5CF644", textTransform: "uppercase", letterSpacing: "0.5px" }}>AI Analysis</span>
      </div>
      {result.insight && (
        <p style={{ margin: "0 0 16px", fontSize: 14, color: "#cbd5e1", lineHeight: 1.75 }}>{result.insight}</p>
      )}
      {result.charts?.map(c => (
        <div key={c.id} style={{ marginBottom: 16 }}>
          <p style={{ margin: "0 0 6px", fontSize: 13, fontWeight: 700, color: "#e2e8f0" }}>{c.title}</p>
          {c.description && <p style={{ margin: "0 0 8px", fontSize: 11, color: "#64748b" }}>{c.description}</p>}
          <DynChart chart={c} />
        </div>
      ))}
      {result.sources && result.sources.length > 0 && (
        <div style={{ marginTop: 12, display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          <span style={{ fontSize: 10, color: "#475569", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.5px" }}>Sources:</span>
          {result.sources.map((s, i) =>
            s.url ? (
              <a key={i} href={s.url} target="_blank" rel="noopener noreferrer"
                style={{ fontSize: 11, color: "#00AAFF", background: "#161929", border: "1px solid #2d334870", borderRadius: 5, padding: "2px 8px", textDecoration: "none", transition: "border-color .15s" }}
                onMouseEnter={e => { (e.currentTarget as HTMLAnchorElement).style.borderColor = "#00AAFF66"; }}
                onMouseLeave={e => { (e.currentTarget as HTMLAnchorElement).style.borderColor = "#2d334870"; }}>
                {s.title} ↗
              </a>
            ) : (
              <span key={i} style={{ fontSize: 11, color: "#475569", background: "#161929", border: "1px solid #2d3348", borderRadius: 5, padding: "2px 8px" }}>{s.title}</span>
            )
          )}
        </div>
      )}
      {result.followUps && result.followUps.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <p style={{ margin: "0 0 6px", fontSize: 10, color: "#475569", textTransform: "uppercase", letterSpacing: "0.5px" }}>Follow-ups</p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {result.followUps.map((q, i) => (
              <span key={i} style={{ fontSize: 11, color: "#64748b", background: "#1e2130", borderRadius: 6, padding: "4px 10px", border: "1px solid #2d3348" }}>{q}</span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Country selector ──────────────────────────────────────────────────────────
interface SelectorProps {
  token:    string;
  dataset:  CountryDataset | null;
  loading:  boolean;
  error:    string | null;
  onSelect: (code: string) => void;
}

function CountrySelector({ token, dataset, loading, error, onSelect }: SelectorProps) {
  const [query,        setQuery]        = useState("");
  const [results,      setResults]      = useState<CountrySearchResult[]>([]);
  const [searching,    setSearching]    = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [history,      setHistory]      = useState<CountrySearchResult[]>([]);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    getCountryHistory(token)
      .then(h => setHistory(h.slice(0, 6).map(e => ({ code: e.code, name: e.name, flag: e.flag, region: e.region }))))
      .catch(() => {});
  }, [token, dataset]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (query.length < 2) { setResults([]); setShowDropdown(false); return; }
    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const hits = await searchCountries(query, token);
        setResults(hits);
        setShowDropdown(true);
      } catch { /* ignore */ }
      finally { setSearching(false); }
    }, 350);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query, token]);

  function pick(code: string) {
    setShowDropdown(false);
    setQuery("");
    setResults([]);
    onSelect(code);
  }

  const extraHistory = history.filter(h => !POPULAR.some(p => p.code === h.code));

  return (
    <div style={{ background: "#161929", borderRadius: 12, padding: 16, border: "1px solid #2d3348", marginBottom: 18 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.5px" }}>Data Source</span>
        {dataset && !loading && (
          <span style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 5 }}>
            <span style={{ fontSize: 16 }}>{dataset.flag}</span>
            <span style={{ fontWeight: 700, color: "#e2e8f0" }}>{dataset.name}</span>
            <span style={{ color: "#64748b" }}>· {dataset.region}</span>
          </span>
        )}
        {loading && (
          <span style={{ fontSize: 12, color: "#00AAFF", display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#00AAFF", display: "inline-block", animation: "ecPulse 1.2s ease-in-out infinite" }} />
            Loading…
          </span>
        )}
        {error && <span style={{ fontSize: 12, color: "#EF4444" }}>{error}</span>}
      </div>

      {/* Search */}
      <div style={{ position: "relative", marginBottom: 12 }}>
        <input value={query} onChange={e => setQuery(e.target.value)}
          onFocus={() => query.length >= 2 && results.length > 0 && setShowDropdown(true)}
          onBlur={() => setTimeout(() => setShowDropdown(false), 200)}
          placeholder={searching ? "Searching…" : "Search any country…"}
          style={{ width: "100%", background: "#0f1117", border: "1px solid #2d3348", borderRadius: 8, padding: "9px 14px", fontSize: 13, color: "#e2e8f0", outline: "none", boxSizing: "border-box" }}
        />
        {showDropdown && results.length > 0 && (
          <div style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, background: "#0f1117", border: "1px solid #2d3348", borderRadius: 8, zIndex: 50, maxHeight: 220, overflowY: "auto", boxShadow: "0 8px 30px #00000066" }}>
            {results.map(r => (
              <button key={r.code} onMouseDown={() => pick(r.code)}
                style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", background: "transparent", border: "none", padding: "9px 14px", cursor: "pointer", textAlign: "left" }}
                onMouseEnter={e => ((e.currentTarget as HTMLButtonElement).style.background = "#1e2130")}
                onMouseLeave={e => ((e.currentTarget as HTMLButtonElement).style.background = "transparent")}>
                <span style={{ fontSize: 18 }}>{r.flag}</span>
                <span style={{ fontSize: 13, color: "#e2e8f0", fontWeight: 600 }}>{r.name}</span>
                <span style={{ fontSize: 11, color: "#475569", marginLeft: "auto" }}>{r.code}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Quick picks */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {POPULAR.map(c => (
          <button key={c.code} onClick={() => pick(c.code)} style={{
            background: dataset?.code === c.code ? "#00AAFF18" : "#1e2130",
            border: `1px solid ${dataset?.code === c.code ? "#00AAFF66" : "#2d3348"}`,
            color:  dataset?.code === c.code ? "#00AAFF" : "#94a3b8",
            borderRadius: 7, padding: "4px 10px", fontSize: 12, cursor: "pointer",
            display: "flex", alignItems: "center", gap: 5, transition: "all .15s",
            fontWeight: dataset?.code === c.code ? 700 : 500,
          }}>
            <span style={{ fontSize: 14 }}>{c.flag}</span>{c.name}
          </button>
        ))}
        {extraHistory.map(h => (
          <button key={h.code} onClick={() => pick(h.code)} style={{
            background: "#1e2130", border: "1px dashed #2d3348",
            color: "#475569", borderRadius: 7, padding: "4px 10px", fontSize: 11,
            cursor: "pointer", display: "flex", alignItems: "center", gap: 5,
          }}>
            <span style={{ fontSize: 13 }}>{h.flag}</span>{h.name}
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Props ─────────────────────────────────────────────────────────────────────
interface Props {
  token:           string;
  dataset:         CountryDataset | null;
  loading:         boolean;
  error:           string | null;
  onSelectCountry: (code: string) => void;
}

// ── Root ──────────────────────────────────────────────────────────────────────
export default function AnalyticsMode({ token, dataset, loading, error, onSelectCountry }: Props) {
  const isMobile = useMobile();
  const [activeAlgos, setActiveAlgos] = useState<Set<string>>(DEFAULT_ALGOS);
  const [query,       setQuery]       = useState("");
  const [aiResult,    setAIResult]    = useState<AIResponse | null>(null);
  const [aiLoading,   setAILoading]   = useState(false);
  const [aiError,     setAIError]     = useState<string | null>(null);

  function toggleAlgo(id: string) {
    setActiveAlgos(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function buildContext(): string {
    if (!dataset) return "";
    return [
      `Country: ${dataset.name} (${dataset.code}), ${dataset.region}`,
      "",
      "GDP (year, $B, growth%, GDP/capita$):",
      ...dataset.gdpData.map(d => `${d.year}: $${d.gdp_bn}B, ${d.gdp_growth}%, $${d.gdp_per_capita?.toLocaleString()}`),
      "",
      "Exports ($B by year):",
      ...dataset.exportData.map(d => `${d.year}: $${d.total}B`),
      "",
      "Imports ($B by year):",
      ...dataset.importData.map(d => `${d.year}: $${d.total}B`),
      "",
      `Export sectors: ${dataset.exportSectors.map(s => s.label).join(", ")}`,
      `Import partners: ${dataset.importPartners.map(s => s.label).join(", ")}`,
    ].join("\n");
  }

  async function runQuery() {
    if (!query.trim()) return;
    setAILoading(true);
    setAIError(null);
    setAIResult(null);
    try {
      const result = await queryAnalytics(query.trim(), buildContext(), token);
      setAIResult(result);
    } catch (e) {
      setAIError(e instanceof Error ? e.message : "Query failed");
    } finally {
      setAILoading(false);
    }
  }

  const enabledAlgos = ALGOS.filter(a => activeAlgos.has(a.id));

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto" }}>

      {/* ── Country selector ── */}
      <CountrySelector token={token} dataset={dataset} loading={loading} error={error} onSelect={onSelectCountry} />

      {/* ── Algorithm picker ── */}
      <div style={{ background: "#161929", borderRadius: 12, padding: 16, border: "1px solid #2d3348", marginBottom: 18 }}>
        <p style={{ margin: "0 0 12px", fontSize: 11, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.5px" }}>
          Algorithms · {activeAlgos.size}/{ALGOS.length} active
        </p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))", gap: 8 }}>
          {ALGOS.map(a => {
            const on = activeAlgos.has(a.id);
            return (
              <button key={a.id} onClick={() => toggleAlgo(a.id)} style={{
                background: on ? a.color + "18" : "#1e2130",
                border: `1px solid ${on ? a.color + "55" : "#2d3348"}`,
                borderRadius: 9, padding: "10px 12px", cursor: "pointer", textAlign: "left", transition: "all .15s",
              }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: on ? a.color : "#94a3b8" }}>{a.name}</span>
                  <span style={{ width: 14, height: 14, borderRadius: "50%", background: on ? a.color : "#2d3348", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, color: "#fff", fontWeight: 700, flexShrink: 0 }}>
                    {on ? "✓" : ""}
                  </span>
                </div>
                <p style={{ margin: 0, fontSize: 10, color: on ? "#64748b" : "#475569", lineHeight: 1.4 }}>{a.desc}</p>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── AI query ── */}
      <div style={{ background: "#161929", borderRadius: 12, padding: 16, border: "1px solid #2d3348", marginBottom: 18 }}>
        <p style={{ margin: "0 0 10px", fontSize: 11, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.5px" }}>AI Economic Query</p>
        <div style={{ display: "flex", gap: 8, flexDirection: isMobile ? "column" : "row" }}>
          <input value={query} onChange={e => setQuery(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); runQuery(); } }}
            placeholder={dataset ? `Ask about ${dataset.name}'s economy…` : "Select a country above, then ask a question…"}
            disabled={aiLoading}
            style={{ flex: 1, background: "#0f1117", border: "1px solid #2d3348", borderRadius: 8, padding: "9px 14px", fontSize: 13, color: "#e2e8f0", outline: "none", opacity: aiLoading ? 0.6 : 1 }}
          />
          <button onClick={runQuery} disabled={aiLoading || !query.trim()} style={{
            background: aiLoading ? "#1e2130" : "#8B5CF6",
            border: "none", borderRadius: 8, padding: "9px 20px",
            fontSize: 13, fontWeight: 700, color: "#fff",
            cursor: aiLoading || !query.trim() ? "not-allowed" : "pointer",
            opacity: !query.trim() ? 0.5 : 1, transition: "all .15s",
            boxShadow: aiLoading || !query.trim() ? "none" : "0 2px 12px #8B5CF655",
          }}>
            {aiLoading ? "Analyzing…" : "Analyze"}
          </button>
        </div>
        {aiError && <p style={{ margin: "8px 0 0", fontSize: 12, color: "#EF4444" }}>{aiError}</p>}
      </div>

      {/* ── AI result ── */}
      {aiResult && <div style={{ marginBottom: 18 }}><AIResultPanel result={aiResult} /></div>}

      {/* ── Algorithm results ── */}
      {!dataset && !loading ? (
        <div style={{ textAlign: "center", padding: "48px 20px", color: "#475569" }}>
          <div style={{ fontSize: 36, marginBottom: 12 }}>🌍</div>
          <p style={{ fontSize: 14, fontWeight: 600, color: "#64748b", margin: "0 0 6px" }}>Select a country to run the algorithms</p>
          <p style={{ fontSize: 12, color: "#374151" }}>Pick from the quick-selects above or search for any country</p>
        </div>
      ) : loading ? (
        <div style={{ textAlign: "center", padding: "48px 20px" }}>
          <span style={{ fontSize: 14, color: "#00AAFF", display: "inline-flex", alignItems: "center", gap: 8 }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#00AAFF", display: "inline-block", animation: "ecPulse 1.2s ease-in-out infinite" }} />
            Fetching country data…
          </span>
        </div>
      ) : dataset && enabledAlgos.length === 0 ? (
        <div style={{ textAlign: "center", padding: "32px", color: "#475569", fontSize: 13 }}>No algorithms selected. Toggle some above.</div>
      ) : dataset ? (
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 18 }}>
          {activeAlgos.has("regression")  && <RegressionPanel  dataset={dataset} />}
          {activeAlgos.has("hhi")         && <HHIPanel         dataset={dataset} />}
          {activeAlgos.has("kmeans")      && <KMeansPanel      dataset={dataset} />}
          {activeAlgos.has("anomaly")     && <AnomalyPanel     dataset={dataset} />}
          {activeAlgos.has("hp")          && <HPPanel          dataset={dataset} />}
          {activeAlgos.has("cagr")        && <CAGRPanel        dataset={dataset} />}
          {activeAlgos.has("correlation") && <CorrelationPanel dataset={dataset} />}
          {activeAlgos.has("openness")    && <OpennessPanel    dataset={dataset} />}
        </div>
      ) : null}

      <p style={{ textAlign: "center", fontSize: 11, color: "#334155", marginTop: 18 }}>
        Algorithms from scratch · OLS Regression · HHI · K-Means++ · Z-Score Anomaly · HP Filter · CAGR · Pearson r · Trade Openness
      </p>
    </div>
  );
}
