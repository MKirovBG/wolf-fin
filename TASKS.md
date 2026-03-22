# Wolf-Fin — Task Tracker

## Phase 1 — Foundation ✅ complete

- [x] Project scaffold (pnpm, TypeScript, ESM)
- [x] Folder structure: agent / tools / adapters / guardrails / scheduler
- [x] `.env.example` with placeholder API keys
- [x] `src/adapters/types.ts` — domain types (MarketSnapshot, Order, Balance, Fill, etc.)
- [x] `src/adapters/indicators.ts` — RSI(14), EMA, ATR(14), VWAP, BB width
- [x] `src/adapters/binance.ts` — Binance REST wrapper + `getSnapshot`
- [x] `src/tools/definitions.ts` — 6 Anthropic tool schemas (get_snapshot, place_order, etc.)
- [x] `src/guardrails/riskState.ts` — daily P&L tracker, budget gate
- [x] `src/guardrails/validate.ts` — pre-execution order validation

## Phase 2 — Agent Loop ✅ complete

- [x] Adapter abstraction — `IMarketAdapter` interface (`src/adapters/interface.ts`)
- [x] Agent loop — agentic loop with tool-use (`src/agent/index.ts`)
  - [x] Cycle: getSnapshot → Claude reasons → tool calls → guardrails → execute
  - [x] Tool dispatcher — routes Claude tool_use results to the right adapter method
  - [x] Decision types: HOLD | BUY qty @ limit | SELL qty @ limit | CANCEL orderId
- [x] Paper-trading mode — per-agent paper flag, orders routed to paper account
- [x] Strategy system prompt — market context framing, persona, decision format
- [x] Performance history — recent decisions injected into system prompt
- [x] Concurrent cycle lock — prevents overlapping runs for same agent
- [x] Candle stripping — removes raw candle data from message history to reduce tokens

## Phase 3 — Forex Integration ✅ complete

- [x] MT5 adapter — `src/adapters/mt5.ts` (HTTP wrapper to Python bridge matching IMarketAdapter)
- [x] Forex-specific types — pip value, lot size, spread, margin, swap rate
- [x] Market hours guard — block orders when session is closed or spread too wide
- [x] Pip-based risk sizing — position size calc from account risk% and pip distance
- [x] Multi-asset tool routing — `get_snapshot("XAUUSD", "mt5")` vs `"BTCUSDT", "crypto"`
- [x] Cross-asset guardrails — separate daily budgets per market, combined notional cap
- [x] Session awareness prompt — London/NY/Tokyo overlap logic injected into Claude context

## Phase 4 — Operations ✅ mostly complete

- [x] Fastify HTTP server — full REST API (`/api/agents`, `/api/cycle`, `/api/accounts`, etc.)
- [x] Scheduler — cron per agent with manual/scheduled/autonomous modes
- [x] Pino structured logging with trade audit trail
- [x] SQLite persistence — agents, cycle_results (with pnl_usd), log_entries, settings
- [x] Risk state persistence — daily P&L hydrated from DB on startup
- [x] Frontend — Dashboard, Agents, AgentDetail, Positions, Logs, Settings, Account pages
- [x] Live log terminal — real-time agent cycle streaming
- [ ] Alerting — Telegram or email on: daily limit hit, large fill, error

## Phase 5 — Live Trading

- [ ] Crypto: switch to live Binance, end-to-end integration test
- [ ] Forex: verify MT5 live account pip values and margin calculations
- [ ] Drawdown monitoring — auto-pause if max drawdown threshold crossed
- [ ] Multi-symbol support — generalize single-symbol loop to a symbol list
- [ ] Performance analytics — win rate, avg R:R, Sharpe ratio per market
