// Wolf-Fin — shared domain types (zero internal imports)

export type AgentStatus = 'idle' | 'running' | 'paused'

export interface GuardrailsConfig {
  sessionOpenCheck: boolean   // block orders when market session is closed
  extremeSpreadCheck: boolean // block orders with abnormally wide spread ($500+/lot)
  stopPipsRequired: boolean   // MT5 orders must include stopPips field
}

export interface AgentConfig {
  name?: string                  // Agent display name — used to support multiple agents per symbol
  symbol: string
  market: 'crypto' | 'mt5'
  fetchMode: 'manual' | 'scheduled' | 'autonomous'
  scheduleIntervalSeconds: number
  leverage?: number              // Account leverage — used in agent context for position sizing
  customPrompt?: string
  promptTemplate?: string        // full system prompt with {{pill}} tokens; if empty uses default
  guardrails?: Partial<GuardrailsConfig>  // defaults: all true
  mt5AccountId?: number          // Which MT5 account this agent trades with
  llmProvider?: 'anthropic' | 'openrouter'  // defaults to 'anthropic'
  llmModel?: string              // OpenRouter model ID e.g. "openai/gpt-4o" or "anthropic/claude-opus-4-5"
  dailyTargetUsd?: number        // Daily profit target in USD — used for position sizing (default 500)
  maxRiskPercent?: number        // Max % of equity at risk per trade (default 10)
  maxDailyLossUsd?: number       // Auto-pause agent when today's realized P&L drops below -maxDailyLossUsd
  maxDrawdownPercent?: number    // Auto-pause agent when equity drops X% below session peak (e.g. 5 = 5%)
  scheduledStartUtc?: string     // HH:MM UTC — loop only runs inside this window
  scheduledEndUtc?: string       // HH:MM UTC — loop only runs inside this window
}

export interface AgentState {
  config: AgentConfig
  status: AgentStatus
  lastCycle: CycleResult | null
  startedAt: string | null
  cycleCount: number
}

export interface CycleResult {
  symbol: string
  market: 'crypto' | 'mt5'
  paper: boolean
  decision: string
  reason: string
  time: string
  error?: string
  pnlUsd?: number
  mt5AccountId?: number  // Track which MT5 account this cycle ran on
}

export type LogLevel = 'info' | 'warn' | 'error' | 'debug'
export type LogEvent =
  // Session-based tick events (current)
  | 'tick_start' | 'tick_end' | 'tick_error' | 'tick_skip'
  | 'session_start' | 'session_reset'
  // Legacy cycle events (kept for backward-compat with old DB rows)
  | 'cycle_start' | 'cycle_end' | 'cycle_error' | 'cycle_skip'
  // Tool events
  | 'tool_call' | 'tool_result' | 'tool_error'
  | 'claude_thinking' | 'llm_request' | 'decision'
  | 'guardrail_block' | 'session_skip'
  | 'auto_execute' | 'auto_execute_error'
  | 'memory_write' | 'plan_created'
  | 'pnl_record' | 'auto_plan'

export interface LogEntry {
  id: number
  time: string
  agentKey: string
  level: LogLevel
  event: LogEvent
  message: string
  data?: Record<string, unknown>
}
