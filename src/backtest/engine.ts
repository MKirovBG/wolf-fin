// Wolf-Fin — Backtest Engine (Phase 4)
// Replays historical candles bar-by-bar, runs detectors + scoring at each step,
// simulates fills, and returns trade-level results + aggregate metrics.

import { computeIndicators } from '../adapters/indicators.js'
import { computeFeatures }   from '../features/index.js'
import { classifyMarketState } from '../state/marketState.js'
import { runDetectors }      from '../detectors/index.js'
import { scoreCandidates }   from '../scoring/index.js'
import { computeMetrics }    from './metrics.js'
import { buildSessionContext } from '../adapters/session.js'
import type { Candle }       from '../adapters/types.js'
import type { BacktestConfig, BacktestTrade, BacktestMetrics } from '../types/research.js'
import type { StrategyDefinition } from '../types/strategy.js'

// Minimum bars before we start evaluating setups
const WARMUP_BARS = 50

interface ActivePosition {
  tradeIdx: number
  entryBar: number
  entryTime: string
  entryPrice: number
  stopLoss: number
  targets: number[]
  direction: 'BUY' | 'SELL'
}

export interface BacktestResult {
  trades: BacktestTrade[]
  metrics: BacktestMetrics
  totalBars: number
  barsAnalyzed: number
}

/**
 * Run a backtest on a slice of historical H1 candles.
 * Returns trade results and aggregate metrics.
 */
export function runBacktest(params: {
  config: BacktestConfig
  candles: Candle[]
  strategy?: StrategyDefinition
  runId?: number
}): BacktestResult {
  const { config, candles, strategy, runId = 0 } = params
  const trades: BacktestTrade[] = []
  const slippage = (config.slippagePips ?? 0) * (1 / 10000)  // approximate pips to price
  const minScore = config.minScore ?? 65

  let barsAnalyzed = 0
  let activePosition: ActivePosition | null = null

  for (let i = WARMUP_BARS; i < candles.length; i++) {
    const slice  = candles.slice(0, i + 1)
    const bar    = candles[i]

    // ── Check active position first ─────────────────────────────────────────
    if (activePosition) {
      const { direction, entryPrice, stopLoss, targets, entryBar, tradeIdx } = activePosition
      const barHigh = bar.high
      const barLow  = bar.low
      const barsHeld = i - entryBar
      const trade = trades[tradeIdx]

      // Stop hit
      if ((direction === 'BUY' && barLow <= stopLoss) ||
          (direction === 'SELL' && barHigh >= stopLoss)) {
        const exitPrice = stopLoss
        const stopDist = Math.abs(entryPrice - stopLoss)
        trade.outcome   = 'lost_sl'
        trade.exitPrice = exitPrice
        trade.exitTime  = new Date(bar.openTime).toISOString()
        trade.barsHeld  = barsHeld
        trade.rMultiple = stopDist > 0 ? -(Math.abs(exitPrice - entryPrice) / stopDist) : -1
        trade.mae       = trade.rMultiple
        activePosition  = null
        continue
      }

      // TP1 hit
      const tp1 = targets[0]
      if (tp1 && ((direction === 'BUY' && barHigh >= tp1) || (direction === 'SELL' && barLow <= tp1))) {
        const exitPrice = tp1
        const stopDist  = Math.abs(entryPrice - stopLoss)
        const tp1Dist   = Math.abs(tp1 - entryPrice)
        trade.outcome   = 'won_tp1'
        trade.exitPrice = exitPrice
        trade.exitTime  = new Date(bar.openTime).toISOString()
        trade.barsHeld  = barsHeld
        trade.rMultiple = stopDist > 0 ? tp1Dist / stopDist : 0
        trade.mfe       = trade.rMultiple
        activePosition  = null
        continue
      }

      // Expire after 20 bars
      if (barsHeld >= 20) {
        const exitPrice = bar.close
        const stopDist  = Math.abs(entryPrice - stopLoss)
        trade.outcome   = 'expired'
        trade.exitPrice = exitPrice
        trade.exitTime  = new Date(bar.openTime).toISOString()
        trade.barsHeld  = barsHeld
        trade.rMultiple = stopDist > 0
          ? ((direction === 'BUY' ? exitPrice - entryPrice : entryPrice - exitPrice) / stopDist)
          : 0
        activePosition  = null
        continue
      }

      continue  // position active, skip detection
    }

    // ── Detection pass ───────────────────────────────────────────────────────
    barsAnalyzed++

    // Compute indicators on the slice (expensive but correct)
    const indicators = computeIndicators(slice, {})

    // Build minimal context (no news/calendar in backtest)
    const sessionCtx = buildSessionContext(config.symbol)
    const context = {
      currentPrice: { bid: bar.close, ask: bar.close, spread: config.spreadPips ?? 0, mid: bar.close },
      session: {
        activeSessions:    sessionCtx.activeSessions,
        isLondonNYOverlap: sessionCtx.isLondonNYOverlap,
        isOptimalSession:  sessionCtx.isOptimalSession,
        note:              sessionCtx.note,
      },
    }

    const features = computeFeatures({
      symbolKey:    config.symbolKey,
      symbol:       config.symbol,
      candles:      slice.slice(-100),
      indicators,
      context,
      keyLevels:    [],
      point:        0.0001,  // forex default; could be parameterized
      indicatorCfg: {},
    })

    const marketState = classifyMarketState(features)

    const candidates = runDetectors({
      candles:    slice.slice(-100),
      indicators,
      features,
      marketState,
      price:      { bid: bar.close, ask: bar.close, mid: bar.close, spread: config.spreadPips ?? 0 },
      point:      0.0001,
      digits:     5,
      strategy,
    }, strategy?.allowedDetectors)

    const scored = scoreCandidates(candidates, features, marketState, strategy)
    const best   = scored.find(c => c.found && c.score >= minScore && c.tier === 'valid')

    if (!best || !best.entryZone || best.stopLoss === null || best.direction === null) continue

    // ── Open position ────────────────────────────────────────────────────────
    const entryPrice = best.direction === 'BUY'
      ? best.entryZone.high + slippage
      : best.entryZone.low  - slippage

    const tradeIdx = trades.length
    trades.push({
      id:         tradeIdx,
      runId,
      symbolKey:  config.symbolKey,
      detector:   best.detector,
      direction:  best.direction,
      entryBar:   i,
      entryTime:  new Date(bar.openTime).toISOString(),
      entryPrice,
      stopLoss:   best.stopLoss,
      targets:    best.targets,
      score:      best.score,
      setupType:  best.setupType,
      tags:       best.tags,
      outcome:    'not_filled',
      exitPrice:  null,
      exitTime:   null,
      barsHeld:   null,
      rMultiple:  null,
      mae:        null,
      mfe:        null,
    })

    activePosition = {
      tradeIdx,
      entryBar:   i,
      entryTime:  new Date(bar.openTime).toISOString(),
      entryPrice,
      stopLoss:   best.stopLoss,
      targets:    best.targets,
      direction:  best.direction,
    }
  }

  // Close any open position at end of data
  if (activePosition && trades[activePosition.tradeIdx]) {
    const trade = trades[activePosition.tradeIdx]
    const lastBar = candles[candles.length - 1]
    trade.outcome   = 'expired'
    trade.exitPrice = lastBar.close
    trade.exitTime  = new Date(lastBar.openTime).toISOString()
    trade.barsHeld  = candles.length - 1 - activePosition.entryBar
  }

  const metrics = computeMetrics(trades, candles.length)

  return { trades, metrics, totalBars: candles.length, barsAnalyzed }
}
