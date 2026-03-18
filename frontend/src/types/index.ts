export type AgentStatus = 'idle' | 'running' | 'paused'

export interface GuardrailsConfig {
  sessionOpenCheck: boolean
  extremeSpreadCheck: boolean
  stopPipsRequired: boolean
}

export interface AgentConfig {
  name?: string
  symbol: string
  market: 'crypto' | 'mt5'
  fetchMode: 'manual' | 'scheduled' | 'autonomous'
  scheduleIntervalSeconds: number
  leverage?: number
  customPrompt?: string
  promptTemplate?: string
  guardrails?: Partial<GuardrailsConfig>
  mt5AccountId?: number
  llmProvider?: 'anthropic' | 'openrouter'
  llmModel?: string
  maxDailyLossUsd?: number
}

export interface OpenRouterModel {
  id: string
  name: string
  contextLength: number
  promptCost?: string
  completionCost?: string
}

export interface AgentState {
  agentKey: string        // always present — injected by GET /api/agents
  config: AgentConfig
  status: AgentStatus
  lastCycle: CycleResult | null
  startedAt: string | null
  cycleCount: number
}

export interface CycleResult {
  id?: number       // DB row id — present on list/detail responses
  agentKey?: string // "market:symbol" — present on list/detail responses
  symbol: string
  market: 'crypto' | 'mt5'
  paper: boolean
  decision: string
  reason: string
  time: string
  error?: string
  pnlUsd?: number
}

export interface CycleDetail {
  cycle: CycleResult & { id: number; agentKey: string }
  agent: AgentState | null
  logs: LogEntry[]
}

export interface RiskState {
  dailyPnlUsd: number
  remainingBudgetUsd: number
  positionNotionalUsd: number
}

export interface StatusResponse {
  agents: AgentState[]
  recentEvents: CycleResult[]
  risk: RiskState
}

export interface Indicators {
  rsi14: number
  ema20: number
  ema50: number
  atr14: number
  vwap: number
  bbWidth: number
}

export interface Candle {
  openTime: number
  open: number
  high: number
  low: number
  close: number
  volume: number
  closeTime: number
}

export interface Balance {
  asset: string
  free: number
  locked: number
}

export interface Order {
  orderId: number
  clientOrderId: string
  symbol: string
  side: 'BUY' | 'SELL'
  type: string
  price: number
  origQty: number
  executedQty: number
  status: string
  timeInForce: string
  time: number
  updateTime: number
  // MT5-specific (optional)
  profit?: number
  swap?: number
  sl?: number
  tp?: number
  priceCurrent?: number
}

export interface MarketSnapshot {
  symbol: string
  timestamp: number
  market: 'crypto' | 'mt5'
  price: { bid: number; ask: number; last: number }
  stats24h: { volume: number; changePercent: number; high: number; low: number }
  candles: { m1: Candle[]; m15: Candle[]; h1: Candle[]; h4: Candle[] }
  indicators: Indicators
  account: { balances: Balance[]; openOrders: Order[] }
  risk: RiskState
  forex?: {
    spread: number
    pipValue: number
    sessionOpen: boolean
    swapLong: number
    swapShort: number
  }
}

export type LogLevel = 'info' | 'warn' | 'error' | 'debug'
export type LogEvent =
  // Session-based tick events (current)
  | 'tick_start' | 'tick_end' | 'tick_error' | 'tick_skip'
  | 'session_start' | 'session_reset'
  // Legacy cycle events (backward-compat with old DB rows)
  | 'cycle_start' | 'cycle_end' | 'cycle_error' | 'cycle_skip'
  // Tool events
  | 'tool_call' | 'tool_result' | 'tool_error'
  | 'claude_thinking' | 'decision'
  | 'guardrail_block' | 'session_skip'
  | 'auto_execute' | 'auto_execute_error'
  | 'memory_write' | 'plan_created'
  | 'pnl_record'

export interface LogEntry {
  id: number
  time: string
  agentKey: string
  level: LogLevel
  event: LogEvent
  message: string
  data?: Record<string, unknown>
}

export interface Fill {
  symbol: string
  id: number
  orderId: number
  price: number
  qty: number
  quoteQty: number
  commission: number
  commissionAsset: string
  time: number
  isBuyer: boolean
  isMaker: boolean
}

export interface PositionEntry extends Order {
  agentKey: string
  market: 'crypto' | 'mt5'
  paper: boolean
}

export interface FillEntry extends Fill {
  agentKey: string
  market: 'crypto' | 'mt5'
  paper: boolean
}

export interface KeysResponse {
  [key: string]: boolean
}

export interface ReportSummary {
  crypto: MarketSummary
  mt5: MarketSummary
}

// ── Accounts ─────────────────────────────────────────────────────────────────

export interface BinanceBalance {
  asset: string
  free: number
  locked: number
}

export interface BinanceOpenOrder {
  symbol: string
  side: string
  type: string
  price: number
  origQty: number
  executedQty: number
  status: string
  time: number
}

export interface BinanceAccountEntry {
  id: string
  exchange: 'binance'
  mode: 'LIVE' | 'TESTNET'
  connected: boolean
  error?: string
  balances?: BinanceBalance[]
  openOrders?: BinanceOpenOrder[]
}

export interface Mt5AccountSummary {
  balance: number
  equity: number
  margin: number
  freeMargin: number
  profit: number
  leverage: number
  login: number
  server: string
}

export interface Mt5Position {
  ticket: number
  symbol: string
  side: 'BUY' | 'SELL'
  volume: number
  priceOpen: number
  priceCurrent: number
  profit: number
  swap: number
  sl: number
  tp: number
  time: string
}

export interface Mt5AccountEntry {
  id: string
  exchange: 'mt5'
  mode: 'DEMO' | 'LIVE'
  connected: boolean
  error?: string
  summary?: Mt5AccountSummary
  positions?: Mt5Position[]
}

export type AccountEntry = BinanceAccountEntry | Mt5AccountEntry

export interface Mt5AccountInfo {
  login: number
  name: string
  server: string
  balance: number | null
  equity: number | null
  currency: string
  mode: 'LIVE' | 'DEMO'
}

export interface MarketSummary {
  totalCycles: number
  buys: number
  sells: number
  holds: number
  errors: number
  risk: RiskState
}

export interface StrategyDoc {
  agentKey: string
  name: string
  style: 'scalping' | 'swing' | 'trend' | 'mean_reversion' | 'custom'
  bias?: string
  timeframe?: string
  entryRules: string
  exitRules: string
  filters?: string
  maxPositions: number
  notes?: string
  createdAt: string
  updatedAt: string
}

export interface AgentMemory {
  id: number
  category: string
  key: string
  value: string
  confidence: number
  createdAt: string
  updatedAt: string
  expiresAt?: string
}

export interface AgentPlan {
  id: number
  agentKey: string
  sessionDate: string
  sessionLabel?: string
  marketBias: string
  keyLevels?: string
  riskNotes?: string
  planText: string
  createdAt: string
  cycleCountAt?: number
  active: boolean
}
