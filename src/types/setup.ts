// Wolf-Fin — Setup candidate and scoring types (Phase 2)

export interface SetupCandidate {
  id?: number
  analysisId?: number
  symbolKey: string
  capturedAt: string

  detector: string               // 'trend_pullback' | 'breakout_retest' | ...
  found: boolean
  setupType: string              // human-readable label
  direction: 'BUY' | 'SELL' | null

  entryZone: { low: number; high: number } | null
  stopLoss: number | null
  targets: number[]
  riskReward: number             // TP1 / stop distance (0 if uncomputable)
  invalidationRule: string | null

  score: number                  // 0–100 composite from scoring engine
  tier: 'valid' | 'watchlist' | 'low_quality' | 'rejected'
  scoreBreakdown: ScoreBreakdown

  reasons: string[]              // why the setup qualifies
  disqualifiers: string[]        // hard disqualifiers triggered
  tags: string[]                 // ['uptrend', 'London', 'XAUUSD', ...]
}

export interface ScoreBreakdown {
  trendAlignment: number         // 0–15
  structureQuality: number       // 0–15
  entryPrecision: number         // 0–10
  stopQuality: number            // 0–10
  targetQuality: number          // 0–10
  sessionTiming: number          // 0–10
  volatilitySuitability: number  // 0–10
  executionQuality: number       // 0–10
  strategyFit: number            // 0–10
  contextPenalty: number         // ≤ 0
  overextensionPenalty: number   // ≤ 0
  counterTrendPenalty: number    // ≤ 0
  totalPositive: number
  totalPenalty: number
  finalScore: number
  reasons: string[]
}
