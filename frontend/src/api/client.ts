import type { StatusResponse, KeysResponse, ReportSummary, AgentConfig, AgentState, MarketSnapshot, CycleResult, CycleDetail, LogEntry, PositionEntry, FillEntry, AccountEntry, Mt5AccountInfo, OpenRouterModel, OllamaModel, StrategyDoc, AgentMemory, AgentPlan, AgentStats, SelectedAccount } from '../types/index.ts'

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

// ── Agents ────────────────────────────────────────────────────────────────────
export const getAgents = (filter?: { market?: string; accountId?: string }) => {
  const p = new URLSearchParams()
  if (filter?.market)    p.set('market', filter.market)
  if (filter?.accountId) p.set('accountId', filter.accountId)
  const qs = p.toString()
  return api<AgentState[]>(`/api/agents${qs ? `?${qs}` : ''}`)
}

export const addAgent = (config: AgentConfig) =>
  api<{ ok: boolean; key: string; conflicts?: string[] }>('/api/agents', { method: 'POST', ...json(config) })

export const deleteAgent = (key: string) =>
  api<{ ok: boolean }>(`/api/agents/${encodeURIComponent(key)}`, { method: 'DELETE' })

export const updateAgentConfig = (key: string, patch: Partial<AgentConfig>) =>
  api<{ ok: boolean }>(`/api/agents/${encodeURIComponent(key)}/config`, { method: 'PATCH', ...json(patch) })

export const startAgent = (key: string) =>
  api<{ ok: boolean }>(`/api/agents/${encodeURIComponent(key)}/start`, { method: 'POST' })

export const pauseAgent = (key: string) =>
  api<{ ok: boolean }>(`/api/agents/${encodeURIComponent(key)}/pause`, { method: 'POST' })

export const stopAgent = (key: string) =>
  api<{ ok: boolean }>(`/api/agents/${encodeURIComponent(key)}/stop`, { method: 'POST' })

export const triggerAgent = (key: string) =>
  api<{ ok: boolean }>(`/api/agents/${encodeURIComponent(key)}/trigger`, { method: 'POST' })

export const resetAgentData = (key: string) =>
  api<{ ok: boolean; deleted: Record<string, number> }>(`/api/agents/${encodeURIComponent(key)}/reset`, { method: 'POST' })

// ── Market Data (read-only) ───────────────────────────────────────────────────
export const getMarketData = (market: string, symbol: string) =>
  api<MarketSnapshot>(`/api/market/${market}/${encodeURIComponent(symbol)}`)

// ── Keys ─────────────────────────────────────────────────────────────────────
export const getKeys = () => api<KeysResponse>('/api/keys')

export const setKey = (key: string, value: string) =>
  api<{ ok: boolean }>('/api/keys', { method: 'POST', ...json({ key, value }) })

export const testKey = (service: string) =>
  api<{ ok: boolean; message: string }>(`/api/keys/test/${service}`, { method: 'POST' })

// ── System Prompt ─────────────────────────────────────────────────────────────
export const getSystemPrompt = (key: string) =>
  api<{ prompt: string }>(`/api/system-prompt/${encodeURIComponent(key)}`)

// ── Logs ─────────────────────────────────────────────────────────────────────
export const clearLogs = () =>
  api<{ ok: boolean; clearedAt: number }>('/api/logs/clear', { method: 'POST' })

export const getLogs = (sinceId?: number, agent?: string) => {
  const params = new URLSearchParams()
  if (sinceId) params.set('since', String(sinceId))
  if (agent)   params.set('agent', agent)
  const qs = params.toString()
  return api<LogEntry[]>(`/api/logs${qs ? `?${qs}` : ''}`)
}


// ── Reports ───────────────────────────────────────────────────────────────────
export const getReportSummary = () => api<ReportSummary>('/api/reports/summary')

export const getReportTrades = (market?: string) =>
  api<CycleResult[]>(`/api/reports/trades${market ? `?market=${market}` : ''}`)

export const getCycleDetail = (id: number) =>
  api<CycleDetail>(`/api/cycles/${id}`)

export const getAgentCycles = (key: string, limit = 100) =>
  api<(CycleResult & { id: number; agentKey: string })[]>(`/api/agents/${encodeURIComponent(key)}/cycles?limit=${limit}`)

// ── Selected account ─────────────────────────────────────────────────────────
export const getSelectedAccount = () => api<SelectedAccount | null>('/api/selected-account')
export const setSelectedAccount = (account: SelectedAccount | null) =>
  api<{ ok: boolean }>('/api/selected-account', { method: 'POST', ...json(account) })

// ── Accounts ─────────────────────────────────────────────────────────────────
export const getAccounts = () => api<AccountEntry[]>('/api/accounts')
export const getMt5Accounts = () => api<Mt5AccountInfo[]>('/api/mt5-accounts')
export const getOpenRouterModels = () => api<OpenRouterModel[]>('/api/openrouter/models')
export const getOllamaModels = () => api<OllamaModel[]>('/api/ollama/models')
export const searchSymbols = (market: string, search: string, accountId?: number) => {
  const p = new URLSearchParams({ market, search })
  if (accountId) p.set('accountId', String(accountId))
  return api<Array<{ symbol: string; description: string }>>(`/api/symbols?${p}`)
}

// ── Agent Strategy ────────────────────────────────────────────────────────────
export const getAgentStrategy = (key: string) => api<StrategyDoc>(`/api/agents/${key}/strategy`)
export const saveAgentStrategy = (key: string, s: Omit<StrategyDoc, 'agentKey' | 'createdAt' | 'updatedAt'>) =>
  api<{ ok: boolean }>(`/api/agents/${key}/strategy`, { method: 'PUT', body: JSON.stringify(s), headers: { 'Content-Type': 'application/json' } })
export const deleteAgentStrategy = (key: string) =>
  api<{ ok: boolean }>(`/api/agents/${key}/strategy`, { method: 'DELETE' })

// ── Agent Memory ──────────────────────────────────────────────────────────────
export const getAgentMemories = (key: string, category?: string) =>
  api<AgentMemory[]>(`/api/agents/${key}/memories${category ? `?category=${category}` : ''}`)
export const deleteAgentMemory = (key: string, category: string, memKey: string) =>
  api<{ ok: boolean }>(`/api/agents/${key}/memories/${category}/${encodeURIComponent(memKey)}`, { method: 'DELETE' })
export const clearAgentMemories = (key: string) =>
  api<{ ok: boolean }>(`/api/agents/${key}/memories`, { method: 'DELETE' })

// ── Agent Stats ───────────────────────────────────────────────────────────────
export const getAgentStats = (key: string) => api<AgentStats>(`/api/agents/${encodeURIComponent(key)}/stats`)

// ── Agent Plans ───────────────────────────────────────────────────────────────
export const getAgentPlan = (key: string) => api<AgentPlan>(`/api/agents/${key}/plan/active`)
export const getAgentPlans = (key: string) => api<AgentPlan[]>(`/api/agents/${key}/plans`)
export const triggerPlanningCycle = (key: string) =>
  api<{ ok: boolean }>(`/api/agents/${key}/plan`, { method: 'POST' })
