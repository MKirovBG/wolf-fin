// Wolf-Fin — Market domain types: feature snapshots, market state, setup candidates

// ── Feature sub-types ─────────────────────────────────────────────────────────

export interface TrendFeatures {
  emaFastSlope: number             // % change per bar over last 5 bars
  emaSlowSlope: number
  priceVsEmaFast: number           // % price is above(+) or below(-) fast EMA
  priceVsEmaSlow: number
  emaAlignment: 'bullish' | 'bearish' | 'neutral'   // fast vs slow relative position
  rsiValue: number
  rsiZone: 'oversold' | 'neutral' | 'overbought'
  adxValue: number
  adxStrength: 'weak' | 'moderate' | 'strong'       // <20, 20–40, >40
  directionBias: 'bullish' | 'bearish' | 'neutral'
  directionStrength: number        // 0–100 confluence score
  macdBias: 'bullish' | 'bearish' | 'neutral' | undefined
  psarBias: 'bullish' | 'bearish' | undefined
  mtfScore: number | undefined     // -3 to +3
  mtfAlignment: 'aligned_bullish' | 'aligned_bearish' | 'divergent' | 'neutral'
}

export interface VolatilityFeatures {
  atrAbsolute: number
  atrPips: number                  // ATR expressed in pips (atr / point)
  bbWidthPct: number               // Bollinger band width as % of mid price
  recentRangeExpansion: boolean    // last 5 bar avg range > prior 5 bar avg range
  volatilityRegime: 'quiet' | 'normal' | 'elevated' | 'abnormal'
  volatilityPercentile: number     // 0–100, ATR rank vs last 50 bars
  keltnerPosition: 'inside' | 'above' | 'below' | undefined
}

export interface StructureFeatures {
  recentSwingHigh: number
  recentSwingLow: number
  swingHighAge: number             // bars ago
  swingLowAge: number
  bos: 'bullish' | 'bearish' | null   // break of structure
  choch: 'bullish' | 'bearish' | null // change of character
  trendDirection: 'uptrend' | 'downtrend' | 'ranging'
  pullbackDepthPct: number         // 0–100%, depth of current pullback vs last impulse
  overextensionATR: number         // ATR multiples price has moved from recent swing
}

export interface LevelFeatures {
  vwapDistance: number             // % above(+) / below(-) VWAP; 0 if no VWAP
  vwapSide: 'above' | 'below' | undefined
  nearestSupportDist: number       // % from price to nearest support level
  nearestResistDist: number        // % from price to nearest resistance level
  roundNumberProximity: number     // % to nearest round number
  nearestFibLabel: string | undefined  // e.g. '61.8%' if within 0.3%
}

export interface SessionFeatures {
  activeSessions: string[]
  isLondonNYOverlap: boolean
  isOptimalSession: boolean
  sessionQuality: 'poor' | 'acceptable' | 'favorable' | 'optimal'
  sessionNote: string
}

export interface ExecutionFeatures {
  spreadPips: number
  spreadStatus: 'normal' | 'wide' | 'abnormal'
}

export interface ContextFeatures {
  newsRisk: 'none' | 'low' | 'elevated'
  newsCount: number
  calendarRisk: 'none' | 'low' | 'medium' | 'high'
  nextHighImpactMinutes: number | null
  dominantSentiment: 'bullish' | 'bearish' | 'neutral' | 'none'
}

export interface FeatureSnapshot {
  analysisId?: number
  symbolKey: string
  capturedAt: string

  trend: TrendFeatures
  volatility: VolatilityFeatures
  structure: StructureFeatures
  levels: LevelFeatures
  session: SessionFeatures
  execution: ExecutionFeatures
  context: ContextFeatures
}

// ── Market State ──────────────────────────────────────────────────────────────

export type MarketRegime =
  | 'trend'
  | 'range'
  | 'breakout_watch'
  | 'reversal_watch'
  | 'volatile'
  | 'compressed'

export interface MarketState {
  analysisId?: number
  symbolKey: string
  capturedAt: string

  regime: MarketRegime
  direction: 'bullish' | 'bearish' | 'neutral'
  directionStrength: number    // 0–100
  volatility: 'quiet' | 'normal' | 'elevated' | 'abnormal'
  sessionQuality: 'poor' | 'acceptable' | 'favorable' | 'optimal'
  contextRisk: 'low' | 'moderate' | 'elevated' | 'avoid'

  regimeReasons: string[]
  directionReasons: string[]
  volatilityReasons: string[]
  sessionReasons: string[]
  riskReasons: string[]
}
