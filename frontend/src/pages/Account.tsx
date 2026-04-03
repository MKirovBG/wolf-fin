import { useEffect, useState, useCallback } from 'react'
import { getAccounts, getPositions } from '../api/client.ts'
import type { AccountEntry, Mt5Position } from '../types/index.ts'
import { useAccount, entryToSelectedAccount } from '../contexts/AccountContext.tsx'

function usd(n: number) {
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function ModeBadge({ mode }: { mode: string }) {
  const styles: Record<string, string> = {
    LIVE: 'bg-red-dim border-red/30 text-red',
    DEMO: 'bg-yellow-dim border-yellow/30 text-yellow',
  }
  const cls = styles[mode] ?? 'bg-surface2 border-border text-muted'
  return (
    <span className={`inline-block px-2 py-0.5 rounded-md text-xs font-bold tracking-wide border ${cls}`}>
      {mode}
    </span>
  )
}

function SummaryMetric({ label, value, color = 'text-text' }: { label: string; value: string; color?: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs uppercase tracking-wider text-muted">{label}</span>
      <span className={`font-mono font-bold text-sm ${color}`}>{value}</span>
    </div>
  )
}

function SetActiveButton({ entry }: { entry: AccountEntry }) {
  const { selectedAccount, setSelectedAccount } = useAccount()
  const target = entryToSelectedAccount(entry)
  const isActive = selectedAccount?.market === target.market && selectedAccount?.accountId === target.accountId
  const [loading, setLoading] = useState(false)

  const handleClick = async () => {
    setLoading(true)
    try { await setSelectedAccount(isActive ? null : target) }
    finally { setLoading(false) }
  }

  if (isActive) {
    return (
      <button
        onClick={handleClick}
        disabled={loading}
        className="px-3 py-1 text-xs font-semibold rounded-md border border-green/40 text-green bg-green-dim hover:bg-transparent transition-colors disabled:opacity-50"
      >
        ✓ Active
      </button>
    )
  }
  return (
    <button
      onClick={handleClick}
      disabled={loading}
      className="px-3 py-1 text-xs rounded-md border border-border text-muted hover:border-green hover:text-green transition-colors disabled:opacity-50"
    >
      Set Active
    </button>
  )
}

function PositionsTable({ positions }: { positions: Mt5Position[] }) {
  if (positions.length === 0) {
    return <div className="px-5 py-3 text-xs text-muted2">No open positions</div>
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-border">
            <th className="px-5 py-2 text-left text-[10px] uppercase tracking-wider text-muted font-medium">Symbol</th>
            <th className="px-3 py-2 text-left text-[10px] uppercase tracking-wider text-muted font-medium">Side</th>
            <th className="px-3 py-2 text-right text-[10px] uppercase tracking-wider text-muted font-medium">Volume</th>
            <th className="px-3 py-2 text-right text-[10px] uppercase tracking-wider text-muted font-medium">Open</th>
            <th className="px-3 py-2 text-right text-[10px] uppercase tracking-wider text-muted font-medium">Current</th>
            <th className="px-3 py-2 text-right text-[10px] uppercase tracking-wider text-muted font-medium">SL</th>
            <th className="px-3 py-2 text-right text-[10px] uppercase tracking-wider text-muted font-medium">TP</th>
            <th className="px-3 py-2 text-right text-[10px] uppercase tracking-wider text-muted font-medium">P&L</th>
          </tr>
        </thead>
        <tbody>
          {positions.map(p => (
            <tr key={p.ticket} className="border-b border-border/50 last:border-0 hover:bg-surface2">
              <td className="px-5 py-2 font-mono text-text">{p.symbol}</td>
              <td className="px-3 py-2">
                <span className={`font-semibold ${p.side === 'BUY' ? 'text-green' : 'text-red'}`}>{p.side}</span>
              </td>
              <td className="px-3 py-2 text-right font-mono text-muted">{p.volume}</td>
              <td className="px-3 py-2 text-right font-mono text-text">{p.priceOpen.toFixed(5)}</td>
              <td className="px-3 py-2 text-right font-mono text-text">{p.priceCurrent.toFixed(5)}</td>
              <td className="px-3 py-2 text-right font-mono text-muted2">{p.sl != null ? p.sl.toFixed(5) : '—'}</td>
              <td className="px-3 py-2 text-right font-mono text-muted2">{p.tp != null ? p.tp.toFixed(5) : '—'}</td>
              <td className={`px-3 py-2 text-right font-mono font-semibold ${p.profit >= 0 ? 'text-green' : 'text-red'}`}>
                {p.profit >= 0 ? '+' : ''}{p.profit.toFixed(2)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Mt5Card({ entry }: { entry: AccountEntry }) {
  const s = entry.summary
  const [positions, setPositions]           = useState<Mt5Position[]>([])
  const [positionsLoading, setPosLoading]   = useState(false)
  const [showPositions, setShowPositions]   = useState(false)

  const loadPositions = useCallback(async () => {
    if (!entry.connected) return
    setPosLoading(true)
    try {
      const data = await getPositions(entry.id)
      setPositions(data)
    } catch { setPositions([]) }
    finally { setPosLoading(false) }
  }, [entry.id, entry.connected])

  const handleTogglePositions = async () => {
    if (!showPositions && positions.length === 0) await loadPositions()
    setShowPositions(o => !o)
  }

  return (
    <div className="bg-surface border border-border rounded-lg overflow-hidden">
      <div className="px-5 py-4 border-b border-border flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <span className="text-text font-bold text-sm">METATRADER 5</span>
          <ModeBadge mode={entry.mode} />
          <span className="flex items-center gap-1.5 text-sm">
            <span className={`w-1.5 h-1.5 rounded-full ${entry.connected ? 'bg-green' : 'bg-red'}`} />
            <span className={entry.connected ? 'text-green' : 'text-red'}>
              {entry.connected ? 'Connected' : 'Error'}
            </span>
          </span>
          {s?.login && (
            <span className="text-sm text-muted font-mono">
              #{s.login}{s.server ? ` @ ${s.server}` : ''}
              {s.name ? ` · ${s.name}` : ''}
            </span>
          )}
        </div>
        {entry.connected && <SetActiveButton entry={entry} />}
      </div>

      {!entry.connected && entry.error && (
        <div className="px-5 py-5 text-sm text-red font-mono">
          {entry.error}
        </div>
      )}

      {s && (
        <div className="px-5 py-4 grid grid-cols-2 md:grid-cols-3 gap-4">
          {s.balance   != null && <SummaryMetric label="Balance"     value={`$${usd(s.balance)}`} />}
          {s.equity    != null && <SummaryMetric label="Equity"      value={`$${usd(s.equity)}`} />}
          {s.freeMargin != null && <SummaryMetric label="Free Margin" value={`$${usd(s.freeMargin)}`} color="text-blue" />}
          {s.leverage  != null && <SummaryMetric label="Leverage"    value={`1:${s.leverage}`}  color="text-muted" />}
          {s.currency  != null && <SummaryMetric label="Currency"    value={s.currency} />}
        </div>
      )}

      {entry.connected && (
        <div className="border-t border-border">
          <button
            onClick={handleTogglePositions}
            disabled={positionsLoading}
            className="w-full px-5 py-2.5 flex items-center justify-between text-xs text-muted hover:text-text hover:bg-surface2 transition-colors disabled:opacity-50"
          >
            <span className="font-medium uppercase tracking-wider">
              Open Positions{positions.length > 0 ? ` (${positions.length})` : ''}
            </span>
            <span>{positionsLoading ? '…' : showPositions ? '▲' : '▼'}</span>
          </button>
          {showPositions && <PositionsTable positions={positions} />}
        </div>
      )}
    </div>
  )
}

export function Account() {
  const [accounts, setAccounts] = useState<AccountEntry[]>([])
  const [loading, setLoading]   = useState(true)
  const [lastUpdated, setLastUpdated] = useState('')
  const [error, setError]       = useState<string | null>(null)
  const { refreshAccounts }     = useAccount()

  const load = useCallback(async () => {
    setError(null)
    try {
      const data = await getAccounts()
      setAccounts(data)
      setLastUpdated(new Date().toLocaleTimeString())
      await refreshAccounts()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [refreshAccounts])

  useEffect(() => {
    load()
    const id = setInterval(load, 30000)
    return () => clearInterval(id)
  }, [load])

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-lg font-bold text-text">Accounts</h1>
          <p className="text-xs text-muted mt-0.5">MetaTrader 5 accounts connected via the bridge</p>
        </div>
        <div className="flex items-center gap-3">
          {lastUpdated && <span className="text-xs text-muted2">Updated {lastUpdated}</span>}
          <button
            onClick={load}
            disabled={loading}
            className="px-3 py-1.5 text-sm border border-border text-muted rounded-lg hover:border-muted2 hover:text-text transition-colors disabled:opacity-50"
          >
            ↻ Refresh
          </button>
        </div>
      </div>

      {loading && (
        <div className="py-24 text-center text-muted text-sm">Loading…</div>
      )}

      {!loading && error && (
        <div className="py-10 text-center text-red text-sm font-mono">
          Failed to load accounts: {error}
        </div>
      )}

      {!loading && !error && accounts.length === 0 && (
        <div className="py-16 text-center">
          <div className="text-4xl mb-4 opacity-30">◎</div>
          <p className="text-muted text-sm">No accounts found.</p>
          <p className="text-muted2 text-xs mt-1">Make sure the MT5 bridge is running and at least one account is configured.</p>
        </div>
      )}

      {!loading && accounts.length > 0 && (
        <div className="space-y-4">
          {accounts.map(a => (
            <Mt5Card key={a.id} entry={a} />
          ))}
        </div>
      )}
    </div>
  )
}
