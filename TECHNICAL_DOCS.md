# Wolf-Fin — Technical Reference

> This document is a high-level technical reference. Detailed docs are in `docs/`.

---

## Overview

Wolf-Fin is a forex market analysis platform that runs a multi-phase automated pipeline on MT5 symbols, produces LLM-written trade proposals, and presents results in a React dashboard.

**Key constraint:** The MT5 Python bridge requires Windows (MetaTrader5 Python package is Windows-only). The Node.js backend and React frontend run anywhere.

---

## Architecture

```
[MetaTrader5 Terminal]
        │ MetaTrader5 Python API
        ▼
[mt5-bridge/] ← Python FastAPI, port 8000
        │ HTTP REST
        ▼
[src/] ← Node.js 22 + TypeScript + Fastify, port 3000
  ├── analyzer/      6-phase pipeline per symbol
  ├── engine/        computeFeatures (~40 indicators)
  ├── market/        classifyMarketState
  ├── detectors/     6 setup detectors
  ├── scoring/       9-component scoring engine
  ├── llm/           provider adapters
  ├── backtest/      bar-by-bar replay
  ├── research/      similarity + leaderboard
  ├── db/            SQLite (15 tables, versioned migrations)
  └── server/        Fastify REST + SSE
        │ static files / API proxy
        ▼
[frontend/] ← React 18 + Vite + Tailwind CSS, port 5173 (dev)
```

---

## Analysis Pipeline

Each `runAnalysis(symbolKey)` call runs these phases in order:

### Phase 1 — Feature Extraction & Market Classification

`computeFeatures(candles, config)` returns a `FeatureSnapshot`:
- EMA fast/slow (configurable periods), EMA200
- RSI (configurable period)
- ATR (configurable period)
- Bollinger Bands (period + stddev)
- VWAP
- MACD (line, signal, histogram)
- ADX + DI+/DI-
- Stochastic K/D
- Parabolic SAR
- Ichimoku (tenkan, kijun, senkou A/B)
- CCI, Williams %R
- OBV, MFI (volume indicators)
- Keltner Channels
- Multi-timeframe (MTF) bias overlay
- Divergence detection
- Fibonacci retracement levels
- Candlestick pattern recognition

`classifyMarketState(features, context)` returns `MarketState`:
- `regime`: `trend | range | breakout_watch | reversal_watch | volatile | compressed`
- `direction`: `bullish | bearish | neutral`
- `directionStrength`: 0–100
- `volatility`: `quiet | normal | elevated | abnormal`
- `sessionQuality`: `poor | acceptable | favorable | optimal`
- `contextRisk`: `low | moderate | elevated | avoid`
- Five reasons arrays (regime, direction, volatility, session, risk)

### Phase 2 — Setup Detection & Scoring

Six detectors run in parallel, each returning a `SetupCandidate`:
- `trendPullback` — pullback to EMA in trending regime
- `breakoutRetest` — retest of broken structure level
- `liquiditySweep` — stop hunt followed by reversal
- `openingRange` — London/NY open range breakout
- `rangeFade` — fade at range extremes
- `sessionReversal` — session transition reversal signals

**Scoring (0–100):**
| Component | Weight |
|---|---|
| Trend Alignment | 15 |
| Structure Quality | 15 |
| Volatility Fit | 10 |
| Session Quality | 10 |
| Risk:Reward | 15 |
| Entry Precision | 10 |
| Confirmations | 10 |
| Context Clarity | 10 |
| Pattern Quality | 5 |

Penalties: spread, high-impact news proximity, elevated context risk.

**Tiers:**
- `valid` ≥ 65 — passed to LLM
- `watchlist` 45–64
- `low_quality` 25–44
- `rejected` < 25

### Phase 3 — LLM Narrative

The highest-scoring valid setup is assembled with full context (features, market state, key levels, news, session info, active strategy instructions) into a system prompt. The LLM returns:
```json
{
  "bias": "bullish|bearish|neutral",
  "summary": "...",
  "keyLevels": [...],
  "tradeProposal": {
    "direction": "BUY|SELL",
    "entryZone": { "low": 0, "high": 0 },
    "stopLoss": 0,
    "takeProfits": [0, 0],
    "riskReward": 0,
    "reasoning": "...",
    "confidence": "high|medium|low",
    "invalidatedIf": "..."
  }
}
```

Supported LLM providers: Anthropic, OpenRouter, Ollama, OpenAI (subscription OAuth).

### Phase 4 — Backtesting

`runBacktest({ config, candles, strategy })` replays historical bars:
- Identifies entry conditions from strategy definition
- Simulates fill when price enters entry zone
- Tracks to TP1 or SL
- Returns `BacktestMetrics` (total trades, win rate, avg R:R, profit factor)

### Phase 5 — Research & Alerts

**Similarity search:** `findSimilarAnalyses(current, history)` — cosine similarity on feature vectors to find historically similar market conditions.

**Leaderboard:** aggregates setup candidate scores by detector, session, and regime to identify which configurations perform best.

**Alert rules:** 4 condition types evaluated after every analysis:
- `setup_score_gte` — any setup candidate scores above threshold
- `regime_change` — market regime changed from last analysis
- `direction_change` — direction changed
- `context_risk_gte` — context risk at or above level

### Phase 6 — Operational Hardening

- Versioned migrations via `schema_migrations` table
- Log pruning on startup (keeps 10,000 most recent entries)
- SQLite `PRAGMA integrity_check` on startup
- Graceful shutdown on SIGTERM/SIGINT
- `uncaughtException` handler (log + exit)
- `unhandledRejection` handler (log only)
- Deep health endpoint: `GET /api/system/health/deep`

---

## Strategies

Six built-in strategies (cannot be deleted):

| Key | Name | Focus |
|---|---|---|
| `price_action` | Price Action | Candlestick patterns, market structure, swing points |
| `ict` | ICT / SMC | Order Blocks, FVG, BOS/CHoCH, liquidity, OTE |
| `trend` | Trend Following | EMA alignment, pullbacks, momentum |
| `swing` | Swing Trading | Multi-session holds, major S/R, 3:1+ R:R |
| `scalping` | Scalping | Micro-structure, tight stops, staged targets |
| `smc` | Smart Money | Supply/demand zones, premium/discount, BMS |

Custom strategies can be created, edited, and versioned via the Strategies page or API.

---

## MT5 Bridge

The Python bridge (`mt5-bridge/main.py`) is a thin FastAPI wrapper around the `MetaTrader5` Python package. It exposes:

- `GET /health` — connection status
- `GET /candles/{symbol}?timeframe=&count=` — OHLCV bars
- `GET /positions` — open positions
- `GET /accounts` — registered accounts
- `GET /symbols?search=` — symbol search

See [docs/mt5-bridge.md](docs/mt5-bridge.md) for full reference.

Multi-account support: `?accountId={login}` parameter on any request switches the active MT5 login before the operation.

---

## Database

SQLite at `data/wolf-fin.db`. 15 tables, 12 versioned migrations.

See [docs/database.md](docs/database.md) for full schema.

Key tables:
- `watch_symbols` — monitored symbols + config
- `analyses` — full analysis results
- `analysis_features` / `market_states` / `setup_candidates` — Phase 1-2 output
- `strategies` / `strategy_versions` — strategy management
- `backtest_runs` / `backtest_trades` — Phase 4 results
- `alert_rules` / `alert_firings` — Phase 5 alerts
- `proposal_outcomes` — outcome tracking

---

## REST API

See [docs/backend.md](docs/backend.md) for the full endpoint reference.

**Base URL:** `http://localhost:3000`

Key endpoint groups:
- `/api/symbols` — CRUD + analysis trigger
- `/api/symbols/:key/features/latest` — Phase 1 features
- `/api/symbols/:key/state/latest` — Phase 1 market state
- `/api/symbols/:key/setups/latest` — Phase 2 setup candidates
- `/api/strategies` — strategy management
- `/api/backtests` — Phase 4 backtest runs
- `/api/research/leaderboard` — Phase 5 aggregates
- `/api/alerts` / `/api/alerts/firings` — Phase 5 alerts
- `/api/system/health/deep` — Phase 6 health

---

## Frontend

React 18 + Vite + Tailwind CSS. Dark terminal theme with custom design tokens.

See [docs/frontend.md](docs/frontend.md) for full documentation.

Key pages: Dashboard, SymbolDetail (4 tabs: Analysis | Setups | Market State | Alerts), Strategies, Settings, Logs, Calendar.

The frontend communicates entirely via the REST API + SSE streams. No shared state between pages; each page fetches its own data.

---

## Environment Variables

See [API_KEYS.md](API_KEYS.md) for the full reference.

Required: at least one LLM API key + MT5 bridge running.
Optional: `FINNHUB_KEY` for news/calendar context.

---

## Development Workflow

```bash
# Terminal 1: MT5 bridge (Windows)
cd mt5-bridge && uvicorn main:app --reload --port 8000

# Terminal 2: Backend
pnpm dev

# Terminal 3: Frontend
cd frontend && pnpm dev
```

Backend hot-reloads via tsx watch. Frontend hot-reloads via Vite HMR.

For production: `pnpm build && pnpm start` (serves frontend/dist/ as static files).
