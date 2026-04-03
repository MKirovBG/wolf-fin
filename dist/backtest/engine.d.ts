import type { Candle } from '../adapters/types.js';
import type { BacktestConfig, BacktestTrade, BacktestMetrics } from '../types/research.js';
import type { StrategyDefinition } from '../types/strategy.js';
export interface BacktestResult {
    trades: BacktestTrade[];
    metrics: BacktestMetrics;
    totalBars: number;
    barsAnalyzed: number;
}
/**
 * Run a backtest on a slice of historical H1 candles.
 * Returns trade results and aggregate metrics.
 */
export declare function runBacktest(params: {
    config: BacktestConfig;
    candles: Candle[];
    strategy?: StrategyDefinition;
    runId?: number;
}): BacktestResult;
//# sourceMappingURL=engine.d.ts.map