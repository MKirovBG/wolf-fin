# Wolf-Fin — Database Documentation

**Engine:** SQLite via `better-sqlite3` (synchronous)
**File location:** `data/wolf-fin.db`
**Journal mode:** WAL (Write-Ahead Logging) — enabled on init for better concurrent read performance
**ORM layer:** `src/db/index.ts`

---

## Schema

### Table: `agents`

Stores the full configuration and runtime state of every registered trading agent.

```sql
CREATE TABLE agents (
  key         TEXT PRIMARY KEY,      -- "market:symbol" e.g. "mt5:XAUUSD"
  config      TEXT NOT NULL,         -- JSON-stringified AgentConfig
  status      TEXT NOT NULL DEFAULT 'idle',   -- 'idle' | 'running' | 'paused'
  cycle_count INTEGER NOT NULL DEFAULT 0,
  started_at  TEXT,                  -- ISO 8601 timestamp when last started
  last_cycle  TEXT                   -- JSON-stringified CycleResult (latest cycle)
);
```

**`config` JSON shape:**
```json
{
  "symbol": "XAUUSD",
  "market": "mt5",
  "paper": false,
  "maxIterations": 10,
  "fetchMode": "autonomous",
  "scheduleIntervalMinutes": 5,
  "maxLossUsd": 200,
  "maxPositionUsd": 1000,
  "customPrompt": "…",
  "mt5AccountId": 1111343,
  "llmProvider": "openrouter",
  "llmModel": "openrouter/healer-alpha"
}
```

**`last_cycle` JSON shape:**
```json
{
  "symbol": "XAUUSD",
  "market": "mt5",
  "paper": false,
  "decision": "SELL 0.1 @ 5012.5",
  "reason": "Bearish EMA cross, RSI neutral…",
  "time": "2026-03-16T21:39:25.000Z",
  "pnlUsd": null
}
```

**Access patterns:**
- Startup: load all agents to restore in-memory state
- Agent create/update: upsert row
- Status change: update `status` + `started_at`
- Cycle complete: update `last_cycle` + increment `cycle_count`

---

### Table: `cycle_results`

Immutable history of every completed trading cycle. Primary source for reports and P&L calculation.

```sql
CREATE TABLE cycle_results (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_key TEXT NOT NULL,      -- FK to agents.key (not enforced)
  symbol    TEXT NOT NULL,      -- e.g. "XAUUSD"
  market    TEXT NOT NULL,      -- "crypto" | "forex" | "mt5"
  paper     INTEGER NOT NULL,   -- 0 = live, 1 = paper (SQLite boolean)
  decision  TEXT NOT NULL,      -- "BUY 0.1 @ 2650" | "SELL 0.5 @ 1.085" | "HOLD"
  reason    TEXT NOT NULL,      -- Agent's explanation
  time      TEXT NOT NULL,      -- ISO 8601 timestamp
  error     TEXT,               -- Error message if cycle failed
  pnl_usd   REAL                -- Realised P&L in USD (null until position closed)
);
```

**Usage:**
- Appended after every cycle (never updated)
- `pnl_usd` populated when a closing trade is matched
- Queried for:
  - Daily P&L sum by market (risk limit enforcement)
  - Report summaries (buy/sell/hold counts)
  - Per-agent performance history (last N decisions)

**Key queries:**

```sql
-- Daily realised P&L for a market
SELECT COALESCE(SUM(pnl_usd), 0)
FROM cycle_results
WHERE market = ? AND paper = 0
  AND date(time) = ?
  AND pnl_usd IS NOT NULL;

-- All cycle results with optional market filter
SELECT * FROM cycle_results
WHERE (? IS NULL OR market = ?)
ORDER BY time DESC;

-- Last N decisions for an agent (performance summary)
SELECT decision, reason, time, pnl_usd, error
FROM cycle_results
WHERE agent_key = ?
ORDER BY id DESC
LIMIT ?;
```

---

### Table: `log_entries`

Append-only event log for all agent activity. Powers the live log terminal in the UI.

```sql
CREATE TABLE log_entries (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  time      TEXT NOT NULL,       -- ISO 8601 timestamp
  agent_key TEXT NOT NULL,       -- "mt5:XAUUSD" or "system"
  level     TEXT NOT NULL,       -- "info" | "warn" | "error" | "debug"
  event     TEXT NOT NULL,       -- See event types below
  message   TEXT NOT NULL,       -- Human-readable description
  data      TEXT                 -- Optional JSON payload
);
```

**Log levels:**
| Level | Used for |
|-------|---------|
| `info` | Normal cycle activity (start, tool calls, decisions) |
| `warn` | Non-fatal issues (guardrail blocks, session skips) |
| `error` | Cycle errors, tool errors, LLM failures |
| `debug` | Verbose data (full snapshots, raw responses) |

**Event types:**
| Event | Meaning |
|-------|---------|
| `cycle_start` | Agent cycle begins |
| `cycle_end` | Agent cycle completes normally |
| `cycle_error` | Unhandled error during cycle |
| `cycle_skip` | Cycle skipped (already running — lock contention) |
| `session_skip` | Cycle skipped (forex market closed) |
| `tool_call` | LLM requested a tool (e.g. `get_snapshot`) |
| `tool_result` | Tool returned data to LLM |
| `tool_error` | Tool call threw an error |
| `claude_thinking` | LLM response text (thinking/decision) |
| `decision` | Final parsed DECISION line |
| `guardrail_block` | Order rejected by pre-trade validation |
| `auto_execute` | Auto-placed order from DECISION text (safety net) |
| `auto_execute_error` | Auto-execute failed |

**`data` JSON examples:**
```json
// tool_call
{ "tool": "get_snapshot", "input": { "symbol": "XAUUSD", "market": "mt5" } }

// tool_result
{ "price": 5012.5, "rsi": 47.7, "ema20": 5011.1 }

// guardrail_block
{ "reason": "Spread 2100 pips exceeds maximum 40 pips" }

// decision
{ "decision": "SELL 0.1 @ 5012.5", "reason": "Bearish EMA cross…" }
```

**Polling for UI:**
```sql
-- Fetch logs since last known ID (long-polling style)
SELECT * FROM log_entries
WHERE id > ? AND (? IS NULL OR agent_key = ?)
ORDER BY id ASC
LIMIT 200;

-- Get max ID (for clear-floor feature)
SELECT MAX(id) FROM log_entries;
```

**Log clear floor:** Stored in `settings` table. Logs with `id <= floor` are hidden from UI (not deleted from disk). Useful for clearing visual clutter without losing history.

---

### Table: `settings`

Key/value store for server-side configuration that persists across restarts.

```sql
CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
```

**Current keys:**

| Key | Value | Purpose |
|-----|-------|---------|
| `log_clear_floor` | Integer string | Hides log entries with `id ≤ value` from UI |

---

## ORM Functions (`src/db/index.ts`)

### Initialisation

```typescript
initDb(): void
```
- Opens `data/wolf-fin.db` (creates file if missing)
- Enables WAL journal mode
- Creates all 4 tables if they don't exist
- Called once at server startup from `src/main.ts`

---

### Agent Operations

```typescript
dbGetAllAgents(): AgentState[]
```
Returns all rows from `agents` with `config` and `last_cycle` JSON-parsed.

```typescript
dbUpsertAgent(agent: AgentState): void
```
INSERT OR REPLACE into `agents`. Serialises `config` and `last_cycle` to JSON.

```typescript
dbRemoveAgent(key: string): void
```
Deletes agent row. Does **not** cascade to `cycle_results` or `log_entries`.

```typescript
dbUpdateAgentStatus(key: string, status: AgentStatus, startedAt?: string): void
```
Minimal update — only touches `status` and `started_at` columns.

---

### Cycle Recording

```typescript
dbRecordCycle(key: string, result: CycleResult): void
```
Inserts one row into `cycle_results`. Called at end of every cycle.

```typescript
dbGetCycleResults(market?: string, limit?: number): CycleResultRow[]
```
Fetches cycle history ordered newest-first. Optional market filter. Default limit 500.

```typescript
dbGetTodayRealizedPnl(market: string, dateStr: string): number
```
SUM of non-null `pnl_usd` for live trades (`paper=0`) on a given date. Used by risk engine at startup to hydrate daily P&L state from persistent history.

```typescript
dbGetAgentPerformance(agentKey: string, limit?: number): AgentPerformanceSummary
```
Returns:
```typescript
{
  totalCycles: number
  buys: number
  sells: number
  holds: number
  lastDecisions: Array<{ decision, reason, time, pnlUsd, error }>
}
```

---

### Log Operations

```typescript
dbLogEvent(entry: LogEntry): void
```
Inserts one row into `log_entries`. `data` field JSON-serialised if object.

```typescript
dbGetLogs(sinceId?: number, agentKey?: string, limit?: number): LogEntry[]
```
Fetches log entries with `id > sinceId`, optional agent filter. Default limit 200. Used by UI long-poll endpoint.

```typescript
dbGetMaxLogId(): number
```
Returns current maximum `id` in `log_entries`. Used when clearing logs.

```typescript
dbGetLogClearFloor(): number
```
Returns `settings.log_clear_floor` (default 0 if not set).

```typescript
dbSetLogClearFloor(id: number): void
```
Upserts `settings.log_clear_floor`. Logs with `id ≤ floor` hidden from `dbGetLogs`.

---

## Data Flow Diagram

```
Server startup
  └─► initDb()
  └─► dbGetAllAgents() → restore AppState.agents
  └─► dbGetTodayRealizedPnl('crypto' | 'forex' | 'mt5') → hydrateRiskStateFromDb()

Agent created (POST /api/agents)
  └─► dbUpsertAgent(agentState)

Agent started (POST /api/agents/:key/start)
  └─► dbUpdateAgentStatus(key, 'running', now)

Each cycle (runAgentCycle)
  ├─► dbLogEvent(…cycle_start…)
  ├─► [tool calls]  → dbLogEvent(…tool_call…), dbLogEvent(…tool_result…)
  ├─► dbLogEvent(…decision…)
  ├─► dbRecordCycle(key, result)       ← appends to cycle_results
  └─► dbUpsertAgent(updatedState)      ← updates last_cycle + cycle_count

Agent deleted (DELETE /api/agents/:key)
  └─► dbRemoveAgent(key)               ← agent row only; history preserved

Log clear (POST /api/logs/clear)
  └─► dbSetLogClearFloor(maxId)        ← hides old logs, does not delete
```

---

## Risk State Hydration on Restart

When the server restarts, all in-memory P&L counters are zero. To avoid trading over the daily limit after a restart, the server reads today's realised P&L from the DB and restores the risk engine:

```typescript
// src/main.ts
const cryptoPnl = dbGetTodayRealizedPnl('crypto', today)
const forexPnl  = dbGetTodayRealizedPnl('forex',  today)
const mt5Pnl    = dbGetTodayRealizedPnl('mt5',    today)

hydrateRiskStateFromDb('crypto', cryptoPnl)
hydrateRiskStateFromDb('forex',  forexPnl)
hydrateRiskStateFromDb('mt5',    mt5Pnl)
```

This means the `MAX_DAILY_LOSS_USD` limit survives server restarts within the same calendar day.

---

## Maintenance Notes

**Database file:** `data/wolf-fin.db` — excluded from git via `.gitignore`

**Backup:** Copy `data/wolf-fin.db` while server is stopped (or use SQLite `.backup` command for hot copy)

**Inspect manually:**
```bash
# Node.js one-liner
node -e "
const db = require('better-sqlite3')('data/wolf-fin.db');
db.prepare('SELECT key, status, cycle_count FROM agents').all().forEach(r => console.log(r));
"

# Check today's P&L
node -e "
const db = require('better-sqlite3')('data/wolf-fin.db');
const today = new Date().toISOString().slice(0,10);
const rows = db.prepare(\"SELECT market, SUM(pnl_usd) as pnl FROM cycle_results WHERE date(time)=? AND paper=0 GROUP BY market\").all(today);
console.log(rows);
"
```

**Force-toggle paper mode on an agent:**
```bash
node -e "
const db = require('better-sqlite3')('data/wolf-fin.db');
const agent = db.prepare('SELECT config FROM agents WHERE key=?').get('mt5:XAUUSD');
const cfg = JSON.parse(agent.config);
cfg.paper = false;
db.prepare('UPDATE agents SET config=? WHERE key=?').run(JSON.stringify(cfg), 'mt5:XAUUSD');
console.log('Done — paper:', false);
"
```

**WAL checkpoint (reclaim disk space after heavy logging):**
```bash
node -e "require('better-sqlite3')('data/wolf-fin.db').pragma('wal_checkpoint(TRUNCATE)')"
```
