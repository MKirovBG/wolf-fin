import { useEffect, useRef, useState, useCallback } from 'react'
import { getLogs, clearLogs } from '../api/client.ts'
import type { LogEntry } from '../types/index.ts'
import { useCycleThreads } from '../hooks/useCycleThreads.ts'
import { CycleThread } from './CycleThread.tsx'

interface Props {
  agentKey?: string
}

export function ThreadedLogsPanel({ agentKey }: Props) {
  const allLogsRef = useRef<LogEntry[]>([])
  const lastIdRef = useRef<number>(0)
  const [paused, setPaused] = useState(false)
  const [tick, setTick] = useState(0) // trigger re-render
  const topRef = useRef<HTMLDivElement>(null)

  const fetchLogs = useCallback(async () => {
    if (paused) return
    try {
      const fresh = await getLogs(lastIdRef.current || undefined, agentKey)
      if (fresh.length === 0) return

      // fresh is newest-first; prepend to accumulator
      const combined = [...fresh, ...allLogsRef.current].slice(0, 2000)
      allLogsRef.current = combined
      lastIdRef.current = Math.max(...combined.map(l => l.id))
      setTick(t => t + 1)

      // Scroll to top on new cycle_start
      const hasCycleStart = fresh.some(l => l.event === 'cycle_start')
      if (hasCycleStart && topRef.current) {
        topRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }
    } catch { /* ignore */ }
  }, [paused, agentKey])

  // Initial load
  useEffect(() => {
    getLogs(undefined, agentKey).then(initial => {
      allLogsRef.current = initial
      if (initial.length > 0) lastIdRef.current = Math.max(...initial.map(l => l.id))
      setTick(t => t + 1)
    }).catch(() => {})
  }, [agentKey])

  // Polling
  useEffect(() => {
    const id = setInterval(fetchLogs, 2000)
    return () => clearInterval(id)
  }, [fetchLogs])

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

  // Use the hook — pass tick as a key dependency via re-render
  const threads = useCycleThreads(allLogsRef.current, agentKey)

  return (
    <div className="flex flex-col gap-3 h-full">
      {/* Toolbar */}
      <div className="flex items-center gap-3 shrink-0">
        <span className="text-sm font-semibold text-text">Live Cycles</span>
        <span className="text-xs text-muted">{threads.length} cycle{threads.length !== 1 ? 's' : ''}</span>
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
      <div ref={topRef} className="flex flex-col gap-2 overflow-y-auto flex-1" style={{ minHeight: 0 }}>
        {threads.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="text-4xl mb-4 opacity-30">◎</div>
            <p className="text-muted text-sm">No cycles yet — start the agent to begin</p>
            {paused && <p className="text-muted2 text-xs mt-1">Polling is paused — click Resume to continue</p>}
          </div>
        ) : (
          threads.map((thread, idx) => (
            <CycleThread
              key={thread.id}
              thread={thread}
              defaultExpanded={idx === 0}
            />
          ))
        )}
      </div>
    </div>
  )
}
