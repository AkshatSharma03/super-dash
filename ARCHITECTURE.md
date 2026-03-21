# EconChart — Architecture & Interview Reference

## What the App Does

**EconChart** is a full-stack economic intelligence dashboard. Users can:

- Ask natural language questions about the global economy and receive AI-generated interactive charts and insights
- Search live economic data via an agentic Claude loop that browses the web in real time
- Upload CSV datasets for AI-powered analysis and visualization
- Explore pre-built country dashboards (200+ countries) with GDP, trade, and sector data sourced from World Bank, IMF, and OECD
- Run 8 custom-built statistical algorithms (regression, clustering, anomaly detection, etc.) on country data
- Export results as CSV, JSON, or standalone HTML reports with embedded charts

The app supports two tiers: **guest users** (instant access, in-memory sessions) and **registered users** (JWT auth, persistent chat history in SQLite).

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18, TypeScript 5, Vite 5 |
| Styling | Tailwind CSS 3 (dark mode), shadcn/ui, Radix UI primitives |
| Markdown | react-markdown 10, remark-gfm 4 |
| Icons | lucide-react |
| Toasts | Sonner |
| Charts | Recharts 2 |
| Backend | Express 5, Node.js ≥ 20 |
| Database | SQLite via better-sqlite3 |
| Auth | JWT (jsonwebtoken), bcryptjs |
| AI | Anthropic Claude API (claude-sonnet-4-6) |
| Analytics | PostHog (client + server) |
| Testing | Vitest, v8 coverage |
| CI/CD | GitHub Actions (Node 20 & 22) |

---

## Folder Structure

```
super-dash/
├── server.js                   # Express 5 API (~1400 lines)
├── src/
│   ├── App.tsx                 # Auth gate, header, mode router
│   ├── types/index.ts          # All shared TypeScript interfaces
│   ├── config/styles.ts        # Recharts theme constants (TT, GRID, AX, LEG, P)
│   ├── lib/utils.ts            # cn() helper (clsx + tailwind-merge)
│   ├── analytics.ts            # PostHog client wrapper
│   ├── algorithms/             # 8 statistical algorithms (from scratch)
│   │   ├── regression.ts       # OLS linear regression + 95% CI forecast
│   │   ├── cagr.ts             # Compound Annual Growth Rate
│   │   ├── hp_filter.ts        # Hodrick-Prescott trend/cycle decomposition
│   │   ├── correlation.ts      # Pearson correlation matrix
│   │   ├── hhi.ts              # Herfindahl-Hirschman Index
│   │   ├── anomaly.ts          # Z-score anomaly detection
│   │   ├── kmeans.ts           # K-Means++ clustering
│   │   └── trie.ts             # Trie autocomplete (O(m) prefix search)
│   ├── components/
│   │   ├── auth/
│   │   │   ├── AuthPage.tsx        # Login/register landing page
│   │   │   └── SettingsPanel.tsx   # Account settings slide-in drawer
│   │   ├── shared/
│   │   │   └── CountrySearchInput.tsx  # Debounced search input with dropdown
│   │   ├── modes/              # 6 main feature modes
│   │   │   ├── ChatMode.tsx
│   │   │   ├── SearchMode.tsx
│   │   │   ├── DataMode.tsx
│   │   │   ├── DashboardMode.tsx
│   │   │   ├── AnalyticsMode.tsx
│   │   │   └── ExportMode.tsx
│   │   └── ui/
│   │       ├── index.tsx       # Custom primitives: Btn, KPI, Card, AnalyticsCard, Stat, DynChart, MarkdownText, SourceList, ChartCard
│   │       ├── alert.tsx       # shadcn Alert (destructive / success / warning variants)
│   │       ├── badge.tsx       # shadcn Badge
│   │       ├── button.tsx      # shadcn Button
│   │       ├── card.tsx        # shadcn Card
│   │       ├── input.tsx       # shadcn Input
│   │       ├── label.tsx       # shadcn Label
│   │       ├── separator.tsx   # shadcn Separator
│   │       ├── sheet.tsx       # shadcn Sheet (slide-in panel)
│   │       ├── skeleton.tsx    # shadcn Skeleton
│   │       ├── slider.tsx      # shadcn Slider (year-range filter)
│   │       └── textarea.tsx    # shadcn Textarea
│   └── utils/
│       ├── api.ts              # Typed fetch helpers for all endpoints
│       ├── csv.ts              # RFC 4180 CSV parser (state machine)
│       ├── export.ts           # Download/clipboard/HTML report builder
│       └── useMobile.ts        # Viewport-reactive mobile breakpoint hook
└── .github/workflows/ci.yml    # Typecheck + test + build on PR
```

---

## Database Schema

```sql
-- 7-day TTL cache for country data fetched from World Bank/IMF/OECD
CREATE TABLE country_cache (
  code       TEXT PRIMARY KEY,
  data_json  TEXT NOT NULL,
  cached_at  INTEGER NOT NULL
);

-- Registered users
CREATE TABLE users (
  id              TEXT PRIMARY KEY,
  email           TEXT UNIQUE NOT NULL,
  name            TEXT NOT NULL,
  hashed_password TEXT NOT NULL,   -- bcrypt, 10 rounds
  created_at      TEXT NOT NULL
);

-- Persistent chat sessions (authenticated users only)
CREATE TABLE chat_sessions (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title      TEXT NOT NULL,
  messages   TEXT NOT NULL DEFAULT '[]',  -- JSON array
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_sessions_user_id ON chat_sessions(user_id);
```

---

## API Endpoints

### Auth
| Method | Route | Description |
|---|---|---|
| POST | `/api/auth/register` | Create account, return JWT (7d) |
| POST | `/api/auth/login` | Validate credentials, return JWT |
| POST | `/api/auth/guest` | Instant guest JWT (24h, no DB record) |
| GET | `/api/auth/me` | Verify token, return user profile |
| PATCH | `/api/auth/password` | Change password |
| DELETE | `/api/auth/account` | Delete account (password confirmation required) |

### AI & Chat
| Method | Route | Description |
|---|---|---|
| POST | `/api/chat` | Send message history → structured AI response (insight + charts) |
| POST | `/api/search` | Agentic web search loop (up to 8 Claude tool-use turns) |
| POST | `/api/analyze-csv` | Upload CSV → AI insights and charts |
| POST | `/api/analytics` | Run algorithms on country + query Claude |

### Country Data
| Method | Route | Description |
|---|---|---|
| GET | `/api/country/search?q=` | Trie-based country autocomplete |
| GET | `/api/country/:code` | Full country dataset (cache-first, 7d TTL) |
| POST | `/api/country/:code/refresh` | Force cache bypass |
| GET | `/api/country/history` | All cached countries |

### Sessions (authenticated only)
`GET/POST /api/sessions` — list / create
`GET/PATCH/DELETE /api/sessions/:id` — read / update / delete

---

## Key Architectural Decisions

### 1. Tailwind CSS + shadcn/ui — Zero Inline Styles for Structure
All layout and structural styling uses **Tailwind utility classes**. shadcn/ui provides accessible, unstyled-first primitives (Button, Input, Alert, Badge, Slider, Sheet, etc.) built on Radix UI. Inline `style` props are reserved exclusively for values that cannot be expressed statically in Tailwind — dynamic data-driven colours (e.g. chart badge tints, cluster colours, growth cell colours) and CSS gradients/animations with custom keyframes.

`react-markdown` with `remark-gfm` renders AI-generated markdown in Chat and Search responses — replacing the earlier hand-written parser.

**Why**: Tailwind collocates styles with markup for fast iteration; shadcn components are copy-owned (no version lock-in) and fully type-safe; dynamic colours from data remain readable as inline objects without cluttering the Tailwind config with hundreds of arbitrary values.

### 3. All Algorithms Built from Scratch
No ML libraries (no scikit-learn equivalent for JS). Every algorithm is a pure TypeScript function with deterministic, auditable math:

- **Regression**: Normal equation `(XᵀX)⁻¹Xᵀy` with 95% confidence interval bands
- **HP Filter**: Banded matrix with Gaussian elimination (λ = 100 for annual data)
- **K-Means**: K-Means++ seeding (D²-weighted) with Z-score normalization before clustering
- **Trie**: Singleton prefix tree loaded once at startup; O(m) lookup where m = query length

**Why**: Full transparency for users who want to understand the math; no dependency risk; easier to unit test.

### 4. In-Memory LRU Cache + SQLite Persistent Cache
Two-layer caching:
- **LRU cache** (custom doubly-linked list + Map, O(1) get/put, 200 entries): short-lived responses for chat (1h TTL) and search (30m TTL)
- **SQLite `country_cache`**: survives server restarts; 7-day TTL for expensive World Bank/IMF API calls

**Why**: World Bank API responses are slow (~800ms). Caching them avoids re-fetching data that rarely changes.

### 5. Data Source Fallback Chain
```
World Bank (primary) → IMF → OECD (OECD members only)
```
Claude auto-generates missing sector/partner breakdowns when the APIs don't return granular data.

**Why**: No single API covers all 200+ countries completely. Graceful degradation beats an error page.

### 6. Agentic Web Search Loop
The `/api/search` endpoint runs Claude in a tool-use loop. Claude decides when to call `web_search_20250305`, inspects results, and may search again (up to 8 turns) before composing a final answer.

**Why**: A single search query often yields insufficient depth. The agentic loop lets Claude iteratively refine its research — closer to how a human analyst would work.

### 7. Guest-First UX, Zero Friction
`POST /api/auth/guest` issues a 24-hour JWT in one request with no DB write. Guest sessions live in memory only. On registration, the user seamlessly upgrades to persistent storage.

**Why**: Requiring sign-up before showing value is a conversion killer for a data tool. Let users experience the product first.

### 8. RFC 4180 CSV Parser (No Library)
The CSV parser in `src/utils/csv.ts` is a hand-written state machine that handles quoted fields, embedded commas, and embedded newlines.

**Why**: Most JS CSV libraries add unnecessary weight; this is ~100 lines, fully tested, and precisely scoped to what the app needs.

### 9. Mode-Based State Architecture
`App.tsx` holds the selected country dataset in top-level state. All six modes read from this shared state. When you fetch a country in Dashboard mode and switch to Analytics mode, the data is already there.

**Why**: Avoids redundant API calls. Country data is expensive to fetch; fetching it once and sharing it is the right tradeoff.

### 10. Server-Side API Key Isolation
The Anthropic API key, NewsAPI key, and external data source calls all live in `server.js`. The Vite client bundle never sees these secrets.

**Why**: Basic security hygiene — API keys in client bundles get scraped.

---

## Security Model

| Concern | Approach |
|---|---|
| Password storage | bcrypt, 10 rounds |
| Auth tokens | JWT, 7-day expiry, `JWT_SECRET` env var |
| API key exposure | Server-side only, never in Vite bundle |
| Rate limiting | 20 req/15 min (general), 10 req/15 min (auth) |
| Security headers | `helmet` with CSP |
| CORS | Whitelisted origins only |

---

## Testing

- Framework: **Vitest**
- Coverage targets: **80%** lines/functions/statements, **70%** branches
- Tested: all 8 algorithms, CSV parser, utility functions
- CI: GitHub Actions runs typecheck + tests + build on every push (Node 20 & 22)

---

## Scopes for Improvement

### High Priority

**1. Replace SQLite with PostgreSQL**
SQLite works for a single-instance deployment but breaks under horizontal scaling — two servers cannot share the same SQLite file. Migrating to Postgres (e.g., Railway Postgres) unlocks multi-instance deployments, built-in backups, and better tooling. Main work: swap `better-sqlite3` (sync) for `pg`/`postgres` (async), update all DB calls to `await`.

**2. Proper Session Token Management**
Currently JWTs have no server-side revocation. If a user logs out or changes their password, old tokens remain valid until expiry. A token blocklist (Redis or a DB table) or switching to opaque session tokens with server-side storage would fix this.

**3. Input Validation Layer**
There is no schema validation library (e.g., Zod) on API request bodies. Malformed inputs are handled ad-hoc. A consistent validation layer at the route level would harden the API and simplify error messages.

**4. CSV Upload Size Limits & Streaming**
Large CSV files are currently read entirely into memory. Adding `multer` with size limits and streaming the file through the CSV parser would prevent memory exhaustion on large uploads.

### Medium Priority

**5. Real-time Chart Updates (WebSockets)**
The agentic search loop runs up to 8 turns server-side before returning. Users see a spinner with no intermediate feedback. Streaming partial results via WebSockets or SSE would greatly improve perceived performance.

**6. Refresh Token Flow**
Access tokens expire after 7 days with no renewal mechanism. A short-lived access token (15 min) + long-lived refresh token pattern would be more secure and standard.

**7. Pagination for Chat Sessions**
`GET /api/sessions` returns all sessions for a user with no pagination. Heavy users accumulate hundreds of sessions; this will degrade with scale.

**8. Algorithm Result Persistence**
Analytics results (regression, clustering, etc.) are recomputed client-side on every visit. Caching algorithm outputs server-side (keyed by country + algorithm + date) would make the Analytics tab load instantly on repeat visits.

**9. Chart Accessibility**
Recharts charts lack ARIA labels and keyboard navigation. Adding accessible descriptions and ensuring color choices meet WCAG 2.1 AA contrast ratios would make the app usable for screen reader users.

### Lower Priority / Nice to Have

**10. Internationalisation (i18n)**
All UI strings are hardcoded in English. Extracting them into a locale file and using `react-i18next` would allow non-English support.

**11. Offline Support / PWA**
A service worker could cache the app shell and last-viewed country data, allowing basic offline usage. Given the app is data-heavy this is a partial win, but useful for slow connections.

**12. More Data Sources**
The World Bank API has gaps for some countries and many indicators (inflation, unemployment, FDI) aren't surfaced. Integrating FRED (Federal Reserve), Eurostat, or UN Comtrade would significantly broaden coverage.

**13. Collaborative Sessions**
Currently sessions are per-user. Sharing a session link (read-only or collaborative) would be a strong B2B feature for teams doing joint economic research.

**14. Test Coverage for Backend Routes**
Unit tests cover algorithms and utilities well, but `server.js` has no integration tests. Adding supertest-based route tests would catch regressions in the API layer.

---

## Running Locally

```bash
# 1. Install deps
npm install

# 2. Set env vars
cp .env.example .env
# Add ANTHROPIC_API_KEY at minimum

# 3. Start backend (port 3000)
npm run dev:server

# 4. Start frontend (port 5173, proxies /api → 3000)
npm run dev

# Tests
npm test
npm run test:coverage
```

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `ANTHROPIC_API_KEY` | Yes | Claude API key (server-side only) |
| `JWT_SECRET` | Yes (prod) | Secret for signing JWTs |
| `PORT` | No | Server port (default 3000) |
| `DB_PATH` | No | SQLite file path (default `data/econChart.db`) |
| `NEWS_API_KEY` | No | NewsAPI.org for live news context |
| `VITE_POSTHOG_KEY` | No | PostHog client analytics |
| `POSTHOG_API_KEY` | No | PostHog server analytics |
