// Data upload mode for CSV analysis and chart generation.
import { useState, useRef } from "react";
import { analyzeCSVData } from "../../utils/api";
import { parseCSV } from "../../utils/csv";
import { useMobile } from "../../utils/useMobile";
import type { ParsedCSV, AIResponse } from "../../types";
import { ChartCard } from "../ui";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  AlertTriangle,
  FileUp,
  FileText,
  WandSparkles,
  BarChart3,
} from "lucide-react";

export default function DataMode() {
  const isMobile = useMobile();
  const [file, setFile] = useState<File | null>(null);
  const [csv, setCsv] = useState<ParsedCSV | null>(null);
  const [context, setContext] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<AIResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFile = (f: File | null | undefined) => {
    if (!f) return;
    if (fileRef.current) fileRef.current.value = "";
    if (!f.name.toLowerCase().endsWith(".csv")) {
      setError("Please upload a .csv file.");
      return;
    }
    setFile(f);
    setResult(null);
    setError(null);
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const parsed = parseCSV((e.target as FileReader).result as string);
        if (!parsed.headers.length) {
          setError("Could not parse CSV — ensure it has a header row.");
          return;
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
    } finally {
      setLoading(false);
    }
  };

  const reset = () => {
    if (fileRef.current) fileRef.current.value = "";
    setFile(null);
    setCsv(null);
    setResult(null);
    setError(null);
    setContext("");
  };

  return (
    <div className="max-w-[900px] mx-auto px-1 sm:px-0">
      {/* ── Drop zone ── */}
      {!csv && (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            handleFile(e.dataTransfer.files[0]);
          }}
          onClick={() => fileRef.current?.click()}
          className={cn(
            "border-4 border-dashed px-4 sm:px-6 text-center cursor-pointer",
            "transition-snap mb-5 relative overflow-hidden bg-white shadow-hard",
            "min-h-[180px] sm:min-h-[240px] py-9 sm:py-14",
            dragOver
              ? "border-memphis-orange bg-memphis-orange/5"
              : "border-memphis-black hover:-translate-y-px hover:shadow-hard-lg",
          )}
        >
          <input
            ref={fileRef}
            type="file"
            accept=".csv"
            className="hidden"
            onChange={(e) => handleFile(e.target.files?.[0])}
          />
          <div
            className={cn(
              "w-12 h-12 sm:w-14 sm:h-14 border-3 flex items-center",
              "justify-center text-xl sm:text-2xl mx-auto mb-3.5",
              "transition-snap shadow-hard-sm",
              dragOver
                ? "bg-memphis-orange/20 border-memphis-orange"
                : "bg-memphis-offwhite border-memphis-black",
            )}
          >
            <FileUp className="w-6 h-6 text-memphis-black" />
          </div>
          <p
            className={cn(
              "text-base font-black mb-1.5 transition-colors uppercase tracking-wide",
              dragOver ? "text-memphis-orange" : "text-memphis-black",
            )}
          >
            Drop your CSV file here
          </p>
          <p className="text-[13px] text-memphis-black/60 mb-5">
            or click to browse · CSV files only
          </p>
          <span
            className={cn(
              "bg-memphis-yellow text-memphis-black border-3",
              "border-memphis-black px-5 py-2 text-[13px] font-black",
              "inline-block shadow-hard-sm",
            )}
          >
            Select CSV File
          </span>
        </div>
      )}

      {/* ── File loaded: preview + context + generate ── */}
      {csv && (
        <>
          <div className="flex items-center gap-2.5 mb-4 flex-wrap">
            <Badge>
              <span className="inline-flex items-center gap-1.5">
                <FileText className="w-3.5 h-3.5" /> {file?.name}
              </span>
            </Badge>
            <span className="text-[11px] text-muted-foreground">
              {csv.rows.length} rows · {csv.headers.length} columns
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={reset}
              className="ml-auto text-xs min-h-11"
            >
              Remove file
            </Button>
          </div>

          {/* Scrollable preview table */}
          {isMobile ? (
            <div className="mb-4 space-y-2">
              {csv.rows.slice(0, 6).map((row, ri) => (
                <div
                  key={ri}
                  className="bg-card border border-border rounded-xl p-3"
                >
                  <p
                    className={cn(
                      "text-[10px] font-black uppercase tracking-[0.6px]",
                      "text-amber-500 mb-2",
                    )}
                  >
                    Row {ri + 1}
                  </p>
                  <div className="space-y-1.5">
                    {csv.headers.slice(0, 5).map((h, ci) => (
                      <div
                        key={ci}
                        className="flex items-start justify-between gap-2"
                      >
                        <span className="text-[11px] text-muted-foreground font-semibold shrink-0">
                          {h}
                        </span>
                        <span className="text-[11px] text-slate-400 text-right break-all">
                          {String(row[h]).slice(0, 56)}
                        </span>
                      </div>
                    ))}
                    {csv.headers.length > 5 && (
                      <p className="text-[10px] text-muted-foreground">
                        +{csv.headers.length - 5} more columns
                      </p>
                    )}
                  </div>
                </div>
              ))}
              {csv.rows.length > 6 && (
                <p className="px-0.5 py-1 text-[11px] text-muted-foreground">
                  + {csv.rows.length - 6} more rows not shown
                </p>
              )}
            </div>
          ) : (
            <div className="bg-card border border-border rounded-xl overflow-auto mb-4 max-h-60">
              <table className="w-full border-collapse text-xs">
                <thead>
                  <tr>
                    {csv.headers.map((h, i) => (
                      <th
                        key={i}
                        className={cn(
                          "px-3.5 py-2.5 text-left text-amber-500 font-bold",
                          "border-b border-border bg-background whitespace-nowrap",
                          "sticky top-0 uppercase tracking-[0.5px] text-[11px]",
                        )}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {csv.rows.slice(0, 6).map((row, ri) => (
                    <tr
                      key={ri}
                      className={cn(
                        "border-b border-border/20",
                        ri % 2 !== 0 && "bg-white/[0.02]",
                      )}
                    >
                      {csv.headers.map((h, ci) => (
                        <td
                          key={ci}
                          className="px-3.5 py-2 text-slate-400 whitespace-nowrap"
                        >
                          {String(row[h]).slice(0, 40)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              {csv.rows.length > 6 && (
                <p
                  className={cn(
                    "px-3.5 py-1.5 text-[11px] text-muted-foreground border-t",
                    "border-border/20",
                  )}
                >
                  + {csv.rows.length - 6} more rows not shown
                </p>
              )}
            </div>
          )}

          <div className="mb-4">
            <label className="text-xs font-bold text-memphis-black/70 block mb-1.5">
              Context (optional) — describe what this data represents:
            </label>
            <Textarea
              value={context}
              onChange={(e) => setContext(e.target.value)}
              placeholder={
                "e.g. Monthly US trade data 2020–2024, showing exports and " +
                "imports by sector in USD millions…"
              }
              rows={2}
              className={cn(
                "min-h-[78px] rounded-none border-3 border-memphis-black",
                "bg-white text-memphis-black",
                "placeholder:text-memphis-black/45 shadow-hard-sm resize-none",
                "focus-visible:ring-0 focus-visible:border-memphis-orange",
              )}
            />
          </div>

          <Button
            onClick={generate}
            disabled={loading}
            className={cn(
              "bg-[#F59E0B] hover:bg-[#D97706] text-[#0f1117] font-bold",
              "shadow-[0_2px_12px_#F59E0B44] gap-2 min-h-11",
            )}
          >
            {loading ? (
              <>
                <span
                  className={cn(
                    "w-3.5 h-3.5 rounded-full border-2 border-muted/50",
                    "border-t-muted/70 inline-block animate-spin",
                  )}
                />
                Analyzing data…
              </>
            ) : (
              <span className="inline-flex items-center gap-2">
                <WandSparkles className="w-4 h-4" /> Generate Charts
              </span>
            )}
          </Button>
        </>
      )}

      {/* ── Error ── */}
      {error && (
        <Alert variant="destructive" className="mt-3.5">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* ── Analysis results ── */}
      {result && (
        <div className="mt-6">
          <div className="flex items-center gap-2.5 mb-3.5">
            <Badge variant="warning">
              <span className="inline-flex items-center gap-1.5">
                <BarChart3 className="w-3.5 h-3.5" /> Generated Analysis
              </span>
            </Badge>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setResult(null)}
              className="ml-auto text-xs min-h-11"
            >
              Regenerate
            </Button>
          </div>

          {result.insight && (
            <div className="bg-muted border border-border rounded-xl p-4 mb-3.5">
              <div className="flex gap-2 items-center mb-2">
                <BarChart3 className="w-4 h-4 text-amber-500" />
                <span className="text-[11px] text-amber-500 font-bold uppercase">
                  Analysis
                </span>
              </div>
              <p className="text-sm text-slate-300 leading-[1.75]">
                {result.insight}
              </p>
            </div>
          )}

          {result.charts?.map((chart) => (
            <ChartCard key={chart.id} chart={chart} />
          ))}

          {(result.followUps?.length ?? 0) > 0 && (
            <div className="bg-muted border border-border rounded-xl p-3.5">
              <p className="text-[11px] text-muted-foreground font-semibold mb-2.5">
                Explore further in AI Chat mode:
              </p>
              <div className="flex gap-2 flex-wrap">
                {result.followUps!.map((q, i) => (
                  <span
                    key={i}
                    className={cn(
                      "bg-background border border-border rounded-full px-3",
                      "py-1.5 text-xs text-slate-400",
                    )}
                  >
                    {q}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {!csv && !error && (
        <p className="text-center text-[11px] text-border mt-2">
          Upload any CSV — economic, trade, financial, or custom data — Claude
          generates charts and insights automatically
        </p>
      )}
    </div>
  );
}
