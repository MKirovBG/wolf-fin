import type {
  StatusResponse, WatchSymbol, AnalysisResult, AccountEntry, Mt5AccountInfo,
  SelectedAccount, PlatformLLMConfig, AnthropicModel, OpenRouterModel, OllamaModel,
  LogEntry, EconomicEvent, Mt5Position, AppConfig, Strategy,
  SymbolSummary, ProposalOutcome, OutcomeStats,
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
