// ─────────────────────────────────────────────────────────────────────────────
// DASHBOARD MODE  —  multi-country economic data viewer.
//
// Country fetch state lives in App.tsx so fetches survive tab switches.
// This component owns only UI-local state: year range, search, tab, history.
// ─────────────────────────────────────────────────────────────────────────────
import { useState, useEffect, useMemo } from "react";
import { useMobile } from "../../utils/useMobile";
import {
  ComposedChart, Bar, Line, BarChart, AreaChart, Area,
  PieChart, Pie, Cell, LineChart, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import type { CountryDataset, CountryHistoryEntry } from "../../types";
import { getCountryHistory } from "../../utils/api";
import { TT, GRID, AX, LEG, P } from "../../config/styles";
import { Btn, KPI, Card } from "../ui";
import { POPULAR_COUNTRIES } from "../../data/suggestions";
import CountrySearchInput from "../shared/CountrySearchInput";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge }  from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";
import { AlertTriangle, Loader2, Globe2, RefreshCw } from "lucide-react";


const DASH_TABS = ["GDP", "Exports", "Imports", "Trade Balance"] as const;
type DashTab = typeof DASH_TABS[number];

interface Props {
  token: string;
  dataset: CountryDataset | null;
  loading: boolean;
  error: string | null;
  onSelectCountry: (code: string) => void;
  onRefresh: () => void;
}

export default function DashboardMode({ token, dataset, loading, error, onSelectCountry, onRefresh }: Props) {
  const isMobile = useMobile();
  // ── UI-local state ──────────────────────────────────────────────────────────
  const [tab,       setTab]       = useState<DashTab>("GDP");
  const [yearRange, setYearRange] = useState<[number, number]>([2010, 2024]);
  const [history,   setHistory]   = useState<CountryHistoryEntry[]>([]);

  // ── Load fetch history on mount and whenever the loaded country changes ──────
  useEffect(() => {
    getCountryHistory(token).then(setHistory).catch(() => {});
  }, [token, dataset?.code]);

  // ── Adapt year range when a new dataset loads ───────────────────────────────
  useEffect(() => {
    if (!dataset) return;
    const years = dataset.gdpData.map(d => d.year);
    if (years.length) setYearRange([Math.min(...years), Math.max(...years)]);
  }, [dataset?.code]);  // only reset range when the country changes

  // ── Filtered data slices (memoized — only recalculate when dataset/range changes) ──
  const { gdp, exp, imp, bal } = useMemo(() => {
    if (!dataset) return { gdp: [], exp: [], imp: [], bal: [] };
    const inRange = <T extends { year: number }>(d: T[]) =>
      d.filter(r => r.year >= yearRange[0] && r.year <= yearRange[1]);
    const filteredExp = inRange(dataset.exportData);
    const impMap = new Map(dataset.importData.map(d => [d.year, d.total]));
    return {
      gdp: inRange(dataset.gdpData),
      exp: filteredExp,
      imp: inRange(dataset.importData),
      bal: filteredExp.map(e => ({
        year: e.year, exports: e.total,
        imports: impMap.get(e.year) ?? 0,
        balance: +(e.total - (impMap.get(e.year) ?? 0)).toFixed(1),
      })),
    };
  }, [dataset, yearRange]);

  // ── Helpers ─────────────────────────────────────────────────────────────────
  const yearMin = dataset?.gdpData[0]?.year ?? 2010;
  const yearMax = dataset?.gdpData[dataset.gdpData.length - 1]?.year ?? 2024;

  function timeAgo(ms: number) {
    const d = Date.now() - ms;
    if (d < 60_000)     return "just now";
    if (d < 3_600_000)  return `${Math.round(d / 60_000)}m ago`;
    if (d < 86_400_000) return `${Math.round(d / 3_600_000)}h ago`;
    return `${Math.round(d / 86_400_000)}d ago`;
  }

  const cachedAgo = dataset?._meta?.cachedAt ? timeAgo(dataset._meta.cachedAt) : null;

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <>
      {/* ── Country selector ─────────────────────────────────────────────── */}
      <div className="mb-5">
        {/* Search bar row */}
        <div className="flex gap-2.5 items-center mb-3.5 flex-wrap">
          <CountrySearchInput token={token} onSelect={onSelectCountry}
            placeholder="Search any country by name…"
            className="flex-[1_1_260px] w-full sm:max-w-[360px]" />

          {/* Year range slider — only shown after data loads */}
          {dataset && (
            <div className="flex items-center gap-2 sm:gap-3 bg-white border-3 border-memphis-black px-2.5 sm:px-3.5 py-2 shrink-0 shadow-hard-sm w-full sm:w-auto">
              <span className="text-[10px] font-black text-memphis-black/60 uppercase tracking-wide">Years</span>
              <span className="text-xs font-black text-memphis-pink tabular-nums">{yearRange[0]}</span>
              <Slider
                min={yearMin} max={yearMax}
                value={yearRange}
                onValueChange={([a, b]) => setYearRange([a, b])}
                className="flex-1 sm:flex-none sm:w-32"
              />
              <span className="text-xs font-black text-memphis-pink tabular-nums">{yearRange[1]}</span>
            </div>
          )}
        </div>

        {/* Popular quick-select */}
        <div className={cn("gap-2", isMobile ? "grid grid-cols-2" : "flex flex-wrap")}>
          {POPULAR_COUNTRIES.map(c => {
            const active = dataset?.code === c.code;
            return (
              <button key={c.code} onClick={() => onSelectCountry(c.code)} disabled={loading}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-2 min-h-11 text-xs transition-snap border-3 font-bold",
                  isMobile ? "w-full justify-start" : ""
                )}
                style={{
                  background:  active ? "#FF006E" : "#FFFFFF",
                  borderColor: "#1A1A2E",
                  color:       active ? "#FFFFFF" : "#1A1A2E",
                  boxShadow:   active ? (isMobile ? "2px 2px 0 #1A1A2E" : "4px 4px 0 #1A1A2E") : "none",
                  cursor:      loading ? "not-allowed" : "pointer",
                }}>
                <span className="text-base">{c.flag}</span>
                <span className={cn("truncate", isMobile ? "max-w-[72px]" : "")}>{isMobile ? c.code : c.name}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Previously fetched history ────────────────────────────────────── */}
      {history.length > 0 && (
        <div className="mb-5">
          <div className="text-[11px] font-black text-memphis-black/60 uppercase tracking-[0.6px] mb-2.5">
            Previously fetched
          </div>
          <div className={cn("gap-2", isMobile ? "grid grid-cols-2" : "flex flex-wrap")}>
            {history.map(h => {
              const isActive = dataset?.code === h.code;
              return (
                <button key={h.code} onClick={() => onSelectCountry(h.code)} disabled={loading}
                  className={cn(
                    "flex flex-col items-start gap-0.5 px-3 py-2 transition-snap border-3 shadow-hard-sm",
                    isMobile ? "w-full min-h-[76px]" : "min-w-[100px] sm:min-w-[120px]"
                  )}
                  style={{
                    background: isActive ? "#FF006E" : "#FFFFFF",
                    borderColor: "#1A1A2E",
                    color: isActive ? "#FFFFFF" : "#1A1A2E",
                    cursor:     loading ? "not-allowed" : "pointer",
                  }}>
                  <span className="text-sm flex items-center gap-1.5">
                    <span className="text-xl">{h.flag}</span>
                    <span className="font-black text-[13px] truncate max-w-[110px]">{isMobile ? h.code : h.name}</span>
                  </span>
                  <span className="text-[10px] opacity-70 truncate w-full">{h.region} · cached {timeAgo(h.cachedAt)}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Loading ───────────────────────────────────────────────────────── */}
      {loading && (
        <div className="text-center py-[60px] text-memphis-black/60">
          <Loader2 className="w-7 h-7 mb-3 mx-auto animate-spin" />
          <div className="text-sm">Fetching data from World Bank…</div>
          <div className="text-xs mt-1.5 text-slate-700">GDP, trade totals + AI-estimated sector breakdown</div>
        </div>
      )}

      {/* ── Error ─────────────────────────────────────────────────────────── */}
      {!loading && error && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription><strong>Failed to load:</strong> {error}</AlertDescription>
        </Alert>
      )}

      {/* ── Empty state ───────────────────────────────────────────────────── */}
      {!loading && !error && !dataset && (
        <div className="text-center py-[60px] text-slate-600">
          <Globe2 className="w-10 h-10 mb-3 mx-auto text-slate-500" />
          <div className="text-base font-bold text-slate-500 mb-2">Select a country to load its data</div>
          <div className="text-[13px] text-slate-700">Real GDP data from World Bank · Cached locally for 7 days</div>
        </div>
      )}

      {/* ── Dataset display ───────────────────────────────────────────────── */}
      {!loading && !error && dataset && (<>

        {/* Provenance + refresh bar */}
        <div className="flex items-center gap-2.5 mb-4 flex-wrap">
          <Badge variant="default">{dataset.flag} {dataset.name} · {dataset.region}</Badge>
          {dataset._meta?.stale && <Badge variant="warning">⚠ Stale cache</Badge>}
          <span className="text-[11px] text-slate-600">{dataset._meta?.sources.join(" · ")}</span>
          <span className="ml-auto text-[11px] text-slate-700">Cached {cachedAgo}</span>
          <Button variant="outline" size="sm" onClick={onRefresh} className="text-xs hover:text-primary hover:border-primary/50">
            <span className="inline-flex items-center gap-1.5"><RefreshCw className="w-3.5 h-3.5" /> Refresh</span>
          </Button>
        </div>

        {/* KPI row */}
        <div className="grid gap-3 mb-4" style={{ gridTemplateColumns: isMobile ? "repeat(2,minmax(0,1fr))" : "repeat(auto-fit,minmax(140px,1fr))" }}>
          {dataset.kpis.map(k => <KPI key={k.label} label={k.label} value={k.value} sub={k.sub} trend={k.trend} color={k.color} />)}
        </div>

        {/* Sub-tab selector */}
          <div className="flex gap-1 mb-1 bg-memphis-offwhite border-3 border-memphis-black p-1 w-full sm:w-fit overflow-x-auto shadow-hard-sm">
            {DASH_TABS.map(t => <Btn key={t} onClick={() => setTab(t)} active={tab === t}>{t}</Btn>)}
          </div>
          {isMobile && <p className="text-[10px] text-memphis-black/50 mb-3">Swipe to switch tabs</p>}

        {/* ── GDP tab ── */}
        {tab === "GDP" && <>
          <Card title={`GDP (Nominal $B)${gdp.some(d => d.digital_pct) ? " vs Digital Economy %" : ""}`}>
            <ResponsiveContainer width="100%" height={isMobile ? 220 : 270}>
              <ComposedChart data={gdp} margin={{ top: 5, right: 30, left: 0, bottom: 5 }}>
                <CartesianGrid {...GRID} />
                <XAxis dataKey="year" tick={AX} />
                <YAxis yAxisId="left" tick={AX} />
                {gdp.some(d => d.digital_pct) && <YAxis yAxisId="right" orientation="right" tick={AX} />}
                <Tooltip {...TT} /><Legend {...LEG} />
                <Bar yAxisId="left" dataKey="gdp_bn" name="GDP ($B)" fill="#00AAFF" opacity={0.75} radius={[3, 3, 0, 0]} />
                {gdp.some(d => d.digital_pct) && (
                  <Line yAxisId="right" type="monotone" dataKey="digital_pct" name="Digital % GDP" stroke="#F97316" strokeWidth={2.5} dot={{ r: 4 }} />
                )}
              </ComposedChart>
            </ResponsiveContainer>
          </Card>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Card title="Real GDP Growth Rate (%)">
              <ResponsiveContainer width="100%" height={isMobile ? 180 : 200}>
                <BarChart data={gdp} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                  <CartesianGrid {...GRID} />
                  <XAxis dataKey="year" tick={AX} /><YAxis tick={AX} />
                  <Tooltip {...TT} />
                  <Bar dataKey="gdp_growth" name="Growth %">
                    {gdp.map((d, i) => <Cell key={i} fill={(d.gdp_growth ?? 0) < 0 ? "#EF4444" : "#10B981"} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </Card>
            <Card title="GDP Per Capita (USD)">
              <ResponsiveContainer width="100%" height={isMobile ? 180 : 200}>
                <AreaChart data={gdp} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                  <CartesianGrid {...GRID} />
                  <XAxis dataKey="year" tick={AX} /><YAxis tick={AX} />
                  <Tooltip {...TT} />
                  <Area type="monotone" dataKey="gdp_per_capita" name="GDP/Capita ($)" stroke="#8B5CF6" fill="#8B5CF622" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            </Card>
          </div>
        </>}

        {/* ── Exports tab ── */}
        {tab === "Exports" && <>
          <Card title="Export Composition by Sector ($B)">
            <ResponsiveContainer width="100%" height={isMobile ? 220 : 270}>
              <BarChart data={exp} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                <CartesianGrid {...GRID} />
                <XAxis dataKey="year" tick={AX} /><YAxis tick={AX} />
                <Tooltip {...TT} /><Legend {...LEG} />
                {dataset.exportSectors.map((s, i, arr) => (
                  <Bar key={s.key} dataKey={s.key} name={s.label} stackId="a" fill={s.color}
                    radius={i === arr.length - 1 ? [3, 3, 0, 0] : [0, 0, 0, 0]} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </Card>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Card title="Export Breakdown (latest year)">
              <ResponsiveContainer width="100%" height={isMobile ? 190 : 220}>
                <PieChart>
                  <Pie data={dataset.pieExports} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={isMobile ? 62 : 80}
                    label={!isMobile ? ({ name, value }: { name: string; value: number }) => `${name}: $${value}B` : false} labelLine={!isMobile}>
                    {dataset.pieExports.map((_, i) => <Cell key={i} fill={P[i % P.length]} />)}
                  </Pie>
                  <Tooltip {...TT} />
                </PieChart>
              </ResponsiveContainer>
            </Card>
            <Card title="Total Exports Over Time ($B)">
              <ResponsiveContainer width="100%" height={isMobile ? 190 : 220}>
                <AreaChart data={exp} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                  <CartesianGrid {...GRID} />
                  <XAxis dataKey="year" tick={AX} /><YAxis tick={AX} />
                  <Tooltip {...TT} />
                  <Area type="monotone" dataKey="total" name="Total Exports ($B)" stroke="#00AAFF" fill="#00AAFF22" strokeWidth={2.5} />
                </AreaChart>
              </ResponsiveContainer>
            </Card>
          </div>
        </>}

        {/* ── Imports tab ── */}
        {tab === "Imports" && <>
          <Card title="Imports by Partner ($B) — Stacked">
            <ResponsiveContainer width="100%" height={isMobile ? 220 : 270}>
              <AreaChart data={imp} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                <CartesianGrid {...GRID} />
                <XAxis dataKey="year" tick={AX} /><YAxis tick={AX} />
                <Tooltip {...TT} /><Legend {...LEG} />
                {dataset.importPartners.map(p => (
                  <Area key={p.key} type="monotone" dataKey={p.key} name={p.label}
                    stackId="a" stroke={p.color} fill={p.color + "55"} strokeWidth={1.5} />
                ))}
              </AreaChart>
            </ResponsiveContainer>
          </Card>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Card title="Top 3 Import Partners ($B)">
              <ResponsiveContainer width="100%" height={isMobile ? 190 : 220}>
                <LineChart data={imp} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                  <CartesianGrid {...GRID} />
                  <XAxis dataKey="year" tick={AX} /><YAxis tick={AX} />
                  <Tooltip {...TT} /><Legend {...LEG} />
                  {dataset.importPartners.filter(p => p.key !== "other").slice(0, 3).map(p => (
                    <Line key={p.key} type="monotone" dataKey={p.key} name={p.label}
                      stroke={p.color} strokeWidth={2.5} dot={{ r: 4 }} />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </Card>
            <Card title="Import Share by Partner (latest year)">
              <ResponsiveContainer width="100%" height={isMobile ? 190 : 220}>
                <PieChart>
                  <Pie data={dataset.pieImports} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={isMobile ? 62 : 80}
                    label={!isMobile ? ({ name, value }: { name: string; value: number }) => `${name}: $${value}B` : false} labelLine={!isMobile}>
                    {dataset.pieImports.map((_, i) => <Cell key={i} fill={P[i % P.length]} />)}
                  </Pie>
                  <Tooltip {...TT} />
                </PieChart>
              </ResponsiveContainer>
            </Card>
          </div>
        </>}

        {/* ── Trade Balance tab ── */}
        {tab === "Trade Balance" && <>
          <Card title="Exports vs Imports vs Trade Balance ($B)">
            <ResponsiveContainer width="100%" height={isMobile ? 220 : 270}>
              <ComposedChart data={bal} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                <CartesianGrid {...GRID} />
                <XAxis dataKey="year" tick={AX} /><YAxis tick={AX} />
                <Tooltip {...TT} /><Legend {...LEG} />
                <Bar dataKey="exports" name="Exports ($B)" fill="#00AAFF" opacity={0.8} radius={[3, 3, 0, 0]} />
                <Bar dataKey="imports" name="Imports ($B)" fill="#EF4444" opacity={0.8} radius={[3, 3, 0, 0]} />
                <Line type="monotone" dataKey="balance" name="Balance ($B)" stroke="#10B981" strokeWidth={2.5} dot={{ r: 4 }} />
              </ComposedChart>
            </ResponsiveContainer>
          </Card>
          <Card title="Annual Trade Surplus / Deficit ($B)">
            <ResponsiveContainer width="100%" height={isMobile ? 180 : 200}>
              <BarChart data={bal} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                <CartesianGrid {...GRID} />
                <XAxis dataKey="year" tick={AX} /><YAxis tick={AX} />
                <Tooltip {...TT} />
                <Bar dataKey="balance" name="Balance ($B)" radius={[3, 3, 0, 0]}>
                  {bal.map((d, i) => <Cell key={i} fill={d.balance >= 0 ? "#10B981" : "#EF4444"} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </Card>
        </>}
      </>)}
    </>
  );
}
