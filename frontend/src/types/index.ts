export type AgentStatus = 'idle' | 'running' | 'paused'

export interface AgentConfig {
  symbol: string
  market: 'crypto' | 'forex'
  paper: boolean
  maxIterations: number
  fetchMode: 'manual' | 'scheduled' | 'autonomous'
  scheduleIntervalMinutes: number
  maxLossUsd: number
  maxPositionUsd: number
  customPrompt?: string
}

export interface AgentState {
  config: AgentConfig
  status: AgentStatus
  lastCycle: CycleResult | null
  startedAt: string | null
  cycleCount: number
}

export interface CycleResult {
  symbol: string
  market: 'crypto' | 'forex'
  paper: boolean
  decision: string
  reason: string
  time: string
  error?: string
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
  maxDailyLossUsd: number
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
}

export interface MarketSnapshot {
  symbol: string
  timestamp: number
  market: 'crypto' | 'forex'
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
  | 'cycle_start' | 'cycle_end' | 'cycle_error'
  | 'tool_call' | 'tool_result' | 'tool_error'
  | 'claude_thinking' | 'decision'
  | 'guardrail_block' | 'session_skip'

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
  market: 'crypto' | 'forex'
  paper: boolean
}

export interface FillEntry extends Fill {
  agentKey: string
  market: 'crypto' | 'forex'
  paper: boolean
}

export interface KeysResponse {
  [key: string]: boolean
}

export interface ReportSummary {
  crypto: MarketSummary
  forex: MarketSummary
}

export interface MarketSummary {
  totalCycles: number
  buys: number
  sells: number
  holds: number
  errors: number
  risk: RiskState
}
