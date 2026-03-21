# Wolf-Fin Technical Documentation

> Complete reference for the Wolf-Fin autonomous AI trading platform.
> Last updated: 2026-03-21

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Architecture Diagram](#2-architecture-diagram)
3. [Environment Configuration](#3-environment-configuration)
4. [Database Layer](#4-database-layer)
5. [Adapter System](#5-adapter-system)
   - 5.1 [IMarketAdapter Interface](#51-imarketadapter-interface)
   - 5.2 [MT5 Adapter](#52-mt5-adapter)
   - 5.3 [Binance Adapter (Crypto)](#53-binance-adapter-crypto)
   - 5.4 [Technical Indicators](#54-technical-indicators)
   - 5.5 [Key Levels (Support/Resistance/Pivots)](#55-key-levels-supportresistancepivots)
   - 5.6 [Market Context & News](#56-market-context--news)
   - 5.7 [Forex Session Management](#57-forex-session-management)
6. [Monte Carlo Simulation Engine](#6-monte-carlo-simulation-engine)
7. [LLM Provider System](#7-llm-provider-system)
   - 7.1 [Provider Factory](#71-provider-factory)
   - 7.2 [Anthropic Provider](#72-anthropic-provider)
   - 7.3 [OpenRouter Provider](#73-openrouter-provider)
   - 7.4 [Ollama Provider (Local Models)](#74-ollama-provider-local-models)
8. [Agent System](#8-agent-system)
   - 8.1 [Agent Configuration](#81-agent-configuration)
   - 8.2 [Session-Based Tick Architecture](#82-session-based-tick-architecture)
   - 8.3 [Tick Lifecycle (runAgentTick)](#83-tick-lifecycle-runagenttick)
   - 8.4 [Market Snapshot & Data Injection](#84-market-snapshot--data-injection)
   - 8.5 [Position Sizing Engine](#85-position-sizing-engine)
   - 8.6 [System Prompt Construction](#86-system-prompt-construction)
   - 8.7 [Session Compression](#87-session-compression)
   - 8.8 [Tool Definitions](#88-tool-definitions)
   - 8.9 [External Close Detection](#89-external-close-detection)
9. [Guardrails & Risk Management](#9-guardrails--risk-management)
   - 9.1 [Crypto Validation](#91-crypto-validation)
   - 9.2 [MT5 Validation](#92-mt5-validation)
   - 9.3 [Daily Loss Auto-Pause](#93-daily-loss-auto-pause)
   - 9.4 [Drawdown Auto-Pause](#94-drawdown-auto-pause)
   - 9.5 [Lot Size Clamping](#95-lot-size-clamping)
   - 9.6 [Per-Market Risk State](#96-per-market-risk-state)
10. [Scheduler](#10-scheduler)
    - 10.1 [Fetch Modes](#101-fetch-modes)
    - 10.2 [HOLD Backoff](#102-hold-backoff)
    - 10.3 [Scheduled Windows](#103-scheduled-windows)
11. [HTTP API Server](#11-http-api-server)
    - 11.1 [All Endpoints](#111-all-endpoints)
    - 11.2 [SSE Event Stream](#112-sse-event-stream)
    - 11.3 [API Key Testing](#113-api-key-testing)
12. [In-Memory State & Logging](#12-in-memory-state--logging)
13. [Frontend](#13-frontend)
    - 13.1 [Routing](#131-routing)
    - 13.2 [Pages](#132-pages)
    - 13.3 [Key Components](#133-key-components)
    - 13.4 [Account Context](#134-account-context)
    - 13.5 [API Client](#135-api-client)
    - 13.6 [Live Session (ThreadedLogsPanel)](#136-live-session-threadedlogspanel)
14. [Data Flow: End-to-End Agent Tick](#14-data-flow-end-to-end-agent-tick)
15. [Known Limitations & Notes](#15-known-limitations--notes)

---

## 1. System Overview

Wolf-Fin is an autonomous AI trading platform. An LLM (Claude, OpenRouter models, or local Ollama models) serves as the decision-making brain. Each scheduled interval fires a "tick" — a new message turn appended to the same ongoing conversation. The LLM calls tools to gather market data, review account state, and optionally place, modify, or close orders. The system supports two markets:

| Market | Exchange | Adapter | Bridge |
|--------|----------|---------|--------|
| Crypto | Binance  | `BinanceAdapter` | Direct REST API |
| MT5    | MetaTrader 5 (any broker) | `MT5Adapter` | Python FastAPI bridge on localhost:8000 |

Each market is handled by independent **agents** — named configurations identified by a composite key `market:symbol:accountId:name`. Multiple agents can run simultaneously (e.g., `mt5:XAUUSD:1512796653:gold` and `crypto:BTCUSDT`).

**Technology stack:**

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js 22+ (ESM, TypeScript) |
| AI | Anthropic SDK, OpenRouter API, Ollama (OpenAI-compatible) |
| MT5 trading | Python FastAPI bridge → MetaTrader5 C++ API |
| Crypto trading | `binance` npm package + custom HMAC-SHA256 REST |
| HTTP server | Fastify |
| Database | SQLite via `better-sqlite3` (WAL mode) |
| Frontend | React 18 + Vite + Tailwind CSS |
| Frontend routing | React Router v6 |
| Charting | Recharts |
| Real-time | Server-Sent Events (SSE) |

---

## 2. Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                         FRONTEND (React 18)                         │
│  Dashboard │ Agents │ AgentDetail │ Reports │ Account │ ApiKeys     │
│            │        │             │         │         │             │
│  ThreadedLogsPanel (SSE) ←── Real-time tick threads w/ MC results  │
└───────────────────────────────┬─────────────────────────────────────┘
                                │ HTTP REST + SSE
┌───────────────────────────────▼─────────────────────────────────────┐
│                      FASTIFY HTTP SERVER (:3000)                    │
│  /api/agents  /api/events(SSE)  /api/logs  /api/keys  /api/reports │
│  /api/selected-account  /api/system-prompt  /api/market             │
└───────┬───────────────────────┬───────────────────┬─────────────────┘
        │                       │                   │
  ┌─────▼─────┐          ┌─────▼─────┐      ┌──────▼──────┐
  │ SCHEDULER │          │ APP STATE │      │  SQLITE DB   │
  │ 3 modes:  │          │ (memory)  │      │  (WAL mode)  │
  │ manual    │          │ agents{}  │      │ 9+ tables    │
  │ auto      │          │ logBuffer │      └──────────────┘
  │ scheduled │          │ SSE subs  │
  └─────┬─────┘          └───────────┘
        │
  ┌─────▼─────────────────────────────────────────────────────────────┐
  │                      AGENT TICK PIPELINE                           │
  │                                                                    │
  │  1. Fetch MT5/Binance snapshot (price, candles, account, positions)│
  │  2. Compute indicators (RSI14, EMA20/50, ATR14, VWAP, BB Width)   │
  │  3. Compute key levels (support, resistance, pivots)               │
  │  4. Run Monte Carlo simulation (5,000 paths, M1 bootstrap)        │
  │  5. Format snapshot summary (all data → text block)                │
  │  6. Build tick message with snapshot + news + session context       │
  │  7. Append to LLM conversation → get response with tool calls      │
  │  8. Execute tool calls (guardrail-checked) → loop until done       │
  │  9. Parse decision → log result → record cycle                     │
  └─────┬────────────────────────┬────────────────────┬───────────────┘
        │                        │                    │
  ┌─────▼──────┐          ┌──────▼──────┐     ┌──────▼───────┐
  │ LLM LAYER  │          │ GUARDRAILS  │     │  MT5 BRIDGE  │
  │ Anthropic  │          │ lot clamp   │     │  FastAPI     │
  │ OpenRouter │          │ spread chk  │     │  :8000       │
  │ Ollama     │          │ margin chk  │     └──────────────┘
  └────────────┘          │ daily loss  │
                          │ drawdown    │
                          └─────────────┘
```

---

## 3. Environment Configuration

All variables are managed via `.env` file in the project root. The API keys page in the frontend can persist keys directly to `.env`.

| Variable | Default | Purpose |
|----------|---------|---------|
| `PORT` | `3000` | HTTP server port |
| `LOG_LEVEL` | `info` | Pino log level |
| **LLM Providers** | | |
| `ANTHROPIC_API_KEY` | — | Claude direct API |
| `OPENROUTER_API_KEY` | — | OpenRouter proxy (access 100+ models) |
| `OLLAMA_URL` | `http://localhost:11434` | Local Ollama server URL |
| `CLAUDE_MODEL` | `claude-opus-4-5-20251101` | Default Anthropic model |
| **Crypto** | | |
| `BINANCE_API_KEY` | — | Binance API key |
| `BINANCE_API_SECRET` | — | Binance API secret |
| `BINANCE_TESTNET` | `false` | Use Binance testnet |
| **Market Data** | | |
| `FINNHUB_KEY` | — | Finnhub forex news |
| `TWELVE_DATA_KEY` | — | TwelveData (not actively used) |
| `COINGECKO_KEY` | — | CoinGecko market cap / fear & greed |
| **Risk Constants** | | |
| `MIN_ORDER_NOTIONAL_USD` | `10` | Minimum order value (Binance) |
| `MIN_ORDER_QTY` | `0.00001` | Minimum quantity |
| `MAX_ORDER_QTY` | `9000` | Maximum quantity |
| `MAX_DAILY_LOSS_USD` | `200` | Daily loss limit per market |
| `MAX_POSITION_USD` | `1000` | Max position notional per symbol |
| `MAX_COMBINED_NOTIONAL_USD` | `2000` | Max total notional across all markets |

---

## 4. Database Layer

**Engine:** SQLite via `better-sqlite3` (synchronous, WAL mode)
**File:** `data/wolf-fin.db`
**Module:** `src/db/index.ts`

### Tables

| Table | Purpose | Key columns |
|-------|---------|-------------|
| `agents` | Agent config persistence | `key` (PK), `config` (JSON), `created_at` |
| `agent_cycles` | Trade decision history | `agent_key`, `decision`, `reason`, `pnl_usd`, `time` |
| `log_entries` | All agent log events | `id` (auto), `agent_key`, `event`, `level`, `message`, `data` (JSON), `time` |
| `agent_memories` | Long-term agent memory | `agent_key`, `category`, `key`, `value`, `confidence`, `expires_at` |
| `agent_strategies` | Named trading strategies | `agent_key`, `name`, `description`, `rules` (JSON) |
| `agent_plans` | Daily session plans | `agent_key`, `market_bias`, `key_levels`, `risk_notes`, `plan_text`, `session_label` |
| `agent_analyses` | Performance review records | `agent_key`, `analysis` (JSON), `created_at` |
| `agent_sessions` | Persisted LLM conversation state | `agent_key`, `session_label`, `messages` (JSON), `tick_count`, `compressed_history` |
| `settings` | Key-value app settings | `key` (PK: `log_clear_floor`, etc.), `value` |

### Key Functions

```typescript
// Agents
dbSaveAgent(key, config)
dbGetAgents(): AgentConfig[]
dbRemoveAgent(key)  // cascade deletes cycles + logs
dbResetAgentData(key)  // clears cycles, logs, memories, plans, strategies, sessions

// Cycles
dbSaveCycle(agent_key, result)
dbGetCycles(agent_key, limit=100)
dbGetCyclesForPeriod(agent_key, startTime, endTime)

// Logs
dbLogEvent(entry)
dbGetLogs(sinceId?, agentKey?, limit=200)
dbGetMaxLogId()
dbGetLogClearFloor() / dbSetLogClearFloor(id)  // virtual log clearing

// Memory
dbSaveMemory(agent_key, category, key, value, confidence, ttlHours?)
dbGetMemories(agent_key, category?)
dbDeleteMemory(agent_key, category, key)

// Plans
dbSavePlan(agent_key, plan) → planId
dbGetActivePlan(agent_key)

// Sessions
dbSaveSession(agent_key, sessionLabel, messages, tickCount, compressedHistory?)
dbGetTodaySession(agent_key, sessionLabel)
dbGetPreviousSession(agent_key, currentLabel)

// Performance
dbGetAgentPerformance(agent_key, days=7) → { winRate, avgPnl, totalPnl, tradeCount }
```

### Log Clear Floor

When the user clicks "Clear" in the live session panel, instead of deleting rows, a `log_clear_floor` setting is stored with the current max log ID. All queries respect this floor by filtering `id > floor`. If the floor exceeds the actual max ID (e.g., after a database reset), it automatically resets to 0 to prevent permanently hiding all logs.

---

## 5. Adapter System

### 5.1 IMarketAdapter Interface

**Module:** `src/adapters/types.ts`

Every market adapter implements:

```typescript
interface IMarketAdapter {
  readonly market: 'crypto' | 'mt5'
  getSnapshot(symbol: string, riskState: RiskState): Promise<MarketSnapshot>
  getOrderBook(symbol: string, depth?: number): Promise<OrderBook>
  getRecentTrades(symbol: string, limit?: number): Promise<Trade[]>
  getOpenOrders(symbol: string): Promise<Order[]>
  placeOrder(params: OrderParams): Promise<OrderResult>
  cancelOrder(symbol: string, orderId: number): Promise<boolean>
}
```

The adapter registry (`src/adapters/registry.ts`) routes `getAdapter(market, accountId?)` to the correct implementation.

### 5.2 MT5 Adapter

**Module:** `src/adapters/mt5.ts`
**Bridge:** Python FastAPI at `http://127.0.0.1:8000`

The MT5Adapter communicates with a local Python bridge that wraps the MetaTrader5 C++ API. Each adapter instance is scoped to an `accountId`, appended as `?accountId=...` to every request.

**Snapshot data (fetched per tick):**

| Data | Source | Fields |
|------|--------|--------|
| Price | Bridge | `bid`, `ask`, `last` (mid) |
| Candles | Bridge (6 TFs) | `m1` (200), `m5`, `m15`, `m30`, `h1` (50+), `h4` (30+) |
| Account info | Bridge | `balance`, `equity`, `freeMargin`, `usedMargin`, `leverage` |
| Open positions | Bridge | `ticket`, `side`, `volume`, `priceOpen`, `priceCurrent`, `profit`, `sl`, `tp`, `swap`, `comment` |
| Pending orders | Bridge | `ticket`, `type`, `volume`, `priceTarget`, `sl`, `tp` |
| Symbol info | Bridge | `spread`, `point`, `digits`, `pipSize`, `pipValue`, `sessionOpen`, `swapLong`, `swapShort`, `contractSize` |
| 24h stats | Computed from H1 | `high`, `low`, `volume`, `changePercent` |
| Indicators | Computed from H1 | RSI14, EMA20, EMA50, ATR14, VWAP, BB Width |
| Key levels | Computed from H4+H1 | Support, resistance, pivots with strength ratings |

**Pip sizing heuristic:**

```
pipSizeHeuristic(symbol, point):
  XAUUSD/XAGUSD → pipSize = 0.1
  JPY crosses   → pipSize = 0.01
  Others        → pipSize = 0.0001
  Fallback      → pipSize = point * 10
```

**Additional MT5-specific operations:**

```typescript
closePosition(ticket: number): Promise<MT5TradeResult>
modifyPosition(ticket: number, sl?: number, tp?: number): Promise<MT5TradeResult>
getDeals(symbol: string, days: number, limit: number): Promise<Deal[]>
getAccounts(): Promise<MT5Account[]>
```

### 5.3 Binance Adapter (Crypto)

**Module:** `src/adapters/binance.ts`

Direct REST API using the `binance` npm package plus custom HMAC-SHA256 signing for authenticated endpoints. Supports both production and testnet via `BINANCE_TESTNET` env var.

Snapshot provides the same structure as MT5 but without positions, pending orders, account info, or forex-specific fields. M5 and M30 candle arrays are empty (not supported by this adapter).

### 5.4 Technical Indicators

**Module:** `src/adapters/indicators.ts`

All indicators are computed server-side from H1 candles (primary timeframe):

| Indicator | Function | Algorithm |
|-----------|----------|-----------|
| RSI(14) | `rsi(candles, 14)` | Wilder smoothing: seed with SMA, then exponential smoothing |
| EMA(20) | `ema(candles, 20)` | Standard EMA: k = 2/(period+1) |
| EMA(50) | `ema(candles, 50)` | Same algorithm, longer lookback |
| ATR(14) | `atr(candles, 14)` | True range with Wilder smoothing |
| VWAP | `vwap(candles)` | Cumulative (typical price * volume) / cumulative volume |
| BB Width | `bbWidth(candles, 20, 2)` | (upper - lower) / middle using 20-period SMA + 2 std devs |

**Bundle export:**
```typescript
computeIndicators(h1Candles) → { rsi14, ema20, ema50, atr14, vwap, bbWidth }
```

### 5.5 Key Levels (Support/Resistance/Pivots)

**Module:** `src/adapters/indicators.ts → computeKeyLevels()`

Four sources of key levels, sorted by proximity to current price (max 12 returned):

1. **Daily highs/lows** — from H4 candles (6 H4 bars = 1 day), last 5 days. Strength: 3 (today) → 1 (5d ago).
2. **Weekly pivot points** — classic floor pivots (PP, R1, R2, S1, S2) from last 30 H4 candles.
3. **H1 swing highs/lows** — last 48 H1 candles (2 days), lookback=3 for swing detection. Deduped by 5 significant figures.
4. **Merge & rank** — all levels sorted by distance from current price, capped at 12.

### 5.6 Market Context & News

**Module:** `src/agent/context.ts`, `src/adapters/finnhubNews.ts`

**Forex news (MT5):**
- Source: Finnhub `/news?category=forex` API
- Filters by symbol keywords (e.g., "gold" for XAUUSD)
- Sentiment classification: bullish / bearish / neutral (keyword-based)
- Injected into the agent's tick message as `RECENT NEWS` section

**Crypto context:**
- Fear & Greed index (CoinGecko / alternative.me)
- Top news from CryptoPanic
- Macro data (BTC dominance, total market cap)

### 5.7 Forex Session Management

**Module:** `src/adapters/session.ts`

Tracks four forex sessions by UTC hours:

| Session | UTC Hours | Note |
|---------|-----------|------|
| Sydney | 22:00–07:00 | Wraps midnight |
| Tokyo | 00:00–09:00 | |
| London | 08:00–17:00 | |
| New York | 13:00–22:00 | |

**Exports:**
- `isForexSessionOpen()` — true if Tokyo, London, or New York is open (excludes Sydney-only)
- `minutesUntilSessionClose()` — minutes until the earliest active session ends
- `sessionLabel()` — human-readable label with overlap info (e.g., "London / New York overlap (highest liquidity)")
- `openSessions()` — array of all currently active session names

---

## 6. Monte Carlo Simulation Engine

**Module:** `src/adapters/montecarlo.ts`

A fully scriptable probability engine with **zero LLM involvement**. Runs synchronously in <50ms on every agent tick. Bootstraps price paths from real M1 candle history and applies SL/TP rules to produce per-action probability tables.

### How It Works

1. **Extract log returns** from last 200 M1 candles (close-to-close)
2. **Calculate regime bias** from EMA20 vs EMA50 — shifts the return distribution to respect the current trend (capped at 0.5x standard deviation)
3. **For each action (LONG and SHORT):**
   - Simulate 5,000 price paths, 60 bars forward (60 minutes at M1 resolution)
   - Each bar: sample a random historical M1 return (bootstrap with replacement) + regime bias
   - Apply SL at 1x ATR and TP at 1.5x ATR distance
   - Track which paths hit TP first (wins), SL first (losses), or stay open
4. **Recommend** the action with highest positive expected value; HOLD if both are negative

### Inputs

```typescript
interface MCInputs {
  m1:  Candle[]   // Path engine (bootstrap source)
  m5:  Candle[]   // Available for future multi-TF regime calibration
  m15: Candle[]   // Session volatility profile
  m30: Candle[]   // Mean-reversion tendency
  h1:  Candle[]   // Daily volatility regime
  h4:  Candle[]   // Macro trend bias weight
  currentPrice: number
  pipSize:  number   // 1.0 for gold, 0.0001 for forex
  pipValue: number   // $/pip/lot
  lotSize:  number   // from position sizing engine
  atr14:    number   // ATR for SL/TP distance
  ema20:    number   // trend direction
  ema50:    number   // trend direction
}
```

### Output

```typescript
interface MCResult {
  long:        MCActionResult  // win%, EV, P10/P50/P90, SL hit%, median bars
  short:       MCActionResult
  recommended: 'LONG' | 'SHORT' | 'HOLD'
  edgeDelta:   number          // EV(best) - EV(HOLD)
  pathCount:   number          // 5,000
  barsForward: number          // 60
  generatedAt: number          // timestamp
}

interface MCActionResult {
  winRate: number          // % of paths that hit TP before SL (0-100)
  ev: number               // expected value in $
  p10: number              // worst 10% outcome
  p50: number              // median outcome
  p90: number              // best 10% outcome
  slHitPct: number         // % of paths where SL was hit
  medianBarsToClose: number // median bars until position closes
}
```

### What the Agent Sees

The MC results are formatted as a text table injected into the snapshot summary:

```
MONTE CARLO  (5,000 paths · M1 · 60-bar fwd · SL=1xATR TP=1.5xATR):
  Action   Win%    EV      P10     P50     P90    SL hit%  Med.bars
  ─────────────────────────────────────────────────────────────────
  LONG      41%   +$28    -$95    +$31   +$187     59%     23m
  SHORT     62%   +$74    -$41    +$68   +$203     38%     18m ← recommended
  ─────────────────────────────────────────────────────────────────
  Edge delta: +$74 vs HOLD
```

### Frontend Display

MC results are logged as `mc_result` events with the full data object attached. The `TickThread` component renders them as a styled table with color-coded columns (green for positive EV, red for negative, violet header). The collapsed tick row shows a `dice MC LONG/SHORT/HOLD` badge.

---

## 7. LLM Provider System

### 7.1 Provider Factory

**Module:** `src/llm/index.ts`

Each agent independently chooses its LLM provider and model via `AgentConfig.llmProvider` and `AgentConfig.llmModel`.

```typescript
getLLMProvider(config: AgentConfig): LLMProvider
getModelForConfig(config: AgentConfig): string
```

| Provider value | Default model | Implementation |
|---------------|---------------|----------------|
| `'anthropic'` (default) | `claude-opus-4-5-20251101` | Anthropic SDK direct |
| `'openrouter'` | `anthropic/claude-opus-4-5` | OpenRouter REST API |
| `'ollama'` | `llama3.1` | Ollama OpenAI-compat endpoint |

All providers implement the `LLMProvider` interface:

```typescript
interface LLMProvider {
  createMessage(params: LLMCreateParams): Promise<LLMResponse>
}
```

### 7.2 Anthropic Provider

Direct Anthropic SDK usage. The `@anthropic-ai/sdk` client sends tool-use messages natively. No format translation needed.

### 7.3 OpenRouter Provider

**Module:** `src/llm/openrouter.ts`

Translates Anthropic tool schemas to OpenAI format via shared `oai-compat.ts` utilities:

- `toOAITools(anthropicTools)` — converts Anthropic tool definitions to OpenAI function-calling format
- `toOAIMessages(anthropicMessages, systemPrompt)` — converts Anthropic message format to OpenAI chat messages
- `fromOAIResponse(oaiResponse)` — converts OpenAI response back to Anthropic format

**Error handling:**
- HTTP 429 → `RateLimitError` with optional `resetAt` timestamp for backoff
- HTTP 402 → quota exceeded → agent auto-pauses with `pauseReason = 'quota_exceeded'`

### 7.4 Ollama Provider (Local Models)

**Module:** `src/llm/ollama.ts`

Talks to Ollama's OpenAI-compatible endpoint at `{OLLAMA_URL}/v1/chat/completions`. Uses the same `oai-compat.ts` translators as OpenRouter. Non-streaming mode (`stream: false`).

---

## 8. Agent System

### 8.1 Agent Configuration

**Type:** `AgentConfig` in `src/types.ts`

```typescript
interface AgentConfig {
  name?: string                // Display name (supports multiple agents per symbol)
  symbol: string               // Trading instrument (XAUUSD, BTCUSDT, etc.)
  market: 'crypto' | 'mt5'
  fetchMode: 'manual' | 'scheduled' | 'autonomous'
  scheduleIntervalSeconds: number  // base interval between ticks
  leverage?: number            // account leverage (used in sizing context)
  customPrompt?: string        // additional prompt text appended to system prompt
  promptTemplate?: string      // full system prompt override (replaces default)
  guardrails?: Partial<GuardrailsConfig>
  mt5AccountId?: number        // which MT5 account this agent trades on
  llmProvider?: 'anthropic' | 'openrouter' | 'ollama'
  llmModel?: string            // model ID per the provider's naming
  dailyTargetUsd?: number      // daily profit target (default 500) — used for position sizing
  maxRiskPercent?: number      // max % of equity at risk per trade (default 10)
  maxDailyLossUsd?: number     // auto-pause when realized P&L drops below this
  maxDrawdownPercent?: number  // auto-pause when equity drops X% below session peak
  scheduledStartUtc?: string   // HH:MM — autonomous loop only runs inside this window
  scheduledEndUtc?: string     // HH:MM — autonomous loop only runs inside this window
}

interface GuardrailsConfig {
  sessionOpenCheck: boolean     // block orders when market session is closed
  extremeSpreadCheck: boolean   // block orders with >$500/lot spread
  stopPipsRequired: boolean     // MT5 orders must include stopPips
}
```

**Agent key format:** `{market}:{symbol}:{mt5AccountId}:{name}` — e.g., `mt5:XAUUSD:1512796653:gold`

### 8.2 Session-Based Tick Architecture

The agent uses a persistent conversation session per trading day. Each tick appends a new user message to the same LLM conversation, so the model remembers every decision it made earlier in the session.

**Session lifecycle:**

1. **Session start** — on the first tick of a new day (determined by `sessionLabel()` which returns a date string), the agent creates a fresh LLM conversation. If a previous day's session exists in the DB, its compressed summary is loaded and injected as context.

2. **Within-session ticks** — each subsequent tick appends the new snapshot data as a user message. The LLM responds in context of its prior reasoning. The agent maintains running `session.messages` and `session.tickCount`.

3. **Session compression** — when the conversation exceeds `KEEP_MESSAGES` (20), older messages are compressed into a text summary that preserves key decisions, P&L records, and trade history. This prevents context overflow while maintaining memory.

4. **Cross-session memory** — at session end, the conversation is auto-compressed and saved to `agent_memories` with category `'session'` and a 14-day TTL. The next day's session inherits these memories.

### 8.3 Tick Lifecycle (runAgentTick)

**Module:** `src/agent/index.ts → runAgentTick()`

Complete execution flow for one tick:

```
1. Acquire cycle lock (prevents concurrent ticks for same agent)
2. Load or create today's session (messages, tick count)
3. Determine tick type: 'planning' (first tick or plan request) or 'trading'
4. Fetch market snapshot via adapter
5. Detect externally closed positions (SL/TP hit, manual close)
6. Fetch today's closed deals (P&L history)
7. Compute per-agent risk budget from deals
8. Check daily loss guard → auto-pause if limit exceeded
9. Check drawdown guard → auto-pause if equity dropped too far
10. Run Monte Carlo simulation (5,000 paths)
11. Format snapshot summary (all data → structured text)
12. Fetch forex news (non-blocking)
13. Build tick message (header + snapshot + news + instructions)
14. Send to LLM with full conversation history + system prompt
15. Process response: dispatch tool calls with guardrail checks
16. Loop tool calls until LLM stops (max 10 iterations)
17. Parse final decision from response text
18. Record cycle result (decision, reason, P&L)
19. Save session to database
20. Release cycle lock
```

### 8.4 Market Snapshot & Data Injection

Every tick, `formatSnapshotSummary()` transforms the raw snapshot into structured text the LLM reads. The following data sections are included:

**Account health:**
```
Account: Balance $1,234.56 | Equity $1,241.30 | Free Margin $1,180.00 | Used $61.30 | Margin Level 2024% | Leverage 1:100 | Float P&L: +$6.74
```

**Price & spread:**
```
Price: 2912.45 | Bid: 2912.40 | Ask: 2912.50
Spread: 10 points ($1.00) = 3.1% of ATR → TIGHT | Session: OPEN | Swap Long/Short: -8.50/+2.10 $/lot/night
```

**Indicators with interpretation labels:**
```
RSI14: 31.1 (strong bearish momentum) | EMA20: 2910.50 | EMA50: 2918.30 → BEARISH TREND | ATR14: 32.4 pips | BB Width: 0.82% | VWAP: 2914.20 (price below VWAP — bearish intraday)
```

**Multi-timeframe candles:**
```
H4 (last 3 bars): [compact bar-by-bar trend with O/H/L/C]
H1 (last 5 bars): [compact bar-by-bar trend]
M15 (last 5 bars): [compact bar-by-bar trend]
```

**Position sizing (computed, not from LLM):**
```
POSITION SIZING (use this):
  Daily target: $500 | Max risk: 10% ($124) | Leverage: 1:100
  ATR-based SL: ~32.4 pips ($324/lot) | TP at R:R 1.5: ~48.6 pips ($486/lot)
  SUGGESTED SIZE: 0.03 lots — risk $97, reward $146, margin $87
  (System will reject orders above 0.06 lots)
```

**Open positions (enriched):**
```
OPEN POSITIONS (1) | Total Float: -$42.00:
  #404830084 SELL 0.05L @ 2920.00 | now: 2928.40 | P&L: -$42.00 | SL: 2935.00 (6.6 pips away, $33 risk) | TP: 2900.00 | swap: $0.00
```

**Key levels, news sentiment, closed trades with realized P&L, Monte Carlo table.**

### 8.5 Position Sizing Engine

The position sizing engine computes a suggested lot size from three independent constraints. The minimum of all three is used:

1. **Target-based sizing** — how many lots to hit the daily profit target at TP:
   ```
   lotsByTarget = dailyTargetUsd / (slPips × R:R × pipValue)
   ```

2. **Risk cap** — max lots where loss at SL stays within risk tolerance:
   ```
   lotsByRisk = (equity × maxRiskPercent / 100) / (slPips × pipValue)
   ```

3. **Margin cap** — lots that use at most 50% of free margin:
   ```
   marginPerLot = (contractSize × currentPrice) / leverage
   lotsByMargin = (freeMargin × 0.5) / marginPerLot
   ```

**Final:** `max(0.01, floor(min(target, risk, margin), 2 decimals))`

The lot clamp guardrail rejects any order above 2x the suggested size.

### 8.6 System Prompt Construction

The system prompt is assembled dynamically per agent. Structure:

1. **Role declaration** — "Patient, disciplined, risk-first trader"
2. **Session context** — current plan (if any), active memories, previous session summary
3. **Evaluation order** — mandatory step-by-step checklist:
   - Step 0: VERIFY STATE (call `get_open_orders`, read snapshot fully)
   - Step 1: Manage existing positions (SL/TP review, close if warranted)
   - Step 2: Cancel/modify pending orders if conditions changed
   - Step 3: Evaluate new entry — must reference all data points (account health, indicators, MC results, key levels, news)
   - Step 4: Record observations via `save_memory`
4. **Output rules** — must write reasoning text before/after every tool call
5. **Risk management rules** — structural SL placement, minimum R:R 1.5, use suggested lots
6. **Trading tool descriptions** — available tools vary by tick type (planning removes execution tools)

### 8.7 Session Compression

**Module:** `src/agent/index.ts → compressToSummary()`

When conversation history exceeds `KEEP_MESSAGES` (20 messages), older messages are compressed:

1. Find a safe cut point at a "tick boundary" (a user message with string content, not tool results)
2. Extract key information from discarded messages: decisions, trade actions, P&L records, plan saves
3. Build a compact summary text preserving the essential history
4. Replace discarded messages with a single summary user message
5. Continue with the recent messages intact

### 8.8 Tool Definitions

**Module:** `src/tools/definitions.ts`

14 tools available to the agent, categorized:

| Category | Tool | Description |
|----------|------|-------------|
| **Market Data** | `get_snapshot` | Full market state: price, candles, indicators, account, positions |
| | `get_order_book` | Depth of market (crypto only) |
| | `get_recent_trades` | Recent public trades (tape) |
| | `get_open_orders` | Current positions and pending orders |
| **Execution** | `place_order` | MARKET or LIMIT order with SL/TP |
| | `cancel_order` | Cancel pending limit/stop order |
| | `close_position` | Close MT5 position by ticket |
| | `modify_position` | Update SL/TP on existing MT5 position |
| **Memory** | `save_memory` | Persist observation (categories: pattern, risk, price_level, session, general) |
| | `read_memories` | Query stored memories by category |
| | `delete_memory` | Remove outdated memory |
| **Planning** | `save_plan` | Store session plan with bias, levels, risk notes |
| | `get_plan` | Retrieve current session plan |
| **History** | `get_trade_history` | Closed deals with P&L and exit reason |

**Tool availability by context:**
- MT5 agents: exclude `get_order_book`
- Crypto agents: exclude `close_position`, `modify_position`, `get_trade_history`
- Planning ticks: exclude all execution tools (`place_order`, `cancel_order`, `close_position`, `modify_position`)

### 8.9 External Close Detection

**Module:** `src/agent/index.ts → detectExternalCloses()`

Between ticks, positions can be closed externally (SL hit, TP hit, manual close by user). The agent tracks positions tick-to-tick:

1. On each tick, compare current positions against `lastKnownPositions` map
2. For any position that disappeared without the agent closing it:
   - Query deal history from MT5 bridge
   - Compute actual P&L
   - Log as external close event
3. Inject a warning note into the next tick message so the LLM knows:
   ```
   EXTERNALLY CLOSED POSITIONS (since last tick):
   #404830084 SELL 0.05 @ 2920.00 → closed externally P&L: -$42.00
   Do NOT attempt to close these tickets — they no longer exist.
   IMPORTANT: Call save_memory to record what happened.
   ```

---

## 9. Guardrails & Risk Management

### 9.1 Crypto Validation

**Module:** `src/guardrails/validate.ts`

| Check | Constraint | Action |
|-------|-----------|--------|
| Quantity range | 0.00001 ≤ qty ≤ 9000 | Reject with reason |
| Min notional | qty × price ≥ $10 | Reject |
| Max position | qty × price ≤ $1000 | Reject |
| LIMIT price | price > 0 | Reject |

### 9.2 MT5 Validation

**Module:** `src/guardrails/mt5.ts`

| Check | Constraint | Configurable |
|-------|-----------|-------------|
| Session open | Must be in active forex session | `guardrails.sessionOpenCheck` |
| Extreme spread | Spread × pipValue × volume < $500/lot | `guardrails.extremeSpreadCheck` |
| Stop required | `stopPips` must be set on order | `guardrails.stopPipsRequired` |
| Pip risk budget | volume × pipValue × stopPips ≤ remainingBudgetUsd | Always |
| Combined notional | Sum across all markets ≤ $2000 (buys only) | Always |

### 9.3 Daily Loss Auto-Pause

If `config.maxDailyLossUsd` is set, the agent checks today's realized P&L (sum of closed deals) at the start of each tick. If `todayPnl <= -maxDailyLossUsd`, the agent auto-pauses with a logged `guardrail_block` event.

### 9.4 Drawdown Auto-Pause

If `config.maxDrawdownPercent` is set, the agent tracks peak equity per session. If current equity drops below `peak × (1 - maxDrawdownPercent/100)`, the agent auto-pauses. Example: with `maxDrawdownPercent = 5` and peak equity $1,300, the agent pauses if equity drops to $1,235.

### 9.5 Lot Size Clamping

Orders exceeding 2x the position sizing engine's suggested lots are automatically clamped. This prevents the LLM from hallucinating absurdly large positions. The clamp value is shown in the snapshot:
```
(System will reject orders above 0.06 lots)
```

### 9.6 Per-Market Risk State

**Module:** `src/guardrails/riskStateStore.ts`

Tracks per market (`crypto` / `mt5`) with daily reset at UTC midnight:

```typescript
interface RiskState {
  dailyPnlUsd: number           // cumulative realized P&L today
  remainingBudgetUsd: number     // MAX_DAILY_LOSS_USD - dailyPnlUsd
  positionNotionalUsd: number    // current open position size in USD
}
```

Constants:
- `MAX_DAILY_LOSS_USD` = 200
- `MAX_POSITION_USD` = 1000
- `MAX_COMBINED_NOTIONAL_USD` = 2000

State is hydrated from the database on server restart via `hydrateRiskStateFromDb()`.

---

## 10. Scheduler

**Module:** `src/scheduler/index.ts`

The scheduler manages per-agent execution loops. Each agent gets its own independent loop controlled by its `fetchMode`.

### 10.1 Fetch Modes

| Mode | Behavior |
|------|----------|
| `manual` | Agent marked "running" but only ticks when user clicks Trigger button |
| `autonomous` | Continuous loop: tick → await completion → optional backoff → next tick |
| `scheduled` | Like autonomous but only runs inside `scheduledStartUtc`–`scheduledEndUtc` window |

### 10.2 HOLD Backoff

When the agent repeatedly decides HOLD (no trade action), progressive backoff reduces API cost:

| Consecutive HOLDs | Delay before next tick |
|-------------------|----------------------|
| 1–3 | 0ms (immediate) |
| 4–10 | 30 seconds |
| 11–20 | 60 seconds |
| 20+ | 120 seconds (cap) |

The counter resets when the agent makes a non-HOLD decision.

### 10.3 Scheduled Windows

When `fetchMode = 'scheduled'` and both `scheduledStartUtc`/`scheduledEndUtc` are set, the autonomous loop only runs inside that UTC time window. Outside the window, the scheduler sleeps in 30-second cancellable chunks, checking each iteration if the window has opened.

The first tick after pressing Start always fires immediately regardless of the schedule window, so the user gets instant feedback.

**Lifecycle functions:**
```typescript
startAgentSchedule(config)   // Begin/restart agent loop
pauseAgentSchedule(key)      // Pause (can resume)
stopAgentSchedule(key)       // Stop (resets to idle)
resumeAgentSchedule(config)  // Resume from paused
stopAllSchedules()           // Graceful shutdown
```

---

## 11. HTTP API Server

**Module:** `src/server/index.ts`
**Framework:** Fastify
**Default port:** 3000

### 11.1 All Endpoints

| Method | Path | Description |
|--------|------|-------------|
| **Status** | | |
| `GET` | `/api/status` | All agents, recent events, risk state per market |
| **Account** | | |
| `GET` | `/api/selected-account` | Current selected MT5 account |
| `POST` | `/api/selected-account` | Set selected account |
| **Agents** | | |
| `GET` | `/api/agents` | List all agents (with state) |
| `POST` | `/api/agents` | Create agent (validates no duplicate key) |
| `DELETE` | `/api/agents/:key` | Delete agent + cascade data |
| `DELETE` | `/api/agents/:key/data` | Reset data only (keeps config) |
| `PATCH` | `/api/agents/:key/config` | Update config (restarts schedule if running) |
| `POST` | `/api/agents/:key/start` | Start agent loop |
| `POST` | `/api/agents/:key/pause` | Pause agent |
| `POST` | `/api/agents/:key/stop` | Stop agent |
| `POST` | `/api/agents/:key/trigger` | Fire one tick (manual mode) |
| `POST` | `/api/agents/:key/plan` | Queue a planning tick |
| `GET` | `/api/agents/:key/cycles` | Cycle history |
| `GET` | `/api/system-prompt/:key` | Full system prompt for debugging |
| **Logs** | | |
| `GET` | `/api/logs` | Log entries (with `since` and `agent` filters) |
| `POST` | `/api/logs/clear` | Virtual clear (sets floor) |
| `GET` | `/api/events` | SSE stream for real-time log updates |
| **Market** | | |
| `GET` | `/api/market/:market/:symbol` | Read-only snapshot |
| **Keys** | | |
| `GET` | `/api/keys` | List configured API keys |
| `POST` | `/api/keys` | Save API key to .env |
| `POST` | `/api/keys/test/:service` | Test connection to service |
| **Reports** | | |
| `GET` | `/api/reports/summary` | P&L summary across agents |

### 11.2 SSE Event Stream

`GET /api/events?agent=<key>&since=<id>`

Server-Sent Events endpoint that streams log entries in real-time. On connection:
1. Sends any missed events since `sinceId` (up to 100)
2. Subscribes to the live log stream
3. Each event is a JSON-serialized `LogEntry` as an SSE `data:` frame

The frontend uses this instead of polling for the live session view.

### 11.3 API Key Testing

`POST /api/keys/test/:service`

Tests connectivity to external services:

| Service | Test method |
|---------|------------|
| `anthropic` | `GET /v1/models` |
| `openrouter` | `GET /api/v1/models` |
| `binance` | `GET /api/v3/ping` |
| `ollama` | `GET /api/tags` |
| `finnhub` | `GET /api/v1/news?category=forex` |
| `twelvedata` | `GET /time_series?symbol=EUR/USD` |
| `coingecko` | `GET /api/v3/ping` |

---

## 12. In-Memory State & Logging

**Module:** `src/server/state.ts`

### Application State

```typescript
interface AppState {
  agents: Record<string, AgentState>   // key = makeAgentKey(market, symbol, accountId, name)
  recentEvents: CycleResult[]          // last N cycle results
}
```

### Logging System

All log entries flow through `logEvent()`:

1. Assigned a monotonically increasing `id`
2. Added to an in-memory `logBuffer` (max 500 entries)
3. Persisted to SQLite `log_entries` table
4. Broadcast to all SSE subscribers

**Log event types:**

| Event | Meaning |
|-------|---------|
| `tick_start` / `tick_end` | Tick boundaries |
| `tick_error` | Tick failed with error |
| `tick_skip` / `cycle_skip` | Tick skipped (agent busy, etc.) |
| `session_start` / `session_reset` | New trading day session |
| `tool_call` / `tool_result` / `tool_error` | Tool execution |
| `claude_thinking` | LLM reasoning text |
| `llm_request` | LLM API call metadata |
| `decision` | Final trading decision |
| `guardrail_block` | Order rejected by guardrails |
| `auto_execute` / `auto_execute_error` | Auto-execution of tool results |
| `memory_write` | Memory saved |
| `plan_created` | Session plan saved |
| `pnl_record` | P&L recorded |
| `mc_result` | Monte Carlo simulation results |
| `quota_error` | LLM provider quota/billing error |
| `auto_plan` | Auto-generated planning tick |

---

## 13. Frontend

**Framework:** React 18 + TypeScript + Vite
**Styling:** Tailwind CSS with custom dark theme
**State:** React context (AccountContext) + local state
**Real-time:** Server-Sent Events via `EventSource` API

### 13.1 Routing

```
/              → Dashboard (home)
/agents        → Agent list
/agents/new    → Create new agent
/agents/:market/:symbol/:accountId?  → Agent detail (by market+symbol)
/agents/k/:agentKey                   → Agent detail (by full key)
/keys          → API key management
/reports       → Trade history + P&L
/account       → MT5 account selector
```

### 13.2 Pages

| Page | File | Purpose |
|------|------|---------|
| Dashboard | `Dashboard.tsx` | Real-time agent status, P&L summary, live session view (last 10 ticks) |
| Agents | `Agents.tsx` | List all agents with start/stop/delete controls |
| Agent Create | `AgentCreate.tsx` | New agent form: market, symbol, LLM provider, guardrails, risk settings |
| Agent Detail | `AgentDetail.tsx` | Deep view: config editor, system prompt viewer, full tick logs, performance |
| API Keys | `ApiKeys.tsx` | Manage API keys with connection testing |
| Reports | `Reports.tsx` | Trade history, closed deals, P&L by market and period |
| Account | `Account.tsx` | MT5 account selector (persistent to server settings) |

### 13.3 Key Components

| Component | Purpose |
|-----------|---------|
| `ThreadedLogsPanel` | Live session view with SSE streaming, pause/resume/clear |
| `TickThread` | Single tick: collapsible card with decision badge, MC table, thinking, tool calls, errors |
| `useTickThreads` | Hook that groups raw log entries into structured tick threads |
| `Layout` | App shell with navigation, account selector in header |

### 13.4 Account Context

`AccountContext` provides a globally selected MT5 account. All pages (except Account management) scope their data to the selected account:

- Agent list filtered by account
- Dashboard shows only selected account's agents
- Live session filters SSE events by agent keys belonging to the account

The selected account is persisted server-side via `/api/selected-account`.

### 13.5 API Client

**Module:** `frontend/src/api/client.ts`

Typed fetch wrapper with functions for every API endpoint:

```typescript
getStatus()
getAgents() / createAgent(config) / deleteAgent(key)
startAgent(key) / pauseAgent(key) / stopAgent(key) / triggerAgent(key)
getLogs(sinceId?, agent?) / clearLogs()
getReportSummary()
getKeys() / saveKey(service, key) / testKey(service)
getSelectedAccount() / setSelectedAccount(accountId)
```

### 13.6 Live Session (ThreadedLogsPanel)

The live session panel shows real-time tick activity using Server-Sent Events:

1. **Initial fetch** — loads last 200 log entries via `GET /api/logs`
2. **SSE connection** — connects to `GET /api/events` for real-time updates
3. **Thread grouping** — `useTickThreads` hook groups entries into `TickThread` objects by scanning for `tick_start` / `tick_end` boundaries
4. **Rendering** — each thread is a collapsible card showing:
   - Header: symbol (color-coded), tick number, decision badge, MC badge, relative time
   - Sections: Monte Carlo (auto-expanded), Decision & Reason, Thinking, Tool Calls, Errors
5. **Pause/Resume** — pauses SSE processing without disconnecting
6. **Clear** — sets log clear floor server-side, clears local state

The `TickThread` data structure:

```typescript
interface TickThread {
  id: string
  agentKey: string
  startTime: string
  endTime?: string
  status: 'running' | 'complete' | 'error' | 'skipped' | 'session_event'
  tickNumber: number
  iterationCount: number
  decision?: string
  reason?: string
  logs: LogEntry[]
  thinkingLogs: LogEntry[]
  toolLogs: LogEntry[]
  decisionLogs: LogEntry[]
  errorLogs: LogEntry[]
  mcLogs: LogEntry[]
}
```

---

## 14. Data Flow: End-to-End Agent Tick

```
TIMER/TRIGGER FIRES
        │
        ▼
┌─ SCHEDULER ──────────────────────────────────────────────────────┐
│  Check fetch mode (manual/auto/scheduled)                        │
│  Check HOLD backoff delay                                        │
│  Check scheduled window (if applicable)                          │
│  Call runAgentTick(config)                                        │
└────────┬─────────────────────────────────────────────────────────┘
         │
         ▼
┌─ ACQUIRE LOCK ───────────────────────────────────────────────────┐
│  tryAcquireCycleLock(agentKey) — prevents concurrent ticks       │
│  If locked → skip with tick_skip log                             │
└────────┬─────────────────────────────────────────────────────────┘
         │
         ▼
┌─ SESSION MANAGEMENT ─────────────────────────────────────────────┐
│  Load today's session from DB (or create new)                    │
│  If new day → compress previous session → save to memory         │
│  Inject previous session summary + memories into system prompt   │
└────────┬─────────────────────────────────────────────────────────┘
         │
         ▼
┌─ DATA FETCH ─────────────────────────────────────────────────────┐
│  adapter.getSnapshot(symbol)                                      │
│    → price, 6 TF candles, indicators, positions, account info     │
│  adapter.getDeals(symbol) → today's closed trades                 │
│  detectExternalCloses() → compare positions vs last tick           │
│  computeKeyLevels(h4, h1, price)                                  │
│  fetchForexNews(symbol) → sentiment-tagged headlines              │
└────────┬─────────────────────────────────────────────────────────┘
         │
         ▼
┌─ RISK CHECKS ────────────────────────────────────────────────────┐
│  Daily loss guard: todayPnl <= -maxDailyLossUsd → auto-pause     │
│  Drawdown guard: equity vs peak → auto-pause if exceeded         │
│  (If paused → return early, release lock)                        │
└────────┬─────────────────────────────────────────────────────────┘
         │
         ▼
┌─ MONTE CARLO ────────────────────────────────────────────────────┐
│  runMonteCarlo({m1, m5, m15, m30, h1, h4, price, indicators})   │
│    → 5,000 bootstrap paths from M1 candles                       │
│    → LONG/SHORT win%, EV, P10/P50/P90, SL hit%                  │
│    → Recommended: LONG | SHORT | HOLD                            │
│  Log mc_result event with full data                              │
└────────┬─────────────────────────────────────────────────────────┘
         │
         ▼
┌─ SNAPSHOT FORMAT ────────────────────────────────────────────────┐
│  formatSnapshotSummary(snap, agentKey, config, mcResult)         │
│    → Account health (balance, equity, margin, float P&L)         │
│    → Price + spread verdict + swap rates                         │
│    → Indicators with interpretation labels (trend, momentum)     │
│    → Multi-TF candles (H4, H1, M15)                             │
│    → Position sizing block                                       │
│    → Open positions (with SL pip distance + $ risk)              │
│    → Key levels (up to 8)                                        │
│    → News sentiment                                              │
│    → Closed trades + today's realized P&L                        │
│    → Monte Carlo probability table                               │
└────────┬─────────────────────────────────────────────────────────┘
         │
         ▼
┌─ TICK MESSAGE ASSEMBLY ──────────────────────────────────────────┐
│  buildTickMessage(config, tickNumber, isFirstTick, tickType,     │
│                   summary, externalCloseNote, newsItems)          │
│    Header: "Tick #N | HH:MM | SYMBOL (MARKET) | Xh Xm left"    │
│    Body: Snapshot + evaluation instructions                      │
│    Planning tick: analysis + plan instructions                   │
│    Trading tick: full evaluation order checklist                  │
└────────┬─────────────────────────────────────────────────────────┘
         │
         ▼
┌─ LLM CALL ───────────────────────────────────────────────────────┐
│  provider.createMessage({                                         │
│    model, system prompt, messages (full session history),         │
│    tools (filtered by tick type), max_tokens: 4096               │
│  })                                                               │
│                                                                   │
│  Response contains: text reasoning + tool_use blocks              │
│  If stop_reason == 'tool_use' → dispatch and loop (max 10x)     │
└────────┬─────────────────────────────────────────────────────────┘
         │
         ▼
┌─ TOOL DISPATCH ──────────────────────────────────────────────────┐
│  For each tool_use block:                                         │
│    1. Log tool_call event                                        │
│    2. Execute handler (get_snapshot, place_order, etc.)           │
│    3. For place_order: run guardrail validation                   │
│       → Reject if fails (log guardrail_block)                    │
│       → Clamp if lot size > 2x suggested                         │
│    4. Log tool_result event                                       │
│    5. Add tool result to conversation                            │
│    6. Call LLM again with updated conversation                   │
│  Loop until stop_reason != 'tool_use' or max iterations reached  │
└────────┬─────────────────────────────────────────────────────────┘
         │
         ▼
┌─ DECISION PARSING ───────────────────────────────────────────────┐
│  Search response text for "DECISION: ACTION — reason"            │
│  Extract action (BUY, SELL, HOLD, CLOSE, CANCEL, etc.)           │
│  Extract reason (up to 300 chars)                                │
│  If no decision found → infer from tool calls or mark UNKNOWN    │
└────────┬─────────────────────────────────────────────────────────┘
         │
         ▼
┌─ RECORD & PERSIST ───────────────────────────────────────────────┐
│  recordCycle(agentKey, result) → log + broadcast to SSE          │
│  dbSaveSession(messages, tickCount) → persist conversation       │
│  dbSaveCycle(decision, reason, pnl) → trade history              │
│  Release cycle lock                                              │
│  Scheduler checks backoff → schedule next tick                   │
└──────────────────────────────────────────────────────────────────┘
```

---

## 15. Known Limitations & Notes

1. **MT5 bridge is Windows-only** — the MetaTrader5 Python package requires Windows. The bridge runs as a separate process on `localhost:8000`.

2. **M5 and M30 candles** — depend on the MT5 bridge returning them. Older bridge versions may not include these timeframes. The adapter gracefully falls back to empty arrays.

3. **Monte Carlo uses M1 only for path generation** — M5/M15/M30/H1/H4 candle data is available in `MCInputs` for future multi-timeframe regime calibration but is not yet used in the bootstrap sampling.

4. **Session compression is lossy** — when the conversation exceeds 20 messages, older context is compressed into a summary. The LLM loses access to exact reasoning from early ticks but retains key decisions and P&L records.

5. **Indicator computation uses H1 candles only** — RSI, EMA, ATR, VWAP, and Bollinger Bands are all computed from H1 candles. Multi-timeframe indicator computation (e.g., RSI on M15) is not yet implemented.

6. **Single account per agent** — each agent is bound to one MT5 account. Cross-account strategies are not supported.

7. **No backtesting** — the Monte Carlo engine simulates forward paths from current state, but there is no historical backtesting framework for strategy validation.

8. **SQLite concurrency** — WAL mode allows concurrent reads, but writes are serialized. Under heavy multi-agent load, database writes may become a bottleneck.

9. **Ollama tool calling** — local models vary in their ability to follow tool-calling protocols. Smaller models may produce malformed tool calls that fail to parse.

10. **Spread is computed from M1 close-to-close** — the Monte Carlo engine uses log returns from M1 closes. Intra-bar wicks (spikes beyond high/low) are not modeled, which may underestimate SL hit probability for highly volatile instruments.
