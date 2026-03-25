// Wolf-Fin Analytics — equity curve, drawdown, session heatmap, trade breakdown

import { useEffect, useState, useCallback } from 'react'
import { ComposedChart, Area, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine, BarChart, Bar, Cell } from 'recharts'
import { getAgents, getAgentAnalytics } from '../api/client.ts'
import type { AgentState, AgentAnalyticsData } from '../types/index.ts'
import { Card } from '../components/Card.tsx'

// ── KPI Card ─────────────────────────────────────────────────────────────────

function KPI({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className="bg-surface border border-border rounded-lg p-4">
      <div className="text-[10px] font-semibold uppercase tracking-widest text-muted2 mb-1">{label}</div>
      <div className={`text-2xl font-bold font-mono ${color ?? 'text-text'}`}>{value}</div>
      {sub && <div className="text-xs text-muted mt-0.5">{sub}</div>}
    </div>
  )
}

// ── Session Heatmap ───────────────────────────────────────────────────────────

const DOW_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function SessionHeatmap({ heatmap, totalTrades }: {
  heatmap: Record<string, { totalPnl: number; count: number }>
  totalTrades: number
}) {
  if (totalTrades < 15) {
    return (
      <div className="text-center py-8 text-muted text-sm">
        Not enough data — need at least 15 trades (have {totalTrades})
      </div>
    )
  }

  // Find max abs avg PnL for color scaling
  let maxAbs = 0
  for (const v of Object.values(heatmap)) {
    if (v.count > 0) {
      maxAbs = Math.max(maxAbs, Math.abs(v.totalPnl / v.count))
    }
  }
  if (maxAbs === 0) maxAbs = 1

  const cellColor = (cell: { totalPnl: number; count: number } | undefined): string => {
    if (!cell || cell.count === 0) return 'rgba(255,255,255,0.03)'
    const avg = cell.totalPnl / cell.count
    const intensity = Math.min(1, Math.abs(avg) / maxAbs)
    if (avg > 0) return `rgba(34,197,94,${0.1 + intensity * 0.5})`
    return `rgba(239,68,68,${0.1 + intensity * 0.5})`
  }

  return (
    <div>
      {/* Column headers */}
      <div className="flex mb-1">
        <div className="w-8" />
        {DOW_LABELS.map(d => (
          <div key={d} className="flex-1 text-center text-[10px] text-muted2">{d}</div>
        ))}
      </div>
      {/* Grid */}
      {Array.from({ length: 24 }, (_, h) => (
        <div key={h} className="flex mb-px items-center">
          <div className="w-8 text-[9px] text-muted2 text-right pr-1.5 shrink-0">{h.toString().padStart(2, '0')}</div>
          {Array.from({ length: 7 }, (_, dow) => {
            const cell = heatmap[`${h}:${dow}`]
            const avg = cell && cell.count > 0 ? cell.totalPnl / cell.count : null
            return (
              <div
                key={dow}
                className="flex-1 h-4 rounded-sm cursor-default transition-opacity hover:opacity-80"
                style={{ background: cellColor(cell), margin: '0 1px' }}
                title={avg !== null
                  ? `${DOW_LABELS[dow]} ${h}:00 UTC — Avg: ${avg >= 0 ? '+' : ''}$${avg.toFixed(2)} (${cell!.count} trades)`
                  : `${DOW_LABELS[dow]} ${h}:00 UTC — No data`}
              />
            )
          })}
        </div>
      ))}
      {/* Legend */}
      <div className="flex items-center gap-3 mt-3 text-[10px] text-muted">
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded-sm" style={{ background: 'rgba(239,68,68,0.5)' }} />
          <span>Losing</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded-sm" style={{ background: 'rgba(255,255,255,0.04)' }} />
          <span>No data</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded-sm" style={{ background: 'rgba(34,197,94,0.5)' }} />
          <span>Profitable</span>
        </div>
      </div>
    </div>
  )
}

// ── Auto-Tune Suggestions ─────────────────────────────────────────────────────

interface Suggestion {
  category: string
  icon: string
  title: string
  detail: string
  severity: 'good' | 'warn' | 'info'
}

function deriveAutoTuneSuggestions(
  heatmap: Record<string, { totalPnl: number; count: number }>,
  stats: AgentAnalyticsData['stats']
): Suggestion[] {
  const suggestions: Suggestion[] = []
  if (!stats || stats.totalTrades < 10) return suggestions

  // Best/worst hours
  const hourStats = Array.from({ length: 24 }, (_, h) => {
    let pnl = 0; let count = 0
    for (let d = 0; d < 7; d++) {
      const c = heatmap[`${h}:${d}`]
      if (c) { pnl += c.totalPnl; count += c.count }
    }
    return { h, avg: count > 0 ? pnl / count : null, count }
  }).filter(x => x.count >= 2 && x.avg !== null) as { h: number; avg: number; count: number }[]

  const sortedHours = [...hourStats].sort((a, b) => b.avg - a.avg)
  const topHours    = sortedHours.slice(0, 3).filter(x => x.avg > 0)
  const bottomHours = sortedHours.slice(-3).filter(x => x.avg < 0)

  if (topHours.length > 0) {
    suggestions.push({
      category: 'Session',
      icon: '🕐',
      title: `Best trading hours: ${topHours.map(x => `${x.h}:00 UTC`).join(', ')}`,
      detail: `Average P&L +$${topHours[0].avg.toFixed(2)}/trade. Consider narrowing your session window to these hours.`,
      severity: 'good',
    })
  }
  if (bottomHours.length > 0) {
    suggestions.push({
      category: 'Session',
      icon: '⚠️',
      title: `Worst hours: ${bottomHours.map(x => `${x.h}:00 UTC`).join(', ')}`,
      detail: `Average P&L $${bottomHours[0].avg.toFixed(2)}/trade. Excluding these hours may improve overall performance.`,
      severity: 'warn',
    })
  }

  // Best/worst day of week
  const dowStats = Array.from({ length: 7 }, (_, dow) => {
    let pnl = 0; let count = 0
    for (let h = 0; h < 24; h++) {
      const c = heatmap[`${h}:${dow}`]
      if (c) { pnl += c.totalPnl; count += c.count }
    }
    return { dow, avg: count > 0 ? pnl / count : null, count }
  }).filter(x => x.count >= 2 && x.avg !== null) as { dow: number; avg: number; count: number }[]

  const DOW = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
  const worstDay = [...dowStats].sort((a, b) => a.avg - b.avg)[0]
  if (worstDay && worstDay.avg < -2) {
    suggestions.push({
      category: 'Session',
      icon: '📅',
      title: `${DOW[worstDay.dow]} underperforms: avg $${worstDay.avg.toFixed(2)}/trade`,
      detail: `${worstDay.count} trades on ${DOW[worstDay.dow]} with consistently negative results. Consider disabling trading on this day.`,
      severity: 'warn',
    })
  }

  // Win rate trend (first half vs second half)
  if (stats.totalTrades >= 20 && stats.winRate != null) {
    const wr = stats.winRate
    if (wr < 0.40) {
      suggestions.push({
        category: 'Signal',
        icon: '🎯',
        title: `Low win rate (${(wr * 100).toFixed(1)}%) — consider tightening entry conditions`,
        detail: 'Win rate below 40% with standard 1:1.5 R:R is unprofitable long-term. Try raising RSI oversold threshold (e.g. 40→30) for higher-quality longs.',
        severity: 'warn',
      })
    } else if (wr >= 0.55) {
      suggestions.push({
        category: 'Signal',
        icon: '✅',
        title: `Strong win rate (${(wr * 100).toFixed(1)}%) — consider scaling position size`,
        detail: `With ${(wr * 100).toFixed(0)}% win rate and positive expectancy, a modest increase in risk per trade (e.g. +0.5%) would compound gains.`,
        severity: 'good',
      })
    }
  }

  // Risk/Reward derived from wins/losses
  if (stats.avgWin != null && stats.avgLoss != null && stats.avgLoss !== 0) {
    const rr = stats.avgWin / Math.abs(stats.avgLoss)
    if (rr < 0.8) {
      suggestions.push({
        category: 'Risk',
        icon: '🛑',
        title: `Low risk/reward ratio (${rr.toFixed(2)}:1) — wins smaller than losses`,
        detail: 'Average win is smaller than average loss. Widen your TP target or tighten your SL to improve the reward-to-risk profile.',
        severity: 'warn',
      })
    } else if (rr > 2.0) {
      suggestions.push({
        category: 'Risk',
        icon: '🚀',
        title: `Excellent risk/reward (${rr.toFixed(2)}:1)`,
        detail: 'Strong reward-to-risk profile. Ensure backtest parameters match live agent config to replicate these results.',
        severity: 'good',
      })
    }
  }

  // Net P&L vs win count
  if (stats.totalPnl < 0 && stats.totalTrades >= 10) {
    suggestions.push({
      category: 'Risk',
      icon: '📉',
      title: 'Strategy is net losing over this period',
      detail: `Total P&L is $${stats.totalPnl.toFixed(2)}. Review entry conditions — consider tightening RSI thresholds or adding trend filters (ADX, EMA confirmation).`,
      severity: 'warn',
    })
  }

  return suggestions
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export function Analytics() {
  const [agents, setAgents]   = useState<AgentState[]>([])
  const [agentKey, setAgentKey] = useState<string>('')
  const [data, setData]       = useState<AgentAnalyticsData | null>(null)
  const [loading, setLoading] = useState(false)

  // Load agent list
  useEffect(() => {
    getAgents().then(list => {
      setAgents(list)
      if (list.length > 0 && !agentKey) setAgentKey(list[0].agentKey)
    }).catch(() => {})
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const loadAnalytics = useCallback(async (key: string) => {
    if (!key) return
    setLoading(true)
    setData(null)
    try {
      const result = await getAgentAnalytics(key)
      setData(result)
    } catch { /* ignore */ } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (agentKey) loadAnalytics(agentKey)
  }, [agentKey, loadAnalytics])

  // Equity + drawdown series
  const equitySeries = (() => {
    if (!data?.stats.equityCurve) return []
    let peak = 0
    return data.stats.equityCurve.map(p => {
      if (p.cumPnl > peak) peak = p.cumPnl
      const drawdown = peak > 0 ? ((p.cumPnl - peak) / peak) * 100 : 0
      return { ...p, drawdown }
    })
  })()

  const stats = data?.stats

  // Hour-of-day performance
  const hourPerf = (() => {
    if (!data?.heatmap) return []
    return Array.from({ length: 24 }, (_, h) => {
      let totalPnl = 0; let count = 0
      for (let d = 0; d < 7; d++) {
        const cell = data.heatmap[`${h}:${d}`]
        if (cell) { totalPnl += cell.totalPnl; count += cell.count }
      }
      return { hour: `${h}h`, pnl: count > 0 ? totalPnl / count : 0, count }
    })
  })()

  // Exit reason breakdown
  const exitReasons = (() => {
    if (!data?.cycles) return []
    const counts: Record<string, number> = {}
    for (const c of data.cycles) {
      if (!c.pnlUsd) continue
      const r = c.reason?.toLowerCase() ?? ''
      const reason = r.includes('take profit') || r.includes('tp') ? 'Take Profit'
                   : r.includes('stop loss') || r.includes('sl')   ? 'Stop Loss'
                   : r.includes('time') || r.includes('expire')    ? 'Time Exit'
                   : 'Other'
      counts[reason] = (counts[reason] ?? 0) + 1
    }
    return Object.entries(counts).map(([name, value]) => ({ name, value }))
  })()

  const maxDD = stats ? Math.min(...equitySeries.map(p => p.drawdown)) : 0

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold text-text">Analytics</h1>
        <select
          value={agentKey}
          onChange={e => setAgentKey(e.target.value)}
          className="bg-surface border border-border rounded-lg px-3 py-1.5 text-sm text-text focus:outline-none focus:border-green"
        >
          {agents.map(a => (
            <option key={a.agentKey} value={a.agentKey}>
              {a.config.symbol} {a.config.name ? `(${a.config.name})` : ''} — {a.config.market.toUpperCase()}
            </option>
          ))}
        </select>
      </div>

      {loading && (
        <div className="text-center py-16 text-muted">Loading analytics…</div>
      )}

      {!loading && !data && agentKey && (
        <div className="text-center py-16 text-muted">No data available for this agent.</div>
      )}

      {!loading && data && (
        <div className="space-y-6">

          {/* Section 1: KPI Cards */}
          <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
            <KPI
              label="Win Rate"
              value={stats?.winRate != null ? `${(stats.winRate * 100).toFixed(1)}%` : '—'}
              sub={`${stats?.wins ?? 0}W / ${stats?.losses ?? 0}L`}
              color={stats?.winRate != null && stats.winRate >= 0.5 ? 'text-green' : 'text-red'}
            />
            <KPI
              label="Total P&L"
              value={`${(stats?.totalPnl ?? 0) >= 0 ? '+' : ''}$${(stats?.totalPnl ?? 0).toFixed(2)}`}
              sub={`${stats?.totalTrades ?? 0} closed trades`}
              color={(stats?.totalPnl ?? 0) >= 0 ? 'text-green' : 'text-red'}
            />
            <KPI
              label="Sharpe Ratio"
              value={stats?.sharpe != null ? stats.sharpe.toFixed(2) : '—'}
              sub="risk-adjusted return"
              color={stats?.sharpe != null && stats.sharpe > 1 ? 'text-green' : stats?.sharpe != null && stats.sharpe < 0 ? 'text-red' : 'text-text'}
            />
            <KPI
              label="Max Drawdown"
              value={maxDD !== 0 ? `${maxDD.toFixed(1)}%` : '—'}
              sub="from equity peak"
              color={maxDD < -10 ? 'text-red' : maxDD < -5 ? 'text-yellow' : 'text-text'}
            />
          </div>

          {/* Section 2: Equity Curve + Drawdown */}
          {equitySeries.length > 1 && (
            <Card title="Equity Curve & Drawdown">
              <ResponsiveContainer width="100%" height={220}>
                <ComposedChart data={equitySeries}>
                  <defs>
                    <linearGradient id="eqGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor="#22c55e" stopOpacity={0.25} />
                      <stop offset="95%" stopColor="#22c55e" stopOpacity={0}    />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="time" tick={{ fill: '#4b5563', fontSize: 9 }} tickFormatter={t => (t as string).slice(11, 16)} />
                  <YAxis yAxisId="pnl" tick={{ fill: '#4b5563', fontSize: 10 }} tickFormatter={v => `$${(v as number).toFixed(0)}`} />
                  <YAxis yAxisId="dd"  orientation="right" tick={{ fill: '#6b7280', fontSize: 10 }} tickFormatter={v => `${(v as number).toFixed(0)}%`} />
                  <Tooltip
                    contentStyle={{ background: '#1a1a1f', border: '1px solid #2a2a32', borderRadius: 8, fontSize: 12 }}
                    formatter={(v: number, name: string) => name === 'drawdown' ? [`${v.toFixed(1)}%`, 'Drawdown'] : [`$${v.toFixed(2)}`, 'Cum P&L']}
                    labelFormatter={t => new Date(t as string).toLocaleString()}
                  />
                  <ReferenceLine yAxisId="pnl" y={0} stroke="#374151" strokeDasharray="4 2" />
                  {maxDD !== 0 && <ReferenceLine yAxisId="dd" y={maxDD} stroke="#ef444440" strokeDasharray="4 2" />}
                  <Area  yAxisId="pnl" type="monotone" dataKey="cumPnl"   stroke="#22c55e" fill="url(#eqGrad)" strokeWidth={2} dot={false} />
                  <Line  yAxisId="dd"  type="monotone" dataKey="drawdown" stroke="#ef4444" strokeWidth={1.5}   dot={false} strokeDasharray="3 2" />
                </ComposedChart>
              </ResponsiveContainer>
            </Card>
          )}

          {/* Section 3: Session Heatmap */}
          <Card title="Session Heatmap (UTC hours × day of week)">
            <SessionHeatmap heatmap={data.heatmap} totalTrades={stats?.totalTrades ?? 0} />
          </Card>

          {/* Section 4: Trade Breakdown */}
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">

            {/* Hour-of-day performance */}
            {hourPerf.some(h => h.count > 0) && (
              <Card title="Avg P&L by Hour (UTC)">
                <ResponsiveContainer width="100%" height={180}>
                  <BarChart data={hourPerf} barCategoryGap="10%">
                    <XAxis dataKey="hour" tick={{ fill: '#6b7280', fontSize: 9 }} interval={3} />
                    <YAxis tick={{ fill: '#4b5563', fontSize: 10 }} tickFormatter={v => `$${(v as number).toFixed(0)}`} />
                    <Tooltip
                      contentStyle={{ background: '#1a1a1f', border: '1px solid #2a2a32', borderRadius: 8, fontSize: 12 }}
                      formatter={(v: number) => [`$${v.toFixed(2)}`, 'Avg P&L']}
                    />
                    <ReferenceLine y={0} stroke="#374151" />
                    <Bar dataKey="pnl" radius={[2, 2, 0, 0]}>
                      {hourPerf.map((h, i) => <Cell key={i} fill={h.pnl >= 0 ? '#22c55e' : '#ef4444'} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </Card>
            )}

            {/* Exit reason breakdown */}
            {exitReasons.length > 0 && (
              <Card title="Exit Reason Breakdown">
                <div className="space-y-2 mt-2">
                  {exitReasons.map(({ name, value }) => {
                    const total = exitReasons.reduce((s, r) => s + r.value, 0)
                    const pct = total > 0 ? (value / total) * 100 : 0
                    const color = name === 'Take Profit' ? '#22c55e' : name === 'Stop Loss' ? '#ef4444' : '#f59e0b'
                    return (
                      <div key={name}>
                        <div className="flex justify-between text-xs mb-1">
                          <span className="text-muted">{name}</span>
                          <span className="font-mono text-text">{value} ({pct.toFixed(0)}%)</span>
                        </div>
                        <div className="h-1.5 bg-surface2 rounded-full overflow-hidden">
                          <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
                        </div>
                      </div>
                    )
                  })}
                </div>
              </Card>
            )}

            {/* Win/Loss stats */}
            {stats && (
              <Card title="Trade Quality">
                <div className="grid grid-cols-2 gap-3 mt-2 text-xs">
                  <div className="bg-surface2 rounded-lg p-3">
                    <div className="text-muted mb-1">Avg Win</div>
                    <div className="text-green font-mono font-bold text-base">
                      {stats.avgWin != null ? `+$${stats.avgWin.toFixed(2)}` : '—'}
                    </div>
                  </div>
                  <div className="bg-surface2 rounded-lg p-3">
                    <div className="text-muted mb-1">Avg Loss</div>
                    <div className="text-red font-mono font-bold text-base">
                      {stats.avgLoss != null ? `-$${Math.abs(stats.avgLoss).toFixed(2)}` : '—'}
                    </div>
                  </div>
                  <div className="bg-surface2 rounded-lg p-3">
                    <div className="text-muted mb-1">Risk/Reward</div>
                    <div className="text-text font-mono font-bold text-base">
                      {stats.riskReward != null ? `1:${stats.riskReward.toFixed(2)}` : '—'}
                    </div>
                  </div>
                  <div className="bg-surface2 rounded-lg p-3">
                    <div className="text-muted mb-1">Total Ticks</div>
                    <div className="text-text font-mono font-bold text-base">{stats.totalTicks}</div>
                  </div>
                </div>
              </Card>
            )}
          </div>

          {/* Section 5: Auto-Tune Suggestions */}
          {(() => {
            const suggestions = deriveAutoTuneSuggestions(data.heatmap, data.stats)
            if (suggestions.length === 0) return null
            const sevColor = (s: Suggestion['severity']) =>
              s === 'good' ? 'border-green/30 bg-green/5' :
              s === 'warn' ? 'border-yellow/30 bg-yellow/5' :
              'border-border bg-surface2'
            const textColor = (s: Suggestion['severity']) =>
              s === 'good' ? 'text-green' :
              s === 'warn' ? 'text-yellow' :
              'text-muted'
            return (
              <Card title="Auto-Tune Suggestions">
                <p className="text-xs text-muted mb-4">
                  Derived from your trade history. These are data-driven observations, not guaranteed improvements — always backtest before applying.
                </p>
                <div className="space-y-3">
                  {suggestions.map((s, i) => (
                    <div key={i} className={`border rounded-lg px-4 py-3 ${sevColor(s.severity)}`}>
                      <div className="flex items-start gap-3">
                        <span className="text-base mt-0.5 shrink-0">{s.icon}</span>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap mb-1">
                            <span className={`text-[10px] font-bold uppercase tracking-widest ${textColor(s.severity)}`}>{s.category}</span>
                            <span className="text-sm font-medium text-text">{s.title}</span>
                          </div>
                          <p className="text-xs text-muted/80 leading-relaxed">{s.detail}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            )
          })()}

        </div>
      )}
    </div>
  )
}
