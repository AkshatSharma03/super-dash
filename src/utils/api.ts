// ─────────────────────────────────────────────────────────────────────────────
// API UTILITIES  —  thin wrappers around the Express proxy endpoints.
// The Express server (server.js) holds the ANTHROPIC_API_KEY; the client
// bundle never sees it. All requests go to /api/*.
// ─────────────────────────────────────────────────────────────────────────────
import type {
  AIResponse,
  SearchResult,
  SearchHistoryEntry,
  SearchContextTurn,
  SearchSession,
  SearchSessionTurn,
  ParsedCSV,
  User,
  ChatSession,
  ChatSessionFull,
  CountryDataset,
  CountrySearchResult,
  CountryHistoryEntry,
  DeveloperKeysResponse,
  CreateDeveloperApiKeyResponse,
  PublicApiCountriesResponse,
  PublicApiCountryPayload,
  PublicApiSeriesResponse,
  PeerComparisonResponse,
  PeerGroupType,
  PeerMetricKey,
  SnapshotSummary,
  SnapshotFull,
  SnapshotRegenerateResponse,
} from "../types";

let authTokenGetter: null | (() => Promise<string | null>) = null;
const API_TIMEOUT_MS = 30_000;
const CHAT_STREAM_TIMEOUT_MS = 190_000;
const SEARCH_TIMEOUT_MS = 75_000;

export function setAuthTokenGetter(getter: (() => Promise<string | null>) | null) {
  authTokenGetter = getter;
}

async function parseErrorMessage(res: Response): Promise<string> {
  const fallback = `${res.status} ${res.statusText}`.trim();
  const contentType = res.headers.get("content-type") ?? "";

  try {
    if (contentType.includes("application/json")) {
      const json = await res.json() as { error?: unknown; message?: unknown };
      if (typeof json.error === "string" && json.error.trim()) return json.error;
      if (typeof json.message === "string" && json.message.trim()) return json.message;
      return fallback;
    }

    const text = (await res.text()).trim();
    return text || fallback;
  } catch {
    return fallback;
  }
}

async function resolveAuthToken(token?: string): Promise<string | undefined> {
  if (token) return token;
  if (!authTokenGetter) return undefined;
  const dynamicToken = await authTokenGetter();
  return dynamicToken ?? undefined;
}

async function requestJSON<T>(
  path: string,
  options: {
    method?: "GET" | "POST" | "PATCH" | "DELETE";
    token?: string;
    body?: unknown;
    timeoutMs?: number;
  } = {},
): Promise<T> {
  const method = options.method ?? "GET";
  const headers: Record<string, string> = {};

  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  const authToken = await resolveAuthToken(options.token);
  if (authToken) {
    headers["Authorization"] = `Bearer ${authToken}`;
  }

  const res = await fetch(path, {
    method,
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    signal: AbortSignal.timeout(options.timeoutMs ?? API_TIMEOUT_MS),
  });

  if (!res.ok) {
    throw new Error(await parseErrorMessage(res));
  }

  return res.json() as Promise<T>;
 }

async function requestText(
  path: string,
  options: {
    method?: "GET" | "POST" | "PATCH" | "DELETE";
    token?: string;
    body?: unknown;
    timeoutMs?: number;
  } = {},
): Promise<string> {
  const method = options.method ?? "GET";
  const headers: Record<string, string> = {};

  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  const authToken = await resolveAuthToken(options.token);
  if (authToken) {
    headers["Authorization"] = `Bearer ${authToken}`;
  }

  const res = await fetch(path, {
    method,
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    signal: AbortSignal.timeout(options.timeoutMs ?? API_TIMEOUT_MS),
  });

  if (!res.ok) {
    throw new Error(await parseErrorMessage(res));
  }

  return res.text();
}

function stringifyApiParams(params: Record<string, string | number | undefined | null>): string {
  const entries = Object.entries(params).filter(([, value]) => value !== undefined && value !== null && `${value}`.length > 0);
  if (!entries.length) return "";
  const search = new URLSearchParams();
  for (const [key, value] of entries) {
    search.append(key, String(value));
  }
  return `?${search.toString()}`;
}

/** Helper: POST to an endpoint, throw on non-2xx, return typed JSON. */
async function post<T>(path: string, body: unknown, token?: string, timeoutMs?: number): Promise<T> {
  return requestJSON<T>(path, {
    method: "POST",
    body,
    token,
    timeoutMs,
  });
}

/** Helper: GET from an endpoint with optional auth. */
async function get<T>(path: string, token?: string): Promise<T> {
  return requestJSON<T>(path, { token });
}

/** Helper: PATCH an endpoint with optional auth. */
async function patch<T>(path: string, body: unknown, token?: string): Promise<T> {
  return requestJSON<T>(path, {
    method: "PATCH",
    body,
    token,
  });
}

/** Helper: DELETE an endpoint with optional auth and optional body. */
async function del<T>(path: string, token?: string, body?: unknown): Promise<T> {
  return requestJSON<T>(path, {
    method: "DELETE",
    token,
    body,
  });
}

// ── Auth ──────────────────────────────────────────────────────────────────────

export function register(email: string, password: string, name: string) {
  return post<{ token: string; user: User }>("/api/auth/register", { email, password, name });
}

export function guestLogin() {
  return post<{ token: string; user: User }>("/api/auth/guest", {});
}

export function login(email: string, password: string) {
  return post<{ token: string; user: User }>("/api/auth/login", { email, password });
}

export function fetchMe(token: string) {
  return get<User>("/api/auth/me", token);
}

export function getUsage(token: string) {
  return get<{ sessionCount: number; messageCount: number; memberSince: string }>("/api/auth/usage", token);
}

export function changePassword(token: string, currentPassword: string, newPassword: string) {
  return patch<{ ok: boolean }>("/api/auth/password", { currentPassword, newPassword }, token);
}

export function deleteAccount(token: string, password: string) {
  return del<{ ok: boolean }>("/api/auth/account", token, { password });
}

export function logoutApi(token: string) {
  return post<{ ok: boolean }>("/api/auth/logout", {}, token);
}

export function requestPasswordReset(email: string) {
  return post<{ ok: boolean; resetUrl?: string }>("/api/auth/forgot-password", { email });
}

export function resetPassword(token: string, newPassword: string) {
  return post<{ ok: boolean }>("/api/auth/reset-password", { token, newPassword });
}

// ── Chat sessions ─────────────────────────────────────────────────────────────

export function getSessions(token: string) {
  return get<ChatSession[]>("/api/sessions", token);
}

export function createSession(token: string, title: string) {
  return post<ChatSessionFull>("/api/sessions", { title }, token);
}

export function getSession(token: string, id: string) {
  return get<ChatSessionFull>(`/api/sessions/${id}`, token);
}

export function updateSession(token: string, id: string, data: Partial<{ messages: unknown[]; title: string }>) {
  return patch<{ id: string; title: string; updatedAt: string }>(`/api/sessions/${id}`, data, token);
}

export function deleteSession(token: string, id: string) {
  return del<{ ok: boolean }>(`/api/sessions/${id}`, token);
}

// ── AI endpoints ──────────────────────────────────────────────────────────────

/**
 * Send a conversation history to Claude and get structured analysis back.
 * @param messages - Full chat history (role + content pairs)
 * @returns AIResponse with insight text, chart configs, sources, follow-ups
 */
export function askClaude(
  messages: Array<{ role: string; content: string }>,
): Promise<AIResponse> {
  return post<AIResponse>("/api/chat", { messages });
}

export interface ChatStreamCallbacks {
  /** Fired when Claude is fetching a data source (e.g. "Fetching World Bank data…"). */
  onStatus: (text: string) => void;
  /** Fired for each insight text token as it streams in. */
  onText: (delta: string) => void;
  /** Fired once when the full response (including charts) is ready. */
  onDone: (result: AIResponse) => void;
  /** Fired if the server returns an error. */
  onError: (message: string) => void;
}

/**
 * Streaming version of askClaude. Connects to /api/chat via SSE and fires
 * callbacks as events arrive so the UI can update progressively.
 */
export async function askClaudeStream(
  messages: Array<{ role: string; content: string }>,
  callbacks: ChatStreamCallbacks,
  token?: string,
): Promise<void> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const authToken = await resolveAuthToken(token);
  if (authToken) headers["Authorization"] = `Bearer ${authToken}`;

  const res = await fetch("/api/chat", {
    method: "POST",
    headers,
    body: JSON.stringify({ messages }),
    signal: AbortSignal.timeout(CHAT_STREAM_TIMEOUT_MS),
  });

  if (!res.ok || !res.body) {
    callbacks.onError(await parseErrorMessage(res));
    return;
  }

  const reader  = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";

      let eventName = "";
      for (const line of lines) {
        if (line.startsWith("event: ")) {
          eventName = line.slice(7).trim();
        } else if (line.startsWith("data: ")) {
          const raw = line.slice(6);
          try {
            const payload = JSON.parse(raw);
            if (eventName === "status") callbacks.onStatus(payload.text ?? "");
            else if (eventName === "text")  callbacks.onText(payload.delta ?? "");
            else if (eventName === "done")  callbacks.onDone(payload.result as AIResponse);
            else if (eventName === "error") callbacks.onError(payload.message ?? "Unknown error");
          } catch { /* malformed event — skip */ }
          eventName = "";
        }
      }
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Network error";
    callbacks.onError(msg);
  } finally {
    reader.releaseLock();
  }
}

/**
 * Perform a live web search via Kagi FastGPT.
 * @param query - Raw search query string
 * @param context - Optional prior turns for follow-up continuity
 * @returns SearchResult with markdown text, source list, and webSearchUsed flag
 */
export function performWebSearch(query: string, context: SearchContextTurn[] = []): Promise<SearchResult> {
  return post<SearchResult>("/api/search", { query, context }, undefined, SEARCH_TIMEOUT_MS);
}

export function getSearchHistory(token: string): Promise<SearchHistoryEntry[]> {
  return get<SearchHistoryEntry[]>("/api/search/history", token);
}

export function saveSearchHistory(token: string, query: string): Promise<SearchHistoryEntry> {
  return post<SearchHistoryEntry>("/api/search/history", { query }, token);
}

export function clearSearchHistory(token: string): Promise<{ ok: boolean }> {
  return del<{ ok: boolean }>("/api/search/history", token);
}

export function getSearchSessions(token: string): Promise<SearchSession[]> {
  return get<SearchSession[]>("/api/search/sessions", token);
}

export function createSearchSession(token: string, title: string): Promise<SearchSession> {
  return post<SearchSession>("/api/search/sessions", { title }, token);
}

export function updateSearchSession(
  token: string,
  id: string,
  data: Partial<{ turns: SearchSessionTurn[]; title: string }>,
): Promise<{ id: string; title: string; updatedAt: string }> {
  return patch<{ id: string; title: string; updatedAt: string }>(`/api/search/sessions/${id}`, data, token);
}

export function deleteSearchSession(token: string, id: string): Promise<{ ok: boolean }> {
  return del<{ ok: boolean }>(`/api/search/sessions/${id}`, token);
}

/**
 * Send parsed CSV data to Claude for chart and insight generation.
 * @param headers - Column header names from the CSV
 * @param rows    - Parsed row data as header→value maps
 * @param context - Optional user-provided description of the dataset
 * @returns AIResponse with chart configs tailored to the uploaded data
 */
export function analyzeCSVData(
  headers: string[],
  rows: ParsedCSV["rows"],
  context: string,
): Promise<AIResponse> {
  return post<AIResponse>("/api/analyze-csv", { headers, rows, context });
}

// ── Analytics ─────────────────────────────────────────────────────────────────

/**
 * Send a free-text query about a country's economic data to Claude.
 * `context` is a pre-formatted text summary of the country dataset.
 * Returns an AIResponse with insight, charts, sources, and follow-ups.
 */
export function queryAnalytics(query: string, context: string, token: string): Promise<AIResponse> {
  return post<AIResponse>("/api/analytics", { query, context }, token);
}

// ── Country data ──────────────────────────────────────────────────────────────

/**
 * Search for countries by name (proxied to World Bank country list).
 * Returns up to 15 matches with ISO-2 code, name, flag, and region.
 */
export function searchCountries(q: string, token: string): Promise<CountrySearchResult[]> {
  return get<CountrySearchResult[]>(`/api/country/search?q=${encodeURIComponent(q)}`, token);
}

/**
 * Get a country's full economic dataset.
 * Served from SQLite cache (7-day TTL); fetched fresh from World Bank + Claude if stale.
 */
export function getCountryData(code: string, token: string): Promise<CountryDataset> {
  return get<CountryDataset>(`/api/country/${code}`, token);
}

/**
 * Force a re-fetch of a country's data from World Bank + Claude, bypassing the cache.
 */
export function refreshCountryData(code: string, token: string): Promise<CountryDataset> {
  return post<CountryDataset>(`/api/country/${code}/refresh`, {}, token);
}

/**
 * Return metadata for every country already stored in the local cache, newest first.
 */
export function getCountryHistory(token: string): Promise<CountryHistoryEntry[]> {
  return get<CountryHistoryEntry[]>("/api/country/history", token);
}

// ── Developer API key management ─────────────────────────────────────────────

export interface ApiRequestParams {
  format?: "json" | "csv";
  search?: string;
  countries?: string;
  indicators?: string;
  startYear?: number;
  endYear?: number;
  years?: string;
}

export function getDeveloperKeys(token: string): Promise<DeveloperKeysResponse> {
  return get<DeveloperKeysResponse>("/api/developer/keys", token);
}

export function createDeveloperKey(token: string, name?: string): Promise<CreateDeveloperApiKeyResponse> {
  return post<CreateDeveloperApiKeyResponse>("/api/developer/keys", { name }, token);
}

export function deleteDeveloperKey(token: string, id: string): Promise<{ ok: boolean }> {
  return del<{ ok: boolean }>(`/api/developer/keys/${id}`, token);
}

// ── Public data API client helpers ───────────────────────────────────────────

export function getApiDataCountries(token: string, options: ApiRequestParams = {}): Promise<PublicApiCountriesResponse> {
  const q = stringifyApiParams({
    search: options.search,
    format: options.format,
  });
  return get<PublicApiCountriesResponse>(`/api/data/countries${q}`, token);
}

export function getApiDataCountriesCsv(token: string, options: ApiRequestParams = {}): Promise<string> {
  const q = stringifyApiParams({
    search: options.search,
    format: "csv",
  });
  return requestText(`/api/data/countries${q}`, { token });
}

export function getApiDataByCountry(
  token: string,
  code: string,
  options: ApiRequestParams = {},
): Promise<PublicApiCountryPayload | string> {
  const q = stringifyApiParams({
    indicators: options.indicators,
    startYear: options.startYear,
    endYear: options.endYear,
    years: options.years,
    format: options.format,
  });
  const path = `/api/data/${code}${q}`;
  if (options.format === "csv") {
    return requestText(path, { token });
  }
  return get<PublicApiCountryPayload>(path, token);
}

export function getApiDataBatch(
  token: string,
  options: ApiRequestParams = {},
): Promise<PublicApiSeriesResponse | string> {
  const q = stringifyApiParams({
    countries: options.countries,
    indicators: options.indicators,
    startYear: options.startYear,
    endYear: options.endYear,
    years: options.years,
    format: options.format,
  });
  const path = `/api/data/batch${q}`;
  if (options.format === "csv") {
    return requestText(path, { token });
  }
  return get<PublicApiSeriesResponse>(path, token);
}

export function getPeerComparison(
  token: string,
  countryCode: string,
  options: {
    groupType?: PeerGroupType;
    metric?: PeerMetricKey;
    year?: number;
  } = {},
): Promise<PeerComparisonResponse> {
  const q = stringifyApiParams({
    groupType: options.groupType,
    metric: options.metric,
    year: options.year,
  });
  return get<PeerComparisonResponse>(`/api/peers/${countryCode}${q}`, token);
}

export interface SessionShare {
  id: string;
  shareToken: string;
  url: string;
  createdAt: string;
}

export interface ShareView {
  id: string;
  share_token: string;
  created_at: string;
  view_count: number;
}

export interface SharedSession {
  title: string;
  messages: unknown[];
  createdAt: string;
  updatedAt: string;
  viewCount: number;
}

export function createSessionShare(token: string, sessionId: string): Promise<SessionShare> {
  return post<SessionShare>(`/api/sessions/${sessionId}/share`, {}, token);
}

export function getSessionShares(token: string, sessionId: string): Promise<ShareView[]> {
  return get<ShareView[]>(`/api/sessions/${sessionId}/shares`, token);
}

export function deleteSessionShare(token: string, sessionId: string, shareId: string): Promise<{ ok: boolean }> {
  return requestJSON<{ ok: boolean }>(`/api/sessions/${sessionId}/shares/${shareId}`, { method: "DELETE", token });
}

export function getSharedSession(shareToken: string): Promise<SharedSession> {
  return get<SharedSession>(`/api/share/${shareToken}`);
}

export interface SnapshotCreatePayload {
  countryCode: string;
  title?: string;
  description?: string;
  dataPayload?: unknown;
  dataVersion?: number;
  isPublic?: boolean;
}

export function getSnapshots(token: string): Promise<SnapshotSummary[]> {
  return get<SnapshotSummary[]>("/api/snapshots", token);
}

export function createSnapshot(token: string, payload: SnapshotCreatePayload): Promise<SnapshotFull> {
  return post<SnapshotFull>("/api/snapshots", payload, token);
}

export function getSnapshot(token: string, id: string): Promise<SnapshotFull> {
  return get<SnapshotFull>(`/api/snapshots/${id}`, token);
}

export function regenerateSnapshot(token: string, id: string, forceRefresh = false): Promise<SnapshotRegenerateResponse> {
  return post<SnapshotRegenerateResponse>(`/api/snapshots/${id}/regenerate`, { forceRefresh }, token);
}

export function getSharedSnapshot(shareToken: string): Promise<SnapshotFull> {
  return get<SnapshotFull>(`/api/snapshot/${shareToken}`);
}

export interface CustomMetric {
  id: string;
  name: string;
  expression: string;
  description: string;
  createdAt: string;
  updatedAt: string;
}

export function getCustomMetrics(token: string): Promise<CustomMetric[]> {
  return get<CustomMetric[]>("/api/metrics", token);
}

export function createCustomMetric(token: string, name: string, expression: string, description?: string): Promise<CustomMetric> {
  return post<CustomMetric>("/api/metrics", { name, expression, description }, token);
}

export function updateCustomMetric(token: string, id: string, data: Partial<{ name: string; expression: string; description: string }>): Promise<CustomMetric> {
  return requestJSON<CustomMetric>(`/api/metrics/${id}`, { method: "PATCH", token, body: data });
}

export function deleteCustomMetric(token: string, id: string): Promise<{ ok: boolean }> {
  return requestJSON<{ ok: boolean }>(`/api/metrics/${id}`, { method: "DELETE", token });
}
