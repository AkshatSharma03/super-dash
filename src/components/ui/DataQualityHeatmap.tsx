import { useMemo } from "react";
import type {
  CountryDataset,
  DataQualityCell,
  DataQualityStatus,
} from "../../types";
import { cn } from "@/lib/utils";

type QualityColorMap = Record<
  DataQualityStatus,
  { bg: string; text: string; label: string }
>;

const QUALITY_COLORS: QualityColorMap = {
  complete: {
    bg: "bg-emerald-200",
    text: "text-emerald-800",
    label: "Complete",
  },
  partial: { bg: "bg-amber-100", text: "text-amber-800", label: "Partial" },
  estimated: {
    bg: "bg-orange-200",
    text: "text-orange-800",
    label: "Estimated",
  },
  missing: { bg: "bg-red-100", text: "text-red-800", label: "Missing" },
};

interface Props {
  dataset: CountryDataset;
}

function deriveQuality(dataset: CountryDataset): DataQualityCell[] {
  const cells: DataQualityCell[] = [];
  const gdpMap = new Map(dataset.gdpData.map((d) => [d.year, d]));
  const expMap = new Map(dataset.exportData.map((d) => [d.year, d]));
  const impMap = new Map(dataset.importData.map((d) => [d.year, d]));

  const allYears = [
    ...new Set([
      ...dataset.gdpData.map((d) => d.year),
      ...dataset.exportData.map((d) => d.year),
      ...dataset.importData.map((d) => d.year),
    ]),
  ].sort((a, b) => a - b);

  const sectors = dataset.exportSectors.map((s) => s.key);
  const partners = dataset.importPartners.map((p) => p.key);

  const indicators: Array<{
    key: string;
    label: string;
    getValue: (y: number) => { status: DataQualityStatus; display: string };
  }> = [
    {
      key: "gdp_bn",
      label: "GDP ($B)",
      getValue: (y) => {
        const d = gdpMap.get(y);
        if (!d || d.gdp_bn == null) return { status: "missing", display: "—" };
        return { status: "complete", display: `$${d.gdp_bn}B` };
      },
    },
    {
      key: "gdp_growth",
      label: "GDP Growth %",
      getValue: (y) => {
        const d = gdpMap.get(y);
        if (!d || d.gdp_growth == null)
          return { status: "missing", display: "—" };
        return { status: "complete", display: `${d.gdp_growth}%` };
      },
    },
    {
      key: "gdp_per_capita",
      label: "GDP/Capita",
      getValue: (y) => {
        const d = gdpMap.get(y);
        if (!d || d.gdp_per_capita == null)
          return { status: "missing", display: "—" };
        return { status: "complete", display: `$${d.gdp_per_capita}` };
      },
    },
    {
      key: "exports_total",
      label: "Total Exports",
      getValue: (y) => {
        const e = expMap.get(y);
        if (!e) return { status: "missing", display: "—" };
        if (typeof e.total !== "number")
          return { status: "estimated", display: "est." };
        return { status: "complete", display: `$${e.total}B` };
      },
    },
    {
      key: "imports_total",
      label: "Total Imports",
      getValue: (y) => {
        const im = impMap.get(y);
        if (!im) return { status: "missing", display: "—" };
        if (typeof im.total !== "number")
          return { status: "estimated", display: "est." };
        return { status: "complete", display: `$${im.total}B` };
      },
    },
    {
      key: "export_sectors",
      label: "Export Sectors",
      getValue: (y) => {
        const e = expMap.get(y);
        if (!e) return { status: "missing", display: "—" };
        const filled = sectors.filter((k) => typeof e[k] === "number").length;
        if (filled === 0) return { status: "missing", display: "—" };
        if (filled < sectors.length)
          return { status: "partial", display: `${filled}/${sectors.length}` };
        return { status: "estimated", display: `${filled}/${sectors.length}` };
      },
    },
    {
      key: "import_partners",
      label: "Import Partners",
      getValue: (y) => {
        const im = impMap.get(y);
        if (!im) return { status: "missing", display: "—" };
        const filled = partners.filter((k) => typeof im[k] === "number").length;
        if (filled === 0) return { status: "missing", display: "—" };
        if (filled < partners.length)
          return { status: "partial", display: `${filled}/${partners.length}` };
        return { status: "estimated", display: `${filled}/${partners.length}` };
      },
    },
  ];

  for (const year of allYears) {
    for (const ind of indicators) {
      const { status, display } = ind.getValue(year);
      cells.push({
        year,
        indicator: ind.key,
        indicatorLabel: ind.label,
        status,
        value: display,
      });
    }
  }

  return cells;
}

export default function DataQualityHeatmap({ dataset }: Props) {
  const qualityData = useMemo(() => deriveQuality(dataset), [dataset]);

  const allYears = useMemo(
    () => [...new Set(qualityData.map((c) => c.year))].sort((a, b) => a - b),
    [qualityData],
  );

  const indicators = useMemo(
    () => [...new Set(qualityData.map((c) => c.indicator))],
    [qualityData],
  );

  const indicatorLabels = useMemo(
    () =>
      Object.fromEntries(
        qualityData.map((c) => [c.indicator, c.indicatorLabel]),
      ),
    [qualityData],
  );

  const cellMap = useMemo(() => {
    const m = new Map<string, DataQualityCell>();
    for (const c of qualityData) m.set(`${c.year}:${c.indicator}`, c);
    return m;
  }, [qualityData]);

  const stats = useMemo(() => {
    const total = qualityData.length;
    const complete = qualityData.filter((c) => c.status === "complete").length;
    const estimated = qualityData.filter(
      (c) => c.status === "estimated",
    ).length;
    const partial = qualityData.filter((c) => c.status === "partial").length;
    const missing = qualityData.filter((c) => c.status === "missing").length;
    return {
      total,
      complete: Math.round((complete / total) * 100),
      estimated: Math.round((estimated / total) * 100),
      partial: Math.round((partial / total) * 100),
      missing: Math.round((missing / total) * 100),
    };
  }, [qualityData]);

  const [tooltip, setTooltip] = useState<{
    cell: DataQualityCell;
    x: number;
    y: number;
  } | null>(null);

  const visibleYears =
    allYears.length > 20
      ? allYears.filter((_, i) => i % 2 === 0 || i === allYears.length - 1)
      : allYears;

  return (
    <div className="border-3 border-memphis-black bg-white shadow-hard-sm">
      <div className="px-4 py-3 border-b-2 border-memphis-black/10">
        <h3 className="text-xs font-black uppercase tracking-wider text-memphis-black/70">
          Data Coverage
        </h3>
        <p className="text-[10px] text-memphis-black/50 mt-0.5">
          {stats.complete}% complete · {stats.estimated}% estimated ·{" "}
          {stats.partial}% partial · {stats.missing}% missing
        </p>
      </div>

      <div className="p-4 overflow-x-auto">
        <div className="min-w-fit">
          <div className="flex">
            <div className="w-28 shrink-0" />
            {visibleYears.map((y) => (
              <div
                key={y}
                className="w-8 text-center text-[9px] text-memphis-black/50 font-mono shrink-0"
              >
                {y}
              </div>
            ))}
          </div>

          {indicators.map((ind) => (
            <div key={ind} className="flex items-center">
              <div
                className={cn(
                  "w-28 shrink-0 text-[10px] text-memphis-black/70 font-medium",
                  "truncate pr-2",
                )}
              >
                {indicatorLabels[ind]}
              </div>
              {visibleYears.map((y) => {
                const cell = cellMap.get(`${y}:${ind}`);
                const status = cell?.status ?? "missing";
                const colors = QUALITY_COLORS[status];
                return (
                  <div
                    key={`${y}:${ind}`}
                    className={cn(
                      "w-8 h-6 border border-black/5 flex items-center",
                      "justify-center cursor-default transition-colors",
                      colors.bg,
                    )}
                    onMouseEnter={(e) => {
                      if (cell) {
                        const rect = e.currentTarget.getBoundingClientRect();
                        setTooltip({
                          cell,
                          x: rect.left + rect.width / 2,
                          y: rect.top,
                        });
                      }
                    }}
                    onMouseLeave={() => setTooltip(null)}
                  >
                    <span className={cn("text-[8px] font-medium", colors.text)}>
                      {status === "complete"
                        ? "●"
                        : status === "missing"
                          ? "—"
                          : status === "estimated"
                            ? "≈"
                            : "◐"}
                    </span>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      <div className="px-4 py-2 border-t-2 border-memphis-black/10 flex items-center gap-4 flex-wrap">
        {(
          Object.entries(QUALITY_COLORS) as [
            DataQualityStatus,
            typeof QUALITY_COLORS.complete,
          ][]
        ).map(([status, colors]) => (
          <div key={status} className="flex items-center gap-1.5">
            <span
              className={cn(
                "w-3 h-3 rounded-sm border border-black/10",
                colors.bg,
              )}
            />
            <span className="text-[10px] text-memphis-black/60">
              {colors.label}
            </span>
          </div>
        ))}
      </div>

      {tooltip && (
        <div
          className={cn(
            "fixed z-50 bg-white border-2 border-memphis-black",
            "shadow-hard-sm px-3 py-2 text-[11px] pointer-events-none",
          )}
          style={{
            left: `${tooltip.x}px`,
            top: `${tooltip.y - 40}px`,
            transform: "translateX(-50%)",
          }}
        >
          <p className="font-bold text-memphis-black">
            {tooltip.cell.indicatorLabel} · {tooltip.cell.year}
          </p>
          <p
            className={cn(
              "font-medium",
              QUALITY_COLORS[tooltip.cell.status].text,
            )}
          >
            {QUALITY_COLORS[tooltip.cell.status].label}: {tooltip.cell.value}
          </p>
        </div>
      )}
    </div>
  );
}

import { useState } from "react";
