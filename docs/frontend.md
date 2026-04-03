# Wolf-Fin — Frontend Documentation

**Framework:** React 18 · TypeScript · Vite
**Styling:** Tailwind CSS (dark terminal theme, custom design tokens)
**Charts:** lightweight-charts (TradingView)
**Dev server port:** 5173 (proxies `/api/*` to `localhost:3000`)

---

## Dev Setup

```bash
cd frontend
pnpm install
pnpm dev       # Vite HMR dev server
pnpm build     # production build → frontend/dist/
pnpm typecheck # tsc --noEmit
```

In production the backend serves `frontend/dist/` as static files.

---

## Project Structure

```
frontend/src/
  api/
    client.ts         — all API call functions (axios wrappers)
  components/
    AlertsPanel.tsx   — alert rules CRUD + firing history + ack
    CandleChart.tsx   — lightweight-charts price chart
    MarketStatePanel.tsx — regime hero card, direction bar, stat grid
    SetupCandidatesPanel.tsx — detector results, hero card, score breakdown
    Toast.tsx         — toast notification context + hook
    [other shared components]
  pages/
    Dashboard.tsx     — symbol grid/heatmap + status overview
    SymbolDetail.tsx  — 4-tab per-symbol detail view
    Strategies.tsx    — strategy CRUD (built-in + custom)
    Settings.tsx      — LLM config, API keys, bridge config
    Logs.tsx          — structured log viewer
    Calendar.tsx      — economic calendar
  types/
    index.ts          — all frontend TypeScript types
  App.tsx             — router + layout
  main.tsx            — Vite entry point
```

---

## Pages

### Dashboard

Symbol grid showing each watch symbol's current state:
- Bias badge (bullish/bearish/neutral)
- Direction + R:R from latest trade proposal
- Running indicator + schedule status
- Click → SymbolDetail

### SymbolDetail

4-tab navigation per symbol:

**Analysis tab** (default)
- Price chart (lightweight-charts, live candle data from MT5)
- LLM-generated trade proposal: direction, entry zone, SL, TPs, R:R, reasoning, confidence
- Proposal validation score
- Key levels list
- LLM bias + summary text
- Analysis history sidebar (click to load any past analysis)

**Setups tab** (shows count of valid setups)
- `SetupCandidatesPanel`: all 6 detector outputs
- Hero card for highest-scoring valid setup with full entry/SL/TP grid
- Collapsible 9-component score breakdown per detector
- Toggle to show inactive/missed detectors

**Market State tab**
- `MarketStatePanel`: regime hero card with description + color coding
- Direction + strength progress bar
- 3-column stat grid: Volatility | Session Quality | Context Risk
- Reason lists (regime/direction/volatility/session/risk)

**Alerts tab** (shows count of unacknowledged firings)
- `AlertsPanel`: create/toggle/delete alert rules
- Unacknowledged firing banner
- Full firing history

The header bar shows the regime badge and last-run timestamp. Loading all phase data uses `Promise.allSettled` so partial backend failures (e.g. no market state yet for a new symbol) don't break the page.

### Strategies

Strategy management page:
- List built-in strategies (edit instructions, cannot delete)
- Custom strategies (create, edit, delete with confirm)
- Form: name, key (auto-slug from name), description, instructions textarea
- Instructions are injected into the LLM system prompt for analysis

### Settings

- LLM provider + model selector (platform-wide and per-symbol)
- API key configuration (Anthropic, OpenRouter, Finnhub, Ollama URL)
- Claude.ai OAuth flow (import from CLI or browser OAuth)
- OpenAI OAuth flow
- MT5 bridge port/URL/key config
- Connection test buttons
- Log level selector

### Logs

Structured log viewer with:
- Real-time SSE log stream
- Filter by symbol key
- Level badges (info/warn/error/debug)
- Collapsible JSON data payloads

### Calendar

Economic calendar from Finnhub:
- Events grouped by day
- Impact level color coding (high/medium/low)
- Forecast vs actual vs previous values

---

## Key Components

### `MarketStatePanel`

Props: `{ state: MarketState }`

Renders market regime with color-coded styling. Uses `safeArr()` to defensively handle all reason arrays — missing/null arrays render as empty rather than throwing.

Regime color map: trend=green, range=sky, breakout_watch=yellow, reversal_watch=purple, volatile=red, compressed=muted.

### `SetupCandidatesPanel`

Props: `{ candidates: SetupCandidate[] }`

- Sorts by score descending, hero card for top found candidate
- Each `CandidateCard` has collapsible score breakdown (9 components + penalties)
- Tags, reasons (+), disqualifiers (✕) displayed inline
- `safeArr()` on all array fields

### `AlertsPanel`

Props: `{ symbolKey: string }`

- Fetches rules and firings via API on mount
- Create form: name, condition type dropdown, value
- Unacked firings show as amber banner with per-item Ack button

### `CandleChart`

Uses lightweight-charts v4. Receives `CandleBar[]` (time in Unix seconds). Key levels rendered as price lines.

---

## API Client (`api/client.ts`)

All functions return typed promises. Error responses are thrown as `Error` with the backend's `error` field as the message.

Key functions by category:

**Symbols:** `getSymbols`, `getSymbol`, `createSymbol`, `updateSymbol`, `deleteSymbol`, `searchSymbols`

**Analysis:** `getAnalyses`, `getLatestAnalysis`, `triggerAnalysis`, `getAnalysisById`

**Phase 2:** `getLatestFeatures`, `getLatestMarketState`, `getLatestSetups`

**Strategies:** `getStrategies`, `createStrategy`, `updateStrategy`, `deleteStrategy`

**Backtests:** `createBacktest`, `getBacktestRun`

**Research:** `getResearchLeaderboard`, `getSimilarAnalyses`

**Alerts:** `getAlerts`, `createAlert`, `toggleAlert`, `deleteAlert`, `getAlertFirings`, `acknowledgeAlert`

**System:** `getStatus`, `getSummary`, `getLogs`, `getCalendar`, `getDeepHealth`

---

## Types (`types/index.ts`)

Core types matching backend shapes exactly:

- `WatchSymbol` — symbol config
- `AnalysisResult` — full analysis with proposal, indicators, candles, context
- `MarketState` — regime, direction, volatility, sessionQuality, contextRisk + 5 reasons arrays
- `SetupCandidate` — detector output: found, direction, entry zone, SL, targets, score, tier, `ScoreBreakdown`
- `AlertRule` / `AlertFiring` — alert system types
- `BacktestRun` — backtest status + metrics

**Important enum values** (must match backend exactly):
- `VolatilityLevel`: `'quiet' | 'normal' | 'elevated' | 'abnormal'`
- `SessionQuality`: `'poor' | 'acceptable' | 'favorable' | 'optimal'`
- `ContextRisk`: `'low' | 'moderate' | 'elevated' | 'avoid'`
- `MarketRegime`: `'trend' | 'range' | 'breakout_watch' | 'reversal_watch' | 'volatile' | 'compressed'`
- `SetupTier`: `'valid' | 'watchlist' | 'low_quality' | 'rejected'`

---

## Tailwind Theme (Dark Terminal)

Custom design tokens in `tailwind.config.js`:

| Token | Purpose |
|---|---|
| `bg` | Page background |
| `surface` | Card background |
| `surface2` | Elevated surface |
| `border` | Default border |
| `text` | Primary text |
| `muted` | Secondary text |
| `muted2` | Tertiary text |
| `green` | Positive / bullish |
| `red` | Negative / bearish |
| `yellow` | Warning / neutral |
| `yellow-dim` | Yellow background tint |
