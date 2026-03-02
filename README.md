# 🇰🇿 Kazakhstan Economic Intelligence Dashboard

> A full-stack economic research platform with AI-driven visualisation, five implemented-from-scratch computer science algorithms, and a production-grade Express backend — built for the **Silicon Steppes** research project at Boston University.

---

## ✨ Feature Overview

| Mode | Description |
|------|-------------|
| 📊 **Dashboard** | Pre-built interactive charts (GDP, Exports, Imports, Trade Balance) with dual-handle year-range filter |
| 💬 **AI Chat** | Conversational interface — Claude generates Recharts visualisations and expert analysis dynamically from any prompt |
| 🔎 **Search** | Live web search powered by Claude's tool-use loop; returns sourced, cited economic summaries |
| 📁 **Data Upload** | Drag-and-drop CSV → auto-parsed → Claude generates tailored charts and insights for any dataset |
| 📈 **Analytics** | Four-panel algorithm dashboard: Regression Forecast · HHI Concentration · K-Means Clustering · Anomaly Detection |

---

## 🧠 Algorithms — Implemented from Scratch

Every algorithm in the Analytics panel is written from first principles with zero ML libraries.

### 1 · OLS Linear Regression + Forecast (`src/algorithms/regression.ts`)
- Solves **β = (XᵀX)⁻¹Xᵀy** in closed form using manual matrix arithmetic
- Computes R², RSE, and a **95% prediction interval** (CI band) for multi-year forecasts
- Chart overlays actual GDP bars against the OLS trend line and shaded uncertainty cone

### 2 · Herfindahl-Hirschman Index (`src/algorithms/hhi.ts`)
- Calculates **HHI = Σ(sᵢ%)²** for both import and export trade concentration
- Categorises markets as competitive (< 1500), moderate (1500–2500), or concentrated (> 2500)
- Applied to real Kazakhstan trade-partner data to track China's growing import dominance

### 3 · K-Means++ Clustering (`src/algorithms/kmeans.ts`)
- **K-Means++** initialisation (distance-weighted seeding) for stable, reproducible clusters
- Z-score normalisation across multiple economic dimensions before clustering
- Groups Kazakhstan's trading years into economic eras with automatic cluster labelling

### 4 · Z-Score Anomaly Detection (`src/algorithms/anomaly.ts`)
- Computes rolling mean and standard deviation across **6 economic metrics** simultaneously
- Flags outliers at |z| > 2 with directional icons and severity colouring
- Correctly handles 2015 oil-shock and 2020 COVID disruptions as high-severity anomalies

### 5 · Trie Autocomplete (`src/algorithms/trie.ts`)
- **O(m)** prefix lookup (m = query length) via a character-node tree
- Singleton pattern (`getSearchTrie()`) — built once, reused across all keystrokes
- Powers instant autocomplete in Search mode without any external library

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────┐
│                  React 18 + TypeScript               │
│  ┌──────────┐  ┌──────────┐  ┌──────────────────┐  │
│  │ Dashboard│  │  Chat /  │  │    Analytics     │  │
│  │   Mode   │  │  Search  │  │  (4 algorithm    │  │
│  │          │  │  / Data  │  │     panels)      │  │
│  └──────────┘  └──────────┘  └──────────────────┘  │
│         shared: ui/, config/styles.ts               │
└─────────────────────┬───────────────────────────────┘
                      │ fetch /api/*
┌─────────────────────▼───────────────────────────────┐
│              Express 5  (server.js)                 │
│                                                     │
│  ┌───────────┐  ┌──────────────┐  ┌─────────────┐  │
│  │ LRU Cache │  │ Rate Limiter │  │  Helmet.js  │  │
│  │ (DLL+Map) │  │  20 req/15m  │  │  security   │  │
│  └───────────┘  └──────────────┘  └─────────────┘  │
│                                                     │
│         Claude API  (tool-use agentic loop)         │
└─────────────────────────────────────────────────────┘
```

### Backend Highlights (`server.js`)
- **Custom LRU Cache** — doubly-linked list + `Map` for **O(1)** get/put; separate 1-hour TTL for chat and 30-min TTL for search results; 200-entry cap
- **Agentic tool-use loop** — up to 8 turns of `web_search_20250305` tool calls, collated before returning a single response
- **Rate limiting** — `express-rate-limit` at 20 requests / 15 minutes per IP
- **Security headers** — `helmet()` middleware; API key stays server-side only (never in the client bundle)
- **Input sanitisation** — hard caps on message length, CSV rows/columns, and query length

### Frontend Highlights
- **Strict TypeScript** — `strict: true`, `moduleResolution: "bundler"`, zero `any` escapes
- **Single source of truth** — all Recharts style constants (`TT`, `GRID`, `AX`, `LEG`, `P`, `C`) live in `src/config/styles.ts`
- **Barrel UI exports** — `src/components/ui/index.tsx` exposes `Btn`, `KPI`, `Card`, `MarkdownText`, `DynChart`, etc.
- **Thin shell App** — `App.tsx` is ~80 lines; all logic is co-located in mode components

---

## 📁 Project Structure

```
src/
├── App.tsx                       # Shell: routing + header (~80 lines)
├── types/index.ts                # All shared TypeScript interfaces
├── config/styles.ts              # Recharts theme constants (single source of truth)
├── utils/
│   ├── api.ts                    # askClaude · performWebSearch · analyzeCSVData
│   └── csv.ts                    # RFC 4180-compliant CSV parser (state machine)
├── algorithms/
│   ├── regression.ts             # OLS linear regression + 95% CI forecast
│   ├── hhi.ts                    # Herfindahl-Hirschman Index
│   ├── kmeans.ts                 # K-Means++ clustering
│   ├── anomaly.ts                # Z-score anomaly detection
│   └── trie.ts                   # Trie autocomplete (O(m) lookup)
├── components/
│   ├── ui/index.tsx              # Shared UI primitives
│   └── modes/
│       ├── DashboardMode.tsx
│       ├── ChatMode.tsx
│       ├── SearchMode.tsx
│       ├── DataMode.tsx
│       └── AnalyticsMode.tsx
└── data/
    └── kazakhstan.ts             # Static economic dataset + TS interfaces

server.js                         # Express 5 API server
```

---

## 🚀 Quick Start

**Prerequisites:** Node ≥ 18, an [Anthropic API key](https://console.anthropic.com)

```bash
# 1. Clone and install
git clone <repo-url>
cd kazakhstan-dashboard-v2
npm install

# 2. Configure environment
echo "ANTHROPIC_API_KEY=your_key_here" > .env

# 3. Development (two terminals)
npm run dev:server   # Express API on :3000
npm run dev          # Vite HMR on :5173

# 4. Production build
npm run build        # Vite → dist/
npm start            # Express serves dist/ on :3000
```

Open [http://localhost:5173](http://localhost:5173) in development or [http://localhost:3000](http://localhost:3000) in production.

---

## 🛠️ Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend framework | React 18 + TypeScript 5 (strict) |
| Build tool | Vite 5 |
| Charts | Recharts 2 |
| Backend | Express 5 (Node ≥ 18) |
| AI | Anthropic Claude API (tool-use) |
| Security | Helmet.js · express-rate-limit |

---

## 📊 Data Sources

| Source | Used for |
|--------|---------|
| [World Bank](https://data.worldbank.org/country/KZ) | GDP, growth rates |
| [UN Comtrade](https://comtrade.un.org) | Trade flows by partner |
| [stat.gov.kz](https://stat.gov.kz/en/) | Official national statistics |
| [IMF](https://www.imf.org/en/Data) | Macro indicators |

> **Note:** Static dashboard data is modelled/estimated for research illustration. All AI Chat and Search responses cite live sources at query time.

---

## Citation

> Sharma, A. (2025). *Silicon Steppes Economic Intelligence Dashboard*. Boston University.

## License

MIT
