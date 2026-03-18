import { useEffect, useState, useCallback } from 'react'
import { useParams, Link } from 'react-router-dom'
import { getAgents, startAgent, pauseAgent, stopAgent, triggerAgent, updateAgentConfig } from '../api/client.ts'
import type { AgentState } from '../types/index.ts'
import { Badge, decisionVariant } from '../components/Badge.tsx'
import { AgentStatusBadge } from '../components/AgentStatusBadge.tsx'
import { SettingsPanel } from '../components/AgentCard.tsx'
import { ThreadedLogsPanel } from '../components/ThreadedLogsPanel.tsx'
import { SystemPromptEditor } from '../components/SystemPromptEditor.tsx'
import { MarketDataModal } from '../components/MarketDataModal.tsx'

function rel(iso: string) {
  const d = Date.now() - new Date(iso).getTime()
  if (d < 60000) return `${Math.floor(d / 1000)}s ago`
  if (d < 3600000) return `${Math.floor(d / 60000)}m ago`
  return `${Math.floor(d / 3600000)}h ago`
}

function iLabel(s: number) {
  if (s < 60) return `${s}s`
  if (s < 3600) return `${s / 60} min`
  return `${s / 3600}h`
}

type Tab = 'overview' | 'logs'

export function AgentDetail() {
  const { market, symbol, accountId } = useParams<{ market: string; symbol: string; accountId?: string }>()
  const agentKey = market === 'mt5' && accountId ? `mt5:${symbol}:${accountId}` : `${market}:${symbol}`

  const [agent, setAgent] = useState<AgentState | null>(null)
  const [loading, setLoading] = useState<string | null>(null)
  const [showMarket, setShowMarket] = useState(false)
  const [tab, setTab] = useState<Tab>('overview')
  const [customPrompt, setCustomPrompt] = useState('')

  const load = useCallback(async () => {
    try {
      const all = await getAgents()
      const found = all.find(a => {
        const key = a.config.market === 'mt5' && a.config.mt5AccountId
          ? `mt5:${a.config.symbol}:${a.config.mt5AccountId}`
          : `${a.config.market}:${a.config.symbol}`
        return key === agentKey
      }) ?? null
      setAgent(found)
      if (found) setCustomPrompt(found.config.customPrompt ?? '')
    } catch { /* ignore */ }
  }, [agentKey])

  useEffect(() => {
    load()
    const id = setInterval(load, 5000)
    return () => clearInterval(id)
  }, [load])

  const act = async (fn: () => Promise<unknown>, id: string) => {
    setLoading(id)
    try { await fn() } finally { setLoading(null); load() }
  }

  const saveCustomPrompt = async (v: string) => {
    if (!agent) return
    setCustomPrompt(v)
    try {
      await updateAgentConfig(agentKey, { customPrompt: v || undefined })
    } catch { /* ignore */ }
  }

  if (!agent) {
    return (
      <div className="p-6">
        <Link to="/agents" className="text-muted text-sm hover:text-text transition-colors">← Agents</Link>
        <div className="mt-8 text-center text-muted">Agent not found.</div>
      </div>
    )
  }

  const canStart = agent.status !== 'running'
  const canPause = agent.status === 'running'
  const canStop  = agent.status !== 'idle'

  return (
    <div className="flex flex-col h-full" style={{ minHeight: 0 }}>

      {/* ── Fixed header ────────────────────────────────────────────────────── */}
      <div className="px-6 pt-5 pb-0 shrink-0 bg-bg border-b border-border">
        <Link to="/agents" className="text-sm text-muted hover:text-text transition-colors">← Agents</Link>

        <div className="flex items-start justify-between mt-3 mb-4">
          <div>
            <div className="flex items-center gap-2.5 mb-1.5">
              <h1 className="text-text font-bold text-2xl">{agent.config.symbol}</h1>
              <Badge label={agent.config.market.toUpperCase()} variant={agent.config.market} />
              {agent.config.leverage && (
                <span className="text-xs text-muted border border-border rounded-md px-2 py-0.5">{agent.config.leverage}:1</span>
              )}
            </div>
            <AgentStatusBadge status={agent.status} />
          </div>

          {/* Action buttons */}
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              disabled={!canStart || loading !== null}
              onClick={() => act(() => startAgent(agentKey), 'start')}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-green/30 text-green rounded-md hover:bg-green/10 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
            >
              <span className="text-[10px]">▶</span>
              {loading === 'start' ? 'Starting…' : 'Start'}
            </button>
            <button
              disabled={!canPause || loading !== null}
              onClick={() => act(() => pauseAgent(agentKey), 'pause')}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-yellow/30 text-yellow rounded-md hover:bg-yellow/10 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
            >
              <span className="text-[10px]">⏸</span>
              {loading === 'pause' ? 'Pausing…' : 'Pause'}
            </button>
            <button
              disabled={!canStop || loading !== null}
              onClick={() => act(() => stopAgent(agentKey), 'stop')}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-red/30 text-red rounded-md hover:bg-red/10 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
            >
              <span className="text-[10px]">■</span>
              {loading === 'stop' ? 'Stopping…' : 'Stop'}
            </button>

            {/* Divider */}
            <div className="w-px h-4 bg-border mx-1" />

            <button
              disabled={loading !== null}
              onClick={() => act(() => triggerAgent(agentKey), 'trigger')}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-blue/30 text-blue rounded-md hover:bg-blue/10 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
            >
              <span className="text-[10px]">⚡</span>
              {loading === 'trigger' ? 'Running…' : 'Trigger'}
            </button>
            <button
              onClick={() => setShowMarket(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-border text-muted rounded-md hover:border-muted2 hover:text-text transition-all"
            >
              Market
            </button>
          </div>
        </div>

        {/* Tab bar */}
        <div className="flex gap-0">
          {(['overview', 'logs'] as Tab[]).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-5 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px ${
                tab === t
                  ? 'border-green text-text'
                  : 'border-transparent text-muted hover:text-text'
              }`}
            >
              {t === 'overview' ? 'Overview' : 'Logs'}
            </button>
          ))}
        </div>
      </div>

      {/* ── Tab content ─────────────────────────────────────────────────────── */}
      <div
        className={`flex-1 px-6 py-5 ${tab === 'logs' ? 'overflow-hidden flex flex-col' : 'overflow-auto'}`}
        style={{ minHeight: 0 }}
      >

        {/* OVERVIEW TAB */}
        {tab === 'overview' && (
          <div className="flex flex-col gap-5 max-w-4xl mx-auto w-full">

            {/* Stats + Last decision */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="bg-surface border border-border rounded-lg p-4">
                <div className="text-xs font-semibold uppercase tracking-wider text-muted mb-3">Stats</div>
                <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
                  <div className="text-muted">Cycles <span className="text-text font-semibold ml-2">{agent.cycleCount}</span></div>
                  <div className="text-muted">Mode <span className="text-text font-semibold ml-2">{agent.config.fetchMode}</span></div>
                  {agent.config.fetchMode !== 'manual' && (
                    <div className="text-muted">Interval <span className="text-text font-semibold ml-2">{iLabel(agent.config.scheduleIntervalSeconds)}</span></div>
                  )}
                  {agent.startedAt && (
                    <div className="text-muted">Started <span className="text-text font-semibold ml-2">{rel(agent.startedAt)}</span></div>
                  )}
                  <div className="text-muted">Max Loss <span className="text-text font-semibold ml-2">${agent.config.maxLossUsd}</span></div>
                  {agent.config.leverage && (
                    <div className="text-muted">Leverage <span className="text-text font-semibold ml-2">{agent.config.leverage}:1</span></div>
                  )}
                  {agent.config.market === 'mt5' && agent.config.mt5AccountId && (
                    <div className="text-muted col-span-2">
                      MT5 Account <span className="text-text font-semibold ml-2">#{agent.config.mt5AccountId}</span>
                    </div>
                  )}
                  <div className="text-muted">LLM <span className="text-text font-semibold ml-2">{agent.config.llmProvider ?? 'anthropic'}</span></div>
                </div>
              </div>

              <div className="bg-surface border border-border rounded-lg p-4">
                <div className="text-xs font-semibold uppercase tracking-wider text-muted mb-3">Last Decision</div>
                {agent.lastCycle ? (
                  <>
                    <div className="flex items-center gap-2 mb-2">
                      <Badge label={agent.lastCycle.decision} variant={decisionVariant(agent.lastCycle.decision)} />
                      <span className="text-muted text-xs">{rel(agent.lastCycle.time)}</span>
                    </div>
                    {agent.lastCycle.reason && (
                      <p className="text-muted text-sm leading-relaxed">{agent.lastCycle.reason}</p>
                    )}
                    {agent.lastCycle.error && (
                      <p className="text-red text-sm mt-1">Error: {agent.lastCycle.error}</p>
                    )}
                  </>
                ) : (
                  <p className="text-muted text-sm">No cycles run yet</p>
                )}
              </div>
            </div>

            {/* Config editor */}
            <div className="bg-surface border border-border rounded-lg p-4">
              <div className="text-xs font-semibold uppercase tracking-wider text-muted mb-1">Configuration</div>
              <SettingsPanel
                agent={agent}
                agentKey={agentKey}
                onSave={load}
                onDelete={() => { window.location.href = '/agents' }}
              />
            </div>

            {/* System Prompt */}
            <div className="bg-surface border border-border rounded-lg p-4">
              <SystemPromptEditor
                agentKey={agentKey}
                customPrompt={customPrompt}
                onChange={saveCustomPrompt}
              />
            </div>
          </div>
        )}

        {/* LOGS TAB */}
        {tab === 'logs' && (
          <div className="h-full flex flex-col">
            <ThreadedLogsPanel agentKey={agentKey} />
          </div>
        )}
      </div>

      {showMarket && (
        <MarketDataModal
          market={agent.config.market}
          symbol={agent.config.symbol}
          onClose={() => setShowMarket(false)}
        />
      )}
    </div>
  )
}
