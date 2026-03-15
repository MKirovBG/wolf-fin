import { useEffect, useState, useCallback } from 'react'
import { useParams, Link } from 'react-router-dom'
import { getAgents, startAgent, pauseAgent, stopAgent, triggerAgent } from '../api/client.ts'
import type { AgentState } from '../types/index.ts'
import { Badge, decisionVariant } from '../components/Badge.tsx'
import { AgentStatusBadge } from '../components/AgentStatusBadge.tsx'
import { SettingsPanel } from '../components/AgentCard.tsx'
import { LogsTerminal } from '../components/LogsTerminal.tsx'
import { MarketDataModal } from '../components/MarketDataModal.tsx'

function rel(iso: string) {
  const d = Date.now() - new Date(iso).getTime()
  if (d < 60000) return `${Math.floor(d / 1000)}s ago`
  if (d < 3600000) return `${Math.floor(d / 60000)}m ago`
  return `${Math.floor(d / 3600000)}h ago`
}

export function AgentDetail() {
  const { market, symbol } = useParams<{ market: string; symbol: string }>()
  const agentKey = `${market}:${symbol}`

  const [agent, setAgent] = useState<AgentState | null>(null)
  const [loading, setLoading] = useState<string | null>(null)
  const [showMarket, setShowMarket] = useState(false)

  const load = useCallback(async () => {
    try {
      const all = await getAgents()
      setAgent(all.find(a => `${a.config.market}:${a.config.symbol}` === agentKey) ?? null)
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

  if (!agent) {
    return (
      <div className="p-6">
        <Link to="/agents" className="text-muted text-xs hover:text-white transition-colors">← Back to Agents</Link>
        <div className="mt-8 text-center text-muted text-sm">Agent not found.</div>
      </div>
    )
  }

  const canStart = agent.status !== 'running'
  const canPause = agent.status === 'running'
  const canStop  = agent.status !== 'idle'

  return (
    <div className="p-6 flex flex-col gap-5">
      {/* Back */}
      <Link to="/agents" className="text-muted text-xs hover:text-white transition-colors self-start">
        ← Back to Agents
      </Link>

      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2 mb-1.5">
            <h1 className="text-white font-bold text-xl">{agent.config.symbol}</h1>
            <Badge label={agent.config.market.toUpperCase()} variant={agent.config.market} />
            <Badge label={agent.config.paper ? 'PAPER' : 'LIVE'} variant={agent.config.paper ? 'paper' : 'live'} />
          </div>
          <AgentStatusBadge status={agent.status} />
        </div>

        {/* Actions */}
        <div className="flex flex-wrap gap-1.5">
          <button
            disabled={!canStart || loading !== null}
            onClick={() => act(() => startAgent(agentKey), 'start')}
            className="px-3 py-1.5 text-xs border border-green-border text-green rounded hover:bg-green-dim disabled:opacity-25 disabled:cursor-default transition-colors"
          >
            {loading === 'start' ? '...' : '▶ Start'}
          </button>
          <button
            disabled={!canPause || loading !== null}
            onClick={() => act(() => pauseAgent(agentKey), 'pause')}
            className="px-3 py-1.5 text-xs border border-yellow/30 text-yellow rounded hover:bg-yellow-dim disabled:opacity-25 disabled:cursor-default transition-colors"
          >
            {loading === 'pause' ? '...' : '⏸ Pause'}
          </button>
          <button
            disabled={!canStop || loading !== null}
            onClick={() => act(() => stopAgent(agentKey), 'stop')}
            className="px-3 py-1.5 text-xs border border-red-border text-red rounded hover:bg-red-dim disabled:opacity-25 disabled:cursor-default transition-colors"
          >
            {loading === 'stop' ? '...' : '■ Stop'}
          </button>
          <button
            disabled={loading !== null}
            onClick={() => act(() => triggerAgent(agentKey), 'trigger')}
            className="px-3 py-1.5 text-xs border border-blue-500/30 text-blue-400 rounded hover:bg-blue-900/20 disabled:opacity-25 disabled:cursor-default transition-colors"
          >
            {loading === 'trigger' ? 'Running...' : '⚡ Trigger'}
          </button>
          <button
            onClick={() => setShowMarket(true)}
            className="px-3 py-1.5 text-xs border border-border text-muted rounded hover:border-muted hover:text-white transition-colors"
          >
            📊 Market Data
          </button>
        </div>
      </div>

      {/* Stats + last decision */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-surface border border-border rounded-lg p-4">
          <div className="text-[10px] font-bold tracking-widest text-muted uppercase mb-3">Stats</div>
          <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-xs">
            <div className="text-muted">Cycles <span className="text-white font-bold ml-2">{agent.cycleCount}</span></div>
            <div className="text-muted">Mode <span className="text-white font-bold ml-2">{agent.config.fetchMode}</span></div>
            {agent.config.fetchMode !== 'manual' && (
              <div className="text-muted">Interval <span className="text-white font-bold ml-2">{agent.config.scheduleIntervalMinutes}m</span></div>
            )}
            {agent.startedAt && (
              <div className="text-muted">Started <span className="text-white font-bold ml-2">{rel(agent.startedAt)}</span></div>
            )}
            <div className="text-muted">Max Loss <span className="text-white font-bold ml-2">${agent.config.maxLossUsd}</span></div>
            <div className="text-muted">Max Position <span className="text-white font-bold ml-2">${agent.config.maxPositionUsd}</span></div>
          </div>
        </div>

        <div className="bg-surface border border-border rounded-lg p-4">
          <div className="text-[10px] font-bold tracking-widest text-muted uppercase mb-3">Last Decision</div>
          {agent.lastCycle ? (
            <>
              <div className="flex items-center gap-2 mb-2">
                <Badge label={agent.lastCycle.decision} variant={decisionVariant(agent.lastCycle.decision)} />
                <span className="text-muted text-[10px]">{rel(agent.lastCycle.time)}</span>
              </div>
              {agent.lastCycle.reason && (
                <p className="text-muted text-xs leading-relaxed">{agent.lastCycle.reason}</p>
              )}
              {agent.lastCycle.error && (
                <p className="text-red text-xs mt-1">Error: {agent.lastCycle.error}</p>
              )}
            </>
          ) : (
            <p className="text-muted text-xs">No cycles run yet</p>
          )}
        </div>
      </div>

      {/* Config edit */}
      <div className="bg-surface border border-border rounded-lg p-4">
        <div className="text-[10px] font-bold tracking-widest text-muted uppercase mb-1">Configuration</div>
        <SettingsPanel
          agent={agent}
          agentKey={agentKey}
          onSave={load}
          onDelete={() => window.location.href = '/agents'}
        />
      </div>

      {/* Logs */}
      <div>
        <div className="text-[10px] font-bold tracking-widest text-muted uppercase mb-2">Agent Logs</div>
        <LogsTerminal agentKey={agentKey} maxHeight={600} />
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
