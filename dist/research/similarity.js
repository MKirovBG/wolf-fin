// Wolf-Fin — Historical similarity search (Phase 5)
// Finds past analyses whose FeatureSnapshot is closest to the current one.
/**
 * Compute a Euclidean-style distance between two feature snapshots.
 * Only uses the most stable numeric dimensions.
 */
export function featureDistance(a, b) {
    const dims = [
        // Trend
        [a.trend.rsiValue / 100, b.trend.rsiValue / 100],
        [a.trend.adxValue / 60, b.trend.adxValue / 60],
        [a.trend.directionStrength / 100, b.trend.directionStrength / 100],
        [a.trend.priceVsEmaFast / 2, b.trend.priceVsEmaFast / 2],
        // Volatility
        [a.volatility.volatilityPercentile / 100, b.volatility.volatilityPercentile / 100],
        [a.volatility.bbWidthPct / 2, b.volatility.bbWidthPct / 2],
        // Structure
        [a.structure.pullbackDepthPct / 100, b.structure.pullbackDepthPct / 100],
        [a.structure.overextensionATR / 5, b.structure.overextensionATR / 5],
        // Context
        [encodeCategorical(a.trend.emaAlignment), encodeCategorical(b.trend.emaAlignment)],
        [encodeCategorical(a.structure.trendDirection), encodeCategorical(b.structure.trendDirection)],
        [encodeCategorical(a.marketStateProxy?.regime ?? 'range'), encodeCategorical(b.marketStateProxy?.regime ?? 'range')],
    ];
    return Math.sqrt(dims.reduce((sum, [x, y]) => sum + (x - y) ** 2, 0));
}
function encodeCategorical(value) {
    const map = {
        // emaAlignment / direction
        bullish: 1.0, neutral: 0.5, bearish: 0,
        // trendDirection
        uptrend: 1.0, ranging: 0.5, downtrend: 0,
        // regime
        trend: 1.0, breakout_watch: 0.85, range: 0.5, compressed: 0.35, reversal_watch: 0.2, volatile: 0,
    };
    return map[value] ?? 0.5;
}
/**
 * Find the N most similar past feature snapshots from a list.
 */
export function findSimilarAnalyses(current, history, topN = 5) {
    const scored = history
        .filter(h => h.analysisId !== current.analysisId)
        .map(h => ({
        analysisId: h.analysisId,
        symbolKey: h.symbolKey,
        capturedAt: h.capturedAt,
        distance: featureDistance(current, h.features),
        features: h.features,
    }))
        .sort((a, b) => a.distance - b.distance);
    return scored.slice(0, topN);
}
//# sourceMappingURL=similarity.js.map