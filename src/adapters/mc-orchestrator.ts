// Wolf-Fin — Enhanced Monte Carlo Orchestrator
//
// Wraps the core MC simulation and optionally enriches it with up to 5
// additional analytical layers.  All layers are non-fatal — if a layer
// throws, the orchestrator catches and reports it in `failedLayers`.
//
// The result is a single `EnhancedMCResult` that:
//   1. Always contains the core MCResult
//   2. Contains whichever optional layers ran successfully
//   3. Derives a consensus signal from all active layers
//   4. Exposes a rich formatted text block for injection into the LLM context

import type { Candle } from './types.js'
import { runMonteCarlo, formatMCBlock }  from './montecarlo.js'
import type { MCResult, MCInputs }        from './montecarlo.js'
import type {
  MCEnhancements,
  EnhancedMCResult,
  MarkovResult,
  AgentBasedResult,
  ScenariosResult,
  BayesianResult,
  SignificanceResult,
  KellyResult,
  TradeRecord,
} from './mc-types.js'
import { runMarkov }                      from './mc-markov.js'
import { runAgentBased }                  from './mc-agentbased.js'
import type { AgentBasedInput }           from './mc-agentbased.js'
import { runScenarios }                   from './mc-scenarios.js'
import { runBayesian, runSignificance, runKelly } from './mc-bayesian.js'

// ── Input ─────────────────────────────────────────────────────────────────────

export interface EnhancedMCInputs extends MCInputs {
  m5:   Candle[]
  m15:  Candle[]
  m30:  Candle[]

  enhancements:    MCEnhancements
  tradeRecords:    TradeRecord[]        // from DB — for Bayesian / Kelly
  configuredRisk:  number | null        // agent.maxRiskPercent
  fearGreedValue?: number               // from context, if available
}

// ── Consensus builder ─────────────────────────────────────────────────────────

function buildConsensus(
  core:      MCResult,
  markov?:   MarkovResult,
  agent?:    AgentBasedResult,
  scenarios?: ScenariosResult,
  bayesian?: BayesianResult,
  kelly?:    KellyResult,
): EnhancedMCResult['consensus'] {
  // Accumulate a numeric signal score (-3..+3) and a confidence vote count
  let score      = 0   // positive = bullish, negative = bearish
  let votes      = 0
  const reasons: string[] = []

  // Core MC (always)
  if (core.recommended === 'LONG')  { score += 1; votes++ }
  if (core.recommended === 'SHORT') { score -= 1; votes++ }
  if (core.recommended !== 'HOLD')  reasons.push(`MC→${core.recommended}`)

  // Markov
  if (markov) {
    const b = markov.regimeBias
    if (Math.abs(b) > 0.1) {
      score += b > 0 ? 1 : -1
      votes++
      reasons.push(`Markov(${markov.currentState})`)
    }
  }

  // Crowd (contrarian)
  if (agent) {
    if (agent.contrarianSignal === 'FADE_LONGS')  { score -= 1; votes++; reasons.push('Fade crowd longs') }
    if (agent.contrarianSignal === 'FADE_SHORTS') { score += 1; votes++; reasons.push('Fade crowd shorts') }
  }

  // Scenario: if worst case is HOLD or avoidTrading, penalise
  if (scenarios) {
    if (scenarios.avoidTrading) { score -= 1; votes++; reasons.push('All scenarios→HOLD') }
    else if (scenarios.worstCase.recommended === core.recommended) {
      score += 0.5 * (core.recommended === 'LONG' ? 1 : -1)
    }
  }

  // Bayesian confidence boosts signal weight
  if (bayesian) {
    if (bayesian.regimeShiftDetected) { score -= 0.5; reasons.push('Regime shift') }
    if (bayesian.confidence === 'VERY_HIGH') score *= 1.2
  }

  // Kelly: NO_EDGE is a red flag
  if (kelly) {
    if (kelly.riskAssessment === 'NO_EDGE') { score -= 1; votes++; reasons.push('Kelly:NO_EDGE') }
  }

  // Normalise
  const normalised = votes > 0 ? score / votes : 0

  const signal = (() => {
    if (scenarios?.avoidTrading && kelly?.riskAssessment === 'NO_EDGE') return 'AVOID' as const
    if (normalised >=  0.7) return 'STRONG_LONG'  as const
    if (normalised >=  0.2) return 'LEAN_LONG'    as const
    if (normalised <= -0.7) return 'STRONG_SHORT'  as const
    if (normalised <= -0.2) return 'LEAN_SHORT'    as const
    return 'NEUTRAL' as const
  })()

  const confidence = (() => {
    if (!bayesian)                       return 'LOW'      as const
    if (bayesian.confidence === 'VERY_HIGH' && Math.abs(normalised) > 0.5) return 'HIGH' as const
    if (bayesian.confidence === 'HIGH')  return 'MEDIUM'   as const
    return 'LOW' as const
  })()

  const summary = `${signal} (score ${normalised.toFixed(2)}) — ${reasons.slice(0, 4).join(' · ') || 'Core MC only'}`

  return { signal, confidence, summary }
}

// ── Format enhanced MC block for LLM context ──────────────────────────────────

export function formatEnhancedMCBlock(result: EnhancedMCResult, pipSize: number, dp: number): string {
  const lines: string[] = []

  // Core table (always)
  lines.push(formatMCBlock(result.core, pipSize, dp))

  // Consensus
  lines.push('')
  lines.push(`  ENHANCED CONSENSUS: ${result.consensus.signal} | Confidence: ${result.consensus.confidence}`)
  lines.push(`  ${result.consensus.summary}`)

  // Markov
  if (result.markov) {
    const m = result.markov
    lines.push('')
    lines.push(`  MARKOV REGIME: ${m.currentState} | regimeBias=${m.regimeBias > 0 ? '+' : ''}${m.regimeBias.toFixed(2)} | volScalar=${m.volatilityScalar.toFixed(1)}×`)
    lines.push(`    Next state probs: ↑${(m.nextStateProbs.TRENDING_UP * 100).toFixed(0)}% ↓${(m.nextStateProbs.TRENDING_DOWN * 100).toFixed(0)}% ↔${(m.nextStateProbs.RANGING * 100).toFixed(0)}% ⚡${(m.nextStateProbs.VOLATILE * 100).toFixed(0)}%`)
  }

  // Agent-based / crowd
  if (result.agentBased) {
    const a = result.agentBased
    lines.push('')
    lines.push(`  CROWD POSITIONING: ${a.crowdBiasLabel} (bias=${a.crowdBias > 0 ? '+' : ''}${a.crowdBias.toFixed(2)}) → ${a.contrarianSignal}`)
    if (a.stopClusters.length > 0) {
      lines.push(`    Stop clusters: ${a.stopClusters.map(c => `${c.price.toFixed(dp)} [${c.direction.replace('_STOPS', '')} ${c.strength}]`).join(' | ')}`)
    }
    lines.push(`    Source: ${a.sentimentSource}`)
  }

  // Scenarios
  if (result.scenarios) {
    const s = result.scenarios
    lines.push('')
    lines.push(`  SCENARIO ANALYSIS: current regime=${s.currentRegime} | avoid=${s.avoidTrading ? '⚠ YES' : 'no'}`)
    for (const sc of s.scenarios) {
      const rec = sc.recommended === 'HOLD' ? '— HOLD' : sc.recommended === 'LONG' ? '↑ LONG' : '↓ SHORT'
      lines.push(`    ${sc.label.padEnd(18)} ATR×${sc.atrMultiplier.toFixed(1)}  L:${(sc.longWinRate * 100).toFixed(0)}% S:${(sc.shortWinRate * 100).toFixed(0)}%  EV L:${sc.longEv >= 0 ? '+' : ''}$${sc.longEv.toFixed(0)} S:${sc.shortEv >= 0 ? '+' : ''}$${sc.shortEv.toFixed(0)}  ${rec}`)
    }
    if (s.avoidReason) lines.push(`    ⚠ ${s.avoidReason}`)
  }

  // Bayesian
  if (result.bayesian) {
    const b = result.bayesian
    lines.push('')
    lines.push(`  BAYESIAN CONFIDENCE: ${b.confidence} | posterior win rate ${(b.posteriorMean * 100).toFixed(1)}% [${(b.credibleIntervalLow * 100).toFixed(0)}%–${(b.credibleIntervalHigh * 100).toFixed(0)}%]`)
    lines.push(`    Trades: ${b.totalTrades} total (ESS ${b.recentTrades}) | prior strength ${(b.priorStrength * 100).toFixed(0)}%`)
    if (b.regimeShiftDetected) lines.push(`    ⚠ REGIME SHIFT: ${b.regimeShiftReason}`)
  }

  // Significance
  if (result.significance) {
    const s = result.significance
    lines.push('')
    lines.push(`  EDGE SIGNIFICANCE: ${s.edgeLabel} | observed win rate ${(s.observedWinRate * 100).toFixed(1)}% Wilson[${(s.wilsonLow * 100).toFixed(0)}%–${(s.wilsonHigh * 100).toFixed(0)}%] p=${s.pValue.toFixed(3)}`)
    if (s.tradesNeeded > 0) lines.push(`    ${s.tradesNeeded} more trades needed for 95% confidence.`)
  }

  // Kelly
  if (result.kelly) {
    const k = result.kelly
    lines.push('')
    lines.push(`  KELLY CRITERION: recommended ${k.recommendedFraction} = ${k.recommendedKellyPct.toFixed(1)}% (full ${k.fullKellyPct.toFixed(1)}%) | ${k.riskAssessment}`)
    lines.push(`    ${k.riskAssessmentReason}`)
  }

  // Failed layers (non-fatal notice)
  if (result.failedLayers.length > 0) {
    lines.push('')
    lines.push(`  [Enhanced layers failed: ${result.failedLayers.map(f => `${f.layer}(${f.reason})`).join(', ')}]`)
  }

  return lines.join('\n')
}

// ── Public entry point ────────────────────────────────────────────────────────

export async function runEnhancedMonteCarlo(inputs: EnhancedMCInputs): Promise<EnhancedMCResult | null> {
  // Core MC — if this fails, we return null (nothing to enhance)
  const core = runMonteCarlo(inputs)
  if (!core) return null

  const { enhancements, tradeRecords, configuredRisk, fearGreedValue } = inputs
  const failedLayers: EnhancedMCResult['failedLayers'] = []
  const enabledLayers: EnhancedMCResult['enabledLayers'] = []

  let markov:       MarkovResult       | undefined
  let agentBased:   AgentBasedResult   | undefined
  let scenarios:    ScenariosResult    | undefined
  let bayesian:     BayesianResult     | undefined
  let significance: SignificanceResult | undefined
  let kelly:        KellyResult        | undefined

  // ── Layer 1: Markov ──────────────────────────────────────────────────────
  if (enhancements.markov) {
    enabledLayers.push('markov')
    try {
      markov = runMarkov(inputs.m1)
    } catch (e) {
      failedLayers.push({ layer: 'markov', reason: e instanceof Error ? e.message : String(e) })
    }
  }

  // ── Layer 2: Agent-based / Crowd ─────────────────────────────────────────
  if (enhancements.agentBased) {
    enabledLayers.push('agentBased')
    try {
      const agInput: AgentBasedInput = {
        m15: inputs.m15,
        h1:  inputs.h1,
        h4:  inputs.h4,
        fearGreedValue,
      }
      agentBased = runAgentBased(agInput)
    } catch (e) {
      failedLayers.push({ layer: 'agentBased', reason: e instanceof Error ? e.message : String(e) })
    }
  }

  // ── Layer 3: Scenarios ───────────────────────────────────────────────────
  if (enhancements.scenarios) {
    enabledLayers.push('scenarios')
    try {
      const atrDist = inputs.atr14 * 1.0   // SL distance in price units
      const tpDist  = inputs.atr14 * 1.5
      scenarios = runScenarios({
        m1:          inputs.m1,
        entryPrice:  inputs.currentPrice,
        slPips:      atrDist,
        tpPips:      tpDist,
      })
    } catch (e) {
      failedLayers.push({ layer: 'scenarios', reason: e instanceof Error ? e.message : String(e) })
    }
  }

  // ── Layers 4+5+6: Bayesian / Significance / Kelly ─────────────────────────
  if (enhancements.bayesian) {
    enabledLayers.push('bayesian')
    try {
      bayesian     = runBayesian(tradeRecords)
      significance = runSignificance(tradeRecords)
    } catch (e) {
      failedLayers.push({ layer: 'bayesian', reason: e instanceof Error ? e.message : String(e) })
    }
  }

  if (enhancements.kelly) {
    enabledLayers.push('kelly')
    if (!bayesian)    bayesian     = runBayesian(tradeRecords)
    if (!significance) significance = runSignificance(tradeRecords)
    try {
      kelly = runKelly({
        trades:            tradeRecords,
        bayesian:          bayesian,
        significance:      significance,
        configuredRiskPct: configuredRisk,
      })
    } catch (e) {
      failedLayers.push({ layer: 'kelly', reason: e instanceof Error ? e.message : String(e) })
    }
  }

  const consensus = buildConsensus(core, markov, agentBased, scenarios, bayesian, kelly)

  return {
    core,
    markov,
    agentBased,
    scenarios,
    bayesian,
    significance,
    kelly,
    enabledLayers,
    failedLayers,
    consensus,
    generatedAt: Date.now(),
  }
}
