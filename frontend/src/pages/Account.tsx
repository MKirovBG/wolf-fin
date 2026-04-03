import { useEffect, useState, useCallback } from 'react'
import {
  getAccounts, getPositions, deleteMt5Account,
  getChallenge, saveChallenge, deleteChallenge,
  getAccountSnapshots,
} from '../api/client.ts'
import type { AccountEntry, Mt5Position } from '../types/index.ts'
import { useAccount, entryToSelectedAccount } from '../contexts/AccountContext.tsx'
import { useToast } from '../components/Toast.tsx'
import { Trash2, Trophy, X } from 'lucide-react'

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
      <button onClick={handleClick} disabled={loading}
        className="px-3 py-1 text-xs font-semibold rounded-md border border-green/40 text-green bg-green-dim hover:bg-transparent transition-colors disabled:opacity-50">
        ✓ Active
      </button>
    )
  }
  return (
    <button onClick={handleClick} disabled={loading}
      className="px-3 py-1 text-xs rounded-md border border-border text-muted hover:border-green hover:text-green transition-colors disabled:opacity-50">
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
              <td className="px-3 py-2"><span className={`font-semibold ${p.side === 'BUY' ? 'text-green' : 'text-red'}`}>{p.side}</span></td>
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

// ── FTMO Presets ───────────────────────────────────────────────────────────────

const FTMO_PRESETS: Record<string, { profitTargetPct: number; dailyLossLimitPct: number; maxDrawdownPct: number; minTradingDays: number }> = {
  'ftmo-challenge': { profitTargetPct: 10, dailyLossLimitPct: 5, maxDrawdownPct: 10, minTradingDays: 4 },
  'ftmo-verification': { profitTargetPct: 5, dailyLossLimitPct: 5, maxDrawdownPct: 10, minTradingDays: 4 },
  'ftmo-funded': { profitTargetPct: 0, dailyLossLimitPct: 5, maxDrawdownPct: 10, minTradingDays: 0 },
  'custom': { profitTargetPct: 10, dailyLossLimitPct: 5, maxDrawdownPct: 10, minTradingDays: 0 },
}

const PRESET_LABELS: Record<string, string> = {
  'ftmo-challenge': 'FTMO Challenge',
  'ftmo-verification': 'FTMO Verification',
  'ftmo-funded': 'FTMO Funded',
  'custom': 'Custom',
}

// ── Challenge Tracker Widget ──────────────────────────────────────────────────

interface ChallengeData {
  id: number; login: number; preset: string; startBalance: number;
  profitTargetPct: number; dailyLossLimitPct: number; maxDrawdownPct: number;
  minTradingDays: number; startDate: string; active: boolean
}

function ChallengeTracker({ entry, onRefresh }: { entry: AccountEntry; onRefresh: () => void }) {
  const login = entry.summary?.login
  const [challenge, setChallenge] = useState<ChallengeData | null>(null)
  const [loading, setLoading]     = useState(true)
  const [showSetup, setShowSetup] = useState(false)
  const [preset, setPreset]       = useState('ftmo-challenge')
  const [startBal, setStartBal]   = useState(entry.summary?.balance ?? 100000)
  const [startDate, setStartDate] = useState(new Date().toISOString().slice(0, 10))
  const [customRules, setCustomRules] = useState(FTMO_PRESETS['ftmo-challenge'])
  const toast = useToast()

  useEffect(() => {
    if (!login) return
    getChallenge(login).then(c => { setChallenge(c); setLoading(false) }).catch(() => setLoading(false))
  }, [login])

  const handlePresetChange = (p: string) => {
    setPreset(p)
    setCustomRules(FTMO_PRESETS[p] ?? FTMO_PRESETS['custom'])
  }

  const handleSave = async () => {
    if (!login) return
    try {
      await saveChallenge(login, {
        preset, startBalance: startBal, startDate,
        ...customRules,
      })
      toast.success('Challenge configured')
      setShowSetup(false)
      const c = await getChallenge(login)
      setChallenge(c)
      onRefresh()
    } catch (e) { toast.error(String(e)) }
  }

  const handleDelete = async () => {
    if (!login) return
    await deleteChallenge(login)
    setChallenge(null)
    toast.success('Challenge removed')
  }

  if (loading || !login) return null

  const bal = entry.summary?.balance ?? 0
  const equity = entry.summary?.equity ?? bal

  // Progress calculations
  if (challenge) {
    const profitTarget = challenge.startBalance * (challenge.profitTargetPct / 100)
    const currentProfit = bal - challenge.startBalance
    const profitPct = profitTarget > 0 ? Math.min(100, (currentProfit / profitTarget) * 100) : 0

    const maxDD = challenge.startBalance * (challenge.maxDrawdownPct / 100)
    const currentDD = challenge.startBalance - equity
    const ddPct = maxDD > 0 ? Math.min(100, (currentDD / maxDD) * 100) : 0

    const dailyLimit = challenge.startBalance * (challenge.dailyLossLimitPct / 100)

    return (
      <div className="border-t border-border">
        <div className="px-5 py-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Trophy size={14} className="text-yellow" />
              <span className="text-xs font-bold uppercase tracking-wider text-text">
                {PRESET_LABELS[challenge.preset] ?? challenge.preset}
              </span>
            </div>
            <button onClick={handleDelete} className="text-[10px] text-muted2 hover:text-red transition-colors">Remove</button>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
            <div>
              <div className="text-[10px] text-muted uppercase mb-1">Start Balance</div>
              <div className="text-xs font-mono font-bold text-text">${usd(challenge.startBalance)}</div>
            </div>
            <div>
              <div className="text-[10px] text-muted uppercase mb-1">Current P&L</div>
              <div className={`text-xs font-mono font-bold ${currentProfit >= 0 ? 'text-green' : 'text-red'}`}>
                {currentProfit >= 0 ? '+' : ''}${usd(currentProfit)}
              </div>
            </div>
            <div>
              <div className="text-[10px] text-muted uppercase mb-1">Daily Loss Limit</div>
              <div className="text-xs font-mono font-bold text-yellow">${usd(dailyLimit)}</div>
            </div>
            <div>
              <div className="text-[10px] text-muted uppercase mb-1">Started</div>
              <div className="text-xs font-mono text-muted">{challenge.startDate.slice(0, 10)}</div>
            </div>
          </div>

          {/* Profit target bar */}
          {challenge.profitTargetPct > 0 && (
            <div className="mb-2">
              <div className="flex justify-between text-[10px] text-muted mb-1">
                <span>Profit Target ({challenge.profitTargetPct}%)</span>
                <span className={currentProfit >= profitTarget ? 'text-green font-bold' : ''}>
                  {profitPct.toFixed(1)}%
                </span>
              </div>
              <div className="h-2 bg-bg rounded-full overflow-hidden">
                <div className={`h-full rounded-full transition-all ${profitPct >= 100 ? 'bg-green' : 'bg-brand'}`}
                  style={{ width: `${Math.max(0, profitPct)}%` }} />
              </div>
            </div>
          )}

          {/* Max drawdown bar */}
          <div>
            <div className="flex justify-between text-[10px] text-muted mb-1">
              <span>Max Drawdown ({challenge.maxDrawdownPct}%)</span>
              <span className={ddPct >= 80 ? 'text-red font-bold' : ddPct >= 50 ? 'text-yellow' : ''}>
                {ddPct.toFixed(1)}% used
              </span>
            </div>
            <div className="h-2 bg-bg rounded-full overflow-hidden">
              <div className={`h-full rounded-full transition-all ${ddPct >= 80 ? 'bg-red' : ddPct >= 50 ? 'bg-yellow' : 'bg-green'}`}
                style={{ width: `${Math.max(0, ddPct)}%` }} />
            </div>
          </div>
        </div>
      </div>
    )
  }

  // Setup form
  if (showSetup) {
    return (
      <div className="border-t border-border px-5 py-4 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold uppercase tracking-wider text-text">Configure Challenge</span>
          <button onClick={() => setShowSetup(false)} className="text-muted2 hover:text-text"><X size={14} /></button>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-[10px] text-muted uppercase block mb-1">Preset</label>
            <select value={preset} onChange={e => handlePresetChange(e.target.value)}
              className="w-full text-xs bg-bg border border-border rounded px-2 py-1.5 text-text">
              {Object.entries(PRESET_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[10px] text-muted uppercase block mb-1">Start Balance</label>
            <input type="number" value={startBal} onChange={e => setStartBal(parseFloat(e.target.value) || 0)}
              className="w-full text-xs font-mono bg-bg border border-border rounded px-2 py-1.5 text-text" />
          </div>
          <div>
            <label className="text-[10px] text-muted uppercase block mb-1">Start Date</label>
            <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)}
              className="w-full text-xs bg-bg border border-border rounded px-2 py-1.5 text-text" />
          </div>
          <div>
            <label className="text-[10px] text-muted uppercase block mb-1">Min Trading Days</label>
            <input type="number" value={customRules.minTradingDays} onChange={e => setCustomRules(p => ({ ...p, minTradingDays: parseInt(e.target.value) || 0 }))}
              className="w-full text-xs font-mono bg-bg border border-border rounded px-2 py-1.5 text-text" />
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="text-[10px] text-muted uppercase block mb-1">Profit Target %</label>
            <input type="number" step="0.5" value={customRules.profitTargetPct} onChange={e => setCustomRules(p => ({ ...p, profitTargetPct: parseFloat(e.target.value) || 0 }))}
              className="w-full text-xs font-mono bg-bg border border-border rounded px-2 py-1.5 text-text" />
          </div>
          <div>
            <label className="text-[10px] text-muted uppercase block mb-1">Daily Loss %</label>
            <input type="number" step="0.5" value={customRules.dailyLossLimitPct} onChange={e => setCustomRules(p => ({ ...p, dailyLossLimitPct: parseFloat(e.target.value) || 0 }))}
              className="w-full text-xs font-mono bg-bg border border-border rounded px-2 py-1.5 text-text" />
          </div>
          <div>
            <label className="text-[10px] text-muted uppercase block mb-1">Max Drawdown %</label>
            <input type="number" step="0.5" value={customRules.maxDrawdownPct} onChange={e => setCustomRules(p => ({ ...p, maxDrawdownPct: parseFloat(e.target.value) || 0 }))}
              className="w-full text-xs font-mono bg-bg border border-border rounded px-2 py-1.5 text-text" />
          </div>
        </div>

        <button onClick={handleSave}
          className="px-4 py-1.5 text-xs font-medium bg-brand/10 text-brand border border-brand/30 rounded hover:bg-brand/20 transition-colors">
          Save Challenge
        </button>
      </div>
    )
  }

  // Show "Setup Challenge" button
  return (
    <div className="border-t border-border px-5 py-3">
      <button onClick={() => setShowSetup(true)}
        className="flex items-center gap-1.5 text-xs text-brand hover:text-text transition-colors">
        <Trophy size={12} />
        Setup Challenge Tracker
      </button>
    </div>
  )
}

// ── MT5 Account Card ──────────────────────────────────────────────────────────

function Mt5Card({ entry, onDelete, onRefresh }: { entry: AccountEntry; onDelete?: (login: number) => void; onRefresh: () => void }) {
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
              {entry.connected ? 'Connected' : 'Disconnected'}
            </span>
          </span>
          {s?.login && (
            <span className="text-sm text-muted font-mono">
              #{s.login}{s.server ? ` @ ${s.server}` : ''}
              {s.name ? ` · ${s.name}` : ''}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {entry.connected && <SetActiveButton entry={entry} />}
          {!entry.connected && s?.login && onDelete && (
            <button
              onClick={() => onDelete(s.login)}
              className="flex items-center gap-1 px-3 py-1 text-xs rounded-md border border-border text-muted hover:border-red/30 hover:text-red transition-colors"
            >
              <Trash2 size={11} /> Remove
            </button>
          )}
        </div>
      </div>

      {!entry.connected && entry.error && (
        <div className="px-5 py-3 text-xs text-muted2 font-mono">{entry.error}</div>
      )}

      {s && entry.connected && (
        <div className="px-5 py-4 grid grid-cols-2 md:grid-cols-5 gap-4">
          {s.balance   != null && <SummaryMetric label="Balance"     value={`$${usd(s.balance)}`} />}
          {s.equity    != null && <SummaryMetric label="Equity"      value={`$${usd(s.equity)}`} color={s.equity >= (s.balance ?? 0) ? 'text-green' : 'text-red'} />}
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

      {/* Challenge tracker — only for connected accounts */}
      {entry.connected && s?.login && (
        <ChallengeTracker entry={entry} onRefresh={onRefresh} />
      )}
    </div>
  )
}

// ── Main Account Page ─────────────────────────────────────────────────────────

export function Account() {
  const [accounts, setAccounts] = useState<AccountEntry[]>([])
  const [loading, setLoading]   = useState(true)
  const [lastUpdated, setLastUpdated] = useState('')
  const [error, setError]       = useState<string | null>(null)
  const { refreshAccounts }     = useAccount()
  const toast = useToast()

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

  const handleDelete = async (login: number) => {
    if (!confirm(`Remove MT5 account #${login} and all its snapshot/challenge data?`)) return
    try {
      await deleteMt5Account(login)
      toast.success(`Account #${login} removed`)
      await load()
    } catch (e) { toast.error(String(e)) }
  }

  // Sort: connected first, then by login
  const sorted = [...accounts].sort((a, b) => {
    if (a.connected !== b.connected) return a.connected ? -1 : 1
    return (a.summary?.login ?? 0) - (b.summary?.login ?? 0)
  })

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-lg font-bold text-text">Accounts</h1>
          <p className="text-xs text-muted mt-0.5">MetaTrader 5 accounts connected via the bridge. Disconnected accounts can be removed.</p>
        </div>
        <div className="flex items-center gap-3">
          {lastUpdated && <span className="text-xs text-muted2">Updated {lastUpdated}</span>}
          <button onClick={load} disabled={loading}
            className="px-3 py-1.5 text-sm border border-border text-muted rounded-lg hover:border-muted2 hover:text-text transition-colors disabled:opacity-50">
            ↻ Refresh
          </button>
        </div>
      </div>

      {loading && <div className="py-24 text-center text-muted text-sm">Loading…</div>}

      {!loading && error && (
        <div className="py-10 text-center text-red text-sm font-mono">Failed to load accounts: {error}</div>
      )}

      {!loading && !error && accounts.length === 0 && (
        <div className="py-16 text-center">
          <div className="text-4xl mb-4 opacity-30">◎</div>
          <p className="text-muted text-sm">No accounts found.</p>
          <p className="text-muted2 text-xs mt-1">Make sure the MT5 bridge is running and at least one account is configured.</p>
        </div>
      )}

      {!loading && sorted.length > 0 && (
        <div className="space-y-4">
          {sorted.map(a => (
            <Mt5Card key={a.id} entry={a} onDelete={handleDelete} onRefresh={load} />
          ))}
        </div>
      )}
    </div>
  )
}
