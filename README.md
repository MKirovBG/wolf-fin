# Wolf-Fin

A forex market analysis platform powered by MT5, technical indicators, and LLMs. Wolf-Fin runs a multi-phase pipeline on any watchlist symbol — computing features, classifying market state, detecting trade setups, scoring them, and generating an LLM-written narrative — all presented in a real-time React dashboard.

## Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 22+ with TypeScript (ESM) |
| API server | Fastify 5 |
| Database | SQLite via better-sqlite3 (WAL mode) |
| Scheduling | node-cron |
| Logging | pino (structured JSON) |
| LLM | Anthropic Claude / OpenRouter / Ollama / OpenAI (pluggable) |
| Frontend | React 18 + Vite + Tailwind CSS |
| Charts | lightweight-charts (TradingView) |
| MT5 data | Python FastAPI bridge (Windows, MetaTrader5 package) |
| News/calendar | Finnhub |

## Architecture

```
MT5 Terminal (Windows)
  └─► mt5-bridge/ (Python FastAPI, port 8000)
        └─► Node.js backend (Fastify, port 3000)
              ├─ Phase 1: computeFeatures() → classifyMarketState()
              ├─ Phase 2: 6 setup detectors + 9-component scoring engine
              ├─ Phase 3: strategy resolver (6 built-in + custom)
              ├─ Phase 4: bar-by-bar backtest engine
              ├─ Phase 5: similarity search, leaderboard aggregates, alert rules
              ├─ Phase 6: versioned migrations, graceful shutdown, integrity checks
              └─► React dashboard (Vite dev or built static)
```

### 6-Phase Analysis Pipeline

1. **Feature Engine** — computes ~40 indicators (EMA, RSI, ATR, BB, VWAP, MACD, ADX, Stoch, patterns, MTF, divergence, Fibonacci, Keltner, Ichimoku)
2. **Market State Classifier** — assigns regime (`trend/range/breakout_watch/reversal_watch/volatile/compressed`), direction + strength, volatility tier, session quality, context risk
3. **Setup Detectors** — 6 detectors run in parallel: `trendPullback`, `breakoutRetest`, `liquiditySweep`, `openingRange`, `rangeFade`, `sessionReversal`
4. **Scoring Engine** — each detector output is scored 0–100 across 9 components (trend alignment, structure quality, volatility fit, session, risk:reward, entry precision, confirmations, context clarity, pattern quality) with spread/news/context penalties
5. **LLM Narrative** — the highest-scoring valid setup is passed with full context to the LLM, which writes a structured trade proposal (direction, entry zone, SL, TPs, R:R, reasoning)
6. **Operational Layer** — alert rule evaluation, outcome tracking, log pruning, DB integrity checks

## Project Structure

```
wolf-fin/
  src/
    analyzer/        — orchestrates the full analysis pipeline per symbol
    adapters/        — MT5Adapter (candles, positions), calendar (Finnhub)
    db/              — SQLite persistence (index.ts, phase25.ts, migrations.ts)
    detectors/       — 6 setup detector implementations
    engine/          — feature computation (computeFeatures)
    llm/             — LLM provider adapters (Anthropic, OpenRouter, Ollama, OpenAI)
    market/          — market state classifier (classifyMarketState)
    research/        — similarity search, leaderboard aggregates
    scheduler/       — cron-based per-symbol scheduling
    scoring/         — 9-component scoring engine
    server/          — Fastify HTTP server + SSE
    strategies/      — strategy definitions + resolver
    backtest/        — bar-by-bar replay engine
    types/           — shared TypeScript types
  frontend/
    src/
      api/           — client.ts (all API calls)
      components/    — reusable UI (MarketStatePanel, SetupCandidatesPanel, AlertsPanel, etc.)
      pages/         — Dashboard, SymbolDetail (4 tabs), Strategies, Settings, Logs, Calendar
      types/         — frontend type definitions
  mt5-bridge/        — Python FastAPI MT5 proxy
  data/              — SQLite DB file (gitignored)
  docs/              — technical documentation
```

## Setup

### Prerequisites

- Node.js 22+
- pnpm
- Python 3.13+ with MetaTrader5 package (Windows only for live MT5 data)
- MetaTrader5 terminal open and logged in

### 1. Install dependencies

```bash
pnpm install
cd frontend && pnpm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env`:

```env
# LLM (at least one required)
ANTHROPIC_API_KEY=sk-ant-...
OPENROUTER_API_KEY=sk-or-...

# News/economic calendar (optional but recommended)
FINNHUB_KEY=...

# MT5 bridge
MT5_BRIDGE_PORT=8000
MT5_BRIDGE_KEY=           # optional shared secret

# Server
PORT=3000
LOG_LEVEL=info
```

### 3. Start the MT5 bridge

```bash
cd mt5-bridge
pip install fastapi uvicorn MetaTrader5
uvicorn main:app --host 127.0.0.1 --port 8000
```

### 4. Start the backend

```bash
pnpm dev          # tsx hot-reload
# or
pnpm build && pnpm start
```

### 5. Start the frontend

```bash
cd frontend
pnpm dev          # Vite dev server, port 5173
```

Open `http://localhost:5173` in your browser.

## Development

```bash
# Backend
pnpm dev          # hot reload via tsx
pnpm build        # compile to dist/
pnpm typecheck    # tsc --noEmit

# Frontend
cd frontend
pnpm dev          # Vite HMR
pnpm build        # production build → frontend/dist/
pnpm typecheck
```

The backend serves the built frontend as static files in production. In development, Vite proxies API calls to `localhost:3000`.

## LLM Providers

Wolf-Fin supports multiple LLM providers, configurable per-symbol or globally:

| Provider | Key required |
|---|---|
| `anthropic` | `ANTHROPIC_API_KEY` |
| `anthropic-subscription` | `CLAUDE_SESSION_TOKEN` (OAuth via UI) |
| `openrouter` | `OPENROUTER_API_KEY` |
| `ollama` | `OLLAMA_URL` (default: `http://localhost:11434`) |
| `openai-subscription` | OAuth via UI |

## Key Docs

- [MT5 Bridge](docs/mt5-bridge.md) — Python bridge setup, endpoints, multi-account
- [Backend API](docs/backend.md) — all REST endpoints
- [Database Schema](docs/database.md) — all 15 tables
- [Frontend](docs/frontend.md) — pages, components, state management
- [API Keys Setup](API_KEYS.md) — environment variable reference
