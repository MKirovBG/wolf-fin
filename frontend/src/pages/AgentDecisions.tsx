import { Fragment, useEffect, useState, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { getAllAnalyses, getStrategies } from '../api/client.ts'
import type { AnalysisResult, Strategy } from '../types/index.ts'
import { useToast } from '../components/Toast.tsx'

const BIAS_COLORS: Record<string, string> = {
  bullish: 'text-green',
  bearish: 'text-red',
  neutral: 'text-yellow',
}

const CONFIDENCE_COLORS: Record<string, string> = {
  high:   'text-green',
  medium: 'text-yellow',
  low:    'text-muted',
}

function rel(iso: string) {
  const d = Date.now() - new Date(iso).getTime()
  if (d < 60000)    return `${Math.floor(d / 1000)}s ago`
  if (d < 3600000)  return `${Math.floor(d / 60000)}m ago`
  if (d < 86400000) return `${Math.floor(d / 3600000)}h ago`
  return `${Math.floor(d / 86400000)}d ago`
}

function SystemPromptModal({ prompt, onClose }: { prompt: string; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />
      <div className="relative bg-surface border border-border rounded-xl shadow-dropdown max-w-3xl w-full max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-3 border-b border-border">
          <h3 className="text-sm font-bold text-text">System Prompt</h3>
          <button onClick={onClose} className="text-muted hover:text-text text-lg leading-none">&times;</button>
        </div>
        <div className="flex-1 overflow-y-auto p-5">
          <pre className="text-xs text-text/80 leading-relaxed whitespace-pre-wrap font-mono bg-bg rounded-lg p-4 border border-border">
            {prompt}
          </pre>
        </div>
      </div>
    </div>
  )
}

export function AgentDecisions() {
  const [analyses, setAnalyses]         = useState<AnalysisResult[]>([])
  const [strategies, setStrategies]     = useState<Strategy[]>([])
  const [loading, setLoading]           = useState(true)
  const [expanded, setExpanded]         = useState<number | null>(null)
  const [promptModal, setPromptModal]   = useState<string | null>(null)
  const [filterSymbol, setFilterSymbol] = useState<string>('')
  const [filterStrategy, setFilterStrategy] = useState<string>('')
  const [filterDirection, setFilterDirection] = useState<string>('')
  const toast = useToast()

  const load = useCallback(async () => {
    try {
      const [data, strats] = await Promise.all([
        getAllAnalyses(200),
        getStrategies().catch(() => [] as Strategy[]),
      ])
      setAnalyses(data)
      setStrategies(strats)
    } catch (e) {
      toast.error(String(e))
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => { load() }, [load])

  const stratMap = Object.fromEntries(strategies.map(s => [s.key, s.name]))

  const filtered = analyses.filter(a => {
    if (a.error) return false
    if (filterSymbol && !a.symbol.toLowerCase().includes(filterSymbol.toLowerCase())) return false
    if (filterStrategy && a.strategyKey !== filterStrategy) return false
    if (filterDirection) {
      const dir = a.tradeProposal?.direction
      if (filterDirection === 'none' && dir) return false
      if (filterDirection !== 'none' && dir !== filterDirection) return false
    }
    return true
  })

  if (loading) {
    return <div className="flex items-center justify-center h-64 text-muted text-sm">Loading...</div>
  }

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-5">

      <div>
        <h1 className="text-lg font-bold text-text">Decision Log</h1>
        <p className="text-xs text-muted mt-0.5">
          Complete audit trail of every AI analysis decision.
        </p>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <input
          value={filterSymbol}
          onChange={e => setFilterSymbol(e.target.value)}
          placeholder="Filter symbol..."
          className="!w-36 text-xs"
        />
        <select value={filterStrategy} onChange={e => setFilterStrategy(e.target.value)} className="!w-40 text-xs">
          <option value="">All strategies</option>
          {strategies.map(s => <option key={s.key} value={s.key}>{s.name}</option>)}
        </select>
        <select value={filterDirection} onChange={e => setFilterDirection(e.target.value)} className="!w-32 text-xs">
          <option value="">All directions</option>
          <option value="BUY">BUY</option>
          <option value="SELL">SELL</option>
          <option value="none">No trade</option>
        </select>
        <span className="text-[10px] text-muted2">{filtered.length} decisions</span>
      </div>

      {/* Table */}
      <div className="bg-surface border border-border rounded-xl overflow-hidden">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border text-[10px] uppercase tracking-wider text-muted">
              <th className="px-4 py-2.5 text-left font-semibold">Time</th>
              <th className="px-4 py-2.5 text-left font-semibold">Symbol</th>
              <th className="px-4 py-2.5 text-left font-semibold">Strategy</th>
              <th className="px-4 py-2.5 text-left font-semibold">Bias</th>
              <th className="px-4 py-2.5 text-left font-semibold">Direction</th>
              <th className="px-4 py-2.5 text-left font-semibold">Confidence</th>
              <th className="px-4 py-2.5 text-left font-semibold">R:R</th>
              <th className="px-4 py-2.5 text-left font-semibold">Model</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {filtered.slice(0, 100).map(a => (
              <Fragment key={a.id}>
                <tr
                  onClick={() => setExpanded(expanded === a.id ? null : a.id)}
                  className="hover:bg-surface2 cursor-pointer transition-colors"
                >
                  <td className="px-4 py-2.5 font-mono text-muted2 whitespace-nowrap">{rel(a.time)}</td>
                  <td className="px-4 py-2.5">
                    <Link
                      to={`/symbols/${encodeURIComponent(a.symbolKey)}`}
                      onClick={e => e.stopPropagation()}
                      className="font-mono font-medium text-text hover:text-brand transition-colors"
                    >
                      {a.symbol}
                    </Link>
                  </td>
                  <td className="px-4 py-2.5 text-purple">
                    {a.strategyKey ? (stratMap[a.strategyKey] ?? a.strategyKey) : '—'}
                  </td>
                  <td className="px-4 py-2.5">
                    <span className={BIAS_COLORS[a.bias] ?? 'text-muted'}>
                      {a.bias === 'bullish' ? '▲' : a.bias === 'bearish' ? '▼' : '—'} {a.bias}
                    </span>
                  </td>
                  <td className="px-4 py-2.5">
                    {a.tradeProposal?.direction ? (
                      <span className={a.tradeProposal.direction === 'BUY' ? 'text-green font-medium' : 'text-red font-medium'}>
                        {a.tradeProposal.direction}
                      </span>
                    ) : (
                      <span className="text-muted2">—</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    {a.tradeProposal?.confidence ? (
                      <span className={CONFIDENCE_COLORS[a.tradeProposal.confidence] ?? 'text-muted'}>
                        {a.tradeProposal.confidence}
                      </span>
                    ) : '—'}
                  </td>
                  <td className="px-4 py-2.5 font-mono">
                    {a.tradeProposal?.riskReward ? a.tradeProposal.riskReward.toFixed(1) : '—'}
                  </td>
                  <td className="px-4 py-2.5 text-muted2 font-mono truncate max-w-[120px]">{a.llmModel}</td>
                </tr>

                {expanded === a.id && (
                  <tr>
                    <td colSpan={8} className="px-6 py-4 bg-surface2">
                      <div className="space-y-3">
                        <p className="text-sm text-text leading-relaxed">{a.summary}</p>

                        {a.tradeProposal && (
                          <div className="text-xs text-muted leading-relaxed">
                            <span className="text-muted2 font-semibold">Reasoning: </span>
                            {a.tradeProposal.reasoning}
                          </div>
                        )}

                        {a.reasoningChain && a.reasoningChain.length > 0 && (
                          <div className="space-y-1.5">
                            <div className="text-[10px] font-semibold uppercase tracking-wider text-muted2">Reasoning Chain</div>
                            {a.reasoningChain.map((step, i) => (
                              <div key={i} className="flex gap-2 text-xs">
                                <span className="text-brand font-bold flex-shrink-0">{i + 1}.</span>
                                <div>
                                  <span className="font-medium text-text">{step.step}:</span>{' '}
                                  <span className="text-muted">{step.detail}</span>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}

                        <div className="flex items-center justify-between">
                          <div className="text-[10px] text-muted2">
                            ID: #{a.id} | {new Date(a.time).toLocaleString()} | {a.llmProvider} / {a.llmModel}
                          </div>
                          {a.systemPrompt && (
                            <button
                              onClick={e => { e.stopPropagation(); setPromptModal(a.systemPrompt!) }}
                              className="text-[10px] px-2 py-0.5 rounded border border-purple/30 text-purple hover:bg-purple/10 transition-colors"
                            >
                              View System Prompt
                            </button>
                          )}
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>

        {filtered.length === 0 && (
          <div className="px-6 py-8 text-center text-sm text-muted">No decisions match the current filters</div>
        )}
      </div>

      {promptModal && <SystemPromptModal prompt={promptModal} onClose={() => setPromptModal(null)} />}
    </div>
  )
}
