// ─────────────────────────────────────────────────────────────────────────────
// CSV PARSER  —  RFC 4180-compliant parser for client-side file processing.
// Handles quoted fields (commas, CRLF/LF newlines inside quotes), escaped
// double-quotes (""), and both CRLF and LF record separators.
// ─────────────────────────────────────────────────────────────────────────────
import type { ParsedCSV } from "../types";

function parseRecords(raw: string): string[][] {
  const records: string[][] = [];
  let record: string[] = [];
  let field = "";
  let inQuotes = false;
  let fieldWasQuoted = false;
  let quoteClosed = false;

  const pushField = () => {
    record.push(fieldWasQuoted ? field : field.trim());
    field = "";
    fieldWasQuoted = false;
    quoteClosed = false;
  };

  const pushRecord = () => {
    pushField();
    if (record.some((value) => value.trim() !== "")) records.push(record);
    record = [];
  };

  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i];

    if (ch === '"') {
      if (inQuotes && raw[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (inQuotes) {
        inQuotes = false;
        quoteClosed = true;
      } else if (field.trim() === "" && !quoteClosed) {
        inQuotes = true;
        fieldWasQuoted = true;
        field = "";
      } else {
        throw new Error(`CSV parse error: unexpected quote at character ${i}.`);
      }
      continue;
    }

    if (quoteClosed && ch !== "," && ch !== "\n" && ch !== "\r") {
      if (/\s/.test(ch)) continue;
      throw new Error(`CSV parse error: unexpected character after closing quote at character ${i}.`);
    }

    if (ch === "," && !inQuotes) {
      pushField();
      continue;
    }

    if ((ch === "\n" || ch === "\r") && !inQuotes) {
      if (ch === "\r" && raw[i + 1] === "\n") i += 1;
      pushRecord();
      continue;
    }

    field += ch;
  }

  if (inQuotes) throw new Error("CSV parse error: unclosed quote in field.");
  if (field.length > 0 || fieldWasQuoted || record.length > 0) pushRecord();

  return records;
}

/**
 * Parse raw CSV text into a structured ParsedCSV object.
 * @param raw - Raw CSV string from FileReader.readAsText()
 * @returns ParsedCSV with a headers array and rows as header→value maps.
 *          Returns empty arrays if the input has fewer than 2 non-blank records.
 */
export function parseCSV(raw: string): ParsedCSV {
  const records = parseRecords(raw.replace(/^\uFEFF/, ""));
  if (records.length < 2) return { headers: [], rows: [] };

  const headers = records[0].map((header) => header.trim());
  const rows = records.slice(1).map((values) => {
    const row: Record<string, string> = {};
    headers.forEach((header, i) => {
      row[header] = values[i] ?? "";
    });
    return row;
  });

  return { headers, rows };
}
