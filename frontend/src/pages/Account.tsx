import { useEffect, useState, useCallback } from 'react'
import { getAccounts } from '../api/client.ts'
import type { AccountEntry, BinanceAccountEntry, Mt5AccountEntry, BinanceBalance, BinanceOpenOrder, Mt5Position } from '../types/index.ts'
import { useAccount, entryToSelectedAccount } from '../contexts/AccountContext.tsx'

// ── Helpers ────────────────────────────────────────────────────────────────────

function usd(n: number, decimals = 2) {
  return n.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
}

function fmtTimestamp(ms: number) {
  return new Date(ms).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

// ── Small reusable pieces ──────────────────────────────────────────────────────

function ModeBadge({ mode }: { mode: string }) {
  const styles: Record<string, string> = {
    PAPER:   'bg-green-dim border-green/30 text-green',
    LIVE:    'bg-red-dim border-red/30 text-red',
    DEMO:    'bg-yellow-dim border-yellow/30 text-yellow',
    TESTNET: 'bg-yellow-dim border-yellow/30 text-yellow',
  }
  const cls = styles[mode] ?? 'bg-surface2 border-border text-muted'
  return (
    <span className={`inline-block px-2 py-0.5 rounded-md text-xs font-bold tracking-wide border ${cls}`}>
      {mode}
    </span>
  )
}

function ConnectedDot({ ok, inactive }: { ok: boolean; inactive?: boolean }) {
  if (inactive) return (
    <span className="flex items-center gap-1.5 text-sm">
      <span className="w-1.5 h-1.5 rounded-full bg-muted2" />
      <span className="text-muted">Inactive</span>
    </span>
  )
  return (
    <span className="flex items-center gap-1.5 text-sm">
      <span className={`w-1.5 h-1.5 rounded-full ${ok ? 'bg-green' : 'bg-red'}`} />
      <span className={ok ? 'text-green' : 'text-red'}>{ok ? 'Connected' : 'Error'}</span>
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

function Tabs({ tabs, active, onChange }: { tabs: string[]; active: string; onChange: (t: string) => void }) {
  return (
    <div className="flex gap-1 border-b border-border mb-4">
      {tabs.map(t => (
        <button
          key={t}
          onClick={() => onChange(t)}
          className={`px-4 py-2.5 text-sm font-medium transition-colors relative -mb-px ${
            active === t
              ? 'text-green border-b-2 border-green'
              : 'text-muted hover:text-text'
          }`}
        >
          {t}
        </button>
      ))}
    </div>
  )
}

function EmptyRow({ cols, label }: { cols: number; label: string }) {
  return (
    <tr>
      <td colSpan={cols} className="py-10 text-center text-muted text-sm">{label}</td>
    </tr>
  )
}

function Th({ children }: { children: string }) {
  return (
    <th className="text-left text-xs font-semibold uppercase tracking-wider text-muted py-3 px-3">
      {children}
    </th>
  )
}

function Td({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <td className={`py-3 px-3 text-sm ${className}`}>{children}</td>
}

function PnlSpan({ value }: { value: number }) {
  const color = value > 0 ? 'text-green' : value < 0 ? 'text-red' : 'text-muted'
  return <span className={`font-mono ${color}`}>{value >= 0 ? '+' : ''}${usd(value)}</span>
}

// ── Set Active button ─────────────────────────────────────────────────────────

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

// ── Binance card ───────────────────────────────────────────────────────────────

function BinanceCard({ entry }: { entry: BinanceAccountEntry }) {
  const [tab, setTab] = useState('Holdings')
  const tabs = ['Holdings', 'Open Orders']

  const balances = entry.balances ?? []
  const orders = entry.openOrders ?? []

  const totalUsd = balances
    .filter(b => b.asset === 'USDT' || b.asset === 'BUSD' || b.asset === 'USDC')
    .reduce((sum, b) => sum + b.free + b.locked, 0)

  return (
    <div className="bg-surface border border-border rounded-lg overflow-hidden">
      <div className="px-5 py-4 border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-text font-bold text-sm">BINANCE</span>
          <ModeBadge mode={entry.mode} />
          <ConnectedDot ok={entry.connected} />
        </div>
        <div className="flex items-center gap-3">
          {entry.connected && (
            <span className="text-sm text-muted">
              {balances.length} asset{balances.length !== 1 ? 's' : ''}
            </span>
          )}
          <SetActiveButton entry={entry} />
        </div>
      </div>

      {!entry.connected && (
        <div className="px-5 py-6 text-sm text-red font-mono">
          {entry.error ?? 'Connection failed'}
        </div>
      )}

      {entry.connected && (
        <div className="px-5 py-4 grid grid-cols-3 gap-4 border-b border-border">
          <SummaryMetric label="Stablecoin Balance" value={`$${usd(totalUsd)}`} />
          <SummaryMetric label="Non-zero Assets" value={String(balances.length)} />
          <SummaryMetric label="Open Orders" value={String(orders.length)} color={orders.length > 0 ? 'text-yellow' : 'text-muted'} />
        </div>
      )}

      {entry.connected && (
        <div className="px-5 pt-4">
          <Tabs tabs={tabs} active={tab} onChange={setTab} />

          {tab === 'Holdings' && (
            <div className="overflow-x-auto mb-4">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    {['Asset', 'Free', 'Locked', 'Total'].map(h => <Th key={h}>{h}</Th>)}
                  </tr>
                </thead>
                <tbody>
                  {balances.length === 0
                    ? <EmptyRow cols={4} label="No holdings" />
                    : balances.map((b, i) => <BinanceBalanceRow key={i} b={b} />)
                  }
                </tbody>
              </table>
            </div>
          )}

          {tab === 'Open Orders' && (
            <div className="overflow-x-auto mb-4">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    {['Time', 'Symbol', 'Side', 'Type', 'Price', 'Qty', 'Filled', 'Status'].map(h => <Th key={h}>{h}</Th>)}
                  </tr>
                </thead>
                <tbody>
                  {orders.length === 0
                    ? <EmptyRow cols={8} label="No open orders" />
                    : orders.map((o, i) => <BinanceOrderRow key={i} o={o} />)
                  }
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function BinanceBalanceRow({ b }: { b: BinanceBalance }) {
  const total = b.free + b.locked
  const isStable = ['USDT', 'BUSD', 'USDC', 'DAI'].includes(b.asset)
  return (
    <tr className="border-b border-border/50 hover:bg-surface2 transition-colors">
      <Td>
        <span className={`font-bold ${isStable ? 'text-green' : 'text-text'}`}>{b.asset}</span>
      </Td>
      <Td className="font-mono">{b.free.toLocaleString(undefined, { maximumFractionDigits: 8 })}</Td>
      <Td className="font-mono text-yellow">{b.locked > 0 ? b.locked.toLocaleString(undefined, { maximumFractionDigits: 8 }) : <span className="text-muted">—</span>}</Td>
      <Td className="font-mono font-bold text-text">{total.toLocaleString(undefined, { maximumFractionDigits: 8 })}</Td>
    </tr>
  )
}

function BinanceOrderRow({ o }: { o: BinanceOpenOrder }) {
  return (
    <tr className="border-b border-border/50 hover:bg-surface2 transition-colors">
      <Td className="text-muted whitespace-nowrap">{fmtTimestamp(o.time)}</Td>
      <Td className="font-bold text-text">{o.symbol}</Td>
      <Td>
        <span className={`font-bold ${o.side === 'BUY' ? 'text-green' : 'text-red'}`}>{o.side}</span>
      </Td>
      <Td className="text-muted">{o.type}</Td>
      <Td className="font-mono">{o.price > 0 ? o.price.toFixed(2) : '—'}</Td>
      <Td className="font-mono">{o.origQty.toLocaleString(undefined, { maximumFractionDigits: 8 })}</Td>
      <Td className="font-mono text-muted">{o.executedQty.toLocaleString(undefined, { maximumFractionDigits: 8 })}</Td>
      <Td>
        <span className="text-xs font-bold uppercase tracking-wider px-2 py-0.5 rounded border border-border text-muted">
          {o.status}
        </span>
      </Td>
    </tr>
  )
}

// ── MT5 card ─────────────────────────────────────────────────────────────────

function Mt5Card({ entry }: { entry: Mt5AccountEntry }) {
  const s = entry.summary
  const positions = entry.positions ?? []

  const marginLevel = s && s.margin > 0 ? (s.equity / s.margin) * 100 : 0

  return (
    <div className="bg-surface border border-border rounded-lg overflow-hidden">
      <div className="px-5 py-4 border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-text font-bold text-sm">METATRADER 5</span>
          <ModeBadge mode={entry.mode} />
          <ConnectedDot ok={entry.connected} inactive={!entry.connected && entry.error?.startsWith('Not active')} />
          {s && (
            <span className="text-sm text-muted font-mono">
              #{s.login} @ {s.server}
            </span>
          )}
        </div>
        <SetActiveButton entry={entry} />
      </div>

      {!entry.connected && (
        <div className={`px-5 py-5 text-sm font-mono border-t border-border ${
          entry.error?.startsWith('Not active') ? 'text-muted' : 'text-red'
        }`}>
          {entry.error?.startsWith('Not active')
            ? <span>{entry.error}</span>
            : <span>{entry.error ?? 'Bridge not running'}</span>
          }
        </div>
      )}

      {s && (
        <div className="px-5 py-4 grid grid-cols-3 gap-4 border-b border-border">
          <SummaryMetric label="Balance" value={`$${usd(s.balance)}`} />
          <SummaryMetric label="Equity" value={`$${usd(s.equity)}`} />
          <SummaryMetric label="Free Margin" value={`$${usd(s.freeMargin)}`} color="text-blue" />
          <SummaryMetric
            label="Margin Level"
            value={s.margin > 0 ? `${marginLevel.toFixed(1)}%` : '—'}
            color={marginLevel > 200 ? 'text-green' : marginLevel > 100 ? 'text-yellow' : 'text-red'}
          />
          <SummaryMetric
            label="Floating P&L"
            value={`${s.profit >= 0 ? '+' : ''}$${usd(s.profit)}`}
            color={s.profit >= 0 ? 'text-green' : 'text-red'}
          />
          <SummaryMetric label="Leverage" value={`1:${s.leverage}`} color="text-muted" />
        </div>
      )}

      {entry.connected && (
        <div className="px-5 pt-4">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted mb-3">Positions</h3>
          <div className="overflow-x-auto mb-4">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  {['Symbol', 'Side', 'Volume', 'Open Price', 'Current', 'P&L', 'Swap', 'SL', 'TP'].map(h => <Th key={h}>{h}</Th>)}
                </tr>
              </thead>
              <tbody>
                {positions.length === 0
                  ? <EmptyRow cols={9} label="No open positions" />
                  : positions.map((p, i) => <Mt5PositionRow key={i} p={p} />)
                }
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

function Mt5PositionRow({ p }: { p: Mt5Position }) {
  return (
    <tr className="border-b border-border/50 hover:bg-surface2 transition-colors">
      <Td className="font-bold text-text">{p.symbol}</Td>
      <Td>
        <span className={`font-bold ${p.side === 'BUY' ? 'text-green' : 'text-red'}`}>{p.side}</span>
      </Td>
      <Td className="font-mono">{p.volume}</Td>
      <Td className="font-mono text-muted">{p.priceOpen.toFixed(5)}</Td>
      <Td className="font-mono">{p.priceCurrent.toFixed(5)}</Td>
      <Td><PnlSpan value={p.profit} /></Td>
      <Td className="font-mono text-muted">{p.swap !== 0 ? p.swap.toFixed(2) : '—'}</Td>
      <Td className="font-mono text-muted">{p.sl > 0 ? p.sl.toFixed(5) : '—'}</Td>
      <Td className="font-mono text-muted">{p.tp > 0 ? p.tp.toFixed(5) : '—'}</Td>
    </tr>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function Account() {
  const [accounts, setAccounts] = useState<AccountEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [lastUpdated, setLastUpdated] = useState('')
  const [error, setError] = useState<string | null>(null)
  const { refreshAccounts } = useAccount()

  const load = useCallback(async () => {
    setError(null)
    try {
      const data = await getAccounts()
      setAccounts(data)
      setLastUpdated(new Date().toLocaleTimeString())
      // Keep the context accounts list in sync so the sidebar selector is fresh
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

  const binanceAccounts = accounts.filter((a): a is BinanceAccountEntry => a.exchange === 'binance')
  const mt5Accounts = accounts.filter((a): a is Mt5AccountEntry => a.exchange === 'mt5')

  return (
    <div className="p-6">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-xl font-bold text-text">Account Management</h1>
          <p className="text-muted text-sm mt-1">All connected accounts — set one as active to scope the rest of the app</p>
        </div>
        <div className="flex items-center gap-3">
          {lastUpdated && <span className="text-sm text-muted">Updated {lastUpdated}</span>}
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
        <div className="py-24 text-center text-muted text-sm">Loading account data...</div>
      )}

      {!loading && error && (
        <div className="py-10 text-center text-red text-sm font-mono">
          Failed to load accounts: {error}
        </div>
      )}

      {!loading && !error && accounts.length === 0 && (
        <div className="py-16 text-center">
          <div className="text-4xl mb-4 opacity-30">◎</div>
          <p className="text-muted text-sm">No accounts configured.</p>
          <p className="text-muted text-sm mt-1">
            Add your Binance API keys or configure MT5 accounts in the <span className="text-text">Integrations</span> page.
          </p>
        </div>
      )}

      {!loading && binanceAccounts.length > 0 && (
        <section className="mb-8">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted mb-3">Crypto — Binance</h2>
          <div className="grid grid-cols-1 gap-5">
            {binanceAccounts.map(a => (
              <BinanceCard key={a.id} entry={a} />
            ))}
          </div>
        </section>
      )}

      {!loading && mt5Accounts.length > 0 && (
        <section className="mb-8">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted mb-3">MetaTrader 5</h2>
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
            {mt5Accounts.map(a => (
              <Mt5Card key={a.id} entry={a} />
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
