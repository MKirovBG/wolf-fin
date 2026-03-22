// Wolf-Fin — Monte Carlo Layers 4, 5 & 6: Bayesian Confidence, Significance & Kelly
//
// Layer 4 — Bayesian Confidence
//   Uses a Beta-Binomial model to estimate the true win rate of the strategy.
//   Applies recency weighting (recent trades matter more) and detects regime
//   shifts (sudden win-rate change from recent trades vs older history).
//
// Layer 5 — Statistical Significance
//   Wilson confidence interval on the observed win rate + binomial p-value
//   against the null hypothesis that the edge is purely random (p = 0.5).
//
// Layer 6 — Kelly Criterion
//   Computes Full, Half, and Quarter Kelly fractions from the posterior win
//   rate and observed average win/loss ratio, then recommends a fraction based
//   on significance and Bayesian confidence.

import type { TradeRecord, BayesianResult, SignificanceResult, KellyResult } from './mc-types.js'

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Regularised incomplete beta function approximation (for Wilson CI) */
function normalCDF(z: number): number {
  // Abramowitz & Stegun approximation (error < 7.5e-8)
  const t = 1 / (1 + 0.2316419 * Math.abs(z))
  const d = 0.3989422820 * Math.exp(-z * z / 2)
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.7814779 + t * (-1.8212560 + t * 1.3302744))))
  return z > 0 ? 1 - p : p
}

/** Incomplete beta function (approximation via continued fraction) for Beta CDF */
function betaCDF(x: number, a: number, b: number): number {
  // Simple numerical integration for small a, b values we encounter
  // (< 1000 iterations)
  if (x <= 0) return 0
  if (x >= 1) return 1
  const steps = 1000
  const dx = x / steps
  let sum = 0
  for (let i = 0; i < steps; i++) {
    const xi = (i + 0.5) * dx
    sum += Math.pow(xi, a - 1) * Math.pow(1 - xi, b - 1) * dx
  }
  // Normalise by beta function B(a,b) via log-gamma approximation
  const logBeta = lgamma(a) + lgamma(b) - lgamma(a + b)
  return Math.min(1, Math.max(0, sum / Math.exp(logBeta)))
}

function lgamma(x: number): number {
  // Stirling series (adequate for x > 0)
  return (x - 0.5) * Math.log(x + 4.5) - (x + 4.5) + 0.5 * Math.log(2 * Math.PI) +
    Math.log(1 + 76.18009173 / x - 86.50532033 / (x + 1) + 24.01409822 / (x + 2) -
      1.231739516 / (x + 3) + 0.00120858 / (x + 4) - 0.00000536382 / (x + 5))
}

/** Wilson confidence interval for a proportion */
function wilsonCI(wins: number, n: number, z = 1.96): { low: number; high: number } {
  if (n === 0) return { low: 0, high: 1 }
  const p = wins / n
  const denom = 1 + z * z / n
  const centre = (p + z * z / (2 * n)) / denom
  const margin = (z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))) / denom
  return {
    low:  Math.max(0, centre - margin),
    high: Math.min(1, centre + margin),
  }
}

/** Binomial p-value: probability of seeing ≥wins wins in n trials under H₀: p=0.5 */
function binomialPValue(wins: number, n: number): number {
  // Use normal approximation for n > 30, exact for small n
  if (n === 0) return 1
  if (n > 30) {
    const z = (wins - n * 0.5) / Math.sqrt(n * 0.25)
    return 2 * Math.min(normalCDF(z), 1 - normalCDF(z))
  }
  // Exact: sum P(X >= wins) or P(X <= wins) whichever is smaller
  let pRight = 0
  for (let k = wins; k <= n; k++) {
    pRight += binomProb(n, k, 0.5)
  }
  let pLeft = 0
  for (let k = 0; k <= wins; k++) {
    pLeft += binomProb(n, k, 0.5)
  }
  return Math.min(1, 2 * Math.min(pRight, pLeft))
}

function binomProb(n: number, k: number, p: number): number {
  return binomCoeff(n, k) * Math.pow(p, k) * Math.pow(1 - p, n - k)
}

function binomCoeff(n: number, k: number): number {
  if (k > n) return 0
  if (k === 0 || k === n) return 1
  let c = 1
  for (let i = 0; i < k; i++) {
    c = c * (n - i) / (i + 1)
  }
  return c
}

/** Decay weight for recency (exponential) — more recent = higher weight */
function recencyWeight(tradeIndex: number, totalTrades: number, halfLifeTrades = 20): number {
  const age = totalTrades - 1 - tradeIndex   // 0 = most recent
  return Math.exp(-Math.log(2) * age / halfLifeTrades)
}

// ── Layer 4: Bayesian Confidence ──────────────────────────────────────────────

export function runBayesian(trades: TradeRecord[]): BayesianResult {
  if (trades.length === 0) {
    return {
      alpha: 2, beta: 2,
      posteriorMean: 0.5,
      credibleIntervalLow:  0.1,
      credibleIntervalHigh: 0.9,
      confidence: 'LOW',
      confidenceReason: 'No trade history available — using uniform prior.',
      regimeShiftDetected: false,
      regimeShiftReason: null,
      totalTrades: 0,
      recentTrades: 0,
      priorStrength: 1,
    }
  }

  // Sort by time ascending
  const sorted = [...trades].sort(
    (a, b) => new Date(a.closedAt).getTime() - new Date(b.closedAt).getTime()
  )

  const n = sorted.length

  // Recency-weighted effective wins/losses
  let effectiveWins   = 0
  let effectiveLosses = 0
  for (let i = 0; i < n; i++) {
    const w = recencyWeight(i, n)
    if (sorted[i].wonTrade) effectiveWins   += w
    else                    effectiveLosses += w
  }

  // Prior: Beta(2, 2) — slightly informative, centred at 0.5
  const PRIOR_ALPHA = 2
  const PRIOR_BETA  = 2
  const alpha = PRIOR_ALPHA + effectiveWins
  const beta  = PRIOR_BETA  + effectiveLosses

  const posteriorMean = alpha / (alpha + beta)

  // 95% credible interval using Beta distribution approximation
  // (normal approximation to Beta for sufficient sample)
  const posteriorVar = (alpha * beta) / ((alpha + beta) ** 2 * (alpha + beta + 1))
  const posteriorStd = Math.sqrt(posteriorVar)
  const credibleIntervalLow  = Math.max(0, posteriorMean - 1.96 * posteriorStd)
  const credibleIntervalHigh = Math.min(1, posteriorMean + 1.96 * posteriorStd)

  // Confidence based on effective sample size
  const ess = effectiveWins + effectiveLosses   // effective sample size
  const confidence = (() => {
    if (ess < 10)  return 'LOW'       as const
    if (ess < 30)  return 'MEDIUM'    as const
    if (ess < 60)  return 'HIGH'      as const
    return              'VERY_HIGH'   as const
  })()

  const confidenceReason = (() => {
    const pctStr = (posteriorMean * 100).toFixed(1)
    const ciStr  = `[${(credibleIntervalLow * 100).toFixed(0)}%–${(credibleIntervalHigh * 100).toFixed(0)}%]`
    return `${n} trades (recency-weighted ESS ${ess.toFixed(1)}). Posterior win rate ${pctStr}% CI ${ciStr}.`
  })()

  // Regime shift detection: compare last 20 trades vs the rest
  let regimeShiftDetected = false
  let regimeShiftReason: string | null = null
  if (n >= 20) {
    const recent  = sorted.slice(-20)
    const older   = sorted.slice(0, -20)
    const recentWR  = recent.filter(t => t.wonTrade).length / recent.length
    const olderWR   = older.filter(t => t.wonTrade).length  / older.length
    const shift     = Math.abs(recentWR - olderWR)
    if (shift > 0.2) {
      regimeShiftDetected = true
      regimeShiftReason   = `Recent 20-trade win rate (${(recentWR * 100).toFixed(0)}%) differs significantly from historical (${(olderWR * 100).toFixed(0)}%) — possible strategy regime shift.`
    }
  }

  const priorStrength = (PRIOR_ALPHA + PRIOR_BETA) / (PRIOR_ALPHA + PRIOR_BETA + ess)

  return {
    alpha: parseFloat(alpha.toFixed(2)),
    beta:  parseFloat(beta.toFixed(2)),
    posteriorMean:        parseFloat(posteriorMean.toFixed(4)),
    credibleIntervalLow:  parseFloat(credibleIntervalLow.toFixed(4)),
    credibleIntervalHigh: parseFloat(credibleIntervalHigh.toFixed(4)),
    confidence,
    confidenceReason,
    regimeShiftDetected,
    regimeShiftReason,
    totalTrades:  n,
    recentTrades: parseFloat(ess.toFixed(1)),
    priorStrength: parseFloat(priorStrength.toFixed(3)),
  }
}

// ── Layer 5: Significance Testing ─────────────────────────────────────────────

export function runSignificance(trades: TradeRecord[]): SignificanceResult {
  const n    = trades.length
  const wins = trades.filter(t => t.wonTrade).length

  if (n === 0) {
    return {
      observedWinRate: 0, wilsonLow: 0, wilsonHigh: 1,
      pValue: 1, edgeConfirmed: false, edgeLabel: 'INSUFFICIENT_DATA',
      tradesNeeded: 30, sampleSize: 0,
    }
  }

  const observedWinRate = wins / n
  const { low: wilsonLow, high: wilsonHigh } = wilsonCI(wins, n)
  const pValue   = binomialPValue(wins, n)
  const edgeConfirmed = pValue < 0.05

  const edgeLabel = (() => {
    if (n < 20)          return 'INSUFFICIENT_DATA' as const
    if (pValue < 0.01)   return 'CONFIRMED'         as const
    if (pValue < 0.05)   return 'CONFIRMED'         as const
    if (pValue < 0.15)   return 'LIKELY'            as const
    return                      'UNCONFIRMED'        as const
  })()

  // Trades needed for 95% confidence (two-sided binomial) at current win rate
  // Using approximation: n = (z/δ)² × p(1-p), δ = |p - 0.5|
  const p = observedWinRate
  const delta = Math.abs(p - 0.5) || 0.05
  const tradesNeeded = Math.ceil((1.96 / delta) ** 2 * p * (1 - p))

  return {
    observedWinRate: parseFloat(observedWinRate.toFixed(4)),
    wilsonLow:       parseFloat(wilsonLow.toFixed(4)),
    wilsonHigh:      parseFloat(wilsonHigh.toFixed(4)),
    pValue:          parseFloat(pValue.toFixed(4)),
    edgeConfirmed,
    edgeLabel,
    tradesNeeded:    Math.max(0, tradesNeeded - n),
    sampleSize:      n,
  }
}

// ── Layer 6: Kelly Criterion ───────────────────────────────────────────────────

export interface KellyInput {
  trades:            TradeRecord[]
  bayesian:          BayesianResult
  significance:      SignificanceResult
  configuredRiskPct: number | null   // from agent's maxRiskPercent
}

export function runKelly(input: KellyInput): KellyResult {
  const { trades, bayesian, significance, configuredRiskPct } = input

  // Compute average win and average loss from trade history
  const winners = trades.filter(t => t.wonTrade  && t.pnlUsd > 0)
  const losers  = trades.filter(t => !t.wonTrade && t.pnlUsd < 0)

  const avgWin  = winners.length > 0 ? winners.reduce((s, t) => s + t.pnlUsd, 0) / winners.length : 1
  const avgLoss = losers.length  > 0 ? Math.abs(losers.reduce((s, t) => s + t.pnlUsd, 0) / losers.length) : 1
  const b       = avgWin / avgLoss   // win/loss ratio

  // Use posterior win rate for Kelly (more stable than raw observed)
  const p = bayesian.posteriorMean
  const q = 1 - p

  // Kelly formula: f* = (p × b - q) / b
  const fullKelly = Math.max(0, (p * b - q) / b)

  const fullKellyPct    = parseFloat((fullKelly   * 100).toFixed(2))
  const halfKellyPct    = parseFloat((fullKelly   * 50).toFixed(2))
  const quarterKellyPct = parseFloat((fullKelly   * 25).toFixed(2))

  // Recommendation based on significance + Bayesian confidence
  const recommendedFraction: KellyResult['recommendedFraction'] = (() => {
    if (significance.edgeLabel === 'INSUFFICIENT_DATA') return 'No Trade'
    if (significance.edgeLabel === 'UNCONFIRMED')       return 'No Trade'
    if (bayesian.confidence === 'LOW')                  return '1/4 Kelly'
    if (bayesian.confidence === 'MEDIUM')               return '1/4 Kelly'
    if (bayesian.confidence === 'HIGH')                 return '1/2 Kelly'
    return '1/2 Kelly'   // VERY_HIGH — still conservative
  })()

  const recommendedKellyPct = (() => {
    if (recommendedFraction === '1/4 Kelly') return quarterKellyPct
    if (recommendedFraction === '1/2 Kelly') return halfKellyPct
    return 0   // 'No Trade'
  })()

  // Compare against configured risk
  const riskAssessment = (() => {
    if (recommendedFraction === 'No Trade')   return 'NO_EDGE'      as const
    if (configuredRiskPct === null)            return 'OPTIMAL'      as const
    if (configuredRiskPct < recommendedKellyPct * 0.6) return 'UNDER_BETTING' as const
    if (configuredRiskPct > recommendedKellyPct * 1.5) return 'OVER_BETTING'  as const
    return                                            'OPTIMAL'      as const
  })()

  const riskAssessmentReason = (() => {
    switch (riskAssessment) {
      case 'NO_EDGE':
        return `Insufficient statistical evidence of edge (${significance.edgeLabel}). Recommend paper-trading until more data available.`
      case 'UNDER_BETTING':
        return `Configured risk ${configuredRiskPct}% is below the Kelly-optimal ${recommendedKellyPct.toFixed(1)}% — leaving potential profit on the table.`
      case 'OVER_BETTING':
        return `Configured risk ${configuredRiskPct}% exceeds Kelly-optimal ${recommendedKellyPct.toFixed(1)}% — risk of drawdown amplified.`
      default:
        return `Configured risk ${configuredRiskPct ?? '(default)'}% is within optimal Kelly range (${recommendedKellyPct.toFixed(1)}%).`
    }
  })()

  return {
    fullKellyPct,
    halfKellyPct,
    quarterKellyPct,
    recommendedKellyPct,
    recommendedFraction,
    configuredRiskPct,
    riskAssessment,
    riskAssessmentReason,
  }
}
