// ─────────────────────────────────────────────────────────────────────────────
// ANALYTICS MODE  —  four panels showcasing CS algorithms implemented from scratch.
//   1. ForecastPanel    — OLS Linear Regression with 95% prediction intervals
//   2. HHIPanel         — Herfindahl-Hirschman Index for trade concentration
//   3. ClusterPanel     — K-Means++ clustering to detect economic eras
//   4. AnomalyPanel     — Z-score anomaly detection across 6 economic metrics
//
// All algorithms live in src/algorithms/. This component only handles display.
// ─────────────────────────────────────────────────────────────────────────────
import { useMemo } from "react";
import {
  ComposedChart, Bar, Line, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer, ReferenceLine,
  BarChart, Cell, LineChart,
} from "recharts";
import { GDP_DATA, EXPORTS_DATA, IMPORTS_DATA, TRADE_BALANCE } from "../../data/kazakhstan";
import { buildForecast } from "../../algorithms/regression";
import { buildHHITimeSeries } from "../../algorithms/hhi";
import { kmeans, labelClusters, type LabeledCluster } from "../../algorithms/kmeans";
import { detectAllAnomalies, type AnomalyPoint } from "../../algorithms/anomaly";
import { TT, GRID, AX, LEG } from "../../config/styles";  // single source of truth — no local duplicates
import { AnalyticsCard, Stat } from "../ui";               // shared primitives — replaces former local Card + Stat

// ── Custom tooltip for the Forecast panel ─────────────────────────────────────
// The CI band is built from two stacked Area series (ciLow baseline + ciHigh delta).
// ciLow uses transparent fill/stroke so it's invisible, but Recharts still adds it
// to the tooltip. This custom component filters it out to keep the tooltip clean.
interface TooltipPayloadEntry { dataKey: string; name: string; value: number | null; color?: string; }
interface ForecastTooltipProps { active?: boolean; payload?: TooltipPayloadEntry[]; label?: string | number; }

function ForecastTooltip({ active, payload, label }: ForecastTooltipProps) {
  if (!active || !payload?.length) return null;
  const visible = payload.filter(p => p.dataKey !== "ciLow");
  return (
    <div style={{ background: "#0f1117", border: "1px solid #2d3348", borderRadius: 8, padding: "10px 14px", fontSize: 12 }}>
      <p style={{ color: "#94a3b8", fontWeight: 600, margin: "0 0 6px" }}>{label}</p>
      {visible.map((p, i) => (
        <p key={i} style={{ color: "#e2e8f0", margin: "3px 0", display: "flex", gap: 8, alignItems: "center" }}>
          <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: p.color ?? "#e2e8f0", flexShrink: 0 }} />
          <span style={{ color: "#94a3b8" }}>{p.name}:</span>
          <span style={{ fontWeight: 600 }}>{p.value === null ? "—" : `$${p.value}B`}</span>
        </p>
      ))}
    </div>
  );
}

// ── 1. OLS Regression / Forecast Panel ───────────────────────────────────────

function ForecastPanel() {
  const { points, model } = useMemo(() =>
    buildForecast(
      GDP_DATA.map(d => ({ year: d.year, value: d.gdp_bn })),
      [2025, 2026, 2027],
    ), []);

  return (
    <AnalyticsCard
      title="GDP Forecast — Ordinary Least Squares Regression"
      subtitle="β = (XᵀX)⁻¹Xᵀy fitted to 2010–2024. Dashed region = 95% prediction interval."
      badge="Linear Regression" badgeColor="#00AAFF"
    >
      <div style={{ display: "flex", gap: 24, marginBottom: 14 }}>
        <Stat label="Slope"      value={`+$${model.slope.toFixed(1)}B/yr`} color="#00AAFF" />
        <Stat label="R²"         value={`${(model.r2 * 100).toFixed(1)}%`} color="#10B981" />
        <Stat label="2025 est."  value={`$${model.predict(2025).toFixed(0)}B`} color="#F59E0B" />
        <Stat label="2026 est."  value={`$${model.predict(2026).toFixed(0)}B`} color="#F97316" />
      </div>
      <ResponsiveContainer width="100%" height={240}>
        <ComposedChart data={points} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
          <CartesianGrid {...GRID} />
          <XAxis dataKey="year" tick={AX} />
          <YAxis tick={AX} domain={["auto", "auto"]} />
          <Tooltip content={<ForecastTooltip />} />
          <Legend {...LEG} />
          {/* CI band: invisible ciLow baseline + translucent ciHigh delta stacked on top */}
          <Area dataKey="ciLow"  name="CI Low"      fill="transparent" stroke="transparent" legendType="none" />
          <Area dataKey="ciHigh" name="95% CI Band" fill="#00AAFF" fillOpacity={0.08} stroke="none" />
          <Bar  dataKey="actual" name="Actual GDP ($B)" fill="#00AAFF" opacity={0.75} radius={[3, 3, 0, 0]} />
          <Line dataKey="trend"  name="OLS Trend" stroke="#F59E0B" strokeWidth={2} dot={{ r: 3 }} connectNulls strokeDasharray="5 3" />
        </ComposedChart>
      </ResponsiveContainer>
      <p style={{ margin: "10px 0 0", fontSize: 11, color: "#64748b" }}>
        Forecast years (2025–2027) show only the trend line and CI; bars represent observed data.
        RSE = ${model.rse.toFixed(1)}B.
      </p>
    </AnalyticsCard>
  );
}

// ── 2. HHI Trade Concentration Panel ─────────────────────────────────────────

function HHIPanel() {
  const hhiSeries = useMemo(() => buildHHITimeSeries(IMPORTS_DATA, EXPORTS_DATA), []);
  const latest = hhiSeries[hhiSeries.length - 1];

  return (
    <AnalyticsCard
      title="Trade Concentration — Herfindahl-Hirschman Index"
      subtitle="HHI = Σ(sᵢ%)². <1500 = competitive · 1500–2500 = moderate · >2500 = concentrated"
      badge="HHI Algorithm" badgeColor="#8B5CF6"
    >
      <div style={{ display: "flex", gap: 24, marginBottom: 14 }}>
        <Stat label="2024 Import HHI" value={String(latest.importHHI)} color={latest.importHHI < 1500 ? "#10B981" : latest.importHHI < 2500 ? "#F59E0B" : "#EF4444"} />
        <Stat label="Import Level"    value={latest.importLevel}       color="#94a3b8" />
        <Stat label="2024 Export HHI" value={String(latest.exportHHI)} color={latest.exportHHI < 2500 ? "#F59E0B" : "#EF4444"} />
        <Stat label="Export Level"    value={latest.exportLevel}       color="#94a3b8" />
      </div>
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={hhiSeries} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
          <CartesianGrid {...GRID} />
          <XAxis dataKey="year" tick={AX} />
          <YAxis tick={AX} domain={[0, 6000]} />
          <Tooltip {...TT} /><Legend {...LEG} />
          {/* Classification thresholds per US DoJ / FTC guidelines */}
          <ReferenceLine y={1500} stroke="#F59E0B" strokeDasharray="4 3" label={{ value: "Moderate (1500)",     fill: "#F59E0B", fontSize: 10, position: "insideTopLeft" }} />
          <ReferenceLine y={2500} stroke="#EF4444" strokeDasharray="4 3" label={{ value: "Concentrated (2500)", fill: "#EF4444", fontSize: 10, position: "insideTopLeft" }} />
          <Line dataKey="importHHI" name="Import HHI" stroke="#8B5CF6" strokeWidth={2.5} dot={{ r: 4 }} />
          <Line dataKey="exportHHI" name="Export HHI" stroke="#F97316" strokeWidth={2.5} dot={{ r: 4 }} />
        </LineChart>
      </ResponsiveContainer>
      <p style={{ margin: "10px 0 0", fontSize: 11, color: "#64748b" }}>
        Export concentration (oil & gas dominance) far exceeds the "concentrated" threshold.
        Import concentration is moderate but rising — China's share grew from 23% to 39%.
      </p>
    </AnalyticsCard>
  );
}

// ── 3. K-Means Economic Era Cluster Panel ────────────────────────────────────

function ClusterPanel() {
  const { clusters, chartData } = useMemo(() => {
    const features = GDP_DATA.map(d => [d.gdp_growth, d.gdp_per_capita / 1000, d.digital_pct]);
    const years    = GDP_DATA.map(d => d.year);
    const growths  = GDP_DATA.map(d => d.gdp_growth);
    const k = 3;
    const result               = kmeans(features, k);
    const labeled: LabeledCluster[] = labelClusters(years, growths, result.assignments, k);

    // Build year → color and year → label lookups for the bar chart Cell colors
    const colorByYear: Record<number, string> = {};
    const clusterByYear: Record<number, string> = {};
    labeled.forEach(cl => cl.years.forEach(y => {
      colorByYear[y]   = cl.color;
      clusterByYear[y] = cl.label;
    }));

    const chartData = GDP_DATA.map(d => ({
      year:       d.year,
      gdp_growth: d.gdp_growth,
      cluster:    clusterByYear[d.year] ?? "—",
      fill:       colorByYear[d.year]   ?? "#64748b",
    }));

    return { clusters: labeled, chartData };
  }, []);

  return (
    <AnalyticsCard
      title="Economic Era Detection — K-Means Clustering (k=3)"
      subtitle="Features: GDP growth, GDP/capita, digital %. K-Means++ init, z-score normalized, converges in <50 iterations."
      badge="K-Means Algorithm" badgeColor="#10B981"
    >
      <div style={{ display: "flex", gap: 16, marginBottom: 14, flexWrap: "wrap" }}>
        {clusters.map(cl => (
          <div key={cl.id} style={{ display: "flex", alignItems: "center", gap: 8, background: cl.color + "18", borderRadius: 8, padding: "6px 12px", border: `1px solid ${cl.color}44` }}>
            <div style={{ width: 10, height: 10, borderRadius: "50%", background: cl.color, flexShrink: 0 }} />
            <span style={{ fontSize: 12, fontWeight: 700, color: cl.color }}>{cl.label}</span>
            <span style={{ fontSize: 11, color: "#64748b" }}>
              {cl.years.join(", ")} · avg {cl.avgGrowth > 0 ? "+" : ""}{cl.avgGrowth}%
            </span>
          </div>
        ))}
      </div>
      <ResponsiveContainer width="100%" height={200}>
        <BarChart data={chartData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
          <CartesianGrid {...GRID} />
          <XAxis dataKey="year" tick={AX} />
          <YAxis tick={AX} domain={[-4, 9]} />
          {/* Explicit TT spread because the custom formatter needs Cell fill colors */}
          <Tooltip
            contentStyle={TT.contentStyle} labelStyle={TT.labelStyle}
            itemStyle={TT.itemStyle} cursor={TT.cursor}
            formatter={(v: number, _n: string, props: { payload?: { cluster?: string } }) =>
              [`${v > 0 ? "+" : ""}${v}%`, `GDP Growth (${props.payload?.cluster ?? ""})`]
            }
          />
          <ReferenceLine y={0} stroke="#2d3348" />
          <Bar dataKey="gdp_growth" name="GDP Growth %" radius={[3, 3, 0, 0]}>
            {chartData.map((d, i) => <Cell key={i} fill={d.fill} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      <p style={{ margin: "10px 0 0", fontSize: 11, color: "#64748b" }}>
        The algorithm unsupervisedly identifies 3 economic eras matching Kazakhstan's oil-price boom (2010–2013),
        stagnation (2015–2016, 2020), and recovery (2017–2019, 2021–2024).
      </p>
    </AnalyticsCard>
  );
}

// ── 4. Z-Score Anomaly Detection Panel ───────────────────────────────────────

// Color and icon lookups kept at module level — they're constant and small.
const SEVERITY_COLOR: Record<string, string> = { extreme: "#EF4444", strong: "#F97316", moderate: "#F59E0B" };
const DIR_ICON:       Record<string, string> = { high: "▲", low: "▼" };

function AnomalyPanel() {
  const anomalies: AnomalyPoint[] = useMemo(() =>
    detectAllAnomalies({
      gdpData:     GDP_DATA,
      exportsData: EXPORTS_DATA,
      importsData: IMPORTS_DATA,
      tradeData:   TRADE_BALANCE,
    }), []);

  // Aggregate anomaly counts per year for the mini bar chart overview.
  const yearCounts: Record<number, number> = {};
  anomalies.forEach(a => { yearCounts[a.year] = (yearCounts[a.year] ?? 0) + 1; });
  const allYears  = Array.from(new Set([...GDP_DATA, ...EXPORTS_DATA].map(d => d.year))).sort();
  const countData = allYears.map(y => ({ year: y, anomalies: yearCounts[y] ?? 0 }));

  return (
    <AnalyticsCard
      title="Statistical Anomaly Detection — Z-Score Analysis"
      subtitle="Flags data points where |z| = |(x − μ) / σ| > 1.5 across 6 economic metrics."
      badge="Z-Score Algorithm" badgeColor="#EF4444"
    >
      {/* Mini bar chart: anomaly density per year — quick visual overview */}
      <ResponsiveContainer width="100%" height={100}>
        <BarChart data={countData} margin={{ top: 0, right: 20, left: 0, bottom: 0 }}>
          <XAxis dataKey="year" tick={AX} />
          <YAxis tick={AX} allowDecimals={false} width={20} />
          <Tooltip {...TT} formatter={(v: number) => [v, "Anomalies"]} />
          <Bar dataKey="anomalies" name="Anomalous metrics" radius={[3, 3, 0, 0]}>
            {countData.map((d, i) => (
              <Cell key={i} fill={d.anomalies === 0 ? "#2d3348" : d.anomalies >= 3 ? "#EF4444" : "#F97316"} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>

      {/* Top anomaly list — ranked by absolute z-score descending */}
      <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 6, maxHeight: 200, overflowY: "auto" }}>
        {anomalies.slice(0, 12).map((a, i) => {
          const col = SEVERITY_COLOR[a.severity];
          return (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 10px", background: col + "11", border: `1px solid ${col}33`, borderRadius: 8 }}>
              <span style={{ fontSize: 12, color: col, fontWeight: 700, minWidth: 18 }}>{DIR_ICON[a.direction]}</span>
              <span style={{ fontSize: 11, color: "#00AAFF", minWidth: 34, fontWeight: 700 }}>{a.year}</span>
              <span style={{ fontSize: 11, color: "#94a3b8", flex: 1 }}>{a.metric}</span>
              <span style={{ fontSize: 11, color: "#e2e8f0", fontWeight: 600 }}>
                {a.value < 10 ? `${a.value > 0 ? "+" : ""}${a.value}` : `$${a.value}B`}
              </span>
              <span style={{ fontSize: 10, color: col, fontWeight: 700, minWidth: 60, textAlign: "right" }}>
                z={a.zScore > 0 ? "+" : ""}{a.zScore}σ
              </span>
              <span style={{ fontSize: 10, color: "#64748b" }}>{a.annotation}</span>
            </div>
          );
        })}
      </div>
      <p style={{ margin: "10px 0 0", fontSize: 11, color: "#64748b" }}>
        {anomalies.length} anomalous data points found across {Object.keys(yearCounts).length} years.
        Years 2016 (oil crash) and 2020 (COVID) show the highest anomaly density.
      </p>
    </AnalyticsCard>
  );
}

// ── Root ─────────────────────────────────────────────────────────────────────

export default function AnalyticsMode() {
  return (
    <div style={{ maxWidth: 1100, margin: "0 auto" }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18, marginBottom: 18 }}>
        <ForecastPanel /><HHIPanel />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18 }}>
        <ClusterPanel /><AnomalyPanel />
      </div>
      <p style={{ textAlign: "center", fontSize: 11, color: "#334155", marginTop: 18 }}>
        All algorithms implemented from scratch · OLS Regression · HHI · K-Means++ · Z-Score Anomaly Detection · LRU Cache (server)
      </p>
    </div>
  );
}
