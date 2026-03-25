import type { Candle } from './types.js';
import type { MCInputs } from './montecarlo.js';
import type { MCEnhancements, EnhancedMCResult, TradeRecord } from './mc-types.js';
export interface EnhancedMCInputs extends MCInputs {
    m5: Candle[];
    m15: Candle[];
    m30: Candle[];
    enhancements: MCEnhancements;
    tradeRecords: TradeRecord[];
    configuredRisk: number | null;
    fearGreedValue?: number;
}
export declare function formatEnhancedMCBlock(result: EnhancedMCResult, pipSize: number, dp: number): string;
export declare function runEnhancedMonteCarlo(inputs: EnhancedMCInputs): Promise<EnhancedMCResult | null>;
//# sourceMappingURL=mc-orchestrator.d.ts.map