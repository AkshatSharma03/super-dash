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
import { useRef, useState, useMemo } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useMobile } from "../../utils/useMobile";
import {
  LineChart, BarChart, ComposedChart,
  Bar, Line, Area, AreaChart, Cell,
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

const ALGO_DEFS: { key: string; name: string; icon: string }[] = [
  { key: "regression",  name: "OLS Regression",     icon: "OLS" },
  { key: "cagr",        name: "CAGR Analysis",       icon: "CAGR" },
  { key: "hp_filter",   name: "HP Filter",           icon: "HP" },
  { key: "correlation", name: "Correlation Matrix",  icon: "CORR" },
  { key: "hhi",         name: "HHI Concentration",   icon: "HHI" },
  { key: "anomaly",     name: "Anomaly Detection",   icon: "ANOM" },
  { key: "kmeans",      name: "K-Means Clustering",  icon: "KM" },
  { key: "openness",    name: "Trade Openness",       icon: "OPEN" },
];

// ── Tiny UI helpers ───────────────────────────────────────────────────────────

interface ExportBtnProps {
  label: string;
  icon: string;
  onClick: () => void;
  disabled?: boolean;
  full?: boolean;
}
function ExportBtn({ label, icon, onClick, disabled, full }: ExportBtnProps) {
  return (
    <Button variant="outline" size="sm" onClick={onClick} disabled={disabled}
      className={`gap-1.5 text-xs font-medium ${full ? "w-full justify-start" : ""}`}>
      <span>{icon}</span>{label}
    </Button>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[10px] font-black text-memphis-black/50 uppercase tracking-[0.8px] mt-5 mb-2">
      {children}
    </p>
  );
}

function Panel({
  title, icon, color, dataset, empty, children,
}: {
  title: string; icon: string; color: string;
  dataset: CountryDataset | null; empty: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-white border-4 border-memphis-black px-4 sm:px-6 py-4 sm:py-5 flex-1 min-w-0 shadow-hard relative">
      <div className="absolute -top-2 -right-2 w-5 h-5" style={{ background: color, border: "3px solid #1A1A2E" }} />
      <div className="flex items-center gap-3 mb-4">
        <div className="w-8 h-8 flex items-center justify-center text-base shrink-0 border-3 border-memphis-black shadow-hard-sm" style={{ background: color }}>{icon}</div>
        <div>
          <p className="text-sm font-black text-memphis-black uppercase tracking-wide">{title}</p>
          {dataset
            ? <p className="text-[11px] text-memphis-black/60 font-medium">{dataset.flag} {dataset.name} · {dataset.gdpData.length} years of data</p>
            : <p className="text-[11px] text-memphis-black/50 font-medium">{empty}</p>
          }
        </div>
        {dataset && (
          <div className="ml-auto px-2 py-0.5 border-2 border-memphis-black text-[10px] font-black tracking-[0.4px] bg-white shadow-hard-sm uppercase"
            style={{ color }}>
            LOADED
          </div>
        )}
      </div>
      {children}
    </div>
  );
}

// ── Algorithm CSV builders ────────────────────────────────────────────────────

function buildAlgoCSVs(ds: CountryDataset): Record<string, string> {
  const out: Record<string, string> = {};

  try {
    const { points } = buildForecast(ds.gdpData.map(d => ({ year: d.year, value: d.gdp_bn })), []);
    out.regression = toCSVString(
      ["year", "actual_gdp_bn", "trend_gdp_bn", "ci_low", "ci_high", "is_forecast"],
      points.map(p => [p.year, p.actual ?? "", p.trend ?? "", p.ciLow ?? "", p.ciHigh ?? "", p.isForecast ? 1 : 0]),
    );
  } catch { /* skip */ }

  try {
    const { periods, fullPeriod } = buildCAGRSeries(ds.gdpData, ds.exportData, ds.importData);
    out.cagr = toCSVString(
      ["period", "start_year", "end_year", "gdp_cagr_pct", "exports_cagr_pct", "imports_cagr_pct", "per_capita_cagr_pct"],
      [...periods, fullPeriod].map(s => [s.label, s.startYear, s.endYear, s.gdp ?? "", s.exports ?? "", s.imports ?? "", s.perCapita ?? ""]),
    );
  } catch { /* skip */ }

  try {
    const { points } = hpFilter(ds.gdpData.map(d => ({ year: d.year, value: d.gdp_bn })));
    out.hp_filter = toCSVString(
      ["year", "actual_gdp_bn", "trend_gdp_bn", "cycle_gdp_bn"],
      points.map(p => [p.year, p.actual, +p.trend.toFixed(2), +p.cycle.toFixed(2)]),
    );
  } catch { /* skip */ }

  try {
    const { cells } = buildCorrelationMatrix(ds.gdpData, ds.exportData, ds.importData);
    out.correlation = toCSVString(
      ["variable_1", "variable_2", "pearson_r", "strength", "direction"],
      cells.filter(c => c.rowLabel !== c.colLabel).map(c => [c.rowLabel, c.colLabel, +c.r.toFixed(4), c.strength, c.direction]),
    );
  } catch { /* skip */ }

  try {
    const hhi = buildGenericHHITimeSeries(ds.exportData, ds.importData, ds.exportSectors, ds.importPartners);
    out.hhi = toCSVString(
      ["year", "export_hhi", "export_level", "import_hhi", "import_level"],
      hhi.map(h => [h.year, h.exportHHI, h.exportLevel, h.importHHI, h.importLevel]),
    );
  } catch { /* skip */ }

  try {
    const anomalies = detectAllAnomaliesGeneric(ds.gdpData, ds.exportData, ds.importData);
    out.anomaly = toCSVString(
      ["year", "metric", "value", "z_score", "direction", "severity"],
      anomalies.map(a => [a.year, a.metric, a.value, +a.zScore.toFixed(3), a.direction, a.severity]),
    );
  } catch { /* skip */ }

  try {
    const valid = ds.gdpData.filter(d => d.gdp_growth != null);
    const years = valid.map(d => d.year);
    const growths = valid.map(d => d.gdp_growth!);
    const { assignments } = kmeans(valid.map(d => [d.gdp_growth!, d.gdp_bn]), 3);
    const clusters = labelClusters(years, growths, assignments, 3);
    const yearCluster = new Map<number, string>();
    clusters.forEach(cl => cl.years.forEach(y => yearCluster.set(y, cl.label)));
    out.kmeans = toCSVString(
      ["year", "gdp_bn", "gdp_growth_pct", "cluster"],
      valid.map(d => [d.year, d.gdp_bn, d.gdp_growth!, yearCluster.get(d.year) ?? ""]),
    );
  } catch { /* skip */ }

  try {
    const expMap = new Map(ds.exportData.map(d => [d.year, d.total]));
    const impMap = new Map(ds.importData.map(d => [d.year, d.total]));
    out.openness = toCSVString(
      ["year", "exports_bn", "imports_bn", "gdp_bn", "openness_pct"],
      ds.gdpData.map(d => {
        const exp = expMap.get(d.year) ?? 0;
        const imp = impMap.get(d.year) ?? 0;
        return [d.year, exp || "", imp || "", d.gdp_bn, d.gdp_bn > 0 ? +(((exp + imp) / d.gdp_bn) * 100).toFixed(1) : ""];
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
    <div className="fixed top-0 -left-[9999px] pointer-events-none invisible" style={{ width: W }}>
      <div ref={refs.gdp}>
        <LineChart width={W} height={240} data={dataset.gdpData} margin={{ top: 10, right: 20, left: 0, bottom: 5 }}>
          <CartesianGrid {...LG} />
          <XAxis dataKey="year" tick={tickStyle} />
          <YAxis tick={tickStyle} />
          <Tooltip />
          <Line dataKey="gdp_bn" stroke={LP[0]} strokeWidth={2.5} dot={{ r: 3 }} name="GDP ($B)" />
        </LineChart>
      </div>

      <div ref={refs.growth}>
        <BarChart width={W} height={200} data={dataset.gdpData} margin={{ top: 10, right: 20, left: 0, bottom: 5 }}>
          <CartesianGrid {...LG} />
          <XAxis dataKey="year" tick={tickStyle} />
          <YAxis tick={tickStyle} />
          <Tooltip />
          <Bar dataKey="gdp_growth" name="GDP Growth (%)">
            {dataset.gdpData.map((entry, idx) => (
              <Cell key={idx} fill={(entry.gdp_growth ?? 0) >= 0 ? "#10b981" : "#ef4444"} />
            ))}
          </Bar>
        </BarChart>
      </div>

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
  const [generating, setGenerating] = useState<"dash" | null>(null);
  const isMobile = useMobile();

  // Stable individual refs for off-screen chart SVG extraction
  const gdpRef     = useRef<HTMLDivElement>(null);
  const growthRef  = useRef<HTMLDivElement>(null);
  const tradeRef   = useRef<HTMLDivElement>(null);
  const exportsRef = useRef<HTMLDivElement>(null);
  const importsRef = useRef<HTMLDivElement>(null);
  const chartRefs  = useMemo(
    () => ({ gdp: gdpRef, growth: growthRef, trade: tradeRef, exports: exportsRef, imports: importsRef }),
    [],
  );

  // Compute algorithm CSVs — memoized, avoids double-render vs useEffect+setState
  const algoCsvs = useMemo(
    () => analyticsDataset ? buildAlgoCSVs(analyticsDataset) : {} as Record<string, string>,
    [analyticsDataset],
  );

  // Extract one SVG from a chart container ref
  function extractSVG(ref: React.RefObject<HTMLDivElement | null>): string {
    const svg = ref.current?.querySelector("svg");
    if (!svg) return "";
    const clone = svg.cloneNode(true) as SVGElement;
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
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
    toast.success(`Downloaded ${name}`);
  }

  function handleDashJSON() {
    if (!dashDataset) return;
    downloadJSON(`${dashDataset.code}_dataset.json`, dashDataset);
    toast.success(`Downloaded ${dashDataset.code}_dataset.json`);
  }

  function handleDashReport(print = false) {
    if (!dashDataset) return;
    setGenerating("dash");
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
        const blob = new Blob([html], { type: "text/html;charset=utf-8" });
        const url  = URL.createObjectURL(blob);
        const a    = Object.assign(document.createElement("a"), { href: url, download: `${dashDataset.code}_economic_report.html` });
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        toast.success("Report downloaded");
      }
      setGenerating(null);
    }, 120);
  }

  function handleAlgoCSV(key: string) {
    const csv = algoCsvs[key];
    if (!csv || !analyticsDataset) return;
    const name = `${analyticsDataset.code}_${key}.csv`;
    downloadCSV(name, csv);
    toast.success(`Downloaded ${name}`);
  }

  function handleAlgoJSON() {
    if (!analyticsDataset) return;
    downloadJSON(`${analyticsDataset.code}_all_algorithms.json`, algoCsvs);
    toast.success("Downloaded all algorithm results as JSON");
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
    toast.success("Summary copied to clipboard");
  }

  return (
    <div className="max-w-[1100px] mx-auto px-1 sm:px-0">

      {dashDataset && <HiddenCharts dataset={dashDataset} refs={chartRefs} />}

      <div className="mb-6">
          <h1 className="text-[22px] font-black text-memphis-black tracking-tight mb-1 uppercase">
          Export &amp; Reports
          </h1>
        <p className="text-[13px] text-memphis-black/60 font-medium">
          Download country data as CSV / JSON · Generate standalone HTML reports with embedded charts · Print to PDF
        </p>
      </div>

      <div className={`flex gap-4 items-start ${isMobile ? "flex-col" : ""}`}>

        <Panel title="Country Data" icon="CD" color="#00AAFF"
          dataset={dashDataset}
          empty="No country loaded — open the Country Data tab and select a country first">

          {dashDataset ? (
            <>
              <SectionTitle>Raw Data Downloads</SectionTitle>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                <ExportBtn icon="CSV" label="GDP CSV"           onClick={() => handleDashCSV("gdp")} />
                <ExportBtn icon="CSV" label="Exports CSV"       onClick={() => handleDashCSV("exports")} />
                <ExportBtn icon="CSV" label="Imports CSV"       onClick={() => handleDashCSV("imports")} />
                <ExportBtn icon="CSV" label="Trade Balance CSV" onClick={() => handleDashCSV("balance")} />
              </div>
              <div className="mt-1.5">
                <ExportBtn icon="JSON" label="Full Dataset JSON" onClick={handleDashJSON} full />
              </div>

              <SectionTitle>Clipboard</SectionTitle>
              <ExportBtn icon="COPY" label="Copy summary to clipboard" onClick={() => handleCopySummary(dashDataset)} full />

              <SectionTitle>Full Report</SectionTitle>
              <p className="text-[11px] text-memphis-black/50 mb-2 font-medium">
                Generates a standalone .html file with embedded SVG charts, KPI cards, and data tables.
              </p>
              <div className="flex flex-col sm:flex-row gap-1.5">
                <div className="flex-1">
                  <ExportBtn
                    icon={generating === "dash" ? "..." : "HTML"}
                    label={generating === "dash" ? "Generating…" : "Download HTML"}
                    onClick={() => handleDashReport(false)}
                    disabled={generating === "dash"}
                    full
                  />
                </div>
                <div className="flex-1">
                  <ExportBtn
                    icon="PDF"
                    label="Print / Save PDF"
                    onClick={() => handleDashReport(true)}
                    disabled={generating === "dash"}
                    full
                  />
                </div>
              </div>

              <SectionTitle>Preview — GDP Data ({dashDataset.gdpData.length} rows)</SectionTitle>
              <div className="overflow-x-auto border-3 border-memphis-black bg-white shadow-hard">
                <table className="w-full border-collapse text-[11px]">
                  <thead>
                    <tr className="bg-memphis-pink">
                      {["Year","GDP ($B)","Growth %","GDP/Capita"].map(h => (
                        <th key={h} className="px-2.5 py-1.5 text-right text-white font-black border-b-3 border-memphis-black whitespace-nowrap">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {dashDataset.gdpData.slice(-8).map(d => (
                      <tr key={d.year}>
                        <td className="px-2.5 py-1 text-right text-memphis-black/60 border-b-2 border-memphis-black/10">{d.year}</td>
                        <td className="px-2.5 py-1 text-right text-memphis-black font-bold border-b-2 border-memphis-black/10">${d.gdp_bn}B</td>
                        <td className="px-2.5 py-1 text-right font-bold border-b-2 border-memphis-black/10"
                          style={{ color: (d.gdp_growth ?? 0) >= 0 ? "#00F5D4" : "#FF006E" }}>
                          {d.gdp_growth != null ? `${d.gdp_growth > 0 ? "+" : ""}${d.gdp_growth}%` : "—"}
                        </td>
                        <td className="px-2.5 py-1 text-right text-memphis-black/60 border-b-2 border-memphis-black/10">
                          {d.gdp_per_capita != null ? `$${d.gdp_per_capita.toLocaleString()}` : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <div className="text-center py-10 text-memphis-black/60">
              <p className="text-[13px] font-medium">Load a country in the <strong className="text-memphis-pink">Country Data</strong> tab first</p>
            </div>
          )}
        </Panel>

        <Panel title="Algorithm Results" icon="ALG" color="#EF4444"
          dataset={analyticsDataset}
          empty="No analytics country loaded — open the Analytics tab and select a country first">

          {analyticsDataset ? (
            <>
              <SectionTitle>Individual Algorithm CSVs</SectionTitle>
              <div className="flex flex-col gap-1.5">
                {ALGO_DEFS.map(({ key, name, icon }) => (
                  <ExportBtn
                    key={key}
                    icon={icon}
                    label={`${name} CSV`}
                    onClick={() => handleAlgoCSV(key)}
                    disabled={!algoCsvs[key]}
                    full
                  />
                ))}
              </div>

              <SectionTitle>Bulk Export</SectionTitle>
              <ExportBtn icon="JSON" label="All Algorithm Results JSON" onClick={handleAlgoJSON} full />

              <SectionTitle>Result Summary</SectionTitle>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1">
                {ALGO_DEFS.map(({ key, name }) => {
                  const csv = algoCsvs[key];
                  const rows = csv ? csv.split("\n").length - 1 : 0;
                  return (
                    <div key={key} className="bg-white border-3 border-memphis-black px-2.5 py-[7px] shadow-hard-sm">
                      <p className="text-[10px] text-memphis-black/50 font-bold">{name}</p>
                      <p className={`text-[13px] font-black ${csv ? "text-memphis-black" : "text-memphis-black/30"}`}>
                        {csv ? `${rows} rows` : "—"}
                      </p>
                    </div>
                  );
                })}
              </div>
            </>
          ) : (
            <div className="text-center py-10 text-memphis-black/60">
              <p className="text-[13px] font-medium">Load a country in the <strong className="text-memphis-orange">Analytics</strong> tab first</p>
            </div>
          )}
        </Panel>
      </div>

      <div className="mt-5 bg-white border-4 border-memphis-black px-5 py-5 shadow-hard-lg relative">
        <div className="absolute -top-2 left-4 right-4 h-2 bg-repeating-linear-gradient"
          style={{
            background: `repeating-linear-gradient(
              90deg,
              #FF006E 0px,
              #FF006E 8px,
              #00D9FF 8px,
              #00D9FF 16px,
              #FFBE0B 16px,
              #FFBE0B 24px
            )`
          }}
        />
        <p className="text-xs font-black text-memphis-black/60 uppercase tracking-[0.6px] mb-3 mt-1">File Formats</p>
        <div className={`grid gap-3 ${isMobile ? "grid-cols-1" : "grid-cols-3"}`}>
          {[
            { fmt: "CSV", desc: "Comma-separated values — opens in Excel, Google Sheets, pandas, R, etc.", color: "#00F5D4", bg: "#00F5D4" },
            { fmt: "JSON", desc: "Structured object — all fields included, suitable for API ingestion or archiving.", color: "#FFBE0B", bg: "#FFBE0B" },
            { fmt: "HTML Report", desc: "Standalone file with embedded SVG charts and tables — shareable, offline-ready, printable as PDF.", color: "#FF006E", bg: "#FF006E" },
          ].map(({ fmt, desc, color, bg }) => (
            <div key={fmt} className="bg-white border-3 border-memphis-black px-3 py-3 shadow-hard-sm relative">
              <div className="absolute -top-2 -right-2 w-4 h-4 border-2 border-memphis-black" style={{ background: bg }} />
              <p className="mb-1 text-[11px] font-black uppercase" style={{ color }}>{fmt}</p>
              <p className="text-[11px] text-memphis-black/60 leading-relaxed font-medium">{desc}</p>
            </div>
          ))}
        </div>
      </div>

    </div>
  );
}
