# SuperDash — Economic Intelligence Dashboard

> A full-stack economic research platform: AI-driven visualisation, eight economics/statistics algorithms, live country data, and a modular Express backend. Mobile-responsive.

---

## ✨ Feature Overview

| Mode | Description |
|------|-------------|
| 💬 **AI Chat** | Conversational interface — Claude generates interactive Recharts visualisations and expert analysis from any natural-language prompt. Persistent session history. |
| 🔍 **Search** | Live web research via **Kagi FastGPT** with source citations and follow-up context support. Trie-powered O(m) autocomplete. |
| 📁 **Data Upload** | Drag-and-drop any CSV → auto-parsed → Claude generates tailored charts and insights for your own dataset. |
| 🧮 **Analytics** | Eight-algorithm panel (regression, CAGR, HP filter, correlation, HHI, anomaly, K-Means, trade openness) on live data for any country. |
| 🌍 **Country Data** | Real GDP and trade data from the World Bank for any country — cached locally, with dual-handle year-range filtering and sector-level breakdowns. |
| 📤 **Export** | Download data as CSV or JSON, copy summaries to clipboard, and generate standalone HTML reports with embedded SVG charts. Print to PDF via the browser. |

---

## 🧠 Algorithms — Economics & Statistics

Core statistical routines are implemented with established libraries (`simple-statistics`, `ml-kmeans`) and wrapped in transparent, domain-specific analytics modules.

### 1 · OLS Linear Regression + Forecast (`src/algorithms/regression.ts`)
- Fits a linear trend using library-backed OLS
- Computes R², RSE, and a **95% prediction interval** (CI band) for multi-year forecasts
- Overlays actual GDP bars against the OLS trend line and a shaded uncertainty cone

### 2 · CAGR Analysis (`src/algorithms/cagr.ts`)
- Computes **Compound Annual Growth Rate** across configurable 5-year windows and the full dataset span
- Applied to GDP, exports, imports, and GDP per capita simultaneously
- Identifies the fastest and slowest growth periods automatically

### 3 · Hodrick-Prescott Filter (`src/algorithms/hp_filter.ts`)
- Decomposes a GDP time series into **long-run trend τ** and **cyclical component c = y − τ**
- Solves the HP minimisation problem as a banded linear system (λ = 100 for annual data)
- Uses explicit linear-system solving tailored for annual macroeconomic series

### 4 · Pearson Correlation Matrix (`src/algorithms/correlation.ts`)
- Builds an **n × n correlation matrix** across GDP, exports, imports, growth rate, trade balance, and openness
- Labels each pair by strength (strong / moderate / weak / none) and direction (positive / negative)
- Highlights the strongest off-diagonal pair automatically

### 5 · Herfindahl-Hirschman Index (`src/algorithms/hhi.ts`)
- Calculates **HHI = Σ(sᵢ%)²** for both export-sector and import-partner concentration
- Categorises markets as Competitive (< 1500), Moderate (1500–2500), or Concentrated (> 2500)
- Tracks concentration trends over time with a generic interface for any country's trade data

### 6 · Z-Score Anomaly Detection (`src/algorithms/anomaly.ts`)
- Computes rolling mean and standard deviation across **6 economic metrics** simultaneously
- Flags outliers at |z| > 1.5 with directional icons and severity colouring (moderate / strong / extreme)
- Handles structural breaks (e.g. 2020 COVID shock) correctly

### 7 · K-Means++ Clustering (`src/algorithms/kmeans.ts`)
- Library-backed **K-Means++** initialisation for stable, reproducible clusters
- Z-score normalisation across dimensions before clustering
- Labels each cluster semantically: Expansion · Transition · Contraction · Recovery

### 8 · Trie Autocomplete (`src/algorithms/trie.ts`)
- **O(m)** prefix lookup (m = query length) via a character-node tree
- Singleton pattern — built once on app load, reused across all keystrokes
- Powers instant suggestions in Search mode without any external dependency

---

## 🏗️ Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                React 18 + TypeScript + Tailwind CSS              │
│  ┌──────────┐  ┌──────────┐  ┌───────────┐  ┌───────────────┐  │
│  │  Country │  │  Chat /  │  │ Analytics │  │    Export     │  │
│  │   Data   │  │  Search  │  │ (8 algos) │  │ CSV/JSON/HTML │  │
│  └──────────┘  └──────────┘  └───────────┘  └───────────────┘  │
│     shadcn/ui components · shared/CountrySearchInput · ui/       │
└───────────────────────────┬──────────────────────────────────────┘
                            │ fetch /api/*
┌───────────────────────────▼──────────────────────────────────────┐
│             Express 5  (modular monolith, server.js)             │
│  ┌────────────┐  ┌──────────────┐  ┌──────────┐  ┌──────────┐  │
│  │ LRU Cache  │  │ Rate Limiter │  │ Helmet   │  │ SQLite   │  │
│  │ (DLL+Map)  │  │  20 req/15m  │  │ security │  │ sessions │  │
│  └────────────┘  └──────────────┘  └──────────┘  └──────────┘  │
│                                                                  │
│      Route modules + service modules + provider integrations      │
└──────────────────────────────────────────────────────────────────┘
```

### Backend (`server.js`)
- **Modular monolith structure** — `server.js` composes routers from `src/server/routes/*` and shared services from `src/server/services/*`
- **Custom LRU caches** — in-memory caches for API responses, canonical query payloads, and raw provider data
- **Query canonicalization service** — optional Kimi 2.5 (`moonshot-v1-8k`) canonicalization + deterministic fallback normalizer for semantic cache keys
- **Provider service layer** — shared AI clients (Anthropic/Kagi) and data tools (World Bank/IMF/FRED) used across routes
- **Auth** — Clerk-managed authentication plus guest/local JWT flows
- **Rate limiting** — `express-rate-limit` at 20 requests / 15 minutes per IP
- **Security** — `helmet()` middleware; API key is server-side only, never in the client bundle

### Frontend
- **Strict TypeScript** — `strict: true`, zero `any` escapes
- **Tailwind CSS + shadcn/ui** — all layout and structural styling uses Tailwind utility classes; shadcn components provide accessible primitives (Button, Input, Alert, Badge, Slider, Sheet, etc.)
- **`react-markdown` + `remark-gfm`** — renders AI-generated markdown responses (replaces custom parser)
- **`useMobile()` hook** — viewport-reactive boolean; drives responsive layout changes across all modes
- **Off-screen SVG extraction** — `ExportMode` renders fixed-size Recharts charts in a hidden container, then serialises them with `XMLSerializer` to embed in downloadable HTML reports
- **Single chart style source of truth** — all Recharts constants (`TT`, `GRID`, `AX`, `LEG`, `P`, `C`) in `src/config/styles.ts`

---

## 📱 Mobile Support

The UI is fully responsive at ≤ 640 px:

- **Header** — tab strip scrolls horizontally; long descriptions hidden; username label hidden (avatar only)
- **Chat** — history sidebar collapses to a slide-in overlay toggled by a `☰` button; suggestion chips go single-column
- **Search** — suggestion chips single-column; search button stacks below the input field
- **Export** — two panels stack vertically; format-reference cards go single-column

---

## 📁 Project Structure

```
src/
├── App.tsx                       # Shell: auth gate, header, mode routing
├── types/index.ts                # All shared TypeScript interfaces
├── config/styles.ts              # Recharts theme constants
├── lib/utils.ts                  # cn() helper (clsx + tailwind-merge)
├── utils/
│   ├── api.ts                    # All API calls (Claude, search, country, auth)
│   ├── csv.ts                    # RFC 4180-compliant CSV parser (state machine)
│   ├── export.ts                 # CSV/JSON download helpers + HTML report builder
│   └── useMobile.ts              # Viewport-reactive mobile breakpoint hook
├── algorithms/
│   ├── regression.ts             # OLS regression + 95% CI forecast
│   ├── cagr.ts                   # Compound Annual Growth Rate analysis
│   ├── hp_filter.ts              # Hodrick-Prescott trend/cycle decomposition
│   ├── correlation.ts            # Pearson correlation matrix
│   ├── hhi.ts                    # Herfindahl-Hirschman Index
│   ├── anomaly.ts                # Z-score anomaly detection
│   ├── kmeans.ts                 # K-Means++ clustering
│   └── trie.ts                   # Trie autocomplete (O(m) lookup)
├── components/
│   ├── auth/
│   │   ├── AuthPage.tsx          # Login / register landing page
│   │   └── SettingsPanel.tsx     # Account settings slide-in drawer
│   ├── shared/
│   │   └── CountrySearchInput.tsx  # Debounced country search with dropdown
│   ├── ui/
│   │   ├── index.tsx             # Custom primitives: Btn, KPI, Card, AnalyticsCard, Stat, DynChart…
│   │   ├── alert.tsx             # shadcn Alert
│   │   ├── badge.tsx             # shadcn Badge
│   │   ├── button.tsx            # shadcn Button
│   │   ├── card.tsx              # shadcn Card
│   │   ├── input.tsx             # shadcn Input
│   │   ├── label.tsx             # shadcn Label
│   │   ├── separator.tsx         # shadcn Separator
│   │   ├── sheet.tsx             # shadcn Sheet (slide-in panel)
│   │   ├── skeleton.tsx          # shadcn Skeleton
│   │   ├── slider.tsx            # shadcn Slider (year-range filter)
│   │   └── textarea.tsx          # shadcn Textarea
│   └── modes/
│       ├── DashboardMode.tsx     # Country Data tab
│       ├── ChatMode.tsx          # AI Chat tab (persistent sessions)
│       ├── SearchMode.tsx        # Live web search tab
│       ├── DataMode.tsx          # CSV upload + analysis tab
│       ├── AnalyticsMode.tsx     # 8-algorithm analytics tab
│       └── ExportMode.tsx        # Export & Reports tab
└── data/
    └── suggestions.ts            # Suggestion chips + popular countries + search corpus

server.js                         # Express 5 API + World Bank proxy + auth

src/server/
├── routes/                       # API surface area (auth/chat/search/country/...)
├── services/
│   ├── aiClients.js              # Anthropic + Kagi client wrappers
│   ├── cacheKey.js               # Query canonicalization + semantic cache keys
│   ├── dataTools.js              # World Bank/IMF/FRED fetchers + tool execution
│   └── telemetry.js              # PostHog server telemetry
├── auth/                         # Auth middleware + rate limiters
├── db/                           # SQLite schema + prepared statements
└── cache/                        # LRU cache implementation + instances
```

---

## 🚀 Quick Start

**Prerequisites:** Node ≥ 20, an [Anthropic API key](https://console.anthropic.com)

```bash
# 1. Clone and install
git clone <repo-url>
cd super-dash
npm install

# 2. Configure environment
cp .env.example .env
# Required: ANTHROPIC_API_KEY, CLERK_SECRET_KEY, VITE_CLERK_PUBLISHABLE_KEY
# Optional: KAGI_API_KEY (Search mode primary provider), KIMI_API_KEY (query canonicalization)
# Recommended for expanded datasets: BOTMARKET_API_KEY

# 3. Development (two terminals)
npm run dev:server   # Express API on :3000
npm run dev          # Vite HMR on :5173

# 4. Production build
npm run build        # Vite → dist/
npm start            # Express serves dist/ + API on :3000
```

For production-only dependency installs, use `npm ci --omit=dev` rather than
the deprecated `npm_config_production=true` / `--production` setting. The
`npm run ci:install:prod` helper is provided for deploy platforms that allow a
custom install command.

Open [http://localhost:5173](http://localhost:5173) in development or [http://localhost:3000](http://localhost:3000) in production.

### Clerk publishable key

`VITE_CLERK_PUBLISHABLE_KEY` is a client-side Vite variable and must be
available when the frontend is built. Use a real key from Clerk that starts with
`pk_test_` for local development or `pk_live_` for production. Placeholder
values from `.env.example` are intentionally rejected at runtime so deployments
fail with an actionable configuration notice instead of a blank screen.

To get it: open the [Clerk Dashboard](https://dashboard.clerk.com), select your
application, go to **API keys**, copy **Publishable key**, and paste it into
`.env` as `VITE_CLERK_PUBLISHABLE_KEY=pk_test_...`. Copy the backend
**Secret key** into `.env` as `CLERK_SECRET_KEY=sk_test_...`; never expose the
secret key with a `VITE_` prefix.

If Clerk's quick-copy selector is set to **Next.js**, it may show
`NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_...`. This app uses **Vite**, so copy
the same `pk_test_...` / `pk_live_...` value but name the variable
`VITE_CLERK_PUBLISHABLE_KEY`.

### Railway / deployment environment variables

Vite replaces `import.meta.env.VITE_*` values during the frontend build. If a
deploy platform builds the app before production variables are available, the
client bundle can miss `VITE_CLERK_PUBLISHABLE_KEY` even when Railway shows the
variable at runtime. To make Railway-style deployments resilient, the Express
server also serves `/env.js`, which exposes only safe public client variables
(`VITE_CLERK_PUBLISHABLE_KEY` and `VITE_POSTHOG_KEY`) from the runtime
environment before the React bundle loads.

On Railway, set these variables on the service that runs `npm start` and then
redeploy:

- `VITE_CLERK_PUBLISHABLE_KEY=pk_live_...` (or `pk_test_...` for a test Clerk instance)
- `CLERK_SECRET_KEY=sk_live_...` (server-side only; never expose it with `VITE_`)
- `ANTHROPIC_API_KEY=...` (required for AI features)
- `JWT_SECRET=...` with at least 32 characters in production

`KAGI_API_KEY` and `UN_COMTRADE_API_KEY` are recommended for richer Search and
trade enrichment, but missing values no longer prevent the web server from
starting; related features will show provider configuration errors until the
keys are added.

### Railway deployment command settings

This repository includes `railway.json` so Railway builds once and starts the
server directly with `node server.js`. That avoids the previous double-build
path (`npm run build` followed by `npm start` triggering `prestart`) and avoids
runtime npm warnings from deprecated `NPM_CONFIG_PRODUCTION=true` settings.

If you previously added `NPM_CONFIG_PRODUCTION=true` or
`npm_config_production=true` in Railway variables, remove it. Use
`NPM_CONFIG_OMIT=dev` only for install phases where dev dependencies are not
needed. Because the Vite build requires dev dependencies, the Railway build
should run before pruning dev dependencies, or use Railway's default Node/Nixpacks
install behavior with the checked-in `railway.json`.

---

## 🛠️ Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18 · TypeScript 5 (strict) |
| Build | Vite 8 |
| Styling | Tailwind CSS 3 · shadcn/ui · Radix UI primitives |
| Markdown | react-markdown 10 · remark-gfm |
| Icons | lucide-react |
| Charts | Recharts 2 |
| Toasts | Sonner |
| Backend | Express 5 modular monolith · Node ≥ 20 |
| Database | better-sqlite3 |
| AI | Anthropic Messages API · Kagi FastGPT API · Kimi 2.5 (optional canonicalization) |
| Security | Helmet.js · express-rate-limit · Clerk auth |

---

## 📊 Data Sources

| Source | Used for |
|--------|---------|
| [World Bank Open Data](https://data.worldbank.org) | GDP, growth rates, GDP per capita — any country |
| IMF DataMapper | Macro indicator fallback and cross-source tool queries |
| OEC BotMarket | Expanded datasets: trade, demographics, debt, labor, education, health, governance, fiscal, productivity, skills, social indicators, US ACS |
| OECD Data API (optional) | Additional OECD/member macro series via SDMX fallback |
| UN Comtrade | Verified bilateral trade flow and commodity-level trade values |
| FRED (optional, env-gated) | US-focused macro time series in chat tools |
| Kagi FastGPT | Search summaries with references |

> **Note:** Country dashboard values are source-backed only. If granular trade breakdowns are unavailable from official sources, they are shown as missing (not estimated). AI Chat and Search responses cite live sources at query time.

---

## License

MIT
