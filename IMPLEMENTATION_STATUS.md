# Wolf-Fin Implementation Status

Last updated: 2026-03-14

---

## Overall Progress: Step 1–3 partial (~60% complete)

---

## ✅ Completed

### Types (`src/adapters/types.ts`)
- Added `MarketContext` interface (fearGreed, news, upcomingEvents, cryptoMarket)
- Added `market: 'crypto' | 'forex'` field to `MarketSnapshot`
- Added `context?: MarketContext` to `MarketSnapshot`
- Added `forex?` block to `MarketSnapshot` (spread, pipValue, sessionOpen, swapLong, swapShort)
- Added `stopPips?: number` to `OrderParams`

### Adapter Interface (`src/adapters/interface.ts`) — NEW
- `IMarketAdapter` contract with all required methods
- Optional forex-only methods: `getSpread()`, `isMarketOpen()`

### Binance Adapter (`src/adapters/binance.ts`) — REFACTORED
- Wrapped all functions in `BinanceAdapter` class implementing `IMarketAdapter`
- `market = 'crypto'` field set
- `MarketSnapshot` now includes `market: 'crypto'` field
- Exported `binanceAdapter` singleton
- Kept all backward-compatible standalone function exports (`getSnapshot`, `placeOrder`, etc.)

### OANDA Adapter (`src/adapters/oanda.ts`) — NEW
- Full `OandaAdapter` class implementing `IMarketAdapter`
- `getSnapshot()`: fetches M1/M15/H1/H4 candles, live bid/ask pricing, account summary, open trades
- `getOrderBook()`: single-level book from OANDA pricing endpoint
- `getRecentTrades()`: returns [] (not available in OANDA v20 REST without streaming)
- `getBalances()`: NAV + margin available
- `getOpenOrders()`: maps open trades to `Order[]`
- `getTradeHistory()`: closed trades endpoint
- `placeOrder()`: MARKET and LIMIT orders with optional `stopLossOnFill` from `stopPips`
- `cancelOrder()`: cancel by order ID
- `getSpread()`: live spread in pips
- `isMarketOpen()`: delegates to session logic
- Helper exports: `pipSize()`, `toPips()`, `pipValueUsd()`

### Session Logic (`src/adapters/session.ts`) — NEW
- `openSessions()`: returns which of Sydney/Tokyo/London/NewYork are currently open
- `isForexSessionOpen()`: true when at least one major session is active
- `sessionLabel()`: human-readable label for system prompt (e.g. "London / New York overlap (highest liquidity)")

### Adapter Registry (`src/adapters/registry.ts`) — NEW
- `getAdapter('crypto')` → `BinanceAdapter`
- `getAdapter('forex')` → `OandaAdapter`

### Enrichment Adapters — ALL NEW
- `src/adapters/feargreed.ts` — Alternative.me Fear & Greed index (no key)
- `src/adapters/coingecko.ts` — CoinGecko BTC dominance + total market cap (optional key)
- `src/adapters/cryptopanic.ts` — CryptoPanic top headlines for a symbol (no key)
- `src/adapters/calendar.ts` — Finnhub economic calendar; `isHighImpactEventSoon()` for guardrail gate
- `src/adapters/twelvedata.ts` — Twelve Data fallback candle source for forex

### Context Assembler (`src/agent/context.ts`) — NEW
- `buildMarketContext(symbol, market)` fetches all enrichment in parallel
- Crypto: fearGreed + cryptoMarket + news + upcomingEvents
- Forex: upcomingEvents only
- All failures are silent (null/[]) — never blocks trading cycle

### Adapters Barrel (`src/adapters/index.ts`) — UPDATED
- Re-exports all new modules

---

## 🔲 Not Yet Started

### Step 4 — Agent Loop + Tool Dispatcher

| File | Status | Notes |
|---|---|---|
| `src/agent/prompt.ts` | ❌ TODO | Market-aware system prompt builder |
| `src/agent/dispatcher.ts` | ❌ TODO | Routes Claude `tool_use` calls to correct adapter |
| `src/agent/loop.ts` | ❌ TODO | Main agentic loop (replaces empty `src/agent/index.ts`) |

### Step 5 — Forex Guardrails

| File | Status | Notes |
|---|---|---|
| `src/guardrails/riskStateStore.ts` | ❌ TODO | Per-market risk state + combined notional cap |
| `src/guardrails/riskState.ts` | ❌ TODO | Needs update to re-export from riskStateStore |
| `src/guardrails/forex.ts` | ❌ TODO | `validateForexOrder()`, pip-size calc, spread check, session guard |
| `src/guardrails/index.ts` | ❌ TODO | Needs to export forex.ts |

### Step 4 — Tool Definitions

| File | Status | Notes |
|---|---|---|
| `src/tools/definitions.ts` | ❌ TODO | Add `market: 'crypto' \| 'forex'` param to all tools; add `stopPips` to `place_order` |

### Config

| File | Status | Notes |
|---|---|---|
| `.env.example` | ❌ TODO | Add OANDA, TWELVE_DATA, FINNHUB, COINGECKO vars |

### Scheduler

| File | Status | Notes |
|---|---|---|
| `src/scheduler/index.ts` | ❌ TODO | Wire up cron job calling loop.ts every 15m |

---

## Resumption Instructions

When continuing, implement in this order:

### 1. `src/guardrails/riskStateStore.ts`
Per-market DayState map. Same logic as current `riskState.ts` but keyed by `'crypto' | 'forex'`. Add a combined notional cap check (total across both markets).

### 2. `src/guardrails/riskState.ts`
Change to re-export the crypto-market functions from `riskStateStore.ts` for backward compat.

### 3. `src/guardrails/forex.ts`
```ts
validateForexOrder(params: OrderParams, spread: number, sessionOpen: boolean, riskState: RiskState): ValidationResult
```
Checks:
- Daily loss gate (forex market)
- `sessionOpen` must be true
- `spread <= MAX_SPREAD_PIPS` (env var, default 3)
- `stopPips >= MIN_STOP_PIPS` (env var, default 10)
- pip-based notional check: `units × pipValue × stopPips <= remainingBudget`
- Combined notional cap across both markets

### 4. `src/guardrails/index.ts`
Add `export * from './forex.js'` and `export * from './riskStateStore.js'`

### 5. `src/tools/definitions.ts`
- Add `market: { type: 'string', enum: ['crypto', 'forex'] }` to `get_snapshot`, `get_order_book`, `get_recent_trades`, `get_open_orders`, `place_order`, `cancel_order`
- Add `stopPips: { type: 'number' }` to `place_order`
- Add corresponding TypeScript interface fields

### 6. `src/agent/prompt.ts`
```ts
buildSystemPrompt(market: 'crypto' | 'forex', symbol: string, context: MarketContext, riskState: RiskState): string
```
Market-aware prompt with:
- Current session label (forex) or market regime note (crypto)
- Fear & Greed interpretation if < 25 or > 75
- Upcoming high-impact events warning
- Risk budget remaining
- Tool usage guidance (stopPips for forex, etc.)

### 7. `src/agent/dispatcher.ts`
```ts
handleToolCall(toolName: string, input: Record<string, unknown>): Promise<string>
```
- Reads `input.market` to resolve adapter via `getAdapter()`
- Routes to correct adapter method
- Runs guardrail validation before `place_order`
- Returns JSON string result

### 8. `src/agent/loop.ts`
Main loop:
```ts
runCycle(symbol: string, market: 'crypto' | 'forex'): Promise<void>
```
1. `getRiskState(market)` from riskStateStore
2. `buildMarketContext(symbol, market)` (parallel enrichment)
3. `adapter.getSnapshot(symbol, riskState)` + attach context
4. `buildSystemPrompt(...)`
5. Claude API call with `TOOLS`
6. Tool call loop: `handleToolCall()` until `stop_reason === 'end_turn'`
7. `recordFill(market, pnl)` if order placed
8. Log result

### 9. `src/scheduler/index.ts`
Wire up node-cron: every 15 minutes call `runCycle` for each configured market/symbol pair from env vars.

### 10. `.env.example`
Add:
```
OANDA_API_KEY=
OANDA_ACCOUNT_ID=
OANDA_PAPER=true
TWELVE_DATA_KEY=
FINNHUB_KEY=
COINGECKO_KEY=
```

---

## Key Design Decisions Made

- **No npm package for OANDA** — raw `fetch` wrapper in `oanda.ts`
- **`getRecentTrades` for OANDA returns `[]`** — OANDA v20 REST has no public tape
- **Swap rates are placeholder `0`** — OANDA financing rates require a separate endpoint; can be added later
- **Enrichment failures are silent** — a broken enrichment source never blocks the trade cycle
- **Backward-compat exports** — `binance.ts` keeps all standalone function exports so nothing breaks
- **`BinanceAdapter` and `OandaAdapter` are singletons** — `binanceAdapter` / `oandaAdapter` exported from their files, registry uses them
