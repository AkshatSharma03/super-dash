import type { CountrySearchResult } from "../types";

// Countries shown as quick-select buttons in DashboardMode and AnalyticsMode
export const POPULAR_COUNTRIES: CountrySearchResult[] = [
  { code: "US", name: "United States",  flag: "🇺🇸", region: "North America" },
  { code: "CN", name: "China",          flag: "🇨🇳", region: "East Asia" },
  { code: "DE", name: "Germany",        flag: "🇩🇪", region: "Europe" },
  { code: "JP", name: "Japan",          flag: "🇯🇵", region: "East Asia" },
  { code: "GB", name: "United Kingdom", flag: "🇬🇧", region: "Europe" },
  { code: "FR", name: "France",         flag: "🇫🇷", region: "Europe" },
  { code: "IN", name: "India",          flag: "🇮🇳", region: "South Asia" },
  { code: "BR", name: "Brazil",         flag: "🇧🇷", region: "Latin America" },
  { code: "CA", name: "Canada",         flag: "🇨🇦", region: "North America" },
  { code: "KR", name: "South Korea",    flag: "🇰🇷", region: "East Asia" },
  { code: "AU", name: "Australia",      flag: "🇦🇺", region: "Oceania" },
  { code: "SG", name: "Singapore",      flag: "🇸🇬", region: "Southeast Asia" },
];

export const CHAT_SUGGESTIONS: string[] = [
  "Compare US, China and EU GDP growth over the last decade",
  "Show China's trade balance with the US 2010–2024",
  "How has the EU's export composition shifted since 2015?",
  "Compare inflation trends across G7 economies",
  "What drives the US trade deficit with China?",
  "Analyze Japan vs South Korea export competitiveness",
  "Show India's GDP per capita growth vs China",
  "Which economies have the highest trade openness ratio?",
];

export const SEARCH_SUGGESTIONS: string[] = [
  "US GDP growth forecast 2025",
  "China exports and trade surplus latest data",
  "EU foreign direct investment trends 2024",
  "US China trade war tariffs economic impact",
  "Federal Reserve interest rate policy outlook",
  "India economic growth and manufacturing boom",
  "G7 inflation and monetary policy comparison",
  "Global supply chain shifts and nearshoring trends",
];
