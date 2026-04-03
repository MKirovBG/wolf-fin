export interface SetupCandidate {
    id?: number;
    analysisId?: number;
    symbolKey: string;
    capturedAt: string;
    detector: string;
    found: boolean;
    setupType: string;
    direction: 'BUY' | 'SELL' | null;
    entryZone: {
        low: number;
        high: number;
    } | null;
    stopLoss: number | null;
    targets: number[];
    riskReward: number;
    invalidationRule: string | null;
    score: number;
    tier: 'valid' | 'watchlist' | 'low_quality' | 'rejected';
    scoreBreakdown: ScoreBreakdown;
    reasons: string[];
    disqualifiers: string[];
    tags: string[];
}
export interface ScoreBreakdown {
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
    totalPositive: number;
    totalPenalty: number;
    finalScore: number;
    reasons: string[];
}
//# sourceMappingURL=setup.d.ts.map