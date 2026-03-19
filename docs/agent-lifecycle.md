# Wolf-Fin Agent Lifecycle — Complete Technical Reference

> How an agent runs, what data is gathered, when it's saved, and the full data flow.

---

## 🔁 Startup — User Presses "Start"

```
┌──────────────────────────────────────────────────────────────────────┐
│                     USER PRESSES "START"                             │
│                                                                      │
│  Frontend → POST /api/agents/:key/start                             │
│  Server   → startAgentSchedule(config)                              │
│                                                                      │
│  ┌─ fetchMode = "manual"? ──→ marks agent "running", waits for     │
│  │                            Trigger button (fires 1 tick each)    │
│  │                                                                   │
│  └─ fetchMode = "autonomous"? ──→ starts continuous loop:           │
│                                                                      │
│     while (!signal.cancelled) {                                     │
│       ┌─ Has scheduledStartUtc/EndUtc? ─→ sleep until window opens │
│       │                                                              │
│       ├─ await runAgentTick(config) ──────────────────────────┐     │
│       │                                                        │     │
│       └─ Check guardrail: if status === 'paused' → stop loop │     │
│     }                                                                │
└──────────────────────────────────────────────────────────────────────┘
```

- **Manual mode**: Agent is marked "running" but only ticks when you click Trigger. Each press fires exactly one tick.
- **Autonomous mode**: Continuous async loop — tick completes → next tick starts immediately. No interval, no overlap.
- **Scheduled mode**: Same as autonomous but sleeps (in 30s cancellable chunks) outside the configured UTC time window.
- **Stopping**: Setting `signal.cancelled = true` breaks the loop. Happens on Stop button, guardrail pause, or rate limit.

---

## 📍 Inside `runAgentTick()` — The Heart of Everything

### Phase 1: SETUP

```
┌─────────────────────────────────────────────────────────────────────┐
│ 1. ACQUIRE LOCK                                                     │
│    tryAcquireCycleLock(agentKey) — prevents duplicate ticks          │
│    If locked → skip ("Tick already running")                        │
│                                                                      │
│ 2. LOAD SESSION                                                     │
│    loadOrCreateSession(agentKey)                                    │
│    → Checks SQLite agent_sessions for today's date                  │
│    → If new day: creates fresh session (tickCount=0, messages=[])   │
│    → If existing: restores messages + summary from DB               │
│    → If isNew: calls autoSummarisePreviousSession() to compress    │
│      yesterday's session into agent_memories (cross-session memory)  │
│                                                                      │
│ 3. AUTO-PLAN CHECK                                                  │
│    if (isFirstTick && no plan exists today) → tickType = 'planning' │
│    if (queued plan request from UI) → tickType = 'planning'         │
└─────────────────────────────────────────────────────────────────────┘
```

- The **cycle lock** is a simple `Set<string>` — one agent can only run one tick at a time.
- **Session** persists the full conversation history for today. On server restart, it's restored from SQLite.
- **Cross-session memory**: On the first tick of a new day, yesterday's session is compressed into a summary and saved to `agent_memories` with a 14-day TTL.
- **Auto-plan**: If no plan exists for today, the first tick automatically runs as a planning tick before any trading happens.

---

### Phase 2: DATA GATHERING (before LLM is called)

```
┌─────────────────────────────────────────────────────────────────────┐
│ 4. PRE-FETCH SNAPSHOT (via MT5 bridge)                              │
│    Calls get_snapshot → Python bridge → MT5 terminal                │
│    Returns:                                                          │
│    ┌──────────────────────────────────────────────────────────────┐ │
│    │ • price: { bid, ask, last }                                  │ │
│    │ • indicators: { rsi14, ema20, ema50, atr14 }                │ │
│    │ • forex: { spread, sessionOpen, pipValue, point }           │ │
│    │ • candles: { h1: [...last 5], h4: [...last 3] }            │ │
│    │ • positions[]: open trades (ticket, side, vol, P&L, SL, TP)│ │
│    │ • pendingOrders[]: unfilled limit/stop orders               │ │
│    │ • accountInfo: { balance, equity, freeMargin, leverage }    │ │
│    │ • keyLevels[]: computed S/R from candle highs/lows + pivots │ │
│    └──────────────────────────────────────────────────────────────┘ │
│                                                                      │
│ 5. DETECT EXTERNAL CLOSES                                           │
│    Compare current positions[] vs lastKnownPositions                │
│    → Missing tickets = closed by SL/TP/manual                       │
│    → Fetches P&L from MT5 deal history                              │
│    → Records EXTERNAL_CLOSE to cycle_results (DB only, not UI)      │
│    → Builds externalCloseNote string for the LLM                    │
│                                                                      │
│ 6. FETCH TODAY'S CLOSED DEALS                                       │
│    mt5Adpt.getDeals(symbol, 1 day, 20 limit)                       │
│    → Attached to snapshot so agent sees won/lost trades             │
│                                                                      │
│ 7. GUARDRAIL CHECKS (can abort tick here)                           │
│    a. Daily loss guard: todayPnl ≤ -maxDailyLossUsd → PAUSE        │
│    b. Drawdown guard: equity drop ≥ maxDrawdownPercent → PAUSE      │
│    If either triggers → agent paused, tick returns, loop stops      │
│                                                                      │
│ 8. FORMAT SNAPSHOT SUMMARY (human-readable text for LLM)            │
│    Account: Balance $97,490 | Equity $97,400 | Leverage 1:500      │
│    Price: 4697.06 | Bid: 4696.90 | Ask: 4697.22                   │
│    Spread: 3.2 pips | Session: OPEN                                │
│    RSI14: 14.7 | EMA20: 4824.39 | EMA50: 4900.20 | ATR14: 24.5   │
│    H4 (last 3 bars): 4849▲ → 4708▼ → 4696▼                       │
│    H1 (last 5 bars): 4827▼ 4763▼ 4727▼ 4708▼ 4696▼               │
│    Sizing (1% risk $974, ATR×1.5 stop ~$367/lot): suggested 0.02  │
│    Open Positions: none                                              │
│    Key Levels (8): SUPPORT 4686.65 [daily_low] ★★★ ...            │
│    Closed trades today (3): #405321 SELL 0.1 @ 4691 | P&L: -$79   │
│                                                                      │
│ 9. FETCH NEWS (non-blocking, optional)                              │
│    Finnhub forex news for the symbol → headlines + sentiment        │
│                                                                      │
│ 10. BUILD TICK MESSAGE (the "user" message sent to LLM)             │
│    ┌─────────────────────────────────────────────────────────────┐  │
│    │ Tick #18 | 9:17:15 AM | XAUUSD (MT5) | 7h 44m left        │  │
│    │                                                             │  │
│    │ CURRENT MARKET SNAPSHOT (auto-fetched):                    │  │
│    │ [... formatted snapshot above ...]                          │  │
│    │                                                             │  │
│    │ ⚠ EXTERNALLY CLOSED: #405321 SELL 0.1 @ 4691 P&L -$79    │  │
│    │ IMPORTANT: Call save_memory to record what happened...     │  │
│    │                                                             │  │
│    │ EVALUATION ORDER — follow strictly every tick:             │  │
│    │ 0. VERIFY STATE — call get_open_orders FIRST              │  │
│    │ 1. MANAGE OPEN POSITIONS (a-e sub-steps)                   │  │
│    │ 2. MANAGE PENDING ORDERS                                   │  │
│    │ 3. IF NO POSITION — analyse for new entry (a-g checks)    │  │
│    │ 4. LIMIT ORDERS                                            │  │
│    │ 5. LEARN — save_memory after any closed trade             │  │
│    │                                                             │  │
│    │ TASK: Evaluate the market and manage your positions...     │  │
│    └─────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

- **Snapshot** is fetched via HTTP to the Python MT5 bridge running on localhost.
- **Key levels** are computed from H4/H1 candle highs/lows + pivot points, sorted by proximity to current price.
- **External close detection** compares `lastKnownPositions` (in-memory Map) with current snapshot positions. Tickets that disappeared were closed externally (SL/TP hit, or manual close in MT5).
- **Guardrails** run before LLM is called — if daily loss or drawdown limit is hit, the tick aborts immediately and the agent is paused.
- **Snapshot summary** is plain text injected directly into the tick message so the LLM has all data without needing to call get_snapshot.

---

### Phase 3: LLM CONVERSATION LOOP

```
┌─────────────────────────────────────────────────────────────────────┐
│ 11. BUILD SYSTEM PROMPT (rebuilt each tick)                          │
│     Composed from:                                                   │
│     ┌───────────────────────────────────────────────────────────┐   │
│     │ ROLE: "Patient, disciplined, risk-first trader..."        │   │
│     │ CORE PHILOSOPHY: 5 rules (patience, no revenge, etc.)     │   │
│     │ SELF-IMPROVEMENT: 4 rules (save_memory, post-mortems)     │   │
│     │ PROCESS: 7 steps                                          │   │
│     │ RISK RULES: structural SL/TP, R:R ≥ 1.5, trailing       │   │
│     │ MT5 RULES: session, spread, position management           │   │
│     │                                                           │   │
│     │ DYNAMIC SECTIONS (from DB):                               │   │
│     │ • RECENT PERFORMANCE: last 10 decisions summary           │   │
│     │ • STRATEGY: entry/exit rules (if user defined one)        │   │
│     │ • PERSISTENT MEMORY: saved observations, patterns, risks  │   │
│     │ • SESSION PLAN: bias, key levels, risk notes              │   │
│     │ • SESSION HISTORY: compressed earlier ticks summary        │   │
│     │                                                           │   │
│     │ EXECUTION RULES: tool call before DECISION line           │   │
│     │ DECISION FORMAT: HOLD / BUY / SELL / CLOSE / CANCEL      │   │
│     └───────────────────────────────────────────────────────────┘   │
│                                                                      │
│ 12. SEND TO LLM (loop, max 15 iterations)                          │
│                                                                      │
│     ┌─── Iteration 1 ───────────────────────────────────────────┐  │
│     │ Send: system prompt + full message history + tick message  │  │
│     │ LLM responds with: tool_use (get_open_orders)             │  │
│     │ → Execute tool → return result → append to messages       │  │
│     └───────────────────────────────────────────────────────────┘  │
│     ┌─── Iteration 2 ───────────────────────────────────────────┐  │
│     │ LLM sees: open orders result + full context               │  │
│     │ LLM responds with: tool_use (save_memory)                 │  │
│     │ → Save memory to DB → return result → append to messages  │  │
│     └───────────────────────────────────────────────────────────┘  │
│     ┌─── Iteration 3 ───────────────────────────────────────────┐  │
│     │ LLM sees: everything so far                               │  │
│     │ LLM responds with: tool_use (place_order)                 │  │
│     │ → Guardrail check → MT5 bridge → order result             │  │
│     │ → If FILLED: append warning "this is a position now"      │  │
│     │ → If LIMIT: order is pending, will fill later             │  │
│     └───────────────────────────────────────────────────────────┘  │
│     ┌─── Iteration 4 (end_turn) ────────────────────────────────┐  │
│     │ LLM responds with TEXT (no more tool calls)               │  │
│     │ Text contains:                                             │  │
│     │   DECISION: BUY 0.1 @ 4700 SL: 4686 TP: 4730            │  │
│     │   REASON: Bounce from daily low support, R:R 2.3:1       │  │
│     │                                                            │  │
│     │ → Parse DECISION + REASON from text                       │  │
│     │ → Auto-execute safety net (if agent wrote DECISION        │  │
│     │   without calling place_order — parse SL/TP and execute)  │  │
│     │ → recordCycle() → DB + frontend broadcast                 │  │
│     │ → BREAK out of loop                                       │  │
│     └───────────────────────────────────────────────────────────┘  │
│                                                                      │
│     ALTERNATIVE: Planning tick                                      │
│     ┌─── Iteration 1-3 ─────────────────────────────────────────┐  │
│     │ LLM analyses snapshot, identifies levels, writes bias     │  │
│     │ Calls: save_plan(bias, keyLevels, planText)               │  │
│     │ Optionally calls: save_memory(price_level, ...)           │  │
│     │ Responds: PLAN: Bearish bias, sell pullbacks to 4730     │  │
│     │ → No trading tools available (filtered out for planning) │  │
│     └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

- The **system prompt** is rebuilt every tick because dynamic sections (memories, plan, performance) may have changed.
- The **message history** is the full conversation for today's session. The LLM sees all prior decisions and reasoning.
- **Tool loop**: The LLM can call multiple tools in sequence. Each tool call is executed, result appended, and the LLM is called again. This continues until the LLM responds with `end_turn` (text only, no tool calls).
- **Auto-execute safety net**: If the LLM writes "DECISION: BUY 0.1 @ 4700" but forgot to call `place_order`, the system parses the decision line and auto-executes the order (including SL/TP from the text).
- **Planning ticks** have trading tools (place_order, close_position, etc.) removed from the available tool list, so the LLM can only analyse and plan.

---

### Phase 4: SAVE & CLEANUP

```
┌─────────────────────────────────────────────────────────────────────┐
│ 13. COMPRESS SESSION (if > 20 messages)                             │
│     Older tick messages are compressed into a summary string:       │
│     "• SELL 0.1 @ 4698 — breakdown trade at daily low             │
│       ↳ place_order: SELL 0.1 @ 4698                               │
│     • HOLD — stopped out, waiting for confirmation"                 │
│     Messages array is trimmed; summary stored separately            │
│                                                                      │
│ 14. PERSIST SESSION TO DB                                           │
│     session.tickCount++                                             │
│     dbSaveSession(agentKey, { date, tickCount, messages, summary }) │
│     → SQLite agent_sessions table (UPSERT on agent_key + date)     │
│                                                                      │
│ 15. LOG TICK COMPLETE                                               │
│     "Tick #18 complete | session has 18 messages | 18 ticks today" │
│                                                                      │
│ 16. RELEASE LOCK                                                    │
│     releaseCycleLock(agentKey) — always runs (finally block)        │
│                                                                      │
│ → Control returns to scheduler loop → next tick starts immediately  │
└─────────────────────────────────────────────────────────────────────┘
```

- **Session compression** keeps memory usage bounded. Once messages exceed 20, older tick conversations are compressed into a one-line-per-decision summary. The summary is included in the system prompt as "SESSION HISTORY" so the LLM still knows what happened.
- **Session persistence** writes to SQLite on every tick — survives server restarts.
- **Lock release** is in a `finally` block — always runs even if the tick crashes.

---

## 💾 What Gets Saved Where

| Data | Table | When Saved | Persists |
|------|-------|------------|----------|
| **Decision + Reason** | `cycle_results` | End of every tick | Forever |
| **Session messages** | `agent_sessions` | End of every tick (UPSERT) | Overwritten daily |
| **Session summary** (compressed old ticks) | `agent_sessions.summary` | When messages > 20 | Overwritten daily |
| **Cross-session memory** | `agent_memories` (category='session') | First tick of new day | 14-day TTL |
| **Agent memories** (levels, patterns, risk) | `agent_memories` | When agent calls `save_memory` | Until deleted/expired |
| **Session plan** (bias, levels) | `agent_plans` | When agent calls `save_plan` | 1 per day per agent |
| **Strategy** (entry/exit rules) | `agent_strategies` | User-defined in UI | Until user changes |
| **Log entries** | `log_entries` | Every event during tick | Forever |
| **Agent state** (lastCycle, status) | `agents` | Every `recordCycle()` | Overwritten |
| **External closes** | `cycle_results` | Detected at tick start | Forever |
| **P&L** | `cycle_results.pnl_usd` | When position closes | Forever |

---

## 🔄 Data Flow Into the LLM

Each tick, the LLM receives this context hierarchy:

```
SYSTEM PROMPT (rebuilt each tick):
├── Static: Role, Philosophy, Process, Risk Rules, MT5 Rules, Execution Rules
├── From DB: Recent Performance (last 10 cycle_results)
├── From DB: Strategy (agent_strategies)
├── From DB: Memories (agent_memories — up to 20, grouped by category)
├── From DB: Active Plan (agent_plans — today's plan)
└── From DB: Session History (agent_sessions.summary — compressed old ticks)

MESSAGE HISTORY (session.messages — up to 20 recent messages):
├── [User] Tick #1 message + snapshot
├── [Assistant] tool_use: get_open_orders
├── [User] tool_result: []
├── [Assistant] tool_use: save_plan(...)
├── [User] tool_result: { ok: true }
├── [Assistant] "PLAN: Bearish, sell pullbacks..."
├── [User] Tick #2 message + snapshot
├── [Assistant] tool_use: get_open_orders
├── [User] tool_result: []
├── [Assistant] "DECISION: HOLD — waiting for pullback to 4730"
├── ... (older messages compressed to summary)
├── [User] Tick #18 message + snapshot + ⚠ EXTERNAL CLOSE
├── [Assistant] tool_use: get_open_orders → save_memory → (thinking)
└── [Assistant] "DECISION: HOLD — recording lesson from failed short"
```

---

## 🛠 Available Tools (by tick type)

### Trading Tick Tools
| Tool | Purpose |
|------|---------|
| `get_snapshot` | Full market data (price, indicators, candles, positions, account) |
| `get_open_orders` | Current positions + pending orders (called every tick as step 0) |
| `get_recent_trades` | Tape reading — recent market trades |
| `get_trade_history` | MT5 closed deals with P&L and exit reason |
| `place_order` | BUY/SELL with LIMIT/MARKET, includes stopPips + tpPips |
| `close_position` | Exit an open position by ticket |
| `cancel_order` | Cancel a pending limit/stop order |
| `modify_position` | Adjust SL/TP on an open position (trailing, breakeven) |
| `save_memory` | Persist an observation (price_level, pattern, risk, session, general) |
| `read_memories` | Query persistent memory |
| `delete_memory` | Remove stale memory |
| `save_plan` | Write/update session trading plan |
| `get_plan` | Retrieve current session plan |

### Planning Tick Tools
Same as above **minus**: `place_order`, `close_position`, `cancel_order`, `modify_position`

The agent can analyse and plan but cannot execute trades during a planning tick.

---

## 🔐 Guardrails & Safety

| Guardrail | Where | Action |
|-----------|-------|--------|
| **Cycle lock** | `runAgentTick()` entry | Prevents duplicate concurrent ticks |
| **Daily loss limit** | Phase 2, before LLM | Auto-pauses agent, stops loop |
| **Drawdown limit** | Phase 2, before LLM | Auto-pauses agent, stops loop |
| **Max iterations** | Phase 3, LLM loop | Aborts tick after 15 iterations |
| **Rate limit** | Phase 3, catch block | Emergency stop + close all positions |
| **Cancel-on-position guard** | Phase 3, tool dispatch | Blocks cancel_order on open positions |
| **Auto-execute safety net** | Phase 3, end_turn | Places order if LLM forgot to call tool |
| **Order validation** | `dispatchTool('place_order')` | Guardrail checks before MT5 execution |

---

## 📊 Evaluation Order (what the agent does each tick)

```
0. VERIFY STATE       → get_open_orders (mandatory, every tick)
1. MANAGE POSITIONS   → check P&L, trail SL, breakeven, hold or close
2. MANAGE ORDERS      → cancel stale pending orders
3. ANALYSE FOR ENTRY  → trend + momentum + key levels + R:R ≥ 1.5
4. LIMIT ORDERS       → prefer limit over market for better entry
5. LEARN              → save_memory after any closed trade (mandatory)
```

---

*Last updated: 2026-03-19*
