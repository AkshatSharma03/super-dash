// ─────────────────────────────────────────────────────────────────────────────
// API UTILITIES  —  thin wrappers around the Express proxy endpoints.
// The Express server (server.js) holds the ANTHROPIC_API_KEY; the client
// bundle never sees it. All requests go to /api/*.
// ─────────────────────────────────────────────────────────────────────────────
import type { AIResponse, SearchResult, ParsedCSV, User, ChatSession, ChatSessionFull } from "../types";

/** Helper: POST to an endpoint, throw on non-2xx, return typed JSON. */
async function post<T>(path: string, body: unknown, token?: string): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(path, { method: "POST", headers, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`${await res.text()}`);
  return res.json() as Promise<T>;
}

/** Helper: GET from an endpoint with optional auth. */
async function get<T>(path: string, token?: string): Promise<T> {
  const headers: Record<string, string> = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(path, { headers });
  if (!res.ok) throw new Error(`${await res.text()}`);
  return res.json() as Promise<T>;
}

/** Helper: PATCH an endpoint with optional auth. */
async function patch<T>(path: string, body: unknown, token?: string): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(path, { method: "PATCH", headers, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`${await res.text()}`);
  return res.json() as Promise<T>;
}

/** Helper: DELETE an endpoint with optional auth. */
async function del<T>(path: string, token?: string): Promise<T> {
  const headers: Record<string, string> = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(path, { method: "DELETE", headers });
  if (!res.ok) throw new Error(`${await res.text()}`);
  return res.json() as Promise<T>;
}

// ── Auth ──────────────────────────────────────────────────────────────────────

export function register(email: string, password: string, name: string) {
  return post<{ token: string; user: User }>("/api/auth/register", { email, password, name });
}

export function login(email: string, password: string) {
  return post<{ token: string; user: User }>("/api/auth/login", { email, password });
}

export function fetchMe(token: string) {
  return get<User>("/api/auth/me", token);
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
