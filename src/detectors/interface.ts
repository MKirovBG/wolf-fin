// Wolf-Fin — Detector contract (Phase 2)

import type { Candle, Indicators } from '../adapters/types.js'
import type { FeatureSnapshot, MarketState } from '../types/market.js'
import type { SetupCandidate } from '../types/setup.js'
import type { StrategyDefinition } from '../types/strategy.js'

export interface DetectorInput {
  candles: Candle[]
  allCandles?: { m15?: Candle[]; h1?: Candle[]; h4?: Candle[] }
  indicators: Indicators
  features: FeatureSnapshot
  marketState: MarketState
  price: { bid: number; ask: number; mid: number; spread: number }
  point: number
  digits: number
  strategy?: StrategyDefinition
}

export type DetectorFn = (input: DetectorInput) => SetupCandidate

// ── Geometry helpers ──────────────────────────────────────────────────────────

export function emptyCandidate(
  symbolKey: string,
  detector: string,
  setupType: string,
  reasons: string[] = [],
  disqualifiers: string[] = [],
): SetupCandidate {
  return {
    symbolKey,
    capturedAt: new Date().toISOString(),
    detector,
    found: false,
    setupType,
    direction: null,
    entryZone: null,
    stopLoss: null,
    targets: [],
    riskReward: 0,
    invalidationRule: null,
    score: 0,
    tier: 'rejected',
    scoreBreakdown: zeroBreakdown(),
    reasons,
    disqualifiers,
    tags: [],
  }
}

export function zeroBreakdown(): import('../types/setup.js').ScoreBreakdown {
  return {
    trendAlignment: 0, structureQuality: 0, entryPrecision: 0,
    stopQuality: 0, targetQuality: 0, sessionTiming: 0,
    volatilitySuitability: 0, executionQuality: 0, strategyFit: 0,
    contextPenalty: 0, overextensionPenalty: 0, counterTrendPenalty: 0,
    totalPositive: 0, totalPenalty: 0, finalScore: 0, reasons: [],
  }
}

export function computeRR(entry: number, stop: number, target: number): number {
  const stopDist = Math.abs(entry - stop)
  const targetDist = Math.abs(target - entry)
  return stopDist > 0 ? +(targetDist / stopDist).toFixed(2) : 0
}
