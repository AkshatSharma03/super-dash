// ─────────────────────────────────────────────────────────────────────────────
// DASHBOARD MODE  —  multi-country economic data viewer.
//
// Country fetch state lives in App.tsx so fetches survive tab switches.
// This component owns only UI-local state: year range, search, tab, history.
// ─────────────────────────────────────────────────────────────────────────────
import { useState, useEffect, useRef } from "react";
import {
  ComposedChart, Bar, Line, BarChart, AreaChart, Area,
  PieChart, Pie, Cell, LineChart, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import type { CountryDataset, CountrySearchResult, CountryHistoryEntry } from "../../types";
import { searchCountries, getCountryHistory } from "../../utils/api";
import { TT, GRID, AX, LEG, P } from "../../config/styles";
import { Btn, KPI, Card } from "../ui";

// ── Popular quick-select countries ────────────────────────────────────────────
const POPULAR: CountrySearchResult[] = [
  { code: "KZ", name: "Kazakhstan",    flag: "🇰🇿", region: "Central Asia" },
  { code: "UZ", name: "Uzbekistan",    flag: "🇺🇿", region: "Central Asia" },
  { code: "AZ", name: "Azerbaijan",    flag: "🇦🇿", region: "South Caucasus" },
  { code: "GE", name: "Georgia",       flag: "🇬🇪", region: "South Caucasus" },
  { code: "TR", name: "Turkey",        flag: "🇹🇷", region: "Europe & Central Asia" },
  { code: "DE", name: "Germany",       flag: "🇩🇪", region: "Europe" },
  { code: "US", name: "United States", flag: "🇺🇸", region: "North America" },
  { code: "CN", name: "China",         flag: "🇨🇳", region: "East Asia" },
  { code: "IN", name: "India",         flag: "🇮🇳", region: "South Asia" },
  { code: "BR", name: "Brazil",        flag: "🇧🇷", region: "Latin America" },
  { code: "JP", name: "Japan",         flag: "🇯🇵", region: "East Asia" },
  { code: "KR", name: "South Korea",   flag: "🇰🇷", region: "East Asia" },
];

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
  // ── UI-local state ──────────────────────────────────────────────────────────
  const [tab,          setTab]          = useState<DashTab>("GDP");
  const [yearRange,    setYearRange]    = useState<[number, number]>([2010, 2024]);
  const [query,        setQuery]        = useState("");
  const [results,      setResults]      = useState<CountrySearchResult[]>([]);
  const [searching,    setSearching]    = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [history,      setHistory]      = useState<CountryHistoryEntry[]>([]);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Load fetch history on mount ─────────────────────────────────────────────
  useEffect(() => {
    getCountryHistory(token)
      .then(setHistory)
      .catch(() => { /* silently skip if unavailable */ });
  }, [token]);

  // Refresh history list whenever a new dataset arrives
  useEffect(() => {
    if (!dataset) return;
    getCountryHistory(token)
      .then(setHistory)
      .catch(() => {});
  }, [dataset, token]);

  // ── Adapt year range when a new dataset loads ───────────────────────────────
  useEffect(() => {
    if (!dataset) return;
    const years = dataset.gdpData.map(d => d.year);
    if (years.length) setYearRange([Math.min(...years), Math.max(...years)]);
  }, [dataset?.code]);  // only reset range when the country changes

  // ── Country search (debounced 350 ms) ──────────────────────────────────────
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (query.length < 2) { setResults([]); setShowDropdown(false); return; }
    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const hits = await searchCountries(query, token);
        setResults(hits);
        setShowDropdown(true);
      } catch { /* ignore */ }
      finally { setSearching(false); }
    }, 350);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query, token]);

  // ── Select a country: trigger parent fetch + close search UI ───────────────
  function selectCountry(code: string) {
    setShowDropdown(false);
    setQuery("");
    setResults([]);
    onSelectCountry(code);
  }

  // ── Filtered data slices ────────────────────────────────────────────────────
  const yr = <T extends { year: number }>(d: T[]) =>
    d.filter(r => r.year >= yearRange[0] && r.year <= yearRange[1]);

  const gdp = dataset ? yr(dataset.gdpData)   : [];
  const exp = dataset ? yr(dataset.exportData) : [];
  const imp = dataset ? yr(dataset.importData) : [];
  const bal = dataset
    ? yr(dataset.exportData).map(e => {
        const im = dataset.importData.find(x => x.year === e.year);
        return { year: e.year, exports: e.total, imports: im?.total ?? 0, balance: +(e.total - (im?.total ?? 0)).toFixed(1) };
      })
    : [];

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
      <div style={{ marginBottom: 20 }}>
        {/* Search bar row */}
        <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 14, flexWrap: "wrap" }}>
          <div style={{ position: "relative", flex: "1 1 260px", maxWidth: 360 }}>
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              onFocus={e => { e.currentTarget.style.borderColor = "#00AAFF"; if (query.length >= 2 && results.length) setShowDropdown(true); }}
              onBlur={e => { e.currentTarget.style.borderColor = "#2d3348"; setTimeout(() => setShowDropdown(false), 150); }}
              placeholder="Search any country by name…"
              style={{
                width: "100%", boxSizing: "border-box", background: "#161929",
                border: "1px solid #2d3348", borderRadius: 8, padding: "7px 14px 7px 36px",
                fontSize: 13, color: "#e2e8f0", outline: "none",
              }}
            />
            <span style={{ position: "absolute", left: 11, top: "50%", transform: "translateY(-50%)", fontSize: 14, pointerEvents: "none" }}>
              {searching ? "…" : "🔍"}
            </span>
            {showDropdown && results.length > 0 && (
              <div style={{
                position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0,
                background: "#161929", border: "1px solid #2d3348", borderRadius: 8,
                zIndex: 100, overflow: "hidden",
              }}>
                {results.map(c => (
                  <button key={c.code} onMouseDown={() => selectCountry(c.code)} style={{
                    display: "flex", alignItems: "center", gap: 8, width: "100%",
                    background: "transparent", border: "none", borderBottom: "1px solid #1e2130",
                    padding: "8px 14px", cursor: "pointer", color: "#e2e8f0", fontSize: 13,
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = "#1e2130")}
                  onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
                    <span style={{ fontSize: 18 }}>{c.flag}</span>
                    <span style={{ fontWeight: 600 }}>{c.name}</span>
                    <span style={{ color: "#475569", fontSize: 11, marginLeft: "auto" }}>{c.region}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Year range slider — only shown after data loads */}
          {dataset && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, background: "#161929", border: "1px solid #2d3348", borderRadius: 8, padding: "5px 14px", flexShrink: 0 }}>
              <span style={{ fontSize: 10, color: "#64748b", fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5 }}>Years</span>
              <input type="range" min={yearMin} max={yearMax} value={yearRange[0]}
                onChange={e => setYearRange([Math.min(+e.target.value, yearRange[1]), yearRange[1]])}
                style={{ width: 65, accentColor: "#00AAFF", cursor: "pointer" }} />
              <span style={{ fontSize: 11, color: "#00AAFF", minWidth: 30, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{yearRange[0]}</span>
              <span style={{ fontSize: 11, color: "#2d3348" }}>—</span>
              <input type="range" min={yearMin} max={yearMax} value={yearRange[1]}
                onChange={e => setYearRange([yearRange[0], Math.max(+e.target.value, yearRange[0])])}
                style={{ width: 65, accentColor: "#00AAFF", cursor: "pointer" }} />
              <span style={{ fontSize: 11, color: "#00AAFF", minWidth: 30, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{yearRange[1]}</span>
            </div>
          )}
        </div>

        {/* Popular quick-select */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
          {POPULAR.map(c => (
            <button key={c.code} onClick={() => selectCountry(c.code)} disabled={loading} style={{
              display: "flex", alignItems: "center", gap: 6,
              background: dataset?.code === c.code ? "#00AAFF18" : "#161929",
              border: `1px solid ${dataset?.code === c.code ? "#00AAFF55" : "#2d3348"}`,
              borderRadius: 8, padding: "5px 12px", cursor: loading ? "not-allowed" : "pointer",
              color: dataset?.code === c.code ? "#00AAFF" : "#94a3b8",
              fontSize: 12, fontWeight: dataset?.code === c.code ? 700 : 500, transition: "all .15s",
            }}
            onMouseEnter={e => { if (dataset?.code !== c.code) { e.currentTarget.style.borderColor = "#475569"; e.currentTarget.style.color = "#e2e8f0"; }}}
            onMouseLeave={e => { if (dataset?.code !== c.code) { e.currentTarget.style.borderColor = "#2d3348"; e.currentTarget.style.color = "#94a3b8"; }}}>
              <span style={{ fontSize: 16 }}>{c.flag}</span>
              {c.name}
            </button>
          ))}
        </div>
      </div>

      {/* ── Previously fetched history ────────────────────────────────────── */}
      {history.length > 0 && (
        <div style={{ marginBottom: 22 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: "#475569", textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 10 }}>
            Previously fetched
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {history.map(h => {
              const isActive = dataset?.code === h.code;
              return (
                <button key={h.code} onClick={() => selectCountry(h.code)} disabled={loading} style={{
                  display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 2,
                  background: isActive ? "#00AAFF10" : "#0d1018",
                  border: `1px solid ${isActive ? "#00AAFF44" : "#1e2130"}`,
                  borderRadius: 10, padding: "8px 14px", cursor: loading ? "not-allowed" : "pointer",
                  transition: "all .15s", minWidth: 120,
                }}>
                  <span style={{ fontSize: 14, display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ fontSize: 20 }}>{h.flag}</span>
                    <span style={{ fontWeight: 600, color: isActive ? "#00AAFF" : "#e2e8f0", fontSize: 13 }}>{h.name}</span>
                  </span>
                  <span style={{ fontSize: 10, color: "#334155" }}>{h.region} · cached {timeAgo(h.cachedAt)}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Loading ───────────────────────────────────────────────────────── */}
      {loading && (
        <div style={{ textAlign: "center", padding: "60px 0", color: "#475569" }}>
          <div style={{ fontSize: 28, marginBottom: 12, display: "inline-block", animation: "ecSpin 1.2s linear infinite" }}>⟳</div>
          <div style={{ fontSize: 14 }}>Fetching data from World Bank…</div>
          <div style={{ fontSize: 12, marginTop: 6, color: "#334155" }}>GDP, trade totals + AI-estimated sector breakdown</div>
          <style>{`@keyframes ecSpin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}`}</style>
        </div>
      )}

      {/* ── Error ─────────────────────────────────────────────────────────── */}
      {!loading && error && (
        <div style={{ background: "#EF444415", border: "1px solid #EF444444", borderRadius: 10, padding: "16px 20px", color: "#EF4444", fontSize: 13 }}>
          <strong>Failed to load:</strong> {error}
        </div>
      )}

      {/* ── Empty state ───────────────────────────────────────────────────── */}
      {!loading && !error && !dataset && (
        <div style={{ textAlign: "center", padding: "60px 0", color: "#475569" }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>🌍</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: "#64748b", marginBottom: 8 }}>Select a country to load its data</div>
          <div style={{ fontSize: 13, color: "#334155" }}>Real GDP data from World Bank · Cached locally for 7 days</div>
        </div>
      )}

      {/* ── Dataset display ───────────────────────────────────────────────── */}
      {!loading && !error && dataset && (<>

        {/* Provenance + refresh bar */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
          <span style={{ fontSize: 11, background: "#00AAFF18", color: "#00AAFF", borderRadius: 4, padding: "2px 8px", fontWeight: 700 }}>
            {dataset.flag} {dataset.name} · {dataset.region}
          </span>
          {dataset._meta?.stale && (
            <span style={{ fontSize: 11, background: "#F59E0B18", color: "#F59E0B", borderRadius: 4, padding: "2px 8px", fontWeight: 600 }}>⚠ Stale cache</span>
          )}
          <span style={{ fontSize: 11, color: "#475569" }}>
            {dataset._meta?.sources.join(" · ")}
          </span>
          <span style={{ marginLeft: "auto", fontSize: 11, color: "#334155" }}>Cached {cachedAgo}</span>
          <button onClick={onRefresh} style={{
            background: "transparent", border: "1px solid #2d3348", borderRadius: 6,
            padding: "3px 10px", fontSize: 11, color: "#64748b", cursor: "pointer",
          }}
          onMouseEnter={e => { e.currentTarget.style.color = "#00AAFF"; e.currentTarget.style.borderColor = "#00AAFF55"; }}
          onMouseLeave={e => { e.currentTarget.style.color = "#64748b"; e.currentTarget.style.borderColor = "#2d3348"; }}>
            ↻ Refresh
          </button>
        </div>

        {/* KPI row */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))", gap: 12, marginBottom: 18 }}>
          {dataset.kpis.map(k => <KPI key={k.label} label={k.label} value={k.value} sub={k.sub} trend={k.trend} color={k.color} />)}
        </div>

        {/* Sub-tab selector */}
        <div style={{ display: "flex", gap: 4, marginBottom: 18, background: "#1e2130", borderRadius: 10, padding: 4, width: "fit-content" }}>
          {DASH_TABS.map(t => <Btn key={t} onClick={() => setTab(t)} active={tab === t} style={{ fontSize: 12 }}>{t}</Btn>)}
        </div>

        {/* ── GDP tab ── */}
        {tab === "GDP" && <>
          <Card title={`GDP (Nominal $B)${gdp.some(d => d.digital_pct) ? " vs Digital Economy %" : ""}`}>
            <ResponsiveContainer width="100%" height={270}>
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
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18 }}>
            <Card title="Real GDP Growth Rate (%)">
              <ResponsiveContainer width="100%" height={200}>
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
              <ResponsiveContainer width="100%" height={200}>
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
            <ResponsiveContainer width="100%" height={270}>
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
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18 }}>
            <Card title="Export Breakdown (latest year)">
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie data={dataset.pieExports} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80}
                    label={({ name, value }: { name: string; value: number }) => `${name}: $${value}B`} labelLine>
                    {dataset.pieExports.map((_, i) => <Cell key={i} fill={P[i % P.length]} />)}
                  </Pie>
                  <Tooltip {...TT} />
                </PieChart>
              </ResponsiveContainer>
            </Card>
            <Card title="Total Exports Over Time ($B)">
              <ResponsiveContainer width="100%" height={220}>
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
            <ResponsiveContainer width="100%" height={270}>
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
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18 }}>
            <Card title="Top 3 Import Partners ($B)">
              <ResponsiveContainer width="100%" height={220}>
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
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie data={dataset.pieImports} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80}
                    label={({ name, value }: { name: string; value: number }) => `${name}: $${value}B`} labelLine>
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
            <ResponsiveContainer width="100%" height={270}>
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
            <ResponsiveContainer width="100%" height={200}>
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
