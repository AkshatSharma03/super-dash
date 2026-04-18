// Algorithm picker catalog for Analytics mode.

export interface AlgoDef {
  id: string;
  name: string;
  desc: string;
  color: string;
}

export const ALGOS: AlgoDef[] = [
  {
    id: "regression",
    name: "OLS Regression",
    desc: "GDP trend forecast with 95% confidence band",
    color: "#FF006E",
  },
  {
    id: "hhi",
    name: "HHI Concentration",
    desc: "Trade concentration index over time",
    color: "#8338EC",
  },
  {
    id: "kmeans",
    name: "K-Means Clustering",
    desc: "Unsupervised economic era detection (k=3)",
    color: "#00F5D4",
  },
  {
    id: "anomaly",
    name: "Z-Score Anomaly",
    desc: "Statistical outliers across 6 economic metrics",
    color: "#FB5607",
  },
  {
    id: "hp",
    name: "HP Filter",
    desc: "Hodrick-Prescott business cycle decomposition",
    color: "#FFBE0B",
  },
  {
    id: "cagr",
    name: "CAGR Analysis",
    desc: "Compound annual growth rates by period",
    color: "#00D9FF",
  },
  {
    id: "correlation",
    name: "Correlation Matrix",
    desc: "Pearson r between GDP, trade, and growth",
    color: "#FF006E",
  },
  {
    id: "openness",
    name: "Trade Openness",
    desc: "(Exports + Imports) / GDP × 100 over time",
    color: "#8338EC",
  },
];

export const DEFAULT_ALGOS = new Set([
  "regression",
  "anomaly",
  "cagr",
  "hp",
]);

