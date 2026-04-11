// ─────────────────────────────────────────────────────────────────────────────
// MEMPHIS CHART STYLE CONSTANTS — Bold, high-contrast colors for data viz.
// Recharts styling with Memphis Design System palette.
// ─────────────────────────────────────────────────────────────────────────────

/** Memphis Palette — Bold primary colors for charts */
export const P = [
  "#FF006E", // Hot pink
  "#00D9FF", // Cyan
  "#FB5607", // Orange
  "#FFBE0B", // Yellow
  "#00F5D4", // Lime
  "#8338EC", // Purple
  "#1A1A2E", // Black
  "#FF6B9D", // Light pink
] as const;

/** Fixed colors for recurring import-partner series (China, Russia, EU …). */
export const C = {
  cn: "#FF006E", // China = pink
  ru: "#00D9FF", // Russia = cyan
  eu: "#FB5607", // EU = orange
  us: "#8338EC", // US = purple
  tr: "#FFBE0B", // Turkey = yellow
  uk: "#00F5D4", // UK = lime
  other: "#1A1A2E",
} as const;

/** Tooltip props — High contrast on white/light backgrounds */
export const TT = {
  contentStyle: { 
    background: "#FFFFFF", 
    border: "3px solid #1A1A2E", 
    borderRadius: 0, 
    fontSize: 12, 
    color: "#1A1A2E",
    fontWeight: 600,
    boxShadow: "4px 4px 0 #1A1A2E",
  },
  labelStyle:   { color: "#1A1A2E", fontWeight: 800, marginBottom: 4 },
  itemStyle:    { color: "#1A1A2E", fontWeight: 600 },
  cursor:       { fill: "rgba(255,0,110,0.08)" }, // pink tint
} as const;

/** Bold grid lines — thicker, more visible */
export const GRID = { strokeDasharray: "6 6", stroke: "#1A1A2E", strokeWidth: 1.5 } as const;

/** Bold axis tick style */
export const AX = { fill: "#1A1A2E", fontSize: 12, fontWeight: 700 } as const;

/** Legend wrapper — bold text */
export const LEG = { wrapperStyle: { fontSize: 12, color: "#1A1A2E", fontWeight: 700 } } as const;
