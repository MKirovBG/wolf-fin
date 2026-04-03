import type { Candle, Indicators, KeyLevel } from '../adapters/types.js';
import type { AnalysisContext } from '../types.js';
import type { FeatureSnapshot } from '../types/market.js';
export declare function computeFeatures(params: {
    symbolKey: string;
    symbol: string;
    candles: Candle[];
    indicators: Indicators;
    context: AnalysisContext;
    keyLevels: KeyLevel[];
    point: number;
    indicatorCfg?: {
        emaFast?: number;
        emaSlow?: number;
    };
}): FeatureSnapshot;
//# sourceMappingURL=index.d.ts.map