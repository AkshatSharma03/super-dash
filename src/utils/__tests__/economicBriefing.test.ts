import { describe, expect, it } from "vitest";
import type { CountryDataset } from "@/types";
import { buildEconomicBriefing } from "../economicBriefing";

function sampleDataset(overrides: Partial<CountryDataset> = {}): CountryDataset {
  return {
    code: "US",
    name: "United States of America",
    flag: "🇺🇸",
    region: "North America",
    gdpData: [
      { year: 2023, gdp_bn: 27720, gdp_growth: 2.9, gdp_per_capita: 82000 },
      { year: 2024, gdp_bn: 29298, gdp_growth: 2.8, gdp_per_capita: 86170 },
    ],
    exportData: [{ year: 2024, total: 3215.4 }],
    importData: [{ year: 2024, total: 4113.8 }],
    exportSectors: [{ key: "manuf", label: "Manufactures", color: "#2563eb" }],
    importPartners: [{ key: "chn", label: "China", color: "#dc2626" }],
    kpis: [],
    pieExports: [
      { name: "manuf", value: 1064 },
      { name: "services", value: 900 },
      { name: "fuel", value: 500 },
    ],
    pieImports: [
      { name: "manuf", value: 1349 },
      { name: "services", value: 850 },
      { name: "fuel", value: 430 },
    ],
    _meta: {
      sources: ["World Bank", "World Integrated Trade Solution (WITS)"],
      cachedAt: Date.UTC(2026, 6, 8),
    },
    ...overrides,
  };
}

describe("buildEconomicBriefing", () => {
  it("builds source-backed signals from GDP, trade, and WITS composition", () => {
    const briefing = buildEconomicBriefing(sampleDataset());

    expect(briefing.headline).toContain("United States of America");
    expect(briefing.headline).toContain("$29,298B GDP");
    expect(briefing.quality.score).toBe(100);
    expect(briefing.sourceNotes[0]).toContain("World Integrated Trade Solution (WITS)");
    expect(briefing.signals.map((signal) => signal.label)).toEqual([
      "Growth Momentum",
      "External Balance",
      "Trade Openness",
      "Export Concentration",
      "Import Concentration",
      "Data Confidence",
    ]);
    expect(briefing.signals.find((signal) => signal.label === "External Balance")?.value)
      .toBe("$-898.4B");
    expect(briefing.sections.find((section) => section.title === "External Sector")?.points)
      .toContain("WITS sector detail is available for trade composition.");
  });

  it("flags missing policy modules instead of inventing fiscal or labor claims", () => {
    const briefing = buildEconomicBriefing(sampleDataset());

    expect(briefing.sections.find((section) => section.title === "Fiscal, Monetary, And Labor Gaps")?.points)
      .toEqual(expect.arrayContaining([
        "Debt, fiscal balance, inflation, rates, and labor indicators are not yet part of this country payload.",
        "Treat any policy interpretation as incomplete until those source-backed modules are added.",
      ]));
    expect(briefing.risks.map((risk) => risk.label)).toContain("Incomplete policy picture");
  });
});
