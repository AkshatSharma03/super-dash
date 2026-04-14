# EconChart — Feature Roadmap & Implementation Log

> Living document. Update status as features ship.

---

## Phase 1: MVP + Monetization (Weeks 1–4) — DONE

### 1.1 Methodology & Documentation Transparency — DONE
- **Files**: `src/data/methodology.ts`, `src/components/modes/MethodologyMode.tsx`
- **What**: New "Methodology" tab with LaTeX formulas, parameters, assumptions, limitations, paper references for all 8 algorithms
- **Dependencies**: `react-katex`, `katex`
- **Status**: Shipped. All 8 algorithms documented with full mathematical detail.

### 1.2 Data Quality Heatmap — DONE
- **Files**: `src/components/ui/DataQualityHeatmap.tsx`, `src/components/modes/DashboardMode.tsx`
- **What**: Interactive years-vs-indicators grid showing data completeness (complete/partial/estimated/missing). Toggle in Country Data tab.
- **Types added**: `DataQualityStatus`, `DataQualityCell` in `src/types/index.ts`
- **Status**: Shipped. Toggle button "Data Quality" in provenance bar.

### 1.3 Shareable Session Links — DONE
- **DB table**: `session_shares` (id, session_id, share_token, created_at, expires_at, view_count)
- **Server endpoints**:
  - `POST /api/sessions/:id/share` — create share link
  - `GET /api/sessions/:id/shares` — list shares for session
  - `DELETE /api/sessions/:id/shares/:shareId` — delete share
  - `GET /api/share/:token` — public view (no auth)
- **Frontend**: `src/components/ui/ShareButton.tsx` in ChatMode
- **API functions**: `createSessionShare`, `getSessionShares`, `deleteSessionShare`, `getSharedSession` in `src/utils/api.ts`
- **Status**: Shipped. Share button appears next to Export in chat input bar.

### 1.4 Stripe Integration (Free/Pro/Enterprise) — DONE
- **DB table**: `subscriptions` (id, user_id, stripe_customer_id, stripe_subscription_id, plan, status, current_period_end, created_at, updated_at)
- **Server endpoints**:
  - `GET /api/billing/subscription` — current plan
  - `POST /api/billing/create-checkout` — Stripe Checkout URL
  - `POST /api/billing/portal` — Stripe Customer Portal URL
  - `POST /api/billing/cancel` — cancel subscription
  - `POST /api/billing/webhook` — Stripe webhook handler
- **Frontend**: `src/components/auth/BillingPanel.tsx` with pricing cards (Free/Pro/Enterprise)
- **Env vars**: `STRIPE_SECRET_KEY`, `STRIPE_PRICE_PRO`, `STRIPE_WEBHOOK_SECRET`
- **Plan limits**: `checkPlanLimit(userId, feature)` helper in server.js
- **Status**: Shipped. "Manage Plan & Billing" button in SettingsPanel. Graceful no-Stripe fallback.

---

## Phase 2: Researcher Features (Weeks 5–8)

### 2.1 Custom Metric Builder — DONE
- **Algorithm**: `src/algorithms/expressionEvaluator.ts` — tokenizer, shunting-yard parser, evaluator
- **DB table**: `custom_metrics` (id, user_id, name, expression, description, created_at, updated_at)
- **Server endpoints**:
  - `GET /api/metrics` — list user's metrics
  - `POST /api/metrics` — create (enforces plan limit: free=0, pro=5)
  - `PATCH /api/metrics/:id` — update
  - `DELETE /api/metrics/:id` — delete
- **Frontend**: `src/components/ui/MetricBuilder.tsx` in AnalyticsMode
  - Variable keyboard (gdp, gdp_growth, exports, imports, trade_balance, trade_openness)
  - Live preview with Recharts line chart
  - Expression validation with error messages
  - Saved metrics list with load/delete
- **API functions**: `getCustomMetrics`, `createCustomMetric`, `updateCustomMetric`, `deleteCustomMetric` in api.ts
- **Known variables**: `KNOWN_VARIABLES` map in expressionEvaluator.ts
- **Status**: Shipped. Appears in AnalyticsMode below the AI query section.

### 2.2 Peer Comparison & Benchmarking — PENDING
- **What**: Select peer group (region, income level, BRICS, custom). Compute percentile ranks. Show "India GDP: top 15% globally, median for South Asia".
- **Files to create**:
  - `src/data/peerGroups.ts` — hardcoded region/income/BRICS groupings
  - `src/algorithms/percentileRank.ts` — percentile calculation
  - `src/components/ui/PeerComparison.tsx` — comparison tables + charts
- **Server endpoint**: `GET /api/peers/:countryCode?groupType=region`
- **Frontend**: New section in DashboardMode (below KPIs)
- **Scope**: v1 = hardcoded groups (5 regions, 3 income levels, BRICS). v2 = custom groups.
- **Plan gate**: Free = 2 countries comparison; Pro = unlimited.

### 2.3 Snapshots — PENDING
- **What**: Freeze analysis state. Immutable snapshot with data version. Shareable link. Regenerate with diff.
- **DB table**: `snapshots` (id, user_id, session_id, title, description, data_payload JSON, created_at, data_version, is_public)
- **Server endpoints**:
  - `POST /api/snapshots` — create from current session/analysis
  - `GET /api/snapshots` — list user's
  - `GET /api/snapshots/:id` — view
  - `POST /api/snapshots/:id/regenerate` — re-run with latest data, return diffs
- **Frontend**: `src/components/ui/SnapshotButton.tsx` — "Snapshot" action
- **Citation**: Generate APA-style citation for each snapshot
- **Plan gate**: Free = 2 snapshots; Pro = 50; Enterprise = unlimited.

### 2.4 Email Alerts (Basic) — PENDING
- **What**: Weekly digest of new World Bank/IMF releases for watched countries.
- **DB table**: `alert_subscriptions` (id, user_id, type, enabled, created_at)
- **DB table**: `alert_logs` (id, user_id, type, sent_at, recipient_email)
- **Cron job**: `npm run alerts` — daily at 08:00 UTC, fetches latest WB releases, emails subscribers
- **Frontend**: Settings → "Email Preferences" checkbox
- **Email template**: `src/templates/releaseDigest.html`
- **Requires**: Nodemailer (already in deps), SMTP config env vars
- **Plan gate**: Pro+ only.

---

## Phase 3: API + Integrations (Weeks 9–13)

### 3.1 REST API Endpoints — PENDING
- **What**: Public data export API with API key auth.
- **DB table**: `api_keys` (id, user_id, key_hash, key_preview, name, rate_limit, last_used_at, created_at)
- **Server endpoints**:
  - `GET /api/data/countries?search=India` — search countries
  - `GET /api/data/:code?indicators=gdp,exports&start_year=2010&end_year=2024` — fetch time series
  - `GET /api/data/batch?countries=US,CN,IN&indicators=gdp&years=2020:2024` — batch fetch
  - Response formats: JSON (default), CSV (`?format=csv`)
- **Middleware**: `authenticateApiKey(req, res, next)` — Bearer token auth
- **Rate limiting**: Token bucket per API key (free=500/mo, pro=5000/mo, enterprise=unlimited)
- **OpenAPI spec**: `src/api-docs/openapi.yaml`
- **Example clients**: `examples/fetch_data.py`, `examples/fetch_data.R`, `examples/fetch_data.js`
- **Plan gate**: Free = 500/mo; Pro = 5,000/mo; Enterprise = unlimited.

### 3.2 API Key Management UI — PENDING
- **Frontend**: `src/components/auth/DeveloperPanel.tsx` — Settings → "Developer" tab
  - Generate/delete API keys
  - Show last 4 chars, creation date, last used, rate limit
  - Usage display: "X/500 calls this month"
- **Plan gate**: Visible to all authenticated users. Usage limits by tier.

### 3.3 Batch Multi-Country Analysis (v1: 10 countries) — PENDING
- **What**: Compare 2–10 countries side-by-side. Run algorithms across all. Export comparison tables.
- **Algorithm**: `src/algorithms/compareCountries.ts`
- **New mode**: `src/components/modes/ComparisonMode.tsx`
  - Country multi-select (max 10)
  - Indicator selector
  - Year range slider
  - Results: comparison table, multi-line chart, correlation heatmap across countries
- **New chart components**:
  - `MultiCountryLineChart.tsx` — GDP growth overlaid
  - `ComparisonTable.tsx` — countries × indicators, color-coded
  - `CorrelationHeatmap.tsx` — 10×10 matrix
- **Export**: Multi-sheet Excel workbook (Phase 3.4 dependency)
- **Caching**: `comparison_cache` table (optional)
- **Plan gate**: Free = 2 countries; Pro = 10; Enterprise = 50.
- **App.tsx changes**: Add "Comparison" to MODES array and Mode type.

### 3.4 Excel Export with Multiple Sheets — PENDING
- **What**: Upgrade export to multi-sheet Excel workbooks using `exceljs`.
- **Install**: `npm install exceljs`
- **Files**:
  - `src/utils/exportToExcel.ts` — structured workbook builder
  - Sheets: Summary, Raw Data, Algorithms, Metadata
  - Styling: bold headers, freeze panes, formatted numbers
- **Integration**: Add "Export as Excel" to Dashboard, Comparison, Analytics modes
- **Plan gate**: Free = CSV/JSON only; Pro = all formats including Excel.

---

## Phase 4: Enterprise & Polish (Weeks 14–16)

### 4.1 Team Workspaces — PENDING
- **DB tables**:
  - `teams` (id, name, owner_id, created_at)
  - `team_members` (id, team_id, user_id, role, invited_at, joined_at)
  - `session_comments` (id, session_id, user_id, chart_id, text, created_at)
- **Server endpoints**:
  - `POST /api/teams` — create team
  - `GET /api/teams` — list user's teams
  - `POST /api/teams/:id/invite` — send invitation
  - `PATCH /api/teams/:id/members/:memberId` — change role
  - `DELETE /api/teams/:id/members/:memberId` — remove member
  - `POST /api/sessions/:id/comments` — add comment
  - `GET /api/sessions/:id/comments` — fetch comments
  - `DELETE /api/comments/:id` — delete own comment
- **Frontend**: `src/components/auth/TeamPanel.tsx`
- **Plan gate**: Pro = 1 team, 3 members; Enterprise = unlimited.

### 4.2 Data Refresh SLA + Status Page — PENDING
- **DB table**: `data_refresh_log` (id, indicator, source, last_successful_refresh, next_scheduled, status, error_message, logged_at)
- **What**: Track data freshness per indicator. Public `/status` page.
- **Cron enhancement**: Log every World Bank fetch attempt
- **Server endpoint**: `GET /api/status` — returns all indicators with refresh status
- **Frontend**: `src/pages/StatusPage.tsx` — color-coded indicator table, next update estimates
- **Header**: Small "Status" dot (green/yellow/red) linking to status page
- **Email alerts**: "Notify me if GDP refresh is delayed"
- **Plan gate**: Public, no restriction.

### 4.3 Scenario Analysis (Basic) — PENDING
- **What**: "What-if" economic scenario modeling. Adjust macro assumptions, see projected outcomes.
- **Files**:
  - `src/algorithms/scenarioAnalysis.ts` — apply shocks to data, re-run algorithms
  - `src/components/modes/ScenarioMode.tsx` — new mode tab
- **Presets**: Recession (GDP -0.5%), Boom (GDP +5%), Stagflation (GDP +1%, inflation high)
- **Custom sliders**: GDP growth %, trade growth %, oil price
- **Output**: Baseline vs. Scenario overlaid chart, side-by-side table
- **Database**: `user_scenarios` table (optional — store user-created scenarios)
- **Plan gate**: Free = preset scenarios only; Pro = custom scenarios + save.

---

## Database Schema (All Tables)

### Existing (unchanged)
```sql
country_cache, users, chat_sessions, search_history, search_sessions,
password_reset_tokens, revoked_tokens
```

### New (Phase 1)
```sql
session_shares (id, session_id, share_token, created_at, expires_at, view_count)
subscriptions (id, user_id, stripe_customer_id, stripe_subscription_id, plan, status, current_period_end, created_at, updated_at)
```

### New (Phase 2)
```sql
custom_metrics (id, user_id, name, expression, description, created_at, updated_at)
snapshots (id, user_id, session_id, title, description, data_payload, created_at, data_version, is_public)  -- PENDING
alert_subscriptions (id, user_id, type, enabled, created_at)  -- PENDING
alert_logs (id, user_id, type, sent_at, recipient_email)  -- PENDING
```

### New (Phase 3)
```sql
api_keys (id, user_id, key_hash, key_preview, name, rate_limit, last_used_at, created_at)  -- PENDING
comparison_cache (key, result_json, created_at)  -- PENDING, optional
```

### New (Phase 4)
```sql
teams (id, name, owner_id, created_at)  -- PENDING
team_members (id, team_id, user_id, role, invited_at, joined_at)  -- PENDING
session_comments (id, session_id, user_id, chart_id, text, created_at)  -- PENDING
data_refresh_log (id, indicator, source, last_successful_refresh, next_scheduled, status, error_message, logged_at)  -- PENDING
user_scenarios (id, user_id, country_code, name, scenario_json, created_at)  -- PENDING
```

---

## Pricing Tiers

| Feature | Free | Pro ($29/mo) | Enterprise ($500+/mo) |
|---------|------|-------------|----------------------|
| Countries / month | 5 | Unlimited | Unlimited |
| Export formats | CSV | CSV, JSON, Excel, HTML | All + API |
| Sessions | 1 | 50 | Unlimited |
| Custom metrics | 0 | 5 | 50 |
| Snapshots | 2 | 50 | Unlimited |
| API calls / month | 500 | 5,000 | Unlimited |
| Peer comparison | 2 countries | 10 countries | 50 countries |
| Email alerts | — | Weekly digest | Real-time |
| Team workspaces | — | 1 team, 3 members | Unlimited |
| Scenario analysis | Presets only | Custom + save | Custom + save |
| Data refresh SLA | Best effort | 24h | 1h |

---

## Plan Limit Enforcement

Server-side enforcement via `checkPlanLimit(userId, feature)` helper in server.js:

```javascript
function checkPlanLimit(userId, feature) {
  const sub = stmt.subscriptionByUser.get(userId);
  const plan = (!sub || sub.status !== 'active') ? 'free' : sub.plan;
  const limits = {
    countries:       { free: 5,    pro: Infinity, enterprise: Infinity },
    customMetrics:   { free: 0,    pro: 5,        enterprise: 50 },
    sessions:        { free: 3,    pro: 50,       enterprise: Infinity },
    snapshots:       { free: 2,    pro: 50,       enterprise: Infinity },
    apiCalls:        { free: 500,  pro: 5000,     enterprise: Infinity },
  };
  return { plan, limit: limits[feature]?.[plan] ?? 0 };
}
```

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `ANTHROPIC_API_KEY` | Yes | Claude API key (server-side only) |
| `JWT_SECRET` | Yes (prod) | Secret for signing JWTs |
| `PORT` | No | Server port (default 3000) |
| `DB_PATH` | No | SQLite file path (default `data/econChart.db`) |
| `KIMI_API_KEY` | No | Kimi 2.5 API key for query canonicalization |
| `KIMI_MODEL` | No | Kimi model override |
| `KAGI_API_KEY` | No | Kagi FastGPT for search |
| `NEWS_API_KEY` | No | NewsAPI.org |
| `STRIPE_SECRET_KEY` | No* | Stripe secret key |
| `STRIPE_PRICE_PRO` | No* | Stripe Price ID for Pro tier |
| `STRIPE_WEBHOOK_SECRET` | No* | Stripe webhook signing secret |
| `VITE_CLERK_PUBLISHABLE_KEY` | No | Clerk client key |
| `CLERK_SECRET_KEY` | No | Clerk server key |
| `VITE_POSTHOG_KEY` | No | PostHog client analytics |
| `POSTHOG_API_KEY` | No | PostHog server analytics |

*Required for billing features to work; graceful fallback if not set.

---

## Test Coverage

- Framework: Vitest
- Current: 194 tests passing (algorithms + utilities)
- Target: 80% lines/functions, 70% branches
- Backend route tests: PENDING (supertest-based)
- Expression evaluator tests: PENDING
- API auth tests: PENDING

---

## Key Architectural Decisions

1. **SQLite stays until Phase 5** — works for solo dev scale; migrate to Postgres when needed
2. **All algorithms from scratch** — no ML libraries; pure TypeScript
3. **Server-side API keys** — never in client bundle
4. **Graceful no-Stripe fallback** — billing endpoints return 503 if Stripe not configured
5. **Methodology tab is always visible** — no plan gate on documentation
6. **Data quality uses client-side derivation** — no server changes needed; derives from null checks in existing data
7. **Custom metrics enforcement at API level** — `checkPlanLimit` called in POST /api/metrics