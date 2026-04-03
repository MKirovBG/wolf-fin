import { useEffect, useState, useCallback } from 'react'
import {
  getAnalyticsOverview, getAnalyticsBySymbol, getAnalyticsByStrategy, getAnalyticsByDay,
  getCorrelation,
} from '../api/client.ts'

// ── Types ─────────────────────────────────────────────────────────────────────

interface OverviewStats {
  total: number; entered: number; wins: number; losses: number; expired: number
  winRate: number; avgPipsWin: number; avgPipsLoss: number; totalPips: number
  expectancy: number; profitFactor: number; maxConsecutiveLosses: number
  bestTrade: number; worstTrade: number
}
interface SymbolStats {
  symbolKey: string; total: number; wins: number; losses: number
  winRate: number; totalPips: number; expectancy: number; profitFactor: number
}
interface StrategyStats {
  strategyKey: string; total: number; wins: number; losses: number
  winRate: number; totalPips: number; expectancy: number; profitFactor: number
}
interface DayStats { day: string; wins: number; losses: number; pips: number }

type Tab = 'overview' | 'symbols' | 'strategies' | 'daily' | 'correlation'

const TAB_LABELS: Record<Tab, string> = {
  overview: 'Overview', symbols: 'By Symbol', strategies: 'By Strategy', daily: 'Daily P&L', correlation: 'Correlation',
}

const STRATEGY_NAMES: Record<string, string> = {
  price_action: 'Price Action', ict: 'ICT', trend: 'Trend Following',
  swing: 'Swing Trading', scalping: 'Scalping', smc: 'Smart Money',
}

function StatCard({ label, value, sub, color = 'text-text' }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className="bg-surface border border-border rounded-lg p-4">
      <div className="text-[10px] text-muted uppercase tracking-wider mb-1">{label}</div>
      <div className={`font-mono text-lg font-bold ${color}`}>{value}</div>
      {sub && <div className="text-[10px] text-muted2 mt-0.5">{sub}</div>}
    </div>
  )
}

// ── Bar chart (simple CSS) ────────────────────────────────────────────────────

function MiniBar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.min(100, (Math.abs(value) / max) * 100) : 0
  return (
    <div className="h-3 bg-bg rounded-full overflow-hidden w-full">
      <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
    </div>
  )
}

// ── Overview Tab ──────────────────────────────────────────────────────────────

function OverviewTab({ stats }: { stats: OverviewStats }) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label="Total Proposals" value={String(stats.total)} sub={`${stats.entered} entered`} />
        <StatCard label="Win Rate" value={`${stats.winRate.toFixed(1)}%`}
          sub={`${stats.wins}W / ${stats.losses}L`}
          color={stats.winRate >= 50 ? 'text-green' : 'text-red'} />
        <StatCard label="Total Pips" value={`${stats.totalPips >= 0 ? '+' : ''}${stats.totalPips.toFixed(1)}`}
          color={stats.totalPips >= 0 ? 'text-green' : 'text-red'} />
        <StatCard label="Profit Factor" value={stats.profitFactor === Infinity ? '∞' : stats.profitFactor.toFixed(2)}
          color={stats.profitFactor >= 1.5 ? 'text-green' : stats.profitFactor >= 1 ? 'text-yellow' : 'text-red'} />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label="Expectancy" value={`${stats.expectancy >= 0 ? '+' : ''}${stats.expectancy.toFixed(2)} pips`}
          color={stats.expectancy >= 0 ? 'text-green' : 'text-red'} />
        <StatCard label="Avg Win" value={`+${stats.avgPipsWin.toFixed(1)} pips`} color="text-green" />
        <StatCard label="Avg Loss" value={`-${stats.avgPipsLoss.toFixed(1)} pips`} color="text-red" />
        <StatCard label="Max Consec. Losses" value={String(stats.maxConsecutiveLosses)}
          color={stats.maxConsecutiveLosses >= 5 ? 'text-red' : 'text-text'} />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <StatCard label="Best Trade" value={`+${stats.bestTrade.toFixed(1)} pips`} color="text-green" />
        <StatCard label="Worst Trade" value={`${stats.worstTrade.toFixed(1)} pips`} color="text-red" />
      </div>
    </div>
  )
}

// ── By Symbol Tab ─────────────────────────────────────────────────────────────

function SymbolsTab({ data }: { data: SymbolStats[] }) {
  const maxPips = Math.max(...data.map(d => Math.abs(d.totalPips)), 1)
  const sorted = [...data].sort((a, b) => b.totalPips - a.totalPips)

  if (sorted.length === 0) {
    return <div className="text-sm text-muted py-8 text-center">No outcome data yet.</div>
  }

  return (
    <div className="bg-surface border border-border rounded-lg overflow-hidden">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-border bg-surface2/30">
            <th className="px-4 py-2.5 text-left text-[10px] uppercase tracking-wider text-muted">Symbol</th>
            <th className="px-3 py-2.5 text-center text-[10px] uppercase tracking-wider text-muted">W/L</th>
            <th className="px-3 py-2.5 text-center text-[10px] uppercase tracking-wider text-muted">Win Rate</th>
            <th className="px-3 py-2.5 text-right text-[10px] uppercase tracking-wider text-muted">Pips</th>
            <th className="px-3 py-2.5 text-center text-[10px] uppercase tracking-wider text-muted w-32">P&L</th>
            <th className="px-3 py-2.5 text-right text-[10px] uppercase tracking-wider text-muted">Expectancy</th>
            <th className="px-3 py-2.5 text-right text-[10px] uppercase tracking-wider text-muted">P. Factor</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map(s => (
            <tr key={s.symbolKey} className="border-b border-border/30 hover:bg-surface2/50">
              <td className="px-4 py-2.5 font-mono font-bold text-text">{s.symbolKey}</td>
              <td className="px-3 py-2.5 text-center">
                <span className="text-green">{s.wins}</span>
                <span className="text-muted2"> / </span>
                <span className="text-red">{s.losses}</span>
              </td>
              <td className="px-3 py-2.5 text-center">
                <span className={s.winRate >= 50 ? 'text-green' : 'text-red'}>{s.winRate.toFixed(1)}%</span>
              </td>
              <td className={`px-3 py-2.5 text-right font-mono font-bold ${s.totalPips >= 0 ? 'text-green' : 'text-red'}`}>
                {s.totalPips >= 0 ? '+' : ''}{s.totalPips.toFixed(1)}
              </td>
              <td className="px-3 py-2.5">
                <MiniBar value={s.totalPips} max={maxPips} color={s.totalPips >= 0 ? 'bg-green' : 'bg-red'} />
              </td>
              <td className={`px-3 py-2.5 text-right font-mono ${s.expectancy >= 0 ? 'text-green' : 'text-red'}`}>
                {s.expectancy >= 0 ? '+' : ''}{s.expectancy.toFixed(2)}
              </td>
              <td className="px-3 py-2.5 text-right font-mono text-muted">
                {s.profitFactor === Infinity ? '∞' : s.profitFactor.toFixed(2)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── By Strategy Tab ───────────────────────────────────────────────────────────

function StrategiesTab({ data }: { data: StrategyStats[] }) {
  const maxPips = Math.max(...data.map(d => Math.abs(d.totalPips)), 1)
  const sorted = [...data].sort((a, b) => b.totalPips - a.totalPips)

  if (sorted.length === 0) {
    return <div className="text-sm text-muted py-8 text-center">No strategy outcome data yet.</div>
  }

  return (
    <div className="bg-surface border border-border rounded-lg overflow-hidden">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-border bg-surface2/30">
            <th className="px-4 py-2.5 text-left text-[10px] uppercase tracking-wider text-muted">Strategy</th>
            <th className="px-3 py-2.5 text-center text-[10px] uppercase tracking-wider text-muted">W/L</th>
            <th className="px-3 py-2.5 text-center text-[10px] uppercase tracking-wider text-muted">Win Rate</th>
            <th className="px-3 py-2.5 text-right text-[10px] uppercase tracking-wider text-muted">Pips</th>
            <th className="px-3 py-2.5 text-center text-[10px] uppercase tracking-wider text-muted w-32">P&L</th>
            <th className="px-3 py-2.5 text-right text-[10px] uppercase tracking-wider text-muted">Expectancy</th>
            <th className="px-3 py-2.5 text-right text-[10px] uppercase tracking-wider text-muted">P. Factor</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map(s => (
            <tr key={s.strategyKey} className="border-b border-border/30 hover:bg-surface2/50">
              <td className="px-4 py-2.5 font-bold text-text">{STRATEGY_NAMES[s.strategyKey] ?? s.strategyKey}</td>
              <td className="px-3 py-2.5 text-center">
                <span className="text-green">{s.wins}</span>
                <span className="text-muted2"> / </span>
                <span className="text-red">{s.losses}</span>
              </td>
              <td className="px-3 py-2.5 text-center">
                <span className={s.winRate >= 50 ? 'text-green' : 'text-red'}>{s.winRate.toFixed(1)}%</span>
              </td>
              <td className={`px-3 py-2.5 text-right font-mono font-bold ${s.totalPips >= 0 ? 'text-green' : 'text-red'}`}>
                {s.totalPips >= 0 ? '+' : ''}{s.totalPips.toFixed(1)}
              </td>
              <td className="px-3 py-2.5">
                <MiniBar value={s.totalPips} max={maxPips} color={s.totalPips >= 0 ? 'bg-green' : 'bg-red'} />
              </td>
              <td className={`px-3 py-2.5 text-right font-mono ${s.expectancy >= 0 ? 'text-green' : 'text-red'}`}>
                {s.expectancy >= 0 ? '+' : ''}{s.expectancy.toFixed(2)}
              </td>
              <td className="px-3 py-2.5 text-right font-mono text-muted">
                {s.profitFactor === Infinity ? '∞' : s.profitFactor.toFixed(2)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── Daily P&L Tab ─────────────────────────────────────────────────────────────

function DailyTab({ data }: { data: DayStats[] }) {
  const maxPips = Math.max(...data.map(d => Math.abs(d.pips)), 1)

  if (data.length === 0) {
    return <div className="text-sm text-muted py-8 text-center">No daily data yet.</div>
  }

  // Show last 30 days
  const recent = data.slice(-30)
  const cumPips = recent.reduce((acc, d) => { acc.push((acc.length > 0 ? acc[acc.length - 1] : 0) + d.pips); return acc }, [] as number[])
  const lastCumPips = cumPips.length > 0 ? cumPips[cumPips.length - 1] : 0

  return (
    <div className="space-y-4">
      {/* Cumulative P&L summary */}
      <div className="grid grid-cols-3 gap-3">
        <StatCard label="Trading Days" value={String(recent.length)} />
        <StatCard label="Cumulative Pips"
          value={`${lastCumPips >= 0 ? '+' : ''}${lastCumPips.toFixed(1)}`}
          color={lastCumPips >= 0 ? 'text-green' : 'text-red'} />
        <StatCard label="Best Day"
          value={`+${Math.max(...recent.map(d => d.pips)).toFixed(1)} pips`}
          color="text-green" />
      </div>

      {/* Daily bars */}
      <div className="bg-surface border border-border rounded-lg p-4">
        <div className="text-[10px] uppercase text-muted font-semibold mb-3">Daily P&L (last 30 days)</div>
        <div className="space-y-1.5">
          {recent.map((d, i) => (
            <div key={d.day} className="flex items-center gap-3">
              <span className="text-[10px] font-mono text-muted w-20 flex-shrink-0">{d.day.slice(5)}</span>
              <div className="flex-1 flex items-center gap-1">
                <div className="w-1/2 flex justify-end">
                  {d.pips < 0 && (
                    <div className="bg-red h-4 rounded-sm" style={{ width: `${(Math.abs(d.pips) / maxPips) * 100}%` }} />
                  )}
                </div>
                <div className="w-px h-4 bg-border flex-shrink-0" />
                <div className="w-1/2">
                  {d.pips >= 0 && (
                    <div className="bg-green h-4 rounded-sm" style={{ width: `${(d.pips / maxPips) * 100}%` }} />
                  )}
                </div>
              </div>
              <span className={`text-[10px] font-mono w-16 text-right flex-shrink-0 ${d.pips >= 0 ? 'text-green' : 'text-red'}`}>
                {d.pips >= 0 ? '+' : ''}{d.pips.toFixed(1)}
              </span>
              <span className="text-[9px] text-muted2 w-12 text-right flex-shrink-0">
                {d.wins}W {d.losses}L
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Correlation Tab ───────────────────────────────────────────────────────────

function CorrelationTab() {
  const [data, setData] = useState<{ symbols: string[]; matrix: Array<{ a: string; b: string; correlation: number }> } | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    getCorrelation().then(setData).catch(() => {}).finally(() => setLoading(false))
  }, [])

  if (loading) return <div className="text-sm text-muted py-8 text-center">Computing correlations…</div>
  if (!data || data.symbols.length < 2) {
    return <div className="text-sm text-muted py-8 text-center">Need at least 2 symbols with candle data for correlation analysis.</div>
  }

  const { symbols, matrix } = data
  const getCorr = (a: string, b: string): number => {
    if (a === b) return 1
    const entry = matrix.find(m => (m.a === a && m.b === b) || (m.a === b && m.b === a))
    return entry?.correlation ?? 0
  }

  const corrColor = (c: number): string => {
    if (c >= 0.7) return 'bg-green/30 text-green'
    if (c >= 0.3) return 'bg-green/10 text-green'
    if (c >= -0.3) return 'bg-surface2 text-muted'
    if (c >= -0.7) return 'bg-red/10 text-red'
    return 'bg-red/30 text-red'
  }

  return (
    <div className="space-y-4">
      <div className="bg-surface border border-border rounded-lg p-4">
        <div className="text-[10px] uppercase text-muted font-semibold mb-3">Pairwise Correlation Matrix (60 H1 candles)</div>
        <div className="overflow-x-auto">
          <table className="text-[11px]">
            <thead>
              <tr>
                <th className="px-2 py-1.5" />
                {symbols.map(s => (
                  <th key={s} className="px-2 py-1.5 font-mono font-bold text-text text-center whitespace-nowrap">{s}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {symbols.map(row => (
                <tr key={row}>
                  <td className="px-2 py-1.5 font-mono font-bold text-text whitespace-nowrap">{row}</td>
                  {symbols.map(col => {
                    const c = getCorr(row, col)
                    return (
                      <td key={col} className={`px-2 py-1.5 text-center font-mono font-bold rounded ${row === col ? 'bg-brand/10 text-brand' : corrColor(c)}`}>
                        {c.toFixed(2)}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* High correlation warnings */}
      {matrix.filter(m => Math.abs(m.correlation) >= 0.7).length > 0 && (
        <div className="bg-yellow-dim border border-yellow/20 rounded-lg p-4">
          <div className="text-xs font-bold text-yellow mb-2">High Correlation Warning</div>
          <div className="space-y-1">
            {matrix.filter(m => Math.abs(m.correlation) >= 0.7).map(m => (
              <div key={`${m.a}-${m.b}`} className="text-xs text-text">
                <span className="font-mono font-bold">{m.a}</span> and <span className="font-mono font-bold">{m.b}</span>: <span className={m.correlation > 0 ? 'text-green' : 'text-red'}>{m.correlation.toFixed(2)}</span>
                {m.correlation > 0 ? ' — trading both in the same direction amplifies risk' : ' — these move inversely'}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Main Analytics Page ───────────────────────────────────────────────────────

export function Analytics() {
  const [tab, setTab]           = useState<Tab>('overview')
  const [overview, setOverview] = useState<OverviewStats | null>(null)
  const [symbols, setSymbols]   = useState<SymbolStats[]>([])
  const [strategies, setStrats] = useState<StrategyStats[]>([])
  const [daily, setDaily]       = useState<DayStats[]>([])
  const [loading, setLoading]   = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [o, s, st, d] = await Promise.all([
        getAnalyticsOverview(),
        getAnalyticsBySymbol(),
        getAnalyticsByStrategy(),
        getAnalyticsByDay(),
      ])
      setOverview(o)
      setSymbols(s)
      setStrats(st)
      setDaily(d)
    } catch { /* ignore */ }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-text">Performance Analytics</h1>
          <p className="text-xs text-muted mt-0.5">Comprehensive performance breakdown by account, symbol, and strategy</p>
        </div>
        <button onClick={load} disabled={loading}
          className="px-3 py-1.5 text-sm border border-border text-muted rounded-lg hover:text-text transition-colors disabled:opacity-50">
          ↻ Refresh
        </button>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-border pb-0">
        {(Object.keys(TAB_LABELS) as Tab[]).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-xs font-medium border-b-2 transition-colors ${
              tab === t
                ? 'border-brand text-brand'
                : 'border-transparent text-muted hover:text-text'
            }`}
          >
            {TAB_LABELS[t]}
          </button>
        ))}
      </div>

      {loading && <div className="py-16 text-center text-muted text-sm">Loading analytics…</div>}

      {!loading && tab === 'overview' && overview && <OverviewTab stats={overview} />}
      {!loading && tab === 'symbols' && <SymbolsTab data={symbols} />}
      {!loading && tab === 'strategies' && <StrategiesTab data={strategies} />}
      {!loading && tab === 'daily' && <DailyTab data={daily} />}
      {tab === 'correlation' && <CorrelationTab />}
    </div>
  )
}
