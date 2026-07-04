export type ReportAudience = "consultant" | "analyst" | "policymaker";

export interface ReportProfile {
  id: ReportAudience;
  label: string;
  headline: string;
  description: string;
  primaryQuestions: string[];
  recommendedSections: string[];
  evidenceStandard: string;
}

export const REPORT_PROFILES: ReportProfile[] = [
  {
    id: "consultant",
    label: "Consultant Brief",
    headline: "Client-ready market and country narrative",
    description:
      "Frames the data as a concise executive briefing with implications, risks, and follow-up questions for client teams.",
    primaryQuestions: [
      "What changed, and why does it matter to the client?",
      "Which risks or opportunities need executive attention?",
      "What evidence should be validated before a recommendation?",
    ],
    recommendedSections: [
      "Executive summary",
      "Market signal dashboard",
      "Risks and watch items",
      "Client-ready appendix",
    ],
    evidenceStandard:
      "Separate observations from recommendations and keep every numeric claim traceable to a source table.",
  },
  {
    id: "analyst",
    label: "Data Analyst Pack",
    headline: "Reproducible data, formulas, and caveats",
    description:
      "Prioritizes provenance, definitions, coverage, and calculation notes so analysts can audit or extend the work.",
    primaryQuestions: [
      "Which rows, indicators, and years support the conclusion?",
      "Where are data gaps, revisions, or source limitations?",
      "Which calculations can be reproduced from exported tables?",
    ],
    recommendedSections: [
      "Data coverage ledger",
      "Formula notes",
      "Source-backed tables",
      "Methodology and limitations",
    ],
    evidenceStandard:
      "Show formulas, source freshness, and missing-value behavior before interpretation.",
  },
  {
    id: "policymaker",
    label: "Policy Memo",
    headline: "Decision context, tradeoffs, and public-sector caveats",
    description:
      "Organizes the same data into policy-relevant signals, constraints, and transparent limitations.",
    primaryQuestions: [
      "What policy problem or tradeoff does the data illuminate?",
      "Which affected sectors or macro channels need monitoring?",
      "What cannot be concluded from the available data alone?",
    ],
    recommendedSections: [
      "Policy context",
      "Macroeconomic signal summary",
      "Tradeoffs and constraints",
      "Evidence gaps",
    ],
    evidenceStandard:
      "State uncertainty and avoid causal claims unless the report includes evidence designed for causal inference.",
  },
];

export const DEFAULT_REPORT_PROFILE = REPORT_PROFILES[0];
export const DEFAULT_REPORT_AUDIENCE: ReportAudience = DEFAULT_REPORT_PROFILE.id;

export const REPORT_GROUNDING_STANDARDS = [
  "Use source-backed table values for numeric claims; do not invent or impute missing values.",
  "Show data freshness, source names, and coverage before interpretation.",
  "Separate descriptive facts from recommendations, assumptions, and limitations.",
  "Display formulas for derived metrics such as trade balance and trade openness.",
  "Flag evidence gaps so readers know what requires external validation.",
];

export function getReportProfile(id?: string | null): ReportProfile {
  return REPORT_PROFILES.find((profile) => profile.id === id) ?? DEFAULT_REPORT_PROFILE;
}
