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

### Alpaca Adapter (`src/adapters/alpaca.ts`) — NEW
- Full `AlpacaAdapter` class implementing `IMarketAdapter`
- `getSnapshot()`: fetches M1/M15/H1/H4 candles via `/v1beta3/forex/bars`, live bid/ask from latest quote
- `getOrderBook()`: single-level book from latest forex quote
- `getRecentTrades()`: returns [] (Alpaca forex has no public trade tape)
- `getBalances()`: account equity + buying power from Alpaca brokerage API
- `getOpenOrders()`: maps open Alpaca orders to `Order[]`
- `getTradeHistory()`: closed orders endpoint
- `placeOrder()`: MARKET and LIMIT orders; bracket orders with `stop_loss` when `stopPrice` is set
- `cancelOrder()`: cancel by order ID
- `getSpread()`: live spread in pips from latest forex quote
- `isMarketOpen()`: delegates to session logic
- Symbol normalization: `EUR_USD` / `EURUSD` → `EUR/USD` (Alpaca format)

### Session Logic (`src/adapters/session.ts`) — NEW
- `openSessions()`: returns which of Sydney/Tokyo/London/NewYork are currently open
- `isForexSessionOpen()`: true when at least one major session is active
- `sessionLabel()`: human-readable label for system prompt (e.g. "London / New York overlap (highest liquidity)")

### Adapter Registry (`src/adapters/registry.ts`) — NEW
- `getAdapter('crypto')` → `BinanceAdapter`
- `getAdapter('forex')` → `AlpacaAdapter`

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

## ✅ All phases complete

The agent loop, tool dispatcher, guardrails, scheduler, and Alpaca adapter are all implemented.
See `src/agent/index.ts`, `src/scheduler/index.ts`, `src/guardrails/`, and `src/adapters/alpaca.ts`.

---

## Key Design Decisions Made

- **Alpaca for forex** — uses `@alpacahq/alpaca-trade-api` SDK; forex data fetched via REST `/v1beta3/forex/`
- **`getRecentTrades` for Alpaca returns `[]`** — Alpaca forex has no public trade tape
- **Swap rates are placeholder `0`** — financing rates not available from Alpaca forex API
- **Enrichment failures are silent** — a broken enrichment source never blocks the trade cycle
- **Backward-compat exports** — `binance.ts` keeps all standalone function exports so nothing breaks
- **`BinanceAdapter` and `AlpacaAdapter` are singletons** — exported from their files, registry uses them
