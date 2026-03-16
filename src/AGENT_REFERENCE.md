# Wolf-Fin — Agent Structure Reference

A complete reference for defining, configuring, and customising AI trading agents in Wolf-Fin.

---

## 1. Agent Config Object

Every agent is stored as a JSON `AgentConfig` record in `data/wolf-fin.db`.

```ts
interface AgentConfig {
  // ── Identity ─────────────────────────────────────────
  symbol:   string          // e.g. "XAUUSD", "BTCUSDT", "EURUSD"
  market:   'mt5' | 'crypto' | 'forex'

  // ── Execution mode ───────────────────────────────────
  paper:    boolean         // true = paper (simulated), false = live (real orders)
  fetchMode: 'manual' | 'scheduled' | 'autonomous'
  scheduleIntervalMinutes: number  // only used when fetchMode !== 'manual'

  // ── Risk controls ────────────────────────────────────
  maxLossUsd:      number   // Max cumulative loss in USD before agent stops
  maxPositionUsd:  number   // Max single position size in USD
  maxIterations:   number   // Max LLM tool-call rounds per cycle (default 10)

  // ── MT5 specific ─────────────────────────────────────
  mt5AccountId?: number     // MT5 login number (e.g. 1013336511). Required when market = 'mt5'

  // ── LLM provider ─────────────────────────────────────
  llmProvider?: 'anthropic' | 'openrouter'   // defaults to 'anthropic'
  llmModel?:    string      // OpenRouter model ID, e.g. "openai/gpt-4o" or "meta-llama/llama-3.1-70b-instruct"
                            // Ignored when llmProvider = 'anthropic' (uses CLAUDE_MODEL env var)

  // ── Strategy ─────────────────────────────────────────
  customPrompt?: string     // Appended as "ADDITIONAL INSTRUCTIONS:" at end of system prompt
}
```

---

## 2. Snapshot Data (what the agent sees each cycle)

When the agent calls `get_snapshot`, it receives a `MarketSnapshot`:

```jsonc
{
  "symbol": "XAUUSD",
  "price":  2652.45,
  "change24h": -0.42,           // % change

  // Candle history — 100 bars each
  "candles": {
    "M1":  [ { "open":2651, "high":2653, "low":2650, "close":2652, "volume":1200 }, ... ],
    "M15": [ ... ],
    "H1":  [ ... ],
    "H4":  [ ... ]
  },

  // Technical indicators — computed on H1
  "indicators": {
    "rsi14":   47.7,
    "ema20":   2648.5,
    "ema50":   2641.2,
    "atr14":   12.4,            // Average True Range in price units
    "vwap":    2650.1,
    "bbWidth": 0.0112           // Bollinger Band width (normalised)
  },

  // Forex/MT5 specific
  "forex": {
    "spread":      22.4,        // Current spread in PIPS (commodity-aware)
    "pipValue":    1.0,         // Value of 1 pip in account currency per lot
    "sessionOpen": true,
    "swapLong":   -6.5,         // Overnight swap cost for long positions
    "swapShort":   2.1
  },

  // Account state
  "account": {
    "balances": [
      { "asset": "EQUITY",      "free": 10050.00, "locked": 0 },
      { "asset": "BALANCE",     "free": 10000.00, "locked": 0 },
      { "asset": "FREE_MARGIN", "free":  9800.00, "locked": 0 }
    ],
    "openOrders": [
      {
        "orderId": 123,
        "symbol": "XAUUSD",
        "side": "SELL",
        "quantity": 0.5,
        "price": 2650.0,
        "stopPrice": 2670.0
      }
    ]
  },

  // Risk state (tracked across cycles)
  "risk": {
    "dailyLossUsd":    -45.50,
    "openPositionUsd":  500.00,
    "tradeCount":       3
  }
}
```

---

## 3. Available Tools

The agent has access to these tools each cycle:

| Tool | Description |
|------|-------------|
| `get_snapshot` | Full market snapshot — candles, indicators, account, risk |
| `get_order_book` | Level 2 bid/ask depth (MT5: may return empty) |
| `get_recent_trades` | Last N trades for the symbol (MT5 bridge must support it) |
| `place_order` | Submit a BUY/SELL MARKET or LIMIT order |
| `cancel_order` | Cancel an open order by orderId |
| `get_positions` | List all open positions |
| `close_position` | Close an open position by orderId |

### `place_order` Parameters

```ts
{
  symbol:      string          // "XAUUSD"
  market:      string          // "mt5"
  side:        'BUY' | 'SELL'
  type:        'MARKET' | 'LIMIT'
  quantity:    number          // Lots (e.g. 0.5 = 0.5 lot)
  price?:      number          // Required for LIMIT orders
  stopPrice?:  number          // Absolute stop-loss price
  stopPips?:   number          // Alternative: stop-loss distance in pips
}
```

When `paper: true` the order returns `status: PAPER_FILLED` — **no real order is placed**.
When `paper: false` the order is sent to the MT5 bridge and executed live.

---

## 4. System Prompt Structure

The final system prompt sent to the LLM is built as:

```
[Base strategy instructions]
  — Market/symbol context
  — Risk rules (maxLossUsd, maxPositionUsd, MAX_SPREAD_PIPS, MIN_STOP_PIPS)
  — Session and swap guidance
  — Order format requirements

ADDITIONAL INSTRUCTIONS:
[customPrompt field — your strategy appended here]
```

The `customPrompt` field is the **only part you control** when creating an agent.

---

## 5. Example Custom Prompts

### 5a. Simple EMA Trend-Follow (Forex)

```
You are a trend-following scalper on EURUSD M15.

Entry rules:
- BUY only when EMA20 > EMA50 and RSI > 50 and not overbought (RSI < 65)
- SELL only when EMA20 < EMA50 and RSI < 50 and not oversold (RSI > 35)
- Do not enter if spread > 3 pips

Sizing:
- Risk 1% of equity per trade
- equity = snapshot.account.balances[0].free
- SL = 15 pips from entry
- lots = (equity * 0.01) / (15 * snapshot.forex.pipValue)
- Round lots to 2 decimal places, minimum 0.01

Exit rules:
- TP = 2× SL distance
- Always set stopPrice when calling place_order
```

### 5b. ICT/SMC Scalper (XAUUSD)

```
You are a precision ICT/SMC scalper on XAUUSD.

Session bias:
- Trade only during London (07:00–10:00 UTC) or New York (13:00–16:00 UTC) kill zones
- Reject entries during dead sessions (21:00–01:00 UTC)

Required confluences for entry (need 3 of 4):
1. Price sweeps a liquidity level (recent high/low visible in M1/M15 candle data)
2. Fair Value Gap (FVG) present — a 3-candle imbalance in M1 or M15
3. Market Structure Shift (MSS) — first opposing candle after sweep that closes past the prior swing
4. RSI divergence — M15 RSI diverging from price at the sweep point

Spread gate:
- Reject if snapshot.forex.spread > 80 (gold spread in pips)

Position sizing:
- equity   = snapshot.account.balances[0].free
- pipValue = snapshot.forex.pipValue
- SL_pips  = distance from entry to stop in pips (your analysis)
- lots     = (equity * 0.0025) / (SL_pips * pipValue)
- Round to 2dp, cap at 5.0 lots maximum

Order format:
- Use LIMIT orders at FVG midpoint or MSS candle 50% retracement
- Always include stopPrice (absolute price level, not pips)
- State all 3+ confluences met in your REASON field
```

### 5c. Mean Reversion (Crypto)

```
You are a mean-reversion bot on BTCUSDT.

Entry:
- BUY when RSI14 (H1) < 30 and price is below lower Bollinger Band (bbWidth > 0.02)
- SELL when RSI14 (H1) > 70 and price is above upper Bollinger Band
- Never trade when bbWidth < 0.01 (consolidation, insufficient range)

Sizing:
- Fixed risk: $50 per trade
- SL: 1.5× ATR14 from entry
- TP: 1× ATR14 (tight, mean-reversion)
- quantity = $50 / (1.5 * snapshot.indicators.atr14)

Hold limit:
- If a position is open and RSI has returned to 50 (neutral), close it — do not wait for TP
```

---

## 6. Risk Guardrails (server-enforced, cannot be bypassed)

These run **after** the LLM decision and will block or modify orders regardless of the prompt:

| Guardrail | Default | Env var to override |
|-----------|---------|-------------------|
| Max spread (MT5) | 3 pips | `MAX_SPREAD_PIPS=100` |
| Min stop distance | 10 pips | `MIN_STOP_PIPS=5` |
| Daily loss limit | `maxLossUsd` from config | — |
| Max open position | `maxPositionUsd` from config | — |

> **XAUUSD note:** Gold spreads are 20–80 pips normally. Set `MAX_SPREAD_PIPS=100` in your `.env` or the guardrail will block every gold trade.

---

## 7. Paper vs Live Mode

| | Paper (`paper: true`) | Live (`paper: false`) |
|---|---|---|
| `place_order` response | `PAPER_FILLED` | Real MT5 order |
| Risk deducted | Yes (tracked in DB) | Yes (real P&L) |
| MT5 bridge called | Yes (snapshot only) | Yes (order + snapshot) |
| Real money | Never | Yes |

Switch between modes via the **Configuration panel** on the Agent Detail page (Paper / Live radio toggle → Save Changes).

---

## 8. LLM Providers

| Provider | Key env var | Model selection |
|----------|-------------|-----------------|
| Anthropic | `ANTHROPIC_API_KEY` | `CLAUDE_MODEL` env var (default: claude-opus-4-5) |
| OpenRouter | `OPENROUTER_API_KEY` | Per-agent `llmModel` field (chosen in UI) |

OpenRouter gives access to GPT-4o, Gemini, Llama, Mistral, and 100+ other models.
Set the key in **Settings → API Keys**, then select "OpenRouter" as the provider when creating an agent.

---

## 9. Cycle Flow

```
Scheduler triggers cycle
  └─ Build system prompt (base + customPrompt)
  └─ Resolve LLM provider (Anthropic / OpenRouter)
  └─ Agentic loop (up to maxIterations):
       LLM decides → calls tool → tool result → LLM decides → ...
  └─ LLM outputs final DECISION (BUY / SELL / HOLD / CLOSE)
  └─ Guardrails check (spread, stop, risk budget)
  └─ If paper=false → place real order via MT5 bridge
  └─ Log result to DB
```
