import { useEffect, useState, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, BarChart, Bar, Cell } from 'recharts'
import { getStatus } from '../api/client.ts'
import type { StatusResponse, CycleResult, AgentState } from '../types/index.ts'
import { Card } from '../components/Card.tsx'
import { ThreadedLogsPanel } from '../components/ThreadedLogsPanel.tsx'
import { Badge, decisionVariant } from '../components/Badge.tsx'
import { AgentStatusBadge } from '../components/AgentStatusBadge.tsx'

function rel(iso: string) {
  const d = Date.now() - new Date(iso).getTime()
  if (d < 60000) return `${Math.floor(d / 1000)}s ago`
  if (d < 3600000) return `${Math.floor(d / 60000)}m ago`
  return `${Math.floor(d / 3600000)}h ago`
}

function buildActivityData(events: CycleResult[]) {
  const buckets: Record<string, { time: string; buy: number; sell: number; hold: number }> = {}
  for (const e of [...events].reverse()) {
    const t = new Date(e.time)
    const label = t.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    if (!buckets[label]) buckets[label] = { time: label, buy: 0, sell: 0, hold: 0 }
    const d = e.decision.toUpperCase()
    if (d.startsWith('BUY')) buckets[label].buy++
    else if (d.startsWith('SELL')) buckets[label].sell++
    else buckets[label].hold++
  }
  return Object.values(buckets).slice(-20)
}

export function Dashboard() {
  const [data, setData] = useState<StatusResponse | null>(null)
  const [lastUpdate, setLastUpdate] = useState('')

  const load = useCallback(async () => {
    try {
      setData(await getStatus())
      setLastUpdate(new Date().toLocaleTimeString())
    } catch { /* ignore */ }
  }, [])

  // Initial load
  useEffect(() => { load() }, [load])

  // SSE: apply individual agent updates in real-time, no polling needed
  useEffect(() => {
    const es = new EventSource('/api/events')
    es.addEventListener('agent', (e: MessageEvent) => {
      try {
        const updated = JSON.parse(e.data) as AgentState & { agentKey: string }
        setLastUpdate(new Date().toLocaleTimeString())
        setData(prev => {
          if (!prev) return prev
          const agents = prev.agents.some(a => a.agentKey === updated.agentKey)
            ? prev.agents.map(a => a.agentKey === updated.agentKey ? updated : a)
            : [...prev.agents, updated]
          const recentEvents = updated.lastCycle
            ? [updated.lastCycle, ...prev.recentEvents].slice(0, 100)
            : prev.recentEvents
          return { ...prev, agents, recentEvents }
        })
      } catch { /* ignore */ }
    })
    return () => es.close()
  }, [])

  const agents = data?.agents ?? []
  const running = agents.filter(a => a.status === 'running').length
  const paused  = agents.filter(a => a.status === 'paused').length
  const idle    = agents.filter(a => a.status === 'idle').length
  const events  = data?.recentEvents ?? []
  const risk    = data?.risk ?? { dailyPnlUsd: 0, remainingBudgetUsd: 0, positionNotionalUsd: 0 }

  // Compute P&L stats from recent events that have pnlUsd
  const closedTrades   = events.filter(e => e.pnlUsd != null)
  const totalPnl       = closedTrades.reduce((s, e) => s + (e.pnlUsd ?? 0), 0)
  const wins           = closedTrades.filter(e => (e.pnlUsd ?? 0) > 0).length
  const winRate        = closedTrades.length > 0 ? Math.round(wins / closedTrades.length * 100) : null

  const activityData = buildActivityData(events)

  // Equity curve from recent closed trades
  const closedChron = [...closedTrades].reverse()
  let cumPnl = 0
  const equityCurveData = closedChron.map(e => {
    cumPnl += e.pnlUsd ?? 0
    return { time: e.time, cumPnl: parseFloat(cumPnl.toFixed(2)) }
  })

  const decisionDist = [
    { name: 'BUY',  count: events.filter(e => e.decision.toUpperCase().startsWith('BUY')).length,  color: '#22c55e' },
    { name: 'SELL', count: events.filter(e => e.decision.toUpperCase().startsWith('SELL')).length, color: '#ef4444' },
    { name: 'HOLD', count: events.filter(e => e.decision.toUpperCase().startsWith('HOLD')).length, color: '#f59e0b' },
  ]

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-xl font-bold text-text">Dashboard</h1>
        <div className="flex items-center gap-3">
          <span className="text-sm text-muted">Updated {lastUpdate}</span>
          <div className="flex items-center gap-1.5">
            <span className="text-[9px] px-1.5 py-0.5 rounded text-green bg-green-dim">● LIVE</span>
            <button onClick={load} className="px-2.5 py-1 text-xs border border-border text-muted rounded-lg hover:border-muted2 hover:text-text transition-colors">↻</button>
          </div>
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4 mb-4">
        <Card title="Agents">
          <div className="flex flex-col gap-2 mt-1">
            <div className="flex justify-between text-sm"><span className="text-muted">Total</span><span className="text-text font-semibold">{agents.length}</span></div>
            <div className="flex justify-between text-sm"><span className="text-green">Running</span><span className="text-text font-semibold">{running}</span></div>
            <div className="flex justify-between text-sm"><span className="text-yellow">Paused</span><span className="text-text font-semibold">{paused}</span></div>
            <div className="flex justify-between text-sm"><span className="text-muted">Idle</span><span className="text-text font-semibold">{idle}</span></div>
          </div>
        </Card>

        <Card title="Closed Trade P&L">
          <div className="mt-1">
            <div className={`text-2xl font-bold font-mono ${totalPnl >= 0 ? 'text-green' : 'text-red'}`}>
              {totalPnl >= 0 ? '+' : ''}${totalPnl.toFixed(2)}
            </div>
            <div className="flex gap-3 mt-1.5 text-xs text-muted">
              <span>{closedTrades.length} closed</span>
              {winRate !== null && <span className={winRate >= 50 ? 'text-green' : 'text-yellow'}>{winRate}% win rate</span>}
            </div>
          </div>
        </Card>

        <Card title="Open Exposure">
          <div className="mt-1">
            <div className="text-xl font-bold font-mono text-text">
              ${risk.positionNotionalUsd.toFixed(0)}
            </div>
            <div className="text-muted text-xs mt-1.5">notional across all positions</div>
          </div>
        </Card>

        <Card title="Activity">
          <div className="flex flex-col gap-2 mt-1">
            <div className="flex justify-between text-sm"><span className="text-muted">Total Ticks</span><span className="text-text font-semibold">{events.length}</span></div>
            {decisionDist.map(d => (
              <div key={d.name} className="flex justify-between text-sm">
                <span style={{ color: d.color }}>{d.name}</span>
                <span className="text-text font-semibold">{d.count}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 mb-4">
        <Card title="Cycle Activity (last 20 time buckets)" className="xl:col-span-2">
          {activityData.length === 0
            ? <div className="text-muted text-sm py-8 text-center">No cycles run yet — start an agent to see activity here</div>
            : (
              <ResponsiveContainer width="100%" height={160}>
                <AreaChart data={activityData}>
                  <defs>
                    <linearGradient id="buyGrad"  x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#22c55e" stopOpacity={0.2} /><stop offset="95%" stopColor="#22c55e" stopOpacity={0} /></linearGradient>
                    <linearGradient id="sellGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#ef4444" stopOpacity={0.2} /><stop offset="95%" stopColor="#ef4444" stopOpacity={0} /></linearGradient>
                    <linearGradient id="holdGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#f59e0b" stopOpacity={0.15} /><stop offset="95%" stopColor="#f59e0b" stopOpacity={0} /></linearGradient>
                  </defs>
                  <XAxis dataKey="time" tick={{ fill: '#4b5563', fontSize: 10, fontFamily: 'Inter' }} />
                  <YAxis tick={{ fill: '#4b5563', fontSize: 10, fontFamily: 'Inter' }} allowDecimals={false} />
                  <Tooltip contentStyle={{ background: '#1a1a1f', border: '1px solid #2a2a32', borderRadius: 8, fontSize: 12, fontFamily: 'Inter' }} labelStyle={{ color: '#6b7280' }} />
                  <Area type="monotone" dataKey="buy"  stackId="1" stroke="#22c55e" fill="url(#buyGrad)"  strokeWidth={1.5} dot={false} />
                  <Area type="monotone" dataKey="sell" stackId="1" stroke="#ef4444" fill="url(#sellGrad)" strokeWidth={1.5} dot={false} />
                  <Area type="monotone" dataKey="hold" stackId="1" stroke="#f59e0b" fill="url(#holdGrad)" strokeWidth={1.5} dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            )
          }
        </Card>

        <Card title="Decision Distribution">
          {events.length === 0
            ? <div className="text-muted text-sm py-8 text-center">No data yet</div>
            : (
              <ResponsiveContainer width="100%" height={160}>
                <BarChart data={decisionDist} barCategoryGap="30%">
                  <XAxis dataKey="name" tick={{ fill: '#6b7280', fontSize: 11, fontFamily: 'Inter' }} />
                  <YAxis tick={{ fill: '#4b5563', fontSize: 10, fontFamily: 'Inter' }} allowDecimals={false} />
                  <Tooltip contentStyle={{ background: '#1a1a1f', border: '1px solid #2a2a32', borderRadius: 8, fontSize: 12, fontFamily: 'Inter' }} labelStyle={{ color: '#6b7280' }} cursor={{ fill: 'rgba(255,255,255,0.03)' }} />
                  <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                    {decisionDist.map(d => <Cell key={d.name} fill={d.color} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )
          }
        </Card>
      </div>

      {/* Equity curve */}
      {equityCurveData.length > 1 && (
        <Card title="Equity Curve (all agents)" className="mb-4">
          <ResponsiveContainer width="100%" height={160}>
            <AreaChart data={equityCurveData}>
              <defs>
                <linearGradient id="eqDashGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor={cumPnl >= 0 ? '#22c55e' : '#ef4444'} stopOpacity={0.2} />
                  <stop offset="95%" stopColor={cumPnl >= 0 ? '#22c55e' : '#ef4444'} stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="time" tick={{ fill: '#4b5563', fontSize: 9 }} tickFormatter={t => t.slice(11, 16)} />
              <YAxis tick={{ fill: '#4b5563', fontSize: 10 }} tickFormatter={v => `$${(v as number).toFixed(0)}`} />
              <Tooltip
                contentStyle={{ background: '#1a1a1f', border: '1px solid #2a2a32', borderRadius: 8, fontSize: 12 }}
                formatter={(v: number) => [`$${v.toFixed(2)}`, 'Cum P&L']}
                labelFormatter={t => new Date(t as string).toLocaleString()}
              />
              <Area type="monotone" dataKey="cumPnl" stroke={cumPnl >= 0 ? '#22c55e' : '#ef4444'} fill="url(#eqDashGrad)" strokeWidth={2} dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        </Card>
      )}

      {/* Agent status strip */}
      {agents.length > 0 && (
        <Card title="Agent Overview" className="mb-4">
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3">
            {agents.map(a => {
              const key = a.agentKey
              const model = a.config.llmModel ?? (a.config.llmProvider === 'openrouter' ? 'openrouter' : 'claude')
              const shortModel = model.split('/').pop()?.replace('claude-', '').replace('anthropic/', '') ?? model
              return (
                <Link key={key} to={`/agents/k/${encodeURIComponent(key)}`} className="bg-surface2 rounded-lg p-3 flex flex-col gap-1.5 hover:bg-surface transition-colors border border-transparent hover:border-border">
                  <div className="flex justify-between items-center">
                    <div>
                      <span className="text-text text-sm font-bold">{a.config.symbol}</span>
                      {a.config.name && <span className="text-muted text-xs ml-1.5">({a.config.name})</span>}
                    </div>
                    <AgentStatusBadge status={a.status} showLabel={false} />
                  </div>
                  <div className="flex gap-1.5 flex-wrap">
                    <Badge label={a.config.market.toUpperCase()} variant={a.config.market} />
                    <span className="text-[10px] text-muted border border-border rounded px-1 py-0.5">{shortModel}</span>
                  </div>
                  {a.lastCycle && (
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <Badge label={a.lastCycle.decision.split(' ')[0]} variant={decisionVariant(a.lastCycle.decision)} />
                      <span className="text-muted text-xs">{rel(a.lastCycle.time)}</span>
                      {a.lastCycle.pnlUsd != null && (
                        <span className={`text-xs font-mono ml-auto ${a.lastCycle.pnlUsd >= 0 ? 'text-green' : 'text-red'}`}>
                          {a.lastCycle.pnlUsd >= 0 ? '+' : ''}${a.lastCycle.pnlUsd.toFixed(2)}
                        </span>
                      )}
                    </div>
                  )}
                  <div className="text-muted text-xs">{a.cycleCount} ticks · {a.config.fetchMode}</div>
                </Link>
              )
            })}
          </div>
        </Card>
      )}

      {/* Live threaded logs */}
      <div className="mb-4">
        <ThreadedLogsPanel maxThreads={10} />
      </div>

    </div>
  )
}
