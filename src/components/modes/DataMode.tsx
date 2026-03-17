// ─────────────────────────────────────────────────────────────────────────────
// DATA UPLOAD MODE  —  upload any CSV and have Claude generate charts + insights.
// Flow: drop/select file → parse client-side → preview table → send to /api/analyze-csv
// Supports drag-and-drop; only .csv files are accepted.
// ─────────────────────────────────────────────────────────────────────────────
import { useState, useRef } from "react";
import { analyzeCSVData } from "../../utils/api";
import { parseCSV } from "../../utils/csv";
import type { ParsedCSV, AIResponse } from "../../types";
import { DynChart } from "../ui";

export default function DataMode() {
  // ── State
  const [file,     setFile]     = useState<File | null>(null);
  const [csv,      setCsv]      = useState<ParsedCSV | null>(null);
  const [context,  setContext]  = useState("");   // optional user description of the dataset
  const [loading,  setLoading]  = useState(false);
  const [result,   setResult]   = useState<AIResponse | null>(null);
  const [error,    setError]    = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // ── Handlers
  const handleFile = (f: File | null | undefined) => {
    if (!f) return;
    if (!f.name.toLowerCase().endsWith(".csv")) {
      setError("Please upload a .csv file."); return;
    }
    setFile(f);
    setResult(null);
    setError(null);
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const parsed = parseCSV((e.target as FileReader).result as string);
        if (!parsed.headers.length) {
          setError("Could not parse CSV — ensure it has a header row."); return;
        }
        setCsv(parsed);
      } catch (err) {
        setError(err instanceof Error ? err.message : "CSV parse error.");
      }
    };
    reader.readAsText(f);
  };

  const generate = async () => {
    if (!csv || loading) return;
    setLoading(true);
    setError(null);
    try {
      const res = await analyzeCSVData(csv.headers, csv.rows, context);
      setResult(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setLoading(false);
  };

  const reset = () => {
    setFile(null); setCsv(null); setResult(null); setError(null); setContext("");
  };

  // ── Render
  return (
    <div style={{ maxWidth: 900, margin: "0 auto" }}>

      {/* ── Drop zone (shown until a file is loaded) ── */}
      {!csv && (
        <div
          onDragOver={e => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={e => { e.preventDefault(); setDragOver(false); handleFile(e.dataTransfer.files[0]); }}
          onClick={() => fileRef.current?.click()}
          style={{ border: `2px dashed ${dragOver ? "#F59E0B" : "#2d3348"}`, borderRadius: 16, padding: "56px 24px", textAlign: "center", cursor: "pointer", transition: "all .2s", marginBottom: 16, background: dragOver ? "#F59E0B0a" : "#161929", position: "relative", overflow: "hidden" }}>
          <input ref={fileRef} type="file" accept=".csv" style={{ display: "none" }}
            onChange={e => handleFile(e.target.files?.[0])} />
          <div style={{ width: 56, height: 56, borderRadius: 14, background: dragOver ? "#F59E0B22" : "#1e2130", border: `1px solid ${dragOver ? "#F59E0B55" : "#2d3348"}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24, margin: "0 auto 14px", transition: "all .2s" }}>📂</div>
          <p style={{ margin: "0 0 6px", fontSize: 16, fontWeight: 700, color: dragOver ? "#F59E0B" : "#e2e8f0", transition: "color .2s" }}>Drop your CSV file here</p>
          <p style={{ margin: "0 0 22px", fontSize: 13, color: "#475569" }}>or click to browse · CSV files only</p>
          <span style={{ background: "#F59E0B18", color: "#F59E0B", border: "1px solid #F59E0B44", borderRadius: 8, padding: "8px 22px", fontSize: 13, fontWeight: 600, display: "inline-block" }}>
            Select CSV File
          </span>
        </div>
      )}

      {/* ── File loaded: header + preview table + context input + generate button ── */}
      {csv && (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
            <span style={{ fontSize: 11, background: "#F59E0B22", color: "#F59E0B", border: "1px solid #F59E0B44", borderRadius: 5, padding: "2px 10px", fontWeight: 600 }}>
              📁 {file?.name}
            </span>
            <span style={{ fontSize: 11, color: "#64748b" }}>{csv.rows.length} rows · {csv.headers.length} columns</span>
            <button onClick={reset} style={{ marginLeft: "auto", background: "transparent", border: "1px solid #2d3348", borderRadius: 6, padding: "4px 12px", fontSize: 11, color: "#64748b", cursor: "pointer" }}>
              Remove file
            </button>
          </div>

          {/* Scrollable preview table — shows first 6 rows */}
          <div style={{ background: "#161929", border: "1px solid #2d3348", borderRadius: 10, overflow: "auto", marginBottom: 16, maxHeight: 240 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr>
                  {csv.headers.map((h, i) => (
                    <th key={i} style={{ padding: "9px 14px", textAlign: "left", color: "#F59E0B", fontWeight: 700, borderBottom: "1px solid #2d3348", background: "#0f1117", whiteSpace: "nowrap", position: "sticky", top: 0, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.5px" }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {csv.rows.slice(0, 6).map((row, ri) => (
                  <tr key={ri} style={{ borderBottom: "1px solid #2d334830", background: ri % 2 === 0 ? "transparent" : "#ffffff04" }}>
                    {csv.headers.map((h, ci) => (
                      <td key={ci} style={{ padding: "8px 14px", color: "#94a3b8", whiteSpace: "nowrap" }}>
                        {String(row[h]).slice(0, 40)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            {csv.rows.length > 6 && (
              <p style={{ margin: 0, padding: "7px 14px", fontSize: 11, color: "#475569", borderTop: "1px solid #2d334830" }}>
                + {csv.rows.length - 6} more rows not shown
              </p>
            )}
          </div>

          <div style={{ marginBottom: 16 }}>
            <label style={{ fontSize: 12, color: "#64748b", display: "block", marginBottom: 6 }}>
              Context (optional) — describe what this data represents:
            </label>
            <textarea value={context} onChange={e => setContext(e.target.value)}
              placeholder="e.g. Monthly US trade data 2020–2024, showing exports and imports by sector in USD millions…"
              rows={2}
              style={{ width: "100%", background: "#1e2130", border: "1px solid #2d3348", borderRadius: 8, padding: "10px 14px", color: "#e2e8f0", fontSize: 13, outline: "none", resize: "vertical", fontFamily: "Inter, sans-serif", boxSizing: "border-box", transition: "border-color .15s" }}
              onFocus={e => { e.target.style.borderColor = "#F59E0B"; }}
              onBlur={e => { e.target.style.borderColor = "#2d3348"; }} />
          </div>

          <button onClick={generate} disabled={loading}
            style={{ background: loading ? "#1e2130" : "#F59E0B", border: "none", borderRadius: 10, padding: "12px 28px", color: loading ? "#334155" : "#0f1117", fontSize: 14, fontWeight: 700, cursor: loading ? "not-allowed" : "pointer", transition: "all .15s", display: "inline-flex", alignItems: "center", gap: 8, boxShadow: !loading ? "0 2px 12px #F59E0B44" : "none" }}>
            {loading ? (
              <>
                <span style={{ width: 14, height: 14, borderRadius: "50%", border: "2px solid #334155", borderTop: "2px solid #64748b", display: "inline-block", animation: "spin 0.7s linear infinite" }} />
                Analyzing data…
              </>
            ) : "✨ Generate Charts"}
          </button>
        </>
      )}

      {/* ── Error state ── */}
      {error && (
        <div style={{ background: "#EF444422", border: "1px solid #EF4444", borderRadius: 10, padding: 14, fontSize: 13, color: "#EF4444", marginTop: 14 }}>
          {error}
        </div>
      )}

      {/* ── Analysis results: insight + chart cards + follow-up suggestions ── */}
      {result && (
        <div style={{ marginTop: 24 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
            <span style={{ fontSize: 11, background: "#F59E0B22", color: "#F59E0B", border: "1px solid #F59E0B44", borderRadius: 5, padding: "2px 10px", fontWeight: 600 }}>
              ✨ Generated Analysis
            </span>
            <button onClick={() => setResult(null)}
              style={{ marginLeft: "auto", background: "transparent", border: "1px solid #2d3348", borderRadius: 6, padding: "4px 12px", fontSize: 11, color: "#64748b", cursor: "pointer" }}>
              Regenerate
            </button>
          </div>

          {result.insight && (
            <div style={{ background: "#1e2130", border: "1px solid #2d3348", borderRadius: 12, padding: 16, marginBottom: 14 }}>
              <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
                <span style={{ fontSize: 14 }}>📊</span>
                <span style={{ fontSize: 11, color: "#F59E0B", fontWeight: 700, textTransform: "uppercase" }}>Analysis</span>
              </div>
              <p style={{ margin: 0, fontSize: 14, color: "#cbd5e1", lineHeight: 1.75 }}>{result.insight}</p>
            </div>
          )}

          {result.charts?.map(chart => (
            <div key={chart.id} style={{ background: "#1e2130", border: "1px solid #2d3348", borderRadius: 12, padding: 18, marginBottom: 12 }}>
              <h3 style={{ margin: "0 0 4px", fontSize: 14, color: "#e2e8f0", fontWeight: 600 }}>{chart.title}</h3>
              {chart.description && <p style={{ margin: "0 0 12px", fontSize: 12, color: "#64748b" }}>{chart.description}</p>}
              <DynChart chart={chart} />
            </div>
          ))}

          {(result.followUps?.length ?? 0) > 0 && (
            <div style={{ background: "#1e2130", border: "1px solid #2d3348", borderRadius: 10, padding: 14 }}>
              <p style={{ margin: "0 0 10px", fontSize: 11, color: "#64748b", fontWeight: 600 }}>Explore further in AI Chat mode:</p>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {result.followUps!.map((q, i) => (
                  <span key={i} style={{ background: "#0f1117", border: "1px solid #2d3348", borderRadius: 20, padding: "5px 12px", fontSize: 12, color: "#94a3b8" }}>{q}</span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {!csv && !error && (
        <p style={{ textAlign: "center", fontSize: 11, color: "#334155", marginTop: 8 }}>
          Upload any CSV — economic, trade, financial, or custom data — Claude generates charts and insights automatically
        </p>
      )}
    </div>
  );
}
