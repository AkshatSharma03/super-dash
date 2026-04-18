// Builds a compact, deterministic context string sent to the analytics AI API.
import type { CountryDataset } from "@/types";

function formatGDPLine(entry: CountryDataset["gdpData"][number]) {
  return (
    `${entry.year}: $${entry.gdp_bn}B, ${entry.gdp_growth}%, ` +
    `$${entry.gdp_per_capita?.toLocaleString()}`
  );
}

function formatTradeLine(
  entry: CountryDataset["exportData"][number] |
    CountryDataset["importData"][number],
) {
  return `${entry.year}: $${entry.total}B`;
}

export function buildAnalyticsContext(dataset: CountryDataset | null) {
  if (!dataset) return "";

  return [
    `Country: ${dataset.name} (${dataset.code}), ${dataset.region}`,
    "",
    "GDP (year, $B, growth%, GDP/capita$):",
    ...dataset.gdpData.map(formatGDPLine),
    "",
    "Exports ($B by year):",
    ...dataset.exportData.map(formatTradeLine),
    "",
    "Imports ($B by year):",
    ...dataset.importData.map(formatTradeLine),
    "",
    `Export sectors: ${dataset.exportSectors.map((s) => s.label).join(", ")}`,
    `Import partners: ${dataset.importPartners.map((s) => s.label).join(", ")}`,
  ].join("\n");
}
