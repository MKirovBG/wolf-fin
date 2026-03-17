// Wolf-Fin — shared domain types (zero internal imports)

export type AgentStatus = 'idle' | 'running' | 'paused'

export interface AgentConfig {
  symbol: string
  market: 'crypto' | 'forex' | 'mt5'
  paper: boolean
  maxIterations: number
  fetchMode: 'manual' | 'scheduled' | 'autonomous'
  scheduleIntervalSeconds: number
  maxLossUsd: number
  maxPositionUsd: number
  customPrompt?: string
  mt5AccountId?: number          // Which MT5 account this agent trades with
  llmProvider?: 'anthropic' | 'openrouter'  // defaults to 'anthropic'
  llmModel?: string              // OpenRouter model ID e.g. "openai/gpt-4o" or "anthropic/claude-opus-4-5"
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
  market: 'crypto' | 'forex' | 'mt5'
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
  | 'cycle_start' | 'cycle_end' | 'cycle_error'
  | 'tool_call' | 'tool_result' | 'tool_error'
  | 'claude_thinking' | 'decision'
  | 'guardrail_block' | 'session_skip' | 'cycle_skip'
  | 'auto_execute' | 'auto_execute_error'

export interface LogEntry {
  id: number
  time: string
  agentKey: string
  level: LogLevel
  event: LogEvent
  message: string
  data?: Record<string, unknown>
}
