import { useEffect, useState, useCallback } from 'react'
import { useParams, Link } from 'react-router-dom'
import { getAgents, startAgent, pauseAgent, stopAgent, triggerAgent, updateAgentConfig, getAgentCycles } from '../api/client.ts'
import type { CycleResult } from '../types/index.ts'
import type { AgentState, GuardrailsConfig } from '../types/index.ts'
import { Badge, decisionVariant } from '../components/Badge.tsx'
import { AgentStatusBadge } from '../components/AgentStatusBadge.tsx'
import { SettingsPanel } from '../components/AgentCard.tsx'
import { ThreadedLogsPanel } from '../components/ThreadedLogsPanel.tsx'
import { SystemPromptEditor } from '../components/SystemPromptEditor.tsx'
import { MarketDataModal } from '../components/MarketDataModal.tsx'
import { IntelligencePanel } from '../components/IntelligencePanel.tsx'
import { PromptEditor } from '../components/PromptEditor.tsx'
import { GuardrailsEditor } from '../components/GuardrailsEditor.tsx'
import { useToast } from '../components/Toast.tsx'

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

type Tab = 'overview' | 'logs' | 'history' | 'intelligence' | 'config'

export function AgentDetail() {
  const { market, symbol, accountId, agentKey: encodedKey } = useParams<{
    market?: string; symbol?: string; accountId?: string; agentKey?: string
  }>()
  const agentKey = encodedKey
    ? decodeURIComponent(encodedKey)
    : (market === 'mt5' && accountId ? `mt5:${symbol}:${accountId}` : `${market}:${symbol}`)

  const [agent, setAgent] = useState<AgentState | null>(null)
  const [cycles, setCycles] = useState<(CycleResult & { id: number })[]>([])
  const [loading, setLoading] = useState<string | null>(null)
  const [showMarket, setShowMarket] = useState(false)
  const [tab, setTab] = useState<Tab>('overview')
  const [customPrompt, setCustomPrompt] = useState('')

  // Config tab state
  const [promptTemplate, setPromptTemplate] = useState('')
  const [guardrails, setGuardrails] = useState<Partial<GuardrailsConfig>>({})
  const [configSaving, setConfigSaving] = useState(false)
  const toast = useToast()

  const load = useCallback(async () => {
    try {
      const [all, agentCycles] = await Promise.all([
        getAgents(),
        getAgentCycles(agentKey, 100).catch(() => []),
      ])
      const found = all.find(a => a.agentKey === agentKey) ?? null
      setAgent(found)
      setCycles(agentCycles)
      if (found) {
        setCustomPrompt(found.config.customPrompt ?? '')
        setPromptTemplate(found.config.promptTemplate ?? '')
        setGuardrails(found.config.guardrails ?? {})
      }
    } catch { /* ignore */ }
  }, [agentKey])

  // Initial load
  useEffect(() => { load() }, [load])

  // SSE: real-time agent status and cycle updates — no polling needed
  useEffect(() => {
    const es = new EventSource(`/api/events?agent=${encodeURIComponent(agentKey)}`)
    es.addEventListener('agent', (e: MessageEvent) => {
      try {
        const updated = JSON.parse(e.data)
        setAgent(prev => prev ? { ...prev, ...updated } : updated)
      } catch { /* ignore */ }
    })
    return () => es.close()
  }, [agentKey])

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

  const saveConfig = async () => {
    if (!agent) return
    setConfigSaving(true)
    try {
      await updateAgentConfig(agentKey, {
        promptTemplate: promptTemplate || undefined,
        guardrails: Object.keys(guardrails).length > 0 ? guardrails : undefined,
      })
      toast.success('Configuration saved')
      load()
    } catch {
      toast.error('Failed to save configuration')
    } finally {
      setConfigSaving(false)
    }
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
              {agent.config.name && (
                <span className="text-xs text-muted2 border border-border/60 rounded-md px-2 py-0.5">{agent.config.name}</span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <AgentStatusBadge status={agent.status} />
              <span className="text-[10px] text-muted border border-border rounded px-1.5 py-0.5 font-mono">
                {agent.config.llmProvider ?? 'anthropic'}/{(agent.config.llmModel ?? 'default').split('/').pop()}
              </span>
            </div>
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
          {(['overview', 'logs', 'history', 'intelligence', 'config'] as Tab[]).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-5 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px ${
                tab === t
                  ? 'border-green text-text'
                  : 'border-transparent text-muted hover:text-text'
              }`}
            >
              {t === 'overview' ? 'Overview'
                : t === 'logs' ? 'Logs'
                : t === 'history' ? 'History'
                : t === 'intelligence' ? 'Intelligence'
                : 'Config'}
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
                {(() => {
                  const closed = cycles.filter(c => c.pnlUsd != null)
                  const totalPnl = closed.reduce((s, c) => s + (c.pnlUsd ?? 0), 0)
                  const wins = closed.filter(c => (c.pnlUsd ?? 0) > 0).length
                  const winRate = closed.length > 0 ? Math.round(wins / closed.length * 100) : null
                  return (
                    <>
                      {closed.length > 0 && (
                        <div className="flex items-baseline gap-3 mb-3 pb-3 border-b border-border">
                          <span className={`text-2xl font-bold font-mono ${totalPnl >= 0 ? 'text-green' : 'text-red'}`}>
                            {totalPnl >= 0 ? '+' : ''}${totalPnl.toFixed(2)}
                          </span>
                          <span className="text-muted text-xs">{closed.length} closes{winRate !== null ? ` · ${winRate}% win` : ''}</span>
                        </div>
                      )}
                      <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
                        <div className="text-muted">Ticks <span className="text-text font-semibold ml-2">{agent.cycleCount}</span></div>
                        <div className="text-muted">Mode <span className="text-text font-semibold ml-2">{agent.config.fetchMode}</span></div>
                        {agent.config.fetchMode !== 'manual' && (
                          <div className="text-muted">Interval <span className="text-text font-semibold ml-2">{iLabel(agent.config.scheduleIntervalSeconds)}</span></div>
                        )}
                        {agent.startedAt && (
                          <div className="text-muted">Started <span className="text-text font-semibold ml-2">{rel(agent.startedAt)}</span></div>
                        )}
                        {agent.config.leverage && (
                          <div className="text-muted">Leverage <span className="text-text font-semibold ml-2">{agent.config.leverage}:1</span></div>
                        )}
                        {agent.config.market === 'mt5' && agent.config.mt5AccountId && (
                          <div className="text-muted col-span-2">
                            MT5 Account <span className="text-text font-semibold ml-2">#{agent.config.mt5AccountId}</span>
                          </div>
                        )}
                      </div>
                    </>
                  )
                })()}
              </div>

              <div className="bg-surface border border-border rounded-lg p-4">
                <div className="text-xs font-semibold uppercase tracking-wider text-muted mb-3">Last Decision</div>
                {agent.lastCycle ? (
                  <>
                    <div className="flex items-center gap-2 mb-2 flex-wrap">
                      <Badge label={agent.lastCycle.decision.split(' ')[0]} variant={decisionVariant(agent.lastCycle.decision)} />
                      <span className="text-muted text-xs">{rel(agent.lastCycle.time)}</span>
                      {agent.lastCycle.pnlUsd != null && (
                        <span className={`text-sm font-mono font-semibold ml-auto ${agent.lastCycle.pnlUsd >= 0 ? 'text-green' : 'text-red'}`}>
                          {agent.lastCycle.pnlUsd >= 0 ? '+' : ''}${agent.lastCycle.pnlUsd.toFixed(2)}
                        </span>
                      )}
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

        {/* HISTORY TAB */}
        {tab === 'history' && (
          <div className="max-w-4xl mx-auto w-full">
            <div className="bg-surface border border-border rounded-lg overflow-hidden">
              <div className="px-4 py-3 border-b border-border flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wider text-muted">Cycle History</span>
                <span className="text-xs text-muted">{cycles.length} records</span>
              </div>
              {cycles.length === 0 ? (
                <div className="text-muted text-sm text-center py-10">No cycles recorded yet</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr>
                        {['Time', 'Decision', 'P&L', 'Reason'].map(h => (
                          <th key={h} className="text-left text-xs font-semibold uppercase tracking-wider text-muted py-2.5 px-4 border-b border-border bg-surface2">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {cycles.map((c, i) => (
                        <tr key={c.id ?? i} className={`border-b border-border/50 hover:bg-surface2 transition-colors ${c.error ? 'bg-red-dim/20' : ''}`}>
                          <td className="py-2 px-4 text-muted whitespace-nowrap text-xs">{rel(c.time)}</td>
                          <td className="py-2 px-4">
                            <Badge label={c.decision.split(' ')[0]} variant={decisionVariant(c.decision)} />
                          </td>
                          <td className="py-2 px-4 font-mono text-sm">
                            {c.pnlUsd != null
                              ? <span className={c.pnlUsd >= 0 ? 'text-green' : 'text-red'}>{c.pnlUsd >= 0 ? '+' : ''}${c.pnlUsd.toFixed(2)}</span>
                              : <span className="text-muted">—</span>}
                          </td>
                          <td className="py-2 px-4 text-muted text-xs max-w-xs truncate">
                            {c.error ? <span className="text-red">{c.error}</span> : (c.reason || '—')}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {/* INTELLIGENCE TAB */}
        {tab === 'intelligence' && (
          <IntelligencePanel agentKey={agentKey} />
        )}

        {/* CONFIG TAB */}
        {tab === 'config' && (
          <div className="flex flex-col gap-5 max-w-4xl mx-auto w-full">

            {/* Prompt Template */}
            <div className="bg-surface border border-border rounded-lg p-5">
              <div className="text-xs font-semibold uppercase tracking-wider text-muted mb-1">Prompt Template</div>
              <p className="text-xs text-muted2 mb-4 leading-relaxed">
                Write a custom system prompt using {`{{pill}}`} tokens to inject dynamic content. Leave empty to use the default Wolf-Fin prompt.
              </p>
              <PromptEditor
                value={promptTemplate}
                onChange={setPromptTemplate}
                market={agent.config.market}
              />
            </div>

            {/* Guardrails */}
            <div className="bg-surface border border-border rounded-lg p-5">
              <div className="text-xs font-semibold uppercase tracking-wider text-muted mb-1">Guardrails</div>
              <p className="text-xs text-muted2 mb-4 leading-relaxed">
                Toggle order validation rules. All guardrails are enabled by default.
              </p>
              <GuardrailsEditor
                value={guardrails}
                onChange={setGuardrails}
                market={agent.config.market}
              />
            </div>

            {/* Save */}
            <div className="flex justify-end">
              <button
                type="button"
                disabled={configSaving || agent.status === 'running'}
                onClick={saveConfig}
                className="px-6 py-2.5 text-sm border border-green text-green rounded-lg hover:bg-green-dim disabled:opacity-40 transition-colors font-medium"
              >
                {configSaving ? 'Saving…' : 'Save Configuration'}
              </button>
            </div>
            {agent.status === 'running' && (
              <p className="text-xs text-yellow text-right -mt-2">Stop or pause the agent before editing its configuration.</p>
            )}
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
