import type { Candle, Indicators } from '../adapters/types.js';
import type { AnalysisContext } from '../types.js';
export declare function buildAnalysisPrompt(params: {
    symbol: string;
    timeframe: string;
    price: {
        bid: number;
        ask: number;
        mid: number;
        spread: number;
    };
    candles: Candle[];
    indicators: Indicators;
    context: AnalysisContext;
    indicatorCfg?: {
        emaFast?: number;
        emaSlow?: number;
    };
    digits?: number;
}): string;
export declare function buildSystemPrompt(): string;
//# sourceMappingURL=prompt.d.ts.map