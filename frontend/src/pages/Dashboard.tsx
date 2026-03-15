import { useEffect, useState, useCallback } from 'react'
import { getStatus, pause, resume } from '../api/client.ts'
import type { StatusResponse } from '../types/index.ts'
import { Card } from '../components/Card.tsx'
import { Metric } from '../components/Metric.tsx'
import { Badge, decisionVariant } from '../components/Badge.tsx'
import { StatusDot } from '../components/StatusDot.tsx'
import { RiskBar } from '../components/RiskBar.tsx'

function rel(iso: string) {
  const d = Date.now() - new Date(iso).getTime()
  if (d < 60000) return `${Math.floor(d / 1000)}s ago`
  if (d < 3600000) return `${Math.floor(d / 60000)}m ago`
  return `${Math.floor(d / 3600000)}h ago`
}

export function Dashboard() {
  const [data, setData] = useState<StatusResponse | null>(null)
  const [lastUpdate, setLastUpdate] = useState<string>('')
  const [actioning, setActioning] = useState(false)

  const load = useCallback(async () => {
    try {
      setData(await getStatus())
      setLastUpdate(new Date().toLocaleTimeString())
    } catch { /* ignore */ }
  }, [])

  useEffect(() => {
    load()
    const id = setInterval(load, 10000)
    return () => clearInterval(id)
  }, [load])

  const doPause = async () => { setActioning(true); await pause(); await load(); setActioning(false) }
  const doResume = async () => { setActioning(true); await resume(); await load(); setActioning(false) }

  if (!data) return <div className="p-6 text-muted text-sm">Loading...</div>

  const pnl = data.risk.dailyPnlUsd
  const budget = data.risk.remainingBudgetUsd

  return (
    <div className="p-6">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-sm font-bold tracking-widest text-white uppercase">Dashboard</h1>
        <div className="flex items-center gap-4">
          <span className="text-[11px] text-muted">Updated {lastUpdate}</span>
          <button
            disabled={data.paused || data.status === 'idle' || actioning}
            onClick={doPause}
            className="px-3 py-1.5 text-xs border border-yellow text-yellow rounded hover:bg-yellow-dim disabled:opacity-25 disabled:cursor-default transition-colors"
          >
            Pause
          </button>
          <button
            disabled={!data.paused || actioning}
            onClick={doResume}
            className="px-3 py-1.5 text-xs border border-green text-green rounded hover:bg-green-dim disabled:opacity-25 disabled:cursor-default transition-colors"
          >
            Resume
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 mb-6">
        <Card title="Agent Status">
          <Metric label="Status" value={<span><StatusDot status={data.status} />{data.status.toUpperCase()}</span>} />
          <Metric label="Mode" value={<Badge label={data.paperMode ? 'PAPER' : 'LIVE'} variant={data.paperMode ? 'paper' : 'live'} />} />
          <Metric label="Started" value={<span className="text-xs">{data.startedAt ? new Date(data.startedAt).toLocaleString() : '—'}</span>} />
          <Metric label="Markets" value={<span className="text-xs">{data.configs.map(c => `${c.symbol}`).join(', ') || '—'}</span>} />
        </Card>

        <Card title="Risk State (Today)">
          <Metric
            label="Daily P&L"
            value={<span className={pnl >= 0 ? 'text-green' : 'text-red'}>{pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}</span>}
          />
          <Metric
            label="Remaining Budget"
            value={<span className={budget > data.maxDailyLossUsd * 0.5 ? 'text-green' : budget > data.maxDailyLossUsd * 0.2 ? 'text-yellow' : 'text-red'}>${budget.toFixed(2)}</span>}
          />
          <Metric label="Position Notional" value={`$${data.risk.positionNotionalUsd.toFixed(2)}`} />
          <Metric label="Daily Limit" value={`$${data.maxDailyLossUsd.toFixed(2)}`} />
          <RiskBar remaining={budget} total={data.maxDailyLossUsd} />
        </Card>

        <Card title="Active Configs">
          {data.configs.length === 0
            ? <p className="text-muted text-xs">No agents configured</p>
            : data.configs.map(c => (
                <div key={`${c.market}:${c.symbol}`} className="flex justify-between items-center mb-3 last:mb-0">
                  <span className="text-sm font-bold">{c.symbol}</span>
                  <div className="flex gap-1.5">
                    <Badge label={c.market.toUpperCase()} variant={c.market} />
                    <Badge label={c.paper !== false ? 'PAPER' : 'LIVE'} variant={c.paper !== false ? 'paper' : 'live'} />
                  </div>
                </div>
              ))
          }
        </Card>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 mb-4">
        <Card title="Last Decisions">
          {Object.values(data.lastCycleByKey).length === 0
            ? <p className="text-muted text-xs">No cycles run yet</p>
            : Object.values(data.lastCycleByKey).map(c => (
                <div key={`${c.market}:${c.symbol}`} className="mb-4 pb-4 border-b border-border last:mb-0 last:pb-0 last:border-0">
                  <div className="flex justify-between items-center mb-2">
                    <span className="text-[11px] text-muted">{c.symbol} · {c.market.toUpperCase()} · {rel(c.time)}</span>
                    <Badge label={c.paper ? 'PAPER' : 'LIVE'} variant={c.paper ? 'paper' : 'live'} />
                  </div>
                  <Badge label={c.decision} variant={decisionVariant(c.decision)} />
                  {c.reason && <p className="text-muted text-[11px] mt-1.5 leading-relaxed">{c.reason}</p>}
                  {c.error && <p className="text-red text-[11px] mt-1">Error: {c.error}</p>}
                </div>
              ))
          }
        </Card>
      </div>

      <Card title="Recent Cycles">
        {data.recentEvents.length === 0
          ? <p className="text-muted text-xs">No events yet</p>
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
                  {data.recentEvents.map((e, i) => (
                    <tr key={i} className="hover:bg-surface2 border-b border-[#1a1a1a]">
                      <td className="py-2 pr-4 text-muted whitespace-nowrap">{rel(e.time)}</td>
                      <td className="py-2 pr-4 font-bold">{e.symbol}</td>
                      <td className="py-2 pr-4"><Badge label={e.market} variant={e.market} /></td>
                      <td className="py-2 pr-4"><Badge label={e.decision} variant={decisionVariant(e.decision)} /></td>
                      <td className="py-2 pr-4 text-muted max-w-[280px] truncate">{e.reason || '—'}</td>
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
