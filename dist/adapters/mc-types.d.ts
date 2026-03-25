import type { Candle } from './types.js';
export interface MCEnhancements {
    markov: boolean;
    agentBased: boolean;
    scenarios: boolean;
    bayesian: boolean;
    kelly: boolean;
}
export declare const MC_ENHANCEMENT_DEFAULTS: MCEnhancements;
export declare const MC_ENHANCEMENT_LABELS: Record<keyof MCEnhancements, {
    label: string;
    description: string;
}>;
export interface Candles {
    m1: Candle[];
    m5: Candle[];
    m15: Candle[];
    m30: Candle[];
    h1: Candle[];
    h4: Candle[];
}
export type MarkovState = 'TRENDING_UP' | 'TRENDING_DOWN' | 'RANGING' | 'VOLATILE';
export interface MarkovResult {
    currentState: MarkovState;
    nextStateProbs: {
        TRENDING_UP: number;
        TRENDING_DOWN: number;
        RANGING: number;
        VOLATILE: number;
    };
    regimeBias: number;
    volatilityScalar: number;
    stateHistory: MarkovState[];
}
export interface StopCluster {
    price: number;
    direction: 'LONG_STOPS' | 'SHORT_STOPS';
    strength: 'WEAK' | 'MODERATE' | 'STRONG';
    description: string;
}
export interface LiquidityZone {
    priceHigh: number;
    priceLow: number;
    type: 'RESISTANCE' | 'SUPPORT' | 'EQUAL_HIGHS' | 'EQUAL_LOWS';
    description: string;
}
export interface AgentBasedResult {
    crowdBias: number;
    crowdBiasLabel: 'HEAVILY_LONG' | 'SLIGHTLY_LONG' | 'NEUTRAL' | 'SLIGHTLY_SHORT' | 'HEAVILY_SHORT';
    stopClusters: StopCluster[];
    liquidityZones: LiquidityZone[];
    contrarianSignal: 'FADE_LONGS' | 'FADE_SHORTS' | 'NO_SIGNAL';
    pathBias: number;
    sentimentSource: string;
}
export type VolatilityRegime = 'LOW_VOL' | 'NORMAL' | 'HIGH_VOL' | 'EXTREME_VOL';
export type ScenarioLabel = 'Normal' | 'High Volatility' | 'Low Volatility' | 'Pre-News' | 'Session Boundary';
export interface ScenarioResult {
    label: ScenarioLabel;
    regime: VolatilityRegime;
    atrMultiplier: number;
    longWinRate: number;
    shortWinRate: number;
    longEv: number;
    shortEv: number;
    recommended: 'LONG' | 'SHORT' | 'HOLD';
}
export interface ScenariosResult {
    currentRegime: VolatilityRegime;
    scenarios: ScenarioResult[];
    avoidTrading: boolean;
    avoidReason: string | null;
    worstCase: ScenarioResult;
}
export interface BayesianResult {
    alpha: number;
    beta: number;
    posteriorMean: number;
    credibleIntervalLow: number;
    credibleIntervalHigh: number;
    confidence: 'LOW' | 'MEDIUM' | 'HIGH' | 'VERY_HIGH';
    confidenceReason: string;
    regimeShiftDetected: boolean;
    regimeShiftReason: string | null;
    totalTrades: number;
    recentTrades: number;
    priorStrength: number;
}
export interface SignificanceResult {
    observedWinRate: number;
    wilsonLow: number;
    wilsonHigh: number;
    pValue: number;
    edgeConfirmed: boolean;
    edgeLabel: 'CONFIRMED' | 'LIKELY' | 'UNCONFIRMED' | 'INSUFFICIENT_DATA';
    tradesNeeded: number;
    sampleSize: number;
}
export interface KellyResult {
    fullKellyPct: number;
    quarterKellyPct: number;
    halfKellyPct: number;
    recommendedKellyPct: number;
    recommendedFraction: '1/4 Kelly' | '1/2 Kelly' | 'Full Kelly' | 'No Trade';
    configuredRiskPct: number | null;
    riskAssessment: 'UNDER_BETTING' | 'OPTIMAL' | 'OVER_BETTING' | 'NO_EDGE';
    riskAssessmentReason: string;
}
export interface EnhancedMCResult {
    core: import('./montecarlo.js').MCResult;
    markov?: MarkovResult;
    agentBased?: AgentBasedResult;
    scenarios?: ScenariosResult;
    bayesian?: BayesianResult;
    significance?: SignificanceResult;
    kelly?: KellyResult;
    enabledLayers: (keyof MCEnhancements)[];
    failedLayers: {
        layer: string;
        reason: string;
    }[];
    consensus: {
        signal: 'STRONG_LONG' | 'LEAN_LONG' | 'NEUTRAL' | 'LEAN_SHORT' | 'STRONG_SHORT' | 'AVOID';
        confidence: 'LOW' | 'MEDIUM' | 'HIGH' | 'VERY_HIGH';
        summary: string;
    };
    generatedAt: number;
}
export interface TradeRecord {
    wonTrade: boolean;
    pnlUsd: number;
    closedAt: string;
}
//# sourceMappingURL=mc-types.d.ts.map