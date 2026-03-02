// ─────────────────────────────────────────────────────────────────────────────
// CHART STYLE CONSTANTS  —  single source of truth for all Recharts styling.
// Both dashboard charts (App-level) and algorithm charts (AnalyticsMode) import
// from here so colours and spacing are always in sync.
// ─────────────────────────────────────────────────────────────────────────────

/** General-purpose palette — cycles via `P[i % P.length]` for auto-coloring. */
export const P = [
  "#00AAFF", "#F59E0B", "#10B981", "#EF4444",
  "#8B5CF6", "#F97316", "#06B6D4", "#94a3b8",
] as const;

/** Fixed colors for recurring import-partner series (China, Russia, EU …). */
export const C = {
  cn: "#EF4444", ru: "#F59E0B", eu: "#10B981",
  us: "#8B5CF6", tr: "#F97316", uk: "#06B6D4", other: "#64748b",
} as const;

/** Tooltip props spread onto every <Tooltip>.
 *  itemStyle overrides the per-series color so Cell-based bar charts don't
 *  show black text on the dark background. */
export const TT = {
  contentStyle: { background: "#0f1117", border: "1px solid #2d3348", borderRadius: 8, fontSize: 12, color: "#e2e8f0" },
  labelStyle:   { color: "#94a3b8", fontWeight: 600, marginBottom: 2 },
  itemStyle:    { color: "#e2e8f0" },
  cursor:       { fill: "rgba(255,255,255,0.04)" }, // replaces default #ccc cursor rect
} as const;

/** Subtle dashed grid lines that don't overwhelm chart data. */
export const GRID = { strokeDasharray: "3 3", stroke: "#2d3348" } as const;

/** Muted axis tick style for all XAxis / YAxis tick props. */
export const AX = { fill: "#64748b", fontSize: 11 } as const;

/** Legend wrapper style — muted text so data series stand out. */
export const LEG = { wrapperStyle: { fontSize: 12, color: "#94a3b8" } } as const;
