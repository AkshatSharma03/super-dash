# EconChart — Economic Intelligence Dashboard

> A full-stack economic research platform: AI-driven visualisation, eight algorithms implemented from scratch, live World Bank data for any country, and a production-grade Express backend. Mobile-responsive.

---

## ✨ Feature Overview

| Mode | Description |
|------|-------------|
| 💬 **AI Chat** | Conversational interface — Claude generates interactive Recharts visualisations and expert analysis from any natural-language prompt. Persistent session history. |
| 🔍 **Search** | Live web search powered by Claude's tool-use loop; returns sourced, cited summaries from World Bank, IMF, Reuters, and Bloomberg. Trie-powered O(m) autocomplete. |
| 📁 **Data Upload** | Drag-and-drop any CSV → auto-parsed → Claude generates tailored charts and insights for your own dataset. |
| 🧮 **Analytics** | Eight-algorithm panel (regression, CAGR, HP filter, correlation, HHI, anomaly, K-Means, trade openness) on live data for any country. |
| 🌍 **Country Data** | Real GDP and trade data from the World Bank for any country — cached locally, with dual-handle year-range filtering and sector-level breakdowns. |
| 📤 **Export** | Download data as CSV or JSON, copy summaries to clipboard, and generate standalone HTML reports with embedded SVG charts. Print to PDF via the browser. |

---

## 🧠 Algorithms — Implemented from Scratch

Every algorithm is written from first principles with **zero ML libraries**.

### 1 · OLS Linear Regression + Forecast (`src/algorithms/regression.ts`)
- Solves **β = (XᵀX)⁻¹Xᵀy** in closed form with manual matrix arithmetic
- Computes R², RSE, and a **95% prediction interval** (CI band) for multi-year forecasts
- Overlays actual GDP bars against the OLS trend line and a shaded uncertainty cone

### 2 · CAGR Analysis (`src/algorithms/cagr.ts`)
- Computes **Compound Annual Growth Rate** across configurable 5-year windows and the full dataset span
- Applied to GDP, exports, imports, and GDP per capita simultaneously
- Identifies the fastest and slowest growth periods automatically

### 3 · Hodrick-Prescott Filter (`src/algorithms/hp_filter.ts`)
- Decomposes a GDP time series into **long-run trend τ** and **cyclical component c = y − τ**
- Solves the HP minimisation problem as a banded linear system (λ = 100 for annual data)
- Uses Gaussian elimination with partial pivoting — no external linear algebra library

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
- Flags outliers at |z| > 2 with directional icons and severity colouring (mild / moderate / severe)
- Handles structural breaks (e.g. 2020 COVID shock) correctly

### 7 · K-Means++ Clustering (`src/algorithms/kmeans.ts`)
- **K-Means++** initialisation (distance-weighted seeding) for stable, reproducible clusters
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
│                     React 18 + TypeScript                        │
│  ┌──────────┐  ┌──────────┐  ┌───────────┐  ┌───────────────┐  │
│  │  Country │  │  Chat /  │  │ Analytics │  │    Export     │  │
│  │   Data   │  │  Search  │  │ (8 algos) │  │ CSV/JSON/HTML │  │
│  └──────────┘  └──────────┘  └───────────┘  └───────────────┘  │
│         shared: ui/, config/styles.ts, utils/useMobile.ts        │
└───────────────────────────┬──────────────────────────────────────┘
                            │ fetch /api/*
┌───────────────────────────▼──────────────────────────────────────┐
│                     Express 5  (server.js)                       │
│  ┌────────────┐  ┌──────────────┐  ┌──────────┐  ┌──────────┐  │
│  │ LRU Cache  │  │ Rate Limiter │  │ Helmet   │  │ SQLite   │  │
│  │ (DLL+Map)  │  │  20 req/15m  │  │ security │  │ sessions │  │
│  └────────────┘  └──────────────┘  └──────────┘  └──────────┘  │
│                                                                  │
│       Claude API (tool-use loop) · World Bank REST API           │
└──────────────────────────────────────────────────────────────────┘
```

### Backend (`server.js`)
- **Custom LRU Cache** — doubly-linked list + `Map` for O(1) get/put; 1-hour TTL for country data, 30-min TTL for search
- **World Bank API proxy** — fetches GDP, growth, trade, and per-capita data for any ISO country code; merges into a unified `CountryDataset`
- **Agentic tool-use loop** — up to 8 turns of `web_search_20250305` calls before returning a single response
- **Auth** — bcrypt password hashing, JWT tokens, SQLite-backed user and session storage
- **Rate limiting** — `express-rate-limit` at 20 requests / 15 minutes per IP
- **Security** — `helmet()` middleware; API key is server-side only, never in the client bundle

### Frontend
- **Strict TypeScript** — `strict: true`, zero `any` escapes
- **`useMobile()` hook** — viewport-reactive boolean; drives responsive layout changes across all modes
- **Off-screen SVG extraction** — `ExportMode` renders fixed-size Recharts charts in a hidden container, then serialises them with `XMLSerializer` to embed in downloadable HTML reports
- **Single style source of truth** — all Recharts constants (`TT`, `GRID`, `AX`, `LEG`, `P`, `C`) in `src/config/styles.ts`

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
│   │   └── SettingsPanel.tsx     # Account settings drawer
│   ├── ui/index.tsx              # Shared primitives: Btn, KPI, Card, DynChart…
│   └── modes/
│       ├── DashboardMode.tsx     # Country Data tab
│       ├── ChatMode.tsx          # AI Chat tab (persistent sessions)
│       ├── SearchMode.tsx        # Live web search tab
│       ├── DataMode.tsx          # CSV upload + analysis tab
│       ├── AnalyticsMode.tsx     # 8-algorithm analytics tab
│       └── ExportMode.tsx        # Export & Reports tab
└── data/
    └── kazakhstan.ts             # Suggestion chips + search corpus

server.js                         # Express 5 API + World Bank proxy + auth
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
echo "ANTHROPIC_API_KEY=your_key_here" > .env

# 3. Development (two terminals)
npm run dev:server   # Express API on :3000
npm run dev          # Vite HMR on :5173

# 4. Production build
npm run build        # Vite → dist/
npm start            # Express serves dist/ + API on :3000
```

Open [http://localhost:5173](http://localhost:5173) in development or [http://localhost:3000](http://localhost:3000) in production.

---

## 🛠️ Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18 · TypeScript 5 (strict) |
| Build | Vite 5 |
| Charts | Recharts 2 |
| Backend | Express 5 · Node ≥ 20 |
| Database | better-sqlite3 |
| AI | Anthropic Claude API (tool-use agentic loop) |
| Security | Helmet.js · express-rate-limit · bcryptjs · jsonwebtoken |

---

## 📊 Data Sources

| Source | Used for |
|--------|---------|
| [World Bank Open Data](https://data.worldbank.org) | GDP, growth rates, GDP per capita — any country |
| [UN Comtrade](https://comtrade.un.org) | Trade flows by partner and sector |
| [IMF](https://www.imf.org/en/Data) | Macro indicators, forecasts |
| Claude web search | Live news, current economic analysis |

> **Note:** Sector-level trade breakdowns are AI-estimated from published aggregate sources. All AI Chat and Search responses cite live sources at query time.

---

## License

MIT
