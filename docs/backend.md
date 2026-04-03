# Wolf-Fin — Backend Documentation

**Runtime:** Node.js 22 · TypeScript (ESM)
**Framework:** Fastify 5
**Entry point:** `src/main.ts` → `src/server/index.ts`
**Build:** `pnpm build` → compiled to `dist/`
**Default port:** `3000` (override with `PORT` env var)

---

## Startup Sequence (`src/main.ts`)

1. `initDb()` — opens SQLite, runs migrations, seeds built-in strategies
2. Log pruning — prune `log_entries` to 10,000 rows max
3. DB integrity check — PRAGMA integrity_check, warn on failure
4. `startServer()` — Fastify HTTP + static file serving
5. `syncSchedule()` — restore cron jobs for all symbols with `scheduleEnabled: true`

Process hardening: `SIGTERM`/`SIGINT` → graceful shutdown; `uncaughtException` → log + exit(1); `unhandledRejection` → log.

---

## Module Map

```
src/
  analyzer/       — runAnalysis(key): full pipeline per symbol
  adapters/
    mt5.ts        — MT5Adapter: fetch candles, positions via bridge
    calendar.ts   — Finnhub economic calendar + news
  backtest/
    engine.ts     — runBacktest(): bar-by-bar replay with fill simulation
  db/
    index.ts      — initDb(), all exported DB functions
    phase25.ts    — Phase 2-5 table operations (candidates, alerts, backtest, etc.)
    migrations.ts — versioned migration runner (12 migrations)
  detectors/      — 6 setup detector modules
  engine/         — computeFeatures(): ~40 technical indicators
  llm/            — provider adapters (Anthropic, OpenRouter, Ollama, OpenAI)
  market/         — classifyMarketState(): regime + direction + risk
  research/
    aggregates.ts — leaderboardByDetector/Session/Regime
    similarity.ts — findSimilarAnalyses(): cosine similarity on feature vectors
  scheduler/      — syncSchedule(), stopSchedule(), node-cron wrappers
  scoring/        — 9-component scoring engine
  server/
    index.ts      — all Fastify routes
    state.ts      — in-memory log buffer + SSE pub/sub
  strategies/
    resolver.ts   — resolveStrategyDefinition()
    definitions/  — 6 built-in strategy objects
  types/          — shared backend TypeScript types
```

---

## REST API Reference

All endpoints return JSON. Error responses: `{ "error": "message" }`.

### Watch Symbols

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/symbols` | List all watch symbols |
| `GET` | `/api/symbols/:key` | Get one symbol |
| `POST` | `/api/symbols` | Add symbol to watchlist |
| `PATCH` | `/api/symbols/:key` | Update symbol config |
| `DELETE` | `/api/symbols/:key` | Remove symbol |
| `GET` | `/api/symbols/search?q=&accountId=` | Search MT5 symbols via bridge |

### Analysis

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/symbols/:key/analyze` | Trigger analysis (async, fires SSE on complete) |
| `GET` | `/api/symbols/:key/analyses` | Analysis history (default limit 50) |
| `GET` | `/api/symbols/:key/analyses/latest` | Most recent analysis |
| `GET` | `/api/symbols/:key/running` | Whether analysis is in progress |
| `GET` | `/api/symbols/:key/prompt` | Preview effective system prompt |
| `GET` | `/api/analyses` | All recent analyses (cross-symbol, limit 100) |
| `GET` | `/api/analyses/:id` | Single analysis by ID |
| `GET` | `/api/symbols/:key/candles?timeframe=&count=` | Live candles from MT5 bridge |
| `GET` | `/api/symbols/:key/backtest?minRR=` | Simple proposal backtest (stored analyses) |

### Phase 2 — Feature & Market State Snapshots

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/symbols/:key/features/latest` | Latest feature snapshot |
| `GET` | `/api/symbols/:key/state/latest` | Latest market state classification |
| `GET` | `/api/symbols/:key/setups/latest` | Latest setup candidates (all 6 detectors) |

### Phase 3 — Strategies

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/strategies` | List all strategies (built-in + custom) |
| `POST` | `/api/strategies` | Create custom strategy |
| `PATCH` | `/api/strategies/:key` | Update strategy |
| `DELETE` | `/api/strategies/:key` | Delete custom strategy (built-ins protected) |
| `GET` | `/api/strategies/:key/versions` | Strategy version history |

### Phase 4 — Backtesting

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/backtests` | Start backtest run (async, 202 response) |
| `GET` | `/api/backtests/:id` | Poll backtest run status/metrics |

`POST /api/backtests` body: `{ symbolKey, strategyKey?, timeframe?, count? }`

### Phase 5 — Research & Alerts

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/research/leaderboard?symbolKey=` | Detector/session/regime performance leaderboard |
| `GET` | `/api/research/similar/:analysisId` | Find historically similar analyses |
| `POST` | `/api/alerts` | Create alert rule |
| `GET` | `/api/alerts?symbolKey=` | List alert rules |
| `PATCH` | `/api/alerts/:id` | Toggle alert rule enabled/disabled |
| `DELETE` | `/api/alerts/:id` | Delete alert rule |
| `GET` | `/api/alerts/firings?symbolKey=&limit=` | Alert firing history |
| `POST` | `/api/alerts/firings/:id/acknowledge` | Acknowledge a firing |

Alert `conditionType` values: `setup_score_gte`, `regime_change`, `direction_change`, `context_risk_gte`

### Accounts & MT5

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/accounts` | MT5 accounts (merged bridge + DB) |
| `GET` | `/api/mt5-accounts` | Raw MT5 account list from bridge |
| `GET` | `/api/accounts/:id/positions` | Open positions for account |
| `GET` | `/api/mt5/health` | MT5 bridge health pass-through |

### LLM Configuration

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/platform-llm` | Current platform LLM provider + model |
| `POST` | `/api/platform-llm` | Set platform LLM provider + model |
| `GET` | `/api/anthropic/models` | Available Anthropic models |
| `GET` | `/api/openrouter/models` | Available OpenRouter models |
| `GET` | `/api/ollama/models` | Available Ollama models |
| `GET` | `/api/keys` | Which API keys are set (booleans) |
| `POST` | `/api/keys` | Set API keys |
| `POST` | `/api/test-connection` | Test connectivity to a service |

### Auth (OAuth PKCE)

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/auth/claude/start` | Begin Claude OAuth PKCE flow |
| `POST` | `/api/auth/claude/exchange` | Exchange code for token |
| `POST` | `/api/auth/claude/import-from-cli` | Import token from Claude Code CLI |
| `GET` | `/api/auth/openai/start` | Begin OpenAI OAuth PKCE flow |
| `POST` | `/api/auth/openai/exchange` | Exchange code for token |
| `POST` | `/api/auth/openai/refresh` | Refresh OpenAI token |

### System & Misc

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/status` | Dashboard: symbols + recent analyses + scheduled keys |
| `GET` | `/api/summary` | Symbol bias heatmap data |
| `GET` | `/api/scheduled` | Currently scheduled symbol keys |
| `GET` | `/api/calendar` | Economic calendar events (Finnhub) |
| `GET` | `/api/logs?sinceId=&symbolKey=&limit=` | Log entries |
| `GET` | `/api/logs/stream` | SSE: real-time log stream |
| `GET` | `/api/analyses/stream` | SSE: analysis completion events |
| `GET` | `/api/outcomes?symbolKey=&limit=` | Proposal outcomes |
| `GET` | `/api/outcomes/stats?symbolKey=` | Win rate / outcome stats |
| `GET` | `/api/outcomes/pending` | Pending outcomes |
| `GET` | `/api/config` | Bridge + runtime config |
| `POST` | `/api/config` | Update bridge port/URL/key, log level |
| `GET` | `/api/selected-account` | Persisted selected account |
| `POST` | `/api/selected-account` | Save selected account |
| `GET` | `/api/system/health/deep` | Deep health (MT5, LLM, Finnhub, DB integrity, migrations) |

---

## SSE Events

**`GET /api/logs/stream`** — emits `LogEntry` objects as `data: {...}\n\n`

**`GET /api/analyses/stream`** — emits `{ symbolKey: string, analysisId: number }` when an analysis completes

---

## Analysis Pipeline (`src/analyzer/index.ts`)

`runAnalysis(symbolKey)`:
1. Fetch candles from MT5 bridge
2. Fetch news + calendar from Finnhub (if key set)
3. Fetch current price (bid/ask/spread)
4. `computeFeatures(candles, indicators)` → `FeatureSnapshot`
5. `classifyMarketState(features, context)` → `MarketState`
6. Run 6 detectors in parallel → `SetupCandidate[]`
7. Score each candidate (9 components + penalties)
8. Select top valid candidate → build LLM prompt
9. Call LLM → parse `AnalysisResult` (bias, summary, keyLevels, tradeProposal)
10. Persist: features, market state, candidates, analysis to DB
11. Evaluate alert rules → fire matching alerts
12. Broadcast SSE update
