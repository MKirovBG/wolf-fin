# Wolf-Fin — Forex Expansion Plan

## Why Forex

Crypto runs 24/7, is highly volatile, and has thin liquidity windows. Forex pairs
(EUR/USD, GBP/USD, USD/JPY, etc.) are the most liquid markets in the world, trade
24/5, have lower spread-to-volatility ratios during session overlaps, and provide
natural diversification — the agent's edge in one market may not correlate with the
other.

---

## 1. Broker

**Alpaca** — unified REST API for both crypto and forex, free paper trading, good SDK support.

- Live: `https://api.alpaca.markets`
- Paper: `https://paper-api.alpaca.markets`
- Forex data: `https://data.alpaca.markets/v1beta3/forex/`

---

## 2. Architecture (implemented)

- **`IMarketAdapter`** — shared contract in `src/adapters/interface.ts`
- **Adapter Registry** — `getAdapter('crypto' | 'forex')` in `src/adapters/registry.ts`
- **AlpacaAdapter** — `src/adapters/alpaca.ts` implementing full `IMarketAdapter`
- **Tool routing** — tools take `market` param, dispatcher resolves adapter from registry
- **Bracket stop-loss** — `order_class: 'bracket'` with computed `stopPrice` for forex orders

---

## 3. Forex-Specific Data

| Field | Crypto (Binance) | Forex (Alpaca) |
|---|---|---|
| `price.bid/ask` | From order book | From Alpaca latest forex quote |
| `price.last` | Last trade | Mid-price (no tape in OTC) |
| `candles` | Klines endpoint | Alpaca `/v1beta3/forex/bars` |
| `indicators.*` | Computed from OHLC | Same formulas on OHLC |

Forex-only fields in `MarketSnapshot.forex`:
- `spread` (pips), `pipValue`, `sessionOpen`, `swapLong`, `swapShort`

---

## 4. Session Awareness (implemented)

| Session | UTC Open | UTC Close | Best pairs |
|---|---|---|---|
| Tokyo | 00:00 | 09:00 | JPY pairs |
| London | 08:00 | 17:00 | EUR, GBP pairs |
| New York | 13:00 | 22:00 | USD pairs |
| London+NY overlap | 13:00 | 17:00 | Highest liquidity |

Session info injected into Claude system prompt each cycle. Scheduler can avoid
trading in the 30 min before/after session transitions (spread widens).

---

## 5. Forex Guardrails (implemented)

- **Pip-based sizing**: `lots = risk_usd / (stop_pips × pip_value_per_lot)`
- **`validateForexOrder()`**: max lot, spread threshold, market open check, min stop distance
- **Separate daily budgets**: per-market `RiskState` — crypto blow-up doesn't disable forex
- **DB-persisted P&L**: `pnl_usd` column; hydrated from SQLite on startup

---

## 6. Risks and Mitigations

| Risk | Mitigation |
|---|---|
| Spread widens during news (NFP, FOMC) | Economic calendar guard — skip cycle if high-impact event within 30 min |
| Leverage amplifies losses | Hard max leverage cap in `validateForexOrder` |
| Alpaca API rate limits | Cache candles for 1m; don't re-fetch within same candle window |
| Cross-market correlation (USD in both BTC and forex) | Future: correlation matrix — reduce forex USD exposure if crypto is long heavy |
| Session open gaps | Detect daily gap on Monday open, skip first candle |

---

## 7. Remaining

- [ ] Alerting on high-impact economic events (Telegram/email)
- [ ] Live forex cutover (`ALPACA_PAPER=false`) with 2-week monitoring
- [ ] Correlation-based cross-market exposure limits
