import type { AgentState, AgentStatus, CycleResult, LogEntry } from '../types.js';
export declare function initDb(): void;
export declare function dbGetAllAgents(): AgentState[];
export declare function makeAgentKey(market: string, symbol: string, mt5AccountId?: number, name?: string): string;
export declare function dbUpsertAgent(agent: AgentState): void;
export declare function dbRemoveAgent(key: string): void;
export declare function dbUpdateAgentStatus(key: string, status: AgentStatus, startedAt: string | null): void;
export declare function dbRecordCycle(key: string, result: CycleResult): void;
export declare function dbGetTodayRealizedPnl(market: 'crypto' | 'mt5', dateStr: string): number;
export interface AgentPerformanceSummary {
    totalCycles: number;
    buys: number;
    sells: number;
    holds: number;
    lastDecisions: Array<{
        decision: string;
        reason: string;
        time: string;
    }>;
}
export declare function dbGetAgentPerformance(agentKey: string, limit?: number): AgentPerformanceSummary;
export interface AgentStats {
    totalTicks: number;
    totalTrades: number;
    wins: number;
    losses: number;
    winRate: number | null;
    avgWin: number | null;
    avgLoss: number | null;
    riskReward: number | null;
    sharpe: number | null;
    totalPnl: number;
    equityCurve: Array<{
        time: string;
        cumPnl: number;
    }>;
}
export declare function dbGetAgentStats(agentKey: string, limit?: number): AgentStats;
export declare function dbGetCycleResults(market?: string, limit?: number): Array<CycleResult & {
    id: number;
    agentKey: string;
}>;
export declare function dbGetCycleResultsForAgent(agentKey: string, limit?: number): Array<CycleResult & {
    id: number;
    agentKey: string;
}>;
/** Returns closed trades for the given agent as TradeRecord[], for Bayesian + Kelly layers */
export declare function dbGetTradeRecords(agentKey: string, limit?: number): Array<{
    wonTrade: boolean;
    pnlUsd: number;
    closedAt: string;
}>;
export declare function dbGetCycleById(id: number): (CycleResult & {
    id: number;
    agentKey: string;
}) | null;
export declare function dbGetLogsForCycle(agentKey: string, cycleEndTime: string): LogEntry[];
export declare function dbGetLogClearFloor(): number;
export declare function dbSetLogClearFloor(id: number): void;
export interface SelectedAccount {
    market: 'mt5' | 'crypto';
    accountId: string;
    label?: string;
}
export declare function dbGetSelectedAccount(): SelectedAccount | null;
export declare function dbSetSelectedAccount(account: SelectedAccount | null): void;
export interface Mt5AccountRow {
    login: number;
    name: string;
    server: string;
    mode: 'DEMO' | 'LIVE';
    lastSeenAt: string;
    inBridge: boolean;
}
/** Upsert a batch of accounts currently reported by the bridge (marks them in_bridge=1). */
export declare function dbUpsertMt5Accounts(accounts: Array<{
    login: number;
    name: string;
    server: string;
    mode: 'DEMO' | 'LIVE';
}>): void;
/** Mark all accounts NOT in the given login list as no longer in bridge. */
export declare function dbMarkMt5AccountsGone(currentLogins: number[]): void;
/** Get all known MT5 accounts (bridge-live and disconnected). */
export declare function dbGetAllMt5Accounts(): Mt5AccountRow[];
export declare function dbGetMaxLogId(): number;
export declare function dbLogEvent(entry: LogEntry): void;
/** Force-flush pending log entries (call before process exit) */
export declare function dbFlushLogs(): void;
export declare function dbGetLogs(sinceId?: number, agentKey?: string, limit?: number): LogEntry[];
export declare function dbSaveMemory(agentKey: string, category: string, key: string, value: string, confidence: number, ttlHours?: number): void;
export declare function dbGetMemories(agentKey: string, category?: string, limit?: number): Array<{
    id: number;
    category: string;
    key: string;
    value: string;
    confidence: number;
    createdAt: string;
    updatedAt: string;
    expiresAt: string | null;
}>;
export declare function dbDeleteMemory(agentKey: string, category: string, key: string): void;
export declare function dbClearMemories(agentKey: string): void;
/** Wipe ALL data for an agent (memories, strategy, plans, analyses, sessions, cycles, logs).
 *  Config and the agent entry itself are NOT touched. */
export declare function dbResetAgentData(agentKey: string): {
    deleted: Record<string, number>;
};
export interface StrategyDoc {
    agentKey: string;
    name: string;
    style: string;
    bias?: string;
    timeframe?: string;
    entryRules: string;
    exitRules: string;
    filters?: string;
    maxPositions: number;
    notes?: string;
    createdAt: string;
    updatedAt: string;
}
export declare function dbSaveStrategy(s: Omit<StrategyDoc, 'createdAt' | 'updatedAt'>): void;
export declare function dbGetStrategy(agentKey: string): StrategyDoc | null;
export declare function dbDeleteStrategy(agentKey: string): void;
export interface PlanDoc {
    id: number;
    agentKey: string;
    sessionDate: string;
    sessionLabel?: string;
    marketBias: string;
    keyLevels?: string;
    riskNotes?: string;
    planText: string;
    createdAt: string;
    cycleCountAt?: number;
    active: boolean;
}
export declare function dbSavePlan(agentKey: string, plan: {
    marketBias: string;
    keyLevels?: string;
    riskNotes?: string;
    planText: string;
    sessionLabel?: string;
    cycleCountAt?: number;
}): number;
export declare function dbGetActivePlan(agentKey: string): PlanDoc | null;
export declare function dbGetAllPlans(agentKey: string, limit?: number): PlanDoc[];
export interface AgentSessionData {
    agentKey: string;
    sessionDate: string;
    tickCount: number;
    messages: Array<{
        role: 'user' | 'assistant';
        content: unknown;
    }>;
    summary: string | null;
    createdAt: string;
    updatedAt: string;
}
export declare function dbGetTodaySession(agentKey: string): AgentSessionData | null;
export declare function dbSaveSession(agentKey: string, data: {
    sessionDate: string;
    tickCount: number;
    messages: unknown[];
    summary?: string | null;
}): void;
export declare function dbDeleteSession(agentKey: string, sessionDate: string): void;
export declare function dbGetLatestMCResult(agentKey: string): {
    mc: Record<string, unknown>;
    time: string;
} | null;
export declare function dbSavePromptAnalysis(agentKey: string, analysis: unknown, meta: unknown): void;
export declare function dbGetPromptAnalysis(agentKey: string): {
    analysis: unknown;
    meta: unknown;
    createdAt: string;
} | null;
/** Returns the most recent completed session before today — used for cross-session memory. */
export declare function dbGetPreviousSession(agentKey: string): AgentSessionData | null;
/** Saves (or replaces) the latest backtest run for an agent. Clears any previous report. */
export declare function dbSaveBacktestResult(agentKey: string, result: unknown): void;
/** Attaches (or updates) the AI report on the agent's saved backtest row. */
export declare function dbUpdateBacktestReport(agentKey: string, report: unknown, model: string): void;
/** Returns the agent's saved backtest result + report, or null if none exists. */
export declare function dbGetBacktestResult(agentKey: string): {
    result: unknown;
    report: unknown | null;
    model: string | null;
    ranAt: string;
} | null;
//# sourceMappingURL=index.d.ts.map