// Wolf-Fin — Research, backtest, alert types (Phases 4–5)

// ── Backtest ──────────────────────────────────────────────────────────────────

export interface BacktestConfig {
  symbolKey: string
  symbol: string
  timeframe: string
  strategyKey?: string
  detectors?: string[]           // if empty, run all
  fromDate: string               // ISO date string
  toDate: string
  slippagePips?: number          // default 0
  spreadPips?: number            // override symbol spread; 0 = use live spread
  minScore?: number              // only consider setups with score >= this (default 65)
}

export interface BacktestRun {
  id?: number
  symbolKey: string
  config: BacktestConfig
  status: 'running' | 'complete' | 'failed'
  startedAt: string
  completedAt?: string
  error?: string
  metrics?: BacktestMetrics
}

export interface BacktestMetrics {
  totalBars: number
  tradesTotal: number
  tradesWon: number
  tradesLost: number
  tradesExpired: number
  winRate: number               // 0–100 %
  avgRR: number                 // average realized R:R
  avgWinR: number
  avgLossR: number
  expectancy: number            // (winRate * avgWin) - (lossRate * avgLoss)
  maxConsecLosses: number
  profitFactor: number          // gross wins / gross losses
  bySetupType: Record<string, { trades: number; wins: number; winRate: number }>
  bySession: Record<string, { trades: number; wins: number; winRate: number }>
}

export interface BacktestTrade {
  id?: number
  runId: number
  symbolKey: string
  detector: string
  direction: 'BUY' | 'SELL'
  entryBar: number              // bar index
  entryTime: string
  entryPrice: number
  stopLoss: number
  targets: number[]
  score: number
  setupType: string
  tags: string[]
  // Fill simulation
  outcome: 'won_tp1' | 'won_tp2' | 'lost_sl' | 'expired' | 'not_filled'
  exitPrice: number | null
  exitTime: string | null
  barsHeld: number | null
  rMultiple: number | null      // realized R:R (negative for loss)
  mae: number | null            // maximum adverse excursion in R
  mfe: number | null            // maximum favorable excursion in R
}

// ── Alerts ────────────────────────────────────────────────────────────────────

export type AlertConditionType =
  | 'setup_score_gte'      // a setup score >= threshold
  | 'regime_change'        // market state regime changes to X
  | 'direction_change'     // bias flips
  | 'context_risk_gte'     // context risk becomes elevated/avoid

export interface AlertRule {
  id?: number
  symbolKey: string
  name: string
  conditionType: AlertConditionType
  conditionValue: string         // threshold value or target state
  enabled: boolean
  createdAt: string
}

export interface AlertFiring {
  id?: number
  ruleId: number
  symbolKey: string
  analysisId?: number
  firedAt: string
  message: string
  acknowledged: boolean
}
