// ─────────────────────────────────────────────────────────────────────────────
// EXPORT MODE  —  download country data as CSV/JSON and generate HTML reports.
//
// Two panels side-by-side:
//   • Country Data  — GDP CSV, Exports CSV, Imports CSV, Trade Balance CSV,
//                     full JSON, and a standalone HTML report with embedded
//                     SVG charts (extracted from hidden fixed-size Recharts renders).
//   • Algorithm Results — one CSV per algorithm (regression, CAGR, HP filter,
//                         correlation, HHI, anomaly, k-means, openness).
//                         Algorithms are re-run fresh from the loaded dataset.
// ─────────────────────────────────────────────────────────────────────────────
import { useRef, useState, useEffect, useCallback } from "react";
import { useMobile } from "../../utils/useMobile";
import {
  LineChart, BarChart, ComposedChart,
  Bar, Line, Area, AreaChart,
  XAxis, YAxis, CartesianGrid, Tooltip,
} from "recharts";
import type { CountryDataset } from "../../types";
import {
  downloadCSV, downloadJSON, copyToClipboard,
  gdpToCSV, exportsToCSV, importsToCSV, tradeBalanceToCSV,
  toCSVString, buildDashboardHTML, printHTML,
} from "../../utils/export";

// Algorithms
import { buildForecast }             from "../../algorithms/regression";
import { buildGenericHHITimeSeries } from "../../algorithms/hhi";
import { kmeans, labelClusters }     from "../../algorithms/kmeans";
import { detectAllAnomaliesGeneric } from "../../algorithms/anomaly";
import { hpFilter }                  from "../../algorithms/hp_filter";
import { buildCAGRSeries }           from "../../algorithms/cagr";
import { buildCorrelationMatrix }    from "../../algorithms/correlation";

// ── Light-theme chart style constants (for the off-screen report renders) ────
const LG  = { strokeDasharray: "3 3", stroke: "#e2e8f0" } as const;
const LP  = ["#3b82f6","#f59e0b","#10b981","#ef4444","#8b5cf6","#f97316","#06b6d4"] as const;

// ── Tiny UI helpers ───────────────────────────────────────────────────────────

interface ExportBtnProps {
  label: string;
  icon: string;
  onClick: () => void;
  color?: string;
  disabled?: boolean;
  full?: boolean;
}
function ExportBtn({ label, icon, onClick, color = "#2d3348", disabled, full }: ExportBtnProps) {
  const [hover, setHover] = useState(false);
  return (
    <button
      disabled={disabled}
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "flex", alignItems: "center", gap: 7,
        background: hover && !disabled ? "#1e2130" : "#161929",
        border: `1px solid ${hover && !disabled ? color : "#2d3348"}`,
        borderRadius: 7, padding: "7px 12px",
        fontSize: 12, color: disabled ? "#374151" : hover ? "#e2e8f0" : "#94a3b8",
        cursor: disabled ? "not-allowed" : "pointer",
        transition: "all .15s", fontWeight: 500,
        width: full ? "100%" : undefined,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <span style={{ fontSize: 14 }}>{icon}</span>
      {label}
    </button>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <p style={{ fontSize: 10, fontWeight: 700, color: "#475569", textTransform: "uppercase", letterSpacing: "0.8px", margin: "20px 0 8px" }}>
      {children}
    </p>
  );
}

function Toast({ msg, onDone }: { msg: string; onDone: () => void }) {
  useEffect(() => { const t = setTimeout(onDone, 2200); return () => clearTimeout(t); }, [onDone]);
  return (
    <div style={{
      position: "fixed", bottom: 28, left: "50%", transform: "translateX(-50%)",
      background: "#10b981", color: "#fff", borderRadius: 8,
      padding: "9px 18px", fontSize: 13, fontWeight: 600,
      boxShadow: "0 4px 20px #10b98155", zIndex: 9999,
    }}>
      {msg}
    </div>
  );
}

// ── Algorithm CSV builders ────────────────────────────────────────────────────

function buildAlgoCSVs(ds: CountryDataset): Record<string, string> {
  const out: Record<string, string> = {};

  // Regression — buildForecast({year,value}[], futureYears[])
  try {
    const { points } = buildForecast(
      ds.gdpData.map(d => ({ year: d.year, value: d.gdp_bn })),
      [],
    );
    out.regression = toCSVString(
      ["year", "actual_gdp_bn", "trend_gdp_bn", "ci_low", "ci_high", "is_forecast"],
      points.map(p => [p.year, p.actual ?? "", p.trend ?? "", p.ciLow ?? "", p.ciHigh ?? "", p.isForecast ? 1 : 0]),
    );
  } catch { /* skip */ }

  // CAGR — returns { periods: CAGREntry[], fullPeriod, ... }
  try {
    const { periods, fullPeriod } = buildCAGRSeries(ds.gdpData, ds.exportData, ds.importData);
    const rows = [...periods, fullPeriod];
    out.cagr = toCSVString(
      ["period", "start_year", "end_year", "gdp_cagr_pct", "exports_cagr_pct", "imports_cagr_pct", "per_capita_cagr_pct"],
      rows.map(s => [s.label, s.startYear, s.endYear, s.gdp ?? "", s.exports ?? "", s.imports ?? "", s.perCapita ?? ""]),
    );
  } catch { /* skip */ }

  // HP Filter — takes {year,value}[], returns { points: [{year,actual,trend,cycle}] }
  try {
    const { points } = hpFilter(ds.gdpData.map(d => ({ year: d.year, value: d.gdp_bn })));
    out.hp_filter = toCSVString(
      ["year", "actual_gdp_bn", "trend_gdp_bn", "cycle_gdp_bn"],
      points.map(p => [p.year, p.actual, +p.trend.toFixed(2), +p.cycle.toFixed(2)]),
    );
  } catch { /* skip */ }

  // Correlation — returns { variables, cells: CorrelationCell[], strongestPair }
  try {
    const { cells } = buildCorrelationMatrix(ds.gdpData, ds.exportData, ds.importData);
    // exclude diagonal (r === 1, rowLabel === colLabel)
    const offDiag = cells.filter(c => c.rowLabel !== c.colLabel);
    out.correlation = toCSVString(
      ["variable_1", "variable_2", "pearson_r", "strength", "direction"],
      offDiag.map(c => [c.rowLabel, c.colLabel, +c.r.toFixed(4), c.strength, c.direction]),
    );
  } catch { /* skip */ }

  // HHI — buildGenericHHITimeSeries(exportData, importData, exportSectors, importPartners)
  try {
    const hhi = buildGenericHHITimeSeries(ds.exportData, ds.importData, ds.exportSectors, ds.importPartners);
    out.hhi = toCSVString(
      ["year", "export_hhi", "export_level", "import_hhi", "import_level"],
      hhi.map(h => [h.year, h.exportHHI, h.exportLevel, h.importHHI, h.importLevel]),
    );
  } catch { /* skip */ }

  // Anomaly
  try {
    const anomalies = detectAllAnomaliesGeneric(ds.gdpData, ds.exportData, ds.importData);
    out.anomaly = toCSVString(
      ["year", "metric", "value", "z_score", "direction", "severity"],
      anomalies.map(a => [a.year, a.metric, a.value, +a.zScore.toFixed(3), a.direction, a.severity]),
    );
  } catch { /* skip */ }

  // K-Means — kmeans returns { assignments }, labelClusters(years[], gdpGrowths[], assignments[], k)
  try {
    const valid = ds.gdpData.filter(d => d.gdp_growth != null);
    const years = valid.map(d => d.year);
    const growths = valid.map(d => d.gdp_growth!);
    const { assignments } = kmeans(valid.map(d => [d.gdp_growth!, d.gdp_bn]), 3);
    const clusters = labelClusters(years, growths, assignments, 3);
    // Build year→cluster map
    const yearCluster = new Map<number, string>();
    clusters.forEach(cl => cl.years.forEach(y => yearCluster.set(y, cl.label)));
    out.kmeans = toCSVString(
      ["year", "gdp_bn", "gdp_growth_pct", "cluster"],
      valid.map(d => [d.year, d.gdp_bn, d.gdp_growth!, yearCluster.get(d.year) ?? ""]),
    );
  } catch { /* skip */ }

  // Trade Openness
  try {
    const expMap = new Map(ds.exportData.map(d => [d.year, d.total]));
    const impMap = new Map(ds.importData.map(d => [d.year, d.total]));
    out.openness = toCSVString(
      ["year", "exports_bn", "imports_bn", "gdp_bn", "openness_pct"],
      ds.gdpData.map(d => {
        const exp = expMap.get(d.year) ?? 0;
        const imp = impMap.get(d.year) ?? 0;
        const open = d.gdp_bn > 0 ? +(((exp + imp) / d.gdp_bn) * 100).toFixed(1) : "";
        return [d.year, exp || "", imp || "", d.gdp_bn, open];
      }),
    );
  } catch { /* skip */ }

  return out;
}

// ── Off-screen chart renders for SVG extraction ───────────────────────────────

interface HiddenChartsProps {
  dataset: CountryDataset;
  refs: {
    gdp: React.RefObject<HTMLDivElement | null>;
    growth: React.RefObject<HTMLDivElement | null>;
    trade: React.RefObject<HTMLDivElement | null>;
    exports: React.RefObject<HTMLDivElement | null>;
    imports: React.RefObject<HTMLDivElement | null>;
  };
}

function HiddenCharts({ dataset, refs }: HiddenChartsProps) {
  const expMap = new Map(dataset.exportData.map(d => [d.year, d.total]));
  const impMap = new Map(dataset.importData.map(d => [d.year, d.total]));
  const tradeData = dataset.gdpData.map(d => ({
    year: d.year,
    exports: expMap.get(d.year) ?? 0,
    imports: impMap.get(d.year) ?? 0,
    balance: +((expMap.get(d.year) ?? 0) - (impMap.get(d.year) ?? 0)).toFixed(1),
  }));

  const sKeys = dataset.exportSectors.map(s => s.key);
  const pKeys = dataset.importPartners.map(s => s.key);

  const W = 680, tickStyle = { fill: "#6b7280", fontSize: 11 };

  return (
    <div style={{ position: "fixed", left: -9999, top: 0, width: W, pointerEvents: "none", visibility: "hidden" }}>

      {/* GDP trend */}
      <div ref={refs.gdp}>
        <LineChart width={W} height={240} data={dataset.gdpData} margin={{ top: 10, right: 20, left: 0, bottom: 5 }}>
          <CartesianGrid {...LG} />
          <XAxis dataKey="year" tick={tickStyle} />
          <YAxis tick={tickStyle} />
          <Tooltip />
          <Line dataKey="gdp_bn" stroke={LP[0]} strokeWidth={2.5} dot={{ r: 3 }} name="GDP ($B)" />
        </LineChart>
      </div>

      {/* Growth rate */}
      <div ref={refs.growth}>
        <BarChart width={W} height={200} data={dataset.gdpData} margin={{ top: 10, right: 20, left: 0, bottom: 5 }}>
          <CartesianGrid {...LG} />
          <XAxis dataKey="year" tick={tickStyle} />
          <YAxis tick={tickStyle} />
          <Tooltip />
          <Bar dataKey="gdp_growth" name="GDP Growth (%)" fill={LP[0]}
            label={false}
            // colour bars individually: green positive, red negative
          >
            {dataset.gdpData.map((entry, idx) => (
              <rect key={idx} fill={(entry.gdp_growth ?? 0) >= 0 ? "#10b981" : "#ef4444"} />
            ))}
          </Bar>
        </BarChart>
      </div>

      {/* Trade balance */}
      <div ref={refs.trade}>
        <ComposedChart width={W} height={240} data={tradeData} margin={{ top: 10, right: 20, left: 0, bottom: 5 }}>
          <CartesianGrid {...LG} />
          <XAxis dataKey="year" tick={tickStyle} />
          <YAxis tick={tickStyle} />
          <Tooltip />
          <Bar dataKey="exports" fill={LP[2]} name="Exports ($B)" opacity={0.8} />
          <Bar dataKey="imports" fill={LP[3]} name="Imports ($B)" opacity={0.8} />
          <Line dataKey="balance" stroke={LP[1]} strokeWidth={2} name="Balance ($B)" dot={{ r: 3 }} />
        </ComposedChart>
      </div>

      {/* Export composition (stacked bars) */}
      <div ref={refs.exports}>
        <BarChart width={W} height={220} data={dataset.exportData} margin={{ top: 10, right: 20, left: 0, bottom: 5 }}>
          <CartesianGrid {...LG} />
          <XAxis dataKey="year" tick={tickStyle} />
          <YAxis tick={tickStyle} />
          <Tooltip />
          {sKeys.map((k, i) => (
            <Bar key={k} dataKey={k} stackId="a" fill={LP[i % LP.length]}
              name={dataset.exportSectors[i]?.label ?? k} />
          ))}
        </BarChart>
      </div>

      {/* Import breakdown (stacked area) */}
      <div ref={refs.imports}>
        <AreaChart width={W} height={220} data={dataset.importData} margin={{ top: 10, right: 20, left: 0, bottom: 5 }}>
          <CartesianGrid {...LG} />
          <XAxis dataKey="year" tick={tickStyle} />
          <YAxis tick={tickStyle} />
          <Tooltip />
          {pKeys.map((k, i) => (
            <Area key={k} dataKey={k} stackId="a"
              fill={LP[i % LP.length]} stroke={LP[i % LP.length]}
              name={dataset.importPartners[i]?.label ?? k} />
          ))}
        </AreaChart>
      </div>

    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

interface ExportModeProps {
  dashDataset:      CountryDataset | null;
  analyticsDataset: CountryDataset | null;
}

export default function ExportMode({ dashDataset, analyticsDataset }: ExportModeProps) {
  const [toast, setToast]         = useState<string | null>(null);
  const [generating, setGenerating] = useState<"dash" | "analytics" | null>(null);
  const isMobile = useMobile();

  // Refs for off-screen chart SVG extraction
  const chartRefs = {
    gdp:     useRef<HTMLDivElement>(null),
    growth:  useRef<HTMLDivElement>(null),
    trade:   useRef<HTMLDivElement>(null),
    exports: useRef<HTMLDivElement>(null),
    imports: useRef<HTMLDivElement>(null),
  };

  // Lazy-compute algorithm CSVs whenever analyticsDataset changes
  const [algoCsvs, setAlgoCsvs] = useState<Record<string, string>>({});
  useEffect(() => {
    if (analyticsDataset) setAlgoCsvs(buildAlgoCSVs(analyticsDataset));
    else setAlgoCsvs({});
  }, [analyticsDataset]);

  const showToast = useCallback((msg: string) => setToast(msg), []);

  // Extract one SVG from a chart container ref
  function extractSVG(ref: React.RefObject<HTMLDivElement | null>): string {
    const svg = ref.current?.querySelector("svg");
    if (!svg) return "";
    const clone = svg.cloneNode(true) as SVGElement;
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    // Ensure background is white in report
    clone.style.background = "#fff";
    return new XMLSerializer().serializeToString(clone);
  }

  function handleDashCSV(which: "gdp" | "exports" | "imports" | "balance") {
    if (!dashDataset) return;
    const map = {
      gdp:     () => [gdpToCSV(dashDataset),          `${dashDataset.code}_gdp.csv`],
      exports: () => [exportsToCSV(dashDataset),      `${dashDataset.code}_exports.csv`],
      imports: () => [importsToCSV(dashDataset),      `${dashDataset.code}_imports.csv`],
      balance: () => [tradeBalanceToCSV(dashDataset), `${dashDataset.code}_trade_balance.csv`],
    } as const;
    const [csv, name] = map[which]() as [string, string];
    downloadCSV(name, csv);
    showToast(`Downloaded ${name}`);
  }

  function handleDashJSON() {
    if (!dashDataset) return;
    downloadJSON(`${dashDataset.code}_dataset.json`, dashDataset);
    showToast(`Downloaded ${dashDataset.code}_dataset.json`);
  }

  function handleDashReport(print = false) {
    if (!dashDataset) return;
    setGenerating("dash");
    // Allow HiddenCharts one extra tick to finish rendering
    setTimeout(() => {
      const svgs = {
        gdp:     extractSVG(chartRefs.gdp),
        growth:  extractSVG(chartRefs.growth),
        trade:   extractSVG(chartRefs.trade),
        exports: extractSVG(chartRefs.exports),
        imports: extractSVG(chartRefs.imports),
      };
      const html = buildDashboardHTML(dashDataset, svgs);
      if (print) {
        printHTML(html);
      } else {
        const name = `${dashDataset.code}_economic_report.html`;
        downloadCSV(name.replace(".csv", ""), html);   // reuse downloadBlob via alias
        // use dedicated download
        const blob = new Blob([html], { type: "text/html;charset=utf-8" });
        const url  = URL.createObjectURL(blob);
        const a    = Object.assign(document.createElement("a"), { href: url, download: `${dashDataset.code}_economic_report.html` });
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        showToast("Report downloaded");
      }
      setGenerating(null);
    }, 120);
  }

  function handleAlgoCSV(key: string) {
    const csv = algoCsvs[key];
    if (!csv || !analyticsDataset) return;
    const name = `${analyticsDataset.code}_${key}.csv`;
    downloadCSV(name, csv);
    showToast(`Downloaded ${name}`);
  }

  function handleAlgoJSON() {
    if (!analyticsDataset) return;
    downloadJSON(`${analyticsDataset.code}_all_algorithms.json`, algoCsvs);
    showToast("Downloaded all algorithm results as JSON");
  }

  async function handleCopySummary(ds: CountryDataset) {
    const latest = ds.gdpData[ds.gdpData.length - 1];
    const text = [
      `${ds.flag} ${ds.name} — Economic Summary`,
      `Region: ${ds.region}`,
      `GDP: $${latest?.gdp_bn}B (${latest?.year})`,
      `Growth: ${latest?.gdp_growth}%`,
      `GDP per capita: $${latest?.gdp_per_capita?.toLocaleString()}`,
      ...ds.kpis.map(k => `${k.label}: ${k.value} (${k.sub})`),
    ].join("\n");
    await copyToClipboard(text);
    showToast("Summary copied to clipboard");
  }

  // ── Panel card ──────────────────────────────────────────────────────────────
  function Panel({
    title, icon, color, dataset, empty,
    children,
  }: {
    title: string; icon: string; color: string;
    dataset: CountryDataset | null; empty: string;
    children: React.ReactNode;
  }) {
    return (
      <div style={{ background: "#0d1018", border: "1px solid #1e2130", borderRadius: 12, padding: "20px 22px", flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 16 }}>
          <div style={{ width: 32, height: 32, borderRadius: 8, background: color + "22", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>{icon}</div>
          <div>
            <p style={{ margin: 0, fontSize: 14, fontWeight: 700, color: "#e2e8f0" }}>{title}</p>
            {dataset
              ? <p style={{ margin: 0, fontSize: 11, color: "#475569" }}>{dataset.flag} {dataset.name} · {dataset.gdpData.length} years of data</p>
              : <p style={{ margin: 0, fontSize: 11, color: "#374151" }}>{empty}</p>
            }
          </div>
          {dataset && (
            <div style={{ marginLeft: "auto", padding: "2px 8px", borderRadius: 4, background: color + "22", border: `1px solid ${color}44`, fontSize: 10, fontWeight: 700, color, letterSpacing: "0.4px" }}>
              LOADED
            </div>
          )}
        </div>
        {children}
      </div>
    );
  }

  const ALGO_DEFS: { key: string; name: string; icon: string }[] = [
    { key: "regression",  name: "OLS Regression",     icon: "📈" },
    { key: "cagr",        name: "CAGR Analysis",       icon: "📊" },
    { key: "hp_filter",   name: "HP Filter",           icon: "〰️" },
    { key: "correlation", name: "Correlation Matrix",  icon: "🔗" },
    { key: "hhi",         name: "HHI Concentration",   icon: "⚖️" },
    { key: "anomaly",     name: "Anomaly Detection",   icon: "🚨" },
    { key: "kmeans",      name: "K-Means Clustering",  icon: "🔵" },
    { key: "openness",    name: "Trade Openness",       icon: "🌐" },
  ];

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto" }}>

      {/* Hidden off-screen charts for SVG extraction */}
      {dashDataset && <HiddenCharts dataset={dashDataset} refs={chartRefs} />}

      {/* ── Page header ── */}
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ margin: "0 0 4px", fontSize: 22, fontWeight: 800, color: "#e2e8f0", letterSpacing: "-0.3px" }}>
          📤 Export &amp; Reports
        </h1>
        <p style={{ margin: 0, fontSize: 13, color: "#475569" }}>
          Download country data as CSV / JSON · Generate standalone HTML reports with embedded charts · Print to PDF
        </p>
      </div>

      {/* ── Two-panel layout ── */}
      <div style={{ display: "flex", gap: 16, alignItems: "flex-start", flexDirection: isMobile ? "column" : "row" }}>

        {/* ── Panel 1: Country Data ── */}
        <Panel title="Country Data" icon="🌍" color="#00AAFF"
          dataset={dashDataset}
          empty="No country loaded — open the Country Data tab and select a country first">

          {dashDataset ? (
            <>
              <SectionTitle>Raw Data Downloads</SectionTitle>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                <ExportBtn icon="📉" label="GDP CSV"           onClick={() => handleDashCSV("gdp")}     color="#00AAFF" />
                <ExportBtn icon="📦" label="Exports CSV"       onClick={() => handleDashCSV("exports")} color="#10b981" />
                <ExportBtn icon="📥" label="Imports CSV"       onClick={() => handleDashCSV("imports")} color="#ef4444" />
                <ExportBtn icon="⚖️" label="Trade Balance CSV" onClick={() => handleDashCSV("balance")} color="#f59e0b" />
              </div>
              <div style={{ marginTop: 6 }}>
                <ExportBtn icon="🗂" label="Full Dataset JSON" onClick={handleDashJSON} color="#8b5cf6" full />
              </div>

              <SectionTitle>Clipboard</SectionTitle>
              <ExportBtn icon="📋" label="Copy summary to clipboard" onClick={() => handleCopySummary(dashDataset)} color="#06b6d4" full />

              <SectionTitle>Full Report</SectionTitle>
              <p style={{ fontSize: 11, color: "#374151", margin: "0 0 8px" }}>
                Generates a standalone .html file with embedded SVG charts, KPI cards, and data tables.
              </p>
              <div style={{ display: "flex", gap: 6 }}>
                <div style={{ flex: 1 }}>
                  <ExportBtn
                    icon={generating === "dash" ? "⏳" : "⬇"}
                    label={generating === "dash" ? "Generating…" : "Download HTML"}
                    onClick={() => handleDashReport(false)}
                    color="#00AAFF"
                    disabled={generating === "dash"}
                    full
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <ExportBtn
                    icon="🖨"
                    label="Print / Save PDF"
                    onClick={() => handleDashReport(true)}
                    color="#8b5cf6"
                    disabled={generating === "dash"}
                    full
                  />
                </div>
              </div>

              {/* Data preview table */}
              <SectionTitle>Preview — GDP Data ({dashDataset.gdpData.length} rows)</SectionTitle>
              <div style={{ overflowX: "auto", borderRadius: 6, border: "1px solid #1e2130" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                  <thead>
                    <tr style={{ background: "#161929" }}>
                      {["Year","GDP ($B)","Growth %","GDP/Capita"].map(h => (
                        <th key={h} style={{ padding: "6px 10px", textAlign: "right", color: "#475569", fontWeight: 600, borderBottom: "1px solid #1e2130", whiteSpace: "nowrap" }}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {dashDataset.gdpData.slice(-8).map(d => (
                      <tr key={d.year}>
                        <td style={{ padding: "5px 10px", textAlign: "right", color: "#94a3b8", borderBottom: "1px solid #0f1117" }}>{d.year}</td>
                        <td style={{ padding: "5px 10px", textAlign: "right", color: "#e2e8f0", borderBottom: "1px solid #0f1117", fontWeight: 600 }}>${d.gdp_bn}B</td>
                        <td style={{ padding: "5px 10px", textAlign: "right", borderBottom: "1px solid #0f1117", color: (d.gdp_growth ?? 0) >= 0 ? "#10b981" : "#ef4444", fontWeight: 600 }}>
                          {d.gdp_growth != null ? `${d.gdp_growth > 0 ? "+" : ""}${d.gdp_growth}%` : "—"}
                        </td>
                        <td style={{ padding: "5px 10px", textAlign: "right", color: "#94a3b8", borderBottom: "1px solid #0f1117" }}>
                          {d.gdp_per_capita != null ? `$${d.gdp_per_capita.toLocaleString()}` : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <div style={{ textAlign: "center", padding: "40px 0", color: "#374151" }}>
              <div style={{ fontSize: 40, marginBottom: 10 }}>🌍</div>
              <p style={{ margin: 0, fontSize: 13 }}>Load a country in the <strong style={{ color: "#00AAFF" }}>Country Data</strong> tab first</p>
            </div>
          )}
        </Panel>

        {/* ── Panel 2: Algorithm Results ── */}
        <Panel title="Algorithm Results" icon="🧮" color="#EF4444"
          dataset={analyticsDataset}
          empty="No analytics country loaded — open the Analytics tab and select a country first">

          {analyticsDataset ? (
            <>
              <SectionTitle>Individual Algorithm CSVs</SectionTitle>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {ALGO_DEFS.map(({ key, name, icon }) => (
                  <ExportBtn
                    key={key}
                    icon={icon}
                    label={`${name} CSV`}
                    onClick={() => handleAlgoCSV(key)}
                    color="#EF4444"
                    disabled={!algoCsvs[key]}
                    full
                  />
                ))}
              </div>

              <SectionTitle>Bulk Export</SectionTitle>
              <ExportBtn icon="🗂" label="All Algorithm Results → JSON" onClick={handleAlgoJSON} color="#8b5cf6" full />

              {/* Row-count summary */}
              <SectionTitle>Result Summary</SectionTitle>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4 }}>
                {ALGO_DEFS.map(({ key, name }) => {
                  const csv = algoCsvs[key];
                  const rows = csv ? csv.split("\n").length - 1 : 0;
                  return (
                    <div key={key} style={{ background: "#161929", borderRadius: 6, padding: "7px 10px", border: "1px solid #1e2130" }}>
                      <p style={{ margin: 0, fontSize: 10, color: "#475569", fontWeight: 600 }}>{name}</p>
                      <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: csv ? "#e2e8f0" : "#374151" }}>
                        {csv ? `${rows} rows` : "—"}
                      </p>
                    </div>
                  );
                })}
              </div>
            </>
          ) : (
            <div style={{ textAlign: "center", padding: "40px 0", color: "#374151" }}>
              <div style={{ fontSize: 40, marginBottom: 10 }}>🧮</div>
              <p style={{ margin: 0, fontSize: 13 }}>Load a country in the <strong style={{ color: "#EF4444" }}>Analytics</strong> tab first</p>
            </div>
          )}
        </Panel>
      </div>

      {/* ── Format reference ── */}
      <div style={{ marginTop: 20, background: "#0d1018", border: "1px solid #1e2130", borderRadius: 10, padding: "16px 20px" }}>
        <p style={{ margin: "0 0 10px", fontSize: 12, fontWeight: 700, color: "#475569", textTransform: "uppercase", letterSpacing: "0.6px" }}>File Formats</p>
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(3, 1fr)", gap: 10 }}>
          {[
            { fmt: "CSV", desc: "Comma-separated values — opens in Excel, Google Sheets, pandas, R, etc.", color: "#10b981" },
            { fmt: "JSON", desc: "Structured object — all fields included, suitable for API ingestion or archiving.", color: "#f59e0b" },
            { fmt: "HTML Report", desc: "Standalone file with embedded SVG charts and tables — shareable, offline-ready, printable as PDF.", color: "#00AAFF" },
          ].map(({ fmt, desc, color }) => (
            <div key={fmt} style={{ background: "#161929", borderRadius: 7, padding: "10px 12px", border: `1px solid ${color}33` }}>
              <p style={{ margin: "0 0 4px", fontSize: 11, fontWeight: 700, color }}>{fmt}</p>
              <p style={{ margin: 0, fontSize: 11, color: "#475569", lineHeight: 1.5 }}>{desc}</p>
            </div>
          ))}
        </div>
      </div>

      {toast && <Toast msg={toast} onDone={() => setToast(null)} />}
    </div>
  );
}
