import { useEffect, useState, useCallback } from 'react'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from 'recharts'
import { getReportSummary, getReportTrades } from '../api/client.ts'
import type { ReportSummary, CycleResult } from '../types/index.ts'
import { Card } from '../components/Card.tsx'
import { Badge, decisionVariant } from '../components/Badge.tsx'
import { CycleDetailModal } from '../components/CycleDetailModal.tsx'

function rel(iso: string) {
  const d = Date.now() - new Date(iso).getTime()
  if (d < 60000) return `${Math.floor(d / 1000)}s ago`
  if (d < 3600000) return `${Math.floor(d / 60000)}m ago`
  return `${Math.floor(d / 3600000)}h ago`
}

// Per-agent colour palette (cycles if > 8 agents)
const AGENT_COLORS = ['#22c55e', '#3b82f6', '#f59e0b', '#a78bfa', '#ef4444', '#06b6d4', '#f97316', '#ec4899']

function buildChartData(events: CycleResult[]) {
  const sorted = [...events].sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime())
  const agentKeys = Array.from(new Set(sorted.map(e => e.agentKey ?? `${e.market}:${e.symbol}`)))
  const running: Record<string, number> = {}
  agentKeys.forEach(k => { running[k] = 0 })

  return {
    data: sorted.map(e => {
      const key = e.agentKey ?? `${e.market}:${e.symbol}`
      running[key] = parseFloat((running[key] + (e.pnlUsd ?? 0)).toFixed(2))
      return {
        time: new Date(e.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        ...Object.fromEntries(agentKeys.map(k => [k, running[k]])),
      }
    }),
    agentKeys,
  }
}

export function Reports() {
  const [summary, setSummary] = useState<ReportSummary | null>(null)
  const [trades, setTrades] = useState<CycleResult[]>([])
  const [filter, setFilter] = useState<'all' | 'crypto' | 'mt5'>('all')
  const [selectedCycleId, setSelectedCycleId] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [s, t] = await Promise.all([getReportSummary(), getReportTrades()])
      setSummary(s)
      setTrades(t)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const filtered = filter === 'all' ? trades : trades.filter(t => t.market === filter)
  const { data: chartData, agentKeys: chartAgentKeys } = buildChartData(trades)

  const StatCard = ({ market, data }: { market: string; data: ReportSummary['crypto'] }) => {
    const winRate = data.totalCycles > 0 ? ((data.buys + data.sells) / data.totalCycles * 100).toFixed(0) : '0'
    return (
      <Card title={`${market.toUpperCase()} Summary`}>
        <div className="grid grid-cols-3 gap-3 mb-4">
          {[
            { label: 'Cycles', value: data.totalCycles },
            { label: 'Buys', value: data.buys },
            { label: 'Sells', value: data.sells },
            { label: 'Holds', value: data.holds },
            { label: 'Errors', value: data.errors },
            { label: 'Active %', value: `${winRate}%` },
          ].map(m => (
            <div key={m.label} className="bg-surface2 rounded-lg p-2.5 text-center">
              <div className="text-xs text-muted uppercase tracking-wider mb-1">{m.label}</div>
              <div className="text-sm font-bold text-text">{m.value}</div>
            </div>
          ))}
        </div>
        <div className="border-t border-border pt-3 space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-muted">Daily P&L</span>
            <span className={`font-mono font-semibold ${data.risk.dailyPnlUsd >= 0 ? 'text-green' : 'text-red'}`}>
              {data.risk.dailyPnlUsd >= 0 ? '+' : ''}${data.risk.dailyPnlUsd.toFixed(2)}
            </span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-muted">Budget Left</span>
            <span className="font-mono font-semibold">${data.risk.remainingBudgetUsd.toFixed(2)}</span>
          </div>
        </div>
      </Card>
    )
  }

  if (loading) return <div className="p-6 text-muted text-sm">Loading...</div>

  return (
    <div className="p-6">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-xl font-bold text-text">Reports</h1>
        <button onClick={load} className="px-3 py-1.5 text-sm border border-border text-muted rounded-lg hover:text-text hover:border-muted2 transition-colors">
          ↻ Refresh
        </button>
      </div>

      {summary && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          <StatCard market="crypto" data={summary.crypto} />
          <StatCard market="mt5" data={summary.mt5} />
        </div>
      )}

      <Card title="Cumulative P&L by Agent" className="mb-4">
        {chartData.length < 2
          ? <p className="text-muted text-sm">Not enough data for chart. Run a few cycles first.</p>
          : (
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={chartData}>
                <XAxis dataKey="time" stroke="#2a2a32" tick={{ fill: '#6b7280', fontSize: 11, fontFamily: 'Inter' }} />
                <YAxis stroke="#2a2a32" tick={{ fill: '#6b7280', fontSize: 10, fontFamily: 'Inter' }} tickFormatter={v => `$${v}`} />
                <Tooltip
                  contentStyle={{ background: '#111113', border: '1px solid #2a2a32', borderRadius: 8, fontSize: 12, fontFamily: 'Inter' }}
                  labelStyle={{ color: '#6b7280' }}
                  formatter={(v: number) => [`$${v.toFixed(2)}`, undefined]}
                />
                <Legend wrapperStyle={{ fontSize: 11, fontFamily: 'Inter', color: '#6b7280' }} />
                {chartAgentKeys.map((key, i) => (
                  <Line
                    key={key}
                    type="monotone"
                    dataKey={key}
                    name={key.split(':').slice(0, 2).join(':')}
                    stroke={AGENT_COLORS[i % AGENT_COLORS.length]}
                    strokeWidth={1.5}
                    dot={false}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          )
        }
      </Card>

      <Card title="Trade History">
        <div className="flex gap-2 mb-4">
          {(['all', 'crypto', 'mt5'] as const).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1.5 text-sm rounded-lg border transition-colors ${
                filter === f
                  ? 'border-green text-green bg-green-dim'
                  : 'border-border text-muted hover:text-text hover:border-muted2'
              }`}
            >
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
          <span className="ml-auto text-xs text-muted self-center font-mono">
            {filtered.length} record{filtered.length !== 1 ? 's' : ''}
          </span>
        </div>
        {filtered.length === 0
          ? <p className="text-muted text-sm">No cycles yet</p>
          : (
            /* Outer wrapper: horizontal scroll if table is wide */
            <div className="overflow-x-auto">
              {/* Fixed-height scrollable body — ~15 rows visible */}
              <div
                className="overflow-y-auto"
                style={{
                  maxHeight: '480px',
                  scrollbarWidth: 'thin',
                  scrollbarColor: '#2a2a32 #111113',
                }}
              >
                <table className="w-full text-sm">
                  {/* Sticky header stays in view while scrolling */}
                  <thead className="sticky top-0 z-10 bg-surface">
                    <tr>
                      {['Time', 'Symbol', 'Market', 'Decision', 'Reason', 'Mode', ''].map(h => (
                        <th key={h} className="text-left text-xs font-semibold uppercase tracking-wider text-muted py-2.5 pr-4 border-b border-border bg-surface">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((e, i) => (
                      <tr
                        key={i}
                        onClick={() => e.id != null && setSelectedCycleId(e.id)}
                        className={`border-b border-border/40 transition-colors ${e.id != null ? 'hover:bg-surface2 cursor-pointer' : ''}`}
                      >
                        <td className="py-2.5 pr-4 text-muted whitespace-nowrap text-xs">{rel(e.time)}</td>
                        <td className="py-2.5 pr-4 font-semibold text-xs">{e.symbol}</td>
                        <td className="py-2.5 pr-4"><Badge label={e.market} variant={e.market} /></td>
                        <td className="py-2.5 pr-4"><Badge label={e.decision} variant={decisionVariant(e.decision)} /></td>
                        <td className="py-2.5 pr-4 text-muted max-w-[260px] truncate text-xs">{e.reason || '—'}</td>
                        <td className="py-2.5 pr-4"><Badge label={e.paper ? 'PAPER' : 'LIVE'} variant={e.paper ? 'paper' : 'live'} /></td>
                        <td className="py-2.5 text-xs text-muted2 opacity-40">{e.id != null ? '→' : ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )
        }
      </Card>

      {selectedCycleId != null && (
        <CycleDetailModal
          cycleId={selectedCycleId}
          onClose={() => setSelectedCycleId(null)}
        />
      )}
    </div>
  )
}
