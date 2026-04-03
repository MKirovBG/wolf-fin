export interface BacktestConfig {
    symbolKey: string;
    symbol: string;
    timeframe: string;
    strategyKey?: string;
    detectors?: string[];
    fromDate: string;
    toDate: string;
    slippagePips?: number;
    spreadPips?: number;
    minScore?: number;
}
export interface BacktestRun {
    id?: number;
    symbolKey: string;
    config: BacktestConfig;
    status: 'running' | 'complete' | 'failed';
    startedAt: string;
    completedAt?: string;
    error?: string;
    metrics?: BacktestMetrics;
}
export interface BacktestMetrics {
    totalBars: number;
    tradesTotal: number;
    tradesWon: number;
    tradesLost: number;
    tradesExpired: number;
    winRate: number;
    avgRR: number;
    avgWinR: number;
    avgLossR: number;
    expectancy: number;
    maxConsecLosses: number;
    profitFactor: number;
    bySetupType: Record<string, {
        trades: number;
        wins: number;
        winRate: number;
    }>;
    bySession: Record<string, {
        trades: number;
        wins: number;
        winRate: number;
    }>;
}
export interface BacktestTrade {
    id?: number;
    runId: number;
    symbolKey: string;
    detector: string;
    direction: 'BUY' | 'SELL';
    entryBar: number;
    entryTime: string;
    entryPrice: number;
    stopLoss: number;
    targets: number[];
    score: number;
    setupType: string;
    tags: string[];
    outcome: 'won_tp1' | 'won_tp2' | 'lost_sl' | 'expired' | 'not_filled';
    exitPrice: number | null;
    exitTime: string | null;
    barsHeld: number | null;
    rMultiple: number | null;
    mae: number | null;
    mfe: number | null;
}
export type AlertConditionType = 'setup_score_gte' | 'regime_change' | 'direction_change' | 'context_risk_gte';
export interface AlertRule {
    id?: number;
    symbolKey: string;
    name: string;
    conditionType: AlertConditionType;
    conditionValue: string;
    enabled: boolean;
    createdAt: string;
}
export interface AlertFiring {
    id?: number;
    ruleId: number;
    symbolKey: string;
    analysisId?: number;
    firedAt: string;
    message: string;
    acknowledged: boolean;
}
//# sourceMappingURL=research.d.ts.map