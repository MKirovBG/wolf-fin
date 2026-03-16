# Wolf-Fin — Frontend Documentation

**Framework:** React 18 · TypeScript · Vite
**Styling:** Tailwind CSS
**Charts:** Recharts
**Forms:** React Hook Form
**Root:** `frontend/src/`
**Dev server:** `npm run dev` → `http://localhost:5173`
**Build:** `npm run build` → output at `frontend-dist/` (served by backend in production)

---

## Directory Structure

```
frontend/src/
├── main.tsx                 React entry point
├── App.tsx                  Root component with routing
├── api/
│   └── client.ts            Typed fetch wrapper for all backend endpoints
├── types/
│   └── index.ts             TypeScript types mirroring backend models
├── pages/
│   ├── Dashboard.tsx        Live overview — stats, charts, logs, recent cycles
│   ├── Agents.tsx           Agent management — create, list, control
│   ├── AgentDetail.tsx      Single agent deep-dive — config, history, stats
│   ├── Positions.tsx        Open positions across all agents
│   ├── Account.tsx          Exchange account balances and equity
│   ├── Reports.tsx          Performance analytics and trade history
│   └── ApiKeys.tsx          API key configuration and testing
└── components/
    ├── Layout.tsx            App shell, sidebar navigation
    ├── Card.tsx              Reusable container card
    ├── Badge.tsx             Status/decision colour badges
    ├── AgentStatusBadge.tsx  Running/Paused/Idle indicator
    ├── AgentCard.tsx         Agent summary with control buttons
    ├── LogsTerminal.tsx      Live scrolling log stream
    ├── RiskBar.tsx           Budget remaining progress bar
    ├── MarketDataModal.tsx   Snapshot detail popup
    ├── Metric.tsx            Single metric display helper
    └── StatusDot.tsx         Green/red connection indicator
```

---

## Pages

### Dashboard `/`

The primary real-time view. Auto-refreshes every 10 seconds (configurable).

**Stats row:**
| Card | Value |
|------|-------|
| Total Agents | Count of all registered agents |
| Running | Agents with `status: running` |
| Today's P&L | Sum of `pnl_usd` from today's cycles |
| Risk Budget Left | `remainingBudgetUsd` from risk state |
| Total Cycles | Sum of all `cycleCount` values |

**Charts:**
- **Activity chart** (Recharts `AreaChart`) — stacked BUY / SELL / HOLD decisions over last 20 time buckets
- **Decision distribution** (`BarChart`) — percentage breakdown of decision types per market

**Agent grid:** One card per agent showing:
- Symbol + market badge
- Status badge (Running / Paused / Idle)
- Paper / Live mode badge
- Last decision and its timestamp
- Cycle count

**Log terminal** (`LogsTerminal`):
- Polls `GET /api/logs?sinceId={lastId}` every 3 seconds
- Colour-coded by level: `info` (white), `warn` (yellow), `error` (red), `debug` (grey)
- Event-type icons: ▶ CYCLE, ⚙ TOOL, ← RESULT, ★ DECISION, ✗ ERROR, 🤖 CLAUDE, ■ DONE
- Auto-scrolls to bottom; click any row to freeze scroll

**Recent cycles table:** Last 20 cycle results with symbol, market, mode, decision, reason, timestamp

---

### Agents `/agents`

Full agent lifecycle management.

**Create Agent form fields:**

| Field | Type | Notes |
|-------|------|-------|
| Symbol | Text | e.g. `XAUUSD`, `BTCUSDT`, `EURUSD` |
| Market | Select | `crypto` / `forex` / `mt5` |
| MT5 Account | Select | Shown only when market = `mt5`. Fetches from `GET /api/mt5-accounts`. Shows account name, login, mode, balance |
| LLM Provider | Radio | `Anthropic` / `OpenRouter` |
| Model | Select | Shown when `OpenRouter` selected. Dynamic list from `GET /api/openrouter/models` |
| Trading Mode | Radio | `Paper` (simulated) / `Live` (real orders) |
| Fetch Mode | Select | `Manual` / `Scheduled` / `Autonomous` |
| Interval | Number | Minutes between cycles (1–240). Shown when Scheduled/Autonomous |
| Max Daily Loss | Number | USD loss cap per day |
| Max Position Size | Number | USD max notional per position |
| Max Iterations | Number | LLM tool-use loops per cycle (default 10) |
| Custom Prompt | Textarea | Appended to system prompt as `ADDITIONAL INSTRUCTIONS:` |

**Agent card controls:**

| Button | API call | Result |
|--------|----------|--------|
| ▶ Start | `POST /api/agents/:key/start` | Activates scheduler, status → running |
| ⏸ Pause | `POST /api/agents/:key/pause` | Suspends cron, status → paused |
| ⏹ Stop | `POST /api/agents/:key/stop` | Removes cron, status → idle |
| ⚡ Trigger | `POST /api/agents/:key/trigger` | Fires one immediate cycle |
| 📊 Market Data | Opens `MarketDataModal` | Fetches `GET /api/market/:market/:symbol` |
| ✏ Edit | Opens config edit form | `PATCH /api/agents/:key/config` |
| 🗑 Delete | `DELETE /api/agents/:key` | Removes agent permanently |

---

### Agent Detail `/agents/:key`

Deep-dive view for a single agent.

**Stats grid:**
- Symbol, Market, Provider + Model, Mode (Paper/Live), Status
- MT5 Account (shown when `market === 'mt5'`) — displays `#accountId` or "Not set"
- Cycle count, Started at, Last cycle time
- Daily P&L, Remaining budget, Max loss cap

**Configuration panel:**
- Inline edit of all `AgentConfig` fields
- Save → `PATCH /api/agents/:key/config`

**Cycle history table:**
- All cycles for this agent from `GET /api/reports/trades?market=…`
- Columns: Time, Decision, Reason, P&L, Mode
- Decision colour: BUY = green, SELL = red, HOLD = yellow, ERROR = grey

**Live logs panel:**
- Filtered to this agent's key
- Same polling + colour logic as Dashboard terminal

---

### Positions `/positions`

Aggregated view of all open positions across every running agent.

**Table columns:**
| Column | Source |
|--------|--------|
| Symbol | `position.symbol` |
| Market | `position.market` |
| Side | BUY / SELL badge |
| Volume / Qty | `position.volume` |
| Entry Price | `position.priceOpen` |
| Current Price | `position.priceCurrent` |
| Unrealised P&L | `position.profit` |
| Account | MT5 login or exchange name |

Data from `GET /api/positions`.

---

### Account `/account`

Exchange account health for all connected brokers.

**Sections per account entry:**

**Alpaca (forex):**
- Equity, cash, buying power, unrealised P&L
- Open positions table: symbol, side, qty, avg entry, market value, P&L
- Recent fills: symbol, side, qty, price, time

**Binance (crypto):**
- Non-zero asset balances: asset, free, locked

**MT5 (one card per registered account):**
- Login, server, mode (DEMO / LIVE)
- Balance, equity, free margin
- Open positions list

---

### Reports `/reports`

Performance analytics and trade history.

**Summary cards (one per market — Crypto, Forex, MT5):**
- Total cycles, buys, sells, holds, errors
- Win rate (buys+sells as % of non-hold cycles)
- Daily realised P&L
- Remaining risk budget

**P&L chart** (Recharts `LineChart`):
- Cumulative P&L over time per market (crypto = blue, forex = green, MT5 = orange)
- Tooltip shows date + cumulative value

**Trade history table:**
- Market filter dropdown
- Columns: Time, Symbol, Market, Decision, Reason, P&L, Paper/Live
- Sorted newest-first

---

### API Keys `/settings`

Configure and validate all service credentials.

**Key rows:**

| Key | Service |
|-----|---------|
| `ANTHROPIC_API_KEY` | Claude (Anthropic) |
| `OPENROUTER_API_KEY` | OpenRouter multi-LLM |
| `BINANCE_API_KEY` + `BINANCE_SECRET` | Binance crypto |
| `ALPACA_KEY` + `ALPACA_SECRET` | Alpaca forex |
| `TWELVE_DATA_KEY` | Forex candle data |
| `FINNHUB_KEY` | Economic calendar |
| `COINGECKO_KEY` | Crypto market data |
| `CRYPTOPANIC_KEY` | Crypto news |

**Interactions:**
- Value field shows `••••••••` if already set
- Save → `POST /api/keys` → writes to `.env` file on server
- Test → `POST /api/keys/test/:service` → live connectivity check, returns `{ ok, message }`

---

## API Client (`frontend/src/api/client.ts`)

All API calls go through a single typed `api<T>(path, options?)` fetch wrapper that:
- Prefixes path with `/api`
- Throws on non-2xx responses (with error message from JSON body)
- Returns typed `T` on success

**Full function inventory:**

```typescript
// Status
getStatus(): Promise<StatusResponse>

// Agents
getAgents(): Promise<AgentState[]>
addAgent(config: AgentConfig): Promise<AgentState>
deleteAgent(key: string): Promise<void>
updateAgentConfig(key: string, patch: Partial<AgentConfig>): Promise<AgentState>
startAgent(key: string): Promise<void>
pauseAgent(key: string): Promise<void>
stopAgent(key: string): Promise<void>
triggerAgent(key: string): Promise<void>

// Market data
getMarketData(market: string, symbol: string): Promise<MarketSnapshot>

// API keys
getKeys(): Promise<KeysResponse>
setKey(key: string, value: string): Promise<void>
testKey(service: string): Promise<{ ok: boolean; message: string }>

// Logs
getLogs(sinceId?: number, agent?: string): Promise<LogEntry[]>
clearLogs(): Promise<void>

// Positions & trades
getPositions(): Promise<PositionEntry[]>
getTrades(): Promise<FillEntry[]>

// Reports
getReportSummary(): Promise<ReportSummary>
getReportTrades(market?: string): Promise<CycleResult[]>

// Accounts
getAccounts(): Promise<(AlpacaAccountEntry | BinanceAccountEntry | Mt5AccountEntry)[]>
getMt5Accounts(): Promise<Mt5AccountInfo[]>

// OpenRouter
getOpenRouterModels(): Promise<OpenRouterModel[]>
```

---

## Types (`frontend/src/types/index.ts`)

Key interfaces (mirrors backend `src/types.ts`):

```typescript
interface AgentConfig {
  symbol: string
  market: 'crypto' | 'forex' | 'mt5'
  paper: boolean
  maxIterations: number
  fetchMode: 'manual' | 'scheduled' | 'autonomous'
  scheduleIntervalMinutes: number
  maxLossUsd: number
  maxPositionUsd: number
  customPrompt?: string
  mt5AccountId?: number
  llmProvider?: 'anthropic' | 'openrouter'
  llmModel?: string
}

interface AgentState {
  config: AgentConfig
  status: 'idle' | 'running' | 'paused'
  lastCycle?: CycleResult
  startedAt?: string
  cycleCount: number
}

interface CycleResult {
  symbol: string
  market: string
  paper: boolean
  decision: string   // "BUY 0.1 @ 2650" | "SELL 0.5 @ 1.085" | "HOLD"
  reason: string
  time: string       // ISO timestamp
  error?: string
  pnlUsd?: number
}

interface MarketSnapshot {
  symbol: string
  timestamp: number
  market: string
  price: { bid: number; ask: number; last: number }
  stats24h?: { priceChangePercent: number; high: number; low: number; volume: number }
  candles: { m1: Candle[]; m15: Candle[]; h1: Candle[]; h4: Candle[] }
  indicators: Indicators   // rsi14, ema20, ema50, atr14, vwap, bbWidth
  account: { balances: Balance[]; openOrders: Order[] }
  risk: RiskState
  forex?: {
    spread: number       // in pips
    pipValue: number     // USD per pip per lot
    point: number        // tick size (0.0001 or 0.01 for JPY)
    sessionOpen: boolean
    swapLong: number
    swapShort: number
  }
}

interface Mt5AccountInfo {
  login: number
  name: string
  server: string
  balance: number | null
  equity: number | null
  currency: string
  mode: 'LIVE' | 'DEMO'
}

interface OpenRouterModel {
  id: string          // e.g. "openrouter/healer-alpha"
  name: string        // display name
  context_length: number
  pricing: { prompt: string; completion: string }
}
```

---

## Routing

Defined in `App.tsx` using React Router:

| Path | Component |
|------|-----------|
| `/` | `Dashboard` |
| `/agents` | `Agents` |
| `/agents/:key` | `AgentDetail` |
| `/positions` | `Positions` |
| `/account` | `Account` |
| `/reports` | `Reports` |
| `/settings` | `ApiKeys` |

---

## Components Reference

### `LogsTerminal`
- Props: `{ agentKey?: string }` (omit for all agents)
- Polls `getLogs(sinceId, agentKey)` every 3s
- Appends new entries, keeps last 500 in DOM
- Level → colour mapping:
  - `error` → red text
  - `warn` → yellow text
  - `debug` → grey text
  - `info` → white text
- Event → icon mapping:
  - `cycle_start` → ▶
  - `tool_call` → ⚙
  - `tool_result` → ←
  - `decision` → ★
  - `tool_error` / `cycle_error` → ✗
  - `claude_thinking` → 🤖
  - `cycle_end` → ■

### `RiskBar`
- Props: `{ used: number; max: number; label?: string }`
- Green → yellow → red as `used/max` increases
- Thresholds: <50% green, 50–80% yellow, >80% red

### `MarketDataModal`
- Fetches `GET /api/market/:market/:symbol` on open
- Displays: current price, 24h stats, indicators panel, last candle table, open orders

### `Badge`
- Props: `{ variant: 'buy'|'sell'|'hold'|'error'|'live'|'paper'|'crypto'|'forex'|'mt5'|'running'|'paused'|'idle' }`
- Colour scheme: buy=green, sell=red, hold=yellow, live=orange, paper=blue

---

## Development Setup

```bash
# Install dependencies
cd frontend && npm install

# Start dev server (hot reload on http://localhost:5173)
npm run dev

# Type check
npm run type-check

# Build for production (output → frontend-dist/)
npm run build
```

In development, the backend at `localhost:3000` proxies API calls. In production, the backend serves `frontend-dist/` as static files and falls back to `index.html` for SPA routing.

---

## Vite Config Notes

- `vite.config.ts` proxies `/api` → `http://localhost:3000` in dev mode
- Production build output path is `../frontend-dist` (consumed by Fastify static plugin)
- TypeScript strict mode enabled via `tsconfig.json`
