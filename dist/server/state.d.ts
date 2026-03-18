import type { AgentState, AgentStatus, CycleResult } from '../types.js';
export type { CycleResult } from '../types.js';
import type { LogEntry, LogLevel, LogEvent } from '../types.js';
export declare function tryAcquireCycleLock(agentKey: string): boolean;
export declare function releaseCycleLock(agentKey: string): void;
type LogSubscriber = (entry: LogEntry) => void;
export declare function subscribeToLogs(cb: LogSubscriber): () => void;
export interface AgentStatusEvent {
    type: 'agent_update';
    agentKey: string;
    agent: AgentState;
}
type AgentStatusSubscriber = (event: AgentStatusEvent) => void;
export declare function subscribeToAgentStatus(cb: AgentStatusSubscriber): () => void;
export declare function logEvent(agentKey: string, level: LogLevel, event: LogEvent, message: string, data?: Record<string, unknown>): void;
export declare function getLogs(sinceId?: number, agentKey?: string, limit?: number): LogEntry[];
interface AppState {
    agents: Record<string, AgentState>;
    recentEvents: CycleResult[];
}
export declare function getState(): Readonly<AppState>;
export declare function getAgent(key: string): AgentState | undefined;
export declare function upsertAgent(agent: AgentState): void;
export declare function removeAgent(key: string): void;
export declare function setAgentStatus(key: string, status: AgentStatus): void;
export declare function recordCycle(key: string, result: CycleResult): void;
//# sourceMappingURL=state.d.ts.map