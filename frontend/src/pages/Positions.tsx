import { useEffect, useState, useCallback } from 'react'
import { getPositions, getTrades, closePosition, modifyPosition, cancelOrder } from '../api/client.ts'
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

function priceDp(price: number) {
  if (price > 100) return 2
  if (price > 1)   return 4
  return 6
}

// P&L cell — uses broker-provided profit for MT5
function PnLCell({ entry }: { entry: PositionEntry }) {
  if (entry.profit != null) {
    const total = entry.profit + (entry.swap ?? 0)
    return (
      <span className={`font-mono font-semibold ${total >= 0 ? 'text-green' : 'text-red'}`}>
        {total >= 0 ? '+' : ''}${total.toFixed(2)}
      </span>
    )
  }
  return <span className="text-muted">—</span>
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

// ── Inline SL editor ──────────────────────────────────────────────────────────

interface SlCellProps {
  entry: PositionEntry
  dp: number
  onSaved: () => void
}

function SlCell({ entry, dp, onSaved }: SlCellProps) {
  const [editing, setEditing] = useState(false)
  const [value, setValue]     = useState('')
  const [saving, setSaving]   = useState(false)
  const [error, setError]     = useState('')

  const startEdit = () => {
    setValue(entry.sl != null && entry.sl > 0 ? entry.sl.toFixed(dp) : '')
    setError('')
    setEditing(true)
  }

  const cancel = () => setEditing(false)

  const save = async () => {
    const sl = parseFloat(value)
    if (isNaN(sl) || sl < 0) { setError('Invalid'); return }
    setSaving(true)
    try {
      await modifyPosition(entry.orderId, entry.agentKey, sl, entry.tp ?? undefined)
      setEditing(false)
      onSaved()
    } catch {
      setError('Failed')
    } finally {
      setSaving(false)
    }
  }

  if (editing) {
    return (
      <div className="flex items-center gap-1">
        <input
          type="number"
          step="any"
          autoFocus
          value={value}
          onChange={e => { setValue(e.target.value); setError('') }}
          onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') cancel() }}
          className="w-24 px-1.5 py-0.5 text-xs font-mono bg-bg border border-blue/40 rounded text-text focus:outline-none focus:border-blue"
        />
        <button
          onClick={save}
          disabled={saving}
          className="text-[10px] px-1.5 py-0.5 rounded bg-green/20 text-green hover:bg-green/30 disabled:opacity-40 transition-colors"
        >
          {saving ? '…' : '✓'}
        </button>
        <button
          onClick={cancel}
          className="text-[10px] px-1.5 py-0.5 rounded bg-surface2 text-muted hover:text-text transition-colors"
        >
          ✕
        </button>
        {error && <span className="text-red text-[10px]">{error}</span>}
      </div>
    )
  }

  return (
    <button
      onClick={startEdit}
      title="Click to edit stop-loss"
      className="group flex items-center gap-1 font-mono text-muted text-xs hover:text-text transition-colors"
    >
      {entry.sl != null && entry.sl > 0
        ? <span className="group-hover:text-yellow">{entry.sl.toFixed(dp)}</span>
        : <span className="text-red/60 group-hover:text-red">none</span>
      }
      <span className="text-muted2 text-[9px] opacity-0 group-hover:opacity-100 transition-opacity">✎</span>
    </button>
  )
}

// ── Inline TP editor ─────────────────────────────────────────────────────────

interface TpCellProps {
  entry: PositionEntry
  dp: number
  onSaved: () => void
}

function TpCell({ entry, dp, onSaved }: TpCellProps) {
  const [editing, setEditing] = useState(false)
  const [value, setValue]     = useState('')
  const [saving, setSaving]   = useState(false)
  const [error, setError]     = useState('')

  const startEdit = () => {
    setValue(entry.tp != null && entry.tp > 0 ? entry.tp.toFixed(dp) : '')
    setError('')
    setEditing(true)
  }

  const cancel = () => setEditing(false)

  const save = async () => {
    const tp = parseFloat(value)
    if (isNaN(tp) || tp < 0) { setError('Invalid'); return }
    setSaving(true)
    try {
      await modifyPosition(entry.orderId, entry.agentKey, entry.sl ?? undefined, tp)
      setEditing(false)
      onSaved()
    } catch {
      setError('Failed')
    } finally {
      setSaving(false)
    }
  }

  if (editing) {
    return (
      <div className="flex items-center gap-1">
        <input
          type="number"
          step="any"
          autoFocus
          value={value}
          onChange={e => { setValue(e.target.value); setError('') }}
          onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') cancel() }}
          className="w-24 px-1.5 py-0.5 text-xs font-mono bg-bg border border-blue/40 rounded text-text focus:outline-none focus:border-blue"
        />
        <button
          onClick={save}
          disabled={saving}
          className="text-[10px] px-1.5 py-0.5 rounded bg-green/20 text-green hover:bg-green/30 disabled:opacity-40 transition-colors"
        >
          {saving ? '…' : '✓'}
        </button>
        <button
          onClick={cancel}
          className="text-[10px] px-1.5 py-0.5 rounded bg-surface2 text-muted hover:text-text transition-colors"
        >
          ✕
        </button>
        {error && <span className="text-red text-[10px]">{error}</span>}
      </div>
    )
  }

  return (
    <button
      onClick={startEdit}
      title="Click to edit take-profit"
      className="group flex items-center gap-1 font-mono text-muted text-xs hover:text-text transition-colors"
    >
      {entry.tp != null && entry.tp > 0
        ? <span className="group-hover:text-green">{entry.tp.toFixed(dp)}</span>
        : <span className="text-muted2 group-hover:text-muted">—</span>
      }
      <span className="text-muted2 text-[9px] opacity-0 group-hover:opacity-100 transition-opacity">✎</span>
    </button>
  )
}

// ── Close button ──────────────────────────────────────────────────────────────

interface CloseButtonProps {
  entry: PositionEntry
  onClosed: () => void
}

function CloseButton({ entry, onClosed }: CloseButtonProps) {
  const [closing, setClosing] = useState(false)
  const [error, setError]     = useState('')

  const handleClose = async () => {
    if (!confirm(`Close ${entry.side} ${entry.executedQty.toFixed(2)} lots of ${entry.symbol}?`)) return
    setClosing(true)
    setError('')
    try {
      await closePosition(entry.orderId, entry.agentKey)
      onClosed()
    } catch {
      setError('Failed')
    } finally {
      setClosing(false)
    }
  }

  return (
    <div className="flex items-center gap-1">
      <button
        onClick={handleClose}
        disabled={closing}
        className="text-[10px] px-2 py-0.5 rounded border border-red/30 text-red/70 hover:bg-red/10 hover:text-red disabled:opacity-40 transition-colors whitespace-nowrap"
      >
        {closing ? 'Closing…' : 'Close'}
      </button>
      {error && <span className="text-red text-[10px]">{error}</span>}
    </div>
  )
}

// ── Cancel button (pending orders) ───────────────────────────────────────────

interface CancelButtonProps {
  entry: PositionEntry
  onCancelled: () => void
}

function CancelButton({ entry, onCancelled }: CancelButtonProps) {
  const [cancelling, setCancelling] = useState(false)
  const [error, setError]           = useState('')

  const handleCancel = async () => {
    if (!confirm(`Cancel ${entry.side} ${entry.origQty.toFixed(2)} lots of ${entry.symbol}?`)) return
    setCancelling(true)
    setError('')
    try {
      await cancelOrder(entry.orderId, entry.agentKey)
      onCancelled()
    } catch {
      setError('Failed')
    } finally {
      setCancelling(false)
    }
  }

  return (
    <div className="flex items-center gap-1">
      <button
        onClick={handleCancel}
        disabled={cancelling}
        className="text-[10px] px-2 py-0.5 rounded border border-yellow/30 text-yellow/70 hover:bg-yellow/10 hover:text-yellow disabled:opacity-40 transition-colors whitespace-nowrap"
      >
        {cancelling ? 'Cancelling…' : 'Cancel'}
      </button>
      {error && <span className="text-red text-[10px]">{error}</span>}
    </div>
  )
}

// ── Main page ──────────────────────────────────────────────────────────────────

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
    const id = setInterval(load, 5000)
    return () => clearInterval(id)
  }, [load])

  const active  = positions.filter(p => p.status === 'OPEN' || p.status === 'PARTIALLY_FILLED')
  const pending = positions.filter(p => p.status === 'NEW')

  const totalUnrealizedPnl = active.reduce((sum, p) =>
    p.profit != null ? sum + p.profit + (p.swap ?? 0) : sum, 0
  )
  const hasMt5Pnl = active.some(p => p.profit != null)

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
        <Card title="Unrealised P&L">
          <div className="mt-1">
            {hasMt5Pnl ? (
              <span className={`text-2xl font-bold font-mono ${totalUnrealizedPnl >= 0 ? 'text-green' : 'text-red'}`}>
                {totalUnrealizedPnl >= 0 ? '+' : ''}${totalUnrealizedPnl.toFixed(2)}
              </span>
            ) : (
              <span className="text-2xl font-bold font-mono text-muted">—</span>
            )}
            <div className="text-xs text-muted mt-1">across open positions</div>
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
                        {['Agent', 'Symbol', 'Side', 'Lots', 'Entry', 'Current', 'SL', 'TP', 'Unrealised P&L', ''].map(h => (
                          <Th key={h}>{h}</Th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {active.map((p, i) => {
                        const dp = priceDp(p.price)
                        return (
                          <tr key={i} className="border-b border-border/50 hover:bg-surface2 transition-colors">
                            <td className="py-3 px-4 font-mono text-muted text-xs">{p.agentKey.split(':').slice(0,2).join(':')}</td>
                            <td className="py-3 px-4 font-bold text-text">{p.symbol}</td>
                            <td className="py-3 px-4">
                              <span className={`font-bold ${p.side === 'BUY' ? 'text-green' : 'text-red'}`}>{p.side}</span>
                            </td>
                            <td className="py-3 px-4 font-mono">{p.executedQty.toFixed(2)}</td>
                            <td className="py-3 px-4 font-mono">{p.price.toFixed(dp)}</td>
                            <td className="py-3 px-4 font-mono text-text">
                              {p.priceCurrent != null ? p.priceCurrent.toFixed(dp) : '—'}
                            </td>
                            <td className="py-3 px-4">
                              <SlCell entry={p} dp={dp} onSaved={load} />
                            </td>
                            <td className="py-3 px-4">
                              <TpCell entry={p} dp={dp} onSaved={load} />
                            </td>
                            <td className="py-3 px-4"><PnLCell entry={p} /></td>
                            <td className="py-3 px-4">
                              {p.market === 'mt5' && <CloseButton entry={p} onClosed={load} />}
                            </td>
                          </tr>
                        )
                      })}
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
                        {['Agent', 'Symbol', 'Side', 'Type', 'Qty', 'Price', 'SL', 'Status', ''].map(h => (
                          <Th key={h}>{h}</Th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {pending.map((p, i) => {
                        const dp = priceDp(p.price)
                        return (
                          <tr key={i} className="border-b border-border/50 hover:bg-surface2 transition-colors">
                            <td className="py-3 px-4 font-mono text-muted text-xs">{p.agentKey.split(':').slice(0,2).join(':')}</td>
                            <td className="py-3 px-4 font-bold text-text">{p.symbol}</td>
                            <td className="py-3 px-4">
                              <span className={`font-bold ${p.side === 'BUY' ? 'text-green' : 'text-red'}`}>{p.side}</span>
                            </td>
                            <td className="py-3 px-4 text-muted">{p.type}</td>
                            <td className="py-3 px-4 font-mono">{p.origQty.toFixed(2)}</td>
                            <td className="py-3 px-4 font-mono">{p.price > 0 ? p.price.toFixed(dp) : '—'}</td>
                            <td className="py-3 px-4 font-mono text-muted text-xs">
                              {p.sl != null && p.sl > 0 ? p.sl.toFixed(dp) : <span className="text-red/60">none</span>}
                            </td>
                            <td className="py-3 px-4"><StatusBadge status={p.status} /></td>
                            <td className="py-3 px-4">
                              {p.market === 'mt5' && <CancelButton entry={p} onCancelled={load} />}
                            </td>
                          </tr>
                        )
                      })}
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
                        {['Time', 'Agent', 'Symbol', 'Side', 'Qty', 'Price', 'Value', 'Commission'].map(h => (
                          <Th key={h}>{h}</Th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {history.map((f, i) => (
                        <tr key={i} className="border-b border-border/50 hover:bg-surface2 transition-colors">
                          <td className="py-3 px-4 text-muted whitespace-nowrap text-xs">{fmtTime(f.time)}</td>
                          <td className="py-3 px-4 font-mono text-muted text-xs">{f.agentKey.split(':').slice(0,2).join(':')}</td>
                          <td className="py-3 px-4 font-bold text-text">{f.symbol}</td>
                          <td className="py-3 px-4">
                            <span className={`font-bold ${f.isBuyer ? 'text-green' : 'text-red'}`}>
                              {f.isBuyer ? 'BUY' : 'SELL'}
                            </span>
                          </td>
                          <td className="py-3 px-4 font-mono">{f.qty.toFixed(2)}</td>
                          <td className="py-3 px-4 font-mono">{fmt(f.price, priceDp(f.price))}</td>
                          <td className="py-3 px-4 font-mono text-text">${f.quoteQty.toFixed(2)}</td>
                          <td className="py-3 px-4 font-mono text-muted text-xs">
                            {f.commission.toFixed(4)} {f.commissionAsset}
                          </td>
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
