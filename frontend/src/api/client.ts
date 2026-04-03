import type {
  StatusResponse, WatchSymbol, AnalysisResult, AccountEntry, Mt5AccountInfo,
  SelectedAccount, PlatformLLMConfig, AnthropicModel, OpenRouterModel, OllamaModel,
  LogEntry, EconomicEvent, Mt5Position, AppConfig, Strategy,
  SymbolSummary, ProposalOutcome, OutcomeStats,
  MarketState, SetupCandidate, AlertRule, AlertFiring,
  BacktestRun, StrategyVersion, DeepHealth, SymbolStrategy, AnalysisFeedback,
  AgentMemory, AgentRule, AgentState,
} from '../types/index.ts'

async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(path, options)
  if (!res.ok) throw new Error(`${options?.method ?? 'GET'} ${path} → ${res.status}`)
  return res.json() as Promise<T>
}

function json(body: unknown): RequestInit {
  return { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
}

// ── Status ────────────────────────────────────────────────────────────────────
export const getStatus = () => api<StatusResponse>('/api/status')

// ── Watch symbols ─────────────────────────────────────────────────────────────
export const getSymbols     = () => api<WatchSymbol[]>('/api/symbols')
export const getSymbol      = (key: string) => api<WatchSymbol>(`/api/symbols/${encodeURIComponent(key)}`)
export const addSymbol      = (sym: Partial<WatchSymbol> & { symbol: string }) =>
  api<{ ok: boolean; key: string }>('/api/symbols', { method: 'POST', ...json(sym) })
export const updateSymbol   = (key: string, patch: Partial<WatchSymbol>) =>
  api<{ ok: boolean }>(`/api/symbols/${encodeURIComponent(key)}`, { method: 'PATCH', ...json(patch) })
export const deleteSymbol   = (key: string) =>
  api<{ ok: boolean }>(`/api/symbols/${encodeURIComponent(key)}`, { method: 'DELETE' })

// ── Analysis ──────────────────────────────────────────────────────────────────
export const triggerAnalysis  = (key: string) =>
  api<{ ok: boolean; message: string }>(`/api/symbols/${encodeURIComponent(key)}/analyze`, { method: 'POST' })
export const getAnalyses      = (key: string, limit?: number) =>
  api<AnalysisResult[]>(`/api/symbols/${encodeURIComponent(key)}/analyses${limit ? `?limit=${limit}` : ''}`)
export const getLatestAnalysis = (key: string) =>
  api<AnalysisResult>(`/api/symbols/${encodeURIComponent(key)}/analyses/latest`)
export const getAllAnalyses    = (limit?: number) =>
  api<AnalysisResult[]>(`/api/analyses${limit ? `?limit=${limit}` : ''}`)
export const getAnalysisById  = (id: number) =>
  api<AnalysisResult>(`/api/analyses/${id}`)
export const isRunning        = (key: string) =>
  api<{ running: boolean }>(`/api/symbols/${encodeURIComponent(key)}/running`)

// ── Analysis feedback ────────────────────────────────────────────────────────
export const submitFeedback = (analysisId: number, rating: number | null, comment: string | null) =>
  api<{ ok: boolean; id: number }>(`/api/analyses/${analysisId}/feedback`, { method: 'POST', ...json({ rating, comment }) })
export const getFeedback = (analysisId: number) =>
  api<AnalysisFeedback[]>(`/api/analyses/${analysisId}/feedback`)

// ── Accounts ──────────────────────────────────────────────────────────────────
export const getAccounts    = () => api<AccountEntry[]>('/api/accounts')
export const getMt5Accounts = () => api<Mt5AccountInfo[]>('/api/mt5-accounts')
export const getPositions   = (accountId: string) =>
  api<Mt5Position[]>(`/api/accounts/${encodeURIComponent(accountId)}/positions`)

// ── Symbol search (MT5 bridge) ────────────────────────────────────────────────
export const searchSymbols = (q: string, accountId?: number) => {
  const params = new URLSearchParams({ q })
  if (accountId) params.set('accountId', String(accountId))
  return api<Array<{ symbol: string; description: string }>>(`/api/symbols/search?${params}`)
}

// ── Logs ──────────────────────────────────────────────────────────────────────
export const getLogs = (sinceId?: number, symbolKey?: string, limit?: number) => {
  const p = new URLSearchParams()
  if (sinceId != null) p.set('sinceId', String(sinceId))
  if (symbolKey) p.set('symbolKey', symbolKey)
  if (limit) p.set('limit', String(limit))
  const qs = p.toString()
  return api<LogEntry[]>(`/api/logs${qs ? `?${qs}` : ''}`)
}

// ── LLM / Keys ────────────────────────────────────────────────────────────────
export const getKeys      = () => api<Record<string, unknown>>('/api/keys')
export const saveKeys     = (keys: Record<string, string>) =>
  api<{ ok: boolean }>('/api/keys', { method: 'POST', ...json(keys) })
export const testConn     = (service: string) =>
  api<{ ok: boolean; message: string }>('/api/test-connection', { method: 'POST', ...json({ service }) })

export const getPlatformLLM = () => api<PlatformLLMConfig>('/api/platform-llm')
export const setPlatformLLM = (cfg: PlatformLLMConfig) =>
  api<{ ok: boolean }>('/api/platform-llm', { method: 'POST', ...json(cfg) })

export const getAnthropicModels  = () => api<AnthropicModel[]>('/api/anthropic/models')
export const getOpenRouterModels = () => api<OpenRouterModel[]>('/api/openrouter/models')
export const getOllamaModels     = () => api<OllamaModel[]>('/api/ollama/models')

// ── Claude auth ───────────────────────────────────────────────────────────────
export const importClaudeCLI    = () =>
  api<{ ok: boolean; subscriptionType?: string }>('/api/auth/claude/import-from-cli', { method: 'POST' })
export const startClaudeAuth    = () =>
  api<{ url: string; state: string }>('/api/auth/claude/start')
export const exchangeClaudeCode = (code: string, state: string) =>
  api<{ ok: boolean }>('/api/auth/claude/exchange', { method: 'POST', ...json({ code, state }) })

// ── OpenAI auth ───────────────────────────────────────────────────────────────
export const startOpenAIAuth    = () =>
  api<{ url: string; state: string }>('/api/auth/openai/start')
export const exchangeOpenAICode = (code: string, state: string) =>
  api<{ ok: boolean }>('/api/auth/openai/exchange', { method: 'POST', ...json({ code, state }) })
export const refreshOpenAIToken = () =>
  api<{ ok: boolean }>('/api/auth/openai/refresh', { method: 'POST' })

// ── App config ────────────────────────────────────────────────────────────────
export const getConfig  = () => api<AppConfig>('/api/config')
export const saveConfig = (cfg: Partial<AppConfig & { bridgeKey: string }>) =>
  api<{ ok: boolean }>('/api/config', { method: 'POST', ...json(cfg) })

// ── Live candles (MT5 bridge proxy) ──────────────────────────────────────────
import type { CandleBar } from '../types/index.ts'
export const getLiveCandles = (key: string, timeframe?: string, count?: number) => {
  const p = new URLSearchParams()
  if (timeframe) p.set('timeframe', timeframe)
  if (count)     p.set('count', String(count))
  return api<CandleBar[]>(`/api/symbols/${encodeURIComponent(key)}/candles?${p}`)
}

// ── Strategies ────────────────────────────────────────────────────────────────
export const getStrategies    = () => api<Strategy[]>('/api/strategies')
export const createStrategy   = (s: { key: string; name: string; description?: string; instructions: string }) =>
  api<{ ok: boolean }>('/api/strategies', { method: 'POST', ...json(s) })
export const updateStrategy   = (key: string, patch: { name?: string; description?: string; instructions?: string }) =>
  api<{ ok: boolean }>(`/api/strategies/${encodeURIComponent(key)}`, { method: 'PATCH', ...json(patch) })
export const deleteStrategy   = (key: string) =>
  api<{ ok: boolean }>(`/api/strategies/${encodeURIComponent(key)}`, { method: 'DELETE' })

// ── Symbol strategies (multi-strategy assignment) ────────────────────────────
export const getAllSymbolStrategies = () => api<SymbolStrategy[]>('/api/symbol-strategies')
export const getSymbolStrategies = (key: string) =>
  api<SymbolStrategy[]>(`/api/symbols/${encodeURIComponent(key)}/strategies`)
export const addSymbolStrategy   = (key: string, strategyKey: string) =>
  api<{ ok: boolean }>(`/api/symbols/${encodeURIComponent(key)}/strategies`, { method: 'POST', ...json({ strategyKey }) })
export const removeSymbolStrategy = (key: string, strategyKey: string) =>
  api<{ ok: boolean }>(`/api/symbols/${encodeURIComponent(key)}/strategies/${encodeURIComponent(strategyKey)}`, { method: 'DELETE' })
export const toggleSymbolStrategy = (key: string, strategyKey: string, enabled: boolean) =>
  api<{ ok: boolean }>(`/api/symbols/${encodeURIComponent(key)}/strategies/${encodeURIComponent(strategyKey)}`, { method: 'PATCH', ...json({ enabled }) })

// ── Symbol summary (dashboard heatmap) ───────────────────────────────────────
export const getSummary = () => api<SymbolSummary[]>('/api/summary')

// ── Outcomes ──────────────────────────────────────────────────────────────────
export const getOutcomes      = (symbolKey?: string, limit?: number) => {
  const p = new URLSearchParams()
  if (symbolKey) p.set('symbolKey', symbolKey)
  if (limit)     p.set('limit', String(limit))
  return api<ProposalOutcome[]>(`/api/outcomes?${p}`)
}
export const getOutcomeStats  = (symbolKey?: string) => {
  const p = symbolKey ? `?symbolKey=${encodeURIComponent(symbolKey)}` : ''
  return api<OutcomeStats>(`/api/outcomes/stats${p}`)
}

// ── Calendar ──────────────────────────────────────────────────────────────────
export const getCalendar = () => api<EconomicEvent[]>('/api/calendar')

// ── Selected account (persisted) ─────────────────────────────────────────────
export const getSelectedAccount = () => api<SelectedAccount | null>('/api/selected-account').catch(() => null)
export const setSelectedAccount = (account: SelectedAccount | null) =>
  api<{ ok: boolean }>('/api/selected-account', { method: 'POST', ...json(account) })

// ── Phase 2: Feature + market state ──────────────────────────────────────────
export const getLatestMarketState = (key: string) =>
  api<MarketState>(`/api/symbols/${encodeURIComponent(key)}/state/latest`)
export const getLatestSetups = (key: string) =>
  api<SetupCandidate[]>(`/api/symbols/${encodeURIComponent(key)}/setups/latest`)

// ── Phase 3: Strategy versions ────────────────────────────────────────────────
export const getStrategyVersions = (key: string) =>
  api<StrategyVersion[]>(`/api/strategies/${encodeURIComponent(key)}/versions`)

// ── Phase 4: Backtests ────────────────────────────────────────────────────────
export const createBacktest = (body: { symbolKey: string; strategyKey?: string; timeframe?: string; count?: number }) =>
  api<{ ok: boolean; runId: number }>('/api/backtests', { method: 'POST', ...json(body) })
export const getBacktestRun = (id: number) =>
  api<BacktestRun>(`/api/backtests/${id}`)

// ── Phase 5: Research ─────────────────────────────────────────────────────────
export const getResearchLeaderboard = (symbolKey?: string) => {
  const p = symbolKey ? `?symbolKey=${encodeURIComponent(symbolKey)}` : ''
  return api<{ byDetector: unknown[]; bySession: unknown[]; byRegime: unknown[] }>(`/api/research/leaderboard${p}`)
}
export const getSimilarAnalyses = (analysisId: number) =>
  api<Array<{ analysisId: number; symbolKey: string; capturedAt: string; distance: number }>>(`/api/research/similar/${analysisId}`)

// ── Phase 5: Alerts ───────────────────────────────────────────────────────────
export const getAlerts = (symbolKey?: string) => {
  const p = symbolKey ? `?symbolKey=${encodeURIComponent(symbolKey)}` : ''
  return api<AlertRule[]>(`/api/alerts${p}`)
}
export const createAlert = (rule: {
  symbolKey: string; name: string
  conditionType: string; conditionValue: string; enabled?: boolean
}) => api<{ ok: boolean; id: number }>('/api/alerts', { method: 'POST', ...json(rule) })
export const toggleAlert = (id: number, enabled: boolean) =>
  api<{ ok: boolean }>(`/api/alerts/${id}`, { method: 'PATCH', ...json({ enabled }) })
export const deleteAlert = (id: number) =>
  api<{ ok: boolean }>(`/api/alerts/${id}`, { method: 'DELETE' })
export const getAlertFirings = (symbolKey?: string, limit?: number) => {
  const p = new URLSearchParams()
  if (symbolKey) p.set('symbolKey', symbolKey)
  if (limit)     p.set('limit', String(limit))
  const qs = p.toString()
  return api<AlertFiring[]>(`/api/alerts/firings${qs ? `?${qs}` : ''}`)
}
export const acknowledgeAlert = (id: number) =>
  api<{ ok: boolean }>(`/api/alerts/firings/${id}/acknowledge`, { method: 'POST' })

// ── Agent state ──────────────────────────────────────────────────────────────
export const getAgentState = () => api<AgentState>('/api/agent/state')

// ── Agent memories ────────────────────────────────────────────────────────────
export const getAgentMemories = (opts?: { symbol?: string; category?: string }) => {
  const p = new URLSearchParams()
  if (opts?.symbol)   p.set('symbol', opts.symbol)
  if (opts?.category) p.set('category', opts.category)
  const qs = p.toString()
  return api<AgentMemory[]>(`/api/agent/memories${qs ? `?${qs}` : ''}`)
}
export const createAgentMemory = (mem: { symbol?: string; category: string; content: string; confidence?: number }) =>
  api<{ ok: boolean; id: number }>('/api/agent/memories', { method: 'POST', ...json(mem) })
export const updateAgentMemory = (id: number, patch: { active?: boolean; content?: string; confidence?: number }) =>
  api<{ ok: boolean }>(`/api/agent/memories/${id}`, { method: 'PATCH', ...json(patch) })
export const deleteAgentMemory = (id: number) =>
  api<{ ok: boolean }>(`/api/agent/memories/${id}`, { method: 'DELETE' })

// ── Agent digest ─────────────────────────────────────────────────────────────
export const triggerDigest = () =>
  api<{ purged: number; memories: number; symbols: string[] }>('/api/agent/digest', { method: 'POST' })

// ── Agent rules ──────────────────────────────────────────────────────────────
export const getAgentRules = () => api<AgentRule[]>('/api/agent/rules')
export const createAgentRule = (rule: { ruleText: string; scope?: string; scopeValue?: string; priority?: number }) =>
  api<{ ok: boolean; id: number }>('/api/agent/rules', { method: 'POST', ...json(rule) })
export const updateAgentRule = (id: number, patch: { ruleText?: string; scope?: string; scopeValue?: string; priority?: number; enabled?: boolean }) =>
  api<{ ok: boolean }>(`/api/agent/rules/${id}`, { method: 'PATCH', ...json(patch) })
export const deleteAgentRule = (id: number) =>
  api<{ ok: boolean }>(`/api/agent/rules/${id}`, { method: 'DELETE' })

// ── Correlation ──────────────────────────────────────────────────────────────
export const getCorrelation = () =>
  api<{ symbols: string[]; matrix: Array<{ a: string; b: string; correlation: number }> }>('/api/correlation')

// ── Phase 6: Deep health ──────────────────────────────────────────────────────
export const getDeepHealth = () => api<DeepHealth>('/api/system/health/deep')

// ── Telegram ─────────────────────────────────────────────────────────────────
export const getTelegramConfig = () => api<{ botToken: string | null; chatId: string | null; enabled: boolean }>('/api/telegram/config')
export const setTelegramConfig = (cfg: { botToken?: string; chatId?: string; enabled?: boolean }) =>
  api<{ ok: boolean }>('/api/telegram/config', { method: 'POST', ...json(cfg) })
export const testTelegram = () => api<{ ok: boolean; botName?: string; error?: string }>('/api/telegram/test', { method: 'POST' })

// ── Delete MT5 Account ───────────────────────────────────────────────────────
export const deleteMt5Account = (login: number) =>
  api<{ ok: boolean; deleted: string[] }>(`/api/mt5-accounts/${login}`, { method: 'DELETE' })

// ── Account Snapshots ────────────────────────────────────────────────────────
export const getAccountSnapshots = (login: number, since?: string) => {
  const p = new URLSearchParams()
  if (since) p.set('since', since)
  const qs = p.toString()
  return api<Array<{ id: number; login: number; balance: number; equity: number; margin: number; freeMargin: number; floatingPl: number; currency: string; takenAt: string }>>(`/api/accounts/${login}/snapshots${qs ? `?${qs}` : ''}`)
}

// ── Challenge Tracker ────────────────────────────────────────────────────────
export const getChallenge = (login: number) =>
  api<{ id: number; login: number; preset: string; startBalance: number; profitTargetPct: number; dailyLossLimitPct: number; maxDrawdownPct: number; minTradingDays: number; startDate: string; active: boolean } | null>(`/api/accounts/${login}/challenge`)
export const saveChallenge = (login: number, cfg: { preset: string; startBalance: number; profitTargetPct: number; dailyLossLimitPct: number; maxDrawdownPct: number; minTradingDays: number; startDate: string }) =>
  api<{ ok: boolean; id: number }>(`/api/accounts/${login}/challenge`, { method: 'POST', ...json(cfg) })
export const deleteChallenge = (login: number) =>
  api<{ ok: boolean }>(`/api/accounts/${login}/challenge`, { method: 'DELETE' })

// ── Data Export ──────────────────────────────────────────────────────────────
export function exportData(type: string, params: Record<string, string> = {}) {
  const qs = new URLSearchParams(params).toString()
  return api<Record<string, unknown>[]>(`/api/export/${type}${qs ? `?${qs}` : ''}`)
}

// ── Performance Analytics ────────────────────────────────────────────────────
export const getAnalyticsOverview = (opts: { from?: string; to?: string } = {}) => {
  const p = new URLSearchParams()
  if (opts.from) p.set('from', opts.from)
  if (opts.to) p.set('to', opts.to)
  const qs = p.toString()
  return api<{ total: number; entered: number; wins: number; losses: number; expired: number; winRate: number; avgPipsWin: number; avgPipsLoss: number; totalPips: number; expectancy: number; profitFactor: number; maxConsecutiveLosses: number; bestTrade: number; worstTrade: number }>(`/api/analytics/overview${qs ? `?${qs}` : ''}`)
}
export const getAnalyticsBySymbol = (opts: { from?: string; to?: string } = {}) => {
  const p = new URLSearchParams()
  if (opts.from) p.set('from', opts.from)
  if (opts.to) p.set('to', opts.to)
  return api<Array<{ symbolKey: string; total: number; wins: number; losses: number; winRate: number; totalPips: number; expectancy: number; profitFactor: number }>>(`/api/analytics/by-symbol${p.toString() ? `?${p}` : ''}`)
}
export const getAnalyticsByStrategy = (opts: { from?: string; to?: string } = {}) => {
  const p = new URLSearchParams()
  if (opts.from) p.set('from', opts.from)
  if (opts.to) p.set('to', opts.to)
  return api<Array<{ strategyKey: string; total: number; wins: number; losses: number; winRate: number; totalPips: number; expectancy: number; profitFactor: number }>>(`/api/analytics/by-strategy${p.toString() ? `?${p}` : ''}`)
}
export const getAnalyticsByDay = (opts: { symbolKey?: string; from?: string; to?: string } = {}) => {
  const p = new URLSearchParams()
  if (opts.symbolKey) p.set('symbolKey', opts.symbolKey)
  if (opts.from) p.set('from', opts.from)
  if (opts.to) p.set('to', opts.to)
  return api<Array<{ day: string; wins: number; losses: number; pips: number }>>(`/api/analytics/by-day${p.toString() ? `?${p}` : ''}`)
}
