import { useEffect, useRef, useState, useCallback } from 'react'
import { getLogs, clearLogs } from '../api/client.ts'
import type { LogEntry, LogEvent } from '../types/index.ts'

// ── Styling ────────────────────────────────────────────────────────────────────

const EVENT_COLOR: Record<LogEvent, string> = {
  cycle_start:     'text-green',
  cycle_end:       'text-green',
  cycle_error:     'text-red',
  tool_call:       'text-blue',
  tool_result:     'text-blue',
  tool_error:      'text-red',
  claude_thinking: 'text-yellow',
  decision:        'text-green',
  guardrail_block: 'text-red',
  session_skip:    'text-muted',
  cycle_skip:      'text-muted',
  auto_execute:    'text-blue',
  auto_execute_error: 'text-red',
}

const EVENT_PREFIX: Record<LogEvent, string> = {
  cycle_start:     '▶ CYCLE',
  cycle_end:       '■ DONE',
  cycle_error:     '✗ ERROR',
  tool_call:       '⚙ CALL',
  tool_result:     '← RESULT',
  tool_error:      '✗ ERR',
  claude_thinking: '💭 THINK',
  decision:        '★ DECIDE',
  guardrail_block: '⛔ BLOCK',
  session_skip:    '— SKIP',
  cycle_skip:      '— SKIP',
  auto_execute:    '⚡ EXEC',
  auto_execute_error: '✗ EXEC',
}

function timeStr(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

// ── Single log entry ───────────────────────────────────────────────────────────

function LogLine({ entry, compact }: { entry: LogEntry; compact?: boolean }) {
  const color = EVENT_COLOR[entry.event] ?? 'text-white'
  const prefix = EVENT_PREFIX[entry.event] ?? entry.event
  const isMultiLine = entry.message.includes('\n')

  return (
    <div className={`border-b border-[#1a1a1a] hover:bg-surface2 transition-colors ${entry.level === 'error' ? 'bg-red-dim' : ''}`}>
      <div className="flex gap-1.5 items-start px-2.5 py-1.5">
        <span className="text-muted2 text-[9px] whitespace-nowrap font-mono mt-0.5 shrink-0">{timeStr(entry.time)}</span>
        {!compact && (
          <span className={`text-[9px] font-bold whitespace-nowrap font-mono mt-0.5 w-14 shrink-0 ${color}`}>{prefix}</span>
        )}
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

// ── Individual panel ───────────────────────────────────────────────────────────

type PanelFilter = (e: LogEntry) => boolean

function LogPanel({
  title, icon, color, logs, filter, emptyText,
}: {
  title: string
  icon: string
  color: string
  logs: LogEntry[]
  filter: PanelFilter
  emptyText: string
}) {
  const filtered = logs.filter(filter)

  return (
    <div className="bg-bg border border-border rounded-lg overflow-hidden flex flex-col" style={{ minHeight: 0 }}>
      {/* Panel header */}
      <div className={`flex items-center gap-2 px-3 py-2 border-b border-border shrink-0 bg-surface`}>
        <span className={`text-[10px] font-bold ${color}`}>{icon}</span>
        <span className={`text-[10px] font-bold tracking-widest uppercase ${color}`}>{title}</span>
        <span className="ml-auto text-[9px] text-muted2 font-mono">{filtered.length}</span>
      </div>

      {/* Log lines */}
      <div className="overflow-y-auto flex-1 font-mono">
        {filtered.length === 0 ? (
          <div className="text-muted text-[10px] text-center py-6">{emptyText}</div>
        ) : (
          filtered.map(e => <LogLine key={e.id} entry={e} compact />)
        )}
      </div>
    </div>
  )
}

// ── Main grid component ────────────────────────────────────────────────────────

interface Props {
  agentKey?: string
}

export function LogsGrid({ agentKey }: Props) {
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [paused, setPaused] = useState(false)
  const lastIdRef = useRef<number>(0)

  const fetchLogs = useCallback(async () => {
    if (paused) return
    try {
      const fresh = await getLogs(lastIdRef.current || undefined, agentKey)
      if (fresh.length === 0) return
      setLogs(prev => {
        const combined = [...fresh, ...prev].slice(0, 1000)
        lastIdRef.current = Math.max(...combined.map(l => l.id))
        return combined
      })
    } catch { /* ignore */ }
  }, [paused, agentKey])

  useEffect(() => {
    getLogs(undefined, agentKey).then(initial => {
      setLogs(initial)
      if (initial.length > 0) lastIdRef.current = Math.max(...initial.map(l => l.id))
    }).catch(() => {})
  }, [agentKey])

  useEffect(() => {
    const id = setInterval(fetchLogs, 1500)
    return () => clearInterval(id)
  }, [fetchLogs])

  const clear = async () => {
    try {
      const { clearedAt } = await clearLogs()
      lastIdRef.current = clearedAt
    } catch {
      if (logs.length > 0) lastIdRef.current = Math.max(...logs.map(l => l.id))
    }
    setLogs([])
  }

  return (
    <div className="flex flex-col gap-3" style={{ height: '100%' }}>
      {/* Toolbar */}
      <div className="flex items-center gap-2">
        <span className="text-[10px] font-bold tracking-widest text-muted uppercase">Activity</span>
        <span className="text-[9px] text-muted2 font-mono ml-1">{logs.length} events</span>
        <div className="flex-1" />
        <button
          onClick={() => setPaused(p => !p)}
          className={`px-2 py-0.5 text-[10px] rounded border transition-colors ${paused ? 'border-yellow text-yellow bg-yellow-dim' : 'border-border text-muted hover:border-muted'}`}
        >
          {paused ? '▶ Resume' : '⏸ Pause'}
        </button>
        <button
          onClick={clear}
          className="px-2 py-0.5 text-[10px] rounded border border-border text-muted hover:text-red hover:border-red/40 transition-colors"
        >
          Clear All
        </button>
      </div>

      {/* 2 × 2 grid */}
      <div className="grid grid-cols-2 gap-3 flex-1" style={{ minHeight: 0 }}>

        {/* Decisions */}
        <LogPanel
          title="Decisions"
          icon="★"
          color="text-green"
          logs={logs}
          filter={e => e.event === 'decision' || e.event === 'cycle_start' || e.event === 'cycle_end'}
          emptyText="No decisions yet"
        />

        {/* Thinking */}
        <LogPanel
          title="Thinking"
          icon="💭"
          color="text-yellow"
          logs={logs}
          filter={e => e.event === 'claude_thinking'}
          emptyText="No thinking logs yet"
        />

        {/* Tools */}
        <LogPanel
          title="Tool Calls"
          icon="⚙"
          color="text-blue"
          logs={logs}
          filter={e => e.event === 'tool_call' || e.event === 'tool_result' || e.event === 'auto_execute' || e.event === 'auto_execute_error'}
          emptyText="No tool calls yet"
        />

        {/* Errors & Blocks */}
        <LogPanel
          title="Errors & Blocks"
          icon="⛔"
          color="text-red"
          logs={logs}
          filter={e => e.level === 'error' || e.event === 'cycle_error' || e.event === 'tool_error' || e.event === 'guardrail_block'}
          emptyText="No errors — all clear"
        />

      </div>
    </div>
  )
}
