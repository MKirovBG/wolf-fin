export type AgentStatus = 'idle' | 'running' | 'paused';
export interface GuardrailsConfig {
    sessionOpenCheck: boolean;
    extremeSpreadCheck: boolean;
    stopPipsRequired: boolean;
}
export interface AgentConfig {
    name?: string;
    symbol: string;
    market: 'crypto' | 'mt5';
    fetchMode: 'manual' | 'scheduled' | 'autonomous';
    scheduleIntervalSeconds: number;
    leverage?: number;
    customPrompt?: string;
    promptTemplate?: string;
    guardrails?: Partial<GuardrailsConfig>;
    mt5AccountId?: number;
    llmProvider?: 'anthropic' | 'openrouter' | 'ollama';
    llmModel?: string;
    dailyTargetUsd?: number;
    maxRiskPercent?: number;
    maxDailyLossUsd?: number;
    maxDrawdownPercent?: number;
    scheduledStartUtc?: string;
    scheduledEndUtc?: string;
}
export interface AgentState {
    config: AgentConfig;
    status: AgentStatus;
    lastCycle: CycleResult | null;
    startedAt: string | null;
    cycleCount: number;
    pauseReason?: string;
}
export interface CycleResult {
    symbol: string;
    market: 'crypto' | 'mt5';
    paper: boolean;
    decision: string;
    reason: string;
    time: string;
    error?: string;
    pnlUsd?: number;
    mt5AccountId?: number;
}
export type LogLevel = 'info' | 'warn' | 'error' | 'debug';
export type LogEvent = 'tick_start' | 'tick_end' | 'tick_error' | 'tick_skip' | 'session_start' | 'session_reset' | 'cycle_start' | 'cycle_end' | 'cycle_error' | 'cycle_skip' | 'tool_call' | 'tool_result' | 'tool_error' | 'claude_thinking' | 'llm_request' | 'decision' | 'guardrail_block' | 'session_skip' | 'auto_execute' | 'auto_execute_error' | 'memory_write' | 'plan_created' | 'pnl_record' | 'auto_plan' | 'quota_error';
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