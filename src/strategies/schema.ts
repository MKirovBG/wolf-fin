// Wolf-Fin — Strategy schema and seed definitions (Phase 3)

import type { StrategyDefinition } from '../types/strategy.js'

export const STRATEGY_DEFINITION_VERSION = '1.0'

/** Validate a StrategyDefinition object, returning error strings. Empty = valid. */
export function validateStrategyDefinition(def: unknown): string[] {
  const errors: string[] = []
  if (!def || typeof def !== 'object') return ['Definition must be an object']
  const d = def as Record<string, unknown>

  if (!d.strategyKey || typeof d.strategyKey !== 'string') errors.push('strategyKey is required')
  if (!d.name || typeof d.name !== 'string') errors.push('name is required')
  if (!d.version || typeof d.version !== 'string') errors.push('version is required (semver)')

  if (!d.context || typeof d.context !== 'object') {
    errors.push('context object is required')
  } else {
    const ctx = d.context as Record<string, unknown>
    if (!Array.isArray(ctx.allowedSessions)) errors.push('context.allowedSessions must be array')
    if (!Array.isArray(ctx.allowedRegimes))  errors.push('context.allowedRegimes must be array')
    if (typeof ctx.newsBufferMinutes !== 'number') errors.push('context.newsBufferMinutes must be number')
    if (typeof ctx.maxSpreadPips !== 'number') errors.push('context.maxSpreadPips must be number')
  }

  if (!Array.isArray(d.allowedDetectors) || (d.allowedDetectors as unknown[]).length === 0) {
    errors.push('allowedDetectors must be a non-empty array')
  }

  if (!d.entryRules || typeof d.entryRules !== 'object') {
    errors.push('entryRules object is required')
  } else {
    const e = d.entryRules as Record<string, unknown>
    if (typeof e.maxEntryWidthATR !== 'number') errors.push('entryRules.maxEntryWidthATR must be number')
    if (typeof e.requireConfirmation !== 'boolean') errors.push('entryRules.requireConfirmation must be boolean')
  }

  if (!d.riskRules || typeof d.riskRules !== 'object') {
    errors.push('riskRules object is required')
  } else {
    const r = d.riskRules as Record<string, unknown>
    if (typeof r.minRR !== 'number' || (r.minRR as number) < 1) errors.push('riskRules.minRR must be >= 1')
    if (typeof r.maxStopATR !== 'number') errors.push('riskRules.maxStopATR must be number')
  }

  return errors
}

// ── Built-in structured strategy definitions ──────────────────────────────────

export const BUILTIN_DEFINITIONS: Record<string, StrategyDefinition> = {
  price_action: {
    strategyKey: 'price_action',
    name: 'Price Action',
    description: 'Candlestick patterns, market structure, swing points. Minimal indicator reliance.',
    version: '1.0.0',
    tags: ['discretionary', 'structure'],
    context: { allowedSessions: ['London', 'London-NY', 'NY'], allowedRegimes: ['trend', 'range', 'breakout_watch'], newsBufferMinutes: 10, maxSpreadPips: 5 },
    allowedDetectors: ['trend_pullback', 'breakout_retest', 'liquidity_sweep', 'range_fade'],
    entryRules: { maxEntryWidthATR: 0.8, requireConfirmation: true },
    riskRules: { minRR: 1.5, maxStopATR: 2.0 },
    biasRules: ['Market structure aligned with trade direction', 'Key level confluence'],
  },

  ict: {
    strategyKey: 'ict',
    name: 'ICT / SMC',
    description: 'Order Blocks, Fair Value Gaps, BOS/CHoCH, liquidity pools, OTE entries.',
    version: '1.0.0',
    tags: ['ict', 'smc', 'institutional'],
    context: { allowedSessions: ['London', 'London-NY', 'NY'], allowedRegimes: ['trend', 'breakout_watch', 'reversal_watch'], newsBufferMinutes: 15, maxSpreadPips: 4 },
    allowedDetectors: ['breakout_retest', 'liquidity_sweep', 'trend_pullback'],
    entryRules: { maxEntryWidthATR: 0.6, requireConfirmation: true },
    riskRules: { minRR: 2.0, maxStopATR: 1.5 },
    biasRules: ['HTF bias aligned', 'BOS or CHoCH confirmed', 'Discount/premium zone entry'],
  },

  trend: {
    strategyKey: 'trend',
    name: 'Trend Following',
    description: 'EMA alignment, pullbacks to structure, momentum confluence.',
    version: '1.0.0',
    tags: ['trend', 'momentum'],
    context: { allowedSessions: ['London', 'London-NY', 'NY', 'Tokyo'], allowedRegimes: ['trend'], newsBufferMinutes: 10, maxSpreadPips: 5 },
    allowedDetectors: ['trend_pullback', 'breakout_retest'],
    entryRules: { maxEntryWidthATR: 1.0, requireConfirmation: false },
    riskRules: { minRR: 1.8, maxStopATR: 1.8 },
    biasRules: ['Dominant trend on H1+', 'ADX > 20', 'Pullback within 25–65%'],
  },

  swing: {
    strategyKey: 'swing',
    name: 'Swing Trading',
    description: 'Multi-session holds, major SR flips, 3:1+ R:R targets.',
    version: '1.0.0',
    tags: ['swing', 'multi-session'],
    context: { allowedSessions: ['London', 'London-NY', 'NY'], allowedRegimes: ['trend', 'breakout_watch'], newsBufferMinutes: 30, maxSpreadPips: 6 },
    allowedDetectors: ['trend_pullback', 'breakout_retest', 'liquidity_sweep'],
    entryRules: { maxEntryWidthATR: 1.2, requireConfirmation: true },
    riskRules: { minRR: 2.5, maxStopATR: 2.5 },
    biasRules: ['Major structure level', 'Higher timeframe alignment', 'Minimum 3:1 R:R'],
  },

  scalping: {
    strategyKey: 'scalping',
    name: 'Scalping',
    description: 'Precision micro-structure entries, tight stops, staged targets.',
    version: '1.0.0',
    tags: ['scalping', 'intraday'],
    context: { allowedSessions: ['London', 'London-NY', 'NY'], allowedRegimes: ['trend', 'range', 'breakout_watch'], newsBufferMinutes: 20, maxSpreadPips: 2 },
    allowedDetectors: ['trend_pullback', 'opening_range', 'range_fade'],
    entryRules: { maxEntryWidthATR: 0.4, requireConfirmation: true },
    riskRules: { minRR: 1.5, maxStopATR: 0.8 },
    biasRules: ['Tight spread required', 'Precision level entry', 'Clear invalidation'],
  },

  smc: {
    strategyKey: 'smc',
    name: 'Smart Money',
    description: 'Supply/demand zones, premium/discount pricing, BMS confirmation.',
    version: '1.0.0',
    tags: ['smc', 'smart-money'],
    context: { allowedSessions: ['London', 'London-NY', 'NY'], allowedRegimes: ['trend', 'reversal_watch', 'breakout_watch'], newsBufferMinutes: 15, maxSpreadPips: 4 },
    allowedDetectors: ['liquidity_sweep', 'breakout_retest', 'trend_pullback'],
    entryRules: { maxEntryWidthATR: 0.7, requireConfirmation: true },
    riskRules: { minRR: 2.0, maxStopATR: 1.6 },
    biasRules: ['Supply/demand zone identified', 'Premium/discount pricing', 'BMS or CHoCH confirmed'],
  },
}
