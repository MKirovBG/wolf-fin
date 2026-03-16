# Wolf-Fin — Backend Documentation

**Runtime:** Node.js 22 · TypeScript · Fastify
**Entry point:** `src/main.ts` → `src/server/index.ts`
**Build:** `npm run build` → compiled to `dist/`
**Start:** `npm start` (runs `dist/main.js`)

---

## Architecture Overview

```
src/
├── main.ts                  Bootstrap, DB init, risk state hydration
├── server/
│   ├── index.ts             Fastify HTTP server + all REST endpoints
│   └── state.ts             In-memory agent state + SQLite persistence
├── agent/
│   ├── index.ts             Autonomous trading cycle (LLM loop)
│   └── context.ts           Market enrichment context builder
├── scheduler/
│   └── index.ts             Per-agent cron task manager
├── adapters/
│   ├── interface.ts         IMarketAdapter abstract interface
│   ├── registry.ts          Adapter factory (crypto/forex/mt5)
│   ├── types.ts             Shared data models (Candle, Order, Snapshot…)
│   ├── binance.ts           Binance Spot adapter
│   ├── alpaca.ts            Alpaca Forex adapter
│   ├── mt5.ts               MetaTrader5 adapter (HTTP bridge client)
│   ├── indicators.ts        Technical indicator computations (RSI, EMA, ATR…)
│   ├── session.ts           Forex market hours detection
│   ├── twelvedata.ts        Twelve Data candle/quote source
│   ├── feargreed.ts         Alternative.me Fear & Greed index
│   ├── coingecko.ts         CoinGecko macro market data
│   ├── cryptopanic.ts       CryptoPanic news headlines
│   └── calendar.ts          Finnhub economic calendar
├── guardrails/
│   ├── index.ts             Barrel export
│   ├── validate.ts          Crypto order validation
│   ├── forex.ts             Forex order validation
│   ├── mt5.ts               MT5 order validation
│   ├── riskStateStore.ts    Per-market daily P&L tracking
│   └── riskState.ts         Backward-compat shim (crypto only)
├── llm/
│   ├── types.ts             LLMProvider interface
│   ├── anthropic.ts         Anthropic SDK wrapper
│   ├── openrouter.ts        OpenRouter (OpenAI-compat) wrapper
│   └── index.ts             Factory: getLLMProvider(), getModelForConfig()
├── tools/
│   └── definitions.ts       Anthropic tool schemas (6 trading tools)
├── db/
│   └── index.ts             SQLite ORM layer (better-sqlite3)
└── types.ts                 Domain types (AgentConfig, AgentState, CycleResult…)
```

---

## REST API Reference

**Base URL:** `http://localhost:3000` (configurable via `PORT` env)

### Status

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/status` | Full app status — agents, recent cycles, risk state, loss limit |

**Response `StatusResponse`:**
```json
{
  "agents": { "mt5:XAUUSD": { "config": {}, "status": "running", "cycleCount": 42 } },
  "recentEvents": [ { "symbol": "XAUUSD", "decision": "SELL", "reason": "…" } ],
  "risk": { "dailyPnlUsd": -45, "remainingBudgetUsd": 155 },
  "maxDailyLossUsd": 200
}
```

---

### Agents

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/agents` | List all agents |
| `POST` | `/api/agents` | Create a new agent |
| `DELETE` | `/api/agents/:key` | Delete agent by key (`market:symbol`) |
| `PATCH` | `/api/agents/:key/config` | Update agent configuration |
| `POST` | `/api/agents/:key/start` | Start agent (creates scheduler) |
| `POST` | `/api/agents/:key/pause` | Pause agent (suspends cron) |
| `POST` | `/api/agents/:key/stop` | Stop agent (removes cron, idle) |
| `POST` | `/api/agents/:key/trigger` | Manually fire one cycle immediately |

**Agent key format:** `"market:symbol"` e.g. `"mt5:XAUUSD"`, `"crypto:BTCUSDT"`

**`AgentConfig` shape:**
```typescript
{
  symbol: string               // e.g. "XAUUSD"
  market: 'crypto'|'forex'|'mt5'
  paper: boolean               // true = simulate, false = live orders
  maxIterations: number        // LLM tool-use iterations per cycle (default 10)
  fetchMode: 'manual'|'scheduled'|'autonomous'
  scheduleIntervalMinutes: number
  maxLossUsd: number           // Per-agent daily loss cap
  maxPositionUsd: number       // Max single position size
  customPrompt?: string        // Appended to system prompt as ADDITIONAL INSTRUCTIONS
  mt5AccountId?: number        // Which MT5 account to trade (multi-account)
  llmProvider?: 'anthropic'|'openrouter'
  llmModel?: string            // e.g. "openrouter/healer-alpha"
}
```

---

### Market Data

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/market/:market/:symbol` | Live snapshot (price, candles, indicators, account) |

---

### Accounts & Positions

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/accounts` | All connected exchange accounts (Alpaca, Binance, MT5) |
| `GET` | `/api/mt5-accounts` | MT5 accounts list for agent dropdown |
| `GET` | `/api/positions` | Open positions across all running agents |
| `GET` | `/api/trades` | Trade fill history |

---

### API Keys

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/keys` | Which keys are configured (values masked) |
| `POST` | `/api/keys` | Persist a key to `.env` file |
| `POST` | `/api/keys/test/:service` | Test connectivity for a service |

**Testable services:** `anthropic`, `openrouter`, `alpaca`, `binance`, `finnhub`, `twelvedata`, `coingecko`

---

### Logs

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/logs?sinceId=&agent=` | Paginated logs (default 200 per page) |
| `POST` | `/api/logs/clear` | Set log clear floor (hides old entries) |

---

### Reports

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/reports/summary` | Aggregated stats by market (buys/sells/holds/errors, P&L) |
| `GET` | `/api/reports/trades?market=` | Full cycle history with optional market filter |

---

### OpenRouter

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/openrouter/models` | List all available OpenRouter models |

---

## Agent Cycle — Data Flow

```
POST /api/agents/:key/trigger
  └─► runAgentCycle(config)
        │
        ├─ 1. Risk gate check (isDailyLimitHitFor)
        │       └─ If hit → HOLD immediately, log guardrail_block
        │
        ├─ 2. Build system prompt
        │       ├─ Market type context (crypto/forex/mt5 rules)
        │       ├─ MAX_SPREAD_PIPS, MIN_STOP_PIPS from env
        │       ├─ Last 5 cycle performance from DB
        │       └─ customPrompt appended as ADDITIONAL INSTRUCTIONS
        │
        ├─ 3. LLM iteration loop (up to maxIterations)
        │       ├─ Send messages to LLM (Anthropic or OpenRouter)
        │       ├─ If stop_reason == 'end_turn' → extract DECISION
        │       └─ If stop_reason == 'tool_use':
        │               ├─ get_snapshot    → adapter.getSnapshot()
        │               ├─ get_order_book  → adapter.getOrderBook()
        │               ├─ get_recent_trades → adapter.getRecentTrades()
        │               ├─ get_open_orders → adapter.getOpenOrders()
        │               ├─ place_order     → guardrail → adapter.placeOrder()
        │               └─ cancel_order    → adapter.cancelOrder()
        │
        ├─ 4. Auto-execute safety net
        │       └─ If DECISION=BUY/SELL but no place_order was called
        │              → auto-place with ATR-based stop
        │
        ├─ 5. Extract DECISION + REASON from final text
        │
        └─ 6. Record cycle result to DB, update agent state
```

---

## Agent Tools (6 Total)

Defined in `src/tools/definitions.ts` as Anthropic tool schemas.

| Tool | Input | What it does |
|------|-------|-------------|
| `get_snapshot` | `{ symbol, market }` | Full market data: price, 4× candles (100 bars each: M1/M15/H1/H4), H1 indicators, account balances, open orders, risk state, enrichment context |
| `get_order_book` | `{ symbol, market, depth? }` | Bid/ask ladder up to requested depth |
| `get_recent_trades` | `{ symbol, market, limit? }` | Public tape — recent executed trades |
| `get_open_orders` | `{ symbol?, market }` | All open positions/pending orders |
| `place_order` | `{ symbol, market, side, type, quantity, price?, stopPips?, timeInForce? }` | Place a trade. Runs guardrail before execution. `stopPips` → converted to absolute SL price |
| `cancel_order` | `{ symbol, market, orderId }` | Cancel pending order by ID |

**Snapshot indicators (computed from H1 candles):**
- `rsi14` — RSI(14): <30 oversold, >70 overbought
- `ema20`, `ema50` — EMA crossover for trend direction
- `atr14` — ATR(14) for stop sizing
- `vwap` — Volume-weighted average price
- `bbWidth` — Bollinger Band width ÷ midline (volatility proxy)

---

## LLM Providers

### Anthropic (default)
- Uses `@anthropic-ai/sdk` directly
- Model: `CLAUDE_MODEL` env (default `claude-opus-4-5-20251101`)
- API key: `ANTHROPIC_API_KEY`

### OpenRouter
- OpenAI-compatible REST API at `https://openrouter.ai/api/v1/chat/completions`
- Message format translated: Anthropic → OpenAI → back to Anthropic canonical
- API key: `OPENROUTER_API_KEY` (set via Settings page)
- Model: per-agent `llmModel` field (e.g. `openrouter/healer-alpha`)
- Any model listed at `GET /api/openrouter/models` can be selected

**Provider selection per agent:**
```typescript
// src/llm/index.ts
getLLMProvider(config) → AnthropicProvider | OpenRouterProvider
getModelForConfig(config) → string  // model name sent to LLM
```

---

## Guardrails — Order Validation

Every `place_order` call passes through market-specific validation **before** the order reaches the exchange.

### Crypto (`src/guardrails/validate.ts`)
| Check | Limit | Env var |
|-------|-------|---------|
| Daily loss gate | $200 | `MAX_DAILY_LOSS_USD` |
| Minimum qty | 0.00001 | hardcoded |
| Minimum notional | $10 | hardcoded |
| Maximum position | $1000 | `MAX_POSITION_USD` |
| Remaining budget | dynamic | computed |

### Forex + MT5 (`src/guardrails/forex.ts`, `mt5.ts`)
| Check | Default | Env var |
|-------|---------|---------|
| Daily loss gate | $200 | `MAX_DAILY_LOSS_USD` |
| Session open | required | — |
| Max spread | 3 pips | `MAX_SPREAD_PIPS` |
| Minimum stop | 10 pips | `MIN_STOP_PIPS` |
| Pip risk × qty ≤ budget | computed | — |
| Combined notional cap | $2000 | `MAX_COMBINED_NOTIONAL_USD` |

> **XAUUSD note:** Set `MAX_SPREAD_PIPS=100` in `.env` — gold spreads are 20–80 pips equivalent.

---

## Scheduler Modes

| `fetchMode` | Behaviour |
|-------------|-----------|
| `manual` | Sets status to running; cycles only fire on manual trigger |
| `scheduled` | node-cron at `*/N * * * *` where N = `scheduleIntervalMinutes` |
| `autonomous` | Same as scheduled, but forex agents skip if `isForexSessionOpen()` is false |

---

## Technical Indicators (`src/adapters/indicators.ts`)

| Function | Algorithm | Default period |
|----------|-----------|----------------|
| `rsi(candles, period)` | Wilder RSI | 14 |
| `ema(candles, period)` | Exponential MA | — |
| `atr(candles, period)` | Wilder ATR (True Range smoothed) | 14 |
| `vwap(candles)` | Sum(typical×vol) / Sum(vol) | — |
| `bbWidth(candles, period, mult)` | (upper−lower) / middle | 20, ×2 |
| `computeIndicators(h1)` | Calls all above, returns `Indicators` | — |

---

## External Data Sources

| Source | Used for | Auth |
|--------|----------|------|
| Binance REST + SDK | Crypto candles, quotes, orders | `BINANCE_API_KEY` + `BINANCE_SECRET` |
| Alpaca REST | Forex paper/live orders | `ALPACA_KEY` + `ALPACA_SECRET` |
| Twelve Data REST | Forex candles + quotes (primary) | `TWELVE_DATA_KEY` (8 req/min free) |
| MetaTrader5 bridge | MT5 data + orders | bridge on `localhost:8000` |
| Alternative.me | Fear & Greed index | none |
| CoinGecko | BTC dominance + market cap | optional `COINGECKO_KEY` |
| CryptoPanic | Crypto news headlines | `CRYPTOPANIC_KEY` |
| Finnhub | Economic event calendar | `FINNHUB_KEY` |
| OpenRouter | Alternative LLM provider | `OPENROUTER_API_KEY` |

---

## Environment Variables

```env
# Server
PORT=3000

# LLM
ANTHROPIC_API_KEY=sk-ant-…
CLAUDE_MODEL=claude-opus-4-5-20251101
OPENROUTER_API_KEY=sk-or-…

# Crypto
BINANCE_API_KEY=…
BINANCE_SECRET=…

# Forex
ALPACA_KEY=…
ALPACA_SECRET=…
ALPACA_PAPER=true
TWELVE_DATA_KEY=…

# MT5
MT5_BRIDGE_PORT=8000

# Market data enrichment
FINNHUB_KEY=…
COINGECKO_KEY=…
CRYPTOPANIC_KEY=…

# Risk controls
MAX_DAILY_LOSS_USD=200
MAX_POSITION_USD=1000
MAX_COMBINED_NOTIONAL_USD=2000
MAX_SPREAD_PIPS=3         # Set to 100 for XAUUSD
MIN_STOP_PIPS=10
```

---

## State Management (`src/server/state.ts`)

```
AppState (in-memory)
├── agents: Record<key, AgentState>   ← synced to DB on every change
│     └── AgentState { config, status, lastCycle, startedAt, cycleCount }
└── recentEvents: CycleResult[]       ← last 50 cycles in memory

Cycle Lock Map                         ← prevents duplicate concurrent cycles
└── Map<agentKey, boolean>

Log Buffer                             ← last 500 entries in memory
└── LogEntry[]
```

Key functions:
- `tryAcquireCycleLock(key)` → `false` if already running (triggers `cycle_skip` log)
- `releaseCycleLock(key)` → called in finally block of `runAgentCycle`
- `logEvent(agentKey, level, event, message, data)` → written to DB + memory buffer

---

## Paper vs Live Trading

| Mode | `paper: true` | `paper: false` |
|------|---------------|----------------|
| Order result | `PAPER_FILLED` (simulated, no real order) | Real exchange order via adapter |
| Cycle log tag | `[PAPER]` | `[LIVE]` |
| DB record | Saved with `paper=1` | Saved with `paper=0` |
| Guardrails | Still run (risk limits enforced) | Still run |

Toggle via:
1. Agent Configuration panel in the UI
2. Direct DB update: `UPDATE agents SET config = json_set(config, '$.paper', false) WHERE key = 'mt5:XAUUSD'`
