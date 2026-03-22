// ── Monte Carlo Enhancement toggles (mirrored from mc-types.ts) ──────────────

export interface MCEnhancements {
  markov:     boolean  // Markov chain regime state machine
  agentBased: boolean  // Crowd positioning, stop clusters, liquidity zones
  scenarios:  boolean  // Stress-test under volatility regimes
  bayesian:   boolean  // Strategy confidence from trade history
  kelly:      boolean  // Optimal position sizing via Kelly Criterion
}

export const MC_ENHANCEMENT_DEFAULTS: MCEnhancements = {
  markov:     false,
  agentBased: false,
  scenarios:  false,
  bayesian:   false,
  kelly:      false,
}

export const MC_ENHANCEMENT_LABELS: Record<keyof MCEnhancements, { label: string; description: string }> = {
  markov:     { label: 'Markov Regime',      description: 'Detects market state (trending/ranging/volatile) and adjusts path probabilities accordingly.' },
  agentBased: { label: 'Crowd Positioning',  description: 'Estimates where retail stops are clustered and which direction the crowd is leaning.' },
  scenarios:  { label: 'Scenario Analysis',  description: 'Stress-tests the strategy under high volatility, low volatility, and pre-news conditions.' },
  bayesian:   { label: 'Bayesian Confidence', description: 'Updates strategy confidence after every trade using a statistical learning model.' },
  kelly:      { label: 'Kelly Criterion',     description: 'Computes the mathematically optimal position size given your historical edge.' },
}

export interface MCActionResult {
  winRate: number
  ev: number
  p10: number
  p50: number
  p90: number
  slHitPct: number
  medianBarsToClose: number
}

export interface MCResultData {
  long: MCActionResult
  short: MCActionResult
  recommended: 'LONG' | 'SHORT' | 'HOLD'
  edgeDelta: number
  pathCount: number
  barsForward: number
  generatedAt?: number

  // Enhanced MC fields (present when layers are enabled)
  consensus?: {
    signal:     'STRONG_LONG' | 'LEAN_LONG' | 'NEUTRAL' | 'LEAN_SHORT' | 'STRONG_SHORT' | 'AVOID'
    confidence: 'LOW' | 'MEDIUM' | 'HIGH' | 'VERY_HIGH'
    summary:    string
  }
  markov?: {
    currentState:     'TRENDING_UP' | 'TRENDING_DOWN' | 'RANGING' | 'VOLATILE'
    regimeBias:       number
    volatilityScalar: number
    nextStateProbs:   { TRENDING_UP: number; TRENDING_DOWN: number; RANGING: number; VOLATILE: number }
  }
  agentBased?: {
    crowdBias:        number
    crowdBiasLabel:   string
    contrarianSignal: 'FADE_LONGS' | 'FADE_SHORTS' | 'NO_SIGNAL'
    sentimentSource:  string
  }
  scenarios?: {
    currentRegime: string
    avoidTrading:  boolean
    avoidReason:   string | null
    worstCase:     { label: string; recommended: string; longEv: number; shortEv: number }
  }
  bayesian?: {
    posteriorMean:        number
    credibleIntervalLow:  number
    credibleIntervalHigh: number
    confidence:           'LOW' | 'MEDIUM' | 'HIGH' | 'VERY_HIGH'
    regimeShiftDetected:  boolean
    regimeShiftReason:    string | null
    totalTrades:          number
  }
  significance?: {
    observedWinRate: number
    wilsonLow:       number
    wilsonHigh:      number
    edgeLabel:       'CONFIRMED' | 'LIKELY' | 'UNCONFIRMED' | 'INSUFFICIENT_DATA'
    pValue:          number
    tradesNeeded:    number
    sampleSize:      number
  }
  kelly?: {
    recommendedKellyPct:  number
    recommendedFraction:  string
    riskAssessment:       'UNDER_BETTING' | 'OPTIMAL' | 'OVER_BETTING' | 'NO_EDGE'
    riskAssessmentReason: string
    configuredRiskPct:    number | null
  }
}

export interface AnalysisSection {
  title: string
  icon: string
  content: string
}

export interface AgentAnalysis {
  headline: string
  sections: AnalysisSection[]
}

export interface AgentAnalysisResult {
  ok: boolean
  analysis: AgentAnalysis
  meta: { provider: string; model: string }
  createdAt?: string
}

export interface AnthropicModel {
  id: string
  name: string
}

export interface PlatformLLMConfig {
  provider: 'anthropic' | 'openrouter' | 'ollama'
  model: string
}

export interface SelectedAccount {
  market: 'mt5' | 'crypto'
  accountId: string   // MT5 login as string, or 'binance' for crypto
  label?: string      // e.g. "MT5 · #1512796653 @ ICMarkets-Demo02"
}

export type AgentStatus = 'idle' | 'running' | 'paused'

export interface GuardrailsConfig {
  sessionOpenCheck: boolean
  extremeSpreadCheck: boolean
  stopPipsRequired: boolean
}

export interface IndicatorConfig {
  rsiPeriod?: number
  emaFast?: number
  emaSlow?: number
  atrPeriod?: number
  bbPeriod?: number
  bbStdDev?: number
  vwapEnabled?: boolean
  mtfEnabled?: boolean
}

export interface CandleConfig {
  timeframes?: Array<'m1' | 'm5' | 'm15' | 'm30' | 'h1' | 'h4'>
  limit?: number
}

export interface ContextConfig {
  fearGreed?: boolean
  news?: boolean
  cryptoMarket?: boolean
  economicCalendar?: boolean
  forexNews?: boolean
}

export interface AgentConfig {
  name?: string
  symbol: string
  market: 'crypto' | 'mt5'
  fetchMode: 'manual' | 'scheduled' | 'autonomous'
  leverage?: number
  customPrompt?: string
  promptTemplate?: string
  guardrails?: Partial<GuardrailsConfig>
  mt5AccountId?: number
  llmProvider?: 'anthropic' | 'openrouter' | 'ollama'
  llmModel?: string
  dailyTargetUsd?: number
  maxRiskPercent?: number
  maxDailyLossUsd?: number
  maxDrawdownPercent?: number
  scheduledStartUtc?: string
  scheduledEndUtc?: string
  indicatorConfig?: IndicatorConfig
  candleConfig?: CandleConfig
  contextConfig?: ContextConfig
  mcEnhancements?: MCEnhancements
}

export interface AgentStats {
  totalTicks: number
  totalTrades: number
  wins: number
  losses: number
  winRate: number | null
  avgWin: number | null
  avgLoss: number | null
  riskReward: number | null
  sharpe: number | null
  totalPnl: number
  equityCurve: Array<{ time: string; cumPnl: number }>
}

export interface OpenRouterModel {
  id: string
  name: string
  contextLength: number
  promptCost?: string
  completionCost?: string
}

export interface OllamaModel {
  id: string
  name: string
  size: string
  family: string
}

export interface AgentState {
  agentKey: string        // always present — injected by GET /api/agents
  config: AgentConfig
  status: AgentStatus
  lastCycle: CycleResult | null
  startedAt: string | null
  cycleCount: number
  pauseReason?: string    // set when agent auto-paused (quota error, drawdown, etc.)
}

export interface CycleResult {
  id?: number       // DB row id — present on list/detail responses
  agentKey?: string // "market:symbol" — present on list/detail responses
  symbol: string
  market: 'crypto' | 'mt5'
  paper: boolean
  decision: string
  reason: string
  time: string
  error?: string
  pnlUsd?: number
}

export interface CycleDetail {
  cycle: CycleResult & { id: number; agentKey: string }
  agent: AgentState | null
  logs: LogEntry[]
}

export interface RiskState {
  dailyPnlUsd: number
  remainingBudgetUsd: number
  positionNotionalUsd: number
}

export interface StatusResponse {
  agents: AgentState[]
  recentEvents: CycleResult[]
  risk: RiskState
}

export interface Indicators {
  rsi14: number
  ema20: number
  ema50: number
  atr14: number
  vwap: number
  bbWidth: number
}

export interface Candle {
  openTime: number
  open: number
  high: number
  low: number
  close: number
  volume: number
  closeTime: number
}

export interface Balance {
  asset: string
  free: number
  locked: number
}

export interface Order {
  orderId: number
  clientOrderId: string
  symbol: string
  side: 'BUY' | 'SELL'
  type: string
  price: number
  origQty: number
  executedQty: number
  status: string
  timeInForce: string
  time: number
  updateTime: number
  // MT5-specific (optional)
  profit?: number
  swap?: number
  sl?: number
  tp?: number
  priceCurrent?: number
}

export interface MarketSnapshot {
  symbol: string
  timestamp: number
  market: 'crypto' | 'mt5'
  price: { bid: number; ask: number; last: number }
  stats24h: { volume: number; changePercent: number; high: number; low: number }
  candles: { m1: Candle[]; m15: Candle[]; h1: Candle[]; h4: Candle[] }
  indicators: Indicators
  account: { balances: Balance[]; openOrders: Order[] }
  risk: RiskState
  forex?: {
    spread: number
    pipValue: number
    sessionOpen: boolean
    swapLong: number
    swapShort: number
  }
}

export type LogLevel = 'info' | 'warn' | 'error' | 'debug'
export type LogEvent =
  // Session-based tick events (current)
  | 'tick_start' | 'tick_end' | 'tick_error' | 'tick_skip'
  | 'session_start' | 'session_reset'
  // Legacy cycle events (backward-compat with old DB rows)
  | 'cycle_start' | 'cycle_end' | 'cycle_error' | 'cycle_skip'
  // Tool events
  | 'tool_call' | 'tool_result' | 'tool_error'
  | 'claude_thinking' | 'llm_request' | 'decision'
  | 'guardrail_block' | 'session_skip'
  | 'auto_execute' | 'auto_execute_error'
  | 'memory_write' | 'plan_created'
  | 'pnl_record'
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

export interface Fill {
  symbol: string
  id: number
  orderId: number
  price: number
  qty: number
  quoteQty: number
  commission: number
  commissionAsset: string
  time: number
  isBuyer: boolean
  isMaker: boolean
}

export interface PositionEntry extends Order {
  agentKey: string
  market: 'crypto' | 'mt5'
  paper: boolean
}

export interface FillEntry extends Fill {
  agentKey: string
  market: 'crypto' | 'mt5'
  paper: boolean
}

export interface KeysResponse {
  [key: string]: boolean
}

export interface ReportSummary {
  crypto: MarketSummary
  mt5: MarketSummary
}

// ── Accounts ─────────────────────────────────────────────────────────────────

export interface BinanceBalance {
  asset: string
  free: number
  locked: number
}

export interface BinanceOpenOrder {
  symbol: string
  side: string
  type: string
  price: number
  origQty: number
  executedQty: number
  status: string
  time: number
}

export interface BinanceAccountEntry {
  id: string
  exchange: 'binance'
  mode: 'LIVE' | 'TESTNET'
  connected: boolean
  error?: string
  balances?: BinanceBalance[]
  openOrders?: BinanceOpenOrder[]
}

export interface Mt5AccountSummary {
  balance: number
  equity: number
  margin: number
  freeMargin: number
  profit: number
  leverage: number
  login: number
  server: string
}

export interface Mt5Position {
  ticket: number
  symbol: string
  side: 'BUY' | 'SELL'
  volume: number
  priceOpen: number
  priceCurrent: number
  profit: number
  swap: number
  sl: number
  tp: number
  time: string
}

export interface Mt5AccountEntry {
  id: string
  exchange: 'mt5'
  mode: 'DEMO' | 'LIVE'
  connected: boolean
  error?: string
  summary?: Mt5AccountSummary
  positions?: Mt5Position[]
}

export type AccountEntry = BinanceAccountEntry | Mt5AccountEntry

export interface Mt5AccountInfo {
  login: number
  name: string
  server: string
  balance: number | null
  equity: number | null
  currency: string
  mode: 'LIVE' | 'DEMO'
}

export interface MarketSummary {
  totalCycles: number
  buys: number
  sells: number
  holds: number
  errors: number
  risk: RiskState
}

export interface StrategyDoc {
  agentKey: string
  name: string
  style: 'scalping' | 'swing' | 'trend' | 'mean_reversion' | 'custom'
  bias?: string
  timeframe?: string
  entryRules: string
  exitRules: string
  filters?: string
  maxPositions: number
  notes?: string
  createdAt: string
  updatedAt: string
}

export interface AgentMemory {
  id: number
  category: string
  key: string
  value: string
  confidence: number
  createdAt: string
  updatedAt: string
  expiresAt?: string
}

export interface AgentPlan {
  id: number
  agentKey: string
  sessionDate: string
  sessionLabel?: string
  marketBias: string
  keyLevels?: string
  riskNotes?: string
  planText: string
  createdAt: string
  cycleCountAt?: number
  active: boolean
}
