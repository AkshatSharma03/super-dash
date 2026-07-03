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
  { mode: "dashboard", label: "Briefing", Icon: BarChart3 },
  { mode: "chat", label: "Ask AI", Icon: MessageSquare },
  { mode: "search", label: "Research", Icon: Search },
  { mode: "data", label: "Upload", Icon: Database },
  { mode: "analytics", label: "Advanced", Icon: LineChart },
  { mode: "export", label: "Reports", Icon: Download },
  { mode: "methodology", label: "Methods", Icon: BookOpen },
];

export const MOBILE_PRIMARY_MODES: Mode[] = [
  "dashboard",
  "chat",
  "search",
  "data",
  "analytics",
  "export",
];

export const MODE_META: Record<Mode, ModeMeta> = {
  chat: {
    label: "Ask AI",
    color: "#FF006E",
    bg: "#FF006E",
    desc:
      "Ask follow-up questions after you review the source-backed briefing."
  },
  search: {
    label: "Research",
    color: "#00D9FF",
    bg: "#00D9FF",
    desc: "Current web research with citations — no hidden sources or forced upgrades.",
  },
  data: {
    label: "Upload Data",
    color: "#FB5607",
    bg: "#FB5607",
    desc:
      "Bring your own CSV for transparent AI-assisted charts and summaries.",
  },
  analytics: {
    label: "Advanced Analysis",
    color: "#FFBE0B",
    bg: "#FFBE0B",
    desc:
      "Run regression, clustering, concentration, and anomaly checks when you need depth.",
  },
  dashboard: {
    label: "Country Briefing",
    color: "#8338EC",
    bg: "#8338EC",
    desc:
      "Start here: choose a country, review source-backed signals, then export a briefing.",
  },
  methodology: {
    label: "Methods",
    color: "#10B981",
    bg: "#10B981",
    desc:
      "Explore how each algorithm works — formulas, parameters, assumptions, " +
      "and references",
  },
  export: {
    label: "Reports",
    color: "#00F5D4",
    bg: "#00F5D4",
    desc:
      "Create portable reports with data tables, charts, sources, and methodology notes.",
  },
};
