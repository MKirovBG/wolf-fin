// Wolf-Fin — Trend Pullback Continuation Detector
// Finds continuation entries after an impulse and healthy pullback in a trending regime.
import { emptyCandidate, zeroBreakdown, computeRR } from './interface.js';
const KEY = 'trend_pullback';
const LABEL = 'Trend Pullback Continuation';
export function detectTrendPullback(input) {
    const { features, marketState, indicators, candles } = input;
    const { trend, structure, volatility, context, execution, session } = features;
    const atr = volatility.atrAbsolute;
    const price = candles[candles.length - 1].close;
    // ── Hard disqualifiers ─────────────────────────────────────────────────────
    const disq = [];
    if (execution.spreadStatus === 'abnormal')
        disq.push('Spread abnormal');
    if (context.calendarRisk === 'high')
        disq.push('High-impact news imminent');
    if (volatility.volatilityRegime === 'abnormal')
        disq.push('Abnormal volatility — range unstable');
    if (structure.choch !== null)
        disq.push(`CHoCH ${structure.choch} — trend structure broken`);
    if (marketState.contextRisk === 'avoid')
        disq.push('Context risk: avoid');
    if (disq.length)
        return emptyCandidate(features.symbolKey, KEY, LABEL, [], disq);
    // ── Preconditions ──────────────────────────────────────────────────────────
    if (marketState.regime !== 'trend') {
        return emptyCandidate(features.symbolKey, KEY, LABEL, ['Regime not trend']);
    }
    if (trend.directionBias === 'neutral' || trend.directionStrength < 35) {
        return emptyCandidate(features.symbolKey, KEY, LABEL, ['Insufficient directional bias']);
    }
    if (trend.adxStrength === 'weak') {
        return emptyCandidate(features.symbolKey, KEY, LABEL, ['ADX too weak for trend pullback']);
    }
    if (structure.trendDirection === 'ranging') {
        return emptyCandidate(features.symbolKey, KEY, LABEL, ['Structure ranging — no clear trend']);
    }
    const isBull = trend.directionBias === 'bullish';
    const trendMatchesStructure = (isBull && structure.trendDirection === 'uptrend') ||
        (!isBull && structure.trendDirection === 'downtrend');
    if (!trendMatchesStructure) {
        return emptyCandidate(features.symbolKey, KEY, LABEL, ['Trend direction inconsistent with structure']);
    }
    // ── Trigger: pullback into the zone ───────────────────────────────────────
    const pull = structure.pullbackDepthPct;
    if (pull < 20 || pull > 70) {
        return emptyCandidate(features.symbolKey, KEY, LABEL, [`Pullback depth ${pull.toFixed(0)}% — outside 20–70% window`]);
    }
    // Price should be near the fast EMA (within 0.6% of price)
    const nearEma = Math.abs(trend.priceVsEmaFast) < 0.6;
    const nearSwingSupport = isBull
        ? Math.abs(price - structure.recentSwingLow) / price < 0.008
        : Math.abs(price - structure.recentSwingHigh) / price < 0.008;
    if (!nearEma && !nearSwingSupport) {
        return emptyCandidate(features.symbolKey, KEY, LABEL, ['Price not near EMA or swing support zone']);
    }
    // ── Geometry ───────────────────────────────────────────────────────────────
    const direction = isBull ? 'BUY' : 'SELL';
    const entryZone = isBull
        ? { low: +(price - atr * 0.15).toFixed(input.digits), high: +(price + atr * 0.15).toFixed(input.digits) }
        : { low: +(price - atr * 0.15).toFixed(input.digits), high: +(price + atr * 0.15).toFixed(input.digits) };
    const stopLoss = isBull
        ? +(Math.min(structure.recentSwingLow, price - atr * 1.2)).toFixed(input.digits)
        : +(Math.max(structure.recentSwingHigh, price + atr * 1.2)).toFixed(input.digits);
    const stopDist = Math.abs(price - stopLoss);
    const tp1 = isBull
        ? +(price + stopDist * 2).toFixed(input.digits)
        : +(price - stopDist * 2).toFixed(input.digits);
    const tp2 = isBull
        ? +(price + stopDist * 3).toFixed(input.digits)
        : +(price - stopDist * 3).toFixed(input.digits);
    // ── Build reasons ──────────────────────────────────────────────────────────
    const reasons = [
        `${structure.trendDirection} — trend pullback into ${nearEma ? 'EMA zone' : 'swing support'}`,
        `Pullback depth: ${pull.toFixed(0)}% — healthy retracement`,
        `ADX ${trend.adxValue.toFixed(0)} (${trend.adxStrength}) — trend momentum active`,
    ];
    if (trend.mtfAlignment === 'aligned_bullish' || trend.mtfAlignment === 'aligned_bearish') {
        reasons.push(`MTF aligned ${trend.directionBias}`);
    }
    if (session.isOptimalSession || session.isLondonNYOverlap) {
        reasons.push(`Session: ${session.sessionNote}`);
    }
    const tags = [
        structure.trendDirection,
        session.activeSessions[0] ?? 'off-session',
        marketState.regime,
    ];
    return {
        symbolKey: features.symbolKey,
        capturedAt: new Date().toISOString(),
        detector: KEY,
        found: true,
        setupType: LABEL,
        direction,
        entryZone,
        stopLoss,
        targets: [tp1, tp2],
        riskReward: computeRR(price, stopLoss, tp1),
        invalidationRule: isBull
            ? `Close below ${stopLoss.toFixed(input.digits)}`
            : `Close above ${stopLoss.toFixed(input.digits)}`,
        score: 0,
        tier: 'rejected',
        scoreBreakdown: zeroBreakdown(),
        reasons,
        disqualifiers: [],
        tags,
    };
}
//# sourceMappingURL=trendPullback.js.map