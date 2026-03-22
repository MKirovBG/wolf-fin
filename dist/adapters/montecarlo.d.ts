import type { Candle } from './types.js';
export interface MCActionResult {
    winRate: number;
    ev: number;
    p10: number;
    p50: number;
    p90: number;
    slHitPct: number;
    medianBarsToClose: number;
}
export interface MCResult {
    long: MCActionResult;
    short: MCActionResult;
    recommended: 'LONG' | 'SHORT' | 'HOLD';
    edgeDelta: number;
    pathCount: number;
    barsForward: number;
    generatedAt: number;
}
export interface MCInputs {
    m1: Candle[];
    m5: Candle[];
    m15: Candle[];
    m30: Candle[];
    h1: Candle[];
    h4: Candle[];
    currentPrice: number;
    pipSize: number;
    pipValue: number;
    lotSize: number;
    atr14: number;
    ema20: number;
    ema50: number;
}
export declare function runMonteCarlo(inputs: MCInputs): MCResult | null;
export declare function formatMCBlock(mc: MCResult, pipSize: number, dp: number): string;
//# sourceMappingURL=montecarlo.d.ts.map