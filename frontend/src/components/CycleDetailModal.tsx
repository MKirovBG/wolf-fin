// Wolf-Fin — Cycle Detail Modal

import { useEffect, useState } from 'react'
import { getCycleDetail } from '../api/client.ts'
import type { CycleDetail, LogEntry, LogEvent } from '../types/index.ts'
import { Badge, decisionVariant } from './Badge.tsx'

// ── Helpers ────────────────────────────────────────────────────────────────────

function fmtTime(iso: string) {
  return new Date(iso).toLocaleString([], {
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
}

function timeStr(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

// ── Event display config ───────────────────────────────────────────────────────

const EVENT_COLOR: Partial<Record<LogEvent, string>> = {
  tick_start:         'text-muted2',
  tick_end:           'text-muted2',
  cycle_start:        'text-muted2',
  cycle_end:          'text-muted2',
  cycle_error:        'text-red',
  tick_error:         'text-red',
  tool_call:          'text-blue',
  tool_result:        'text-green',
  tool_error:         'text-red',
  claude_thinking:    'text-yellow',
  llm_request:        'text-muted2',
  decision:           'text-green',
  guardrail_block:    'text-red',
  auto_execute:       'text-yellow',
  auto_execute_error: 'text-red',
  session_start:      'text-muted2',
}

const EVENT_LABEL: Partial<Record<LogEvent, string>> = {
  tick_start:         'START',
  tick_end:           'END',
  cycle_start:        'START',
  cycle_end:          'END',
  cycle_error:        'ERROR',
  tick_error:         'ERROR',
  tool_call:          'CALL',
  tool_result:        'RESULT',
  tool_error:         'ERR',
  claude_thinking:    'THINK',
  llm_request:        'LLM',
  decision:           'DECIDE',
  guardrail_block:    'BLOCK',
  auto_execute:       'EXEC',
  auto_execute_error: 'EXEC ERR',
  session_start:      'SESSION',
}

// ── CollapsibleSection ─────────────────────────────────────────────────────────

function CollapsibleSection({ title, icon, color = 'text-muted', count, defaultOpen = false, children }: {
  title: string; icon: string; color?: string; count?: number; defaultOpen?: boolean; children: React.ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-4 py-2.5 bg-surface2 hover:bg-surface3 transition-colors text-left"
      >
        <div className="flex items-center gap-2">
          <span className={`text-xs font-bold ${color}`}>{icon}</span>
          <span className={`text-xs font-semibold uppercase tracking-wider ${color}`}>{title}</span>
          {count != null && (
            <span className="text-muted2 text-[10px] font-mono">({count})</span>
          )}
        </div>
        <span className="text-muted2 text-xs">{open ? '▲' : '▼'}</span>
      </button>
      {open && <div className="p-4">{children}</div>}
    </div>
  )
}

// ── LogLine ────────────────────────────────────────────────────────────────────

function LogLine({ entry }: { entry: LogEntry }) {
  const color   = EVENT_COLOR[entry.event]  ?? 'text-text'
  const label   = EVENT_LABEL[entry.event]  ?? entry.event.replace(/_/g, ' ').toUpperCase()
  const isMulti = entry.message.includes('\n')

  return (
    <div className="border-b border-border/40 last:border-0 hover:bg-surface2/40 transition-colors">
      <div className="grid gap-x-2 px-3 py-1.5" style={{ gridTemplateColumns: '5rem 5rem 1fr' }}>
        <span className="text-muted2 text-[10px] font-mono leading-5 whitespace-nowrap truncate">
          {timeStr(entry.time)}
        </span>
        <span className={`text-[10px] font-bold font-mono leading-5 whitespace-nowrap truncate ${color}`}>
          {label}
        </span>
        <div className={`text-[11px] font-mono leading-relaxed break-words min-w-0 ${color}`}>
          {isMulti
            ? <pre className="whitespace-pre-wrap break-words text-[11px] font-mono leading-relaxed">{entry.message}</pre>
            : <span>{entry.message}</span>
          }
        </div>
      </div>
    </div>
  )
}

// ── Filtered log block ─────────────────────────────────────────────────────────

const NOISE_EVENTS = new Set<LogEvent>(['tick_start', 'tick_end', 'cycle_start', 'cycle_end', 'llm_request', 'session_start'])

function LogBlock({ logs, filter, emptyText, maxH = 'max-h-72' }: {
  logs: LogEntry[]
  filter: (e: LogEntry) => boolean
  emptyText: string
  maxH?: string
}) {
  const filtered = logs.filter(filter)
  if (filtered.length === 0) {
    return <p className="text-muted text-[10px] text-center py-3">{emptyText}</p>
  }
  return (
    <div className={`bg-bg border border-border rounded overflow-hidden ${maxH} overflow-y-auto`}>
      {filtered.map(e => <LogLine key={e.id} entry={e} />)}
    </div>
  )
}

// ── Main modal ─────────────────────────────────────────────────────────────────

interface Props {
  cycleId: number
  onClose: () => void
}

export function CycleDetailModal({ cycleId, onClose }: Props) {
  const [detail, setDetail] = useState<CycleDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]   = useState<string | null>(null)

  useEffect(() => {
    getCycleDetail(cycleId)
      .then(setDetail)
      .catch(e => setError(e instanceof Error ? e.message : 'Failed to load cycle'))
      .finally(() => setLoading(false))
  }, [cycleId])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  const dec         = detail?.cycle.decision ?? ''
  const isActionable = /^(BUY|SELL)/i.test(dec)
  const logs        = detail?.logs ?? []

  const thinkingLogs = logs.filter(l => l.event === 'claude_thinking')
  const toolLogs     = logs.filter(l => l.event === 'tool_call' || l.event === 'tool_result' || l.event === 'tool_error' || l.event === 'auto_execute' || l.event === 'auto_execute_error')
  const timelineLogs = logs.filter(l => !NOISE_EVENTS.has(l.event as LogEvent))

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-8 pb-8 px-4"
      style={{ background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        className="bg-surface border border-border rounded-xl w-full overflow-hidden flex flex-col"
        style={{ maxWidth: 860, maxHeight: 'calc(100vh - 64px)' }}
      >
        {/* ── Header ──────────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-border shrink-0">
          <div className="flex items-center gap-2.5 flex-wrap">
            {detail ? (
              <>
                <span className="text-text font-bold">{detail.cycle.symbol}</span>
                <Badge label={detail.cycle.market.toUpperCase()} variant={detail.cycle.market} />
                <Badge label={detail.cycle.decision.split(' ')[0]} variant={decisionVariant(detail.cycle.decision)} />
                {isActionable && detail.cycle.pnlUsd != null && (
                  <span className={`text-sm font-mono font-semibold ${detail.cycle.pnlUsd >= 0 ? 'text-green' : 'text-red'}`}>
                    {detail.cycle.pnlUsd >= 0 ? '+' : ''}${detail.cycle.pnlUsd.toFixed(2)}
                  </span>
                )}
                <span className="text-muted text-xs font-mono">{fmtTime(detail.cycle.time)}</span>
              </>
            ) : (
              <span className="text-muted text-sm">Cycle #{cycleId}</span>
            )}
          </div>
          <button onClick={onClose} className="text-muted hover:text-text transition-colors text-xl leading-none ml-4">×</button>
        </div>

        {/* ── Body ────────────────────────────────────────────────────────── */}
        <div className="overflow-y-auto flex-1 px-5 py-4 space-y-3">

          {loading && <div className="py-20 text-center text-muted text-sm">Loading…</div>}
          {error   && <div className="py-10 text-center text-red text-sm font-mono">✗ {error}</div>}

          {detail && (
            <>
              {/* Decision — always open */}
              <CollapsibleSection title="Decision & Reason" icon="★" color="text-green" defaultOpen>
                <div className="space-y-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge label={detail.cycle.decision} variant={decisionVariant(detail.cycle.decision)} />
                    {detail.cycle.error && (
                      <span className="text-red text-[10px] font-mono">⚠ {detail.cycle.error}</span>
                    )}
                  </div>
                  {detail.cycle.reason ? (
                    <p className="text-sm text-text leading-relaxed whitespace-pre-wrap">
                      {detail.cycle.reason}
                    </p>
                  ) : (
                    <p className="text-muted text-xs italic">No reason recorded</p>
                  )}
                </div>
              </CollapsibleSection>

              {/* Thinking */}
              <CollapsibleSection title="Thinking" icon="💭" color="text-yellow" count={thinkingLogs.length}>
                <LogBlock
                  logs={logs}
                  filter={l => l.event === 'claude_thinking'}
                  emptyText="No thinking logs for this cycle"
                  maxH="max-h-96"
                />
              </CollapsibleSection>

              {/* Tool Calls */}
              <CollapsibleSection title="Tool Calls" icon="⚙" color="text-blue" count={toolLogs.length}>
                <LogBlock
                  logs={logs}
                  filter={l => l.event === 'tool_call' || l.event === 'tool_result' || l.event === 'tool_error' || l.event === 'auto_execute' || l.event === 'auto_execute_error'}
                  emptyText="No tool calls for this cycle"
                />
              </CollapsibleSection>

              {/* Full timeline — collapsed by default, filters noise */}
              <CollapsibleSection title="Full Timeline" icon="◈" color="text-muted" count={timelineLogs.length}>
                <LogBlock
                  logs={timelineLogs}
                  filter={() => true}
                  emptyText="No logs found for this cycle"
                  maxH="max-h-80"
                />
              </CollapsibleSection>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
