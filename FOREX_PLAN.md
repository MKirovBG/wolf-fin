# Wolf-Fin — Forex Expansion Plan

## Why Forex

Crypto runs 24/7, is highly volatile, and has thin liquidity windows. Forex pairs
(EUR/USD, GBP/USD, USD/JPY, etc.) are the most liquid markets in the world, trade
24/5, have lower spread-to-volatility ratios during session overlaps, and provide
natural diversification — the agent's edge in one market may not correlate with the
other.

---

## 1. Broker / API Choice

The broker used for this project is **Alpaca**.

| Criterion | Alpaca | OANDA | IBKR (TWS) | FXCM |
|---|---|---|---|---|
| REST API | Yes, clean REST v2 | Yes, v20 API | No (FIX/TWS socket) | Yes |
| Paper account | Yes, free | Yes, free | Yes | Yes |
| Npm SDK | `@alpacahq/alpaca-trade-api` | Unofficial | ibkr SDK (complex) | fxcm-rest |
| Lot flexibility | 1 unit minimum | 1 unit minimum | 1000 unit minimum | 1000 unit |
| Data quality | Good | Good (own book) | Excellent | Good |
| Regulation | FINRA | FCA / CFTC | FCA / CFTC | FCA |

**Decision: Alpaca** — unified REST API for both crypto and forex, free paper trading, good SDK support.

Alpaca REST base: `https://api.alpaca.markets` (live) / `https://paper-api.alpaca.markets` (paper).
Forex data: `https://data.alpaca.markets/v1beta3/forex/`.

---

## 2. Architecture Changes

### 2a. Adapter Interface (`IMarketAdapter`)

Currently `src/adapters/binance.ts` is a collection of functions. To support Forex
we need a shared contract. Add `src/adapters/interface.ts`:

```ts
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

  // Forex-only (optional, return null for crypto)
  getSpread?(symbol: string): Promise<number | null>
  isMarketOpen?(symbol: string): Promise<boolean>
}
```

Binance adapter wraps its functions in a class implementing this interface.
Alpaca adapter is a second implementation.

### 2b. Adapter Registry

```ts
// src/adapters/registry.ts
const adapters: Record<string, IMarketAdapter> = {
  crypto: new BinanceAdapter(),
  forex: new AlpacaAdapter(),
}

export function getAdapter(market: 'crypto' | 'forex'): IMarketAdapter {
  return adapters[market]
}
```

The agent loop and tool dispatcher call `getAdapter(market)` — they never import
Binance or Alpaca directly.

### 2c. Tool Routing

Tools gain a `market` parameter:

```ts
// get_snapshot tool input
{ symbol: 'EURUSD', market: 'forex' }
{ symbol: 'BTCUSDT', market: 'crypto' }
```

The tool dispatcher resolves the adapter from the registry and calls the same
method name. Claude's system prompt tells it which `market` value to use per
symbol.

---

## 3. Forex-Specific Data

### 3a. What Changes in MarketSnapshot

| Field | Crypto (Binance) | Forex (Alpaca) |
|---|---|---|
| `price.bid/ask` | From order book | From Alpaca latest forex quote |
| `price.last` | Last trade | Mid-price (no tape in OTC) |
| `stats24h.volume` | Base asset volume | Tick count / notional (proxy) |
| `candles` | Klines endpoint | Alpaca `/v1beta3/forex/bars` |
| `indicators.vwap` | Volume-weighted | Tick-VWAP (lower confidence) |
| `indicators.*` | Same formulas | Same formulas on OHLC |

New Forex-only fields to add to `MarketSnapshot.forex?`:

```ts
forex?: {
  spread: number          // ask - bid in pips
  pipValue: number        // USD value per pip per lot
  marginRequired: number  // margin for 1 standard lot
  sessionOpen: boolean    // is the market in an active session?
  swapLong: number        // overnight swap rate long
  swapShort: number       // overnight swap rate short
}
```

### 3b. Session Awareness

Forex has three major sessions with different liquidity profiles:

| Session | UTC Open | UTC Close | Best pairs |
|---|---|---|---|
| Tokyo | 00:00 | 09:00 | JPY pairs |
| London | 08:00 | 17:00 | EUR, GBP pairs |
| New York | 13:00 | 22:00 | USD pairs |
| London+NY overlap | 13:00 | 17:00 | Highest liquidity |

The scheduler should prefer the London/NY overlap for major pairs and avoid
trading in the 30 min before/after session open (spread widens). This state is
injected into the Claude system prompt each cycle.

---

## 4. Forex-Specific Guardrails

### 4a. Pip-Based Position Sizing

Crypto uses `notionalUsd`. Forex uses **pip risk**:

```
position_lots = (account_risk_usd) / (stop_distance_pips × pip_value_per_lot)
```

Example: Risk $50, stop 20 pips, EUR/USD pip value $10/lot (standard lot 100k units):
`lots = 50 / (20 × 10) = 0.25 lots = 25,000 units`

`validate.ts` needs a `validateForexOrder()` that checks:
- Max lot size (account leverage × free margin)
- Spread ≤ threshold (don't trade when spread is 3× normal)
- Market is open
- Stop distance ≥ minimum (e.g. 10 pips to avoid noise)
- Combined notional across all open positions ≤ max

### 4b. Separate Daily Budgets

Risk state becomes per-market:

```ts
interface RiskStateStore {
  crypto: RiskState
  forex: RiskState
}
```

A blow-up in crypto doesn't disable forex trading and vice versa, but there's a
combined notional cap (total exposure across both markets).

---

## 5. Claude Prompt Changes

Claude needs context about what market it is reasoning about. The system prompt
will be parameterized per cycle:

```
You are Wolf-Fin, an autonomous trading agent.

Current market: FOREX (EURUSD)
Session: London/NY overlap (high liquidity)
Spread: 0.8 pips (normal)
Risk budget remaining: $140 today

Available tools: get_snapshot, get_order_book, place_order, cancel_order, get_open_orders

When placing forex orders:
- Always specify a stop-loss distance in pips via the `stopPips` field
- Prefer limit orders; avoid market orders when spread > 1.5 pips
- One position per symbol at a time
```

For crypto the session block is replaced with market regime context (bull/bear,
funding rate, etc.).

---

## 6. New Files Required

| File | Purpose |
|---|---|
| `src/adapters/interface.ts` | `IMarketAdapter` contract |
| `src/adapters/registry.ts` | Adapter lookup by market |
| `src/adapters/alpaca.ts` | Alpaca REST wrapper implementing `IMarketAdapter` |
| `src/adapters/session.ts` | Forex session open/close logic |
| `src/guardrails/forex.ts` | `validateForexOrder()`, pip-size calc |
| `src/guardrails/riskStateStore.ts` | Per-market risk state + combined cap |
| `src/agent/prompt.ts` | Parameterized system prompt builder |
| `src/agent/dispatcher.ts` | Tool dispatcher (routes to correct adapter) |

Changes to existing files:

| File | Change |
|---|---|
| `src/adapters/types.ts` | Add `forex?` field to `MarketSnapshot`; add `ForexOrderParams` |
| `src/adapters/binance.ts` | Wrap functions in `BinanceAdapter` class |
| `src/tools/definitions.ts` | Add `market` param to all tools; add `stopPips` to `place_order` |
| `src/guardrails/riskState.ts` | Extract into `riskStateStore.ts` (per-market) |
| `.env.example` | Add `ALPACA_KEY`, `ALPACA_SECRET`, `ALPACA_PAPER=true` |

---

## 7. Rollout Sequence

```
Step 1 — Abstraction (no new features, just refactor)
  Introduce IMarketAdapter, wrap BinanceAdapter, add registry.
  All existing tests must still pass.

Step 2 — Alpaca paper adapter ✅ complete
  AlpacaAdapter built against paper account.
  getSnapshot("EUR_USD") returns a well-formed MarketSnapshot.
  Indicators computed from Alpaca forex bars.

Step 3 — Forex guardrails ✅ complete
  validateForexOrder(), session guard, spread check.
  Pip-based risk sizing implemented.

Step 4 — Agent loop with market routing ✅ complete
  Agent loop routes by `market` param via adapter registry.
  Binance (crypto) and Alpaca (forex) run in separate scheduler slots.

Step 5 — Live forex
  Switch ALPACA_PAPER=false on small position sizes.
  Monitor 2 weeks before increasing size.
```

---

## 8. Risks and Mitigations

| Risk | Mitigation |
|---|---|
| Forex spread widens during news (NFP, FOMC) | Economic calendar guard — skip cycle if high-impact event within 30 min |
| Leverage amplifies losses | Hard max leverage cap in `validateForexOrder` regardless of broker margin |
| Alpaca API rate limits | Cache candles for 1m; don't re-fetch within same candle window |
| Cross-market correlation (USD in both BTC and forex) | Future: correlation matrix — reduce forex USD exposure if crypto is long heavy |
| Session open gaps | Detect daily gap on Monday open, skip first candle |
