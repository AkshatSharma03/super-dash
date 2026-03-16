// ─────────────────────────────────────────────────────────────────────────────
// UI PRIMITIVES  —  shared components used across all five modes.
// Keeping these here avoids re-declaring identical elements in each mode file.
// ─────────────────────────────────────────────────────────────────────────────
import { ReactNode } from "react";
import {
  LineChart, Line, BarChart, Bar, AreaChart, Area,
  PieChart, Pie, Cell, ComposedChart, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  RadarChart, Radar, PolarGrid, PolarAngleAxis,
} from "recharts";
import { P, TT, GRID, AX, LEG } from "../../config/styles";
import type { BtnProps, KPIProps, CardProps, AnalyticsCardProps, ChartConfig } from "../../types";

// ── Navigation / action button ────────────────────────────────────────────────

/** Tab / action button. Highlights in blue when `active`. */
export function Btn({ onClick, children, active, style = {}, disabled = false }: BtnProps) {
  return (
    <button onClick={onClick} disabled={disabled} style={{
      background: active ? "#00AAFF" : "transparent",
      color: active ? "#fff" : "#64748b",
      border: "none",
      borderRadius: 7, padding: "6px 14px", fontSize: 12, fontWeight: active ? 700 : 500,
      cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.5 : 1,
      transition: "all .15s",
      boxShadow: active ? "0 2px 8px #00AAFF44" : "none",
      ...style,
    }}>{children}</button>
  );
}

// ── KPI summary card ──────────────────────────────────────────────────────────

/** Dashboard headline stat: large coloured value, label, sub-label, optional trend. */
export function KPI({ label, value, sub, color = "#00AAFF", trend }: KPIProps) {
  const up = trend && (trend.startsWith("+") || trend.startsWith("↑"));
  return (
    <div style={{ background: "#1e2130", borderRadius: 12, padding: "14px 16px", border: "1px solid #2d3348", borderTop: `3px solid ${color}`, overflow: "hidden", position: "relative" }}>
      <div style={{ position: "absolute", top: 0, right: 0, width: 60, height: 60, borderRadius: "0 0 0 60px", background: color + "08", pointerEvents: "none" }} />
      <p style={{ margin: "0 0 5px", fontSize: 10, color: "#475569", textTransform: "uppercase", letterSpacing: "0.8px", fontWeight: 600 }}>{label}</p>
      <p style={{ margin: "0 0 2px", fontSize: 22, fontWeight: 800, color, letterSpacing: "-0.5px" }}>{value}</p>
      <p style={{ margin: "0 0 2px", fontSize: 11, color: "#64748b" }}>{sub}</p>
      {trend && <p style={{ margin: 0, fontSize: 11, fontWeight: 600, color: up ? "#10B981" : "#EF4444" }}>{trend}</p>}
    </div>
  );
}

// ── Section cards ─────────────────────────────────────────────────────────────

/** Simple titled container used in DashboardMode. */
export function Card({ title, children }: CardProps) {
  return (
    <div style={{ background: "#1e2130", borderRadius: 12, padding: 18, border: "1px solid #2d3348", marginBottom: 18 }}>
      <h3 style={{ margin: "0 0 14px", fontSize: 12, color: "#64748b", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.6px" }}>{title}</h3>
      {children}
    </div>
  );
}

/** Extended card with badge pill and subtitle — used in AnalyticsMode panels. */
export function AnalyticsCard({ title, subtitle, badge, badgeColor = "#00AAFF", children }: AnalyticsCardProps) {
  return (
    <div style={{ background: "#1e2130", borderRadius: 12, padding: 20, border: "1px solid #2d3348", borderTop: `2px solid ${badgeColor}44` }}>
      <div style={{ marginBottom: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
          {badge && (
            <span style={{ fontSize: 9, fontWeight: 700, padding: "2px 8px", borderRadius: 4, background: badgeColor + "22", color: badgeColor, border: `1px solid ${badgeColor}44`, textTransform: "uppercase", letterSpacing: "0.5px" }}>
              {badge}
            </span>
          )}
        </div>
        <h3 style={{ margin: "0 0 4px", fontSize: 13, color: "#e2e8f0", fontWeight: 700, letterSpacing: "-0.2px" }}>{title}</h3>
        {subtitle && <p style={{ margin: 0, fontSize: 11, color: "#475569", lineHeight: 1.5 }}>{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}

/** Single stat display used inside AnalyticsMode panel headers. */
export function Stat({ label, value, color = "#e2e8f0" }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ textAlign: "center" }}>
      <p style={{ margin: "0 0 2px", fontSize: 10, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.8 }}>{label}</p>
      <p style={{ margin: 0, fontSize: 16, fontWeight: 800, color }}>{value}</p>
    </div>
  );
}

// ── Markdown renderer ─────────────────────────────────────────────────────────

/** Renders **bold** spans inline within a line of text. */
function RenderInline({ text }: { text: string }) {
  return (
    <>
      {text.split(/(\*\*[^*]+\*\*)/).map((p, i) =>
        p.startsWith("**") && p.endsWith("**")
          ? <strong key={i} style={{ color: "#e2e8f0" }}>{p.slice(2, -2)}</strong>
          : <span key={i}>{p}</span>
      )}
    </>
  );
}

/**
 * Lightweight markdown renderer supporting:
 *   ##/### headers, **bold**, bullet lists (- • *), numbered lists (1.)
 * Used by SearchMode to display Claude's research summaries.
 */
export function MarkdownText({ text }: { text?: string }) {
  if (!text) return <span style={{ color: "#64748b" }}>No content.</span>;
  const lines = text.split("\n");
  const out: ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }

    // ## / ### headings
    if (/^#{2,3}\s/.test(line)) {
      out.push(<h4 key={i} style={{ margin: "16px 0 8px", color: "#e2e8f0", fontSize: 14, fontWeight: 700 }}>
        <RenderInline text={line.replace(/^#+\s/, "")} />
      </h4>);
      i++; continue;
    }

    // **Bold-only line** treated as a section heading
    if (/^\*\*[^*]+\*\*:?$/.test(line.trim())) {
      out.push(<h4 key={i} style={{ margin: "14px 0 6px", color: "#e2e8f0", fontSize: 13, fontWeight: 700 }}>
        {line.replace(/\*\*/g, "")}
      </h4>);
      i++; continue;
    }

    // Bullet list — collect consecutive bullet lines into one <ul>
    if (/^[-•*]\s/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[-•*]\s/.test(lines[i]))
        items.push(lines[i++].replace(/^[-•*]\s/, ""));
      out.push(<ul key={`ul${i}`} style={{ margin: "6px 0 10px", paddingLeft: 20 }}>
        {items.map((item, ii) => (
          <li key={ii} style={{ color: "#cbd5e1", fontSize: 14, lineHeight: 1.7, marginBottom: 3 }}>
            <RenderInline text={item} />
          </li>
        ))}
      </ul>);
      continue;
    }

    // Numbered list — collect consecutive numbered lines into one <ol>
    if (/^\d+\.\s/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s/.test(lines[i]))
        items.push(lines[i++].replace(/^\d+\.\s/, ""));
      out.push(<ol key={`ol${i}`} style={{ margin: "6px 0 10px", paddingLeft: 20 }}>
        {items.map((item, ii) => (
          <li key={ii} style={{ color: "#cbd5e1", fontSize: 14, lineHeight: 1.7, marginBottom: 3 }}>
            <RenderInline text={item} />
          </li>
        ))}
      </ol>);
      continue;
    }

    // Default: paragraph
    out.push(<p key={i} style={{ margin: "0 0 10px", fontSize: 14, color: "#cbd5e1", lineHeight: 1.75 }}>
      <RenderInline text={line} />
    </p>);
    i++;
  }
  return <div>{out}</div>;
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
  if (!data?.length) return <p style={{ color: "#64748b", fontSize: 13 }}>No data.</p>;
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
