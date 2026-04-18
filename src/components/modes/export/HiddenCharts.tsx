// Off-screen chart rendering used to extract SVGs for HTML reports.

import type { RefObject } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  LineChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { CountryDataset } from "@/types";
import { LIGHT_GRID_STYLE, LIGHT_PALETTE } from "./constants";

interface HiddenChartRefs {
  gdp: RefObject<HTMLDivElement | null>;
  growth: RefObject<HTMLDivElement | null>;
  trade: RefObject<HTMLDivElement | null>;
  exports: RefObject<HTMLDivElement | null>;
  imports: RefObject<HTMLDivElement | null>;
}

interface HiddenChartsProps {
  dataset: CountryDataset;
  refs: HiddenChartRefs;
}

function buildTradeData(dataset: CountryDataset) {
  const exportByYear = new Map(
    dataset.exportData.map((entry) => [entry.year, entry.total]),
  );
  const importByYear = new Map(
    dataset.importData.map((entry) => [entry.year, entry.total]),
  );

  return dataset.gdpData.map((entry) => ({
    year: entry.year,
    exports: exportByYear.get(entry.year) ?? 0,
    imports: importByYear.get(entry.year) ?? 0,
    balance: +(
      (exportByYear.get(entry.year) ?? 0) - (importByYear.get(entry.year) ?? 0)
    ).toFixed(1),
  }));
}

export function HiddenCharts({ dataset, refs }: HiddenChartsProps) {
  const tradeData = buildTradeData(dataset);
  const exportSectorKeys = dataset.exportSectors.map((series) => series.key);
  const importPartnerKeys = dataset.importPartners.map((series) => series.key);
  const width = 680;
  const tickStyle = { fill: "#6b7280", fontSize: 11 };

  return (
    <div
      className="fixed top-0 -left-[9999px] pointer-events-none invisible"
      style={{ width }}
    >
      <div ref={refs.gdp}>
        <LineChart
          width={width}
          height={240}
          data={dataset.gdpData}
          margin={{ top: 10, right: 20, left: 0, bottom: 5 }}
        >
          <CartesianGrid {...LIGHT_GRID_STYLE} />
          <XAxis dataKey="year" tick={tickStyle} />
          <YAxis tick={tickStyle} />
          <Tooltip />
          <Line
            dataKey="gdp_bn"
            stroke={LIGHT_PALETTE[0]}
            strokeWidth={2.5}
            dot={{ r: 3 }}
            name="GDP ($B)"
          />
        </LineChart>
      </div>

      <div ref={refs.growth}>
        <BarChart
          width={width}
          height={200}
          data={dataset.gdpData}
          margin={{ top: 10, right: 20, left: 0, bottom: 5 }}
        >
          <CartesianGrid {...LIGHT_GRID_STYLE} />
          <XAxis dataKey="year" tick={tickStyle} />
          <YAxis tick={tickStyle} />
          <Tooltip />
          <Bar dataKey="gdp_growth" name="GDP Growth (%)">
            {dataset.gdpData.map((entry, index) => (
              <Cell
                key={index}
                fill={(entry.gdp_growth ?? 0) >= 0 ? "#10b981" : "#ef4444"}
              />
            ))}
          </Bar>
        </BarChart>
      </div>

      <div ref={refs.trade}>
        <ComposedChart
          width={width}
          height={240}
          data={tradeData}
          margin={{ top: 10, right: 20, left: 0, bottom: 5 }}
        >
          <CartesianGrid {...LIGHT_GRID_STYLE} />
          <XAxis dataKey="year" tick={tickStyle} />
          <YAxis tick={tickStyle} />
          <Tooltip />
          <Bar
            dataKey="exports"
            fill={LIGHT_PALETTE[2]}
            name="Exports ($B)"
            opacity={0.8}
          />
          <Bar
            dataKey="imports"
            fill={LIGHT_PALETTE[3]}
            name="Imports ($B)"
            opacity={0.8}
          />
          <Line
            dataKey="balance"
            stroke={LIGHT_PALETTE[1]}
            strokeWidth={2}
            name="Balance ($B)"
            dot={{ r: 3 }}
          />
        </ComposedChart>
      </div>

      <div ref={refs.exports}>
        <BarChart
          width={width}
          height={220}
          data={dataset.exportData}
          margin={{ top: 10, right: 20, left: 0, bottom: 5 }}
        >
          <CartesianGrid {...LIGHT_GRID_STYLE} />
          <XAxis dataKey="year" tick={tickStyle} />
          <YAxis tick={tickStyle} />
          <Tooltip />
          {exportSectorKeys.map((key, index) => (
            <Bar
              key={key}
              dataKey={key}
              stackId="a"
              fill={LIGHT_PALETTE[index % LIGHT_PALETTE.length]}
              name={dataset.exportSectors[index]?.label ?? key}
            />
          ))}
        </BarChart>
      </div>

      <div ref={refs.imports}>
        <AreaChart
          width={width}
          height={220}
          data={dataset.importData}
          margin={{ top: 10, right: 20, left: 0, bottom: 5 }}
        >
          <CartesianGrid {...LIGHT_GRID_STYLE} />
          <XAxis dataKey="year" tick={tickStyle} />
          <YAxis tick={tickStyle} />
          <Tooltip />
          {importPartnerKeys.map((key, index) => (
            <Area
              key={key}
              dataKey={key}
              stackId="a"
              fill={LIGHT_PALETTE[index % LIGHT_PALETTE.length]}
              stroke={LIGHT_PALETTE[index % LIGHT_PALETTE.length]}
              name={dataset.importPartners[index]?.label ?? key}
            />
          ))}
        </AreaChart>
      </div>
    </div>
  );
}
