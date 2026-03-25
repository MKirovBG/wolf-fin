import type { MCEnhancements } from './adapters/mc-types.js';
export type AgentStatus = 'idle' | 'running' | 'paused';
export interface GuardrailsConfig {
    sessionOpenCheck: boolean;
    extremeSpreadCheck: boolean;
    stopPipsRequired: boolean;
}
export interface IndicatorConfig {
    rsiPeriod?: number;
    emaFast?: number;
    emaSlow?: number;
    atrPeriod?: number;
    bbPeriod?: number;
    bbStdDev?: number;
    vwapEnabled?: boolean;
    mtfEnabled?: boolean;
    macdEnabled?: boolean;
    adxEnabled?: boolean;
    stochEnabled?: boolean;
}
export interface CandleConfig {
    timeframes?: Array<'m1' | 'm5' | 'm15' | 'm30' | 'h1' | 'h4'>;
    limit?: number;
}
export interface ContextConfig {
    fearGreed?: boolean;
    news?: boolean;
    cryptoMarket?: boolean;
    economicCalendar?: boolean;
    forexNews?: boolean;
}
export interface AgentConfig {
    name?: string;
    symbol: string;
    market: 'crypto' | 'mt5';
    fetchMode: 'manual' | 'scheduled' | 'autonomous';
    leverage?: number;
    customPrompt?: string;
    promptTemplate?: string;
    guardrails?: Partial<GuardrailsConfig>;
    mt5AccountId?: number;
    llmProvider?: 'platform' | 'anthropic' | 'anthropic-subscription' | 'openrouter' | 'ollama';
    llmModel?: string;
    dailyTargetUsd?: number;
    maxRiskPercent?: number;
    maxDailyLossUsd?: number;
    maxDrawdownPercent?: number;
    scheduledStartUtc?: string;
    scheduledEndUtc?: string;
    indicatorConfig?: IndicatorConfig;
    candleConfig?: CandleConfig;
    contextConfig?: ContextConfig;
    mcEnhancements?: MCEnhancements;
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
export type LogEvent = 'tick_start' | 'tick_end' | 'tick_error' | 'tick_skip' | 'session_start' | 'session_reset' | 'cycle_start' | 'cycle_end' | 'cycle_error' | 'cycle_skip' | 'tool_call' | 'tool_result' | 'tool_error' | 'claude_thinking' | 'llm_request' | 'decision' | 'guardrail_block' | 'session_skip' | 'auto_execute' | 'auto_execute_error' | 'memory_write' | 'plan_created' | 'pnl_record' | 'auto_plan' | 'quota_error' | 'mc_result';
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