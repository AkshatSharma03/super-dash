// ─────────────────────────────────────────────────────────────────────────────
// EXPORT UTILITIES  —  client-side data export helpers.
// All functions are pure (no DOM side-effects) except the download/copy
// helpers which trigger browser actions.
// ─────────────────────────────────────────────────────────────────────────────
import type { CountryDataset, Message, AIResponse, ChartConfig, SearchResult } from "../types";

// ── Download primitives ───────────────────────────────────────────────────────

/** Trigger a browser file-download for any in-memory content. */
export function downloadBlob(
  filename: string,
  content: string,
  mimeType = "text/plain;charset=utf-8",
): void {
  const blob = new Blob([content], { type: mimeType });
  const url  = URL.createObjectURL(blob);
  try {
    const a = Object.assign(document.createElement("a"), { href: url, download: filename });
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  } finally {
    URL.revokeObjectURL(url);
  }
}

export const downloadCSV  = (filename: string, csv: string)  => downloadBlob(filename, csv,  "text/csv;charset=utf-8");
export const downloadJSON = (filename: string, data: unknown) => downloadBlob(filename, JSON.stringify(data, null, 2), "application/json");

export async function copyToClipboard(text: string): Promise<void> {
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Fall through to legacy copy path.
    }
  }

  // Legacy fallback
  const ta = Object.assign(document.createElement("textarea"), { value: text });
  ta.setAttribute("readonly", "true");
  ta.style.position = "fixed";
  ta.style.left = "-9999px";
  document.body.appendChild(ta);
  ta.select();
  const ok = document.execCommand("copy");
  document.body.removeChild(ta);
  if (!ok) throw new Error("Clipboard copy failed");
}

// ── CSV builders ──────────────────────────────────────────────────────────────

function escapeCell(v: string | number | null | undefined): string {
  if (v == null) return "";
  const s = String(v);
  return s.includes(",") || s.includes('"') || s.includes("\n")
    ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCSVString(
  headers: string[],
  rows: (string | number | null | undefined)[][],
): string {
  const head = headers.map(escapeCell).join(",");
  const body = rows.map(r => r.map(escapeCell).join(",")).join("\n");
  return `${head}\n${body}`;
}

/** GDP data → CSV */
export function gdpToCSV(dataset: CountryDataset): string {
  const headers = ["year", "gdp_bn_usd", "gdp_growth_pct", "gdp_per_capita_usd", "digital_pct"];
  const rows = dataset.gdpData.map(d => [
    d.year, d.gdp_bn, d.gdp_growth, d.gdp_per_capita, d.digital_pct ?? "",
  ]);
  return toCSVString(headers, rows);
}

/** Export data → CSV (year + total + each sector key) */
export function exportsToCSV(dataset: CountryDataset): string {
  const sectorKeys = dataset.exportSectors.map(s => s.key);
  const headers = ["year", "total_bn_usd", ...sectorKeys.map(k =>
    dataset.exportSectors.find(s => s.key === k)?.label ?? k)];
  const rows = dataset.exportData.map(d => [
    d.year, d.total, ...sectorKeys.map(k => d[k] ?? ""),
  ]);
  return toCSVString(headers, rows);
}

/** Import data → CSV (year + total + each partner key) */
export function importsToCSV(dataset: CountryDataset): string {
  const partnerKeys = dataset.importPartners.map(s => s.key);
  const headers = ["year", "total_bn_usd", ...partnerKeys.map(k =>
    dataset.importPartners.find(s => s.key === k)?.label ?? k)];
  const rows = dataset.importData.map(d => [
    d.year, d.total, ...partnerKeys.map(k => d[k] ?? ""),
  ]);
  return toCSVString(headers, rows);
}

/** Trade balance → CSV */
export function tradeBalanceToCSV(dataset: CountryDataset): string {
  const expMap = new Map(dataset.exportData.map(d => [d.year, d.total]));
  const impMap = new Map(dataset.importData.map(d => [d.year, d.total]));
  const headers = ["year", "exports_bn_usd", "imports_bn_usd", "balance_bn_usd"];
  const rows = dataset.gdpData.map(d => {
    const exp = expMap.get(d.year) ?? "";
    const imp = impMap.get(d.year) ?? "";
    const bal = typeof exp === "number" && typeof imp === "number"
      ? +(exp - imp).toFixed(1) : "";
    return [d.year, exp, imp, bal];
  });
  return toCSVString(headers, rows);
}

// ── Print helper ──────────────────────────────────────────────────────────────

/** Open the HTML report in a new window and trigger the print dialog. */
export function printHTML(html: string): boolean {
  const win = window.open("", "_blank");
  if (!win) return false;
  win.document.write(html);
  win.document.close();
  setTimeout(() => {
    try {
      win.focus();
      win.print();
    } catch {
      // Ignore print popup errors.
    }
  }, 500);
  return true;
}

// ── HTML report builder ───────────────────────────────────────────────────────

const KPI_BORDER: Record<string, string> = {
  "#00AAFF": "#3b82f6",
  "#10B981": "#10b981",
  "#8B5CF6": "#8b5cf6",
  "#F59E0B": "#f59e0b",
  "#EF4444": "#ef4444",
  "#06B6D4": "#06b6d4",
  "#F97316": "#f97316",
};
const KPI_BG: Record<string, string> = {
  "#00AAFF": "#eff6ff",
  "#10B981": "#f0fdf4",
  "#8B5CF6": "#f5f3ff",
  "#F59E0B": "#fefce8",
  "#EF4444": "#fef2f2",
  "#06B6D4": "#ecfeff",
  "#F97316": "#fff7ed",
};

/** Build a standalone HTML report for a CountryDataset.
 *  @param svgs  Map of named SVG strings extracted from live Recharts renders.
 *               Keys: "gdp" | "growth" | "trade" | "exports" | "imports"
 *  Each value is either a serialized SVG string or "" if unavailable.
 */
export function buildDashboardHTML(
  dataset: CountryDataset,
  svgs: Record<string, string> = {},
): string {
  const generated = new Date().toLocaleDateString("en-GB", {
    day: "numeric", month: "long", year: "numeric",
  });

  const expMap = new Map(dataset.exportData.map(d => [d.year, d.total]));
  const impMap = new Map(dataset.importData.map(d => [d.year, d.total]));

  // ── KPI grid ────────────────────────────────────────────────────────────────
  const kpiHTML = dataset.kpis.map(k => {
    const col = KPI_BORDER[k.color] ?? "#3b82f6";
    const bg  = KPI_BG[k.color]    ?? "#eff6ff";
    const trendUp = k.trend && (k.trend.startsWith("+") || k.trend.startsWith("↑"));
    return `
    <div style="background:${bg};border:1px solid ${col}33;border-radius:8px;padding:14px 16px;border-top:3px solid ${col}">
      <p style="margin:0 0 4px;font-size:9px;color:#6b7280;text-transform:uppercase;letter-spacing:0.6px;font-weight:600">${k.label}</p>
      <p style="margin:0 0 2px;font-size:20px;font-weight:800;color:#111827">${k.value}</p>
      <p style="margin:0;font-size:11px;color:#9ca3af">${k.sub}</p>
      ${k.trend ? `<p style="margin:3px 0 0;font-size:11px;font-weight:600;color:${trendUp ? "#16a34a" : "#dc2626"}">${k.trend}</p>` : ""}
    </div>`;
  }).join("");

  // ── GDP table ────────────────────────────────────────────────────────────────
  const gdpRows = dataset.gdpData.map(d => `
    <tr>
      <td>${d.year}</td>
      <td>$${d.gdp_bn}B</td>
      <td style="color:${(d.gdp_growth ?? 0) >= 0 ? "#16a34a" : "#dc2626"}">${d.gdp_growth != null ? `${d.gdp_growth > 0 ? "+" : ""}${d.gdp_growth}%` : "—"}</td>
      <td>${d.gdp_per_capita != null ? `$${d.gdp_per_capita.toLocaleString()}` : "—"}</td>
      ${d.digital_pct != null ? `<td>${d.digital_pct}%</td>` : "<td>—</td>"}
    </tr>`).join("");

  // ── Trade table ──────────────────────────────────────────────────────────────
  const tradeRows = dataset.gdpData.map(d => {
    const exp = expMap.get(d.year);
    const imp = impMap.get(d.year);
    const bal = exp != null && imp != null ? +(exp - imp).toFixed(1) : null;
    return `
    <tr>
      <td>${d.year}</td>
      <td>${exp != null ? `$${exp}B` : "—"}</td>
      <td>${imp != null ? `$${imp}B` : "—"}</td>
      <td style="color:${bal == null ? "#6b7280" : bal >= 0 ? "#16a34a" : "#dc2626"}">
        ${bal != null ? `${bal >= 0 ? "+" : ""}$${bal}B` : "—"}
      </td>
      <td>${d.gdp_bn > 0 && exp != null && imp != null
        ? `${(((exp + imp) / d.gdp_bn) * 100).toFixed(1)}%` : "—"}
      </td>
    </tr>`;
  }).join("");

  // ── Export composition table (latest year) ────────────────────────────────
  const latestExp = dataset.exportData[dataset.exportData.length - 1];
  const expCompRows = latestExp ? dataset.exportSectors.map(s => {
    const val = latestExp[s.key] as number ?? 0;
    const pct = latestExp.total > 0 ? ((val / latestExp.total) * 100).toFixed(1) : "—";
    return `<tr><td>${s.label}</td><td>$${val}B</td><td>${pct}%</td></tr>`;
  }).join("") : "<tr><td colspan='3'>No data</td></tr>";

  // ── Import breakdown table (latest year) ──────────────────────────────────
  const latestImp = dataset.importData[dataset.importData.length - 1];
  const impCompRows = latestImp ? dataset.importPartners.map(s => {
    const val = latestImp[s.key] as number ?? 0;
    const pct = latestImp.total > 0 ? ((val / latestImp.total) * 100).toFixed(1) : "—";
    return `<tr><td>${s.label}</td><td>$${val}B</td><td>${pct}%</td></tr>`;
  }).join("") : "<tr><td colspan='3'>No data</td></tr>";

  const sources = dataset._meta?.sources ?? ["World Bank Open Data"];
  const cachedAt = dataset._meta?.cachedAt
    ? new Date(dataset._meta.cachedAt).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })
    : "unknown";

  // ── SVG wrappers ──────────────────────────────────────────────────────────
  function chartSection(title: string, svgKey: string): string {
    const svg = svgs[svgKey];
    if (!svg) return "";
    return `
    <div style="margin:16px 0;padding:16px;background:#f9fafb;border-radius:8px;border:1px solid #e5e7eb">
      <p style="margin:0 0 10px;font-size:12px;font-weight:600;color:#374151">${title}</p>
      ${svg}
    </div>`;
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${dataset.name} — Economic Report</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;background:#fff;color:#1e293b;line-height:1.6;max-width:900px;margin:0 auto;padding:40px 32px}
h2{font-size:17px;font-weight:700;color:#1e293b;margin:36px 0 14px;padding-bottom:8px;border-bottom:2px solid #e2e8f0}
h3{font-size:13px;font-weight:600;color:#374151;margin:20px 0 8px}
table{width:100%;border-collapse:collapse;font-size:12px;margin:12px 0}
th{background:#f1f5f9;color:#475569;font-weight:600;padding:8px 10px;text-align:right;border-bottom:2px solid #e2e8f0;font-size:11px;text-transform:uppercase;letter-spacing:0.4px}
th:first-child{text-align:left}
td{padding:7px 10px;border-bottom:1px solid #f1f5f9;text-align:right;color:#374151}
td:first-child{text-align:left;font-weight:500;color:#111827}
tr:nth-child(even) td{background:#fafafa}
.kpi-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin:18px 0}
@media(max-width:680px){.kpi-grid{grid-template-columns:repeat(2,1fr)}}
.header{padding-bottom:24px;border-bottom:3px solid #3b82f6;margin-bottom:28px}
.header h1{font-size:26px;font-weight:800;color:#0f172a;letter-spacing:-0.4px}
.header .sub{font-size:13px;color:#64748b;margin-top:4px}
.header .meta{display:flex;gap:20px;margin-top:10px;font-size:11px;color:#94a3b8}
.two-col{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin:12px 0}
@media(max-width:640px){.two-col{grid-template-columns:1fr}}
.footer{margin-top:48px;padding-top:16px;border-top:1px solid #e2e8f0;font-size:10px;color:#9ca3af;display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px}
@media print{body{padding:20px}.no-print{display:none}h2{page-break-after:avoid}table,figure{page-break-inside:avoid}}
</style>
</head>
<body>

<div class="header">
  <h1>${dataset.flag} ${dataset.name} — Economic Report</h1>
  <p class="sub">${dataset.region}</p>
  <div class="meta">
    <span>📅 Generated: ${generated}</span>
    <span>🗄 Data cached: ${cachedAt}</span>
    <span>📊 Source: ${sources.join(" · ")}</span>
  </div>
</div>

<h2>Key Performance Indicators</h2>
<div class="kpi-grid">${kpiHTML}</div>

<h2>GDP Overview</h2>
${chartSection("GDP & Growth Trend", "gdp")}
${chartSection("GDP Growth Rate", "growth")}
<table>
  <thead><tr><th>Year</th><th>GDP ($B)</th><th>Growth %</th><th>GDP / Capita</th><th>Digital %</th></tr></thead>
  <tbody>${gdpRows}</tbody>
</table>

<h2>Trade Overview</h2>
${chartSection("Exports vs Imports vs Trade Balance", "trade")}
<table>
  <thead><tr><th>Year</th><th>Exports</th><th>Imports</th><th>Balance</th><th>Openness</th></tr></thead>
  <tbody>${tradeRows}</tbody>
</table>

<h2>Export Composition <span style="font-size:11px;color:#94a3b8;font-weight:400">(most recent year)</span></h2>
${chartSection("Export Sectors", "exports")}
<table>
  <thead><tr><th>Sector</th><th>Value</th><th>Share</th></tr></thead>
  <tbody>${expCompRows}</tbody>
</table>

<h2>Import Partners <span style="font-size:11px;color:#94a3b8;font-weight:400">(most recent year)</span></h2>
${chartSection("Import Sources", "imports")}
<table>
  <thead><tr><th>Partner / Region</th><th>Value</th><th>Share</th></tr></thead>
  <tbody>${impCompRows}</tbody>
</table>

<div class="footer">
  <span>Generated by <strong>EconChart</strong> · econChart.app</span>
  <span>${sources.join(" · ")}</span>
</div>

</body>
</html>`;
}

// ── Chat & Search report builders ─────────────────────────────────────────────

/** Convert a subset of Markdown to HTML for embedding in reports. */
function markdownToHTML(text: string): string {
  const lines = text.split("\n");
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    const inline = (s: string) => s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    if (/^#{2,3}\s/.test(line)) {
      out.push(`<h4 style="margin:16px 0 8px;font-size:14px;color:#111827">${inline(line.replace(/^#+\s/, ""))}</h4>`);
      i++; continue;
    }
    if (/^[-•*]\s/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[-•*]\s/.test(lines[i]))
        items.push(lines[i++].replace(/^[-•*]\s/, ""));
      out.push(`<ul style="margin:6px 0 10px;padding-left:20px">${items.map(it => `<li style="color:#374151;font-size:13px;line-height:1.7;margin-bottom:3px">${inline(it)}</li>`).join("")}</ul>`);
      continue;
    }
    if (/^\d+\.\s/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s/.test(lines[i]))
        items.push(lines[i++].replace(/^\d+\.\s/, ""));
      out.push(`<ol style="margin:6px 0 10px;padding-left:20px">${items.map(it => `<li style="color:#374151;font-size:13px;line-height:1.7;margin-bottom:3px">${inline(it)}</li>`).join("")}</ol>`);
      continue;
    }
    out.push(`<p style="margin:0 0 10px;font-size:13px;color:#374151;line-height:1.75">${inline(line)}</p>`);
    i++;
  }
  return out.join("\n");
}

/** Render a ChartConfig's data as an HTML table. */
function chartToTableHTML(chart: ChartConfig): string {
  if (!chart.data?.length) return `<p style="color:#94a3b8;font-size:12px;margin:0">No data available.</p>`;
  const keys = Object.keys(chart.data[0]);
  const headers = keys.map(k => `<th>${k}</th>`).join("");
  const rows = chart.data.map(row =>
    `<tr>${keys.map(k => `<td>${row[k] ?? ""}</td>`).join("")}</tr>`
  ).join("");
  return `<table><thead><tr>${headers}</tr></thead><tbody>${rows}</tbody></table>`;
}

const REPORT_BASE_CSS = `
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;background:#fff;color:#1e293b;line-height:1.6;max-width:860px;margin:0 auto;padding:40px 32px}
h2{font-size:17px;font-weight:700;color:#1e293b;margin:36px 0 14px;padding-bottom:8px;border-bottom:2px solid #e2e8f0}
h4{font-size:14px;font-weight:700;color:#111827;margin:16px 0 8px}
table{width:100%;border-collapse:collapse;font-size:12px;margin:10px 0}
th{background:#f1f5f9;color:#475569;font-weight:600;padding:7px 10px;text-align:left;border-bottom:2px solid #e2e8f0;font-size:11px;text-transform:uppercase;letter-spacing:0.4px}
td{padding:6px 10px;border-bottom:1px solid #f1f5f9;color:#374151}
tr:nth-child(even) td{background:#fafafa}
.footer{margin-top:48px;padding-top:16px;border-top:1px solid #e2e8f0;font-size:10px;color:#9ca3af;display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px}
@media print{body{padding:20px}h2{page-break-after:avoid}table,figure{page-break-inside:avoid}}`;

/**
 * Build a standalone HTML export report for a full chat conversation.
 * Includes all insights, chart data tables, and numbered source citations.
 */
export function buildChatReportHTML(messages: Message[], sessionTitle = "AI Chat Report"): string {
  const generated = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });

  // Collect all unique sources across the conversation
  const allSources: { title: string; url: string | null }[] = [];
  const seenUrls = new Set<string>();
  for (const msg of messages) {
    if (msg.role === "assistant") {
      for (const s of (msg.content as AIResponse).sources ?? []) {
        const key = s.url ?? s.title;
        if (!seenUrls.has(key)) { allSources.push(s); seenUrls.add(key); }
      }
    }
  }

  const convHTML = messages.map(msg => {
    if (msg.role === "user") {
      return `
      <div style="margin-bottom:24px">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
          <div style="width:24px;height:24px;border-radius:50%;background:#3b82f6;display:flex;align-items:center;justify-content:center;font-size:10px;color:#fff;font-weight:700;flex-shrink:0">Q</div>
          <span style="font-size:11px;color:#6b7280;text-transform:uppercase;font-weight:600;letter-spacing:0.5px">Question</span>
        </div>
        <div style="background:#eff6ff;border-radius:0 12px 12px 0;border-left:3px solid #3b82f6;padding:12px 16px;margin-left:32px">
          <p style="margin:0;font-size:14px;color:#1e293b;line-height:1.65">${String(msg.content)}</p>
        </div>
      </div>`;
    }

    const res = msg.content as AIResponse;
    const apiLabel: Record<string, string> = { worldbank: "World Bank", imf: "IMF", fred: "FRED" };
    const chartsHTML = (res.charts ?? []).map(chart => {
      const src = chart._source;
      const verifiedBadge = src
        ? `<a href="${src.url}" style="font-size:9px;font-weight:700;padding:2px 6px;border-radius:4px;background:#f0fdf4;color:#059669;border:1px solid #bbf7d0;text-decoration:none;margin-left:8px;text-transform:uppercase;letter-spacing:0.4px">✓ ${apiLabel[src.api] ?? src.api} · ${src.indicator}</a>`
        : "";
      return `
      <div style="margin:16px 0;padding:14px 16px;background:#f9fafb;border-radius:8px;border:1px solid #e5e7eb">
        <p style="margin:0 0 3px;font-size:13px;font-weight:700;color:#111827">${chart.title}${verifiedBadge}</p>
        ${chart.description ? `<p style="margin:0 0 10px;font-size:12px;color:#6b7280">${chart.description}</p>` : ""}
        ${chartToTableHTML(chart)}
      </div>`;
    }).join("");

    const inlineSources = (res.sources ?? []);
    const srcHTML = inlineSources.length ? `
      <div style="margin-top:12px;display:flex;flex-wrap:wrap;gap:6px;align-items:center">
        <span style="font-size:10px;color:#94a3b8;text-transform:uppercase;font-weight:600">Sources:</span>
        ${inlineSources.map(s => s.url
          ? `<a href="${s.url}" style="font-size:11px;color:#3b82f6;background:#eff6ff;border:1px solid #bfdbfe;border-radius:4px;padding:2px 8px;text-decoration:none">${s.title} ↗</a>`
          : `<span style="font-size:11px;color:#94a3b8;background:#f9fafb;border:1px solid #e5e7eb;border-radius:4px;padding:2px 8px">📚 ${s.title}</span>`
        ).join("")}
      </div>` : "";

    return `
    <div style="margin-bottom:28px">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
        <div style="width:24px;height:24px;border-radius:50%;background:linear-gradient(135deg,#8b5cf6,#6d28d9);display:flex;align-items:center;justify-content:center;font-size:10px;color:#fff;flex-shrink:0">✦</div>
        <span style="font-size:11px;color:#8b5cf6;text-transform:uppercase;font-weight:600;letter-spacing:0.5px">Analysis</span>
      </div>
      <div style="background:#faf5ff;border-radius:0 12px 12px 0;border-left:3px solid #8b5cf6;padding:16px;margin-left:32px">
        ${res.insight ? `<p style="margin:0 0 12px;font-size:14px;color:#1e293b;line-height:1.75">${res.insight}</p>` : ""}
        ${chartsHTML}
        ${srcHTML}
      </div>
    </div>`;
  }).join("");

  const citationsHTML = allSources.length ? `
  <h2>Sources &amp; Citations</h2>
  <div style="display:flex;flex-direction:column">
    ${allSources.map((s, i) => `
    <div style="display:flex;gap:10px;align-items:flex-start;padding:8px 0;border-bottom:1px solid #f1f5f9">
      <span style="font-size:11px;font-weight:700;color:#94a3b8;min-width:28px;flex-shrink:0">[${i + 1}]</span>
      ${s.url
        ? `<a href="${s.url}" style="font-size:13px;color:#3b82f6;text-decoration:none;line-height:1.5">${s.title} ↗</a>`
        : `<span style="font-size:13px;color:#64748b;line-height:1.5">📚 ${s.title} <em style="font-size:11px;color:#94a3b8">(training knowledge)</em></span>`
      }
    </div>`).join("")}
  </div>` : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${sessionTitle}</title>
<style>${REPORT_BASE_CSS}</style>
</head>
<body>

<div style="padding-bottom:24px;border-bottom:3px solid #8b5cf6;margin-bottom:28px">
  <h1 style="font-size:24px;font-weight:800;color:#0f172a;letter-spacing:-0.3px">💬 ${sessionTitle}</h1>
  <p style="font-size:12px;color:#64748b;margin-top:6px">📅 Generated: ${generated} · Powered by Claude · World Bank · IMF · OECD</p>
</div>

<h2>Conversation</h2>
${convHTML}

${citationsHTML}

<div class="footer">
  <span>Generated by <strong>Super Dash</strong></span>
  <span>${generated}</span>
</div>

</body>
</html>`;
}

/**
 * Build a standalone HTML export report for a web search result.
 * Includes the full research summary and numbered source citations.
 */
export function buildSearchReportHTML(query: string, result: SearchResult): string {
  const generated = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  const accentColor = result.webSearchUsed ? "#10b981" : "#f59e0b";
  const badgeBg    = result.webSearchUsed ? "#f0fdf4" : "#fefce8";
  const badgeColor = result.webSearchUsed ? "#059669" : "#d97706";
  const badgeBorder = result.webSearchUsed ? "#bbf7d0" : "#fde68a";
  const badgeLabel = result.webSearchUsed ? "🌐 Live Web Search" : "📚 Model Knowledge";

  const citationsHTML = result.sources.map((s, i) => `
    <div style="display:flex;gap:10px;align-items:flex-start;padding:8px 0;border-bottom:1px solid #f1f5f9">
      <span style="font-size:11px;font-weight:700;color:#94a3b8;min-width:28px;flex-shrink:0">[${i + 1}]</span>
      ${s.url
        ? `<a href="${s.url}" style="font-size:13px;color:${accentColor};text-decoration:none;line-height:1.5">${s.title} ↗</a>`
        : `<span style="font-size:13px;color:#64748b;line-height:1.5">📚 ${s.title} <em style="font-size:11px;color:#94a3b8">(training knowledge — may be outdated)</em></span>`
      }
    </div>`).join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Search: ${query}</title>
<style>${REPORT_BASE_CSS}</style>
</head>
<body>

<div style="padding-bottom:24px;border-bottom:3px solid ${accentColor};margin-bottom:28px">
  <h1 style="font-size:22px;font-weight:800;color:#0f172a;letter-spacing:-0.3px">🔍 ${query}</h1>
  <span style="display:inline-block;margin-top:8px;padding:3px 10px;border-radius:20px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;background:${badgeBg};color:${badgeColor};border:1px solid ${badgeBorder}">${badgeLabel}</span>
  <p style="font-size:11px;color:#94a3b8;margin-top:8px">📅 Generated: ${generated} · Powered by Claude · Anthropic Web Search</p>
</div>

<h2>Research Summary</h2>
<div style="background:#f9fafb;border:1px solid #e5e7eb;border-left:3px solid ${accentColor};border-radius:0 12px 12px 0;padding:22px;margin-bottom:24px">
  ${markdownToHTML(result.text)}
</div>

<h2>Sources &amp; Citations (${result.sources.length})</h2>
<div style="display:flex;flex-direction:column">
  ${citationsHTML || `<p style="color:#94a3b8;font-size:12px">No external sources cited.</p>`}
</div>

<div class="footer">
  <span>Generated by <strong>Super Dash</strong></span>
  <span>${generated}</span>
</div>

</body>
</html>`;
}
