import type { CountryDataset, CountryPieEntry } from "@/types";

export type BriefingTone = "positive" | "neutral" | "warning" | "critical";

export interface BriefingSignal {
  label: string;
  value: string;
  detail: string;
  tone: BriefingTone;
}

export interface BriefingSection {
  title: string;
  points: string[];
}

export interface BriefingRisk {
  label: string;
  detail: string;
  tone: BriefingTone;
}

export interface EconomicBriefing {
  headline: string;
  executiveSummary: string[];
  signals: BriefingSignal[];
  sections: BriefingSection[];
  risks: BriefingRisk[];
  opportunities: BriefingRisk[];
  sourceNotes: string[];
  quality: {
    label: string;
    score: number;
    notes: string[];
  };
}

function money(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "not available";
  return `$${value.toLocaleString()}B`;
}

function pct(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "not available";
  return `${value.toFixed(1)}%`;
}

function signedMoney(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "not available";
  return `${value >= 0 ? "+" : ""}$${value.toLocaleString()}B`;
}

function latest<T>(rows: T[]): T | null {
  return rows.length ? rows[rows.length - 1] : null;
}

function previous<T>(rows: T[]): T | null {
  return rows.length > 1 ? rows[rows.length - 2] : null;
}

function shareHhi(entries: CountryPieEntry[]) {
  const total = entries.reduce((sum, row) => sum + Math.max(row.value, 0), 0);
  if (!total) return null;
  return entries.reduce((sum, row) => {
    const share = (Math.max(row.value, 0) / total) * 100;
    return sum + share * share;
  }, 0);
}

function concentrationLabel(hhi: number | null) {
  if (hhi == null) return { label: "Unavailable", tone: "warning" as const };
  if (hhi >= 2500) return { label: "High concentration", tone: "warning" as const };
  if (hhi >= 1500) return { label: "Moderate concentration", tone: "neutral" as const };
  return { label: "Diversified", tone: "positive" as const };
}

function topShare(entries: CountryPieEntry[]) {
  const total = entries.reduce((sum, row) => sum + Math.max(row.value, 0), 0);
  const top = entries[0];
  if (!top || !total) return null;
  return { name: top.name, share: (top.value / total) * 100, value: top.value };
}

function coverageScore(dataset: CountryDataset) {
  const expected = [
    dataset.gdpData.length > 0,
    dataset.exportData.length > 0,
    dataset.importData.length > 0,
    dataset.exportSectors.length > 0,
    dataset.importPartners.length > 0,
    Boolean(dataset._meta?.sources?.length),
  ];
  const score = Math.round((expected.filter(Boolean).length / expected.length) * 100);
  if (score >= 85) return { label: "High confidence", score };
  if (score >= 65) return { label: "Usable with caveats", score };
  return { label: "Limited evidence", score };
}

function growthTone(value: number | null | undefined): BriefingTone {
  if (value == null || !Number.isFinite(value)) return "warning";
  if (value < 0) return "critical";
  if (value < 1) return "warning";
  if (value >= 3) return "positive";
  return "neutral";
}

export function buildEconomicBriefing(dataset: CountryDataset): EconomicBriefing {
  const latestGdp = latest(dataset.gdpData);
  const prevGdp = previous(dataset.gdpData);
  const latestExports = latest(dataset.exportData);
  const latestImports = latest(dataset.importData);
  const balance =
    latestExports && latestImports
      ? +(latestExports.total - latestImports.total).toFixed(1)
      : null;
  const openness =
    latestGdp && latestExports && latestImports && latestGdp.gdp_bn > 0
      ? +(((latestExports.total + latestImports.total) / latestGdp.gdp_bn) * 100).toFixed(1)
      : null;
  const growthDelta =
    latestGdp?.gdp_growth != null && prevGdp?.gdp_growth != null
      ? +(latestGdp.gdp_growth - prevGdp.gdp_growth).toFixed(1)
      : null;
  const exportHhi = shareHhi(dataset.pieExports);
  const importHhi = shareHhi(dataset.pieImports);
  const exportConcentration = concentrationLabel(exportHhi);
  const importConcentration = concentrationLabel(importHhi);
  const topExport = topShare(dataset.pieExports);
  const topImport = topShare(dataset.pieImports);
  const quality = coverageScore(dataset);
  const sources = dataset._meta?.sources?.length ? dataset._meta.sources : ["World Bank"];
  const year = latestGdp?.year ?? latestExports?.year ?? latestImports?.year ?? "latest available year";

  const balanceTone: BriefingTone =
    balance == null ? "warning" : balance >= 0 ? "positive" : "warning";
  const opennessTone: BriefingTone =
    openness == null ? "warning" : openness >= 90 ? "warning" : openness >= 45 ? "neutral" : "positive";

  const headline = `${dataset.name}: ${latestGdp ? `${pct(latestGdp.gdp_growth)} growth, ${money(latestGdp.gdp_bn)} GDP` : "country briefing"} with ${balance == null ? "trade balance under review" : `${signedMoney(balance)} trade balance`}`;

  const executiveSummary = [
    `${dataset.name}'s latest source-backed GDP is ${latestGdp ? `${money(latestGdp.gdp_bn)} in ${latestGdp.year}` : "not available in the current dataset"}.`,
    latestGdp?.gdp_growth != null
      ? `Growth is ${pct(latestGdp.gdp_growth)}${growthDelta == null ? "" : `, ${growthDelta >= 0 ? "up" : "down"} ${Math.abs(growthDelta).toFixed(1)} percentage points from the previous observation`}.`
      : "Growth momentum needs source review because the latest growth row is missing.",
    `External position: exports are ${money(latestExports?.total)}, imports are ${money(latestImports?.total)}, and the trade balance is ${signedMoney(balance)}.`,
  ];

  const signals: BriefingSignal[] = [
    {
      label: "Growth Momentum",
      value: latestGdp?.gdp_growth == null ? "Review" : pct(latestGdp.gdp_growth),
      detail: growthDelta == null ? `Latest observation: ${year}` : `${growthDelta >= 0 ? "Improved" : "Weakened"} by ${Math.abs(growthDelta).toFixed(1)} pp versus prior year.`,
      tone: growthTone(latestGdp?.gdp_growth),
    },
    {
      label: "External Balance",
      value: signedMoney(balance),
      detail: latestExports && latestImports ? `Exports ${money(latestExports.total)} vs imports ${money(latestImports.total)}.` : "Trade totals are incomplete.",
      tone: balanceTone,
    },
    {
      label: "Trade Openness",
      value: pct(openness),
      detail: openness == null ? "Requires GDP plus trade totals." : "Exports plus imports as a share of nominal GDP.",
      tone: opennessTone,
    },
    {
      label: "Export Concentration",
      value: exportConcentration.label,
      detail: topExport ? `${topExport.name} is ${pct(topExport.share)} of the shown export basket.` : "WITS export composition unavailable.",
      tone: exportConcentration.tone,
    },
    {
      label: "Import Concentration",
      value: importConcentration.label,
      detail: topImport ? `${topImport.name} is ${pct(topImport.share)} of the shown import basket.` : "WITS import composition unavailable.",
      tone: importConcentration.tone,
    },
    {
      label: "Data Confidence",
      value: quality.label,
      detail: `${quality.score}% of core country briefing modules are populated.`,
      tone: quality.score >= 85 ? "positive" : quality.score >= 65 ? "neutral" : "warning",
    },
  ];

  const sections: BriefingSection[] = [
    {
      title: "Growth And Income",
      points: [
        latestGdp ? `Nominal GDP is ${money(latestGdp.gdp_bn)} and GDP per capita is $${latestGdp.gdp_per_capita.toLocaleString()} in ${latestGdp.year}.` : "GDP and income rows are not available.",
        latestGdp?.gdp_growth != null ? `Real GDP growth is ${pct(latestGdp.gdp_growth)} in the latest observation.` : "Real GDP growth is missing.",
        "Use Advanced Analysis for trend, anomaly, clustering, and regression checks before making causal claims.",
      ],
    },
    {
      title: "External Sector",
      points: [
        `Exports: ${money(latestExports?.total)}; imports: ${money(latestImports?.total)}; balance: ${signedMoney(balance)}.`,
        openness == null ? "Trade openness could not be computed." : `Trade openness is ${pct(openness)}, measuring trade intensity relative to GDP.`,
        sources.includes("World Integrated Trade Solution (WITS)") ? "WITS sector detail is available for trade composition." : "WITS sector detail is not available for this country/year.",
      ],
    },
    {
      title: "Fiscal, Monetary, And Labor Gaps",
      points: [
        "Debt, fiscal balance, inflation, rates, and labor indicators are not yet part of this country payload.",
        "Treat any policy interpretation as incomplete until those source-backed modules are added.",
        "Recommended next source layer: IMF WEO/Article IV, World Bank WDI inflation/unemployment, central bank rates, and national statistics releases.",
      ],
    },
  ];

  const risks: BriefingRisk[] = [
    {
      label: "Single-basket exposure",
      detail: topExport ? `${topExport.name} dominates the visible export basket at ${pct(topExport.share)}.` : "Export sector concentration cannot be assessed without WITS composition.",
      tone: exportConcentration.tone,
    },
    {
      label: "External deficit pressure",
      detail: balance == null ? "Trade balance unavailable." : balance < 0 ? `Imports exceed exports by ${money(Math.abs(balance))}.` : `Trade balance is positive at ${signedMoney(balance)}.`,
      tone: balance == null ? "warning" : balance < 0 ? "warning" : "positive",
    },
    {
      label: "Incomplete policy picture",
      detail: "Fiscal, monetary, inflation, and labor modules are not yet loaded into this briefing.",
      tone: "warning",
    },
  ];

  const opportunities: BriefingRisk[] = [
    {
      label: "Peer benchmarking",
      detail: "Use the peer module to rank GDP, growth, per-capita income, exports, imports, and openness against comparable countries.",
      tone: "positive",
    },
    {
      label: "Trade diversification analysis",
      detail: sources.includes("World Integrated Trade Solution (WITS)")
        ? "WITS composition supports concentration and sector mix analysis."
        : "Add WITS coverage for sector mix analysis.",
      tone: sources.includes("World Integrated Trade Solution (WITS)") ? "positive" : "neutral",
    },
    {
      label: "Report-ready export",
      detail: "The briefing can be exported with tables, charts, source notes, and methodology caveats.",
      tone: "positive",
    },
  ];

  const sourceNotes = [
    `Sources used: ${sources.join(" · ")}.`,
    dataset._meta?.cachedAt ? `Dataset cached at ${new Date(dataset._meta.cachedAt).toLocaleString()}.` : "Cache timestamp unavailable.",
    dataset._meta?.stale ? "This payload is marked stale and should be refreshed before publication." : "Payload is not marked stale.",
  ];

  return {
    headline,
    executiveSummary,
    signals,
    sections,
    risks,
    opportunities,
    sourceNotes,
    quality: {
      ...quality,
      notes: [
        sources.includes("World Integrated Trade Solution (WITS)") ? "WITS trade composition available." : "WITS trade composition missing.",
        "Numeric claims are derived from country payload tables only.",
        "Policy modules are intentionally flagged when missing.",
      ],
    },
  };
}
