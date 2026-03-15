export interface CycleResult {
  symbol: string
  market: 'crypto' | 'forex'
  paper: boolean
  decision: string
  reason: string
  time: string
  error?: string
}

export interface AgentConfig {
  symbol: string
  market: 'crypto' | 'forex'
  paper?: boolean
  maxIterations?: number
}

export interface RiskState {
  dailyPnlUsd: number
  remainingBudgetUsd: number
  positionNotionalUsd: number
}

export interface StatusResponse {
  status: 'idle' | 'running' | 'paused'
  paused: boolean
  paperMode: boolean
  configs: AgentConfig[]
  lastCycleByKey: Record<string, CycleResult>
  recentEvents: CycleResult[]
  startedAt: string | null
  risk: RiskState
  maxDailyLossUsd: number
}

export interface KeysResponse {
  ANTHROPIC_API_KEY: boolean
  CLAUDE_MODEL: boolean
  OANDA_API_KEY: boolean
  OANDA_ACCOUNT_ID: boolean
  BINANCE_API_KEY: boolean
  BINANCE_API_SECRET: boolean
  FINNHUB_KEY: boolean
  TWELVE_DATA_KEY: boolean
  COINGECKO_KEY: boolean
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
