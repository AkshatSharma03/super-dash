// ─────────────────────────────────────────────────────────────────────────────
// CSV PARSER  —  RFC 4180-compliant parser for client-side file processing.
// Handles quoted fields (commas inside quotes), escaped double-quotes (""),
// and both CRLF and LF line endings.
// ─────────────────────────────────────────────────────────────────────────────
import type { ParsedCSV } from "../types";

/**
 * Parse raw CSV text into a structured ParsedCSV object.
 * @param raw - Raw CSV string from FileReader.readAsText()
 * @returns ParsedCSV with a headers array and rows as header→value maps.
 *          Returns empty arrays if the input has fewer than 2 lines.
 */
export function parseCSV(raw: string): ParsedCSV {
  const lines = raw.trim().split(/\r?\n/);
  if (lines.length < 2) return { headers: [], rows: [] };

  // State-machine field parser: tracks whether we are inside a quoted field.
  // Handles: quoted commas, escaped double-quotes (two consecutive quotes → one).
  const parseLine = (line: string): string[] => {
    const cols: string[] = [];
    let cur = "", inQ = false;
    for (let i = 0; i < line.length; i++) {
      if (line[i] === '"') {
        if (inQ && line[i + 1] === '"') { cur += '"'; i++; } // escaped quote
        else inQ = !inQ;
      } else if (line[i] === "," && !inQ) {
        cols.push(cur.trim()); cur = "";
      } else cur += line[i];
    }
    cols.push(cur.trim());
    return cols;
  };

  const headers = parseLine(lines[0]);
  const rows = lines.slice(1).filter(l => l.trim()).map(l => {
    const vals = parseLine(l);
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => { obj[h] = vals[i] ?? ""; });
    return obj;
  });

  return { headers, rows };
}
