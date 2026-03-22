import type { MarketSnapshot } from '../adapters/types.js';
export interface Signal {
    action: 'BUY' | 'SELL' | 'HOLD';
    lots: number;
    slPrice: number;
    tpPrice: number;
    reason: string;
}
export type StrategyFn = (snap: MarketSnapshot) => Signal;
export declare const mcFollow: StrategyFn;
export declare const emaCross: StrategyFn;
export declare const STRATEGIES: Record<string, StrategyFn>;
//# sourceMappingURL=strategies.d.ts.map