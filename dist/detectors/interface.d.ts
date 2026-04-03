import type { Candle, Indicators } from '../adapters/types.js';
import type { FeatureSnapshot, MarketState } from '../types/market.js';
import type { SetupCandidate } from '../types/setup.js';
import type { StrategyDefinition } from '../types/strategy.js';
export interface DetectorInput {
    candles: Candle[];
    allCandles?: {
        m15?: Candle[];
        h1?: Candle[];
        h4?: Candle[];
    };
    indicators: Indicators;
    features: FeatureSnapshot;
    marketState: MarketState;
    price: {
        bid: number;
        ask: number;
        mid: number;
        spread: number;
    };
    point: number;
    digits: number;
    strategy?: StrategyDefinition;
}
export type DetectorFn = (input: DetectorInput) => SetupCandidate;
export declare function emptyCandidate(symbolKey: string, detector: string, setupType: string, reasons?: string[], disqualifiers?: string[]): SetupCandidate;
export declare function zeroBreakdown(): import('../types/setup.js').ScoreBreakdown;
export declare function computeRR(entry: number, stop: number, target: number): number;
//# sourceMappingURL=interface.d.ts.map