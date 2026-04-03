// Wolf-Fin — Detector registry and runner (Phase 2)

import { detectTrendPullback }   from './trendPullback.js'
import { detectBreakoutRetest }  from './breakoutRetest.js'
import { detectLiquiditySweep }  from './liquiditySweep.js'
import { detectOpeningRange }    from './openingRange.js'
import { detectRangeFade }       from './rangeFade.js'
import { detectSessionReversal } from './sessionReversal.js'
import type { DetectorInput, DetectorFn } from './interface.js'
import type { SetupCandidate } from '../types/setup.js'

export const DETECTORS: Record<string, DetectorFn> = {
  trend_pullback:    detectTrendPullback,
  breakout_retest:   detectBreakoutRetest,
  liquidity_sweep:   detectLiquiditySweep,
  opening_range:     detectOpeningRange,
  range_fade:        detectRangeFade,
  session_reversal:  detectSessionReversal,
}

export const ALL_DETECTOR_KEYS = Object.keys(DETECTORS)

/**
 * Run all detectors (or a subset) against the current market state.
 * Returns all candidates — both found and not found — so the UI can show
 * why setups were rejected.
 */
export function runDetectors(
  input: DetectorInput,
  allowedDetectors?: string[],
): SetupCandidate[] {
  const keys = allowedDetectors?.length
    ? allowedDetectors.filter(k => k in DETECTORS)
    : ALL_DETECTOR_KEYS

  return keys.map(key => {
    try {
      return DETECTORS[key](input)
    } catch (err) {
      // Detector errors are non-fatal — return empty candidate
      return {
        symbolKey:  input.features.symbolKey,
        capturedAt: new Date().toISOString(),
        detector:   key,
        found:      false,
        setupType:  key,
        direction:  null,
        entryZone:  null,
        stopLoss:   null,
        targets:    [],
        riskReward: 0,
        invalidationRule: null,
        score:      0,
        tier:       'rejected' as const,
        scoreBreakdown: {
          trendAlignment: 0, structureQuality: 0, entryPrecision: 0,
          stopQuality: 0, targetQuality: 0, sessionTiming: 0,
          volatilitySuitability: 0, executionQuality: 0, strategyFit: 0,
          contextPenalty: 0, overextensionPenalty: 0, counterTrendPenalty: 0,
          totalPositive: 0, totalPenalty: 0, finalScore: 0,
          reasons: [`Detector error: ${String(err)}`],
        },
        reasons:      [],
        disqualifiers: [`Detector error: ${String(err)}`],
        tags:         [],
      }
    }
  })
}
