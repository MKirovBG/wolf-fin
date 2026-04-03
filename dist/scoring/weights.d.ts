export declare const WEIGHTS: {
    trendAlignment: number;
    structureQuality: number;
    entryPrecision: number;
    stopQuality: number;
    targetQuality: number;
    sessionTiming: number;
    volatilitySuitability: number;
    executionQuality: number;
    strategyFit: number;
    contextPenalty: number;
    overextensionPenalty: number;
    counterTrendPenalty: number;
};
export declare const TIERS: {
    valid: number;
    watchlist: number;
    low_quality: number;
};
export declare function scoreTier(score: number): 'valid' | 'watchlist' | 'low_quality' | 'rejected';
//# sourceMappingURL=weights.d.ts.map