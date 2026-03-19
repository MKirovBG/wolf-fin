import { useEffect, useState, useCallback, type ReactNode } from 'react'
import { useParams, Link } from 'react-router-dom'
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import { getAgents, startAgent, pauseAgent, stopAgent, triggerAgent, resetAgentData, getAgentCycles, getAgentStats, updateAgentConfig } from '../api/client.ts'
import type { CycleResult, AgentStats, LogEntry } from '../types/index.ts'
import type { AgentState } from '../types/index.ts'
import { Badge, decisionVariant } from '../components/Badge.tsx'
import { AgentStatusBadge } from '../components/AgentStatusBadge.tsx'
import { SettingsPanel } from '../components/AgentCard.tsx'
import { ThreadedLogsPanel } from '../components/ThreadedLogsPanel.tsx'
import { SystemPromptEditor } from '../components/SystemPromptEditor.tsx'
import { MarketDataModal } from '../components/MarketDataModal.tsx'
import { IntelligencePanel } from '../components/IntelligencePanel.tsx'
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

type Tab = 'overview' | 'logs' | 'history' | 'performance' | 'intelligence'

// ── Cycle Detail Modal ────────────────────────────────────────────────────────
interface CycleDetailModalProps {
  cycleId: number
  onClose: () => void
}

function CollapsibleSection({ title, count, color = 'text-muted', defaultOpen = false, children }: {
  title: string; count: number; color?: string; defaultOpen?: boolean; children: ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  if (count === 0) return null
  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-4 py-2.5 bg-surface2 hover:bg-surface3 transition-colors text-left"
      >
        <span className={`text-xs font-semibold uppercase tracking-wider ${color}`}>{title}</span>
        <span className="text-muted text-xs flex items-center gap-2">
          <span className="text-muted2">{count} item{count !== 1 ? 's' : ''}</span>
          {open ? '▲' : '▼'}
        </span>
      </button>
      {open && <div className="divide-y divide-border/40">{children}</div>}
    </div>
  )
}

function CycleDetailModal({ cycleId, onClose }: CycleDetailModalProps) {
  const [data, setData] = useState<{ cycle: CycleResult & { id: number }; logs: LogEntry[] } | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    fetch(`/api/cycles/${cycleId}`)
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false) })
      .catch(() => setLoading(false))
  }, [cycleId])

  const thinking  = data?.logs.filter(l => l.event === 'claude_thinking') ?? []
  const toolCalls = data?.logs.filter(l => l.event === 'tool_call' || l.event === 'tool_result') ?? []
  const decisions = data?.logs.filter(l => l.event === 'decision' || l.event === 'auto_execute') ?? []
  const warnings  = data?.logs.filter(l => l.level === 'warn' || l.event === 'guardrail_block') ?? []

  const timeStr = (iso: string) =>
    new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })

  // Pair tool calls with their results for cleaner display
  const toolPairs: { call: LogEntry; result?: LogEntry }[] = []
  const logs = data?.logs ?? []
  for (let i = 0; i < logs.length; i++) {
    const l = logs[i]
    if (l.event === 'tool_call') {
      const next = logs[i + 1]
      if (next?.event === 'tool_result') {
        toolPairs.push({ call: l, result: next })
        i++ // skip result — already consumed
      } else {
        toolPairs.push({ call: l })
      }
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div
        className="relative bg-bg border border-border rounded-xl shadow-2xl w-full max-w-2xl max-h-[88vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-border shrink-0">
          <div className="flex items-center gap-2.5">
            {data?.cycle && (
              <Badge label={data.cycle.decision.split(' ')[0]} variant={decisionVariant(data.cycle.decision)} />
            )}
            {data?.cycle && (
              <span className="text-xs text-muted">{timeStr(data.cycle.time)}</span>
            )}
            {data?.cycle?.pnlUsd != null && (
              <span className={`text-sm font-mono font-semibold ${data.cycle.pnlUsd >= 0 ? 'text-green' : 'text-red'}`}>
                {data.cycle.pnlUsd >= 0 ? '+' : ''}${data.cycle.pnlUsd.toFixed(2)}
              </span>
            )}
          </div>
          <button onClick={onClose} className="text-muted hover:text-text transition-colors px-1">✕</button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2.5">
          {loading && <div className="text-muted text-sm text-center py-10">Loading…</div>}

          {!loading && data && (
            <>
              {/* Decision — always open, most important */}
              <CollapsibleSection title="Decision" count={decisions.length} color="text-green" defaultOpen>
                {decisions.map(l => (
                  <div key={l.id} className="px-4 py-3">
                    <div className="text-[10px] text-muted2 mb-1 uppercase tracking-wider">{l.event} · {timeStr(l.time)}</div>
                    <p className="text-sm text-text leading-relaxed">{l.message}</p>
                  </div>
                ))}
              </CollapsibleSection>

              {/* Reasoning / Thinking — collapsed by default but accessible */}
              <CollapsibleSection title="Reasoning" count={thinking.length} color="text-yellow">
                {thinking.map((l, idx) => (
                  <div key={l.id} className="px-4 py-3">
                    {thinking.length > 1 && (
                      <div className="text-[10px] text-muted2 mb-1.5 uppercase tracking-wider">Iteration {idx + 1} · {timeStr(l.time)}</div>
                    )}
                    <pre className="text-xs text-muted font-mono whitespace-pre-wrap break-words leading-relaxed">{l.message}</pre>
                  </div>
                ))}
              </CollapsibleSection>

              {/* Tool calls — paired call + result */}
              <CollapsibleSection title="Tool Calls" count={toolPairs.length} color="text-blue">
                {toolPairs.map(({ call, result }, idx) => (
                  <div key={call.id} className="px-4 py-3 space-y-1.5">
                    <div className="text-[10px] text-muted2 uppercase tracking-wider">Call {idx + 1} · {timeStr(call.time)}</div>
                    <div className="flex items-start gap-1.5">
                      <span className="text-blue text-xs font-mono shrink-0 mt-0.5">→</span>
                      <code className="text-xs font-mono text-text break-all">{call.message}</code>
                    </div>
                    {result && (
                      <div className="flex items-start gap-1.5 pl-1">
                        <span className="text-green text-xs font-mono shrink-0 mt-0.5">←</span>
                        <code className="text-xs font-mono text-muted break-all">{result.message}</code>
                      </div>
                    )}
                  </div>
                ))}
              </CollapsibleSection>

              {/* Warnings */}
              <CollapsibleSection title="Warnings" count={warnings.length} color="text-red">
                {warnings.map(l => (
                  <div key={l.id} className="px-4 py-3">
                    <div className="text-[10px] text-muted2 mb-1">{timeStr(l.time)}</div>
                    <p className="text-xs text-yellow">{l.message}</p>
                  </div>
                ))}
              </CollapsibleSection>

              {decisions.length === 0 && thinking.length === 0 && toolPairs.length === 0 && (
                <div className="text-muted text-sm text-center py-10">No detailed logs found for this cycle.</div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Main Component ─────────────────────────────────────────────────────────────
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
  const [stats, setStats] = useState<AgentStats | null>(null)
  const [customPrompt, setCustomPrompt] = useState('')
  const [promptTemplate, setPromptTemplate] = useState<string | undefined>(undefined)
  const [selectedCycleId, setSelectedCycleId] = useState<number | null>(null)
  const [intelligenceKey, setIntelligenceKey] = useState(0) // bump to force reload
  const toast = useToast()

  const load = useCallback(async () => {
    try {
      const [all, agentCycles, agentStats] = await Promise.all([
        getAgents(),
        getAgentCycles(agentKey, 100).catch(() => []),
        getAgentStats(agentKey).catch(() => null),
      ])
      setStats(agentStats)
      const found = all.find(a => a.agentKey === agentKey) ?? null
      setAgent(found)
      setCycles(agentCycles)
      if (found) {
        setCustomPrompt(found.config.customPrompt ?? '')
        setPromptTemplate(found.config.promptTemplate ?? undefined)
      }
    } catch { /* ignore */ }
  }, [agentKey])

  // Initial load
  useEffect(() => { load() }, [load])

  // SSE: real-time agent status updates
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

            {/* Divider */}
            <div className="w-px h-4 bg-border mx-1" />

            <button
              disabled={loading !== null}
              onClick={async () => {
                if (!confirm('Reset ALL data for this agent?\n\nThis deletes: memories, strategy, plans, sessions, trade history, and logs.\n\nConfig and prompt are kept. This cannot be undone.')) return
                await act(async () => {
                  const res = await resetAgentData(agentKey)
                  const d = (res as { deleted?: Record<string, number> }).deleted
                  if (d) toast.success(`Reset complete — cleared: ${Object.entries(d).filter(([,v]) => v > 0).map(([k,v]) => `${k}(${v})`).join(', ')}`)
                }, 'reset')
                setIntelligenceKey(k => k + 1) // force Intelligence panel to reload
                load()
              }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-red/30 text-red rounded-md hover:bg-red/10 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
            >
              {loading === 'reset' ? 'Resetting…' : 'Reset Data'}
            </button>
          </div>
        </div>

        {/* Tab bar */}
        <div className="flex gap-0">
          {(['overview', 'logs', 'history', 'performance', 'intelligence'] as Tab[]).map(t => (
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
                : t === 'performance' ? 'Performance'
                : 'Intelligence'}
            </button>
          ))}
        </div>
      </div>

      {/* ── Pause / quota warning banner ────────────────────────────────────── */}
      {agent.pauseReason && (
        <div className="mx-6 mt-3 flex items-start gap-3 bg-red-dim border border-red/40 rounded-lg px-4 py-3">
          <span className="text-red text-base shrink-0 mt-0.5">⚠</span>
          <div className="flex-1 min-w-0">
            <p className="text-sm text-red font-medium leading-snug">Agent paused automatically</p>
            <p className="text-xs text-red/80 mt-0.5 leading-relaxed">{agent.pauseReason}</p>
          </div>
          <button
            onClick={() => act(() => startAgent(agentKey), 'start')}
            disabled={loading !== null}
            className="shrink-0 px-3 py-1.5 text-xs border border-green/40 text-green rounded-md hover:bg-green/10 disabled:opacity-40 transition-colors"
          >
            Restart
          </button>
        </div>
      )}

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
                promptTemplate={promptTemplate}
                customPrompt={customPrompt}
                onSaved={load}
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
                <span className="text-xs text-muted">{cycles.length} records · click any row for details</span>
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
                        <tr
                          key={c.id ?? i}
                          onClick={() => c.id && setSelectedCycleId(c.id)}
                          className={`border-b border-border/50 hover:bg-surface2 transition-colors cursor-pointer ${c.error ? 'bg-red-dim/20' : ''}`}
                        >
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

        {/* PERFORMANCE TAB */}
        {tab === 'performance' && (
          <div className="flex flex-col gap-5 max-w-4xl mx-auto w-full">
            {!stats || stats.totalTrades === 0 ? (
              <div className="text-muted text-sm text-center py-16">No closed trades yet — performance data will appear here once trades are closed.</div>
            ) : (
              <>
                {/* Stat cards */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {[
                    { label: 'Win Rate', value: stats.winRate != null ? `${Math.round(stats.winRate * 100)}%` : '—', color: (stats.winRate ?? 0) >= 0.5 ? 'text-green' : 'text-yellow' },
                    { label: 'Risk / Reward', value: stats.riskReward != null ? stats.riskReward.toFixed(2) : '—', color: (stats.riskReward ?? 0) >= 1 ? 'text-green' : 'text-yellow' },
                    { label: 'Sharpe (ann.)', value: stats.sharpe != null ? stats.sharpe.toFixed(2) : '—', color: (stats.sharpe ?? 0) >= 1 ? 'text-green' : (stats.sharpe ?? 0) >= 0 ? 'text-yellow' : 'text-red' },
                    { label: 'Total P&L', value: `${stats.totalPnl >= 0 ? '+' : ''}$${stats.totalPnl.toFixed(2)}`, color: stats.totalPnl >= 0 ? 'text-green' : 'text-red' },
                  ].map(s => (
                    <div key={s.label} className="bg-surface border border-border rounded-lg p-4">
                      <div className="text-xs text-muted uppercase tracking-wider mb-2">{s.label}</div>
                      <div className={`text-2xl font-bold font-mono ${s.color}`}>{s.value}</div>
                    </div>
                  ))}
                </div>

                {/* Secondary stats */}
                <div className="bg-surface border border-border rounded-lg p-4">
                  <div className="text-xs font-semibold uppercase tracking-wider text-muted mb-3">Trade Breakdown</div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                    <div><span className="text-muted">Total Trades</span><span className="text-text font-semibold ml-2">{stats.totalTrades}</span></div>
                    <div><span className="text-green">Wins</span><span className="text-text font-semibold ml-2">{stats.wins}</span></div>
                    <div><span className="text-red">Losses</span><span className="text-text font-semibold ml-2">{stats.losses}</span></div>
                    <div><span className="text-muted">Total Ticks</span><span className="text-text font-semibold ml-2">{stats.totalTicks}</span></div>
                    {stats.avgWin != null && <div><span className="text-muted">Avg Win</span><span className="text-green font-semibold ml-2">+${stats.avgWin.toFixed(2)}</span></div>}
                    {stats.avgLoss != null && <div><span className="text-muted">Avg Loss</span><span className="text-red font-semibold ml-2">-${stats.avgLoss.toFixed(2)}</span></div>}
                  </div>
                </div>

                {/* Equity curve */}
                {stats.equityCurve.length > 1 && (
                  <div className="bg-surface border border-border rounded-lg p-4">
                    <div className="text-xs font-semibold uppercase tracking-wider text-muted mb-4">Equity Curve</div>
                    <ResponsiveContainer width="100%" height={200}>
                      <AreaChart data={stats.equityCurve}>
                        <defs>
                          <linearGradient id="eqGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%"  stopColor={stats.totalPnl >= 0 ? '#22c55e' : '#ef4444'} stopOpacity={0.2} />
                            <stop offset="95%" stopColor={stats.totalPnl >= 0 ? '#22c55e' : '#ef4444'} stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <XAxis dataKey="time" tick={{ fill: '#4b5563', fontSize: 9 }} tickFormatter={t => t.slice(11, 16)} />
                        <YAxis tick={{ fill: '#4b5563', fontSize: 10 }} tickFormatter={v => `$${v.toFixed(0)}`} />
                        <Tooltip
                          contentStyle={{ background: '#1a1a1f', border: '1px solid #2a2a32', borderRadius: 8, fontSize: 12 }}
                          formatter={(v: number) => [`$${v.toFixed(2)}`, 'Cum P&L']}
                          labelFormatter={t => new Date(t).toLocaleString()}
                        />
                        <Area
                          type="monotone" dataKey="cumPnl"
                          stroke={stats.totalPnl >= 0 ? '#22c55e' : '#ef4444'}
                          fill="url(#eqGrad)" strokeWidth={2} dot={false}
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* INTELLIGENCE TAB */}
        {tab === 'intelligence' && (
          <IntelligencePanel key={intelligenceKey} agentKey={agentKey} />
        )}
      </div>

      {/* Modals */}
      {showMarket && (
        <MarketDataModal
          market={agent.config.market}
          symbol={agent.config.symbol}
          onClose={() => setShowMarket(false)}
        />
      )}

      {selectedCycleId !== null && (
        <CycleDetailModal
          cycleId={selectedCycleId}
          onClose={() => setSelectedCycleId(null)}
        />
      )}
    </div>
  )
}
