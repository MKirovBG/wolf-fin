import type { StatusResponse, KeysResponse, ReportSummary, AgentConfig } from '../types/index.ts'

async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(path, options)
  if (!res.ok) throw new Error(`${options?.method ?? 'GET'} ${path} → ${res.status}`)
  return res.json() as Promise<T>
}

export const getStatus = () => api<StatusResponse>('/api/status')
export const pause = () => api<{ ok: boolean }>('/api/pause', { method: 'POST' })
export const resume = () => api<{ ok: boolean }>('/api/resume', { method: 'POST' })

export const getAgents = () => api<AgentConfig[]>('/api/agents')
export const addAgent = (config: AgentConfig) =>
  api<{ ok: boolean }>('/api/agents', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
  })
export const deleteAgent = (key: string) =>
  api<{ ok: boolean }>(`/api/agents/${encodeURIComponent(key)}`, { method: 'DELETE' })
export const triggerAgent = (key: string) =>
  api<{ ok: boolean }>(`/api/agents/${encodeURIComponent(key)}/trigger`, { method: 'POST' })

export const getKeys = () => api<KeysResponse>('/api/keys')
export const setKey = (key: string, value: string) =>
  api<{ ok: boolean }>('/api/keys', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key, value }),
  })
export const testKey = (service: string) =>
  api<{ ok: boolean; message: string }>(`/api/keys/test/${service}`, { method: 'POST' })

export const getReportSummary = () => api<ReportSummary>('/api/reports/summary')
export const getReportTrades = (market?: string) =>
  api<import('../types/index.ts').CycleResult[]>(
    `/api/reports/trades${market ? `?market=${market}` : ''}`,
  )
