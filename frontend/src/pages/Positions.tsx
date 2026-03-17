import { useEffect, useState, useCallback } from 'react'
import { getPositions, getTrades } from '../api/client.ts'
import type { PositionEntry, FillEntry } from '../types/index.ts'
import { Badge } from '../components/Badge.tsx'
import { Card } from '../components/Card.tsx'

type Tab = 'active' | 'pending' | 'history'

function fmt(n: number, decimals = 4) {
  return n.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
}

function fmtTime(ms: number) {
  return new Date(ms).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function PnLCell({ entry, currentPrices }: { entry: PositionEntry; currentPrices: Record<string, number> }) {
  const current = currentPrices[entry.symbol]
  if (!current || !entry.price || !entry.executedQty) return <span className="text-muted">—</span>
  const pnl = (current - entry.price) * entry.executedQty * (entry.side === 'BUY' ? 1 : -1)
  return (
    <span className={pnl >= 0 ? 'text-green font-mono' : 'text-red font-mono'}>
      {pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}
    </span>
  )
}

function StatusBadge({ status }: { status: string }) {
  const color =
    status === 'OPEN'             ? 'text-green border-green/30 bg-green-dim' :
    status === 'PARTIALLY_FILLED' ? 'text-yellow border-yellow/40 bg-yellow-dim' :
    status === 'NEW'              ? 'text-blue border-blue/30 bg-blue-dim' :
    'text-muted border-border'
  return (
    <span className={`text-xs font-bold uppercase tracking-wider px-2 py-0.5 rounded border ${color}`}>
      {status}
    </span>
  )
}

function EmptyState({ label }: { label: string }) {
  return (
    <div className="py-16 text-center text-muted text-sm">
      <div className="text-4xl mb-4 opacity-30">◎</div>
      {label}
    </div>
  )
}

export function Positions() {
  const [tab, setTab] = useState<Tab>('active')
  const [positions, setPositions] = useState<PositionEntry[]>([])
  const [history, setHistory] = useState<FillEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [lastUpdated, setLastUpdated] = useState('')

  const load = useCallback(async () => {
    try {
      const [pos, trades] = await Promise.all([getPositions(), getTrades()])
      setPositions(pos)
      setHistory(trades)
      setLastUpdated(new Date().toLocaleTimeString())
    } catch { /* ignore */ }
    finally { setLoading(false) }
  }, [])

  useEffect(() => {
    load()
    const id = setInterval(load, 15000)
    return () => clearInterval(id)
  }, [load])

  const currentPrices: Record<string, number> = {}
  for (const fill of history) {
    if (!currentPrices[fill.symbol]) currentPrices[fill.symbol] = fill.price
  }

  const active  = positions.filter(p => p.status === 'OPEN' || p.status === 'PARTIALLY_FILLED')
  const pending = positions.filter(p => p.status === 'NEW')

  const TABS: { id: Tab; label: string; count: number }[] = [
    { id: 'active',  label: 'Active',  count: active.length },
    { id: 'pending', label: 'Pending', count: pending.length },
    { id: 'history', label: 'History', count: history.length },
  ]

  const Th = ({ children }: { children: string }) => (
    <th className="text-left text-xs font-semibold uppercase tracking-wider text-muted py-3 px-4">{children}</th>
  )

  return (
    <div className="p-6">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-xl font-bold text-text">Positions</h1>
          <p className="text-muted text-sm mt-1">Live positions and trade history across all agents</p>
        </div>
        <div className="flex items-center gap-3">
          {lastUpdated && <span className="text-sm text-muted">Updated {lastUpdated}</span>}
          <button
            onClick={load}
            className="px-3 py-1.5 text-sm border border-border text-muted rounded-lg hover:border-muted2 hover:text-text transition-colors"
          >
            ↻ Refresh
          </button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <Card title="Active Positions">
          <div className="flex items-end gap-2 mt-1">
            <span className={`text-3xl font-bold font-mono ${active.length > 0 ? 'text-green' : 'text-muted'}`}>
              {active.length}
            </span>
            {active.length > 0 && (
              <span className="text-muted text-xs mb-1">
                {[...new Set(active.map(p => p.symbol))].join(', ')}
              </span>
            )}
          </div>
        </Card>
        <Card title="Pending Orders">
          <div className="flex items-end gap-2 mt-1">
            <span className={`text-3xl font-bold font-mono ${pending.length > 0 ? 'text-yellow' : 'text-muted'}`}>
              {pending.length}
            </span>
            {pending.length > 0 && (
              <span className="text-muted text-xs mb-1">awaiting fill</span>
            )}
          </div>
        </Card>
        <Card title="Trade History">
          <div className="flex items-end gap-2 mt-1">
            <span className="text-3xl font-bold font-mono text-text">{history.length}</span>
            <span className="text-muted text-xs mb-1">fills recorded</span>
          </div>
        </Card>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-4 border-b border-border">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-2.5 text-sm font-medium transition-colors relative -mb-px ${
              tab === t.id
                ? 'text-green border-b-2 border-green'
                : 'text-muted hover:text-text'
            }`}
          >
            {t.label}
            {t.count > 0 && (
              <span className={`ml-1.5 text-xs px-1.5 py-0.5 rounded-full ${
                tab === t.id ? 'bg-green-dim text-green' : 'bg-surface2 text-muted2'
              }`}>
                {t.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="py-16 text-center text-muted text-sm">Loading...</div>
      ) : (
        <>
          {/* Active positions */}
          {tab === 'active' && (
            active.length === 0
              ? <EmptyState label="No active positions" />
              : (
                <div className="bg-surface border border-border rounded-lg overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border">
                        {['Agent', 'Symbol', 'Side', 'Qty', 'Entry Price', 'Status', 'Mode', 'Unrealised P&L'].map(h => (
                          <Th key={h}>{h}</Th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {active.map((p, i) => (
                        <tr key={i} className="border-b border-border/50 hover:bg-surface2 transition-colors">
                          <td className="py-3 px-4 font-mono text-muted text-xs">{p.agentKey}</td>
                          <td className="py-3 px-4 font-bold text-text">{p.symbol}</td>
                          <td className="py-3 px-4">
                            <span className={`font-bold ${p.side === 'BUY' ? 'text-green' : 'text-red'}`}>{p.side}</span>
                          </td>
                          <td className="py-3 px-4 font-mono">{fmt(p.executedQty, 6)}</td>
                          <td className="py-3 px-4 font-mono">{fmt(p.price)}</td>
                          <td className="py-3 px-4"><StatusBadge status={p.status} /></td>
                          <td className="py-3 px-4"><Badge label={p.paper ? 'PAPER' : 'LIVE'} variant={p.paper ? 'paper' : 'live'} /></td>
                          <td className="py-3 px-4"><PnLCell entry={p} currentPrices={currentPrices} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
          )}

          {/* Pending orders */}
          {tab === 'pending' && (
            pending.length === 0
              ? <EmptyState label="No pending orders" />
              : (
                <div className="bg-surface border border-border rounded-lg overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border">
                        {['Agent', 'Symbol', 'Side', 'Type', 'Order Qty', 'Filled Qty', 'Price', 'Status', 'Mode'].map(h => (
                          <Th key={h}>{h}</Th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {pending.map((p, i) => (
                        <tr key={i} className="border-b border-border/50 hover:bg-surface2 transition-colors">
                          <td className="py-3 px-4 font-mono text-muted text-xs">{p.agentKey}</td>
                          <td className="py-3 px-4 font-bold text-text">{p.symbol}</td>
                          <td className="py-3 px-4">
                            <span className={`font-bold ${p.side === 'BUY' ? 'text-green' : 'text-red'}`}>{p.side}</span>
                          </td>
                          <td className="py-3 px-4 text-muted">{p.type}</td>
                          <td className="py-3 px-4 font-mono">{fmt(p.origQty, 6)}</td>
                          <td className="py-3 px-4 font-mono">{fmt(p.executedQty, 6)}</td>
                          <td className="py-3 px-4 font-mono">{p.price > 0 ? fmt(p.price) : '—'}</td>
                          <td className="py-3 px-4"><StatusBadge status={p.status} /></td>
                          <td className="py-3 px-4"><Badge label={p.paper ? 'PAPER' : 'LIVE'} variant={p.paper ? 'paper' : 'live'} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
          )}

          {/* Trade history */}
          {tab === 'history' && (
            history.length === 0
              ? <EmptyState label="No trade history yet" />
              : (
                <div className="bg-surface border border-border rounded-lg overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border">
                        {['Time', 'Agent', 'Symbol', 'Side', 'Qty', 'Price', 'Value', 'Commission', 'Mode'].map(h => (
                          <Th key={h}>{h}</Th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {history.map((f, i) => (
                        <tr key={i} className="border-b border-border/50 hover:bg-surface2 transition-colors">
                          <td className="py-3 px-4 text-muted whitespace-nowrap text-xs">{fmtTime(f.time)}</td>
                          <td className="py-3 px-4 font-mono text-muted text-xs">{f.agentKey}</td>
                          <td className="py-3 px-4 font-bold text-text">{f.symbol}</td>
                          <td className="py-3 px-4">
                            <span className={`font-bold ${f.isBuyer ? 'text-green' : 'text-red'}`}>
                              {f.isBuyer ? 'BUY' : 'SELL'}
                            </span>
                          </td>
                          <td className="py-3 px-4 font-mono">{fmt(f.qty, 6)}</td>
                          <td className="py-3 px-4 font-mono">{fmt(f.price)}</td>
                          <td className="py-3 px-4 font-mono text-text">${fmt(f.quoteQty, 2)}</td>
                          <td className="py-3 px-4 font-mono text-muted text-xs">
                            {fmt(f.commission, 6)} {f.commissionAsset}
                          </td>
                          <td className="py-3 px-4"><Badge label={f.paper ? 'PAPER' : 'LIVE'} variant={f.paper ? 'paper' : 'live'} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
          )}
        </>
      )}
    </div>
  )
}
