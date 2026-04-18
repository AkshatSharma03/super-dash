// Shared constants for Export mode UI and algorithm export options.

export const LIGHT_GRID_STYLE = {
  strokeDasharray: "3 3",
  stroke: "#e2e8f0",
} as const;

export const LIGHT_PALETTE = [
  "#3b82f6",
  "#f59e0b",
  "#10b981",
  "#ef4444",
  "#8b5cf6",
  "#f97316",
  "#06b6d4",
] as const;

export interface ExportAlgoDefinition {
  key: string;
  name: string;
  icon: string;
}

export const ALGO_DEFS: ExportAlgoDefinition[] = [
  { key: "regression", name: "OLS Regression", icon: "OLS" },
  { key: "cagr", name: "CAGR Analysis", icon: "CAGR" },
  { key: "hp_filter", name: "HP Filter", icon: "HP" },
  { key: "correlation", name: "Correlation Matrix", icon: "CORR" },
  { key: "hhi", name: "HHI Concentration", icon: "HHI" },
  { key: "anomaly", name: "Anomaly Detection", icon: "ANOM" },
  { key: "kmeans", name: "K-Means Clustering", icon: "KM" },
  { key: "openness", name: "Trade Openness", icon: "OPEN" },
];

export const FILE_FORMATS = [
  {
    fmt: "CSV",
    desc:
      "Comma-separated values — opens in Excel, Google Sheets, pandas, " +
      "R, etc.",
    color: "#00F5D4",
    bg: "#00F5D4",
  },
  {
    fmt: "JSON",
    desc:
      "Structured object — all fields included, suitable for API " +
      "ingestion or archiving.",
    color: "#FFBE0B",
    bg: "#FFBE0B",
  },
  {
    fmt: "HTML Report",
    desc:
      "Standalone file with embedded SVG charts and tables — shareable, " +
      "offline-ready, printable as PDF.",
    color: "#FF006E",
    bg: "#FF006E",
  },
] as const;

