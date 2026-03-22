import type { StrategyFn } from './strategies.js';
export interface BacktestResult {
    totalTicks: number;
    trades: TradeRecord[];
    wins: number;
    losses: number;
    winRate: number;
    totalPnl: number;
    avgPnl: number;
    sharpe: number;
    maxDrawdown: number;
}
interface TradeRecord {
    tick: number;
    action: 'BUY' | 'SELL';
    entry: number;
    sl: number;
    tp: number;
    lots: number;
    reason: string;
    exitPrice: number;
    exitTick: number;
    pnl: number;
    outcome: 'TP' | 'SL' | 'OPEN';
}
export declare function runBacktest(recordingPath: string, strategy: StrategyFn): BacktestResult;
export {};
//# sourceMappingURL=runner.d.ts.map