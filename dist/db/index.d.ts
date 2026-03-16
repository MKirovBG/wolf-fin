import type { AgentState, AgentStatus, CycleResult, LogEntry } from '../types.js';
export declare function initDb(): void;
export declare function dbGetAllAgents(): AgentState[];
export declare function dbUpsertAgent(agent: AgentState): void;
export declare function dbRemoveAgent(key: string): void;
export declare function dbUpdateAgentStatus(key: string, status: AgentStatus, startedAt: string | null): void;
export declare function dbRecordCycle(key: string, result: CycleResult): void;
export declare function dbGetTodayRealizedPnl(market: 'crypto' | 'forex' | 'mt5', dateStr: string): number;
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
export declare function dbGetCycleResults(market?: string, limit?: number): CycleResult[];
export declare function dbGetLogClearFloor(): number;
export declare function dbSetLogClearFloor(id: number): void;
export declare function dbGetMaxLogId(): number;
export declare function dbLogEvent(entry: LogEntry): void;
export declare function dbGetLogs(sinceId?: number, agentKey?: string, limit?: number): LogEntry[];
//# sourceMappingURL=index.d.ts.map