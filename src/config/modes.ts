// Shared mode configuration used by the app shell navigation and labels.
import type { ComponentType } from "react";
import {
  BarChart3,
  BookOpen,
  Database,
  Download,
  LineChart,
  MessageSquare,
  Search,
} from "lucide-react";
import type { Mode } from "@/types";

interface ModeDefinition {
  mode: Mode;
  label: string;
  Icon: ComponentType<{ className?: string }>;
}

interface ModeMeta {
  label: string;
  desc: string;
  color: string;
  bg: string;
}

export const MODES: ModeDefinition[] = [
  { mode: "chat", label: "AI Chat", Icon: MessageSquare },
  { mode: "search", label: "Search", Icon: Search },
  { mode: "data", label: "Data", Icon: Database },
  { mode: "analytics", label: "Analytics", Icon: LineChart },
  { mode: "dashboard", label: "Country Data", Icon: BarChart3 },
  { mode: "methodology", label: "Methodology", Icon: BookOpen },
  { mode: "export", label: "Export", Icon: Download },
];

export const MOBILE_PRIMARY_MODES: Mode[] = [
  "chat",
  "search",
  "data",
  "analytics",
  "dashboard",
  "methodology",
];

export const MODE_META: Record<Mode, ModeMeta> = {
  chat: {
    label: "AI Chat",
    color: "#FF006E",
    bg: "#FF006E",
    desc:
      "Ask any economic question — Kagi FastGPT generates analysis from " +
      "your query",
  },
  search: {
    label: "Web Search",
    color: "#00D9FF",
    bg: "#00D9FF",
    desc: "Live web search · Kagi FastGPT · cited economic sources",
  },
  data: {
    label: "Data Upload",
    color: "#FB5607",
    bg: "#FB5607",
    desc:
      "Upload a CSV file · Claude analyses your data and creates charts " +
      "automatically",
  },
  analytics: {
    label: "Analytics",
    color: "#FFBE0B",
    bg: "#FFBE0B",
    desc:
      "Algorithms from scratch: OLS Regression · HHI Concentration · " +
      "K-Means Clustering · Z-Score Anomaly Detection",
  },
  dashboard: {
    label: "Country Data",
    color: "#8338EC",
    bg: "#8338EC",
    desc:
      "Select any country — real GDP & trade data from World Bank, cached " +
      "locally · sector breakdown AI-estimated",
  },
  methodology: {
    label: "Methodology",
    color: "#10B981",
    bg: "#10B981",
    desc:
      "Explore how each algorithm works — formulas, parameters, assumptions, " +
      "and references",
  },
  export: {
    label: "Export",
    color: "#00F5D4",
    bg: "#00F5D4",
    desc:
      "Download data as CSV / JSON · Generate standalone HTML reports with " +
      "embedded SVG charts · Print to PDF",
  },
};
