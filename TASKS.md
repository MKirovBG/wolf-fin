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

## Phase 2 — Agent Loop (next)

- [ ] Adapter abstraction — `IMarketAdapter` interface so Binance + Forex share a contract
- [ ] Agent loop — agentic loop with tool-use (`src/agent/index.ts`)
  - [ ] Cycle: getSnapshot → Claude reasons → tool calls → guardrails → execute
  - [ ] Tool dispatcher — routes Claude tool_use results to the right adapter method
  - [ ] Decision types: HOLD | BUY qty @ limit | SELL qty @ limit | CANCEL orderId
- [ ] Paper-trading mode — dry-run flag, log orders without sending to exchange
- [ ] Strategy system prompt — market context framing, persona, decision format

## Phase 3 — Forex Integration

See `FOREX_PLAN.md` for full architecture and rollout.

- [ ] OANDA adapter — `src/adapters/oanda.ts` (REST wrapper matching IMarketAdapter)
- [ ] Forex-specific types — pip value, lot size, spread, margin, swap rate
- [ ] Forex indicators — tick-volume RSI/EMA (no reliable quote volume in OTC FX)
- [ ] Market hours guard — block orders when session is closed or spread too wide
- [ ] Pip-based risk sizing — position size calc from account risk% and pip distance
- [ ] Multi-asset tool routing — `get_snapshot("EURUSD", "forex")` vs `"BTCUSDT", "crypto"`
- [ ] Cross-asset guardrails — separate daily budgets per market, combined notional cap
- [ ] Session awareness prompt — London/NY/Tokyo overlap logic injected into Claude context

## Phase 4 — Operations

- [ ] Fastify HTTP server — `/status`, `/portfolio`, `/pause`, `/resume` endpoints
- [ ] Scheduler — cron per market (crypto: every 15m; forex: on candle close, session-aware)
- [ ] Pino structured logging with trade audit trail
- [ ] Alerting — Telegram or email on: daily limit hit, large fill, error

## Phase 5 — Live Trading

- [ ] Crypto: switch `BINANCE_TESTNET=false`, end-to-end integration test
- [ ] Forex: switch OANDA to live account, verify pip values and margin maths
- [ ] Performance dashboard — realized P&L, win rate, avg R:R per market
- [ ] Drawdown monitoring — auto-pause if max drawdown threshold crossed
- [ ] Multi-symbol support — generalize single-symbol loop to a symbol list
