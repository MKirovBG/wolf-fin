// Wolf-Fin — Score component weights and tier thresholds (Phase 2)
export const WEIGHTS = {
    trendAlignment: 15,
    structureQuality: 15,
    entryPrecision: 10,
    stopQuality: 10,
    targetQuality: 10,
    sessionTiming: 10,
    volatilitySuitability: 10,
    executionQuality: 10,
    strategyFit: 10,
    // Penalties (max magnitude)
    contextPenalty: 15,
    overextensionPenalty: 10,
    counterTrendPenalty: 10,
};
export const TIERS = {
    valid: 65,
    watchlist: 45,
    low_quality: 25,
};
export function scoreTier(score) {
    if (score >= TIERS.valid)
        return 'valid';
    if (score >= TIERS.watchlist)
        return 'watchlist';
    if (score >= TIERS.low_quality)
        return 'low_quality';
    return 'rejected';
}
//# sourceMappingURL=weights.js.map