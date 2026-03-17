// Wolf-Fin — Cycle Detail Modal
// Shows the full context of a single trading cycle: decision, thinking, tools, agent config.

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

function iLabel(s: number) {
  if (!s) return '—'
  if (s < 60) return `${s}s`
  if (s < 3600) return `${s / 60} min`
  return `${s / 3600}h`
}

// ── Section header ─────────────────────────────────────────────────────────────

function Section({ title, icon, color = 'text-muted', children }: {
  title: string; icon: string; color?: string; children: React.ReactNode
}) {
  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2.5 bg-surface border-b border-border">
        <span className={`text-[10px] font-bold ${color}`}>{icon}</span>
        <span className={`text-[10px] font-bold tracking-widest uppercase ${color}`}>{title}</span>
      </div>
      <div className="p-4">{children}</div>
    </div>
  )
}

// ── Log event colours & prefixes ──────────────────────────────────────────────

const EVENT_COLOR: Partial<Record<LogEvent, string>> = {
  cycle_start:        'text-green',
  cycle_end:          'text-green',
  cycle_error:        'text-red',
  tool_call:          'text-blue-400',
  tool_result:        'text-cyan-400',
  tool_error:         'text-red',
  claude_thinking:    'text-yellow',
  decision:           'text-green',
  guardrail_block:    'text-red',
  auto_execute:       'text-cyan-400',
  auto_execute_error: 'text-red',
}

const EVENT_PREFIX: Partial<Record<LogEvent, string>> = {
  cycle_start:        '▶ START',
  cycle_end:          '■ END',
  cycle_error:        '✗ ERROR',
  tool_call:          '⚙ CALL',
  tool_result:        '← RESULT',
  tool_error:         '✗ ERR',
  claude_thinking:    '💭',
  decision:           '★ DECIDE',
  guardrail_block:    '⛔ BLOCK',
  auto_execute:       '⚡ EXEC',
  auto_execute_error: '✗ EXEC',
}

function LogLine({ entry }: { entry: LogEntry }) {
  const color = EVENT_COLOR[entry.event] ?? 'text-white'
  const prefix = EVENT_PREFIX[entry.event] ?? entry.event
  const isMultiLine = entry.message.includes('\n')

  return (
    <div className="border-b border-[#1a1a1a] last:border-0 hover:bg-surface transition-colors">
      <div className="flex gap-2 items-start px-3 py-1.5">
        <span className="text-muted2 text-[9px] whitespace-nowrap font-mono mt-0.5 shrink-0 w-14">
          {timeStr(entry.time)}
        </span>
        <span className={`text-[9px] font-bold whitespace-nowrap font-mono mt-0.5 w-16 shrink-0 ${color}`}>
          {prefix}
        </span>
        <div className={`text-[10px] font-mono leading-relaxed flex-1 min-w-0 ${color === 'text-yellow' ? 'text-[#ddd]' : color}`}>
          {isMultiLine
            ? <pre className="whitespace-pre-wrap break-words text-[10px] font-mono leading-relaxed">{entry.message}</pre>
            : <span className="break-words">{entry.message}</span>
          }
        </div>
      </div>
    </div>
  )
}

function LogBlock({ logs, filter, emptyText }: {
  logs: LogEntry[]
  filter: (e: LogEntry) => boolean
  emptyText: string
}) {
  const filtered = logs.filter(filter)
  if (filtered.length === 0) {
    return <p className="text-muted text-[10px] text-center py-4">{emptyText}</p>
  }
  return (
    <div className="bg-bg border border-border rounded overflow-hidden max-h-72 overflow-y-auto font-mono">
      {filtered.map(e => <LogLine key={e.id} entry={e} />)}
    </div>
  )
}

// ── Metric ──────────────────────────────────────────────────────────────────────

function Meta({ label, value, color = 'text-white' }: { label: string; value: React.ReactNode; color?: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[9px] uppercase tracking-widest text-muted">{label}</span>
      <span className={`text-xs font-mono font-bold ${color}`}>{value}</span>
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
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    getCycleDetail(cycleId)
      .then(setDetail)
      .catch(e => setError(e instanceof Error ? e.message : 'Failed to load cycle'))
      .finally(() => setLoading(false))
  }, [cycleId])

  // Close on backdrop click or Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  const dec = detail?.cycle.decision ?? ''
  const isActionable = dec.toUpperCase().startsWith('BUY') || dec.toUpperCase().startsWith('SELL')

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-8 pb-8 px-4"
      style={{ background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        className="bg-surface border border-border rounded-xl w-full overflow-hidden flex flex-col"
        style={{ maxWidth: 900, maxHeight: 'calc(100vh - 64px)' }}
      >
        {/* ── Modal header ──────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <div className="flex items-center gap-2.5">
            {detail ? (
              <>
                <span className="text-white font-bold text-base">{detail.cycle.symbol}</span>
                <Badge label={detail.cycle.market.toUpperCase()} variant={detail.cycle.market} />
                <Badge label={detail.cycle.decision} variant={decisionVariant(detail.cycle.decision)} />
                {isActionable && (
                  <span className="text-[10px] text-muted border border-border rounded px-1.5 py-0.5 font-mono">
                    {detail.cycle.pnlUsd != null
                      ? <span className={detail.cycle.pnlUsd >= 0 ? 'text-green' : 'text-red'}>
                          P&L {detail.cycle.pnlUsd >= 0 ? '+' : ''}${detail.cycle.pnlUsd.toFixed(2)}
                        </span>
                      : 'No P&L recorded'}
                  </span>
                )}
              </>
            ) : (
              <span className="text-muted text-sm">Cycle #{cycleId}</span>
            )}
          </div>
          <button
            onClick={onClose}
            className="text-muted hover:text-white transition-colors text-lg leading-none px-1"
          >
            ×
          </button>
        </div>

        {/* ── Scrollable content ────────────────────────────────────────────── */}
        <div className="overflow-y-auto flex-1 px-5 py-5 space-y-4">

          {loading && (
            <div className="py-20 text-center text-muted text-sm">Loading cycle detail...</div>
          )}

          {error && (
            <div className="py-10 text-center text-red text-sm font-mono">✗ {error}</div>
          )}

          {detail && (
            <>
              {/* ── Time + agent ──────────────────────────────────────────── */}
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-muted font-mono">{fmtTime(detail.cycle.time)}</span>
                <span className="text-muted">
                  Agent: <span className="text-white font-mono">{detail.cycle.agentKey}</span>
                </span>
              </div>

              {/* ── Decision & Reason ─────────────────────────────────────── */}
              <Section title="Decision" icon="★" color="text-green">
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <Badge label={detail.cycle.decision} variant={decisionVariant(detail.cycle.decision)} />
                    {detail.cycle.error && (
                      <span className="text-red text-[10px] font-mono">⚠ {detail.cycle.error}</span>
                    )}
                  </div>
                  {detail.cycle.reason && (
                    <p className="text-sm text-[#d0d0d0] leading-relaxed font-mono whitespace-pre-wrap">
                      {detail.cycle.reason}
                    </p>
                  )}
                </div>
              </Section>

              {/* ── Agent Configuration ───────────────────────────────────── */}
              {detail.agent && (
                <Section title="Agent Configuration" icon="⚙" color="text-blue-400">
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                    <Meta label="Market" value={detail.agent.config.market.toUpperCase()} />
                    <Meta label="Fetch Mode" value={detail.agent.config.fetchMode} />
                    {detail.agent.config.fetchMode !== 'manual' && (
                      <Meta label="Interval" value={iLabel(detail.agent.config.scheduleIntervalSeconds)} />
                    )}
                    <Meta
                      label="Max Daily Loss"
                      value={`$${detail.agent.config.maxLossUsd}`}
                      color="text-red"
                    />
                    {detail.agent.config.leverage && (
                      <Meta label="Leverage" value={`${detail.agent.config.leverage}:1`} />
                    )}
                    {detail.agent.config.mt5AccountId && (
                      <Meta label="MT5 Account" value={`#${detail.agent.config.mt5AccountId}`} />
                    )}
                    <Meta
                      label="LLM Provider"
                      value={detail.agent.config.llmProvider ?? 'anthropic'}
                    />
                    {detail.agent.config.llmModel && (
                      <Meta label="Model" value={detail.agent.config.llmModel} />
                    )}
                    <Meta
                      label="Agent Status"
                      value={detail.agent.status}
                      color={detail.agent.status === 'running' ? 'text-green' : 'text-muted'}
                    />
                  </div>
                  {detail.agent.config.customPrompt && (
                    <div className="mt-3 pt-3 border-t border-border">
                      <p className="text-[9px] uppercase tracking-widest text-muted mb-1.5">Custom Prompt</p>
                      <pre className="text-[10px] text-muted font-mono whitespace-pre-wrap leading-relaxed">
                        {detail.agent.config.customPrompt}
                      </pre>
                    </div>
                  )}
                </Section>
              )}

              {/* ── Thinking ──────────────────────────────────────────────── */}
              <Section title="Thinking" icon="💭" color="text-yellow">
                <LogBlock
                  logs={detail.logs}
                  filter={e => e.event === 'claude_thinking'}
                  emptyText="No thinking logs captured for this cycle"
                />
              </Section>

              {/* ── Tool Calls ────────────────────────────────────────────── */}
              <Section title="Tool Calls" icon="⚙" color="text-blue-400">
                <LogBlock
                  logs={detail.logs}
                  filter={e => e.event === 'tool_call' || e.event === 'tool_result' || e.event === 'tool_error' || e.event === 'auto_execute' || e.event === 'auto_execute_error'}
                  emptyText="No tool calls captured for this cycle"
                />
              </Section>

              {/* ── Full Timeline ─────────────────────────────────────────── */}
              <Section title="Full Cycle Timeline" icon="◈" color="text-muted">
                {detail.logs.length === 0 ? (
                  <p className="text-muted text-[10px] text-center py-4">
                    No logs found for this cycle window — logs may have been cleared
                  </p>
                ) : (
                  <div className="bg-bg border border-border rounded overflow-hidden max-h-80 overflow-y-auto font-mono">
                    {detail.logs.map(e => <LogLine key={e.id} entry={e} />)}
                  </div>
                )}
              </Section>

            </>
          )}
        </div>
      </div>
    </div>
  )
}
