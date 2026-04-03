import type { Candle, Indicators } from '../adapters/types.js';
import type { AnalysisContext, CandlePattern } from '../types.js';
import type { FeatureSnapshot, MarketState } from '../types/market.js';
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
    allCandles?: Record<string, Candle[]>;
    indicators: Indicators;
    context: AnalysisContext;
    patterns?: CandlePattern[];
    indicatorCfg?: {
        emaFast?: number;
        emaSlow?: number;
    };
    digits?: number;
    features?: FeatureSnapshot;
    marketState?: MarketState;
}): string;
export declare function buildSystemPrompt(options?: {
    strategyInstructions?: string;
    customPrompt?: string;
}): string;
//# sourceMappingURL=prompt.d.ts.map