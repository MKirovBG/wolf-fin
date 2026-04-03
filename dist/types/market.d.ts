export interface TrendFeatures {
    emaFastSlope: number;
    emaSlowSlope: number;
    priceVsEmaFast: number;
    priceVsEmaSlow: number;
    emaAlignment: 'bullish' | 'bearish' | 'neutral';
    rsiValue: number;
    rsiZone: 'oversold' | 'neutral' | 'overbought';
    adxValue: number;
    adxStrength: 'weak' | 'moderate' | 'strong';
    directionBias: 'bullish' | 'bearish' | 'neutral';
    directionStrength: number;
    macdBias: 'bullish' | 'bearish' | 'neutral' | undefined;
    psarBias: 'bullish' | 'bearish' | undefined;
    mtfScore: number | undefined;
    mtfAlignment: 'aligned_bullish' | 'aligned_bearish' | 'divergent' | 'neutral';
}
export interface VolatilityFeatures {
    atrAbsolute: number;
    atrPips: number;
    bbWidthPct: number;
    recentRangeExpansion: boolean;
    volatilityRegime: 'quiet' | 'normal' | 'elevated' | 'abnormal';
    volatilityPercentile: number;
    keltnerPosition: 'inside' | 'above' | 'below' | undefined;
}
export interface StructureFeatures {
    recentSwingHigh: number;
    recentSwingLow: number;
    swingHighAge: number;
    swingLowAge: number;
    bos: 'bullish' | 'bearish' | null;
    choch: 'bullish' | 'bearish' | null;
    trendDirection: 'uptrend' | 'downtrend' | 'ranging';
    pullbackDepthPct: number;
    overextensionATR: number;
}
export interface LevelFeatures {
    vwapDistance: number;
    vwapSide: 'above' | 'below' | undefined;
    nearestSupportDist: number;
    nearestResistDist: number;
    roundNumberProximity: number;
    nearestFibLabel: string | undefined;
}
export interface SessionFeatures {
    activeSessions: string[];
    isLondonNYOverlap: boolean;
    isOptimalSession: boolean;
    sessionQuality: 'poor' | 'acceptable' | 'favorable' | 'optimal';
    sessionNote: string;
}
export interface ExecutionFeatures {
    spreadPips: number;
    spreadStatus: 'normal' | 'wide' | 'abnormal';
}
export interface ContextFeatures {
    newsRisk: 'none' | 'low' | 'elevated';
    newsCount: number;
    calendarRisk: 'none' | 'low' | 'medium' | 'high';
    nextHighImpactMinutes: number | null;
    dominantSentiment: 'bullish' | 'bearish' | 'neutral' | 'none';
}
export interface FeatureSnapshot {
    analysisId?: number;
    symbolKey: string;
    capturedAt: string;
    trend: TrendFeatures;
    volatility: VolatilityFeatures;
    structure: StructureFeatures;
    levels: LevelFeatures;
    session: SessionFeatures;
    execution: ExecutionFeatures;
    context: ContextFeatures;
}
export type MarketRegime = 'trend' | 'range' | 'breakout_watch' | 'reversal_watch' | 'volatile' | 'compressed';
export interface MarketState {
    analysisId?: number;
    symbolKey: string;
    capturedAt: string;
    regime: MarketRegime;
    direction: 'bullish' | 'bearish' | 'neutral';
    directionStrength: number;
    volatility: 'quiet' | 'normal' | 'elevated' | 'abnormal';
    sessionQuality: 'poor' | 'acceptable' | 'favorable' | 'optimal';
    contextRisk: 'low' | 'moderate' | 'elevated' | 'avoid';
    regimeReasons: string[];
    directionReasons: string[];
    volatilityReasons: string[];
    sessionReasons: string[];
    riskReasons: string[];
}
//# sourceMappingURL=market.d.ts.map