import type { Candle } from './types.js';
export interface BacktestConfig {
    slMult: number;
    tpMult: number;
    maxHoldBars: number;
    rsiOversold: number;
    rsiOverbought: number;
    requireEmaConfirm: boolean;
    rsiPeriod: number;
    emaFast: number;
    emaSlow: number;
    atrPeriod: number;
    startingEquityUsd: number;
    maxRiskPercent: number;
    pipSize: number;
    pipValue: number;
}
export declare const BACKTEST_DEFAULTS: Omit<BacktestConfig, 'pipSize' | 'pipValue'>;
export interface BacktestTrade {
    barIndex: number;
    openTime: string;
    closeTime: string;
    direction: 'LONG' | 'SHORT';
    entry: number;
    exit: number;
    sl: number;
    tp: number;
    exitReason: 'TP' | 'SL' | 'MAX_HOLD';
    pnlUsd: number;
    lots: number;
    rsiAtEntry: number;
    atrAtEntry: number;
    barsHeld: number;
}
export interface BacktestResult {
    trades: BacktestTrade[];
    equityCurve: Array<{
        time: string;
        equity: number;
        cumPnl: number;
    }>;
    stats: {
        totalTrades: number;
        wins: number;
        losses: number;
        winRate: number | null;
        totalPnl: number;
        maxDrawdown: number;
        maxDrawdownPct: number;
        sharpe: number | null;
        profitFactor: number | null;
        avgWin: number | null;
        avgLoss: number | null;
        riskReward: number | null;
        maxConsecWins: number;
        maxConsecLosses: number;
        avgBarsHeld: number;
        expectancy: number;
    };
    config: BacktestConfig;
    barsTotal: number;
    warmupBars: number;
    ranAt: number;
}
export declare function runBacktest(candles: Candle[], cfg: BacktestConfig): BacktestResult;
//# sourceMappingURL=backtest.d.ts.map