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

function buildChartData(events: CycleResult[]) {
  const sorted = [...events].sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime())
  let cryptoPnl = 0
  let mt5Pnl = 0
  return sorted.map(e => {
    if (e.market === 'crypto') cryptoPnl += e.pnlUsd ?? 0
    if (e.market === 'mt5') mt5Pnl += e.pnlUsd ?? 0
    return {
      time: new Date(e.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      crypto: parseFloat(cryptoPnl.toFixed(2)),
      mt5: parseFloat(mt5Pnl.toFixed(2)),
    }
  })
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
  const chartData = buildChartData(trades)

  const StatCard = ({ market, data }: { market: string; data: ReportSummary['crypto'] }) => {
    const winRate = data.totalCycles > 0 ? ((data.buys + data.sells) / data.totalCycles * 100).toFixed(0) : '0'
    return (
      <Card title={`${market.toUpperCase()} Summary`}>
        <div className="grid grid-cols-3 gap-3 mb-3">
          {[
            { label: 'Cycles', value: data.totalCycles },
            { label: 'Buys', value: data.buys },
            { label: 'Sells', value: data.sells },
            { label: 'Holds', value: data.holds },
            { label: 'Errors', value: data.errors },
            { label: 'Active %', value: `${winRate}%` },
          ].map(m => (
            <div key={m.label} className="bg-surface2 rounded p-2 text-center">
              <div className="text-[10px] text-muted uppercase tracking-wide mb-1">{m.label}</div>
              <div className="text-sm font-bold">{m.value}</div>
            </div>
          ))}
        </div>
        <div className="border-t border-border pt-3 space-y-2">
          <div className="flex justify-between text-xs">
            <span className="text-muted">Daily P&L</span>
            <span className={data.risk.dailyPnlUsd >= 0 ? 'text-green' : 'text-red'}>
              {data.risk.dailyPnlUsd >= 0 ? '+' : ''}${data.risk.dailyPnlUsd.toFixed(2)}
            </span>
          </div>
          <div className="flex justify-between text-xs">
            <span className="text-muted">Budget Left</span>
            <span>${data.risk.remainingBudgetUsd.toFixed(2)}</span>
          </div>
        </div>
      </Card>
    )
  }

  if (loading) return <div className="p-6 text-muted text-sm">Loading...</div>

  return (
    <div className="p-6">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-sm font-bold tracking-widest text-white uppercase">Reports</h1>
        <button onClick={load} className="px-3 py-1.5 text-xs border border-border text-muted rounded hover:text-white hover:border-white transition-colors">
          Refresh
        </button>
      </div>

      {summary && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          <StatCard market="crypto" data={summary.crypto} />
          <StatCard market="mt5" data={summary.mt5} />
        </div>
      )}

      <Card title="Cycle Activity" className="mb-4">
        {chartData.length < 2
          ? <p className="text-muted text-xs">Not enough data for chart. Run a few cycles first.</p>
          : (
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={chartData}>
                <XAxis dataKey="time" stroke="#444" tick={{ fill: '#666', fontSize: 10 }} />
                <YAxis stroke="#444" tick={{ fill: '#666', fontSize: 10 }} />
                <Tooltip
                  contentStyle={{ background: '#161616', border: '1px solid #2a2a2a', borderRadius: 4, fontSize: 11 }}
                  labelStyle={{ color: '#666' }}
                />
                <Legend wrapperStyle={{ fontSize: 11, color: '#666' }} />
                <Line type="monotone" dataKey="crypto" stroke="#448aff" strokeWidth={1.5} dot={false} />
                <Line type="monotone" dataKey="mt5" stroke="#00e676" strokeWidth={1.5} dot={false} />
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
              className={`px-3 py-1 text-[11px] rounded border transition-colors ${
                filter === f
                  ? 'border-green text-green bg-green-dim'
                  : 'border-border text-muted hover:text-white hover:border-muted'
              }`}
            >
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
          <span className="ml-auto text-[11px] text-muted self-center">{filtered.length} records</span>
        </div>
        {filtered.length === 0
          ? <p className="text-muted text-xs">No cycles yet</p>
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
                  {filtered.map((e, i) => (
                    <tr
                      key={i}
                      onClick={() => e.id != null && setSelectedCycleId(e.id)}
                      className={`border-b border-[#1a1a1a] transition-colors ${e.id != null ? 'hover:bg-surface2 cursor-pointer' : ''}`}
                    >
                      <td className="py-2 pr-4 text-muted whitespace-nowrap">{rel(e.time)}</td>
                      <td className="py-2 pr-4 font-bold">{e.symbol}</td>
                      <td className="py-2 pr-4"><Badge label={e.market} variant={e.market} /></td>
                      <td className="py-2 pr-4"><Badge label={e.decision} variant={decisionVariant(e.decision)} /></td>
                      <td className="py-2 pr-4 text-muted max-w-[280px] truncate">{e.reason || '—'}</td>
                      <td className="py-2 pr-4"><Badge label={e.paper ? 'PAPER' : 'LIVE'} variant={e.paper ? 'paper' : 'live'} /></td>
                      <td className="py-2 text-[9px] text-muted2">{e.id != null ? '→' : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
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
