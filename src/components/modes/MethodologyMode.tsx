import { useState } from "react";
import { useMobile } from "../../utils/useMobile";
import { METHODOLOGY, type AlgoMethod } from "../../data/methodology";
import "katex/dist/katex.min.css";
import katex from "katex";
import {
  CheckCircle2,
  AlertTriangle,
  BookOpen,
  ChevronDown,
  ChevronUp,
  ExternalLink,
} from "lucide-react";
import { cn } from "@/lib/utils";

function normalizeMathInput(input: string): string {
  const repaired = String(input ?? "")
    // Collapse accidental double-escaping, e.g. "\\hat" -> "\hat"
    .replace(/\\\\([a-zA-Z])/g, "\\$1")
    // Repair common control-char corruption from malformed JS escapes.
    .replace(/\u0009op/g, "\\top")
    .replace(/\u0009ext/g, "\\text")
    .replace(/\u0009au/g, "\\tau")
    .replace(/\u0009imes/g, "\\times")
    .replace(/\u0008eta/g, "\\beta")
    .replace(/\u0008ar/g, "\\bar")
    .replace(/\u000Crac/g, "\\frac")
    // Preserve a literal slash for any remaining control chars.
    .replace(/[\u0008\u0009\u000A\u000B\u000C\u000D]/g, "\\");
  const trimmed = repaired.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("$$") && trimmed.endsWith("$$"))
    return trimmed.slice(2, -2).trim();
  if (trimmed.startsWith("$") && trimmed.endsWith("$"))
    return trimmed.slice(1, -1).trim();
  if (trimmed.startsWith("\\[") && trimmed.endsWith("\\]"))
    return trimmed.slice(2, -2).trim();
  return trimmed;
}

function looksLikeMath(input: string): boolean {
  const value = String(input ?? "").trim();
  if (!value) return false;
  if (/[\\{}_^]/.test(value)) return true;
  if (/^\$.*\$$/.test(value) || /^\\\[.*\\\]$/.test(value)) return true;
  if (/\|?[a-zA-Z]+\|?\s*[<>]=?\s*-?\d/.test(value)) return true;
  return false;
}

function SafeBlockMath({ math }: { math: string }) {
  const normalized = normalizeMathInput(math);
  try {
    const html = katex.renderToString(normalized, {
      throwOnError: true,
      displayMode: true,
      output: "html",
    });
    return <div dangerouslySetInnerHTML={{ __html: html }} />;
  } catch {
    return (
      <pre className="text-[11px] text-memphis-black/80 whitespace-pre-wrap font-mono">
        {math}
      </pre>
    );
  }
}

function SafeInlineMath({ math }: { math: string }) {
  const normalized = normalizeMathInput(math);
  try {
    const html = katex.renderToString(normalized, {
      throwOnError: true,
      displayMode: false,
      output: "html",
    });
    return <span dangerouslySetInnerHTML={{ __html: html }} />;
  } catch {
    return <span className="text-[11px]">{math}</span>;
  }
}

function FormulaBlock({ math }: { math: string }) {
  return (
    <div className="katex-display overflow-x-auto">
      <SafeBlockMath math={math} />
    </div>
  );
}

function FormulaInline({ math }: { math: string }) {
  return (
    <span className="inline-block align-baseline">
      <SafeInlineMath math={math} />
    </span>
  );
}

function AlgoCard({
  algo,
  isOpen,
  toggle,
}: {
  algo: AlgoMethod;
  isOpen: boolean;
  toggle: () => void;
}) {
  return (
    <div
      className={cn(
        "border-3 border-memphis-black bg-white shadow-hard-sm",
        "hover:shadow-hard transition-shadow",
      )}
      style={{ borderTopColor: algo.color, borderTopWidth: 4 }}
    >
      <button
        onClick={toggle}
        className="w-full text-left px-5 py-4 flex items-center gap-3 focus:outline-none"
      >
        <span
          className="w-3 h-3 shrink-0 border-2 border-memphis-black"
          style={{ background: algo.color }}
        />
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-black text-memphis-black tracking-tight">
            {algo.name}
          </h3>
          <p className="text-[11px] text-memphis-black/60 mt-0.5 line-clamp-2">
            {algo.description}
          </p>
        </div>
        {isOpen ? (
          <ChevronUp className="w-4 h-4 text-memphis-black/40 shrink-0" />
        ) : (
          <ChevronDown className="w-4 h-4 text-memphis-black/40 shrink-0" />
        )}
      </button>

      {isOpen && (
        <div className="px-5 pb-5 border-t-2 border-memphis-black/10">
          <div className="mt-4 space-y-5">
            <div>
              <h4
                className={cn(
                  "text-[11px] font-black uppercase tracking-wider",
                  "text-memphis-black/50 mb-2",
                )}
              >
                Formula
              </h4>
                <div
                  className={cn(
                    "bg-memphis-offwhite border-2 border-memphis-black/10",
                    "px-4 py-3 overflow-x-auto",
                  )}
                >
                  <FormulaBlock math={algo.formula} />
                </div>
              </div>

            {algo.parameters.length > 0 && (
              <div>
                <h4
                  className={cn(
                    "text-[11px] font-black uppercase tracking-wider",
                    "text-memphis-black/50 mb-2",
                  )}
                >
                  Parameters
                </h4>
                <div className="space-y-2">
                  {algo.parameters.map((p, i) => (
                    <div
                      key={i}
                      className="bg-memphis-offwhite border-2 border-memphis-black/10 px-3 py-2.5"
                    >
                      <div className="flex items-baseline gap-2 mb-1">
                        <span className="text-[12px] font-bold text-memphis-black">
                          {p.name}
                        </span>
                        <span className="text-[11px] font-mono text-memphis-black/70">
                          =
                        </span>
                        <span className="text-[11px] font-mono text-memphis-black/80">
                          {looksLikeMath(p.value) ? (
                            <FormulaInline math={p.value} />
                          ) : (
                            p.value
                          )}
                        </span>
                      </div>
                      <p className="text-[10px] text-memphis-black/50 leading-relaxed">
                        {p.rationale}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <h4
                  className={cn(
                    "text-[11px] font-black uppercase tracking-wider",
                    "text-memphis-black/50 mb-2 flex items-center gap-1.5",
                  )}
                >
                  <CheckCircle2 className="w-3 h-3 text-emerald-600" />{" "}
                  Assumptions
                </h4>
                <ul className="space-y-1.5">
                  {algo.assumptions.map((a, i) => (
                    <li
                      key={i}
                      className="text-[11px] text-memphis-black/70 leading-relaxed flex gap-1.5"
                    >
                      <span className="text-emerald-500 mt-0.5 shrink-0">
                        •
                      </span>
                      <span>{a}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <h4
                  className={cn(
                    "text-[11px] font-black uppercase tracking-wider",
                    "text-memphis-black/50 mb-2 flex items-center gap-1.5",
                  )}
                >
                  <AlertTriangle className="w-3 h-3 text-amber-500" />{" "}
                  Limitations
                </h4>
                <ul className="space-y-1.5">
                  {algo.limitations.map((l, i) => (
                    <li
                      key={i}
                      className="text-[11px] text-memphis-black/70 leading-relaxed flex gap-1.5"
                    >
                      <span className="text-amber-500 mt-0.5 shrink-0">•</span>
                      <span>{l}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            <div>
              <h4
                className={cn(
                  "text-[11px] font-black uppercase tracking-wider",
                  "text-memphis-black/50 mb-2 flex items-center gap-1.5",
                )}
              >
                <BookOpen className="w-3 h-3 text-memphis-pink" /> Data Quality
                Notes
              </h4>
              <ul className="space-y-1.5">
                {algo.dataQualityNotes.map((n, i) => (
                  <li
                    key={i}
                    className="text-[11px] text-memphis-black/60 leading-relaxed flex gap-1.5"
                  >
                    <span className="text-memphis-pink/60 mt-0.5 shrink-0">
                      →
                    </span>
                    <span>{n}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="bg-memphis-offwhite border-2 border-memphis-black/10 px-3 py-2.5">
              <p className="text-[11px] text-memphis-black/50 mb-0.5">
                Reference
              </p>
              <p className="text-[11px] font-semibold text-memphis-black">
                {algo.paperReference.authors} ({algo.paperReference.year}).{" "}
                <span className="italic">{algo.paperReference.title}</span>
                {algo.paperReference.url && (
                  <a
                    href={algo.paperReference.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={cn(
                      "inline-flex items-center gap-0.5 ml-1",
                      "text-memphis-pink hover:underline",
                    )}
                  >
                    <ExternalLink className="w-3 h-3" />
                  </a>
                )}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function MethodologyMode() {
  const [openAlgos, setOpenAlgos] = useState<Set<string>>(
    new Set(["regression"]),
  );
  const isMobile = useMobile();

  const toggle = (id: string) => {
    setOpenAlgos((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const expandAll = () => setOpenAlgos(new Set(METHODOLOGY.map((a) => a.id)));
  const collapseAll = () => setOpenAlgos(new Set());

  return (
    <div className={cn("space-y-4", isMobile && "px-1")}>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-2">
        <div>
          <h2 className="text-lg font-black text-memphis-black tracking-tight">
            Methodology & Documentation
          </h2>
          <p className="text-[11px] text-memphis-black/60 mt-0.5">
            Every algorithm is implemented from scratch with zero ML libraries.
            Full transparency for reproducible research.
          </p>
        </div>
        <div className="flex gap-2 shrink-0">
          <button
            onClick={expandAll}
            className={cn(
              "px-3 py-1.5 text-[10px] font-bold uppercase tracking-wide",
              "border-2 border-memphis-black bg-white hover:bg-memphis-black",
              "hover:text-white transition-colors",
            )}
          >
            Expand All
          </button>
          <button
            onClick={collapseAll}
            className={cn(
              "px-3 py-1.5 text-[10px] font-bold uppercase tracking-wide",
              "border-2 border-memphis-black bg-white hover:bg-memphis-black",
              "hover:text-white transition-colors",
            )}
          >
            Collapse All
          </button>
        </div>
      </div>

      <div className="bg-white border-3 border-memphis-black shadow-hard p-4 space-y-2 mb-4">
        <h3 className="text-xs font-black uppercase tracking-wider text-memphis-black/50">
          General Principles
        </h3>
        <ul className="space-y-2 text-[11px] text-memphis-black/70 leading-relaxed">
          <li className="flex gap-2">
            <span className="text-memphis-pink font-bold shrink-0">1.</span>
            <span>
              <strong className="text-memphis-black">
                No external ML libraries.
              </strong>{" "}
              All algorithms are pure TypeScript functions with deterministic,
              auditable math. No black-box dependencies.
            </span>
          </li>
          <li className="flex gap-2">
            <span className="text-memphis-pink font-bold shrink-0">2.</span>
            <span>
              <strong className="text-memphis-black">
                Reproducible results.
              </strong>{" "}
              K-Means uses a seeded LCG (seed = 42). All calculations are pure
              functions — same input always produces the same output.
            </span>
          </li>
          <li className="flex gap-2">
            <span className="text-memphis-pink font-bold shrink-0">3.</span>
            <span>
              <strong className="text-memphis-black">
                Transparent data sources.
              </strong>{" "}
              Country data comes from the World Bank API with IMF/OECD fallback.
              Sector-level breakdowns are AI-estimated when granular data is
              unavailable. All sources are cited in each chart.
            </span>
          </li>
          <li className="flex gap-2">
            <span className="text-memphis-pink font-bold shrink-0">4.</span>
            <span>
              <strong className="text-memphis-black">
                Missing data handling.
              </strong>{" "}
              Years with missing values are excluded (listwise deletion) unless
              noted otherwise. The Data Quality Heatmap in Country Data mode
              shows exactly which values are present.
            </span>
          </li>
          <li className="flex gap-2">
            <span className="text-memphis-pink font-bold shrink-0">5.</span>
            <span>
              <strong className="text-memphis-black">
                Units & definitions.
              </strong>{" "}
              GDP is in current USD billions unless stated. Trade openness is
              (Exports + Imports) / GDP × 100. HHI uses the standard 0–10000
              scale.
            </span>
          </li>
        </ul>
      </div>

      <div className="space-y-3">
        {METHODOLOGY.map((algo) => (
          <AlgoCard
            key={algo.id}
            algo={algo}
            isOpen={openAlgos.has(algo.id)}
            toggle={() => toggle(algo.id)}
          />
        ))}
      </div>
    </div>
  );
}
