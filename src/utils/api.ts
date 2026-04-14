// ─────────────────────────────────────────────────────────────────────────────
// API UTILITIES  —  thin wrappers around the Express proxy endpoints.
// The Express server (server.js) holds the ANTHROPIC_API_KEY; the client
// bundle never sees it. All requests go to /api/*.
// ─────────────────────────────────────────────────────────────────────────────
import type { AIResponse, SearchResult, ParsedCSV, User, ChatSession, ChatSessionFull, CountryDataset, CountrySearchResult, CountryHistoryEntry } from "../types";

let authTokenGetter: null | (() => Promise<string | null>) = null;
const API_TIMEOUT_MS = 30_000;
const CHAT_STREAM_TIMEOUT_MS = 190_000;

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

/** Helper: POST to an endpoint, throw on non-2xx, return typed JSON. */
async function post<T>(path: string, body: unknown, token?: string): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const authToken = await resolveAuthToken(token);
  if (authToken) headers["Authorization"] = `Bearer ${authToken}`;
  const res = await fetch(path, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(API_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(await parseErrorMessage(res));
  return res.json() as Promise<T>;
}

/** Helper: GET from an endpoint with optional auth. */
async function get<T>(path: string, token?: string): Promise<T> {
  const headers: Record<string, string> = {};
  const authToken = await resolveAuthToken(token);
  if (authToken) headers["Authorization"] = `Bearer ${authToken}`;
  const res = await fetch(path, {
    headers,
    signal: AbortSignal.timeout(API_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(await parseErrorMessage(res));
  return res.json() as Promise<T>;
}

/** Helper: PATCH an endpoint with optional auth. */
async function patch<T>(path: string, body: unknown, token?: string): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const authToken = await resolveAuthToken(token);
  if (authToken) headers["Authorization"] = `Bearer ${authToken}`;
  const res = await fetch(path, {
    method: "PATCH",
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(API_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(await parseErrorMessage(res));
  return res.json() as Promise<T>;
}

/** Helper: DELETE an endpoint with optional auth and optional body. */
async function del<T>(path: string, token?: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  const authToken = await resolveAuthToken(token);
  if (authToken) headers["Authorization"] = `Bearer ${authToken}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(path, {
    method: "DELETE", headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(API_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(await parseErrorMessage(res));
  return res.json() as Promise<T>;
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
 * Perform a live web search (via Anthropic web_search beta tool).
 * Falls back to model knowledge if the tool is unavailable.
 * @param query - Raw search query string
 * @returns SearchResult with markdown text, source list, and webSearchUsed flag
 */
export function performWebSearch(query: string): Promise<SearchResult> {
  return post<SearchResult>("/api/search", { query });
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
