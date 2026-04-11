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
import { useState, useEffect, useMemo, useCallback } from "react";
import { useMobile } from "../../utils/useMobile";
import {
  ComposedChart, Bar, Line, Area, BarChart,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, ReferenceLine, Cell,
} from "recharts";
import type { CountryDataset, CountrySearchResult, AIResponse } from "../../types";
import { getCountryHistory, queryAnalytics } from "../../utils/api";
import { TT, GRID, AX, LEG } from "../../config/styles";
import { AnalyticsCard, Stat, DynChart, SourceList } from "../ui";
import { POPULAR_COUNTRIES } from "../../data/suggestions";
import CountrySearchInput from "../shared/CountrySearchInput";
import { Button } from "@/components/ui/button";
import { Input }  from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertTriangle } from "lucide-react";

// ── Algorithms ────────────────────────────────────────────────────────────────
import { buildForecast }               from "../../algorithms/regression";
import { buildGenericHHITimeSeries }   from "../../algorithms/hhi";
import { kmeans, labelClusters }       from "../../algorithms/kmeans";
import { detectAllAnomaliesGeneric }   from "../../algorithms/anomaly";
import { hpFilter }                    from "../../algorithms/hp_filter";
import { buildCAGRSeries }             from "../../algorithms/cagr";
import { buildCorrelationMatrix }      from "../../algorithms/correlation";
import type { AnomalyPoint }           from "../../algorithms/anomaly";


// ── Algorithm catalogue ───────────────────────────────────────────────────────
interface AlgoDef { id: string; name: string; desc: string; color: string; }
const ALGOS: AlgoDef[] = [
  { id: "regression",  name: "OLS Regression",    desc: "GDP trend forecast with 95% confidence band",   color: "#FF006E" },
  { id: "hhi",         name: "HHI Concentration", desc: "Trade concentration index over time",            color: "#8338EC" },
  { id: "kmeans",      name: "K-Means Clustering",desc: "Unsupervised economic era detection (k=3)",      color: "#00F5D4" },
  { id: "anomaly",     name: "Z-Score Anomaly",   desc: "Statistical outliers across 6 economic metrics", color: "#FB5607" },
  { id: "hp",          name: "HP Filter",         desc: "Hodrick-Prescott business cycle decomposition",  color: "#FFBE0B" },
  { id: "cagr",        name: "CAGR Analysis",     desc: "Compound annual growth rates by period",         color: "#00D9FF" },
  { id: "correlation", name: "Correlation Matrix",desc: "Pearson r between GDP, trade, and growth",       color: "#FF006E" },
  { id: "openness",    name: "Trade Openness",    desc: "(Exports + Imports) / GDP × 100 over time",      color: "#8338EC" },
];
const DEFAULT_ALGOS = new Set(["regression", "anomaly", "cagr", "hp"]);

// ── Shared custom tooltip ─────────────────────────────────────────────────────
interface TTEntry { dataKey: string; name: string; value: number | null; color?: string; }
function ChartTip({ active, payload, label }: { active?: boolean; payload?: TTEntry[]; label?: string | number }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border-3 border-memphis-black px-3.5 py-2.5 text-xs shadow-hard">
      <p className="text-memphis-black/60 font-semibold mb-1.5">{label}</p>
      {payload.filter(p => p.dataKey !== "ciLow").map((p, i) => (
        <p key={i} className="text-memphis-black my-0.5 flex gap-2 items-center">
          <span className="w-2 h-2 shrink-0 inline-block" style={{ background: p.color ?? "#1A1A2E" }} />
          <span className="text-memphis-black/50">{p.name}:</span>
          <span className="font-semibold">{p.value === null ? "—" : p.value}</span>
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
      badge="Linear Regression" badgeColor="#FF006E">
      <div className="flex gap-6 mb-3.5 flex-wrap">
        <Stat label="Slope"  value={`+$${model.slope.toFixed(1)}B/yr`} color="#FF006E" />
        <Stat label="R²"     value={`${(model.r2 * 100).toFixed(1)}%`} color="#00D9FF" />
        <Stat label="+1 yr"  value={`$${model.predict(points[points.length - 2]?.year ?? 2025).toFixed(0)}B`} color="#FFBE0B" />
        <Stat label="+2 yr"  value={`$${model.predict(points[points.length - 1]?.year ?? 2026).toFixed(0)}B`} color="#FB5607" />
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
      <p className="mt-2.5 text-[11px] text-memphis-black/50">RSE = ${model.rse.toFixed(1)}B. Forecast bars are blank — only the trend line extends forward.</p>
    </AnalyticsCard>
  );
}

function HHIPanel({ dataset }: { dataset: CountryDataset }) {
  const series = useMemo(() =>
    buildGenericHHITimeSeries(dataset.exportData, dataset.importData, dataset.exportSectors, dataset.importPartners),
    [dataset]);
  const latest = series[series.length - 1];
  if (!latest) return (
    <AnalyticsCard title="HHI" badge="HHI" badgeColor="#8338EC">
      <p className="text-memphis-black/50 text-[13px]">Not enough trade data.</p>
    </AnalyticsCard>
  );

  return (
    <AnalyticsCard title={`${dataset.name} Trade Concentration — HHI`}
      subtitle="HHI = Σ(sᵢ%)². <1500 competitive · 1500–2500 moderate · >2500 concentrated"
      badge="HHI Algorithm" badgeColor="#8338EC">
      <div className="flex gap-6 mb-3.5 flex-wrap">
        <Stat label="Import HHI" value={String(latest.importHHI)} color={latest.importHHI < 1500 ? "#00F5D4" : latest.importHHI < 2500 ? "#FFBE0B" : "#FF006E"} />
        <Stat label="Level"      value={latest.importLevel}       color="#1A1A2E" />
        <Stat label="Export HHI" value={String(latest.exportHHI)} color={latest.exportHHI < 2500 ? "#FFBE0B" : "#FF006E"} />
        <Stat label="Level"      value={latest.exportLevel}       color="#1A1A2E" />
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
      <div className="flex gap-2.5 mb-3.5 flex-wrap">
        {clusters.map(cl => (
          <div key={cl.id} className="flex items-center gap-2 rounded-lg px-2.5 py-1" style={{ background: cl.color + "18", border: `1px solid ${cl.color}44` }}>
            <div className="w-2 h-2 rounded-full" style={{ background: cl.color }} />
            <span className="text-[11px] font-bold" style={{ color: cl.color }}>{cl.label}</span>
            <span className="text-[10px] text-slate-500">{cl.years.join(", ")} · avg {cl.avgGrowth > 0 ? "+" : ""}{cl.avgGrowth}%</span>
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
      <div className="mt-2.5 flex flex-col gap-1.5 max-h-[220px] overflow-y-auto">
        {anomalies.slice(0, 12).map((a, i) => {
          const col = SEV_COLOR[a.severity];
          return (
            <div key={i} className="flex items-center gap-2 px-2 py-1 rounded-[7px]" style={{ background: col + "11", border: `1px solid ${col}33` }}>
              <span className="font-bold w-4 text-[11px]" style={{ color: col }}>{DIR_ICON[a.direction]}</span>
              <span className="font-bold w-8 text-[11px] text-[#00AAFF]">{a.year}</span>
              <span className="text-slate-400 flex-1 text-[11px]">{a.metric}</span>
              <span className="font-bold text-[10px]" style={{ color: col }}>z={a.zScore > 0 ? "+" : ""}{a.zScore}σ</span>
              <span className="text-slate-500 text-[10px]">{a.annotation}</span>
            </div>
          );
        })}
      </div>
      <p className="mt-2 text-[11px] text-slate-500">
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
      <div className="flex gap-4 mb-3.5 flex-wrap">
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
      <p className="mt-2 text-[11px] text-slate-500">Positive cycle = above-trend expansion; negative = below-trend contraction.</p>
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
      <div className="flex gap-6 mb-3.5 flex-wrap">
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
        <p className="mb-3 text-xs text-slate-400">
          Strongest pair: <span className="text-[#06B6D4] font-bold">{result.strongestPair.row} ↔ {result.strongestPair.col}</span>
          {" "}(r = {result.strongestPair.r > 0 ? "+" : ""}{result.strongestPair.r})
        </p>
      )}
      <div className="overflow-x-auto">
        <table className="border-collapse text-[11px] w-full">
          <thead>
            <tr>
              <th className="px-2 py-1 text-slate-600 text-left" />
              {result.variables.map(v => (
                <th key={v} title={v} className="px-1.5 py-1 text-slate-600 font-semibold text-center max-w-[70px] overflow-hidden text-ellipsis whitespace-nowrap">
                  {v.replace(" ($B)", "").replace(" (%)", "")}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {result.variables.map(row => (
              <tr key={row}>
                <td className="px-2 py-1 text-slate-400 font-semibold whitespace-nowrap">
                  {row.replace(" ($B)", "").replace(" (%)", "")}
                </td>
                {result.variables.map(col => {
                  const cell = result.cells.find(c => c.rowLabel === row && c.colLabel === col);
                  const r = cell?.r ?? 0;
                  const isDiag = row === col;
                  return (
                    <td key={col} title={`${row} ↔ ${col}: r = ${r}`} className="px-1.5 py-1 text-center rounded" style={{
                      background: isDiag ? "#1e2130" : rToColor(r),
                      color: isDiag ? "#64748b" : Math.abs(r) > 0.3 ? "#e2e8f0" : "#94a3b8",
                      fontWeight: Math.abs(r) > 0.6 ? 700 : 500,
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
      <div className="flex gap-4 mb-3.5 flex-wrap">
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
    <div className="bg-white p-5 border-3 border-memphis-black shadow-hard-lg relative">
      <div className="absolute -top-3 -right-3 w-6 h-6 bg-memphis-pink border-3 border-memphis-black" />
      <div className="flex items-center gap-2 mb-3">
        <span className="text-[9px] font-black px-2 py-0.5 bg-memphis-pink text-white border-3 border-memphis-black uppercase tracking-[0.5px]">AI Analysis</span>
      </div>
      {result.insight && (
        <p className="mb-4 text-sm text-memphis-black leading-relaxed">{result.insight}</p>
      )}
      {result.charts?.map(c => (
        <div key={c.id} className="mb-4">
          <p className="mb-1.5 text-[13px] font-black text-memphis-black">{c.title}</p>
          {c.description && <p className="mb-2 text-[11px] text-memphis-black/50">{c.description}</p>}
          <DynChart chart={c} />
        </div>
      ))}
      {result.sources && result.sources.length > 0 && (
        <SourceList sources={result.sources} className="mt-3" />
      )}
      {result.followUps && result.followUps.length > 0 && (
        <div className="mt-2.5">
          <p className="mb-1.5 text-[10px] text-memphis-black/60 uppercase tracking-[0.5px]">Follow-ups</p>
          <div className="flex flex-wrap gap-1.5">
            {result.followUps.map((q, i) => (
              <span key={i} className="text-[11px] text-memphis-black/70 bg-memphis-offwhite border-2 border-memphis-black px-2.5 py-1">{q}</span>
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
  const isMobile = useMobile();
  const [history, setHistory] = useState<CountrySearchResult[]>([]);

  useEffect(() => {
    getCountryHistory(token)
      .then(h => setHistory(h.slice(0, 6).map(e => ({ code: e.code, name: e.name, flag: e.flag, region: e.region }))))
      .catch(() => {});
  }, [token, dataset?.code]);

  const extraHistory = history.filter(h => !POPULAR_COUNTRIES.some(p => p.code === h.code));

  return (
    <div className="bg-white p-3 sm:p-5 border-3 border-memphis-black shadow-hard-lg mb-5">
      <div className="flex items-center gap-2.5 mb-3 sm:mb-4 flex-wrap">
        <span className="text-[11px] font-black text-memphis-black/60 uppercase tracking-[0.5px]">Data Source</span>
        {dataset && !loading && (
          <span className="text-xs flex items-center gap-1.5">
            <span className="text-base">{dataset.flag}</span>
            <span className="font-black text-memphis-black">{dataset.name}</span>
            <span className="text-memphis-black/50">· {dataset.region}</span>
          </span>
        )}
        {loading && (
          <span className="text-xs text-memphis-pink flex items-center gap-1.5">
            <span className="w-2 h-2 bg-memphis-pink border-2 border-memphis-black inline-block" style={{ animation: "ecPulse 1s steps(1) infinite" }} />
            Loading…
          </span>
        )}
        {error && <span className="text-xs text-memphis-orange font-bold">{error}</span>}
      </div>

      <CountrySearchInput token={token} onSelect={onSelect} className="mb-4" />

      {/* Quick picks */}
      <div className="flex flex-wrap gap-1.5 sm:gap-2">
        {POPULAR_COUNTRIES.slice(0, isMobile ? 6 : undefined).map(c => (
          <button key={c.code} onClick={() => onSelect(c.code)}
            className="flex items-center gap-1 px-2 sm:px-3 py-2 sm:py-1.5 min-h-11 sm:min-h-0 text-[11px] sm:text-xs cursor-pointer transition-snap border-2 sm:border-3 font-bold"
            style={{
              background:  dataset?.code === c.code ? "#FF006E" : "#FFFFFF",
              borderColor: "#1A1A2E",
              color:       dataset?.code === c.code ? "#FFFFFF" : "#1A1A2E",
              boxShadow:   dataset?.code === c.code ? (isMobile ? "2px 2px 0 #1A1A2E" : "4px 4px 0 #1A1A2E") : "none",
            }}>
            <span className="text-sm">{c.flag}</span><span className="hidden sm:inline">{c.name}</span><span className="sm:hidden">{c.code}</span>
          </button>
        ))}
        {!isMobile && extraHistory.map(h => (
          <button key={h.code} onClick={() => onSelect(h.code)}
            className="flex items-center gap-1.5 bg-memphis-offwhite border-2 border-dashed border-memphis-black text-memphis-black/60 px-3 py-1.5 text-[11px] cursor-pointer font-medium">
            <span className="text-[13px]">{h.flag}</span>{h.name}
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

  // Pre-build context string when dataset changes — avoids rebuilding on every render
  const context = useMemo(() => {
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
  }, [dataset]);

  const runQuery = useCallback(async () => {
    if (!query.trim()) return;
    setAILoading(true);
    setAIError(null);
    setAIResult(null);
    try {
      const result = await queryAnalytics(query.trim(), context, token);
      setAIResult(result);
    } catch (e) {
      setAIError(e instanceof Error ? e.message : "Query failed");
    } finally {
      setAILoading(false);
    }
  }, [query, context, token]);

  const enabledAlgos = ALGOS.filter(a => activeAlgos.has(a.id));

  return (
    <div className="max-w-[1100px] mx-auto">

      {/* ── Country selector ── */}
      <CountrySelector token={token} dataset={dataset} loading={loading} error={error} onSelect={onSelectCountry} />

      {/* ── Algorithm picker ── */}
      <div className="bg-white p-3 sm:p-5 border-3 border-memphis-black shadow-hard-lg mb-5">
        <p className="text-[11px] font-black text-memphis-black/60 uppercase tracking-[0.5px] mb-3 sm:mb-4">
          Algorithms · {activeAlgos.size}/{ALGOS.length} active
        </p>
        <div className="grid gap-2 sm:gap-3" style={{ gridTemplateColumns: isMobile ? "1fr 1fr" : "repeat(auto-fill, minmax(190px, 1fr))" }}>
          {ALGOS.map(a => {
            const on = activeAlgos.has(a.id);
            return (
              <button key={a.id} onClick={() => toggleAlgo(a.id)}
                className="px-2 sm:px-3 py-2 sm:py-3 min-h-11 cursor-pointer text-left transition-snap border-2 sm:border-3 shadow-hard-sm active:translate-x-[2px] active:translate-y-[2px] active:shadow-none"
                style={{ 
                  background: on ? a.color : "#FFFFFF", 
                  borderColor: "#1A1A2E",
                  color: on ? "#FFFFFF" : "#1A1A2E",
                  boxShadow: on ? (isMobile ? "2px 2px 0 #1A1A2E" : "4px 4px 0 #1A1A2E") : (isMobile ? "1px 1px 0 #1A1A2E" : "2px 2px 0 #1A1A2E")
                }}>
                <div className="flex items-center justify-between mb-0.5 sm:mb-1">
                  <span className="text-[10px] sm:text-[11px] font-black uppercase leading-tight">{a.name}</span>
                  <span className="w-3 h-3 sm:w-4 sm:h-4 flex items-center justify-center text-[8px] sm:text-[9px] text-white font-black border border-white sm:border-2 shrink-0"
                    style={{ background: on ? "#FFFFFF" : "#1A1A2E", color: on ? "#1A1A2E" : "#FFFFFF" }}>
                    {on ? "✓" : ""}
                  </span>
                </div>
                <p className="text-[9px] sm:text-[10px] leading-snug font-medium hidden sm:block" style={{ opacity: on ? 0.9 : 0.6 }}>{a.desc}</p>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── AI query ── */}
      <div className="bg-memphis-yellow p-3 sm:p-5 border-3 border-memphis-black shadow-hard-lg mb-5 relative">
        <div className="absolute -top-1.5 sm:-top-2 left-4 right-4 h-1.5 sm:h-2 bg-repeating-linear-gradient"
          style={{
            background: `repeating-linear-gradient(
              90deg,
              #FF006E 0px,
              #FF006E 8px,
              #00D9FF 8px,
              #00D9FF 16px
            )`
          }}
        />
        <p className="text-[11px] font-black text-memphis-black uppercase tracking-[0.5px] mb-2 sm:mb-3 mt-1">AI Economic Query</p>
        <div className={`flex gap-2 sm:gap-3 ${isMobile ? "flex-col" : ""}`}>
          <Input value={query} onChange={e => setQuery(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); runQuery(); } }}
            placeholder={dataset ? `Ask about ${dataset.name}…` : "Select a country first…"}
            disabled={aiLoading}
            className="flex-1 bg-white border-2 sm:border-3 border-memphis-black"
          />
          <Button onClick={runQuery} disabled={aiLoading || !query.trim()}>
            {aiLoading ? "Analyzing…" : "Analyze"}
          </Button>
        </div>
        {aiError && (
          <Alert className="mt-3 border-3 border-memphis-orange bg-memphis-orange/10">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>{aiError}</AlertDescription>
          </Alert>
        )}
      </div>

      {/* ── AI result ── */}
      {aiResult && <div className="mb-5"><AIResultPanel result={aiResult} /></div>}

      {/* ── Algorithm results ── */}
      {!dataset && !loading ? (
        <div className="text-center py-12 px-5 text-memphis-black/60">
          <div className="text-4xl mb-3">🌍</div>
          <p className="text-sm font-black text-memphis-black/70 mb-1.5">Select a country to run the algorithms</p>
          <p className="text-xs text-memphis-black/50">Pick from the quick-selects above or search for any country</p>
        </div>
      ) : loading ? (
        <div className="text-center py-12">
          <span className="text-sm text-memphis-pink inline-flex items-center gap-2 font-bold">
            <span className="w-2 h-2 bg-memphis-pink border-2 border-memphis-black inline-block" style={{ animation: "ecPulse 1s steps(1) infinite" }} />
            Fetching country data…
          </span>
        </div>
      ) : dataset && enabledAlgos.length === 0 ? (
        <div className="text-center py-8 text-memphis-black/60 text-[13px] font-semibold">No algorithms selected. Toggle some above.</div>
      ) : dataset ? (
        <div className="grid gap-5" style={{ gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr" }}>
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

      <p className="text-center text-[11px] text-memphis-black/50 mt-5 font-medium">
        Algorithms from scratch · OLS Regression · HHI · K-Means++ · Z-Score Anomaly · HP Filter · CAGR · Pearson r · Trade Openness
      </p>
    </div>
  );
}
