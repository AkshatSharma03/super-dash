export interface AlgoMethod {
  id: string;
  name: string;
  shortName: string;
  color: string;
  description: string;
  formula: string;
  parameters: Array<{ name: string; value: string; rationale: string }>;
  assumptions: string[];
  dataQualityNotes: string[];
  paperReference: { title: string; authors: string; year: number; url?: string };
  limitations: string[];
}

export const METHODOLOGY: AlgoMethod[] = [
  {
    id: "regression",
    name: "OLS Linear Regression",
    shortName: "Regression",
    color: "#FF006E",
    description:
      "Ordinary Least Squares regression with 95% prediction intervals. Fits the model y = β₀ + β₁x by minimising the sum of squared residuals, providing a linear trend line through GDP time-series data and extending it forward as a forecast.",
    formula: "\\hat{\\beta} = (X^\\top X)^{-1} X^\\top y \\quad \\hat{y} = X\\hat{\\beta}",
    parameters: [
      {
        name: "Confidence Level",
        value: "95%",
        rationale:
          "Standard for economic forecasting. Uses z ≈ 1.96 for large samples.",
      },
      {
        name: "Prediction Interval",
        value: "\\hat{y} \\pm z_{\\alpha/2} \\cdot s \\sqrt{1 + \\frac{1}{n} + \\frac{(x_0 - \\bar{x})^2}{S_{xx}}}",
        rationale:
          "Wider than a confidence interval because it accounts for both estimation uncertainty and individual observation variance.",
      },
    ],
    assumptions: [
      "Linearity: the relationship between the predictor and response is linear",
      "Independence: residuals are not autocorrelated (often violated in time-series)",
      "Homoscedasticity: constant residual variance across all predicted values",
      "Normality: residuals are approximately normally distributed",
    ],
    dataQualityNotes: [
      "Works best with 15+ data points; results with fewer points have wide prediction intervals",
      "Missing years are excluded from the regression (listwise deletion)",
      "Extrapolation beyond observed data range becomes increasingly unreliable",
    ],
    paperReference: {
      title: "The Application of Electronic Computing to the Calculation of the Inverse of a Matrix",
      authors: "Gauss, C.F. (1809); modern OLS formalisation",
      year: 1809,
    },
    limitations: [
      "Assumes a linear trend — real GDP often has structural breaks",
      "Does not account for autocorrelation in residuals",
      "Forecast uncertainty grows quadratically with distance from observed range",
    ],
  },
  {
    id: "cagr",
    name: "Compound Annual Growth Rate",
    shortName: "CAGR",
    color: "#00D9FF",
    description:
      "Computes the annualised growth rate between two points in time, smoothing out year-to-year volatility. Applied to GDP, exports, imports, and GDP per capita across 5-year rolling windows and the full dataset span.",
    formula: "\\text{CAGR} = \\left(\\frac{V_{\\text{end}}}{V_{\\text{start}}}\\right)^{\\frac{1}{t}} - 1",
    parameters: [
      {
        name: "Window Size",
        value: "5-year rolling",
        rationale:
          "Standard in economic analysis to smooth short-term fluctuations while preserving medium-term trends.",
      },
      {
        name: "Minimum Period Length",
        value: "2 years",
        rationale:
          "CAGR is undefined for single-year periods; partial windows of at least 2 years are accepted.",
      },
    ],
    assumptions: [
      "Growth is approximately exponential between start and end points",
      "No significant structural breaks within the measurement window",
      "Both start and end values are positive and non-zero",
    ],
    dataQualityNotes: [
      "Returns null for periods where start or end data is zero, negative, or missing",
      "Does not capture intra-period volatility — only end-points matter",
      "Partial periods (shorter than 5 years at dataset edges) are included",
    ],
    paperReference: {
      title: "Self-Assessment Guide for Banking Institutions",
      authors: "Various; CAGR is a standard financial metric, not tied to a single paper",
      year: 1900,
    },
    limitations: [
      "Ignores all intermediate data points within the period",
      "Cannot represent negative CAGR when both endpoints are positive but the path dips below zero",
      "Combined with regression, it provides complementary views of trend magnitude",
    ],
  },
  {
    id: "hp",
    name: "Hodrick-Prescott Filter",
    shortName: "HP Filter",
    color: "#FFBE0B",
    description:
      "Decomposes a time series into a smooth long-run trend τ and a cyclical component c = y − τ by solving a penalised least-squares problem. The smoothing parameter λ controls the trade-off between trend smoothness and cycle magnitude.",
    formula: "\\min_{\\tau} \\sum_{t=1}^{T}(y_t - \\tau_t)^2 + \\lambda \\sum_{t=2}^{T-1}[(\\tau_{t+1} - \\tau_t) - (\\tau_t - \\tau_{t-1})]^2",
    parameters: [
      {
        name: "λ (Lambda)",
        value: "100",
        rationale:
          "Hodrick & Prescott (1997) recommend λ = 100 for annual data, 1600 for quarterly, 14400 for monthly.",
      },
    ],
    assumptions: [
      "The cyclical component has zero mean over the long run",
      "The trend is smooth relative to the cycle",
      "No structural breaks in the underlying data-generating process",
    ],
    dataQualityNotes: [
      "Requires at least 4 data points to compute; otherwise, the trend equals the series",
      "Edge effects: the filter is less reliable at the start and end of the sample",
      "Missing years are interpolated linearly before decomposition",
    ],
    paperReference: {
      title:
        "Postwar U.S. Business Cycles: An Empirical Investigation",
      authors: "Hodrick, R.J. & Prescott, E.C.",
      year: 1997,
      url: "https://doi.org/10.1016/S0304-3932(97)00002-7",
    },
    limitations: [
      "End-point bias: recent cycle estimates are unreliable until more data arrives",
      "Does not distinguish between permanent structural breaks and temporary fluctuations",
      "The choice of λ is subjective; different values yield substantially different cycles",
    ],
  },
  {
    id: "correlation",
    name: "Pearson Correlation Matrix",
    shortName: "Correlation",
    color: "#FF006E",
    description:
      "Computes pairwise Pearson correlation coefficients (r) across GDP, GDP growth, GDP per capita, exports, imports, and trade balance. Identifies which economic variables move together and labels each pair by direction and strength.",
    formula: "r_{X,Y} = \\frac{\\sum_{i=1}^{n}(x_i - \\bar{x})(y_i - \\bar{y})}{\\sqrt{\\sum_{i=1}^{n}(x_i - \\bar{x})^2 \\cdot \\sum_{i=1}^{n}(y_i - \\bar{y})^2}}",
    parameters: [
      {
        name: "Strength Thresholds",
        value: "Strong: |r|≥0.7 · Moderate: 0.4–0.7 · Weak: 0.15–0.4 · None: <0.15",
        rationale:
          "Cohen (1988) conventions adapted for macroeconomic time-series data.",
      },
      {
        name: "Minimum Observations",
        value: "3",
        rationale:
          "Pearson r is undefined for fewer than 2 observations; 3 is the minimum for meaningful results.",
      },
    ],
    assumptions: [
      "Linear relationship between variables",
      "Variables are approximately normally distributed",
      "No extreme outliers that would dominate the correlation",
    ],
    dataQualityNotes: [
      "Uses listwise deletion: only years with data for all variables are included",
      "Correlation does not imply causation — spurious correlations are common in macro time-series",
      "Non-stationary series (e.g., nominal GDP) will show near-unit correlations by construction",
    ],
    paperReference: {
      title: "Statistical Methods for Research Workers",
      authors: "Pearson, K.",
      year: 1895,
    },
    limitations: [
      "Only captures linear relationships; nonlinear associations produce low r values",
      "Spurious correlation is common with trending macro variables",
      "The diagonal (self-correlation) is always r = 1 and is excluded from analysis",
    ],
  },
  {
    id: "hhi",
    name: "Herfindahl-Hirschman Index",
    shortName: "HHI",
    color: "#8338EC",
    description:
      "Measures market or trade concentration. For a set of components with shares s₁…sₙ, HHI = Σ(sᵢ%)². Applied to both export sectors and import partners to assess whether a country's trade is diversified or dominated by few categories/countries.",
    formula: "\\text{HHI} = \\sum_{i=1}^{n} (s_i \\times 100)^2",
    parameters: [
      {
        name: "Classification Scale",
        value: "< 1500 Competitive · 1500–2500 Moderate · > 2500 Concentrated",
        rationale:
          "US Department of Justice Horizontal Merger Guidelines (2010).",
      },
      {
        name: "Normalization",
        value: "\\text{HHI}_{norm} = \\frac{HHI/10000 - 1/n}{1 - 1/n}",
        rationale:
          "Removes the effect of the number of components n so that HHI values from different sectors are comparable.",
      },
    ],
    assumptions: [
      "All trade sectors or partners are accounted for (no significant missing categories)",
      "The 'Other' category represents the combined share of all unnamed components",
      "Shares sum to 100% of total trade value",
    ],
    dataQualityNotes: [
      "Sector/partner breakdowns are AI-estimated from published aggregate sources when granular data is unavailable",
      "The 'Other' bucket may contain many small components that look concentrated but are individually diverse",
      "HHI is insensitive to the distribution *within* 'Other'",
    ],
    paperReference: {
      title: "Concentration in the Steel Industry",
      authors: "Herfindahl, O.C. (1950); Hirschman, A.O. (1945)",
      year: 1950,
    },
    limitations: [
      "Does not reveal *which* sectors/partners dominate — only that concentration exists",
      "Sensitive to how 'Other' is defined; a large residual category inflates HHI",
      "Temporal changes in HHI may reflect re-classification rather than real diversification",
    ],
  },
  {
    id: "anomaly",
    name: "Z-Score Anomaly Detection",
    shortName: "Anomaly",
    color: "#FB5607",
    description:
      "Identifies statistical outliers across 6 economic metrics simultaneously. A data point is flagged as anomalous when its z-score (number of standard deviations from the mean) exceeds a threshold. Modified threshold of 1.5 is used to surface economically meaningful events.",
    formula: "z = \\frac{x - \\mu}{\\sigma} \\quad \\text{Anomalous if } |z| > 1.5",
    parameters: [
      {
        name: "Threshold",
        value: "|z| > 1.5 (primary) · 1.9 (strong) · 2.5 (extreme)",
        rationale:
          "1.5 is lower than the conventional 2.0 threshold because economic time-series are typically short (15–30 years) and moderate deviations are policy-relevant.",
      },
      {
        name: "Statistics",
        value: "Sample mean & standard deviation",
        rationale:
          "Uses the full-series mean and standard deviation (not rolling windows) because many macro series have too few data points for reliable rolling statistics.",
      },
    ],
    assumptions: [
      "The underlying distribution is approximately normal",
      "Mean and standard deviation are stable enough to serve as baselines",
      "Structural breaks (e.g., 2020 COVID shock) will register as anomalies — this is intentional",
    ],
    dataQualityNotes: [
      "Missing years for a metric are excluded before computing mean and standard deviation",
      "A metric with fewer than 5 data points is skipped entirely",
      "Anomalies in 2020 are expected for most countries due to the global pandemic",
    ],
    paperReference: {
      title: "On the Criterion that a Given System of Deviations from the Probable in the Case of a Correlated System of Variables is Such That It Can Be Reasonably Supposed to Have Arisen from Random Sampling",
      authors: "Grubbs, F.E. (1969)",
      year: 1969,
    },
    limitations: [
      "Sensitive to the choice of threshold; 1.5 flags more events than 2.0",
      "Assumes stationarity; a trending series will produce many apparent 'anomalies' at the boundaries",
      "Does not distinguish between genuinely anomalous events and regime changes",
    ],
  },
  {
    id: "kmeans",
    name: "K-Means++ Clustering",
    shortName: "K-Means",
    color: "#00F5D4",
    description:
      "Partitions years into k clusters based on economic characteristics (GDP growth, trade volume, etc.) using K-Means++ initialisation for stable, reproducible results. Each cluster is labelled semantically: Expansion, Transition, Contraction, or Recovery.",
    formula: "\\arg\\min_{S} \\sum_{i=1}^{k} \\sum_{x \\in S_i} \\| x - \\mu_i \\|^2",
    parameters: [
      {
        name: "k (Number of Clusters)",
        value: "3",
        rationale:
          "Three clusters typically correspond to expansion, transition, and contraction phases in economic cycles.",
      },
      {
        name: "Initialisation",
        value: "K-Means++ (D²-weighted seeding)",
        rationale:
          "K-Means++ selects initial centroids proportional to their squared distance from existing centroids, avoiding poor local minima.",
      },
      {
        name: "Pre-processing",
        value: "Z-score normalisation",
        rationale:
          "Features are normalised to zero mean and unit variance before clustering so that GDP ($B) and growth (%) contribute equally.",
      },
      {
        name: "Random Seed",
        value: "42 (LCG)",
        rationale:
          "A seeded Linear Congruential Generator ensures reproducible results across runs.",
      },
    ],
    assumptions: [
      "Clusters are roughly spherical in feature space (after normalisation)",
      "The number of clusters k = 3 is a reasonable prior for economic cycle phases",
      "Features are approximately normally distributed after z-score normalisation",
    ],
    dataQualityNotes: [
      "Years with missing GDP or trade data are excluded from clustering",
      "Cluster labels (Expansion, Contraction, etc.) are derived from average GDP growth within each cluster",
      "With very few data points, clusters may not correspond to meaningful economic phases",
    ],
    paperReference: {
      title: "Some Methods for Classification and Analysis of Multivariate Observations",
      authors: "MacQueen, J. (1967); Arthur, D. & Vassilvitskii, S. (K-Means++, 2007)",
      year: 2007,
      url: "https://doi.org/10.1145/1283383.1283494",
    },
    limitations: [
      "Fixed k = 3 may not optimally partition all countries' data",
      "Does not handle overlapping or non-convex clusters",
      "Cluster centroids are in normalised space — direct interpretation in original units requires back-transformation",
    ],
  },
  {
    id: "openness",
    name: "Trade Openness Index",
    shortName: "Openness",
    color: "#8338EC",
    description:
      "Measures economic globalisation as the ratio of total trade (exports + imports) to GDP, expressed as a percentage. Higher values indicate greater integration with the global economy.",
    formula: "\\text{Openness} = \\frac{\\text{Exports} + \\text{Imports}}{\\text{GDP}} \\times 100",
    parameters: [
      {
        name: "Numerator",
        value: "Total exports + Total imports",
        rationale:
          "Standard Sachs-Warner definition of trade openness.",
      },
      {
        name: "Denominator",
        value: "Nominal GDP in current USD",
        rationale:
          "Using nominal values for both numerator and denominator ensures consistency.",
      },
    ],
    assumptions: [
      "Both trade and GDP are measured in the same currency (current USD)",
      "Re-exports are included in trade but may inflate openness for entrepot economies (e.g., Singapore, Hong Kong)",
    ],
    dataQualityNotes: [
      "Openness > 100% is normal for small open economies and does not indicate an error",
      "GDP in current USD may differ from GDP in constant USD; this metric uses current values for both",
    ],
    paperReference: {
      title: "Economic Reform and the Process of Global Integration",
      authors: "Sachs, J.D. & Warner, A.M.",
      year: 1995,
    },
    limitations: [
      "Does not account for trade barriers, tariffs, or non-tariff measures",
      "Geography and country size strongly influence openness — it is not a pure measure of policy",
      "Re-exports can make small economies appear unrealistically open",
    ],
  },
];