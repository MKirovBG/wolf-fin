// Wolf-Fin — shared domain types (zero internal imports)

// ── Indicator configuration ───────────────────────────────────────────────────

export interface IndicatorConfig {
  rsiEnabled?: boolean
  rsiPeriod?: number
  emaFast?: number
  emaSlow?: number
  atrPeriod?: number
  bbPeriod?: number
  bbStdDev?: number
  atrEnabled?: boolean
  emaFastEnabled?: boolean
  emaSlowEnabled?: boolean
  bbEnabled?: boolean
  vwapEnabled?: boolean
  mtfEnabled?: boolean
  macdEnabled?: boolean
  adxEnabled?: boolean
  stochEnabled?: boolean
  psarEnabled?: boolean
  ichimokuEnabled?: boolean
  cciEnabled?: boolean
  williamsREnabled?: boolean
  obvEnabled?: boolean
  mfiEnabled?: boolean
  keltnerEnabled?: boolean
  divergenceEnabled?: boolean   // RSI + MACD divergence detection
  fibEnabled?: boolean          // Fibonacci retracement levels
  patternsEnabled?: boolean     // Candlestick pattern detection
}

export interface CandleConfig {
  primaryTimeframe?: 'm1' | 'm5' | 'm15' | 'm30' | 'h1' | 'h4'  // timeframe used for analysis (default h1)
  limit?: number                                                    // candles per timeframe (default 100)
}

export interface ContextConfig {
  economicCalendar?: boolean   // upcoming high-impact events (default true)
  forexNews?: boolean          // Finnhub forex news with sentiment (default true)
}

// ── Watch symbol ──────────────────────────────────────────────────────────────

export interface WatchSymbol {
  key: string                  // 'mt5:XAUUSD' or 'mt5:XAUUSD:12345' — unique ID
  symbol: string               // e.g. 'XAUUSD'
  market: 'mt5'
  displayName?: string
  mt5AccountId?: number
  scheduleEnabled: boolean
  scheduleIntervalMs?: number  // ms between auto-analyses (undefined = manual only)
  scheduleStartUtc?: string    // HH:MM UTC window start
  scheduleEndUtc?: string      // HH:MM UTC window end
  indicatorConfig?: IndicatorConfig
  candleConfig?: CandleConfig
  contextConfig?: ContextConfig
  llmProvider?: 'platform' | 'anthropic' | 'anthropic-subscription' | 'openrouter' | 'ollama' | 'openai-subscription'
  llmModel?: string
  strategy?: string        // preset strategy id (price_action, ict, trend, swing, scalping, smc) or '' for default
  systemPrompt?: string    // custom system prompt — overrides strategy if set
  createdAt: string
  lastAnalysisAt?: string
}

// ── Analysis result ───────────────────────────────────────────────────────────

export interface KeyLevel {
  price: number
  type: 'support' | 'resistance' | 'pivot'
  strength: 'strong' | 'moderate' | 'weak'
  label: string
}

export interface TradeProposal {
  direction: 'BUY' | 'SELL' | null
  entryZone: { low: number; high: number }
  stopLoss: number
  takeProfits: number[]
  riskReward: number
  reasoning: string
  confidence: 'high' | 'medium' | 'low'
  invalidatedIf?: string
}

export interface AnalysisResult {
  id: number
  symbolKey: string
  symbol: string
  market: 'mt5'
  timeframe: string
  time: string
  bias: 'bullish' | 'bearish' | 'neutral'
  summary: string
  keyLevels: KeyLevel[]
  tradeProposal: TradeProposal | null
  indicators: Record<string, number | string>
  candles: CandleBar[]
  context: AnalysisContext
  llmProvider: string
  llmModel: string
  patterns?: CandlePattern[]           // detected candlestick patterns
  validation?: ProposalValidation      // post-analysis proposal quality score
  error?: string
  rawResponse?: string    // full LLM text response
  llmThinking?: string    // extended thinking block (Claude only)
}

export interface AnalysisContext {
  news?: Array<{ headline: string; sentiment: string; url?: string }>
  calendar?: Array<{ time: string; event: string; impact: string; country: string }>
  currentPrice?: { bid: number; ask: number; spread: number }
  symbolInfo?: { point: number; digits: number; volumeMin: number; volumeStep: number }
  session?: {
    activeSessions: string[]
    isLondonNYOverlap: boolean
    isOptimalSession: boolean
    note: string
  }
}

// ── Candlestick patterns ──────────────────────────────────────────────────────

export interface CandlePattern {
  name: string
  direction: 'bullish' | 'bearish' | 'neutral'
  price: number       // reference price (close of signal candle)
  barIndex: number    // index within the candle slice (0 = oldest)
  description: string
}

// ── Proposal validation ───────────────────────────────────────────────────────

export interface ProposalValidation {
  score: number        // 0–100
  flags: string[]      // explanatory notes (positive and negative)
  valid: boolean       // score >= 50
}

// ── Candle ────────────────────────────────────────────────────────────────────

export interface CandleBar {
  time: number    // Unix timestamp (seconds)
  open: number
  high: number
  low: number
  close: number
  volume: number
}

// ── Logs ──────────────────────────────────────────────────────────────────────

export type LogLevel = 'info' | 'warn' | 'error' | 'debug'
export type LogEvent =
  | 'analysis_start' | 'analysis_end' | 'analysis_error' | 'analysis_skip'
  | 'schedule_start' | 'schedule_stop' | 'schedule_tick'
  | 'llm_request' | 'llm_response'
  | 'symbol_added' | 'symbol_removed'
  | 'features_computed'

export interface LogEntry {
  id: number
  time: string
  symbolKey: string
  level: LogLevel
  event: LogEvent
  message: string
  data?: Record<string, unknown>
}
