// ─────────────────────────────────────────────────────────────────────────────
// DASHBOARD MODE  —  pre-built static charts with year-range filtering.
// Four sub-tabs: GDP, Exports, Imports, Trade Balance.
// Data comes from /data/kazakhstan.ts; charts use shared Recharts constants.
// ─────────────────────────────────────────────────────────────────────────────
import { useState } from "react";
import {
  ComposedChart, Bar, Line, BarChart, AreaChart, Area,
  PieChart, Pie, Cell, LineChart, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import {
  GDP_DATA, EXPORTS_DATA, IMPORTS_DATA, TRADE_BALANCE,
  PIE_EXPORTS_2024, PIE_IMPORTS_2024, KPI_SUMMARY,
  type GDPEntry, type ExportEntry, type ImportEntry, type TradeBalanceEntry,
} from "../../data/kazakhstan";
import { TT, GRID, AX, LEG, P, C } from "../../config/styles";
import { Btn, KPI, Card } from "../ui";

// Sub-tab definitions — kept local since DashboardMode is the only consumer.
const DASH_TABS = ["GDP", "Exports", "Imports", "Trade Balance"] as const;
type DashTab = typeof DASH_TABS[number];

// Sector breakdown for the Exports stacked bar chart.
// [dataKey, displayName, fillColor]
const EXPORT_SECTORS: [string, string, string][] = [
  ["oil_gas",     "Oil & Gas",    "#F59E0B"],
  ["metals",      "Metals",       "#94a3b8"],
  ["agriculture", "Agriculture",  "#10B981"],
  ["chemicals",   "Chemicals",    "#8B5CF6"],
  ["machinery",   "Machinery",    "#06B6D4"],
  ["other",       "Other",        "#64748b"],
];

// Partner breakdown for the Imports stacked area chart.
const IMPORT_PARTNERS: [string, string, string][] = [
  ["china",  "China",  C.cn], ["russia", "Russia", C.ru],
  ["eu",     "EU",     C.eu], ["turkey", "Turkey", C.tr],
  ["us",     "US",     C.us], ["uk",     "UK",     C.uk],
  ["other",  "Other",  C.other],
];

interface Props {
  yearRange: [number, number];
  setYearRange: (r: [number, number]) => void;
}

export default function DashboardMode({ yearRange, setYearRange: _setYearRange }: Props) {
  const [tab, setTab] = useState<DashTab>("GDP");

  // Filter any dataset to the selected year window.
  const yr = <T extends { year: number }>(d: T[]) =>
    d.filter(r => r.year >= yearRange[0] && r.year <= yearRange[1]);

  const gdp: GDPEntry[]          = yr(GDP_DATA);
  const exp: ExportEntry[]       = yr(EXPORTS_DATA);
  const imp: ImportEntry[]       = yr(IMPORTS_DATA);
  const bal: TradeBalanceEntry[] = yr(TRADE_BALANCE);

  return (
    <>
      {/* ── KPI summary row ── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))", gap: 12, marginBottom: 18 }}>
        {KPI_SUMMARY.map(k => (
          <KPI key={k.label} label={k.label} value={k.value} sub={k.sub} trend={k.trend} color={k.color} />
        ))}
      </div>

      {/* ── Sub-tab selector ── */}
      <div style={{ display: "flex", gap: 4, marginBottom: 18, background: "#1e2130", borderRadius: 10, padding: 4, width: "fit-content" }}>
        {DASH_TABS.map(t => <Btn key={t} onClick={() => setTab(t)} active={tab === t} style={{ fontSize: 12 }}>{t}</Btn>)}
      </div>

      {/* ── GDP tab ── */}
      {tab === "GDP" && <>
        <Card title="GDP (Nominal $B) vs Digital Economy Share (%)">
          <ResponsiveContainer width="100%" height={270}>
            <ComposedChart data={gdp} margin={{ top: 5, right: 30, left: 0, bottom: 5 }}>
              <CartesianGrid {...GRID} />
              <XAxis dataKey="year" tick={AX} />
              <YAxis yAxisId="left" tick={AX} />
              <YAxis yAxisId="right" orientation="right" tick={AX} />
              <Tooltip {...TT} /><Legend {...LEG} />
              <Bar yAxisId="left" dataKey="gdp_bn" name="GDP ($B)" fill="#00AAFF" opacity={0.75} radius={[3, 3, 0, 0]} />
              <Line yAxisId="right" type="monotone" dataKey="digital_pct" name="Digital % GDP" stroke="#F97316" strokeWidth={2.5} dot={{ r: 4 }} />
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
                {/* Cell colors: red for negative growth, green for positive */}
                <Bar dataKey="gdp_growth" name="Growth %">
                  {gdp.map((d, i) => <Cell key={i} fill={d.gdp_growth < 0 ? "#EF4444" : "#10B981"} />)}
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
              {EXPORT_SECTORS.map(([k, n, c], i, arr) => (
                <Bar key={k} dataKey={k} name={n} stackId="a" fill={c}
                  radius={i === arr.length - 1 ? [3, 3, 0, 0] : [0, 0, 0, 0]} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </Card>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18 }}>
          <Card title="2024 Export Breakdown">
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie data={PIE_EXPORTS_2024} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80}
                  label={({ name, value }: { name: string; value: number }) => `${name}: $${value}B`} labelLine>
                  {PIE_EXPORTS_2024.map((_e, i) => <Cell key={i} fill={P[i % P.length]} />)}
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
              {IMPORT_PARTNERS.map(([k, n, c]) => (
                <Area key={k} type="monotone" dataKey={k} name={n}
                  stackId="a" stroke={c} fill={c + "55"} strokeWidth={1.5} />
              ))}
            </AreaChart>
          </ResponsiveContainer>
        </Card>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18 }}>
          <Card title="China vs Russia vs EU ($B)">
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={imp} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                <CartesianGrid {...GRID} />
                <XAxis dataKey="year" tick={AX} /><YAxis tick={AX} />
                <Tooltip {...TT} /><Legend {...LEG} />
                <Line type="monotone" dataKey="china"  name="China"  stroke={C.cn} strokeWidth={2.5} dot={{ r: 4 }} />
                <Line type="monotone" dataKey="russia" name="Russia" stroke={C.ru} strokeWidth={2.5} dot={{ r: 4 }} />
                <Line type="monotone" dataKey="eu"     name="EU"     stroke={C.eu} strokeWidth={2.5} dot={{ r: 4 }} />
              </LineChart>
            </ResponsiveContainer>
          </Card>
          <Card title="2024 Import Share by Partner">
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie data={PIE_IMPORTS_2024} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80}
                  label={({ name, value }: { name: string; value: number }) => `${name}: $${value}B`} labelLine>
                  {PIE_IMPORTS_2024.map((_e, i) => <Cell key={i} fill={P[i % P.length]} />)}
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
              {/* Cell colors: green for surplus, red for deficit */}
              <Bar dataKey="balance" name="Balance ($B)" radius={[3, 3, 0, 0]}>
                {bal.map((d, i) => <Cell key={i} fill={d.balance >= 0 ? "#10B981" : "#EF4444"} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Card>
      </>}
    </>
  );
}
