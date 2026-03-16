# Wolf-Fin Agent — Structure Reference

A concise guide for defining and understanding how agents work in this system.
Use this as the starting point whenever you create or modify an agent configuration or custom prompt.

---

## 1. Agent Config (`AgentConfig`)

Every agent is defined by this object, stored in the database and passed to `runAgentCycle()`.

```typescript
interface AgentConfig {
  symbol: string                          // e.g. "XAUUSD", "BTCUSDT", "EUR_USD"
  market: 'crypto' | 'forex' | 'mt5'     // routes to Binance / Alpaca / MetaTrader 5
  paper: boolean                          // true = simulated fills, false = live orders
  maxIterations: number                   // max Claude tool-call loops per cycle (usually 5–8)
  fetchMode: 'manual' | 'scheduled' | 'autonomous'
  scheduleIntervalMinutes: number         // how often to run a cycle
  maxLossUsd: number                      // daily loss limit in USD — blocks all orders when hit
  maxPositionUsd: number                  // max notional per position
  customPrompt?: string                   // appended to system prompt as ADDITIONAL INSTRUCTIONS
  mt5AccountId?: number                   // MT5 only: which account login to trade on
}
```

**Key flags:**
| Flag | Paper (`true`) | Live (`false`) |
|------|---------------|----------------|
| `place_order` result | `PAPER_FILLED` (no real order) | Real MT5 / exchange order |
| Risk guardrails | Still enforced | Still enforced |
| Logs | Prefixed `[PAPER]` | Normal |

---

## 2. The Cycle Loop (`runAgentCycle`)

Each scheduled tick calls `runAgentCycle(config)`. The loop:

```
1. Acquire cycle lock           → prevents concurrent runs for the same agent
2. Check daily loss limit       → skip if remainingBudgetUsd = 0
3. Build system prompt          → role + rules + session note + performance history + customPrompt
4. Build user message           → signal priority checklist for this tick
5. Loop (up to maxIterations):
   a. Send messages to Claude (claude-opus-4-6 by default)
   b. If stop_reason = "tool_use"  → dispatch tools, append results, continue loop
   c. If stop_reason = "end_turn"  → parse DECISION + REASON, record cycle, break
6. Release cycle lock
```

---

## 3. Available Tools

Claude can call these tools during a cycle. **Use at most 3 per cycle.**

| Tool | When to call |
|------|-------------|
| `get_snapshot` | **Always first.** Returns price, candles, indicators, account, risk state |
| `get_order_book` | Optional — only when sizing a new entry to check liquidity |
| `get_recent_trades` | Optional — tape read, buyer/seller aggression |
| `get_open_orders` | Optional — review existing positions |
| `place_order` | To execute BUY or SELL |
| `cancel_order` | To cancel an open order by `orderId` |

---

## 4. Snapshot Data Structure

`get_snapshot` returns a `MarketSnapshot`. Claude reads this JSON directly.

```jsonc
{
  "price": {
    "last": 3045.50,          // current mid price
    "bid": 3045.20,
    "ask": 3045.80
  },
  "stats24h": {
    "high": 3060.10,
    "low": 3020.40,
    "changePercent": 0.82
  },

  // Multi-timeframe candles — 100 bars each (raw OHLCV)
  "candles": {
    "M1":  [ { "openTime": 1710000000, "open": 3044, "high": 3046, "low": 3043, "close": 3045, "volume": 120 }, ... ],
    "M15": [ ... ],
    "H1":  [ ... ],
    "H4":  [ ... ]
  },

  // Pre-computed indicators — derived from H1 candles
  "indicators": {
    "rsi14": 43.56,           // 0–100. <30 oversold, >70 overbought
    "ema20": 3038.10,         // fast trend
    "ema50": 3042.80,         // slow trend — EMA20 < EMA50 = bearish bias
    "atr14": 25.57,           // Average True Range in price units (pips for forex/MT5)
    "vwap":  3040.00,         // Volume-weighted average price
    "bbWidth": 0.0111         // Bollinger Band width — low = compression, high = expansion
  },

  // Forex / MT5 specific
  "forex": {
    "spread": 21.4,           // Current spread in pips (commodity-corrected)
    "pipValue": 1.0,          // USD value of 1 pip per 1 lot
    "sessionOpen": true,      // Is a major session currently active?
    "swapLong": -6.50,        // Overnight swap cost for long positions (MT5 only)
    "swapShort": 2.10         // Overnight swap cost for short positions (MT5 only)
  },

  // Account state
  "account": {
    "balances": [
      { "asset": "EQUITY",      "free": 10000.00, "locked": 0 },
      { "asset": "BALANCE",     "free": 9950.00,  "locked": 0 },
      { "asset": "FREE_MARGIN", "free": 9500.00,  "locked": 500 }
    ],
    "openOrders": [
      {
        "orderId": 1234,
        "symbol": "XAUUSD",
        "side": "BUY",
        "price": 3020.00,
        "origQty": 0.10,
        "status": "OPEN"
      }
    ]
  },

  // Risk state (pre-computed by guardrails)
  "risk": {
    "remainingBudgetUsd": 1000,   // Daily loss headroom left
    "openNotionalUsd": 302.00,    // Current notional in open positions
    "dailyLimitHit": false
  },

  // Enrichment context (news, fear/greed, calendar)
  "context": {
    "fearGreedIndex": 62,          // Crypto only
    "upcomingEvents": [],          // High-impact economic events
    "newsHeadlines": []
  }
}
```

---

## 5. Required Decision Output Format

Claude **must** end every cycle with this exact format (parsed by regex):

```
DECISION: [HOLD | BUY <qty> @ <price> | SELL <qty> @ <price> | CANCEL <orderId>]
REASON: <1–2 sentences of evidence>
```

Examples:
```
DECISION: BUY 0.05 @ 3041.50
REASON: EMA20 crossed above EMA50 on H1, RSI recovering from oversold (32→48), ATR-based SL set at 25 pips.

DECISION: HOLD
REASON: Spread (85 pips) exceeds max threshold. Awaiting spread normalisation.

DECISION: SELL 0.10 @ 3060.00
REASON: Price rejected daily high with bearish engulf candle; RSI divergence (price HH, RSI LH) confirms momentum shift.
```

---

## 6. Guardrails (non-bypassable)

Guardrails run **inside `dispatchTool`** before any real order reaches the exchange.

| Guardrail | Default | Env override |
|-----------|---------|-------------|
| Max spread (MT5/forex) | 3 pips | `MAX_SPREAD_PIPS=100` |
| Min stop distance | 10 pips | `MIN_STOP_PIPS=10` |
| Daily loss limit | Per agent `maxLossUsd` | — |
| Max position notional | Per agent `maxPositionUsd` | — |
| Session gate | Must be Tokyo/London/NY | — |

If a guardrail blocks the order, `place_order` returns:
```json
{ "blocked": true, "reason": "Spread too wide: 3200 pips > 40 pip max" }
```
Claude sees this in its tool result and should output `DECISION: HOLD` with the block reason.

---

## 7. System Prompt Composition

The final system prompt sent to Claude is built as:

```
[base role + mode tag]
[RISK RULES]
[SESSION NOTE — forex/MT5 only]
[RECENT PERFORMANCE — last 10 cycles]
[DECISION FORMAT]
[ADDITIONAL INSTRUCTIONS: <customPrompt>]   ← your custom strategy goes here
```

The `customPrompt` field in `AgentConfig` is the primary way to inject strategy-specific logic
(e.g., ICT/SMC rules, lot-sizing formulas, symbol-specific filters) without touching server code.

---

## 8. Lot Sizing (MT5 / Forex)

Recommended formula for a 0.25% risk-per-trade approach. Claude computes this from snapshot data:

```
equity   = snapshot.account.balances[0].free   // EQUITY balance
pipValue = snapshot.forex.pipValue              // USD per pip per lot (from snapshot)
SL_pips  = <your ATR-based SL distance>

lots = (equity × 0.0025) / (SL_pips × pipValue)
lots = round_down(lots, 2)                      // MT5 accepts 2 decimal places
lots = clamp(lots, 0.01, 5.00)                  // hard min/max safety
```

Both `equity` and `pipValue` are **live server-provided values** inside the snapshot JSON.
Claude reads them from the `get_snapshot` tool result — no server pre-computation needed.

---

## 9. Adding a New Agent — Checklist

1. **Set env vars** for the market:
   - MT5: `MT5_BRIDGE_PORT`, `MAX_SPREAD_PIPS` (e.g. `100` for gold)
   - Forex: `ALPACA_API_KEY`, `ALPACA_SECRET_KEY`
   - Crypto: `BINANCE_API_KEY`, `BINANCE_API_SECRET`

2. **Register MT5 accounts** in `mt5-bridge/mt5_accounts.json` (if using MT5).

3. **Create agent via UI** (Agents page → New Agent):
   - Choose market + symbol
   - Pick MT5 account from dropdown
   - Set `paper: false` only when ready for live trading
   - Paste custom strategy into the "Custom Prompt" field

4. **Test one manual cycle** — watch the Logs tab for spread gates, guardrail blocks, decision output.

5. **Enable scheduled mode** once manual cycles are producing valid decisions.

---

## 10. File Map

```
src/
├── agent/
│   ├── index.ts            ← runAgentCycle() — the main loop
│   ├── context.ts          ← market enrichment (fear/greed, news, calendar)
│   └── AGENT_REFERENCE.md  ← this file
├── tools/
│   └── definitions.ts      ← Anthropic tool schemas (get_snapshot, place_order, …)
├── adapters/
│   ├── registry.ts         ← getAdapter(market) — routes to correct exchange
│   ├── mt5.ts              ← MetaTrader 5 adapter
│   ├── alpaca.ts           ← Forex adapter
│   └── binance.ts          ← Crypto adapter
├── guardrails/
│   ├── mt5.ts              ← Spread, SL, session checks for MT5
│   ├── forex.ts            ← Spread, SL, session checks for forex
│   └── validate.ts         ← Crypto position/loss checks
├── types.ts                ← AgentConfig, AgentState, CycleResult
└── server/
    └── index.ts            ← REST API — /api/agents, /api/mt5-accounts, …
```
