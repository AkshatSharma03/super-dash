// ─────────────────────────────────────────────────────────────────────────────
// API UTILITIES  —  thin wrappers around the Express proxy endpoints.
// The Express server (server.js) holds the ANTHROPIC_API_KEY; the client
// bundle never sees it. All requests go to /api/*.
// ─────────────────────────────────────────────────────────────────────────────
import type { AIResponse, SearchResult, ParsedCSV } from "../types";

/** Helper: POST to an endpoint, throw on non-2xx, return typed JSON. */
async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

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
