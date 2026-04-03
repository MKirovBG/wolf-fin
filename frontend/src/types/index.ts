// Wolf-Fin frontend types

// ── Watch symbol ──────────────────────────────────────────────────────────────

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
  keltnerEnabled?:   boolean
  divergenceEnabled?: boolean
  fibEnabled?:        boolean
  patternsEnabled?:   boolean
}

export interface CandleConfig {
  primaryTimeframe?: 'm1' | 'm5' | 'm15' | 'm30' | 'h1' | 'h4'
  limit?: number
}

export interface ContextConfig {
  economicCalendar?: boolean
  forexNews?: boolean
}

export type LLMProviderOption =
  | 'platform'
  | 'anthropic'
  | 'anthropic-subscription'
  | 'openrouter'
  | 'ollama'
  | 'openai-subscription'

export interface WatchSymbol {
  key: string
  symbol: string
  market: 'mt5'
  displayName?: string
  mt5AccountId?: number
  scheduleEnabled: boolean
  scheduleIntervalMs?: number
  scheduleStartUtc?: string
  scheduleEndUtc?: string
  indicatorConfig?: IndicatorConfig
  candleConfig?: CandleConfig
  contextConfig?: ContextConfig
  llmProvider?: LLMProviderOption
  llmModel?: string
  strategy?: string
  systemPrompt?: string
  createdAt: string
  lastAnalysisAt?: string
}

// ── Analysis ──────────────────────────────────────────────────────────────────

export interface KeyLevel {
  price:    number
  type:     'support' | 'resistance' | 'pivot'
  strength: 'strong' | 'moderate' | 'weak'
  label:    string
}

export interface TradeProposal {
  direction:     'BUY' | 'SELL' | null
  entryZone:     { low: number; high: number }
  stopLoss:      number
  takeProfits:   number[]
  riskReward:    number
  reasoning:     string
  confidence:    'high' | 'medium' | 'low'
  invalidatedIf?: string
}

export interface CandleBar {
  time:   number  // Unix seconds (TradingView format)
  open:   number
  high:   number
  low:    number
  close:  number
  volume: number
}

export interface AnalysisContext {
  news?: Array<{ headline: string; sentiment: string; url?: string }>
  calendar?: Array<{ time: string; event: string; impact: string; country: string }>
  currentPrice?: { bid: number; ask: number; mid: number; spread: number }
  symbolInfo?: { point: number; digits: number; volumeMin: number; volumeStep: number }
  session?: {
    activeSessions: string[]
    isLondonNYOverlap: boolean
    isOptimalSession: boolean
    note: string
  }
}

export interface CandlePattern {
  name:        string
  direction:   'bullish' | 'bearish' | 'neutral'
  price:       number
  barIndex:    number
  description: string
}

export interface ProposalValidation {
  score: number
  flags: string[]
  valid: boolean
}

export interface AnalysisResult {
  id:            number
  symbolKey:     string
  symbol:        string
  market:        'mt5'
  timeframe:     string
  time:          string
  bias:          'bullish' | 'bearish' | 'neutral'
  summary:       string
  keyLevels:     KeyLevel[]
  tradeProposal: TradeProposal | null
  indicators:    Record<string, number | string>
  candles:       CandleBar[]
  context:       AnalysisContext
  patterns?:     CandlePattern[]
  validation?:   ProposalValidation
  llmProvider:   string
  llmModel:      string
  error?:        string
  rawResponse?:  string
  llmThinking?:  string
}

// ── Outcomes ──────────────────────────────────────────────────────────────────

export type OutcomeStatus = 'pending' | 'entered' | 'hit_tp1' | 'hit_tp2' | 'hit_sl' | 'expired' | 'invalidated'

export interface ProposalOutcome {
  id:          number
  analysisId:  number
  symbolKey:   string
  direction:   'BUY' | 'SELL'
  entryLow:    number
  entryHigh:   number
  sl:          number
  tp1:         number | null
  tp2:         number | null
  tp3:         number | null
  status:      OutcomeStatus
  createdAt:   string
  enteredAt:   string | null
  resolvedAt:  string | null
  exitPrice:   number | null
  pipsResult:  number | null
}

export interface OutcomeStats {
  total:   number
  entered: number
  hitTp1:  number
  hitTp2:  number
  hitSl:   number
  expired: number
  winRate: number
}

// ── Symbol summary (dashboard) ────────────────────────────────────────────────

export interface SymbolSummary {
  key:             string
  symbol:          string
  displayName?:    string
  scheduleEnabled: boolean
  scheduled:       boolean
  running:         boolean
  lastAnalysisAt:  string | null
  bias:            'bullish' | 'bearish' | 'neutral' | null
  summary:         string | null
  error:           string | null
  direction:       'BUY' | 'SELL' | null
  confidence:      'high' | 'medium' | 'low' | null
  riskReward:      number | null
  validationScore: number | null
}

// ── Accounts ──────────────────────────────────────────────────────────────────

export interface Mt5Position {
  ticket:       number
  symbol:       string
  side:         'BUY' | 'SELL'
  volume:       number
  priceOpen:    number
  priceCurrent: number
  profit:       number
  swap:         number
  sl:           number | null
  tp:           number | null
  comment:      string
  time:         string
}

export interface AccountEntry {
  id:        string
  exchange:  'mt5'
  mode:      'DEMO' | 'LIVE'
  connected: boolean
  label?:    string
  error?:    string
  summary?:  {
    login:      number
    name?:      string
    server?:    string
    balance?:   number
    equity?:    number
    freeMargin?: number
    leverage?:  number
    currency?:  string
  }
}

export interface Mt5AccountInfo {
  login:    number
  name:     string
  server:   string
  mode:     string
  active:   boolean
  inBridge: boolean
}

export interface SelectedAccount {
  market:    string
  accountId: string
  label?:    string
}

// ── LLM providers ─────────────────────────────────────────────────────────────

export interface PlatformLLMConfig {
  provider: string
  model:    string
}

export interface AnthropicModel { id: string; name: string }
export interface OpenRouterModel { id: string; name: string }
export interface OllamaModel { id: string; name: string }

// ── Logs ──────────────────────────────────────────────────────────────────────

export type LogLevel = 'info' | 'warn' | 'error' | 'debug'

export interface LogEntry {
  id:        number
  time:      string
  symbolKey: string
  level:     LogLevel
  event:     string
  message:   string
  data?:     Record<string, unknown>
}

// ── Dashboard status ──────────────────────────────────────────────────────────

export interface StatusResponse {
  symbols:         WatchSymbol[]
  recentAnalyses:  AnalysisResult[]
  scheduled:       string[]
}

// ── Strategies ────────────────────────────────────────────────────────────────

export interface Strategy {
  id:           number
  key:          string
  name:         string
  description:  string | null
  instructions: string
  isBuiltin:    boolean
  createdAt:    string
}

// ── App config ───────────────────────────────────────────────────────────────

export interface AppConfig {
  bridgePort:   string
  bridgeUrl:    string
  bridgeKeySet: boolean
  logLevel:     string
}

// ── Calendar ──────────────────────────────────────────────────────────────────

export interface EconomicEvent {
  name:      string
  country:   string
  impact:    string
  time:      number
  forecast?: string
  previous?: string
  actual?:   string | null
}
