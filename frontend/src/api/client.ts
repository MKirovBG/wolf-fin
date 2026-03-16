import type { StatusResponse, KeysResponse, ReportSummary, AgentConfig, AgentState, MarketSnapshot, CycleResult, LogEntry, PositionEntry, FillEntry, AccountEntry, Mt5AccountInfo, OpenRouterModel } from '../types/index.ts'

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
export const getAgents = () => api<AgentState[]>('/api/agents')

export const addAgent = (config: AgentConfig) =>
  api<{ ok: boolean; key: string }>('/api/agents', { method: 'POST', ...json(config) })

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

// ── Market Data (read-only) ───────────────────────────────────────────────────
export const getMarketData = (market: string, symbol: string) =>
  api<MarketSnapshot>(`/api/market/${market}/${encodeURIComponent(symbol)}`)

// ── Keys ─────────────────────────────────────────────────────────────────────
export const getKeys = () => api<KeysResponse>('/api/keys')

export const setKey = (key: string, value: string) =>
  api<{ ok: boolean }>('/api/keys', { method: 'POST', ...json({ key, value }) })

export const testKey = (service: string) =>
  api<{ ok: boolean; message: string }>(`/api/keys/test/${service}`, { method: 'POST' })

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

// ── Positions ─────────────────────────────────────────────────────────────────
export const getPositions = () => api<PositionEntry[]>('/api/positions')
export const getTrades    = () => api<FillEntry[]>('/api/trades')

// ── Reports ───────────────────────────────────────────────────────────────────
export const getReportSummary = () => api<ReportSummary>('/api/reports/summary')

export const getReportTrades = (market?: string) =>
  api<CycleResult[]>(`/api/reports/trades${market ? `?market=${market}` : ''}`)

// ── Accounts ─────────────────────────────────────────────────────────────────
export const getAccounts = () => api<AccountEntry[]>('/api/accounts')
export const getMt5Accounts = () => api<Mt5AccountInfo[]>('/api/mt5-accounts')
export const getOpenRouterModels = () => api<OpenRouterModel[]>('/api/openrouter/models')
