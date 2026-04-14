import { useState, useMemo } from "react";
import { evaluateMetric, validateExpression, KNOWN_VARIABLES } from "../../algorithms/expressionEvaluator";
import type { CountryDataset } from "../../types";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { TT, GRID, AX } from "../../config/styles";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { Save, Trash2, AlertTriangle } from "lucide-react";

interface Props {
  token: string;
  dataset: CountryDataset | null;
  savedMetrics: Array<{ id: string; name: string; expression: string }>;
  onSave: (name: string, expression: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  isGuest: boolean;
}

export default function MetricBuilder({ dataset, savedMetrics, onSave, onDelete, isGuest }: Props) {
  const [expression, setExpression] = useState("");
  const [metricName, setMetricName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const validation = useMemo(() => {
    if (!expression.trim()) return { valid: true, variables: [] as string[] };
    return validateExpression(expression);
  }, [expression]);

  const evaluated = useMemo(() => {
    if (!dataset || !expression.trim() || !validation.valid || !validation.variables) return null;
    try {
      return evaluateMetric(expression, {
        gdpData: dataset.gdpData,
        exportData: dataset.exportData,
        importData: dataset.importData,
      });
    } catch {
      return null;
    }
  }, [dataset, expression, validation.valid, validation.variables]);

  const handleSave = async () => {
    if (!metricName.trim() || !expression.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await onSave(metricName.trim(), expression.trim());
      setMetricName("");
      setExpression("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save metric");
    } finally {
      setSaving(false);
    }
  };

  const unknownVars = (validation.variables ?? []).filter(v => !KNOWN_VARIABLES[v]);

  return (
    <div className="space-y-4">
      <div className="border-3 border-memphis-black bg-white shadow-hard-sm p-4">
        <h4 className="text-xs font-black uppercase tracking-wider text-memphis-black/50 mb-3">Define Custom Metric</h4>

        {isGuest && (
          <div className="mb-3 p-2.5 bg-amber-50 border-2 border-amber-200 text-[11px] text-amber-800">
            Sign up to save custom metrics. You can preview expressions below.
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-[200px_1fr_auto] gap-2 mb-3">
          <Input
            placeholder="Metric name"
            value={metricName}
            onChange={e => setMetricName(e.target.value)}
            className="text-xs h-9"
          />
          <Input
            placeholder="e.g. (exports - imports) / gdp * 100"
            value={expression}
            onChange={e => setExpression(e.target.value)}
            className={cn("text-xs h-9 font-mono", !validation.valid && expression && "border-red-400 focus-visible:ring-red-400")}
          />
          <Button onClick={handleSave} disabled={!metricName.trim() || !expression.trim() || !validation.valid || saving || isGuest} size="sm" className="h-9 gap-1.5">
            {saving ? <span className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            Save
          </Button>
        </div>

        {!validation.valid && expression && (
          <div className="flex items-center gap-1.5 text-[11px] text-red-600 mb-2">
            <AlertTriangle className="w-3 h-3" />
            {validation.error?.message}
          </div>
        )}

        {unknownVars.length > 0 && (
          <div className="flex items-center gap-1.5 text-[11px] text-amber-600 mb-2">
            <AlertTriangle className="w-3 h-3" />
            Unknown variables: {unknownVars.join(", ")} — they will evaluate to null
          </div>
        )}

        <div className="flex flex-wrap gap-1.5">
          {Object.entries(KNOWN_VARIABLES).map(([key, info]) => (
            <button
              key={key}
              onClick={() => setExpression(prev => prev + (prev && !prev.endsWith(" ") && !prev.endsWith("(") ? " " : "") + key)}
              className="text-[10px] font-mono px-2 py-0.5 border border-memphis-black/20 bg-memphis-offwhite hover:bg-memphis-black/10 transition-colors"
              title={`${info.label} (${info.unit}) — ${info.description}`}
            >
              {key}
            </button>
          ))}
          {["+", "-", "*", "/", "(", ")"].map(op => (
            <button
              key={op}
              onClick={() => setExpression(prev => prev + op)}
              className="text-[10px] font-mono px-2 py-0.5 border border-memphis-black/30 bg-white hover:bg-memphis-black/10 transition-colors font-bold"
            >
              {op}
            </button>
          ))}
        </div>
      </div>

      {evaluated && dataset && (
        <div className="border-3 border-memphis-black bg-white shadow-hard-sm p-4">
          <h4 className="text-xs font-black uppercase tracking-wider text-memphis-black/50 mb-2">
            Preview: {metricName || "Untitled Metric"}
          </h4>
          <div className="flex gap-4 mb-2 text-[11px] text-memphis-black/60">
            <span>{evaluated.values.filter(v => v.value != null).length} data points</span>
            <span>Range: {(() => {
              const valid = evaluated.values.filter(v => v.value != null);
              if (!valid.length) return "—";
              const min = Math.min(...valid.map(v => v.value!));
              const max = Math.max(...valid.map(v => v.value!));
              return `${min.toFixed(1)} – ${max.toFixed(1)}`;
            })()}</span>
          </div>
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={evaluated.values.filter(v => v.value != null)}>
              <CartesianGrid {...GRID} />
              <XAxis dataKey="year" tick={AX} />
              <YAxis tick={AX} domain={["auto", "auto"]} />
              <Tooltip {...TT} />
              <Line type="monotone" dataKey="value" stroke="#FF006E" strokeWidth={2} dot={{ r: 3 }} name={metricName || "Custom"} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {savedMetrics.length > 0 && (
        <div className="border-3 border-memphis-black bg-white shadow-hard-sm p-4">
          <h4 className="text-xs font-black uppercase tracking-wider text-memphis-black/50 mb-3">Saved Metrics</h4>
          <div className="space-y-2">
            {savedMetrics.map(m => (
              <div key={m.id} className="flex items-center gap-2 p-2.5 bg-memphis-offwhite border-2 border-memphis-black/15">
                <div className="flex-1 min-w-0">
                  <span className="text-xs font-bold text-memphis-black">{m.name}</span>
                  <span className="text-[10px] text-memphis-black/50 ml-2 font-mono">{m.expression}</span>
                </div>
                <button
                  onClick={() => { setExpression(m.expression); setMetricName(m.name); }}
                  className="text-[10px] text-memphis-pink hover:underline"
                >
                  Load
                </button>
                <button
                  onClick={() => onDelete(m.id)}
                  className="text-memphis-black/30 hover:text-red-500 transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {error && (
        <div className="p-2.5 bg-red-50 border-2 border-red-200 text-red-700 text-[11px]">{error}</div>
      )}
    </div>
  );
}