// Wolf-Fin — Enhanced Monte Carlo shared types
// All layers produce typed outputs that feed the orchestrator.

import type { Candle } from './types.js'

// ── Per-agent enhancement toggles (stored in AgentConfig) ────────────────────

export interface MCEnhancements {
  markov:     boolean  // Markov chain regime state machine
  agentBased: boolean  // Crowd positioning, stop clusters, liquidity zones
  scenarios:  boolean  // Stress-test under volatility regimes
  bayesian:   boolean  // Strategy confidence from trade history
  kelly:      boolean  // Optimal position sizing via Kelly Criterion
}

export const MC_ENHANCEMENT_DEFAULTS: MCEnhancements = {
  markov:     false,
  agentBased: false,
  scenarios:  false,
  bayesian:   false,
  kelly:      false,
}

export const MC_ENHANCEMENT_LABELS: Record<keyof MCEnhancements, { label: string; description: string }> = {
  markov:     { label: 'Markov Regime',      description: 'Detects market state (trending/ranging/volatile) and adjusts path probabilities accordingly.' },
  agentBased: { label: 'Crowd Positioning',  description: 'Estimates where retail stops are clustered and which direction the crowd is leaning.' },
  scenarios:  { label: 'Scenario Analysis',  description: 'Stress-tests the strategy under high volatility, low volatility, and pre-news conditions.' },
  bayesian:   { label: 'Bayesian Confidence', description: 'Updates strategy confidence after every trade using a statistical learning model.' },
  kelly:      { label: 'Kelly Criterion',     description: 'Computes the mathematically optimal position size given your historical edge.' },
}

// ── Shared primitives ─────────────────────────────────────────────────────────

export interface Candles {
  m1:  Candle[]
  m5:  Candle[]
  m15: Candle[]
  m30: Candle[]
  h1:  Candle[]
  h4:  Candle[]
}

// ── Layer 1: Markov Chain ─────────────────────────────────────────────────────

export type MarkovState = 'TRENDING_UP' | 'TRENDING_DOWN' | 'RANGING' | 'VOLATILE'

export interface MarkovResult {
  currentState:        MarkovState
  nextStateProbs: {
    TRENDING_UP:   number   // 0-1 probability
    TRENDING_DOWN: number
    RANGING:       number
    VOLATILE:      number
  }
  // Bias multiplier for bootstrap MC return distribution: positive = bullish, negative = bearish
  regimeBias:          number
  // How much to widen/narrow the return distribution (>1 = wider = more volatile)
  volatilityScalar:    number
  stateHistory:        MarkovState[]   // last N states for trend confirmation
}

// ── Layer 2: Agent-Based / Crowd Positioning ──────────────────────────────────

export interface StopCluster {
  price:       number
  direction:   'LONG_STOPS' | 'SHORT_STOPS'  // whose stops are here
  strength:    'WEAK' | 'MODERATE' | 'STRONG'
  description: string
}

export interface LiquidityZone {
  priceHigh:   number
  priceLow:    number
  type:        'RESISTANCE' | 'SUPPORT' | 'EQUAL_HIGHS' | 'EQUAL_LOWS'
  description: string
}

export interface AgentBasedResult {
  crowdBias:        number           // -1 (all short) to +1 (all long)
  crowdBiasLabel:   'HEAVILY_LONG' | 'SLIGHTLY_LONG' | 'NEUTRAL' | 'SLIGHTLY_SHORT' | 'HEAVILY_SHORT'
  stopClusters:     StopCluster[]
  liquidityZones:   LiquidityZone[]
  // Contrarian signal: when crowd is extreme, smart money often goes opposite
  contrarianSignal: 'FADE_LONGS' | 'FADE_SHORTS' | 'NO_SIGNAL'
  // Bias applied to MC paths: positive = bullish (e.g. fade shorts), negative = bearish
  pathBias:         number
  sentimentSource:  string           // e.g. "Fear & Greed + price action" or "Price action only"
}

// ── Layer 3: Scenario Analysis ────────────────────────────────────────────────

export type VolatilityRegime = 'LOW_VOL' | 'NORMAL' | 'HIGH_VOL' | 'EXTREME_VOL'
export type ScenarioLabel    = 'Normal' | 'High Volatility' | 'Low Volatility' | 'Pre-News' | 'Session Boundary'

export interface ScenarioResult {
  label:      ScenarioLabel
  regime:     VolatilityRegime
  atrMultiplier:   number      // how much ATR was scaled for this run
  longWinRate:     number
  shortWinRate:    number
  longEv:          number
  shortEv:         number
  recommended:     'LONG' | 'SHORT' | 'HOLD'
}

export interface ScenariosResult {
  currentRegime:  VolatilityRegime
  scenarios:      ScenarioResult[]
  // "Do not trade" when ALL scenarios flag HOLD or negative EV
  avoidTrading:   boolean
  avoidReason:    string | null
  // Worst-case scenario result (stress test)
  worstCase:      ScenarioResult
}

// ── Layer 4: Bayesian Confidence ──────────────────────────────────────────────

export interface BayesianResult {
  // Beta distribution parameters (alpha = wins + prior, beta = losses + prior)
  alpha:                number
  beta:                 number
  // Posterior statistics
  posteriorMean:        number   // best estimate of true win rate
  credibleIntervalLow:  number   // 95% credible interval lower bound
  credibleIntervalHigh: number   // 95% credible interval upper bound
  // Confidence assessment
  confidence:           'LOW' | 'MEDIUM' | 'HIGH' | 'VERY_HIGH'
  confidenceReason:     string
  // Regime shift detection
  regimeShiftDetected:  boolean
  regimeShiftReason:    string | null
  // Sample info
  totalTrades:          number
  recentTrades:         number   // trades used (with recency weighting)
  priorStrength:        number   // how much the prior dominates vs data
}

// ── Layer 5: Significance Testing ─────────────────────────────────────────────

export interface SignificanceResult {
  // Wilson confidence interval on observed win rate
  observedWinRate:      number
  wilsonLow:            number
  wilsonHigh:           number
  // Binomial p-value: probability that this win rate occurred by chance (null hypothesis = 50%)
  pValue:               number
  // Edge assessment
  edgeConfirmed:        boolean   // p < 0.05
  edgeLabel:            'CONFIRMED' | 'LIKELY' | 'UNCONFIRMED' | 'INSUFFICIENT_DATA'
  // Trades needed for 95% confidence given current win rate
  tradesNeeded:         number
  // Current sample size
  sampleSize:           number
}

// ── Layer 6: Kelly Criterion ──────────────────────────────────────────────────

export interface KellyResult {
  // Full Kelly fraction (theoretical optimum — usually too aggressive)
  fullKellyPct:         number
  // Fractional Kelly (0.25× = conservative, 0.5× = moderate)
  quarterKellyPct:      number
  halfKellyPct:         number
  // Recommendation (based on significance + Bayesian confidence)
  recommendedKellyPct:  number
  recommendedFraction:  '1/4 Kelly' | '1/2 Kelly' | 'Full Kelly' | 'No Trade'
  // vs agent's configured maxRiskPercent
  configuredRiskPct:    number | null
  riskAssessment:       'UNDER_BETTING' | 'OPTIMAL' | 'OVER_BETTING' | 'NO_EDGE'
  riskAssessmentReason: string
}

// ── Orchestrator output ───────────────────────────────────────────────────────

export interface EnhancedMCResult {
  // Core MC result (always present)
  core: import('./montecarlo.js').MCResult

  // Enhanced layers (present only if enabled and data available)
  markov?:       MarkovResult
  agentBased?:   AgentBasedResult
  scenarios?:    ScenariosResult
  bayesian?:     BayesianResult
  significance?: SignificanceResult
  kelly?:        KellyResult

  // Which enhancements were enabled and ran successfully
  enabledLayers: (keyof MCEnhancements)[]
  // Which layers failed (non-fatal — core always runs)
  failedLayers:  { layer: string; reason: string }[]

  // Overall signal summary across all layers
  consensus: {
    signal:     'STRONG_LONG' | 'LEAN_LONG' | 'NEUTRAL' | 'LEAN_SHORT' | 'STRONG_SHORT' | 'AVOID'
    confidence: 'LOW' | 'MEDIUM' | 'HIGH' | 'VERY_HIGH'
    summary:    string   // plain-English one-liner for the LLM
  }

  generatedAt: number
}

// ── Trade record (from DB) needed by Bayesian + Significance ─────────────────

export interface TradeRecord {
  wonTrade:  boolean
  pnlUsd:    number
  closedAt:  string   // ISO timestamp for recency weighting
}
