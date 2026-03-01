# 🇰🇿 Kazakhstan Economic Intelligence Dashboard

An interactive research dashboard for Kazakhstan's economy with **two modes**:

- **📊 Dashboard Mode** — Pre-built charts: GDP, Exports by Sector, Imports by Partner, Trade Balance. Filterable by year range.
- **💬 AI Chat Mode** — Prompt-driven agentic visualization. Ask any question and Claude generates charts + analysis dynamically.

Built for the **Silicon Steppes** research project at Boston University.

---

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Add your Anthropic API key
cp .env.example .env
# Edit .env and set VITE_ANTHROPIC_API_KEY=your_key

# 3. Run
npm run dev
```

Open http://localhost:5173

Get your API key at https://console.anthropic.com

---

## Deploy to Vercel

```bash
npm install -g vercel
npm run build
vercel --prod
```

Set `VITE_ANTHROPIC_API_KEY` as an environment variable in the Vercel dashboard.

---

## Tech Stack

- React 18 + Vite
- Recharts (all chart types)
- Anthropic Claude API (AI Chat mode)

---

## Data Sources

Default dashboard data is **estimated/modeled**. For verified data:
- [World Bank](https://data.worldbank.org/country/KZ)
- [UN Comtrade](https://comtrade.un.org)
- [stat.gov.kz](https://stat.gov.kz/en/)
- [IMF](https://www.imf.org/en/Data)

---

## Citation

> Sharma, A. (2025). *Silicon Steppes Economic Intelligence Dashboard*. Boston University.

## License

MIT
