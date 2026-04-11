// ─────────────────────────────────────────────────────────────────────────────
// UI PRIMITIVES  —  shared components used across all five modes.
// ─────────────────────────────────────────────────────────────────────────────
import { useRef } from "react";
import {
  LineChart, Line, BarChart, Bar, AreaChart, Area,
  PieChart, Pie, Cell, ComposedChart, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  RadarChart, Radar, PolarGrid, PolarAngleAxis,
} from "recharts";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { P, TT, GRID, AX, LEG } from "../../config/styles";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import type { BtnProps, KPIProps, CardProps, AnalyticsCardProps, ChartConfig, AISource } from "../../types";
import { downloadBlob, toCSVString } from "../../utils/export";

// ── Navigation / action button ────────────────────────────────────────────────

/** Tab / action button. Highlights in blue when `active`. */
export function Btn({ onClick, children, active, disabled = false }: BtnProps) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "px-3.5 py-1.5 rounded-md text-xs font-medium transition-all duration-150 border-none cursor-pointer",
        active
          ? "bg-primary text-white font-bold shadow-[0_2px_8px_#00AAFF44]"
          : "bg-transparent text-muted-foreground hover:text-foreground",
        "disabled:cursor-not-allowed disabled:opacity-50"
      )}
    >
      {children}
    </button>
  );
}

// ── KPI summary card ──────────────────────────────────────────────────────────

/** Dashboard headline stat: large coloured value, label, sub-label, optional trend. */
export function KPI({ label, value, sub, color = "#00AAFF", trend }: KPIProps) {
  const up = trend && (trend.startsWith("+") || trend.startsWith("↑"));
  return (
    <div
      className="bg-muted rounded-xl p-4 border border-border overflow-hidden relative"
      style={{ borderTopColor: color, borderTopWidth: 3 }}
    >
      <div className="absolute top-0 right-0 w-16 h-16 rounded-[0_0_0_60px] pointer-events-none" style={{ background: color + "08" }} />
      <p className="text-[10px] uppercase tracking-[0.8px] font-semibold text-muted-foreground mb-1.5">{label}</p>
      <p className="text-[22px] font-extrabold mb-0.5 tracking-[-0.5px]" style={{ color }}>{value}</p>
      <p className="text-[11px] text-muted-foreground mb-0.5">{sub}</p>
      {trend && <p className={cn("text-[11px] font-semibold", up ? "text-emerald-400" : "text-destructive")}>{trend}</p>}
    </div>
  );
}

// ── Section cards ─────────────────────────────────────────────────────────────

/** Simple titled container used in DashboardMode. */
export function Card({ title, children }: CardProps) {
  return (
    <div className="bg-muted rounded-xl p-4 border border-border mb-4">
      <h3 className="text-[11px] text-muted-foreground font-bold uppercase tracking-[0.6px] mb-3.5">{title}</h3>
      {children}
    </div>
  );
}

/** Extended card with badge pill and subtitle — used in AnalyticsMode panels. */
export function AnalyticsCard({ title, subtitle, badge, badgeColor = "#00AAFF", children }: AnalyticsCardProps) {
  return (
    <div
      className="bg-muted rounded-xl p-5 border border-border"
      style={{ borderTopColor: `${badgeColor}44`, borderTopWidth: 2 }}
    >
      <div className="mb-3.5">
        <div className="flex items-center gap-2 mb-1.5">
          {badge && (
            <span
              className="text-[9px] font-bold px-2 py-0.5 rounded uppercase tracking-[0.5px]"
              style={{ background: badgeColor + "22", color: badgeColor, border: `1px solid ${badgeColor}44` }}
            >
              {badge}
            </span>
          )}
        </div>
        <h3 className="text-[13px] text-foreground font-bold tracking-[-0.2px] mb-1">{title}</h3>
        {subtitle && <p className="text-[11px] text-muted-foreground leading-relaxed">{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}

/** Single stat display used inside AnalyticsMode panel headers. */
export function Stat({ label, value, color = "#e2e8f0" }: { label: string; value: string; color?: string }) {
  return (
    <div className="text-center">
      <p className="text-[10px] text-muted-foreground uppercase tracking-[0.8px] mb-0.5">{label}</p>
      <p className="text-base font-extrabold" style={{ color }}>{value}</p>
    </div>
  );
}

// ── Markdown renderer ─────────────────────────────────────────────────────────

/**
 * Renders markdown text using react-markdown with dark-theme styling.
 * Used by SearchMode to display Claude's research summaries.
 */
export function MarkdownText({ text }: { text?: string }) {
  if (!text) return <span className="text-muted-foreground">No content.</span>;
  return (
    <Markdown
      remarkPlugins={[remarkGfm]}
      components={{
        h2: ({ children }) => <h4 className="text-sm font-bold text-foreground mt-4 mb-2">{children}</h4>,
        h3: ({ children }) => <h4 className="text-sm font-bold text-foreground mt-3.5 mb-1.5">{children}</h4>,
        p: ({ children }) => <p className="text-sm text-slate-300 leading-[1.75] mb-2.5">{children}</p>,
        ul: ({ children }) => <ul className="list-disc pl-5 mb-2.5">{children}</ul>,
        ol: ({ children }) => <ol className="list-decimal pl-5 mb-2.5">{children}</ol>,
        li: ({ children }) => <li className="text-sm text-slate-300 leading-[1.7] mb-0.5">{children}</li>,
        strong: ({ children }) => <strong className="text-foreground font-semibold">{children}</strong>,
      }}
    >
      {text}
    </Markdown>
  );
}

// ── Chart card wrapper ────────────────────────────────────────────────────────

/** Chart title + optional description + DynChart, inside a dark card.
 *  Includes SVG and CSV download buttons in the top-right corner. */
export function ChartCard({ chart }: { chart: ChartConfig }) {
  const containerRef = useRef<HTMLDivElement>(null);

  const handleSVG = () => {
    const svg = containerRef.current?.querySelector("svg");
    if (!svg) return;
    const clone = svg.cloneNode(true) as SVGElement;
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    const serialized = new XMLSerializer().serializeToString(clone);
    downloadBlob(`${chart.title.replace(/[^a-z0-9]/gi, "_")}.svg`, serialized, "image/svg+xml");
  };

  const handleCSV = () => {
    if (!chart.data?.length) return;
    const headers = Object.keys(chart.data[0]);
    const rows = chart.data.map(row => headers.map(k => row[k] as string | number | null));
    downloadBlob(
      `${chart.title.replace(/[^a-z0-9]/gi, "_")}.csv`,
      toCSVString(headers, rows),
      "text/csv;charset=utf-8",
    );
  };

  const src = chart._source;
  const apiLabel: Record<string, string> = { worldbank: "World Bank", imf: "IMF", fred: "FRED" };

  return (
    <div className="bg-muted border border-border rounded-xl p-4 mb-3">
      <div className="flex items-start gap-2 mb-1">
        <div className="flex-1">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <h3 className="text-[13px] text-foreground font-bold">{chart.title}</h3>
            {src && (
              <a
                href={src.url}
                target="_blank"
                rel="noopener noreferrer"
                title={`Verified data · ${src.indicatorName} · Retrieved ${new Date(src.retrievedAt).toLocaleDateString()}`}
                className="inline-flex items-center gap-1 text-[9px] font-bold px-1.5 py-0.5 rounded text-emerald-400 border border-emerald-400/30 bg-emerald-500/10 no-underline uppercase tracking-[0.5px] shrink-0 hover:bg-emerald-500/20 transition-colors"
              >
                ✓ {apiLabel[src.api] ?? src.api} · {src.indicator}
              </a>
            )}
          </div>
          {chart.description && <p className="text-xs text-muted-foreground mb-2">{chart.description}</p>}
        </div>
        <div className="flex gap-1 shrink-0">
          <Button variant="outline" size="sm" onClick={handleSVG} title="Download chart as SVG"
            className="px-2 text-[10px] hover:text-primary hover:border-primary/50">
            ↓ SVG
          </Button>
          <Button variant="outline" size="sm" onClick={handleCSV} title="Download chart data as CSV"
            className="px-2 text-[10px] hover:text-emerald-400 hover:border-emerald-400/50">
            ↓ CSV
          </Button>
        </div>
      </div>
      <div ref={containerRef}>
        <DynChart chart={chart} />
      </div>
    </div>
  );
}

// ── Source list ───────────────────────────────────────────────────────────────

/** Inline source badge links — used by ChatMode and AnalyticsMode. */
export function SourceList({ sources, className }: { sources: AISource[]; className?: string }) {
  if (!sources.length) return null;
  return (
    <div className={`flex gap-1.5 flex-wrap items-center ${className ?? ""}`}>
      <span className="text-[10px] text-muted-foreground font-semibold uppercase tracking-[0.5px]">Sources:</span>
      {sources.map((s, i) =>
        s.url ? (
          <a
            key={i}
            href={s.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[11px] text-primary bg-card border border-border/70 rounded px-2 py-0.5 no-underline hover:border-primary/40 transition-colors"
          >
            {s.title} ↗
          </a>
        ) : (
          <span key={i} className="text-[11px] text-muted-foreground bg-card border border-border rounded px-2 py-0.5">
            {s.title}
          </span>
        )
      )}
    </div>
  );
}

// ── Dynamic chart renderer ────────────────────────────────────────────────────

/**
 * Renders the correct Recharts chart type from a ChartConfig object.
 * Chart type is dispatched from config.type — supports: line, bar, area, pie,
 * composed (mixed bar+line), radar. Falls back to line for unknown types.
 * Auto-assigns colours from P palette when series.color is absent.
 */
export function DynChart({ chart }: { chart: ChartConfig }) {
  const { type, data, xKey, series = [] } = chart;
  if (!data?.length) return <p className="text-muted-foreground text-sm">No data.</p>;
  const h = 270;
  const M = { top: 5, right: 20, left: 0, bottom: 5 };

  if (type === "pie") return (
    <ResponsiveContainer width="100%" height={h}>
      <PieChart>
        <Pie data={data} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={95}
          label={({ name, value }: { name: string; value: number }) => `${name}: ${value}`} labelLine>
          {data.map((_e, i) => <Cell key={i} fill={P[i % P.length]} />)}
        </Pie>
        <Tooltip {...TT} /><Legend {...LEG} />
      </PieChart>
    </ResponsiveContainer>
  );

  if (type === "radar") return (
    <ResponsiveContainer width="100%" height={h}>
      <RadarChart data={data} cx="50%" cy="50%" outerRadius={90}>
        <PolarGrid stroke="#2d3348" />
        <PolarAngleAxis dataKey={xKey ?? "label"} tick={AX} />
        <Tooltip {...TT} /><Legend {...LEG} />
        {series.map((s, i) => (
          <Radar key={s.key} name={s.name} dataKey={s.key}
            stroke={s.color ?? P[i]} fill={s.color ?? P[i]} fillOpacity={0.25} />
        ))}
      </RadarChart>
    </ResponsiveContainer>
  );

  if (type === "composed") return (
    <ResponsiveContainer width="100%" height={h}>
      <ComposedChart data={data} margin={M}>
        <CartesianGrid {...GRID} />
        <XAxis dataKey={xKey} tick={AX} />
        <YAxis yAxisId="left" tick={AX} />
        <YAxis yAxisId="right" orientation="right" tick={AX} />
        <Tooltip {...TT} /><Legend {...LEG} />
        {series.map((s, i) => s.chartType === "bar"
          ? <Bar key={s.key} yAxisId="left" dataKey={s.key} name={s.name} fill={s.color ?? P[i]} opacity={0.8} radius={[3, 3, 0, 0]} />
          : <Line key={s.key} yAxisId={s.rightAxis ? "right" : "left"} type="monotone" dataKey={s.key} name={s.name} stroke={s.color ?? P[i]} strokeWidth={2.5} dot={{ r: 3 }} />
        )}
      </ComposedChart>
    </ResponsiveContainer>
  );

  if (type === "area") return (
    <ResponsiveContainer width="100%" height={h}>
      <AreaChart data={data} margin={M}>
        <CartesianGrid {...GRID} />
        <XAxis dataKey={xKey} tick={AX} /><YAxis tick={AX} />
        <Tooltip {...TT} /><Legend {...LEG} />
        {series.map((s, i) => (
          <Area key={s.key} type="monotone" dataKey={s.key} name={s.name}
            stroke={s.color ?? P[i]} fill={(s.color ?? P[i]) + "33"} strokeWidth={2}
            stackId={s.stacked ? "a" : undefined} />
        ))}
      </AreaChart>
    </ResponsiveContainer>
  );

  if (type === "bar") return (
    <ResponsiveContainer width="100%" height={h}>
      <BarChart data={data} margin={M}>
        <CartesianGrid {...GRID} />
        <XAxis dataKey={xKey} tick={AX} /><YAxis tick={AX} />
        <Tooltip {...TT} /><Legend {...LEG} />
        {series.map((s, i) => (
          <Bar key={s.key} dataKey={s.key} name={s.name} fill={s.color ?? P[i]}
            stackId={s.stacked ? "a" : undefined} radius={!s.stacked ? [3, 3, 0, 0] : undefined} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );

  // Default: line chart
  return (
    <ResponsiveContainer width="100%" height={h}>
      <LineChart data={data} margin={M}>
        <CartesianGrid {...GRID} />
        <XAxis dataKey={xKey} tick={AX} /><YAxis tick={AX} />
        <Tooltip {...TT} /><Legend {...LEG} />
        {series.map((s, i) => (
          <Line key={s.key} type="monotone" dataKey={s.key} name={s.name}
            stroke={s.color ?? P[i]} strokeWidth={2.5} dot={{ r: 3 }} connectNulls />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}
