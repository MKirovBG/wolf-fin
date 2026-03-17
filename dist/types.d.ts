export type AgentStatus = 'idle' | 'running' | 'paused';
export interface AgentConfig {
    symbol: string;
    market: 'crypto' | 'forex' | 'mt5';
    maxIterations: number;
    fetchMode: 'manual' | 'scheduled' | 'autonomous';
    scheduleIntervalSeconds: number;
    maxLossUsd: number;
    leverage?: number;
    customPrompt?: string;
    mt5AccountId?: number;
    llmProvider?: 'anthropic' | 'openrouter';
    llmModel?: string;
}
export interface AgentState {
    config: AgentConfig;
    status: AgentStatus;
    lastCycle: CycleResult | null;
    startedAt: string | null;
    cycleCount: number;
}
export interface CycleResult {
    symbol: string;
    market: 'crypto' | 'forex' | 'mt5';
    paper: boolean;
    decision: string;
    reason: string;
    time: string;
    error?: string;
    pnlUsd?: number;
    mt5AccountId?: number;
}
export type LogLevel = 'info' | 'warn' | 'error' | 'debug';
export type LogEvent = 'cycle_start' | 'cycle_end' | 'cycle_error' | 'tool_call' | 'tool_result' | 'tool_error' | 'claude_thinking' | 'decision' | 'guardrail_block' | 'session_skip' | 'cycle_skip' | 'auto_execute' | 'auto_execute_error';
export interface LogEntry {
    id: number;
    time: string;
    agentKey: string;
    level: LogLevel;
    event: LogEvent;
    message: string;
    data?: Record<string, unknown>;
}
//# sourceMappingURL=types.d.ts.map