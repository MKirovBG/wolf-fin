// Wolf-Fin — Machine-readable strategy definition (Phase 3)

export interface StrategyContext {
  allowedSessions: string[]      // e.g. ['London', 'London-NY', 'NY']
  allowedRegimes: string[]       // e.g. ['trend', 'breakout']
  newsBufferMinutes: number      // avoid trading within N minutes of high-impact news
  maxSpreadPips: number
}

export interface StrategyEntryRules {
  maxEntryWidthATR: number       // maximum entry zone width in ATR units
  requireConfirmation: boolean   // require a trigger/confirmation candle
}

export interface StrategyRiskRules {
  minRR: number                  // minimum risk:reward ratio (e.g. 1.8)
  maxStopATR: number             // max stop distance in ATR units (e.g. 1.6)
  minStopATR?: number            // min stop distance in ATR units (default 0.3)
}

export interface StrategyDefinition {
  strategyKey: string
  name: string
  description?: string
  version: string                // semver e.g. '1.0.0'
  tags?: string[]
  allowedSymbolFamilies?: string[] // e.g. ['forex_majors', 'metals', 'indices']

  context: StrategyContext
  biasRules?: string[]           // plain-language bias requirements (display only)
  allowedDetectors: string[]     // which detector keys this strategy uses
  entryRules: StrategyEntryRules
  riskRules: StrategyRiskRules
  disqualifiers?: string[]       // plain-language disqualifiers (display only)
  promptNotes?: string           // optional LLM guidance note
}
