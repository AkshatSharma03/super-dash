// ─────────────────────────────────────────────────────────────────────────────
// SHARED TYPES  —  single source of truth for all interfaces used across modes.
// Import from here rather than re-declaring locally in component files.
// ─────────────────────────────────────────────────────────────────────────────
import type { ReactNode } from "react";

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

/** Provenance metadata attached to charts produced by the verified data pipeline. */
export interface ChartSource {
  api: "worldbank" | "imf" | "fred";
  indicator: string;
  indicatorName: string;
  countries?: string[];
  retrievedAt: string; // ISO 8601
  url: string;
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
  /** Present only when data was fetched from a real API (World Bank / IMF / FRED). */
  _source?: ChartSource;
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

/** API key row returned from /api/developer/keys. */
export interface DeveloperApiKey {
  id: string;
  name: string;
  keyPreview: string;
  rateLimit: number | null;
  callsThisMonth: number;
  callsRemaining: number | null;
  monthKey: string;
  lastUsedAt: string | null;
  createdAt: string;
}

/** API key management response from /api/developer/keys. */
export interface DeveloperKeysResponse {
  planLimit: number | null;
  keys: DeveloperApiKey[];
}

/** Response from POST /api/developer/keys (includes one-time secret key). */
export interface CreateDeveloperApiKeyResponse extends DeveloperApiKey {
  key: string;
}

// Chat message union — user sends plain text; assistant responds with AIResponse.
export interface UserMessage      { role: "user";      content: string; }
export interface AssistantMessage { role: "assistant"; content: AIResponse; }
export type Message = UserMessage | AssistantMessage;

/** Public API list endpoint response shape. */
export interface PublicApiCountry {
  code: string;
  alpha3: string;
  name: string;
  flag: string;
  region: string;
}

export interface PublicApiCountriesResponse {
  query: string | null;
  count: number;
  countries: PublicApiCountry[];
}

/** Public API country payload used by /api/data/:code and /api/data/batch. */
export interface PublicApiDataPoint {
  year: number;
  value: number;
}

export interface PublicApiIndicatorSeries {
  label: string;
  unit: string;
  data: PublicApiDataPoint[];
}

export interface PublicApiCountryData {
  code: string;
  alpha3: string;
  name: string;
  flag: string;
  region: string;
}

export interface PublicApiCountryPayload {
  country: PublicApiCountryData;
  period: {
    startYear: number;
    endYear: number;
  };
  indicators: Record<string, PublicApiIndicatorSeries>;
}

export interface PublicApiBatchFailure {
  code: string;
  error: string;
}

export interface PublicApiSeriesResponse {
  period: {
    startYear: number;
    endYear: number;
  };
  requestedIndicators: string[];
  requestedCountries: string[];
  countries: PublicApiCountryPayload[];
  failed: PublicApiBatchFailure[];
  invalid: string[];
}

/** A single source returned by /api/search. url is null for model-knowledge results. */
export interface SearchSource { title: string; url: string | null; }

/** Prior turns sent to /api/search so follow-up searches keep context continuity. */
export interface SearchContextTurn {
  query: string;
  summary?: string;
}

/** Full response from /api/search. */
export interface SearchResult {
  text: string;
  sources: SearchSource[];
  webSearchUsed: boolean;
}

/** Saved search query metadata for Search history list. */
export interface SearchHistoryEntry {
  id: string;
  query: string;
  createdAt: string;
  updatedAt: string;
}

export interface SearchSessionTurn {
  query: string;
  summary: string;
  result: SearchResult;
}

export interface SearchSession {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  turns: SearchSessionTurn[];
}

/** CSV parsed client-side before being sent to /api/analyze-csv. */
export interface ParsedCSV {
  headers: string[];
  rows: Record<string, string>[];
}

// ── Auth + session types ───────────────────────────────────────────────────────

/** Authenticated user returned from /api/auth/login and /api/auth/register. */
export interface User { id: string; email: string; name: string; isGuest?: boolean; }

/** Summary of a saved chat session (no messages — for sidebar list). */
export interface ChatSession { id: string; title: string; createdAt: string; updatedAt: string; }

/** Full chat session including all messages (returned by GET /api/sessions/:id). */
export interface ChatSessionFull extends ChatSession { messages: Message[]; }

// ── Multi-country dataset types ───────────────────────────────────────────────

/** A single series (sector or partner) inside a country's trade charts. */
export interface TradeSeries { key: string; label: string; color: string; }

/** A generic trade data row — year + total + any number of sector/partner keys. */
export interface TradeEntry { year: number; total: number; [key: string]: number; }

/** Country-level GDP row (digital_pct is optional — not all countries track it). */
export interface CountryGDPEntry {
  year: number;
  gdp_bn: number;
  gdp_growth: number;
  gdp_per_capita: number;
  digital_pct?: number;
}

export interface CountryPieEntry { name: string; value: number; }
export interface CountryKPIEntry { label: string; value: string; sub: string; trend: string | null; color: string; }

export type DataQualityStatus = "complete" | "partial" | "missing" | "estimated";

export interface DataQualityCell {
  year: number;
  indicator: string;
  indicatorLabel: string;
  status: DataQualityStatus;
  value: string;
}

/** Full dataset for one country — consumed by DashboardMode. */
export interface CountryDataset {
  code: string;
  name: string;
  flag: string;
  region: string;
  gdpData: CountryGDPEntry[];
  exportData: TradeEntry[];
  importData: TradeEntry[];
  exportSectors: TradeSeries[];
  importPartners: TradeSeries[];
  kpis: CountryKPIEntry[];
  pieExports: CountryPieEntry[];
  pieImports: CountryPieEntry[];
  _meta?: { sources: string[]; cachedAt: number; stale?: boolean; };
}

/** Country search result from /api/country/search. */
export interface CountrySearchResult { code: string; name: string; flag: string; region: string; }

/** Entry in the local fetch history from /api/country/history. */
export interface CountryHistoryEntry { code: string; name: string; flag: string; region: string; cachedAt: number; }

// ── App types ─────────────────────────────────────────────────────────────────

/** The top-level navigation modes. */
export type Mode = "dashboard" | "chat" | "search" | "data" | "analytics" | "export" | "methodology";

/** Header strip metadata for the currently active mode. */
export interface ModeMeta { label: string; desc: string; color: string; }

// ── UI primitive prop types ───────────────────────────────────────────────────

export interface BtnProps {
  onClick: () => void;
  children: ReactNode;
  active?: boolean;
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
