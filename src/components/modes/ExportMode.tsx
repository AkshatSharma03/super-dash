// Export page orchestrator:
// - country dataset exports (CSV/JSON/HTML/PDF)
// - algorithm result exports (CSV/JSON)

import { useMemo, useRef, useState, type RefObject } from "react";
import { toast } from "sonner";
import { useMobile } from "../../utils/useMobile";
import type { CountryDataset } from "../../types";
import {
  buildDashboardHTML,
  copyToClipboard,
  downloadCSV,
  downloadJSON,
  exportsToCSV,
  gdpToCSV,
  importsToCSV,
  printHTML,
  tradeBalanceToCSV,
} from "../../utils/export";
import { ALGO_DEFS, FILE_FORMATS } from "./export/constants";
import { buildAlgoCSVs } from "./export/buildAlgoCsvs";
import { HiddenCharts } from "./export/HiddenCharts";
import { ExportBtn, Panel, SectionTitle } from "./export/ui";

interface ExportModeProps {
  dashDataset: CountryDataset | null;
  analyticsDataset: CountryDataset | null;
}

interface ChartRefs {
  gdp: RefObject<HTMLDivElement | null>;
  growth: RefObject<HTMLDivElement | null>;
  trade: RefObject<HTMLDivElement | null>;
  exports: RefObject<HTMLDivElement | null>;
  imports: RefObject<HTMLDivElement | null>;
}

type DashboardCsvKey = "gdp" | "exports" | "imports" | "balance";

function useDashboardChartRefs(): ChartRefs {
  return {
    gdp: useRef<HTMLDivElement>(null),
    growth: useRef<HTMLDivElement>(null),
    trade: useRef<HTMLDivElement>(null),
    exports: useRef<HTMLDivElement>(null),
    imports: useRef<HTMLDivElement>(null),
  };
}

function extractSVG(ref: RefObject<HTMLDivElement | null>) {
  const svg = ref.current?.querySelector("svg");
  if (!svg) return "";

  const clone = svg.cloneNode(true) as SVGElement;
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.style.background = "#fff";

  return new XMLSerializer().serializeToString(clone);
}

function renderGDPPreviewTable(dataset: CountryDataset) {
  return (
    <div className="overflow-x-auto border-3 border-memphis-black bg-white shadow-hard">
      <table className="w-full border-collapse text-[11px]">
        <thead>
          <tr className="bg-memphis-pink">
            {["Year", "GDP ($B)", "Growth %", "GDP/Capita"].map((header) => (
              <th
                key={header}
                className={
                  "px-2.5 py-1.5 text-right text-white font-black border-b-3 " +
                  "border-memphis-black whitespace-nowrap"
                }
              >
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {dataset.gdpData.slice(-8).map((entry) => (
            <tr key={entry.year}>
              <td
                className={
                  "px-2.5 py-1 text-right text-memphis-black/60 border-b-2 " +
                  "border-memphis-black/10"
                }
              >
                {entry.year}
              </td>
              <td
                className={
                  "px-2.5 py-1 text-right text-memphis-black font-bold " +
                  "border-b-2 border-memphis-black/10"
                }
              >
                ${entry.gdp_bn}B
              </td>
              <td
                className="px-2.5 py-1 text-right font-bold border-b-2 border-memphis-black/10"
                style={{
                  color: (entry.gdp_growth ?? 0) >= 0 ? "#00F5D4" : "#FF006E",
                }}
              >
                {entry.gdp_growth != null
                  ? `${entry.gdp_growth > 0 ? "+" : ""}${entry.gdp_growth}%`
                  : "—"}
              </td>
              <td
                className={
                  "px-2.5 py-1 text-right text-memphis-black/60 border-b-2 " +
                  "border-memphis-black/10"
                }
              >
                {entry.gdp_per_capita != null
                  ? `$${entry.gdp_per_capita.toLocaleString()}`
                  : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function ExportMode({
  dashDataset,
  analyticsDataset,
}: ExportModeProps) {
  const isMobile = useMobile();
  const [generating, setGenerating] = useState<"dash" | null>(null);

  const refs = useDashboardChartRefs();
  const chartRefs = useMemo(
    () => ({
      gdp: refs.gdp,
      growth: refs.growth,
      trade: refs.trade,
      exports: refs.exports,
      imports: refs.imports,
    }),
    [refs.gdp, refs.growth, refs.trade, refs.exports, refs.imports],
  );

  const algoCsvs = useMemo(
    () => (analyticsDataset ? buildAlgoCSVs(analyticsDataset) : {}),
    [analyticsDataset],
  );

  function handleDashCSV(which: DashboardCsvKey) {
    if (!dashDataset) return;

    const map = {
      gdp: () => [gdpToCSV(dashDataset), `${dashDataset.code}_gdp.csv`],
      exports: () => [
        exportsToCSV(dashDataset),
        `${dashDataset.code}_exports.csv`,
      ],
      imports: () => [
        importsToCSV(dashDataset),
        `${dashDataset.code}_imports.csv`,
      ],
      balance: () => [
        tradeBalanceToCSV(dashDataset),
        `${dashDataset.code}_trade_balance.csv`,
      ],
    } as const;

    const [csv, filename] = map[which]() as [string, string];
    downloadCSV(filename, csv);
    toast.success(`Downloaded ${filename}`);
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
      const svgByChart = {
        gdp: extractSVG(chartRefs.gdp),
        growth: extractSVG(chartRefs.growth),
        trade: extractSVG(chartRefs.trade),
        exports: extractSVG(chartRefs.exports),
        imports: extractSVG(chartRefs.imports),
      };

      const html = buildDashboardHTML(dashDataset, svgByChart);

      if (print) {
        const opened = printHTML(html);
        if (!opened) {
          toast.error("Popup blocked. Enable popups, then retry print.");
        }
      } else {
        const blob = new Blob([html], { type: "text/html;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const anchor = Object.assign(document.createElement("a"), {
          href: url,
          download: `${dashDataset.code}_economic_report.html`,
        });
        document.body.appendChild(anchor);
        anchor.click();
        document.body.removeChild(anchor);
        URL.revokeObjectURL(url);
        toast.success("Report downloaded");
      }

      setGenerating(null);
    }, 120);
  }

  function handleAlgoCSV(key: string) {
    const csv = algoCsvs[key];
    if (!csv || !analyticsDataset) return;

    const filename = `${analyticsDataset.code}_${key}.csv`;
    downloadCSV(filename, csv);
    toast.success(`Downloaded ${filename}`);
  }

  function handleAlgoJSON() {
    if (!analyticsDataset) return;
    downloadJSON(`${analyticsDataset.code}_all_algorithms.json`, algoCsvs);
    toast.success("Downloaded all algorithm results as JSON");
  }

  async function handleCopySummary(dataset: CountryDataset) {
    const latest = dataset.gdpData[dataset.gdpData.length - 1];
    const summary = [
      `${dataset.flag} ${dataset.name} — Economic Summary`,
      `Region: ${dataset.region}`,
      `GDP: $${latest?.gdp_bn}B (${latest?.year})`,
      `Growth: ${latest?.gdp_growth}%`,
      `GDP per capita: $${latest?.gdp_per_capita?.toLocaleString()}`,
      ...dataset.kpis.map((kpi) => `${kpi.label}: ${kpi.value} (${kpi.sub})`),
    ].join("\n");

    try {
      await copyToClipboard(summary);
      toast.success("Summary copied to clipboard");
    } catch {
      toast.error("Clipboard unavailable. Copy manually from report.");
    }
  }

  return (
    <div className="max-w-[1100px] mx-auto px-1 sm:px-0">
      {dashDataset && <HiddenCharts dataset={dashDataset} refs={chartRefs} />}

      <div className="mb-6">
        <h1 className="text-[22px] font-black text-memphis-black tracking-tight mb-1 uppercase">
          Export &amp; Reports
        </h1>
        <p className="text-[13px] text-memphis-black/60 font-medium">
          Download country data as CSV / JSON · Generate standalone HTML reports
          with embedded charts · Print to PDF
        </p>
      </div>

      <div className={`flex gap-4 items-start ${isMobile ? "flex-col" : ""}`}>
        <Panel
          title="Country Data"
          icon="CD"
          color="#00AAFF"
          dataset={dashDataset}
          empty="No country loaded — open the Country Data tab and select a country first"
        >
          {dashDataset ? (
            <>
              <SectionTitle>Raw Data Downloads</SectionTitle>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                <ExportBtn
                  icon="CSV"
                  label="GDP CSV"
                  onClick={() => handleDashCSV("gdp")}
                />
                <ExportBtn
                  icon="CSV"
                  label="Exports CSV"
                  onClick={() => handleDashCSV("exports")}
                />
                <ExportBtn
                  icon="CSV"
                  label="Imports CSV"
                  onClick={() => handleDashCSV("imports")}
                />
                <ExportBtn
                  icon="CSV"
                  label="Trade Balance CSV"
                  onClick={() => handleDashCSV("balance")}
                />
              </div>

              <div className="mt-1.5">
                <ExportBtn
                  icon="JSON"
                  label="Full Dataset JSON"
                  onClick={handleDashJSON}
                  full
                />
              </div>

              <SectionTitle>Clipboard</SectionTitle>
              <ExportBtn
                icon="COPY"
                label="Copy summary to clipboard"
                onClick={() => handleCopySummary(dashDataset)}
                full
              />

              <SectionTitle>Full Report</SectionTitle>
              <p className="text-[11px] text-memphis-black/50 mb-2 font-medium">
                Generates a standalone `.html` file with embedded SVG charts,
                KPI cards, and data tables.
              </p>
              <div className="flex flex-col sm:flex-row gap-1.5">
                <div className="flex-1">
                  <ExportBtn
                    icon={generating === "dash" ? "..." : "HTML"}
                    label={
                      generating === "dash" ? "Generating…" : "Download HTML"
                    }
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

              <SectionTitle>
                Preview — GDP Data ({dashDataset.gdpData.length} rows)
              </SectionTitle>
              {renderGDPPreviewTable(dashDataset)}
            </>
          ) : (
            <div className="text-center py-10 text-memphis-black/60">
              <p className="text-[13px] font-medium">
                <span>Load a country in the </span>
                <strong className="text-memphis-pink">Country Data</strong>
                <span> tab first</span>
              </p>
            </div>
          )}
        </Panel>

        <Panel
          title="Algorithm Results"
          icon="ALG"
          color="#EF4444"
          dataset={analyticsDataset}
          empty="No analytics country loaded — open the Analytics tab and select a country first"
        >
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
              <ExportBtn
                icon="JSON"
                label="All Algorithm Results JSON"
                onClick={handleAlgoJSON}
                full
              />

              <SectionTitle>Result Summary</SectionTitle>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1">
                {ALGO_DEFS.map(({ key, name }) => {
                  const csv = algoCsvs[key];
                  const rows = csv ? csv.split("\n").length - 1 : 0;

                  return (
                    <div
                      key={key}
                      className={
                        "bg-white border-3 border-memphis-black " +
                        "px-2.5 py-[7px] shadow-hard-sm"
                      }
                    >
                      <p className="text-[10px] text-memphis-black/50 font-bold">
                        {name}
                      </p>
                      <p
                        className={`text-[13px] font-black ${
                          csv ? "text-memphis-black" : "text-memphis-black/30"
                        }`}
                      >
                        {csv ? `${rows} rows` : "—"}
                      </p>
                    </div>
                  );
                })}
              </div>
            </>
          ) : (
            <div className="text-center py-10 text-memphis-black/60">
              <p className="text-[13px] font-medium">
                Load a country in the{" "}
                <strong className="text-memphis-orange">Analytics</strong> tab
                first
              </p>
            </div>
          )}
        </Panel>
      </div>

      <div
        className={
          "mt-5 bg-white border-4 border-memphis-black px-5 py-5 " +
          "shadow-hard-lg relative"
        }
      >
        <div
          className="absolute -top-2 left-4 right-4 h-2 bg-repeating-linear-gradient"
          style={{
            background: `repeating-linear-gradient(
              90deg,
              #FF006E 0px,
              #FF006E 8px,
              #00D9FF 8px,
              #00D9FF 16px,
              #FFBE0B 16px,
              #FFBE0B 24px
            )`,
          }}
        />
        <p
          className={
            "text-xs font-black text-memphis-black/60 uppercase " +
            "tracking-[0.6px] mb-3 mt-1"
          }
        >
          File Formats
        </p>

        <div
          className={`grid gap-3 ${isMobile ? "grid-cols-1" : "grid-cols-3"}`}
        >
          {FILE_FORMATS.map(({ fmt, desc, color, bg }) => (
            <div
              key={fmt}
              className="bg-white border-3 border-memphis-black px-3 py-3 shadow-hard-sm relative"
            >
              <div
                className="absolute -top-2 -right-2 w-4 h-4 border-2 border-memphis-black"
                style={{ background: bg }}
              />
              <p
                className="mb-1 text-[11px] font-black uppercase"
                style={{ color }}
              >
                {fmt}
              </p>
              <p className="text-[11px] text-memphis-black/60 leading-relaxed font-medium">
                {desc}
              </p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
