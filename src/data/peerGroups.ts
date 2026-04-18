// ─────────────────────────────────────────────────────────────────────────────
// PEER GROUPS  —  hardcoded groupings for v2.2 peer comparison.
// These stay in the frontend for labels + options; backend uses mirrored
// logic because server cannot import frontend TS directly.
// ─────────────────────────────────────────────────────────────────────────────

import type { PeerGroupType } from "../types";

export interface PeerGroupOption {
  value: PeerGroupType;
  label: string;
  hint: string;
}

export interface PeerMetricOption {
  value: string;
  label: string;
  unit: string;
}

export const PEER_GROUP_OPTIONS: PeerGroupOption[] = [
  { value: "region", label: "Region", hint: "Compare within broad world regions" },
  { value: "continent", label: "Continent", hint: "Compare within geographic continents" },
  { value: "income", label: "Income", hint: "Compare within income bands" },
  { value: "brics", label: "BRICS", hint: "Compare with BRICS economies" },
];

export const PEER_METRIC_OPTIONS: PeerMetricOption[] = [
  { value: "gdp",           label: "GDP",             unit: "USD" },
  { value: "gdp_growth",    label: "GDP Growth",      unit: "%" },
  { value: "gdp_per_capita", label: "GDP Per Capita", unit: "USD" },
  { value: "exports",       label: "Exports",         unit: "USD" },
  { value: "imports",       label: "Imports",         unit: "USD" },
  { value: "trade_openness", label: "Trade Openness", unit: "%" },
];

export const BRICS_COUNTRIES = ["BR", "RU", "IN", "CN", "ZA"] as const;
