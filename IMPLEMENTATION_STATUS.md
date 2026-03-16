# Wolf-Fin Implementation Status

Last updated: 2026-03-16

---

## Overall Progress: Phase 1–4 mostly complete (~85%)

---

## Core Architecture

### Adapters (`src/adapters/`)
- `interface.ts` — `IMarketAdapter` contract with optional forex methods
- `registry.ts` — `getAdapter('crypto' | 'forex')` lookup
- `binance.ts` — `BinanceAdapter` class (crypto) + backward-compat exports
- `alpaca.ts` — `AlpacaAdapter` class (forex) with bracket stop-loss orders
- `session.ts` — Forex session open/close logic (Sydney/Tokyo/London/NewYork)
- `types.ts` — `MarketSnapshot`, `OrderParams` (with `stopPips`, `stopPrice`), `MarketContext`

### Enrichment Adapters
- `feargreed.ts` — Alternative.me Fear & Greed index
- `coingecko.ts` — BTC dominance + total market cap
- `cryptopanic.ts` — CryptoPanic headlines
- `calendar.ts` — Finnhub economic calendar + `isHighImpactEventSoon()`
- `twelvedata.ts` — Twelve Data candle fallback for forex

### Agent (`src/agent/`)
- `index.ts` — `runAgentCycle()` agentic loop with Claude tool-use
- `context.ts` — `buildMarketContext()` parallel enrichment fetcher
- System prompt includes: market context, session info, risk budget, performance history
- Cycle user message: structured signal priority, 3-tool-call limit guidance
- Candle stripping from message history (keeps indicators, drops raw OHLC)
- Concurrent cycle lock via `src/server/state.ts`

### Guardrails (`src/guardrails/`)
- `validate.ts` — `validateOrder()` for crypto
- `forex.ts` — `validateForexOrder()` with pip sizing, spread check, session guard
- `riskStateStore.ts` — Per-market risk state, DB hydration on startup
- `riskState.ts` — Re-exports from riskStateStore

### Database (`src/db/`)
- SQLite via `better-sqlite3`
- Tables: `agents`, `cycle_results` (with `pnl_usd`), `log_entries`, `settings`
- `dbGetTodayRealizedPnl()` — daily P&L query for risk hydration
- `dbGetAgentPerformance()` — recent decision history for system prompt

### Server (`src/server/`)
- Fastify 5.8 serving REST API + React SPA
- Endpoints: `/api/agents`, `/api/cycle`, `/api/accounts`, `/api/logs`, `/api/settings`
- `/api/accounts` — fetches Alpaca (paper+live) and Binance account data
- State: cycle lock (`tryAcquireCycleLock` / `releaseCycleLock`)

### Frontend (`frontend/src/`)
- React 18 + Vite + Tailwind CSS (dark terminal theme) + Recharts
- Pages: Dashboard, Agents, AgentDetail, Positions, Logs, Settings, Account
- Components: Layout (nav), LiveLog (real-time streaming)
- Account page: Alpaca cards (paper/live) + Binance card with positions, fills, balances

---

## Key Design Decisions

- **Alpaca for forex** — sole forex broker; OANDA fully removed
- **Bracket orders** — forex stop-loss sent as `order_class: 'bracket'` with computed `stopPrice`
- **Enrichment failures are silent** — broken enrichment never blocks a trade cycle
- **Performance context** — last N decisions shown in system prompt; HOLD streak warning at 5+
- **Risk persistence** — `pnl_usd` stored in `cycle_results`; hydrated from DB on startup
- **Concurrent cycle lock** — in-memory `Set<string>` prevents overlapping runs per agent
- **Candle stripping** — raw candle arrays removed from tool result history to save tokens

---

## Remaining Work

- [ ] Alerting (Telegram/email on daily limit hit, large fill, error)
- [ ] Live trading cutover (Binance live, Alpaca live)
- [ ] Drawdown auto-pause
- [ ] Multi-symbol per agent
- [ ] Performance analytics (win rate, Sharpe, R:R)
