import { useEffect, useState, useCallback } from 'react'
import { getAccounts } from '../api/client.ts'
import type { AccountEntry, AlpacaAccountEntry, BinanceAccountEntry, Mt5AccountEntry, AlpacaPosition, AlpacaFill, BinanceBalance, BinanceOpenOrder, Mt5Position } from '../types/index.ts'

// ── Helpers ────────────────────────────────────────────────────────────────────

function usd(n: number, decimals = 2) {
  return n.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
}

function fmtTime(iso: string) {
  return new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function fmtTimestamp(ms: number) {
  return new Date(ms).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

// ── Small reusable pieces ──────────────────────────────────────────────────────

function ModeBadge({ mode }: { mode: string }) {
  const styles: Record<string, string> = {
    PAPER:   'bg-green-dim border-green-border text-green',
    LIVE:    'bg-red-dim border-red-border text-red',
    TESTNET: 'bg-yellow-dim border-yellow-border text-yellow',
  }
  const cls = styles[mode] ?? 'bg-surface2 border-border text-muted'
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold tracking-wide border ${cls}`}>
      {mode}
    </span>
  )
}

function ConnectedDot({ ok }: { ok: boolean }) {
  return (
    <span className="flex items-center gap-1.5 text-[11px]">
      <span className={`w-1.5 h-1.5 rounded-full ${ok ? 'bg-green' : 'bg-red'}`} />
      <span className={ok ? 'text-green' : 'text-red'}>{ok ? 'Connected' : 'Error'}</span>
    </span>
  )
}

function SummaryMetric({ label, value, color = 'text-white' }: { label: string; value: string; color?: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] uppercase tracking-widest text-muted">{label}</span>
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
          className={`px-4 py-2 text-xs font-medium transition-colors relative -mb-px ${
            active === t
              ? 'text-green border-b-2 border-green'
              : 'text-muted hover:text-white'
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
      <td colSpan={cols} className="py-10 text-center text-muted text-xs">{label}</td>
    </tr>
  )
}

function Th({ children }: { children: string }) {
  return (
    <th className="text-left text-[10px] uppercase tracking-wide text-muted py-2.5 px-3 font-medium">
      {children}
    </th>
  )
}

function Td({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <td className={`py-2.5 px-3 text-xs ${className}`}>{children}</td>
}

function PnlSpan({ value }: { value: number }) {
  const color = value > 0 ? 'text-green' : value < 0 ? 'text-red' : 'text-muted'
  return <span className={`font-mono ${color}`}>{value >= 0 ? '+' : ''}${usd(value)}</span>
}

// ── Alpaca card ────────────────────────────────────────────────────────────────

function AlpacaCard({ entry }: { entry: AlpacaAccountEntry }) {
  const [tab, setTab] = useState('Positions')
  const tabs = ['Positions', 'Activity']

  const s = entry.summary
  const positions = entry.positions ?? []
  const fills = entry.recentFills ?? []

  return (
    <div className="bg-surface border border-border rounded-lg overflow-hidden">
      {/* Card header */}
      <div className="px-5 py-4 border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-white font-bold text-sm tracking-wide">ALPACA</span>
          <ModeBadge mode={entry.mode} />
          <ConnectedDot ok={entry.connected} />
        </div>
        {s && (
          <span className={`text-xs font-mono px-2 py-0.5 rounded border ${
            s.status === 'ACTIVE'
              ? 'text-green border-green-border bg-green-dim'
              : 'text-yellow border-yellow-border bg-yellow-dim'
          }`}>
            {s.status}
          </span>
        )}
      </div>

      {/* Error state */}
      {!entry.connected && (
        <div className="px-5 py-6 text-xs text-red font-mono">
          ✗ {entry.error ?? 'Connection failed'}
        </div>
      )}

      {/* Summary metrics */}
      {s && (
        <div className="px-5 py-4 grid grid-cols-3 gap-4 border-b border-border">
          <SummaryMetric label="Portfolio Value" value={`$${usd(s.portfolioValue)}`} />
          <SummaryMetric label="Cash" value={`$${usd(s.cash)}`} />
          <SummaryMetric
            label="Buying Power"
            value={`$${usd(s.buyingPower)}`}
            color="text-blue-400"
          />
          <SummaryMetric
            label="Equity"
            value={`$${usd(s.equity)}`}
          />
          <SummaryMetric
            label="Unrealised P&L"
            value={`${s.unrealizedPl >= 0 ? '+' : ''}$${usd(s.unrealizedPl)}`}
            color={s.unrealizedPl >= 0 ? 'text-green' : 'text-red'}
          />
          <SummaryMetric
            label="Day P&L"
            value={`${s.dayPl >= 0 ? '+' : ''}$${usd(s.dayPl)}`}
            color={s.dayPl >= 0 ? 'text-green' : 'text-red'}
          />
        </div>
      )}

      {/* Tabs */}
      {entry.connected && (
        <div className="px-5 pt-4">
          <Tabs tabs={tabs} active={tab} onChange={setTab} />

          {/* Positions */}
          {tab === 'Positions' && (
            <div className="overflow-x-auto mb-4">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border">
                    {['Symbol', 'Side', 'Qty', 'Avg Entry', 'Current', 'Market Value', 'Cost Basis', 'Unrealised P&L', 'P&L %'].map(h => <Th key={h}>{h}</Th>)}
                  </tr>
                </thead>
                <tbody>
                  {positions.length === 0
                    ? <EmptyRow cols={9} label="No open positions" />
                    : positions.map((p, i) => <AlpacaPositionRow key={i} p={p} />)
                  }
                </tbody>
              </table>
            </div>
          )}

          {/* Activity */}
          {tab === 'Activity' && (
            <div className="overflow-x-auto mb-4">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border">
                    {['Time', 'Symbol', 'Side', 'Qty', 'Price', 'Value'].map(h => <Th key={h}>{h}</Th>)}
                  </tr>
                </thead>
                <tbody>
                  {fills.length === 0
                    ? <EmptyRow cols={6} label="No recent fills" />
                    : fills.map((f, i) => <AlpacaFillRow key={i} f={f} />)
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

function AlpacaPositionRow({ p }: { p: AlpacaPosition }) {
  return (
    <tr className="border-b border-[#1a1a1a] hover:bg-surface2 transition-colors">
      <Td className="font-bold text-white">{p.symbol}</Td>
      <Td>
        <span className={`font-bold ${p.side === 'BUY' ? 'text-green' : 'text-red'}`}>{p.side}</span>
      </Td>
      <Td className="font-mono">{p.qty.toLocaleString(undefined, { maximumFractionDigits: 6 })}</Td>
      <Td className="font-mono text-muted">{p.avgEntry.toFixed(5)}</Td>
      <Td className="font-mono">{p.currentPrice.toFixed(5)}</Td>
      <Td className="font-mono">${usd(p.marketValue)}</Td>
      <Td className="font-mono text-muted">${usd(p.costBasis)}</Td>
      <Td><PnlSpan value={p.unrealizedPl} /></Td>
      <Td>
        <span className={`font-mono text-[11px] ${p.unrealizedPlPct >= 0 ? 'text-green' : 'text-red'}`}>
          {p.unrealizedPlPct >= 0 ? '+' : ''}{p.unrealizedPlPct.toFixed(3)}%
        </span>
      </Td>
    </tr>
  )
}

function AlpacaFillRow({ f }: { f: AlpacaFill }) {
  return (
    <tr className="border-b border-[#1a1a1a] hover:bg-surface2 transition-colors">
      <Td className="text-muted whitespace-nowrap">{fmtTime(f.time)}</Td>
      <Td className="font-bold text-white">{f.symbol}</Td>
      <Td>
        <span className={`font-bold ${f.side === 'BUY' ? 'text-green' : 'text-red'}`}>{f.side}</span>
      </Td>
      <Td className="font-mono">{f.qty.toLocaleString(undefined, { maximumFractionDigits: 6 })}</Td>
      <Td className="font-mono">{f.price.toFixed(5)}</Td>
      <Td className="font-mono text-white">${usd(f.qty * f.price)}</Td>
    </tr>
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
      {/* Card header */}
      <div className="px-5 py-4 border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-white font-bold text-sm tracking-wide">BINANCE</span>
          <ModeBadge mode={entry.mode} />
          <ConnectedDot ok={entry.connected} />
        </div>
        {entry.connected && (
          <span className="text-[11px] text-muted">
            {balances.length} asset{balances.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      {/* Error state */}
      {!entry.connected && (
        <div className="px-5 py-6 text-xs text-red font-mono">
          ✗ {entry.error ?? 'Connection failed'}
        </div>
      )}

      {/* Summary metrics */}
      {entry.connected && (
        <div className="px-5 py-4 grid grid-cols-3 gap-4 border-b border-border">
          <SummaryMetric label="Stablecoin Balance" value={`$${usd(totalUsd)}`} />
          <SummaryMetric label="Non-zero Assets" value={String(balances.length)} />
          <SummaryMetric label="Open Orders" value={String(orders.length)} color={orders.length > 0 ? 'text-yellow' : 'text-muted'} />
        </div>
      )}

      {/* Tabs */}
      {entry.connected && (
        <div className="px-5 pt-4">
          <Tabs tabs={tabs} active={tab} onChange={setTab} />

          {/* Holdings */}
          {tab === 'Holdings' && (
            <div className="overflow-x-auto mb-4">
              <table className="w-full text-xs">
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

          {/* Open Orders */}
          {tab === 'Open Orders' && (
            <div className="overflow-x-auto mb-4">
              <table className="w-full text-xs">
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
    <tr className="border-b border-[#1a1a1a] hover:bg-surface2 transition-colors">
      <Td>
        <span className={`font-bold ${isStable ? 'text-green' : 'text-white'}`}>{b.asset}</span>
      </Td>
      <Td className="font-mono">{b.free.toLocaleString(undefined, { maximumFractionDigits: 8 })}</Td>
      <Td className="font-mono text-yellow">{b.locked > 0 ? b.locked.toLocaleString(undefined, { maximumFractionDigits: 8 }) : <span className="text-muted">—</span>}</Td>
      <Td className="font-mono font-bold text-white">{total.toLocaleString(undefined, { maximumFractionDigits: 8 })}</Td>
    </tr>
  )
}

function BinanceOrderRow({ o }: { o: BinanceOpenOrder }) {
  return (
    <tr className="border-b border-[#1a1a1a] hover:bg-surface2 transition-colors">
      <Td className="text-muted whitespace-nowrap">{fmtTimestamp(o.time)}</Td>
      <Td className="font-bold text-white">{o.symbol}</Td>
      <Td>
        <span className={`font-bold ${o.side === 'BUY' ? 'text-green' : 'text-red'}`}>{o.side}</span>
      </Td>
      <Td className="text-muted">{o.type}</Td>
      <Td className="font-mono">{o.price > 0 ? o.price.toFixed(2) : '—'}</Td>
      <Td className="font-mono">{o.origQty.toLocaleString(undefined, { maximumFractionDigits: 8 })}</Td>
      <Td className="font-mono text-muted">{o.executedQty.toLocaleString(undefined, { maximumFractionDigits: 8 })}</Td>
      <Td>
        <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border border-border text-muted">
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
      {/* Card header */}
      <div className="px-5 py-4 border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-white font-bold text-sm tracking-wide">METATRADER 5</span>
          <ModeBadge mode={entry.mode} />
          <ConnectedDot ok={entry.connected} />
        </div>
        {s && (
          <span className="text-[11px] text-muted font-mono">
            #{s.login} @ {s.server}
          </span>
        )}
      </div>

      {/* Error state */}
      {!entry.connected && (
        <div className="px-5 py-6 text-xs text-red font-mono">
          ✗ {entry.error ?? 'Bridge not running'}
        </div>
      )}

      {/* Summary metrics */}
      {s && (
        <div className="px-5 py-4 grid grid-cols-3 gap-4 border-b border-border">
          <SummaryMetric label="Balance" value={`$${usd(s.balance)}`} />
          <SummaryMetric label="Equity" value={`$${usd(s.equity)}`} />
          <SummaryMetric label="Free Margin" value={`$${usd(s.freeMargin)}`} color="text-blue-400" />
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

      {/* Positions table */}
      {entry.connected && (
        <div className="px-5 pt-4">
          <h3 className="text-[10px] uppercase tracking-widest text-muted mb-3">Positions</h3>
          <div className="overflow-x-auto mb-4">
            <table className="w-full text-xs">
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
    <tr className="border-b border-[#1a1a1a] hover:bg-surface2 transition-colors">
      <Td className="font-bold text-white">{p.symbol}</Td>
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

  const load = useCallback(async () => {
    setError(null)
    try {
      const data = await getAccounts()
      setAccounts(data)
      setLastUpdated(new Date().toLocaleTimeString())
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
    const id = setInterval(load, 30000)
    return () => clearInterval(id)
  }, [load])

  const alpacaAccounts = accounts.filter((a): a is AlpacaAccountEntry => a.exchange === 'alpaca')
  const binanceAccounts = accounts.filter((a): a is BinanceAccountEntry => a.exchange === 'binance')
  const mt5Accounts = accounts.filter((a): a is Mt5AccountEntry => a.exchange === 'mt5')

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-sm font-bold tracking-widest text-white uppercase">Accounts</h1>
          <p className="text-muted text-xs mt-1">Balances, holdings, and activity across all configured exchanges</p>
        </div>
        <div className="flex items-center gap-3">
          {lastUpdated && <span className="text-[11px] text-muted">Updated {lastUpdated}</span>}
          <button
            onClick={load}
            disabled={loading}
            className="px-3 py-1.5 text-xs border border-border text-muted rounded hover:border-muted hover:text-white transition-colors disabled:opacity-50"
          >
            ↻ Refresh
          </button>
        </div>
      </div>

      {/* Loading */}
      {loading && (
        <div className="py-24 text-center text-muted text-xs">Loading account data...</div>
      )}

      {/* Error fetching accounts */}
      {!loading && error && (
        <div className="py-10 text-center text-red text-xs font-mono">
          Failed to load accounts: {error}
        </div>
      )}

      {/* No accounts configured */}
      {!loading && !error && accounts.length === 0 && (
        <div className="py-16 text-center">
          <div className="text-3xl mb-3">🔑</div>
          <p className="text-muted text-sm">No accounts configured.</p>
          <p className="text-muted text-xs mt-1">
            Add your Alpaca and Binance API keys in the <span className="text-white">API Keys</span> page.
          </p>
        </div>
      )}

      {/* Alpaca accounts */}
      {!loading && alpacaAccounts.length > 0 && (
        <section className="mb-8">
          <h2 className="text-[10px] uppercase tracking-[2px] text-muted mb-3">Forex — Alpaca</h2>
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
            {alpacaAccounts.map(a => (
              <AlpacaCard key={a.id} entry={a} />
            ))}
          </div>
        </section>
      )}

      {/* Binance accounts */}
      {!loading && binanceAccounts.length > 0 && (
        <section className="mb-8">
          <h2 className="text-[10px] uppercase tracking-[2px] text-muted mb-3">Crypto — Binance</h2>
          <div className="grid grid-cols-1 gap-5">
            {binanceAccounts.map(a => (
              <BinanceCard key={a.id} entry={a} />
            ))}
          </div>
        </section>
      )}

      {/* MT5 accounts */}
      {!loading && mt5Accounts.length > 0 && (
        <section className="mb-8">
          <h2 className="text-[10px] uppercase tracking-[2px] text-muted mb-3">MetaTrader 5</h2>
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
