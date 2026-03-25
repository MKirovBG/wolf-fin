import type { TradeRecord, BayesianResult, SignificanceResult, KellyResult } from './mc-types.js';
export declare function runBayesian(trades: TradeRecord[]): BayesianResult;
export declare function runSignificance(trades: TradeRecord[]): SignificanceResult;
export interface KellyInput {
    trades: TradeRecord[];
    bayesian: BayesianResult;
    significance: SignificanceResult;
    configuredRiskPct: number | null;
}
export declare function runKelly(input: KellyInput): KellyResult;
//# sourceMappingURL=mc-bayesian.d.ts.map