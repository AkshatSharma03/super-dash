// ─────────────────────────────────────────────────────────────────────────────
// KAZAKHSTAN ECONOMIC DATA
// Sources: World Bank, IMF World Economic Outlook, UN Comtrade, stat.gov.kz
// Note: figures are modeled/estimated from published sources; 2024 is projected
// ─────────────────────────────────────────────────────────────────────────────

export const COUNTRY = {
  name: "Kazakhstan",
  code: "KZ",
  flag: "🇰🇿",
  currency: "USD",
  description: "Silicon Steppes Research · GDP · Trade · Imports · Exports · AI Analysis",
};

// ── GDP ───────────────────────────────────────────────────────────────────────
// gdp_bn: nominal GDP in USD billions
// gdp_growth: real GDP growth rate (%)
// gdp_per_capita: nominal GDP per capita (USD)
// digital_pct: digital economy as % of GDP (estimated)
export const GDP_DATA = [
  { year:2010, gdp_bn:148,  gdp_growth: 7.3,  gdp_per_capita: 9070,  digital_pct:1.4 },
  { year:2011, gdp_bn:188,  gdp_growth: 7.5,  gdp_per_capita:11380,  digital_pct:1.6 },
  { year:2012, gdp_bn:208,  gdp_growth: 5.0,  gdp_per_capita:12390,  digital_pct:1.8 },
  { year:2013, gdp_bn:237,  gdp_growth: 6.0,  gdp_per_capita:13890,  digital_pct:2.0 },
  { year:2014, gdp_bn:222,  gdp_growth: 4.3,  gdp_per_capita:12810,  digital_pct:2.1 },
  { year:2015, gdp_bn:184,  gdp_growth: 1.2,  gdp_per_capita:10510,  digital_pct:2.1 },
  { year:2016, gdp_bn:137,  gdp_growth: 1.1,  gdp_per_capita: 7715,  digital_pct:2.3 },
  { year:2017, gdp_bn:166,  gdp_growth: 4.1,  gdp_per_capita: 9246,  digital_pct:2.5 },
  { year:2018, gdp_bn:179,  gdp_growth: 4.1,  gdp_per_capita: 9814,  digital_pct:2.8 },
  { year:2019, gdp_bn:181,  gdp_growth: 4.5,  gdp_per_capita: 9813,  digital_pct:3.0 },
  { year:2020, gdp_bn:171,  gdp_growth:-2.6,  gdp_per_capita: 9122,  digital_pct:3.3 },
  { year:2021, gdp_bn:197,  gdp_growth: 4.3,  gdp_per_capita:10367,  digital_pct:3.6 },
  { year:2022, gdp_bn:225,  gdp_growth: 3.2,  gdp_per_capita:11735,  digital_pct:3.8 },
  { year:2023, gdp_bn:261,  gdp_growth: 5.1,  gdp_per_capita:13480,  digital_pct:4.0 },
  { year:2024, gdp_bn:278,  gdp_growth: 4.8,  gdp_per_capita:14200,  digital_pct:4.2 },
];

// ── EXPORTS ───────────────────────────────────────────────────────────────────
// All values in USD billions
export const EXPORTS_DATA = [
  { year:2010, total:60.3, oil_gas:43.2, metals:8.1,  chemicals:1.8, machinery:0.9, agriculture:2.1, other:4.2 },
  { year:2012, total:86.9, oil_gas:62.4, metals:9.5,  chemicals:2.4, machinery:1.2, agriculture:3.1, other:8.3 },
  { year:2014, total:79.5, oil_gas:56.3, metals:9.6,  chemicals:2.3, machinery:1.2, agriculture:3.0, other:7.1 },
  { year:2016, total:36.7, oil_gas:23.1, metals:6.2,  chemicals:1.6, machinery:0.9, agriculture:2.1, other:2.8 },
  { year:2018, total:61.1, oil_gas:42.8, metals:8.7,  chemicals:2.2, machinery:1.1, agriculture:2.9, other:3.4 },
  { year:2020, total:48.4, oil_gas:30.6, metals:8.0,  chemicals:2.0, machinery:1.1, agriculture:3.2, other:3.5 },
  { year:2022, total:84.4, oil_gas:60.3, metals:10.2, chemicals:2.5, machinery:1.4, agriculture:4.1, other:5.9 },
  { year:2024, total:82.0, oil_gas:56.0, metals:12.0, chemicals:3.0, machinery:1.8, agriculture:5.0, other:4.2 },
];

// ── IMPORTS ───────────────────────────────────────────────────────────────────
// All values in USD billions, broken down by partner country/region
export const IMPORTS_DATA = [
  { year:2010, total:31.1, china: 7.2, russia:10.4, eu:6.8, us:1.2, turkey:1.3, uk:0.9, other:3.3 },
  { year:2012, total:46.4, china:10.5, russia:14.2, eu:9.3, us:1.8, turkey:2.0, uk:1.3, other:7.3 },
  { year:2014, total:41.3, china:10.6, russia:12.9, eu:8.5, us:1.7, turkey:2.0, uk:1.2, other:4.4 },
  { year:2016, total:25.4, china: 7.8, russia: 8.1, eu:5.0, us:1.0, turkey:1.2, uk:0.7, other:1.6 },
  { year:2018, total:33.7, china: 9.8, russia:10.5, eu:6.4, us:1.3, turkey:1.7, uk:1.0, other:3.0 },
  { year:2020, total:31.7, china:10.6, russia: 9.8, eu:5.5, us:1.2, turkey:1.6, uk:0.9, other:2.1 },
  { year:2022, total:44.5, china:16.2, russia:10.8, eu:7.5, us:1.6, turkey:2.8, uk:1.2, other:4.4 },
  { year:2024, total:51.0, china:20.0, russia: 9.8, eu:8.5, us:1.9, turkey:3.3, uk:1.4, other:6.1 },
];

// ── DERIVED: TRADE BALANCE ────────────────────────────────────────────────────
export const TRADE_BALANCE = EXPORTS_DATA.map((e, i) => ({
  year:    e.year,
  exports: e.total,
  imports: IMPORTS_DATA[i].total,
  balance: +(e.total - IMPORTS_DATA[i].total).toFixed(1),
}));

// ── PIE BREAKDOWNS (most recent year) ─────────────────────────────────────────
export const PIE_EXPORTS_2024 = [
  { name:"Oil & Gas",   value:56   },
  { name:"Metals",      value:12   },
  { name:"Agriculture", value: 5   },
  { name:"Chemicals",   value: 3   },
  { name:"Machinery",   value: 1.8 },
  { name:"Other",       value: 4.2 },
];

export const PIE_IMPORTS_2024 = [
  { name:"China",  value:20   },
  { name:"Russia", value: 9.8 },
  { name:"EU",     value: 8.5 },
  { name:"Turkey", value: 3.3 },
  { name:"US",     value: 1.9 },
  { name:"UK",     value: 1.4 },
  { name:"Other",  value: 6.1 },
];

// ── KPI SUMMARY (headline cards) ──────────────────────────────────────────────
export const KPI_SUMMARY = [
  { label:"GDP 2024",      value:"$278B",  sub:"Nominal USD",       trend:"+$17B YoY",      color:"#00AAFF" },
  { label:"GDP Growth",    value:"4.8%",   sub:"Real 2024",          trend:"↑ Accelerating", color:"#10B981" },
  { label:"GDP/Capita",    value:"$14.2K", sub:"2024 estimate",      trend:"+5.3% YoY",      color:"#8B5CF6" },
  { label:"Total Exports", value:"$82B",   sub:"2024",               trend:"+3.7% YoY",      color:"#F59E0B" },
  { label:"Total Imports", value:"$51B",   sub:"2024",               trend:"+6.0% YoY",      color:"#EF4444" },
  { label:"Trade Surplus", value:"+$31B",  sub:"2024",               trend:"↑ Oil-driven",   color:"#06B6D4" },
  { label:"Digital GDP%",  value:"4.2%",   sub:"of total GDP",       trend:"+0.2pp YoY",     color:"#F97316" },
  { label:"#1 Importer",   value:"China",  sub:"$20B · 39% share",   trend:null,             color:"#EF4444" },
];

// ── AI CHAT SUGGESTIONS ───────────────────────────────────────────────────────
export const CHAT_SUGGESTIONS = [
  "Show Kazakhstan's GDP growth vs oil prices 2010–2024",
  "Compare imports from China, Russia and EU over time",
  "What are Kazakhstan's top export sectors?",
  "How has China's import share grown vs Russia's decline?",
  "Show Kazakhstan's digital economy trajectory",
  "Analyze Central Asia economic competitiveness",
  "Trade balance surplus trend and drivers",
  "Kazakhstan AI governance and tech investment outlook",
];

// ── WEB SEARCH SUGGESTIONS ────────────────────────────────────────────────────
export const SEARCH_SUGGESTIONS = [
  "Kazakhstan GDP growth forecast 2025",
  "Kazakhstan oil and gas exports latest data",
  "Foreign direct investment Kazakhstan 2024",
  "China Kazakhstan trade relationship growth",
  "Kazakhstan inflation and interest rate policy",
  "Kazakhstan digital economy and fintech sector",
  "Central Asia Belt and Road Initiative economic impact",
  "Kazakhstan sovereign wealth fund and capital markets",
];
