import type { Candle } from './types.js';
import type { ScenariosResult } from './mc-types.js';
export interface ScenariosInput {
    m1: Candle[];
    entryPrice: number;
    slPips: number;
    tpPips: number;
    simCount?: number;
    barsForward?: number;
}
export declare function runScenarios(input: ScenariosInput): ScenariosResult;
//# sourceMappingURL=mc-scenarios.d.ts.map