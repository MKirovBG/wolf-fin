import { useEffect, useRef, useState } from 'react'
import { getLogs, clearLogs } from '../api/client.ts'
import type { LogEntry } from '../types/index.ts'
import { useTickThreads } from '../hooks/useTickThreads.ts'
import { TickThread } from './TickThread.tsx'

interface Props {
  agentKey?: string
  agentKeys?: Set<string>
  maxThreads?: number
}

export function ThreadedLogsPanel({ agentKey, agentKeys, maxThreads }: Props) {
  const allLogsRef = useRef<LogEntry[]>([])
  const lastIdRef  = useRef<number>(0)
  const [paused, setPaused] = useState(false)
  const pausedRef = useRef(false)
  const [tick, setTick] = useState(0)
  const topRef = useRef<HTMLDivElement>(null)

  // Keep ref in sync so the SSE handler can read latest paused state
  useEffect(() => { pausedRef.current = paused }, [paused])

  // Initial fetch
  useEffect(() => {
    getLogs(undefined, agentKey).then(initial => {
      allLogsRef.current = initial
      if (initial.length > 0) lastIdRef.current = Math.max(...initial.map(l => l.id))
      setTick(t => t + 1)
    }).catch(() => {})
  }, [agentKey])

  // SSE — receive new log entries in real-time, with auto-reconnect on drop
  useEffect(() => {
    let es: EventSource | null = null
    let closed = false

    const connect = () => {
      if (closed) return
      const params = new URLSearchParams()
      if (agentKey) params.set('agent', agentKey)
      if (lastIdRef.current > 0) params.set('since', String(lastIdRef.current))
      es = new EventSource(`/api/events?${params}`)

      es.onmessage = (e: MessageEvent) => {
        if (pausedRef.current) return
        try {
          const entry = JSON.parse(e.data) as LogEntry
          if (agentKey && entry.agentKey !== agentKey) return
          if (agentKeys && !agentKeys.has(entry.agentKey)) return

          allLogsRef.current = [entry, ...allLogsRef.current].slice(0, 2000)
          if (entry.id > lastIdRef.current) lastIdRef.current = entry.id
          setTick(t => t + 1)

          if ((entry.event === 'tick_start' || entry.event === 'cycle_start') && topRef.current) {
            topRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' })
          }
        } catch { /* ignore */ }
      }

      es.onerror = () => {
        es?.close()
        if (!closed) setTimeout(connect, 3000)
      }
    }

    connect()
    return () => { closed = true; es?.close() }
  }, [agentKey])

  const handleClear = async () => {
    try {
      const { clearedAt } = await clearLogs()
      lastIdRef.current = clearedAt
    } catch {
      if (allLogsRef.current.length > 0) {
        lastIdRef.current = Math.max(...allLogsRef.current.map(l => l.id))
      }
    }
    allLogsRef.current = []
    setTick(t => t + 1)
  }

  const allThreads = useTickThreads(allLogsRef.current, agentKey, agentKeys)
  const threads = maxThreads != null ? allThreads.slice(0, maxThreads) : allThreads

  return (
    <div className="flex flex-col gap-3">
      {/* Toolbar */}
      <div className="flex items-center gap-3">
        <span className="text-sm font-semibold text-text">Live Session</span>
        <span className="text-xs text-muted">{threads.length} tick{threads.length !== 1 ? 's' : ''}</span>
        <span className="text-[9px] px-1.5 py-0.5 rounded text-green bg-green-dim">● LIVE</span>
        <div className="flex-1" />
        <button
          onClick={() => setPaused(p => !p)}
          className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${
            paused
              ? 'border-yellow text-yellow bg-yellow-dim'
              : 'border-border text-muted hover:border-muted hover:text-text'
          }`}
        >
          {paused ? '▶ Resume' : '⏸ Pause'}
        </button>
        <button
          onClick={handleClear}
          className="px-3 py-1.5 text-xs rounded-lg border border-border text-muted hover:text-red hover:border-red/40 transition-colors"
        >
          Clear
        </button>
      </div>

      {/* Threads list */}
      <div ref={topRef} className="flex flex-col gap-2">
        {threads.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="text-4xl mb-4 opacity-30">◎</div>
            <p className="text-muted text-sm">No ticks yet — start the agent to begin</p>
            {paused && <p className="text-muted2 text-xs mt-1">SSE is paused — click Resume to continue</p>}
          </div>
        ) : (
          threads.map((thread, idx) => (
            <TickThread
              key={thread.id}
              thread={thread}
              defaultExpanded={false}
            />
          ))
        )}
      </div>
    </div>
  )
}
