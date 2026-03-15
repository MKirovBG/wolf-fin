import { useEffect, useState, useCallback } from 'react'
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, BarChart, Bar, Cell } from 'recharts'
import { getStatus } from '../api/client.ts'
import type { StatusResponse, CycleResult } from '../types/index.ts'
import { Card } from '../components/Card.tsx'
import { LogsTerminal } from '../components/LogsTerminal.tsx'
import { Badge, decisionVariant } from '../components/Badge.tsx'
import { AgentStatusBadge } from '../components/AgentStatusBadge.tsx'
import { RiskBar } from '../components/RiskBar.tsx'

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

const REFRESH_OPTS = [
  { label: '5s',  ms: 5000  },
  { label: '15s', ms: 15000 },
  { label: '30s', ms: 30000 },
  { label: 'Off', ms: 0     },
]

export function Dashboard() {
  const [data, setData] = useState<StatusResponse | null>(null)
  const [lastUpdate, setLastUpdate] = useState('')
  const [refreshMs, setRefreshMs] = useState(10000)

  const load = useCallback(async () => {
    try {
      setData(await getStatus())
      setLastUpdate(new Date().toLocaleTimeString())
    } catch { /* ignore */ }
  }, [])

  useEffect(() => {
    load()
    if (refreshMs === 0) return
    const id = setInterval(load, refreshMs)
    return () => clearInterval(id)
  }, [load, refreshMs])

  const agents = data?.agents ?? []
  const running = agents.filter(a => a.status === 'running').length
  const paused  = agents.filter(a => a.status === 'paused').length
  const idle    = agents.filter(a => a.status === 'idle').length
  const events  = data?.recentEvents ?? []
  const risk    = data?.risk ?? { dailyPnlUsd: 0, remainingBudgetUsd: 0, positionNotionalUsd: 0 }
  const maxLoss = data?.maxDailyLossUsd ?? 200

  const activityData = buildActivityData(events)

  const decisionDist = [
    { name: 'BUY',  count: events.filter(e => e.decision.toUpperCase().startsWith('BUY')).length,  color: '#00e676' },
    { name: 'SELL', count: events.filter(e => e.decision.toUpperCase().startsWith('SELL')).length, color: '#ff5252' },
    { name: 'HOLD', count: events.filter(e => e.decision.toUpperCase().startsWith('HOLD')).length, color: '#ffd740' },
  ]

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-sm font-bold tracking-widest text-white uppercase">Dashboard</h1>
        <div className="flex items-center gap-3">
          <span className="text-[11px] text-muted">Updated {lastUpdate}</span>
          <div className="flex items-center gap-1">
            <span className="text-[10px] text-muted mr-1">Refresh:</span>
            {REFRESH_OPTS.map(o => (
              <button
                key={o.label}
                onClick={() => setRefreshMs(o.ms)}
                className={`px-2 py-0.5 text-[10px] rounded border transition-colors ${
                  refreshMs === o.ms ? 'border-green text-green bg-green-dim' : 'border-border text-muted hover:border-muted'
                }`}
              >
                {o.label}
              </button>
            ))}
          </div>
          <button
            onClick={load}
            className="px-3 py-1.5 text-xs border border-border text-muted rounded hover:border-muted hover:text-white transition-colors"
          >
            ↻ Refresh
          </button>
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4 mb-4">
        <Card title="Agents">
          <div className="flex flex-col gap-2 mt-1">
            <div className="flex justify-between text-xs"><span className="text-muted">Total</span><span className="text-white font-bold">{agents.length}</span></div>
            <div className="flex justify-between text-xs"><span className="text-green">Running</span><span className="text-white font-bold">{running}</span></div>
            <div className="flex justify-between text-xs"><span className="text-yellow">Paused</span><span className="text-white font-bold">{paused}</span></div>
            <div className="flex justify-between text-xs"><span className="text-muted">Idle</span><span className="text-white font-bold">{idle}</span></div>
          </div>
        </Card>

        <Card title="Today's P&L">
          <div className="mt-1">
            <div className={`text-2xl font-bold font-mono ${risk.dailyPnlUsd >= 0 ? 'text-green' : 'text-red'}`}>
              {risk.dailyPnlUsd >= 0 ? '+' : ''}${risk.dailyPnlUsd.toFixed(2)}
            </div>
            <div className="text-muted text-[10px] mt-1">Position notional: ${risk.positionNotionalUsd.toFixed(2)}</div>
          </div>
        </Card>

        <Card title="Risk Budget">
          <div className="mt-1">
            <div className={`text-xl font-bold font-mono ${risk.remainingBudgetUsd > maxLoss * 0.5 ? 'text-green' : risk.remainingBudgetUsd > maxLoss * 0.2 ? 'text-yellow' : 'text-red'}`}>
              ${risk.remainingBudgetUsd.toFixed(2)}
            </div>
            <div className="text-muted text-[10px] mt-1">of ${maxLoss.toFixed(2)} daily limit</div>
            <div className="mt-2"><RiskBar remaining={risk.remainingBudgetUsd} total={maxLoss} /></div>
          </div>
        </Card>

        <Card title="Activity">
          <div className="flex flex-col gap-2 mt-1">
            <div className="flex justify-between text-xs"><span className="text-muted">Total Cycles</span><span className="text-white font-bold">{events.length}</span></div>
            {decisionDist.map(d => (
              <div key={d.name} className="flex justify-between text-xs">
                <span style={{ color: d.color }}>{d.name}</span>
                <span className="text-white font-bold">{d.count}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 mb-4">
        <Card title="Cycle Activity (last 20 time buckets)" className="xl:col-span-2">
          {activityData.length === 0
            ? <div className="text-muted text-xs py-8 text-center">No cycles run yet — start an agent to see activity here</div>
            : (
              <ResponsiveContainer width="100%" height={160}>
                <AreaChart data={activityData}>
                  <defs>
                    <linearGradient id="buyGrad"  x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#00e676" stopOpacity={0.2} /><stop offset="95%" stopColor="#00e676" stopOpacity={0} /></linearGradient>
                    <linearGradient id="sellGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#ff5252" stopOpacity={0.2} /><stop offset="95%" stopColor="#ff5252" stopOpacity={0} /></linearGradient>
                    <linearGradient id="holdGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#ffd740" stopOpacity={0.15} /><stop offset="95%" stopColor="#ffd740" stopOpacity={0} /></linearGradient>
                  </defs>
                  <XAxis dataKey="time" tick={{ fill: '#444', fontSize: 9 }} />
                  <YAxis tick={{ fill: '#444', fontSize: 9 }} allowDecimals={false} />
                  <Tooltip contentStyle={{ background: '#1e1e1e', border: '1px solid #2a2a2a', borderRadius: 4, fontSize: 11 }} labelStyle={{ color: '#666' }} />
                  <Area type="monotone" dataKey="buy"  stackId="1" stroke="#00e676" fill="url(#buyGrad)"  strokeWidth={1.5} dot={false} />
                  <Area type="monotone" dataKey="sell" stackId="1" stroke="#ff5252" fill="url(#sellGrad)" strokeWidth={1.5} dot={false} />
                  <Area type="monotone" dataKey="hold" stackId="1" stroke="#ffd740" fill="url(#holdGrad)" strokeWidth={1.5} dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            )
          }
        </Card>

        <Card title="Decision Distribution">
          {events.length === 0
            ? <div className="text-muted text-xs py-8 text-center">No data yet</div>
            : (
              <ResponsiveContainer width="100%" height={160}>
                <BarChart data={decisionDist} barCategoryGap="30%">
                  <XAxis dataKey="name" tick={{ fill: '#666', fontSize: 10 }} />
                  <YAxis tick={{ fill: '#444', fontSize: 9 }} allowDecimals={false} />
                  <Tooltip contentStyle={{ background: '#1e1e1e', border: '1px solid #2a2a2a', borderRadius: 4, fontSize: 11 }} labelStyle={{ color: '#666' }} cursor={{ fill: 'rgba(255,255,255,0.03)' }} />
                  <Bar dataKey="count" radius={[3, 3, 0, 0]}>
                    {decisionDist.map(d => <Cell key={d.name} fill={d.color} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )
          }
        </Card>
      </div>

      {/* Agent status strip */}
      {agents.length > 0 && (
        <Card title="Agent Overview" className="mb-4">
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3">
            {agents.map(a => {
              const key = `${a.config.market}:${a.config.symbol}`
              return (
                <div key={key} className="bg-surface2 rounded p-2.5 flex flex-col gap-1">
                  <div className="flex justify-between items-center">
                    <span className="text-white text-xs font-bold">{a.config.symbol}</span>
                    <AgentStatusBadge status={a.status} showLabel={false} />
                  </div>
                  <div className="flex gap-1">
                    <Badge label={a.config.market.toUpperCase()} variant={a.config.market} />
                    <Badge label={a.config.paper ? 'PAPER' : 'LIVE'} variant={a.config.paper ? 'paper' : 'live'} />
                  </div>
                  {a.lastCycle && (
                    <div className="flex items-center gap-1 mt-0.5">
                      <Badge label={a.lastCycle.decision.split(' ')[0]} variant={decisionVariant(a.lastCycle.decision)} />
                      <span className="text-muted text-[10px]">{rel(a.lastCycle.time)}</span>
                    </div>
                  )}
                  <div className="text-muted text-[10px]">{a.cycleCount} cycles · {a.config.fetchMode}</div>
                </div>
              )
            })}
          </div>
        </Card>
      )}

      {/* Live log terminal */}
      <div className="mb-4">
        <LogsTerminal maxHeight={400} />
      </div>

      {/* Recent events */}
      <Card title="Recent Cycles">
        {events.length === 0
          ? <p className="text-muted text-xs py-4 text-center">No events yet — start an agent or use the Trigger button</p>
          : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr>
                    {['Time', 'Symbol', 'Market', 'Decision', 'Reason', 'Mode'].map(h => (
                      <th key={h} className="text-left text-[10px] uppercase tracking-wide text-muted pb-2 pr-4 border-b border-border">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {events.map((e, i) => (
                    <tr key={i} className="hover:bg-surface2 border-b border-[#1a1a1a]">
                      <td className="py-2 pr-4 text-muted whitespace-nowrap">{rel(e.time)}</td>
                      <td className="py-2 pr-4 font-bold">{e.symbol}</td>
                      <td className="py-2 pr-4"><Badge label={e.market} variant={e.market} /></td>
                      <td className="py-2 pr-4"><Badge label={e.decision} variant={decisionVariant(e.decision)} /></td>
                      <td className="py-2 pr-4 text-muted max-w-[300px] truncate">{e.reason || '—'}</td>
                      <td className="py-2"><Badge label={e.paper ? 'PAPER' : 'LIVE'} variant={e.paper ? 'paper' : 'live'} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        }
      </Card>
    </div>
  )
}
