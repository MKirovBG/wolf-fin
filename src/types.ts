// Wolf-Fin — shared domain types (zero internal imports)

import type { MCEnhancements } from './adapters/mc-types.js'

export type AgentStatus = 'idle' | 'running' | 'paused'

export interface GuardrailsConfig {
  sessionOpenCheck: boolean   // block orders when market session is closed
  extremeSpreadCheck: boolean // block orders with abnormally wide spread ($500+/lot)
  stopPipsRequired: boolean   // MT5 orders must include stopPips field
}

export interface IndicatorConfig {
  rsiPeriod?: number             // RSI period (default 14)
  emaFast?: number               // Fast EMA period (default 20)
  emaSlow?: number               // Slow EMA period (default 50)
  atrPeriod?: number             // ATR period (default 14)
  bbPeriod?: number              // Bollinger Bands period (default 20)
  bbStdDev?: number              // Bollinger Bands std deviation multiplier (default 2)
  vwapEnabled?: boolean          // Include VWAP (default true)
  mtfEnabled?: boolean           // Enable multi-timeframe indicators (default true)
  macdEnabled?: boolean          // MACD 12/26/9 (default false)
  adxEnabled?: boolean           // ADX 14 (default false)
  stochEnabled?: boolean         // Stochastic 14/3 (default false)
  psarEnabled?: boolean          // Parabolic SAR (default false)
  ichimokuEnabled?: boolean      // Ichimoku Cloud 9/26/52 (default false)
  cciEnabled?: boolean           // CCI 20 (default false)
  williamsREnabled?: boolean     // Williams %R 14 (default false)
  obvEnabled?: boolean           // On Balance Volume (default false)
  mfiEnabled?: boolean           // Money Flow Index 14 (default false)
  keltnerEnabled?: boolean       // Keltner Channel 20 (default false)
}

export interface CandleConfig {
  timeframes?: Array<'m1' | 'm5' | 'm15' | 'm30' | 'h1' | 'h4'>  // which timeframes to fetch (default all)
  limit?: number                 // candles per timeframe (default 100)
}

export interface ContextConfig {
  fearGreed?: boolean            // crypto: Fear & Greed index (default true)
  news?: boolean                 // crypto: CryptoPanic headlines (default true)
  cryptoMarket?: boolean         // crypto: BTC dominance / total market cap (default true)
  economicCalendar?: boolean     // both: upcoming high-impact events (default true)
  forexNews?: boolean            // mt5: Finnhub forex news with sentiment (default true)
}

export interface AgentConfig {
  name?: string                  // Agent display name — used to support multiple agents per symbol
  symbol: string
  market: 'crypto' | 'mt5'
  fetchMode: 'manual' | 'scheduled' | 'autonomous'
  leverage?: number              // Account leverage — used in agent context for position sizing
  customPrompt?: string
  promptTemplate?: string        // full system prompt with {{pill}} tokens; if empty uses default
  guardrails?: Partial<GuardrailsConfig>  // defaults: all true
  mt5AccountId?: number          // Which MT5 account this agent trades with
  llmProvider?: 'platform' | 'anthropic' | 'anthropic-subscription' | 'openrouter' | 'ollama' | 'openai-subscription'  // 'platform' = inherit platform LLM config
  llmModel?: string              // Model ID e.g. "openai/gpt-4o", "anthropic/claude-opus-4-5", "llama3.1:latest"
  dailyTargetUsd?: number        // Daily profit target in USD — used for position sizing (default 500)
  maxRiskPercent?: number        // Max % of equity at risk per trade (default 10)
  maxDailyLossUsd?: number       // Auto-pause agent when today's realized P&L drops below -maxDailyLossUsd
  maxDrawdownPercent?: number    // Auto-pause agent when equity drops X% below session peak (e.g. 5 = 5%)
  scheduledStartUtc?: string     // HH:MM UTC — loop only runs inside this window
  scheduledEndUtc?: string       // HH:MM UTC — loop only runs inside this window
  indicatorConfig?: IndicatorConfig    // Technical indicator parameters
  candleConfig?: CandleConfig          // Candle fetch configuration
  contextConfig?: ContextConfig        // Market enrichment context toggles
  mcEnhancements?: MCEnhancements      // Enhanced Monte Carlo layer toggles
}

export interface AgentState {
  config: AgentConfig
  status: AgentStatus
  lastCycle: CycleResult | null
  startedAt: string | null
  cycleCount: number
  pauseReason?: string   // set when agent is auto-paused (e.g. quota error, drawdown)
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
  | 'quota_error'
  | 'mc_result'

export interface LogEntry {
  id: number
  time: string
  agentKey: string
  level: LogLevel
  event: LogEvent
  message: string
  data?: Record<string, unknown>
}
