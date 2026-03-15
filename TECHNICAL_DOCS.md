# Wolf-Fin Technical Documentation

> Complete reference for the Wolf-Fin autonomous AI trading platform.

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Architecture Diagram](#2-architecture-diagram)
3. [Environment Configuration](#3-environment-configuration)
4. [Database Layer](#4-database-layer)
5. [Adapter System](#5-adapter-system)
   - 5.1 [IMarketAdapter Interface](#51-imarketadapter-interface)
   - 5.2 [Binance Adapter (Crypto)](#52-binance-adapter-crypto)
   - 5.3 [Alpaca Adapter (Forex)](#53-alpaca-adapter-forex)
   - 5.4 [Technical Indicators](#54-technical-indicators)
   - 5.5 [Market Enrichment](#55-market-enrichment)
6. [Agent System](#6-agent-system)
   - 6.1 [Agent Configuration](#61-agent-configuration)
   - 6.2 [The Agent Cycle Loop](#62-the-agent-cycle-loop)
   - 6.3 [Claude Tool Definitions](#63-claude-tool-definitions)
   - 6.4 [System Prompt Construction](#64-system-prompt-construction)
7. [Guardrails & Risk Management](#7-guardrails--risk-management)
   - 7.1 [Crypto Validation](#71-crypto-validation)
   - 7.2 [Forex Validation](#72-forex-validation)
   - 7.3 [Per-Market Risk State](#73-per-market-risk-state)
8. [Scheduler](#8-scheduler)
9. [HTTP API Server](#9-http-api-server)
   - 9.1 [All Endpoints](#91-all-endpoints)
   - 9.2 [API Key Testing](#92-api-key-testing)
   - 9.3 [Startup Connectivity Check](#93-startup-connectivity-check)
10. [In-Memory State & Logging](#10-in-memory-state--logging)
11. [Frontend](#11-frontend)
    - 11.1 [Routing](#111-routing)
    - 11.2 [Pages](#112-pages)
    - 11.3 [Key Components](#113-key-components)
    - 11.4 [API Client](#114-api-client)
12. [Data Flow: End-to-End Agent Cycle](#12-data-flow-end-to-end-agent-cycle)
13. [Paper Trading vs Live Trading](#13-paper-trading-vs-live-trading)
14. [Known Limitations & Notes](#14-known-limitations--notes)

---

## 1. System Overview

Wolf-Fin is an autonomous AI trading platform that uses **Claude** (Anthropic) as the decision-making brain. Claude calls a set of tools to gather market data, review its account state, and optionally place or cancel orders. The system supports two markets:

| Market | Exchange | Adapter |
|--------|----------|---------|
| Crypto | Binance  | `BinanceAdapter` |
| Forex  | Alpaca   | `AlpacaAdapter`  |

Each market is handled by an independent **agent** — a named configuration that runs on a schedule (or manually). Multiple agents can run simultaneously (e.g., `crypto:BTCUSDT` and `forex:EURUSD`).

**Technology stack:**

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js (ESM, TypeScript) |
| AI     | Anthropic SDK (`@anthropic-ai/sdk`) |
| Crypto data/trading | `binance` npm package + custom HMAC-SHA256 REST |
| Forex data/trading | Alpaca REST API (no SDK) |
| HTTP server | Fastify |
| Database | SQLite via `better-sqlite3` (WAL mode) |
| Scheduler | `node-cron` |
| Frontend | React + Vite + Tailwind |
| Frontend routing | React Router v6 |

---

## 2. Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                          FRONTEND (React)                        │
│  Dashboard │ Agents │ AgentDetail │ Positions │ ApiKeys │ Reports │
└────────────────────────────┬────────────────────────────────────┘
                             │ HTTP (REST)
┌────────────────────────────▼────────────────────────────────────┐
│                     FASTIFY HTTP SERVER                          │
│  /api/agents  /api/logs  /api/positions  /api/keys  /api/reports │
└──────────┬─────────────────┬──────────────────┬─────────────────┘
           │                 │                  │
    ┌──────▼──────┐   ┌──────▼──────┐   ┌──────▼──────┐
    │  SCHEDULER  │   │  APP STATE  │   │   SQLITE DB  │
    │ (node-cron) │   │ (in-memory) │   │ (WAL mode)  │
    └──────┬──────┘   └─────────────┘   └─────────────┘
           │
    ┌──────▼──────────────────────────────────────────────┐
    │                  AGENT CYCLE LOOP                    │
    │   Build prompt → Call Claude → Dispatch tools        │
    │   → Guardrail check → Execute → Log result           │
    └──────┬──────────────────────────┬───────────────────┘
           │                          │
    ┌──────▼──────┐           ┌───────▼───────┐
    │  CLAUDE API  │           │   GUARDRAILS  │
    │ (tool_use)  │           │  Risk limits  │
    └─────────────┘           └───────────────┘
           │
    ┌──────▼──────────────────────────────────────────────┐
    │                    ADAPTERS                          │
    │  BinanceAdapter (crypto)   AlpacaAdapter (forex)    │
    │  - getSnapshot()           - getSnapshot()           │
    │  - placeOrder()            - placeOrder()            │
    │  - cancelOrder()           - cancelOrder()           │
    └──────┬──────────────────────────┬───────────────────┘
           │                          │
    ┌──────▼──────┐           ┌───────▼───────┐
    │  BINANCE API │           │  ALPACA API   │
    │ REST + WS   │           │  REST only    │
    └─────────────┘           └───────────────┘
```

---

## 3. Environment Configuration

All configuration is in `.env` at the project root.

```bash
# ── Anthropic ──────────────────────────────────────────
ANTHROPIC_API_KEY=sk-ant-...
CLAUDE_MODEL=claude-haiku-4-5-20251001   # cheaper for dev; switch to claude-opus-4-6 for live

# ── Binance (Crypto) ───────────────────────────────────
BINANCE_API_KEY=...
BINANCE_API_SECRET=...
BINANCE_TESTNET=false   # set true to use testnet.binance.vision

# ── Alpaca (Forex) ─────────────────────────────────────
ALPACA_API_KEY=...              # live trading keys
ALPACA_API_SECRET=...
ALPACA_BASE_URL=https://api.alpaca.markets

ALPACA_PAPER_KEY=...            # paper trading keys
ALPACA_PAPER_SECRET=...
ALPACA_PAPER_URL=https://paper-api.alpaca.markets
ALPACA_PAPER=true               # master paper mode override

# ── Enrichment (optional) ──────────────────────────────
FINNHUB_KEY=...                 # news and events
TWELVE_DATA_KEY=...             # forex fallback data
COINGECKO_KEY=CG-...            # demo key (starts CG-); leave blank for free tier

# ── Risk Limits ────────────────────────────────────────
MAX_DAILY_LOSS_USD=200          # per-market daily loss gate
MAX_POSITION_USD=1000           # max single position notional
# MAX_COMBINED_NOTIONAL_USD defaults to 2000 (hardcoded)
# MAX_SPREAD_PIPS defaults to 3 (forex)
# MIN_STOP_PIPS defaults to 10 (forex)

# ── Runtime ────────────────────────────────────────────
PAPER_TRADING=true              # master paper-mode override
LOG_LEVEL=info
PORT=3000
```

**CoinGecko key detection:** Keys starting with `CG-` are Demo keys and use `api.coingecko.com` with `x-cg-demo-api-key` header. Any other key format is treated as a Pro key and uses `pro-api.coingecko.com` with `x-cg-pro-api-key`.

**Alpaca paper vs live:**
- When `ALPACA_PAPER=true` or agent config `paper=true`, trading goes to `ALPACA_PAPER_URL` with `ALPACA_PAPER_KEY`/`ALPACA_PAPER_SECRET`.
- Market data **always** uses live keys (`ALPACA_API_KEY`) regardless of paper mode, because the data endpoint is separate from the trading endpoint.

---

## 4. Database Layer

**File:** `src/db/index.ts`
**Engine:** SQLite via `better-sqlite3`, WAL journal mode

### Schema

```sql
-- Agent configurations and status
CREATE TABLE agents (
  key         TEXT PRIMARY KEY,   -- "market:symbol" e.g. "crypto:BTCUSDT"
  config      TEXT,               -- JSON: AgentConfig
  status      TEXT,               -- 'idle' | 'running' | 'paused'
  cycle_count INTEGER DEFAULT 0,
  started_at  TEXT,               -- ISO timestamp
  last_cycle  TEXT                -- JSON: CycleResult
);

-- Historical cycle outcomes
CREATE TABLE cycle_results (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_key   TEXT,
  symbol      TEXT,
  market      TEXT,
  paper       INTEGER,            -- 0 or 1
  decision    TEXT,               -- 'HOLD' | 'BUY' | 'SELL' | 'CANCEL'
  reason      TEXT,
  time        TEXT,               -- ISO timestamp
  error       TEXT                -- null if no error
);

-- Detailed event logs
CREATE TABLE log_entries (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  time        TEXT,
  agent_key   TEXT,
  level       TEXT,               -- 'info' | 'warn' | 'error' | 'debug'
  event       TEXT,               -- LogEvent enum
  message     TEXT,
  data        TEXT                -- JSON (optional structured data)
);

-- Key-value settings
CREATE TABLE settings (
  key         TEXT PRIMARY KEY,
  value       TEXT
);
```

### Key Functions

| Function | Description |
|----------|-------------|
| `dbGetAllAgents()` | Returns all persisted AgentState rows |
| `dbUpsertAgent(agent)` | INSERT OR REPLACE agent record |
| `dbRemoveAgent(key)` | Delete agent by key |
| `dbUpdateAgentStatus(key, status, startedAt)` | Update status and startedAt fields |
| `dbRecordCycle(key, result)` | Insert cycle_results row |
| `dbGetCycleResults(market?, limit)` | Query cycle history, newest first |
| `dbLogEvent(entry)` | Insert log entry |
| `dbGetLogs(sinceId?, agentKey?, limit)` | Query log_entries with optional filters |
| `dbGetMaxLogId()` | Returns highest log entry id (used for logSeq init) |
| `dbGetLogClearFloor()` | Returns the `log_clear_floor` setting value |
| `dbSetLogClearFloor(id)` | Update `log_clear_floor` in settings table |

### Log Clear Floor

When a user clicks "Clear" in the frontend, the server records the current max log ID as `log_clear_floor` in the `settings` table. All subsequent `GET /api/logs` requests apply `max(sinceId, floor)` so old entries are never returned again — even after a page refresh. The raw data remains in SQLite for audit purposes.

---

## 5. Adapter System

### 5.1 IMarketAdapter Interface

**File:** `src/adapters/interface.ts`

Both adapters implement this common interface:

```typescript
interface IMarketAdapter {
  readonly market: 'crypto' | 'forex'

  getSnapshot(symbol: string, riskState: RiskState): Promise<MarketSnapshot>
  getOrderBook(symbol: string, depth?: number): Promise<OrderBook>
  getRecentTrades(symbol: string, limit?: number): Promise<Trade[]>
  getBalances(): Promise<Balance[]>
  getOpenOrders(symbol?: string): Promise<Order[]>
  getTradeHistory(symbol: string, limit?: number): Promise<Fill[]>
  placeOrder(params: OrderParams): Promise<OrderResult>
  cancelOrder(symbol: string, orderId: string | number): Promise<void>

  // Forex-only optional
  getSpread?(symbol: string): Promise<number | null>
  isMarketOpen?(symbol: string): Promise<boolean>
}
```

The adapter registry (`src/adapters/index.ts`) maps market string to adapter instance:

```typescript
export const adapters: Record<string, IMarketAdapter> = {
  crypto: binanceAdapter,
  forex:  alpacaAdapter,
}
```

---

### 5.2 Binance Adapter (Crypto)

**File:** `src/adapters/binance.ts`

#### Authentication

The `binance` npm SDK (`MainClient`) is used only for **public unauthenticated calls** (klines, ticker, order book). All authenticated calls use a custom `signedGet<T>()` helper that signs requests with HMAC-SHA256 directly:

```
timestamp → HMAC-SHA256(queryString, BINANCE_API_SECRET) → signature appended to URL
```

This was necessary because the SDK's signing was producing incorrect signatures in the deployed environment.

#### signedGet()

```
GET https://api.binance.com{path}?{params}&timestamp={ts}&signature={hmac}
Headers: X-MBX-APIKEY: {BINANCE_API_KEY}
```

Testnet (`BINANCE_TESTNET=true`) uses `https://testnet.binance.vision` instead.

#### getSnapshot() — parallel fetches

```
Promise.all([
  24hr ticker statistics     (SDK - public)
  1m klines ×100             (SDK - public)
  15m klines ×100            (SDK - public)
  1h klines ×100             (SDK - public)
  4h klines ×100             (SDK - public)
  Order book depth 5         (SDK - public)
  /api/v3/account            (signedGet - authenticated)
  /api/v3/openOrders         (signedGet - authenticated)
])
```

Returns a `MarketSnapshot` with all timeframes, indicators (computed from H1 candles), balances, and open orders.

---

### 5.3 Alpaca Adapter (Forex)

**File:** `src/adapters/alpaca.ts`

#### Base URLs

| Purpose | URL | Keys Used |
|---------|-----|-----------|
| Market data | `https://data.alpaca.markets` | Live keys always |
| Live trading | `https://api.alpaca.markets` | Live keys |
| Paper trading | `https://paper-api.alpaca.markets` | Paper keys |

#### Symbol Normalization

Alpaca data API uses `/` format (e.g., `EUR/USD`), but agents use `EURUSD` or `EUR_USD`. The adapter converts automatically:

```
XAUUSD  → XAU/USD
EURUSD  → EUR/USD
EUR_USD → EUR/USD
```

#### Pip Calculations (inline)

```typescript
function pipSize(symbol: string): number {
  return symbol.includes('JPY') ? 0.01 : 0.0001
}

function pipValueUsd(symbol: string, price: number): number {
  const standardLot = 100_000
  return symbol.includes('JPY')
    ? (0.01 * standardLot) / price
    : 0.0001 * standardLot  // = $10 for non-JPY
}
```

#### Error Handling

The data endpoint (`alpacaDataGet`) returns `null` on HTTP 404 (instead of throwing), allowing agents to continue without crashing when a symbol isn't available on the current subscription tier. XAUUSD (gold) is a commodity, not a forex pair, and Alpaca doesn't serve its data.

#### getSnapshot() — parallel fetches

```
Promise.all([
  1m bars ×100     (/v1beta3/forex/bars)
  15m bars ×100    (/v1beta3/forex/bars)
  1h bars ×100     (/v1beta3/forex/bars)
  4h bars ×100     (/v1beta3/forex/bars)
  latest quote     (/v1beta3/forex/latest/quotes)
  account info     (/v2/account)   [paper or live]
  positions        (/v2/positions) [paper or live]
])
```

Returns `MarketSnapshot` with forex extras:
- `spread` — in pips, from `(ask - bid) / pipSize`
- `pipValue` — USD value per pip per lot
- `sessionOpen` — whether major forex sessions overlap
- `swapLong` / `swapShort` — rollover rates (if available)

---

### 5.4 Technical Indicators

**File:** `src/adapters/indicators.ts`

All six indicators are computed from the **1-hour (H1) candle series**.

| Indicator | Period | Algorithm |
|-----------|--------|-----------|
| RSI | 14 | Wilder's smoothed average gains/losses |
| EMA | 20, 50 | Seed with SMA, then k = 2/(n+1) multiplier |
| ATR | 14 | True Range with Wilder smoothing |
| VWAP | all bars | Cumulative (typical_price × volume) / cumulative_volume |
| BB Width | 20 | (Upper − Lower) / Middle where bands = SMA ± 2σ |

Returns `{ rsi14, ema20, ema50, atr14, vwap, bbWidth }`.

---

### 5.5 Market Enrichment

**File:** `src/agent/context.ts`

Before each agent cycle, optional market context is fetched in parallel. All failures are silent — a broken enrichment source never blocks trading.

**Crypto enrichment:**

| Source | Data | Used For |
|--------|------|----------|
| Alternative.me | Fear & Greed Index (0-100) | Sentiment context |
| CoinGecko | BTC dominance %, total market cap | Macro crypto health |
| CryptoPanic | Latest news headlines for symbol | News-based reasoning |
| Finnhub | Upcoming economic calendar events | Macro event awareness |

**Forex enrichment:**

| Source | Data |
|--------|------|
| Finnhub | Upcoming economic calendar events only |

---

## 6. Agent System

### 6.1 Agent Configuration

**Type:** `AgentConfig` in `src/types.ts`

```typescript
interface AgentConfig {
  symbol:                  string   // e.g. "BTCUSDT", "EURUSD"
  market:                  'crypto' | 'forex'
  paper:                   boolean  // false = live trading
  maxIterations:           number   // max Claude tool calls per cycle (default 5)
  fetchMode:               'manual' | 'scheduled' | 'autonomous'
  scheduleIntervalMinutes: number   // cron interval (1–1440)
  maxLossUsd:              number   // per-agent daily loss limit override
  maxPositionUsd:          number   // per-agent position size limit override
  customPrompt?:           string   // additional instructions appended to system prompt
}
```

**Agent key:** `"${market}:${symbol}"` — e.g., `"crypto:BTCUSDT"`, `"forex:EURUSD"`.

**Agent status:** `'idle' | 'running' | 'paused'`

---

### 6.2 The Agent Cycle Loop

**File:** `src/agent/loop.ts` (exported as `runAgentCycle`)

```
runAgentCycle(config)
│
├─ logEvent(cycle_start)
├─ adapter = adapters[config.market]
├─ riskState = getRiskStateFor(config.market)
│
├─ Build system prompt (see §6.4)
├─ messages = []
│
└─ LOOP (iteration 0..maxIterations)
   │
   ├─ Call Anthropic API (claude-haiku / claude-sonnet / claude-opus)
   │     model: CLAUDE_MODEL env var
   │     max_tokens: 1024
   │     tools: TOOLS array (6 tools)
   │
   ├─ Log claude_thinking (full text response)
   │
   ├─ stop_reason === 'end_turn'
   │     Extract DECISION and REASON with regex
   │     logEvent(decision)
   │     dbRecordCycle()
   │     logEvent(cycle_end)
   │     RETURN CycleResult
   │
   └─ stop_reason === 'tool_use'
         For each tool_use block:
           logEvent(tool_call)
           result = dispatchTool(tool.name, tool.input, config)
           logEvent(tool_result or tool_error)
         Append [assistant turn, tool_result turn] to messages
         CONTINUE LOOP
```

**Decision extraction regex:**

```
/DECISION:\s*(HOLD|BUY\s+[\d.]+\s+@\s+[\d.]+|SELL\s+[\d.]+\s+@\s+[\d.]+|CANCEL\s+\S+)/i
/REASON:\s*(.+)/i
```

If `maxIterations` is reached without an `end_turn`, the cycle records an error: `"Max iterations reached without decision"`.

---

### 6.3 Claude Tool Definitions

**File:** `src/tools/definitions.ts`

Claude has access to exactly 6 tools per cycle:

#### `get_snapshot`
Fetches a full market snapshot for a symbol.
- Input: `{ symbol: string, market: "crypto"|"forex" }`
- Returns: Price, 24h stats, candles (4 timeframes), indicators, account balances, open orders, risk state, optional market context (fear/greed, news, events)

#### `get_order_book`
Fetches the live order book (bids and asks).
- Input: `{ symbol, market, depth?: number (max 100) }`
- Returns: Array of `[price, quantity]` pairs for bids and asks

#### `get_recent_trades`
Fetches the most recent public trades (tape).
- Input: `{ symbol, market, limit?: number (max 1000) }`
- Returns: Array of `{ price, qty, time, isBuyerMaker }`

#### `get_open_orders`
Lists currently open orders on the exchange account.
- Input: `{ market, symbol?: string }`
- Returns: Array of Order objects with orderId, side, type, price, qty, status

#### `place_order`
Places a buy or sell order. Runs guardrails first.
- Input: `{ symbol, market, side: "BUY"|"SELL", type: "LIMIT"|"MARKET", quantity, price? (required for LIMIT), timeInForce?, stopPips? (forex only) }`
- Returns: `{ orderId, status }` on success, or `{ blocked: true, reason: string }` if guardrail fires

#### `cancel_order`
Cancels an existing open order.
- Input: `{ symbol, market, orderId: string }`
- Returns: `{ cancelled: true }`

---

### 6.4 System Prompt Construction

The system prompt is assembled fresh for each cycle:

```
[PAPER TRADING — no real orders placed] OR [LIVE TRADING — real orders will execute]

You are an autonomous trading agent for {symbol} on {market}.

Today's date/time: {ISO timestamp}

--- FOREX BLOCK (forex only) ---
Forex session rules:
  - Only trade during major session overlaps (London-NY: 13:00-17:00 UTC)
  - Always include stopPips parameter
  - Typical spread on {symbol}: ~{X} pips
  - Session currently: OPEN / CLOSED
--- END FOREX BLOCK ---

Your decision format:
  DECISION: HOLD
  DECISION: BUY {qty} @ {price}
  DECISION: SELL {qty} @ {price}
  DECISION: CANCEL {orderId}
  REASON: {your reasoning}

Risk rules:
  - Daily loss limit: ${maxLossUsd}
  - Max position: ${maxPositionUsd}
  - Minimum 1% stop-out discipline (never risk more than 1% on a single trade)
  - No pyramiding without RSI+EMA confirmation

{customPrompt if set}
```

---

## 7. Guardrails & Risk Management

### 7.1 Crypto Validation

**File:** `src/guardrails/validate.ts`

Checks run in order before any order placement:

| Check | Limit | Action |
|-------|-------|--------|
| Daily loss gate | `MAX_DAILY_LOSS_USD` | BLOCK |
| Quantity ≤ 0 or < 0.00001 | — | BLOCK |
| Quantity > 9000 | — | BLOCK |
| Notional < $10 | — | BLOCK |
| Projected notional > `MAX_POSITION_USD` | — | BLOCK |
| BUY notional > remaining budget | `remainingBudgetUsd` | BLOCK |
| LIMIT without price | — | BLOCK |

---

### 7.2 Forex Validation

**File:** `src/guardrails/forex.ts`

Additional forex-specific checks:

| Check | Limit | Action |
|-------|-------|--------|
| Forex daily loss gate | `MAX_DAILY_LOSS_USD` | BLOCK |
| Market session closed | — | BLOCK (forex only trades during sessions) |
| Spread > max | `MAX_SPREAD_PIPS` (default 3) | BLOCK |
| Missing stopPips | — | BLOCK |
| stopPips < minimum | `MIN_STOP_PIPS` (default 10) | BLOCK |
| Pip risk > remaining budget | `qty × pipValue × stopPips` | BLOCK |
| Combined notional > cap (BUY) | `MAX_COMBINED_NOTIONAL_USD` (2000) | BLOCK |

---

### 7.3 Per-Market Risk State

**File:** `src/guardrails/riskStateStore.ts`

Risk state is tracked per market with **automatic UTC daily reset**:

```typescript
interface DayState {
  date: string              // 'YYYY-MM-DD' UTC — resets when date changes
  realizedPnlUsd: number    // sum of all fills today
  peakPnlUsd: number        // highest realized P&L reached today
  positionNotionalUsd: number // current open position notional
}
```

**Functions:**
- `recordFillFor(market, pnlUsd)` — Called when an order fills; updates realized P&L
- `updatePositionNotionalFor(market, notional)` — Updated after position changes
- `getRiskStateFor(market)` → `{ dailyPnlUsd, remainingBudgetUsd, positionNotionalUsd }`
- `isDailyLimitHitFor(market)` → `true` if `realizedPnlUsd ≤ -MAX_DAILY_LOSS_USD`
- `getCombinedNotionalUsd()` → sum across both markets (used in forex combined cap check)

**Forex context cache:** The adapter's latest spread, sessionOpen, and pipValue are cached in the risk store so the forex guardrail can access them without an extra API call.

---

## 8. Scheduler

**File:** `src/scheduler/index.ts`

The scheduler manages cron jobs for each agent. An agent can have one of three fetch modes:

| Mode | Behaviour |
|------|-----------|
| `manual` | No automatic execution. User triggers cycles via API or UI button. |
| `scheduled` | Runs on the configured interval regardless of market conditions. |
| `autonomous` | Runs on the configured interval but **skips** cycles when the forex market session is closed (for forex agents). |

**Cron interval conversion:**

```
scheduleIntervalMinutes < 60  →  "*/{n} * * * *"   (every N minutes)
scheduleIntervalMinutes >= 60 →  "0 */{h} * * *"   (every N hours)
```

**Functions:**

| Function | Description |
|----------|-------------|
| `startAgentSchedule(config)` | Creates node-cron task, sets status = 'running' |
| `pauseAgentSchedule(key)` | Destroys task, sets status = 'paused' |
| `stopAgentSchedule(key)` | Destroys task, sets status = 'idle' |
| `stopAllSchedules()` | Graceful shutdown — stops all tasks |

Each scheduled execution calls `runAgentCycle(config)` and catches any unhandled errors, logging them as `cycle_error`.

---

## 9. HTTP API Server

**File:** `src/server/index.ts`
**Framework:** Fastify
**Port:** `process.env.PORT` (default 3000)

### 9.1 All Endpoints

#### Agents

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/agents` | List all agents with current state |
| `POST` | `/api/agents` | Create new agent (`AgentConfig` in body) |
| `DELETE` | `/api/agents/:key` | Remove agent and stop its schedule |
| `PATCH` | `/api/agents/:key/config` | Update agent config (stops/restarts schedule) |
| `POST` | `/api/agents/:key/start` | Start agent schedule |
| `POST` | `/api/agents/:key/pause` | Pause agent schedule |
| `POST` | `/api/agents/:key/stop` | Stop agent schedule |
| `POST` | `/api/agents/:key/trigger` | Manually trigger one agent cycle immediately |

#### Status & Logs

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/status` | App-level summary (agents, recent events, risk state) |
| `GET` | `/api/logs` | Log entries. Query: `?since={id}&agent={key}` |
| `POST` | `/api/logs/clear` | Set log clear floor to current max ID |

#### Market Data

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/market/:market/:symbol` | Fetch market snapshot (no AI, direct adapter call) |

#### Positions & Trades

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/positions` | Open positions across all agents |
| `GET` | `/api/trades` | Trade fill history across all agents |

#### API Keys

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/keys` | Returns which env keys are currently set (values hidden) |
| `POST` | `/api/keys` | Save a key value to `.env` file |
| `POST` | `/api/keys/test/:service` | Test connectivity for a service |

#### Reports

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/reports/summary` | Trade stats grouped by market |
| `GET` | `/api/reports/trades` | All cycle results |

#### Frontend

Static files from `frontend-dist/` are served for all non-API routes. If the directory doesn't exist (dev mode), routes return a development mode message.

---

### 9.2 API Key Testing

`POST /api/keys/test/:service` calls `testConnection(service)`:

| Service | Test Method | Success Response |
|---------|-------------|-----------------|
| `anthropic` | List first model from API | `"Anthropic OK — {model}"` |
| `alpaca` | Data API: GET `/v2/stocks/AAPL/snapshot` (live keys) + Trading API: GET `/v2/account` (paper or live keys) | `"Data API OK \| Paper trading OK"` |
| `binance` | Signed GET `/api/v3/account` with HMAC-SHA256 | `"Account OK — N non-zero balances"` |
| `finnhub` | GET `/api/v1/stock/profile2?symbol=AAPL` | `"Finnhub OK"` |
| `twelvedata` | GET `/time_series?symbol=EURUSD&interval=1min&outputsize=1` | `"Twelve Data OK"` |
| `coingecko` | Ping free or demo/pro API based on key prefix | `"CoinGecko OK (demo key)"` or `"CoinGecko OK (free tier)"` |

---

### 9.3 Startup Connectivity Check

On server start, after `fastify.listen()`, all configured services are tested in parallel:

```
✓ anthropic  — Anthropic OK — claude-haiku-4-5-20251001
✓ alpaca     — Data API OK | Paper trading OK
✗ binance    — HTTP 401: {"code":-2014,...}
✓ coingecko  — CoinGecko OK (demo key)
  finnhub    — [skipped — key not set]
  twelvedata — [skipped — key not set]
```

Services with no key set are skipped (not shown as failures).

---

## 10. In-Memory State & Logging

**File:** `src/server/state.ts`

### AppState

```typescript
interface AppState {
  agents: Record<string, AgentState>   // key = "market:symbol"
  recentEvents: CycleResult[]          // last 50 cycles across all agents
}
```

State is loaded from the database on startup (agents, last cycle per agent).

### Log Sequence

```typescript
let logSeq = -1  // -1 = uninitialized sentinel

function nextLogId(): number {
  if (logSeq === -1) logSeq = dbGetMaxLogId()  // lazy init from DB on first log
  return ++logSeq
}
```

This prevents `UNIQUE constraint failed: log_entries.id` on server restart — the counter always continues from the highest existing DB id.

### logEvent()

```typescript
logEvent(agentKey, level, event, message, data?)
```

- Creates `LogEntry` with auto-incrementing `id`
- Writes to SQLite immediately (`dbLogEvent`)
- Adds to in-memory buffer (capped at 500 entries)
- Used throughout agent cycle, tool dispatch, guardrails

### LogEvent Types

| Event | Color | Description |
|-------|-------|-------------|
| `cycle_start` | green | Agent cycle begins |
| `cycle_end` | green | Agent reached a decision |
| `cycle_error` | red | Unhandled error in cycle |
| `tool_call` | blue | Claude called a tool |
| `tool_result` | cyan | Tool returned successfully |
| `tool_error` | red | Tool threw an error |
| `claude_thinking` | yellow | Claude's reasoning text |
| `decision` | green | Final DECISION extracted |
| `guardrail_block` | red | Order blocked by guardrails |
| `session_skip` | muted | Autonomous cycle skipped (market closed) |

---

## 11. Frontend

**Location:** `frontend/`
**Build tool:** Vite
**Framework:** React 18 + TypeScript
**Styling:** Tailwind CSS (dark theme, custom design tokens)

### 11.1 Routing

**File:** `frontend/src/App.tsx`

```
/                   → Dashboard
/agents             → Agents list
/agents/:market/:symbol → Agent detail
/positions          → Positions & trade history
/keys               → API key management
/reports            → Trade reports & analytics
```

All routes are wrapped in the `<Layout>` component which provides the navigation sidebar.

---

### 11.2 Pages

#### Dashboard (`/`)

- **Summary cards:** Total agents, running/paused/idle counts, today's P&L, position notional, remaining budget, risk indicator
- **Activity stats:** Total cycles today, buy/sell/hold/error counts
- **Cycle chart:** Bar chart showing last 20 time buckets of cycle activity
- **Decision distribution:** Horizontal bar showing HOLD/BUY/SELL/ERROR proportions
- **Agent overview grid:** Status badge per agent
- **Live logs terminal:** All agents combined, auto-scrolling
- **Recent cycles table:** Last 20 decisions with symbol, market, decision, reason

Auto-refresh options: 5s / 15s / 30s / Off (default 10s)

#### Agents (`/agents`)

- **Add agent form:** Symbol, market (crypto/forex), paper toggle, max iterations, fetch mode, schedule interval, loss/position limits, custom prompt
- **Agent cards grid:** Each card shows status badge, market, paper/live label, last decision/reason
- **Per-agent actions:** Start / Pause / Stop / Trigger / Market Data
- Clicking the symbol name navigates to `/agents/:market/:symbol`

#### Agent Detail (`/agents/:market/:symbol`)

- **Header:** Agent name, status badge, market, paper/live
- **Actions:** Start / Pause / Stop / Trigger / Market Data
- **Stats panel:** Total cycles, mode, interval, limits, started time
- **Last decision card:** Decision, reason, error (if any)
- **Configuration panel:** Editable settings (inline SettingsPanel component)
- **Logs terminal:** Filtered to only this agent's events
- **Market data modal:** Read-only snapshot (no AI cycle triggered)

#### Positions (`/positions`)

Three tabs:

| Tab | Content | Filter |
|-----|---------|--------|
| Active | Currently open/partially filled positions | status = OPEN or PARTIALLY_FILLED |
| Pending | Orders awaiting fill | status = NEW |
| History | Completed trade fills | All fills from `/api/trades` |

Auto-refresh every 15s.

#### API Keys (`/keys`)

Displays rows for each configured service. Each row shows:
- Label and description
- Status indicator (green = set, gray = missing)
- Masked password input to update the value
- Save button
- Test button → calls `/api/keys/test/:service` and shows result inline

Services listed: Anthropic, Claude Model, Alpaca (live + paper), Binance, Finnhub, Twelve Data, CoinGecko.

#### Reports (`/reports`)

- **Summary cards** per market: total cycles, buys/sells/holds, errors, active %, daily P&L, remaining budget
- **Cycle activity chart:** Line chart, crypto vs forex series
- **Trade history table:** Filterable by market. Columns: Time, Symbol, Market, Decision, Reason, Mode (paper/live)

---

### 11.3 Key Components

#### `LogsTerminal`

**File:** `frontend/src/components/LogsTerminal.tsx`

Features:
- Polls `/api/logs` every 1500ms
- Shows only entries with `id > lastIdRef.current` (incremental fetch)
- Filter tabs: All / Decisions / Tools / Claude / Errors
- Pause / Auto-scroll / Clear buttons
- Per-agent icon in the log line (₿ BTC, Ξ ETH, ◎ SOL, ◈ BNB, € EUR, £ GBP, ◆ default)
- Clear calls `POST /api/logs/clear`, stores returned `clearedAt` as new floor — survives page refresh

#### `AgentCard`

**File:** `frontend/src/components/AgentCard.tsx`

- Symbol name is a `<Link>` to the agent detail page
- Shows collapsible settings panel (`SettingsPanel`)
- Start/Pause/Stop/Trigger/Market Data action buttons
- Status badge (idle/running/paused) with color

#### `MarketDataModal`

Fetches and displays a raw `MarketSnapshot` from `/api/market/:market/:symbol` without triggering an AI cycle.

---

### 11.4 API Client

**File:** `frontend/src/api/client.ts`

All API calls go through a central `api<T>()` helper that:
- Prepends `/` base path
- Sets `Content-Type: application/json`
- Throws on non-2xx responses

Key exported functions:

```typescript
getAgents()         → AgentState[]
createAgent(cfg)    → AgentState
removeAgent(key)    → void
updateConfig(key, partial) → AgentState
startAgent(key)     → void
pauseAgent(key)     → void
stopAgent(key)      → void
triggerAgent(key)   → void
getStatus()         → AppStatus
getLogs(since?, agentKey?) → LogEntry[]
clearLogs()         → { ok: boolean; clearedAt: number }
getMarketData(market, symbol) → MarketSnapshot
getKeys()           → Record<string, boolean>
saveKey(envKey, value) → void
testKey(service)    → { ok: boolean; message: string }
getPositions()      → PositionEntry[]
getTrades()         → FillEntry[]
getReports()        → ReportSummary
```

---

## 12. Data Flow: End-to-End Agent Cycle

Below is the complete flow for one agent cycle (e.g., `crypto:BTCUSDT`):

```
1. TRIGGER
   ├── Via scheduler (cron fires)
   └── Via API: POST /api/agents/crypto:BTCUSDT/trigger

2. runAgentCycle({ symbol: 'BTCUSDT', market: 'crypto', ... })
   ├── logEvent('cycle_start')
   ├── riskState = getRiskStateFor('crypto')
   │     → checks if daily date changed → auto-resets if so
   └── Build system prompt

3. ITERATION 1: Call Claude
   ├── Anthropic SDK: messages.create(model, system, messages=[], tools)
   ├── Claude responds: stop_reason='tool_use', tool='get_snapshot'
   └── logEvent('claude_thinking', full reasoning text)

4. TOOL DISPATCH: get_snapshot
   ├── logEvent('tool_call', 'get_snapshot')
   ├── adapter.getSnapshot('BTCUSDT', riskState)
   │     ├── Promise.all([ticker, m1, m15, h1, h4, orderBook, account, openOrders])
   │     └── computeIndicators(h1) → { rsi14, ema20, ema50, atr14, vwap, bbWidth }
   ├── buildMarketContext('BTCUSDT', 'crypto')
   │     ├── fetchFearGreed()     → { value: 72, label: 'Greed' }
   │     ├── fetchCryptoMarket()  → { btcDominance: 52.3, totalMarketCap: 2.1T }
   │     └── fetchCryptoNews()    → [ headline1, headline2, ... ]
   └── logEvent('tool_result', compressed snapshot summary)

5. ITERATION 2: Call Claude again
   ├── messages = [user(tool_result), assistant(get_snapshot)]
   ├── Claude responds: stop_reason='tool_use', tool='place_order'
   │     input: { symbol: 'BTCUSDT', market: 'crypto', side: 'BUY',
   │              type: 'LIMIT', quantity: 0.001, price: 67500 }
   └── logEvent('claude_thinking')

6. TOOL DISPATCH: place_order
   ├── logEvent('tool_call', 'place_order')
   ├── validateOrder({ side:'BUY', qty:0.001, price:67500, ... }, currentPrice)
   │     ├── isDailyLimitHit? → false
   │     ├── notional = 0.001 × 67500 = $67.50
   │     ├── $67.50 < MAX_POSITION_USD ($1000)? → OK
   │     ├── $67.50 < remainingBudgetUsd? → OK
   │     └── returns { ok: true }
   ├── config.paper = true → SIMULATE (no real API call)
   │     returns { orderId: 'paper-1234', status: 'FILLED' }
   └── logEvent('tool_result')

7. ITERATION 3: Call Claude again
   ├── Claude sees the FILLED result
   ├── Claude responds: stop_reason='end_turn'
   │     text: "DECISION: BUY 0.001 @ 67500\nREASON: RSI 42 oversold, EMA20 cross above EMA50..."
   └── logEvent('claude_thinking')

8. EXTRACT DECISION
   ├── regex extracts: decision='BUY', reason='RSI 42 oversold...'
   ├── logEvent('decision', 'BUY 0.001 @ 67500')
   ├── dbRecordCycle({ symbol, market, paper, decision, reason, time })
   └── logEvent('cycle_end')

9. STATE UPDATE
   └── setAgentLastCycle(key, cycleResult)
       recentEvents.unshift(cycleResult) → cap at 50
```

---

## 13. Paper Trading vs Live Trading

Two levels of paper trading control exist:

| Level | Variable | Effect |
|-------|----------|--------|
| Global | `PAPER_TRADING=true` in `.env` | All agents forced to paper mode |
| Per-agent | `config.paper = true` | This agent uses paper mode |

**Paper mode behaviour:**

In `place_order` tool dispatch:
```typescript
if (config.paper || process.env.PAPER_TRADING === 'true') {
  // Simulate: return fake order result without calling the exchange
  return {
    orderId: `paper-${Date.now()}`,
    status: 'FILLED',
    // ... other fields mirrored from input
  }
}
// Otherwise: call adapter.placeOrder(params)
```

In `cancel_order` tool dispatch:
```typescript
if (config.paper || process.env.PAPER_TRADING === 'true') {
  return { cancelled: true }  // Simulate cancellation
}
await adapter.cancelOrder(symbol, orderId)
```

**Guardrails run identically in paper and live mode.** This ensures paper trading accurately reflects what would happen in production, including blocks.

---

## 14. Known Limitations & Notes

### Alpaca Forex Data
- **XAUUSD (gold) is not available** on the Alpaca forex data endpoint. Gold is a commodity, not a forex pair. Use `BTCUSDT` on Binance if you need gold-like volatility exposure.
- Alpaca forex data requires a **paid subscription** for some assets and time intervals. On free accounts, candle requests may return 404 (handled gracefully — agent continues with empty candles).
- The data API **always uses live keys** (`ALPACA_API_KEY`), even when paper trading. Only the order execution API switches between live and paper keys.

### Binance Authentication
- The `binance` npm SDK's signing was producing invalid signatures. All authenticated calls use the custom `signedGet()` helper with Node.js `crypto.createHmac`.
- The SDK is still used for unauthenticated public endpoints (klines, ticker, order book).

### CoinGecko Key Tiers
- Demo keys start with `CG-` and use the free-tier URL (`api.coingecko.com`) with `x-cg-demo-api-key` header.
- Pro keys use `pro-api.coingecko.com` with `x-cg-pro-api-key` header.
- Sending a demo key to the pro URL returns HTTP 400.

### Log IDs on Restart
- `logSeq` is initialized lazily from the database's max ID on first use. This prevents `UNIQUE constraint failed: log_entries.id` that occurred when the counter reset to 0 on server restart while the database retained old entries.

### Risk State Reset
- Risk state resets automatically at UTC midnight. If the server is restarted mid-day, the in-memory P&L counters reset to zero. The realized P&L is not persisted to the database — only cycle results are. This is a known limitation for multi-day risk tracking.

### Single Process
- Wolf-Fin runs as a single Node.js process. All agents share the same event loop. Long-running Claude API calls (multiple tool iterations) block that agent's cycle but not others (each agent cycle runs asynchronously via `async/await`).

### No WebSocket
- All frontend data is polled via HTTP REST. The log terminal polls every 1.5 seconds. The dashboard auto-refreshes on a configurable interval. There is no real-time WebSocket push.
