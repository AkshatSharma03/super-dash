// ─────────────────────────────────────────────────────────────────────────────
// SHARED TYPES  —  single source of truth for all interfaces used across modes.
// Import from here rather than re-declaring locally in component files.
// ─────────────────────────────────────────────────────────────────────────────
import type { ReactNode, CSSProperties } from "react";

// ── Chart types ───────────────────────────────────────────────────────────────

/** A single data series rendered inside a DynChart. */
export interface ChartSeries {
  key: string;
  name: string;
  color?: string;
  chartType?: "bar" | "line"; // used by "composed" charts to mix bars and lines
  stacked?: boolean;          // stackId="a" when true
  rightAxis?: boolean;        // binds to the secondary Y-axis in composed charts
}

/** Full configuration object returned by Claude and consumed by DynChart. */
export interface ChartConfig {
  id: string;
  title: string;
  type: "line" | "bar" | "area" | "pie" | "composed" | "radar";
  description?: string;
  data: Record<string, unknown>[];
  xKey?: string;
  series?: ChartSeries[];
}

// ── API response types ────────────────────────────────────────────────────────

/** A source citation returned by /api/chat and /api/analyze-csv. */
export interface AISource { title: string; url: string | null; }

/** Structured response from /api/chat and /api/analyze-csv. */
export interface AIResponse {
  insight?: string;
  charts?: ChartConfig[];
  sources?: AISource[];
  followUps?: string[];
  error?: string;
}

// Chat message union — user sends plain text; assistant responds with AIResponse.
export interface UserMessage      { role: "user";      content: string; }
export interface AssistantMessage { role: "assistant"; content: AIResponse; }
export type Message = UserMessage | AssistantMessage;

/** A single source returned by /api/search. url is null for model-knowledge results. */
export interface SearchSource { title: string; url: string | null; }

/** Full response from /api/search. */
export interface SearchResult {
  text: string;
  sources: SearchSource[];
  webSearchUsed: boolean; // false when Claude fell back to training knowledge
}

/** CSV parsed client-side before being sent to /api/analyze-csv. */
export interface ParsedCSV {
  headers: string[];
  rows: Record<string, string>[];
}

// ── Auth + session types ───────────────────────────────────────────────────────

/** Authenticated user returned from /api/auth/login and /api/auth/register. */
export interface User { id: string; email: string; name: string; }

/** Summary of a saved chat session (no messages — for sidebar list). */
export interface ChatSession { id: string; title: string; createdAt: string; updatedAt: string; }

/** Full chat session including all messages (returned by GET /api/sessions/:id). */
export interface ChatSessionFull extends ChatSession { messages: Message[]; }

// ── App types ─────────────────────────────────────────────────────────────────

/** The five top-level navigation modes. */
export type Mode = "dashboard" | "chat" | "search" | "data" | "analytics";

/** Header strip metadata for the currently active mode. */
export interface ModeMeta { label: string; desc: string; color: string; }

// ── UI primitive prop types ───────────────────────────────────────────────────

export interface BtnProps {
  onClick: () => void;
  children: ReactNode;
  active?: boolean;
  style?: CSSProperties;
  disabled?: boolean;
}

export interface KPIProps {
  label: string;
  value: string;
  sub: string;
  color?: string;
  trend?: string | null;
}

/** Used by the simple dashboard Card (title + children). */
export interface CardProps { title: string; children: ReactNode; }

/** Extended card used in AnalyticsMode — adds badge pill and subtitle line. */
export interface AnalyticsCardProps {
  title: string;
  subtitle?: string;
  badge?: string;
  badgeColor?: string;
  children: ReactNode;
}
