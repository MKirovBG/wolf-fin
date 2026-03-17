import { useEffect, useRef, useState, useCallback } from 'react'
import { getLogs, clearLogs } from '../api/client.ts'
import type { LogEntry, LogEvent } from '../types/index.ts'

interface Props {
  agentKey?: string   // filter to one agent; undefined = all agents
  maxHeight?: number
}

// ── Styling maps ──────────────────────────────────────────────────────────────

const EVENT_COLOR: Record<LogEvent, string> = {
  cycle_start:        'text-green',
  cycle_end:          'text-green',
  cycle_error:        'text-red',
  cycle_skip:         'text-muted',
  tool_call:          'text-blue-400',
  tool_result:        'text-cyan-400',
  tool_error:         'text-red',
  claude_thinking:    'text-yellow',
  decision:           'text-green',
  guardrail_block:    'text-red',
  session_skip:       'text-muted',
  auto_execute:       'text-cyan-400',
  auto_execute_error: 'text-red',
}

const EVENT_PREFIX: Record<LogEvent, string> = {
  cycle_start:        '▶ CYCLE',
  cycle_end:          '■ DONE',
  cycle_error:        '✗ ERROR',
  cycle_skip:         '— SKIP',
  tool_call:          '⚙ TOOL',
  tool_result:        '← RESULT',
  tool_error:         '✗ TOOL ERR',
  claude_thinking:    '🤖 CLAUDE',
  decision:           '★ DECISION',
  guardrail_block:    '⛔ BLOCKED',
  session_skip:       '— SKIP',
  auto_execute:       '⚡ EXEC',
  auto_execute_error: '✗ EXEC',
}

function timeStr(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function agentIcon(agentKey: string): string {
  const [market, symbol = ''] = agentKey.split(':')
  const s = symbol.toUpperCase()
  if (s.startsWith('BTC')) return '₿'
  if (s.startsWith('ETH')) return 'Ξ'
  if (s.startsWith('XAU')) return '✦'
  if (s.startsWith('SOL')) return '◎'
  if (s.startsWith('BNB')) return '◈'
  if (s.startsWith('EUR')) return '€'
  if (s.startsWith('GBP')) return '£'
  if (market === 'forex') return '◈'
  return '◆'
}

function LogLine({ entry }: { entry: LogEntry }) {
  const color = EVENT_COLOR[entry.event] ?? 'text-white'
  const prefix = EVENT_PREFIX[entry.event] ?? entry.event

  // For claude_thinking, show multi-line formatted
  const isMultiLine = entry.event === 'claude_thinking' && entry.message.includes('\n')

  return (
    <div className={`py-0.5 border-b border-[#1a1a1a] hover:bg-surface2 transition-colors ${entry.level === 'error' ? 'bg-red-dim' : ''}`}>
      <div className="flex gap-2 items-start px-3 py-1">
        <span className="text-muted2 text-[10px] whitespace-nowrap font-mono mt-0.5">{timeStr(entry.time)}</span>
        <span className={`text-[10px] font-bold whitespace-nowrap font-mono mt-0.5 w-20 shrink-0 ${color}`}>{prefix}</span>
        {entry.agentKey && (
          <span className="text-[10px] whitespace-nowrap font-mono mt-0.5 w-28 shrink-0 truncate flex items-center gap-0.5">
            <span className="text-white">{agentIcon(entry.agentKey)}</span>
            <span className="text-muted2">[{entry.agentKey}]</span>
          </span>
        )}
        <div className={`text-[11px] font-mono leading-relaxed flex-1 min-w-0 ${color === 'text-yellow' ? 'text-[#ccc]' : color}`}>
          {isMultiLine
            ? <pre className="whitespace-pre-wrap break-words text-[11px] font-mono leading-relaxed">{entry.message}</pre>
            : <span className="break-words">{entry.message}</span>
          }
        </div>
      </div>
    </div>
  )
}

export function LogsTerminal({ agentKey, maxHeight = 480 }: Props) {
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [paused, setPaused] = useState(false)
  const [filter, setFilter] = useState<string>('all')
  const lastIdRef = useRef<number>(0)

  const fetchLogs = useCallback(async () => {
    if (paused) return
    try {
      const fresh = await getLogs(lastIdRef.current || undefined, agentKey)
      if (fresh.length === 0) return
      // fresh is newest-first; prepend to keep newest at top
      setLogs(prev => {
        const combined = [...fresh, ...prev].slice(0, 500)
        lastIdRef.current = Math.max(...combined.map(l => l.id))
        return combined
      })
    } catch { /* ignore */ }
  }, [paused, agentKey])

  // Initial load
  useEffect(() => {
    getLogs(undefined, agentKey).then(initial => {
      setLogs(initial) // already newest-first from server
      if (initial.length > 0) lastIdRef.current = Math.max(...initial.map(l => l.id))
    }).catch(() => {})
  }, [agentKey])

  // Poll for new logs
  useEffect(() => {
    const id = setInterval(fetchLogs, 1500)
    return () => clearInterval(id)
  }, [fetchLogs])

const filteredLogs = filter === 'all'
    ? logs
    : logs.filter(l => {
        if (filter === 'decisions') return l.event === 'decision'
        if (filter === 'tools')    return l.event === 'tool_call' || l.event === 'tool_result' || l.event === 'tool_error'
        if (filter === 'claude')   return l.event === 'claude_thinking'
        if (filter === 'errors')   return l.level === 'error' || l.event === 'cycle_error'
        return true
      })

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
    <div className="bg-bg border border-border rounded-lg overflow-hidden flex flex-col" style={{ maxHeight }}>
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-surface shrink-0 flex-wrap">
        <span className="text-[10px] font-bold tracking-widest text-muted uppercase mr-1">Live Logs</span>

        {/* Filter tabs */}
        {['all', 'decisions', 'tools', 'claude', 'errors'].map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-2 py-0.5 text-[10px] rounded border transition-colors ${
              filter === f ? 'border-green text-green bg-green-dim' : 'border-border text-muted hover:border-muted'
            }`}
          >
            {f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}

        <div className="flex-1" />

        <span className="text-muted2 text-[10px]">{filteredLogs.length} lines</span>

        <button
          onClick={() => setPaused(p => !p)}
          className={`px-2 py-0.5 text-[10px] rounded border transition-colors ${
            paused ? 'border-yellow text-yellow bg-yellow-dim' : 'border-border text-muted hover:border-muted'
          }`}
        >
          {paused ? '▶ Resume' : '⏸ Pause'}
        </button>

        <button onClick={clear} className="px-2 py-0.5 text-[10px] rounded border border-border text-muted hover:text-red hover:border-red-border transition-colors">
          Clear
        </button>
      </div>

      {/* Log lines */}
      <div className="overflow-y-auto flex-1 font-mono" style={{ minHeight: 100 }}>
        {filteredLogs.length === 0 ? (
          <div className="text-muted text-xs text-center py-8">
            {paused ? 'Paused — resume to see new logs' : 'Waiting for agent activity...'}
          </div>
        ) : (
          filteredLogs.map(entry => <LogLine key={entry.id} entry={entry} />)
        )}
      </div>
    </div>
  )
}
