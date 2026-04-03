import { useEffect, useState, useCallback, useMemo, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { getAllAnalyses } from '../api/client.ts'
import type { AnalysisResult, CandleBar } from '../types/index.ts'
import { Card } from '../components/Card.tsx'

// ── Helpers ───────────────────────────────────────────────────────────────────

const BIAS_BG: Record<string, string> = {
  bullish: 'bg-green/10 text-green border-green/30',
  bearish: 'bg-red/10 text-red border-red/30',
  neutral: 'bg-yellow/10 text-yellow border-yellow/30',
}
const BIAS_ICONS: Record<string, string> = {
  bullish: '▲', bearish: '▼', neutral: '—',
}

function rel(iso: string) {
  const d = Date.now() - new Date(iso).getTime()
  if (d < 60000)    return `${Math.floor(d / 1000)}s ago`
  if (d < 3600000)  return `${Math.floor(d / 60000)}m ago`
  if (d < 86400000) return `${Math.floor(d / 3600000)}h ago`
  return `${Math.floor(d / 86400000)}d ago`
}
function fmt(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}
function fmtCandle(c: CandleBar, digits: number) {
  const d = new Date(c.time * 1000).toISOString().replace('T', ' ').slice(0, 16)
  const dir = c.close >= c.open ? '▲' : '▼'
  return `${d}  O:${c.open.toFixed(digits)}  H:${c.high.toFixed(digits)}  L:${c.low.toFixed(digits)}  C:${c.close.toFixed(digits)}  V:${c.volume.toFixed(2)} ${dir}`
}

// ── Analysis detail modal ─────────────────────────────────────────────────────

type ModalTab = 'prompt' | 'response' | 'thinking' | 'parsed'

function AnalysisModal({ analysis, onClose }: { analysis: AnalysisResult; onClose: () => void }) {
  const [tab, setTab] = useState<ModalTab>('prompt')

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  const digits = analysis.context.symbolInfo?.digits ?? 5
  const hasThinking = !!analysis.llmThinking

  const tabs: { id: ModalTab; label: string }[] = [
    { id: 'prompt',   label: 'Prompt Data'  },
    { id: 'response', label: 'LLM Response' },
    ...(hasThinking ? [{ id: 'thinking' as ModalTab, label: 'Thinking' }] : []),
    { id: 'parsed',   label: 'Parsed Output'},
  ]

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-12 overflow-y-auto">
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />

      {/* Modal */}
      <div className="relative z-10 w-full max-w-4xl bg-bg border border-border rounded-xl shadow-2xl flex flex-col max-h-[85vh]">

        {/* Header */}
        <div className="flex items-start justify-between px-5 py-4 border-b border-border flex-shrink-0">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="font-mono font-bold text-text">{analysis.symbol}</span>
              <span className="text-[10px] bg-surface border border-border rounded px-1.5 py-0.5 font-mono text-muted uppercase">{analysis.timeframe}</span>
              {!analysis.error && (
                <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded border ${BIAS_BG[analysis.bias] ?? ''}`}>
                  {BIAS_ICONS[analysis.bias]} {analysis.bias}
                </span>
              )}
              {analysis.error && <span className="text-[10px] text-red border border-red/30 bg-red/10 rounded px-1.5 py-0.5">Error</span>}
            </div>
            <div className="text-[11px] text-muted2">{fmt(analysis.time)} · {analysis.llmProvider} · {analysis.llmModel}</div>
          </div>
          <button onClick={onClose} className="text-muted hover:text-text text-lg leading-none ml-4 flex-shrink-0">✕</button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-border flex-shrink-0 px-2">
          {tabs.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-4 py-2.5 text-xs font-medium transition-colors border-b-2 -mb-px ${
                tab === t.id
                  ? 'border-green text-green'
                  : 'border-transparent text-muted hover:text-text'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5">

          {/* ── Prompt Data ── */}
          {tab === 'prompt' && (
            <div className="space-y-5">

              {/* Price & Symbol Info */}
              {analysis.context.currentPrice && (
                <Section title="Market Price at Analysis Time">
                  <Grid>
                    <KV k="Bid"    v={analysis.context.currentPrice.bid?.toFixed(digits) ?? '—'} mono />
                    <KV k="Ask"    v={analysis.context.currentPrice.ask?.toFixed(digits) ?? '—'} mono />
                    <KV k="Mid"    v={(analysis.context.currentPrice as { mid?: number }).mid?.toFixed(digits) ?? '—'} mono />
                    <KV k="Spread" v={`${analysis.context.currentPrice.spread?.toFixed(1) ?? '—'} pips`} mono />
                  </Grid>
                </Section>
              )}

              {analysis.context.symbolInfo && (
                <Section title="Symbol Info">
                  <Grid>
                    <KV k="Digits"     v={String(analysis.context.symbolInfo.digits)} />
                    <KV k="Point"      v={String(analysis.context.symbolInfo.point)} mono />
                    <KV k="Vol Min"    v={String(analysis.context.symbolInfo.volumeMin)} />
                    <KV k="Vol Step"   v={String(analysis.context.symbolInfo.volumeStep)} />
                  </Grid>
                </Section>
              )}

              {/* Indicators */}
              {Object.keys(analysis.indicators).length > 0 && (
                <Section title={`Indicators Sent to LLM (${Object.keys(analysis.indicators).length})`}>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-1.5">
                    {Object.entries(analysis.indicators).map(([k, v]) => (
                      <div key={k} className="flex justify-between text-xs">
                        <span className="text-muted uppercase tracking-wider text-[10px]">{k}</span>
                        <span className={`font-mono ${
                          v === 'Bullish' || v === 'Rising' || v === 'Above' ? 'text-green' :
                          v === 'Bearish' || v === 'Falling' || v === 'Below' ? 'text-red' : 'text-text'
                        }`}>{typeof v === 'number' ? v.toFixed(Math.abs(v) < 10 ? 2 : 2) : String(v)}</span>
                      </div>
                    ))}
                  </div>
                </Section>
              )}

              {/* Candles */}
              {analysis.candles.length > 0 && (
                <Section title={`Candle Data (${analysis.candles.length} bars · ${analysis.timeframe.toUpperCase()})`}>
                  <pre className="text-[10px] font-mono text-muted leading-relaxed whitespace-pre overflow-x-auto bg-bg border border-border rounded p-3 max-h-56 overflow-y-auto">
                    {/* Show first 3 + last 10 candles */}
                    {[
                      ...analysis.candles.slice(0, 3).map(c => fmtCandle(c, digits)),
                      analysis.candles.length > 13 ? `  … ${analysis.candles.length - 13} bars …` : null,
                      ...analysis.candles.slice(-10).map(c => fmtCandle(c, digits)),
                    ].filter(Boolean).join('\n')}
                  </pre>
                </Section>
              )}

              {/* System Prompt */}
              {analysis.systemPrompt && (
                <Section title="System Prompt">
                  <pre className="text-[11px] font-mono text-text/80 leading-relaxed whitespace-pre-wrap bg-bg border border-border rounded-lg p-4 max-h-64 overflow-y-auto">
                    {analysis.systemPrompt}
                  </pre>
                </Section>
              )}

              {/* News */}
              {analysis.context.news && analysis.context.news.length > 0 && (
                <Section title={`News Context (${analysis.context.news.length} items)`}>
                  <div className="space-y-1.5">
                    {analysis.context.news.map((n, i) => (
                      <div key={i} className="flex items-start gap-2 text-xs">
                        <span className={`flex-shrink-0 text-[9px] px-1.5 py-0.5 rounded font-medium uppercase ${
                          n.sentiment === 'bullish' ? 'text-green bg-green/10' :
                          n.sentiment === 'bearish' ? 'text-red bg-red/10' : 'text-muted bg-surface'
                        }`}>{n.sentiment}</span>
                        <span className="text-text/80">{n.headline}</span>
                      </div>
                    ))}
                  </div>
                </Section>
              )}

              {/* Calendar */}
              {analysis.context.calendar && analysis.context.calendar.length > 0 && (
                <Section title={`Economic Events (${analysis.context.calendar.length} items)`}>
                  <div className="space-y-1.5">
                    {analysis.context.calendar.map((e, i) => (
                      <div key={i} className="flex items-center gap-2 text-xs">
                        <span className={`flex-shrink-0 text-[9px] px-1.5 py-0.5 rounded font-medium ${
                          e.impact === 'High' ? 'text-red bg-red/10' :
                          e.impact === 'Medium' ? 'text-yellow bg-yellow-dim' : 'text-muted bg-surface'
                        }`}>{e.impact}</span>
                        <span className="text-muted2 w-6 flex-shrink-0">{e.country}</span>
                        <span className="text-text/80 flex-1">{e.event}</span>
                        <span className="text-muted text-[10px] flex-shrink-0">{new Date(e.time).toLocaleString()}</span>
                      </div>
                    ))}
                  </div>
                </Section>
              )}

              {!analysis.context.currentPrice && !analysis.context.news?.length && !analysis.context.calendar?.length && (
                <p className="text-xs text-muted2">No context data stored for this analysis.</p>
              )}
            </div>
          )}

          {/* ── LLM Response ── */}
          {tab === 'response' && (
            <div className="space-y-3">
              {analysis.rawResponse ? (
                <>
                  <p className="text-xs text-muted">Full text returned by the model before JSON extraction.</p>
                  <pre className="text-[11px] font-mono text-text leading-relaxed whitespace-pre-wrap bg-bg border border-border rounded-lg p-4 overflow-x-auto max-h-[60vh] overflow-y-auto">
                    {analysis.rawResponse}
                  </pre>
                </>
              ) : (
                <div className="text-center py-12 text-muted text-sm">
                  Raw response not available — captured in analyses run after the last update.
                </div>
              )}
              {analysis.error && (
                <div className="bg-red/10 border border-red/30 rounded-lg p-4">
                  <div className="text-xs font-semibold text-red mb-1">Analysis Error</div>
                  <pre className="text-xs text-red/80 whitespace-pre-wrap">{analysis.error}</pre>
                </div>
              )}
            </div>
          )}

          {/* ── Thinking ── */}
          {tab === 'thinking' && (
            <div className="space-y-3">
              {analysis.llmThinking ? (
                <>
                  <p className="text-xs text-muted">Extended thinking block — the model's internal reasoning before producing its response.</p>
                  <pre className="text-[11px] font-mono text-text/80 leading-relaxed whitespace-pre-wrap bg-bg border border-border rounded-lg p-4 overflow-x-auto max-h-[60vh] overflow-y-auto">
                    {analysis.llmThinking}
                  </pre>
                </>
              ) : (
                <div className="text-center py-12 text-muted text-sm">No thinking block.</div>
              )}
            </div>
          )}

          {/* ── Parsed Output ── */}
          {tab === 'parsed' && (
            <div className="space-y-4">
              {/* Bias + summary */}
              <Section title="Bias & Summary">
                <div className="flex items-center gap-2 mb-2">
                  <span className={`text-sm font-bold uppercase ${
                    analysis.bias === 'bullish' ? 'text-green' :
                    analysis.bias === 'bearish' ? 'text-red' : 'text-yellow'
                  }`}>{BIAS_ICONS[analysis.bias]} {analysis.bias}</span>
                </div>
                <p className="text-sm text-text/80 leading-relaxed">{analysis.summary || '—'}</p>
              </Section>

              {/* Key levels */}
              {analysis.keyLevels.length > 0 && (
                <Section title={`Key Levels (${analysis.keyLevels.length})`}>
                  <div className="space-y-1.5">
                    {analysis.keyLevels.map((l, i) => (
                      <div key={i} className="flex items-center justify-between text-xs">
                        <div className="flex items-center gap-2">
                          <span className={`w-2 h-2 rounded-full flex-shrink-0 ${
                            l.type === 'support' ? 'bg-green' :
                            l.type === 'resistance' ? 'bg-red' : 'bg-purple-400'
                          }`} />
                          <span className={l.type === 'support' ? 'text-green' : l.type === 'resistance' ? 'text-red' : 'text-purple-400'}>
                            {l.type}
                          </span>
                          {l.label && <span className="text-muted2">{l.label}</span>}
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] text-muted border border-border rounded px-1 py-0.5">{l.strength}</span>
                          <span className="font-mono text-text">{l.price.toFixed(digits)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </Section>
              )}

              {/* Trade proposal */}
              {analysis.tradeProposal && (
                <Section title="Trade Proposal">
                  <Grid>
                    <KV k="Direction"  v={analysis.tradeProposal.direction ?? '—'} />
                    <KV k="Confidence" v={analysis.tradeProposal.confidence} />
                    <KV k="R:R"        v={analysis.tradeProposal.riskReward.toFixed(2)} mono />
                    <KV k="Stop Loss"  v={analysis.tradeProposal.stopLoss.toFixed(digits)} mono />
                    <KV k="Entry Low"  v={analysis.tradeProposal.entryZone.low.toFixed(digits)} mono />
                    <KV k="Entry High" v={analysis.tradeProposal.entryZone.high.toFixed(digits)} mono />
                    {analysis.tradeProposal.takeProfits.map((tp, i) => (
                      <KV key={i} k={`TP${i + 1}`} v={tp.toFixed(digits)} mono />
                    ))}
                  </Grid>
                  <p className="text-xs text-text/80 leading-relaxed mt-3">{analysis.tradeProposal.reasoning}</p>
                  {analysis.tradeProposal.invalidatedIf && (
                    <p className="text-xs text-muted mt-2">
                      <span className="text-muted2 font-medium">Invalidated if: </span>
                      {analysis.tradeProposal.invalidatedIf}
                    </p>
                  )}
                </Section>
              )}

              {/* Full JSON */}
              <Section title="Full JSON">
                <pre className="text-[10px] font-mono text-muted leading-relaxed whitespace-pre-wrap bg-bg border border-border rounded-lg p-3 overflow-x-auto max-h-72 overflow-y-auto">
                  {JSON.stringify({
                    bias:          analysis.bias,
                    summary:       analysis.summary,
                    keyLevels:     analysis.keyLevels,
                    tradeProposal: analysis.tradeProposal,
                  }, null, 2)}
                </pre>
              </Section>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-border flex items-center justify-between flex-shrink-0">
          <Link
            to={`/symbols/${encodeURIComponent(analysis.symbolKey)}`}
            className="text-xs text-green hover:underline"
          >
            → Open symbol detail
          </Link>
          <button onClick={onClose} className="text-xs text-muted border border-border rounded px-3 py-1 hover:text-text hover:bg-surface2 transition-colors">
            Close
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Small layout helpers ───────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <div className="text-[10px] font-semibold uppercase tracking-wider text-muted2 mb-2 pb-1 border-b border-border/50">{title}</div>
      {children}
    </div>
  )
}
function Grid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-2">{children}</div>
}
function KV({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="text-xs">
      <div className="text-[10px] text-muted uppercase tracking-wider mb-0.5">{k}</div>
      <div className={mono ? 'font-mono text-text' : 'text-text'}>{v}</div>
    </div>
  )
}

// ── History page ──────────────────────────────────────────────────────────────

export function History() {
  const [analyses, setAnalyses]         = useState<AnalysisResult[]>([])
  const [loading, setLoading]           = useState(true)
  const [filterSymbol, setFilterSymbol] = useState('')
  const [filterBias, setFilterBias]     = useState<'all' | 'bullish' | 'bearish' | 'neutral'>('all')
  const [filterTrade, setFilterTrade]   = useState<'all' | 'yes' | 'no'>('all')
  const [selected, setSelected]         = useState<AnalysisResult | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try { setAnalyses(await getAllAnalyses(200)) }
    catch { /* ignore */ }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    const es = new EventSource('/api/analyses/stream')
    es.onmessage = () => load()
    return () => es.close()
  }, [load])

  const symbolOptions = useMemo(() => {
    const seen = new Set<string>()
    analyses.forEach(a => seen.add(a.symbol))
    return Array.from(seen).sort()
  }, [analyses])

  const filtered = useMemo(() => analyses.filter(a => {
    if (filterSymbol && a.symbol !== filterSymbol) return false
    if (filterBias !== 'all' && a.bias !== filterBias) return false
    if (filterTrade === 'yes' && (!a.tradeProposal || a.error)) return false
    if (filterTrade === 'no' && a.tradeProposal && !a.error) return false
    return true
  }), [analyses, filterSymbol, filterBias, filterTrade])

  const bullish   = analyses.filter(a => a.bias === 'bullish' && !a.error).length
  const bearish   = analyses.filter(a => a.bias === 'bearish' && !a.error).length
  const neutral   = analyses.filter(a => a.bias === 'neutral'  && !a.error).length
  const withTrade = analyses.filter(a => a.tradeProposal && !a.error).length
  const errors    = analyses.filter(a => a.error).length

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      {selected && <AnalysisModal analysis={selected} onClose={() => setSelected(null)} />}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-text">History</h1>
          <p className="text-xs text-muted mt-0.5">Full analysis history across all symbols — click any row to inspect</p>
        </div>
        <button
          onClick={load}
          className="px-3 py-1.5 text-sm border border-border text-muted rounded-lg hover:text-text hover:border-muted2 transition-colors"
        >
          ↻ Refresh
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {[
          { label: 'Total',        value: analyses.length, color: 'text-text'   },
          { label: 'Bullish',      value: bullish,         color: 'text-green'  },
          { label: 'Bearish',      value: bearish,         color: 'text-red'    },
          { label: 'Neutral',      value: neutral,         color: 'text-yellow' },
          { label: 'Trade Setups', value: withTrade,       color: 'text-green'  },
        ].map(s => (
          <Card key={s.label}>
            <div className="text-center py-1">
              <div className={`text-xl font-bold ${s.color}`}>{s.value}</div>
              <div className="text-[11px] text-muted mt-0.5">{s.label}</div>
            </div>
          </Card>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-center">
        <select
          value={filterSymbol}
          onChange={e => setFilterSymbol(e.target.value)}
          className="bg-bg border border-border rounded px-2.5 py-1.5 text-sm text-text focus:outline-none focus:border-green"
        >
          <option value="">All symbols</option>
          {symbolOptions.map(s => <option key={s} value={s}>{s}</option>)}
        </select>

        <div className="flex gap-1">
          {(['all', 'bullish', 'bearish', 'neutral'] as const).map(b => (
            <button key={b} onClick={() => setFilterBias(b)}
              className={`px-2.5 py-1.5 text-xs rounded border transition-colors capitalize ${
                filterBias === b ? 'border-green text-green bg-green/10' : 'border-border text-muted hover:text-text hover:border-muted2'
              }`}
            >
              {b === 'all' ? 'All bias' : `${BIAS_ICONS[b]} ${b}`}
            </button>
          ))}
        </div>

        <div className="flex gap-1">
          {(['all', 'yes', 'no'] as const).map(t => (
            <button key={t} onClick={() => setFilterTrade(t)}
              className={`px-2.5 py-1.5 text-xs rounded border transition-colors ${
                filterTrade === t ? 'border-green text-green bg-green/10' : 'border-border text-muted hover:text-text hover:border-muted2'
              }`}
            >
              {t === 'all' ? 'All' : t === 'yes' ? '+ Trade setup' : '— No trade'}
            </button>
          ))}
        </div>

        <span className="ml-auto text-xs text-muted2 font-mono">{filtered.length} / {analyses.length}</span>
      </div>

      {/* Table */}
      {loading ? (
        <Card><div className="py-12 text-center text-xs text-muted2">Loading…</div></Card>
      ) : filtered.length === 0 ? (
        <Card>
          <div className="py-12 text-center text-xs text-muted2">
            {analyses.length === 0 ? 'No analyses yet — trigger one from the Watchlist' : 'No results match your filters'}
          </div>
        </Card>
      ) : (
        <div className="bg-surface border border-border rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  {['Time', 'Symbol', 'TF', 'Bias', 'Summary', 'Trade', 'Model', ''].map(h => (
                    <th key={h} className="text-left text-[10px] font-semibold uppercase tracking-wider text-muted px-4 py-2.5 bg-surface whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map(a => (
                  <tr
                    key={a.id}
                    onClick={() => setSelected(a)}
                    className="border-b border-border/50 hover:bg-surface2 cursor-pointer transition-colors group"
                  >
                    <td className="px-4 py-3 whitespace-nowrap">
                      <div className="text-[11px] text-muted2 font-mono">{rel(a.time)}</div>
                      <div className="text-[10px] text-muted2/60">{fmt(a.time)}</div>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className="font-mono text-sm font-bold text-text">{a.symbol}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-[10px] bg-bg border border-border rounded px-1.5 py-0.5 font-mono text-muted uppercase">{a.timeframe}</span>
                    </td>
                    <td className="px-4 py-3">
                      {a.error ? (
                        <span className="text-xs text-red/70">Error</span>
                      ) : (
                        <span className={`inline-flex items-center gap-1 text-[11px] font-medium px-1.5 py-0.5 rounded border ${BIAS_BG[a.bias] ?? ''}`}>
                          {BIAS_ICONS[a.bias]} {a.bias}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 max-w-xs">
                      {a.error ? (
                        <span className="text-[11px] text-red/60 line-clamp-1">{a.error}</span>
                      ) : (
                        <span className="text-[11px] text-text/70 line-clamp-2 leading-snug">{a.summary}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {a.tradeProposal && !a.error ? (
                        <div className={`inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded border ${
                          a.tradeProposal.direction === 'BUY' ? 'text-green border-green/30 bg-green/10' : 'text-red border-red/30 bg-red/10'
                        }`}>
                          {a.tradeProposal.direction} · {a.tradeProposal.riskReward.toFixed(1)}R
                        </div>
                      ) : <span className="text-[10px] text-muted2">—</span>}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className="text-[10px] text-muted2 font-mono truncate max-w-[7rem] block">{a.llmModel}</span>
                    </td>
                    <td className="px-3 py-3 text-right">
                      <span className="text-[11px] text-muted group-hover:text-green transition-colors">↗</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {errors > 0 && (
            <div className="px-4 py-2 border-t border-border bg-red/5">
              <span className="text-[11px] text-red/70">{errors} error{errors !== 1 ? 's' : ''} in history</span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
