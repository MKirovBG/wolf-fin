// Wolf-Fin CalendarWidget — upcoming economic events from the free FF feed

import { useEffect, useState, useRef } from 'react'
import { getEconomicCalendar } from '../api/client.ts'
import type { EconomicEvent } from '../types/index.ts'

interface CalendarWidgetProps {
  currencies?: string[]
  maxEvents?: number
  compact?: boolean
}

function countdown(ms: number): string {
  const diff = ms - Date.now()
  if (diff < 0) {
    const past = Math.abs(diff)
    if (past < 60000)   return `${Math.floor(past / 1000)}s ago`
    if (past < 3600000) return `${Math.floor(past / 60000)}m ago`
    return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }
  if (diff < 30 * 60 * 1000) return 'LIVE'
  const h = Math.floor(diff / 3600000)
  const m = Math.floor((diff % 3600000) / 60000)
  if (h > 0) return `in ${h}h ${m}m`
  return `in ${m}m`
}

function dayLabel(time: number): string {
  const d = new Date(time)
  const today = new Date()
  const tomorrow = new Date(); tomorrow.setDate(today.getDate() + 1)
  if (d.toDateString() === today.toDateString())    return 'Today'
  if (d.toDateString() === tomorrow.toDateString()) return 'Tomorrow'
  return d.toLocaleDateString([], { weekday: 'long' })
}

function ImpactBadge({ impact }: { impact: 'High' | 'Medium' | 'Low' }) {
  const cls = impact === 'High'   ? 'bg-red/20 text-red border-red/40'
            : impact === 'Medium' ? 'bg-yellow/20 text-yellow border-yellow/40'
            : 'bg-muted/20 text-muted border-border'
  return (
    <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded border ${cls} shrink-0`}>
      {impact === 'High' ? 'HI' : impact === 'Medium' ? 'MED' : 'LOW'}
    </span>
  )
}

export function CalendarWidget({ currencies, maxEvents = 10, compact = false }: CalendarWidgetProps) {
  const [events, setEvents] = useState<EconomicEvent[]>([])
  const [, setTick] = useState(0)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const load = async () => {
    try {
      const res = await getEconomicCalendar(currencies?.join(','), 3)
      setEvents(res.events.slice(0, maxEvents))
    } catch { /* stay empty */ }
  }

  useEffect(() => {
    load()
    const interval = setInterval(load, 30 * 60 * 1000)
    return () => clearInterval(interval)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currencies?.join(',')])

  // Re-render every minute so countdowns update
  useEffect(() => {
    timerRef.current = setInterval(() => setTick(t => t + 1), 60 * 1000)
    return () => { if (timerRef.current) clearInterval(timerRef.current) }
  }, [])

  if (events.length === 0) return null

  // Group by day
  const groups: Record<string, EconomicEvent[]> = {}
  for (const e of events) {
    const label = dayLabel(e.time)
    if (!groups[label]) groups[label] = []
    groups[label].push(e)
  }

  const pad = compact ? 'px-3 py-2' : 'px-4 py-3'

  return (
    <div className="bg-surface border border-border rounded-lg overflow-hidden">
      <div className={`flex items-center justify-between ${compact ? 'px-3 py-2' : 'px-4 py-3'} border-b border-border`}>
        <span className="text-xs font-semibold uppercase tracking-wider text-muted">Economic Calendar</span>
        {currencies && <span className="text-[10px] text-muted2">{currencies.join(', ')}</span>}
      </div>

      {Object.entries(groups).map(([day, dayEvents]) => (
        <div key={day}>
          <div className={`${compact ? 'px-3 py-1' : 'px-4 py-1.5'} bg-surface2 border-b border-border/60`}>
            <span className="text-[10px] font-semibold uppercase tracking-widest text-muted2">{day}</span>
          </div>
          {dayEvents.map((e, i) => {
            const ct = countdown(e.time)
            const isLive = ct === 'LIVE'
            return (
              <div
                key={i}
                className={`${pad} border-b border-border/40 last:border-0 flex items-start gap-2 ${isLive ? 'bg-yellow/5' : ''}`}
              >
                <ImpactBadge impact={e.impact} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className={`text-xs font-medium truncate ${compact ? '' : 'text-text'}`}>{e.name}</span>
                    <span className={`text-[10px] shrink-0 font-mono ${isLive ? 'text-yellow font-bold animate-pulse' : 'text-muted'}`}>
                      {ct}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                    <span className="text-[10px] text-muted2">{e.country}</span>
                    {!compact && (e.forecast || e.previous) && (
                      <span className="text-[10px] text-muted">
                        {e.forecast  ? `Fcst: ${e.forecast}`  : ''}
                        {e.forecast && e.previous ? ' | ' : ''}
                        {e.previous  ? `Prev: ${e.previous}`  : ''}
                        {e.actual    ? ` | Act: ${e.actual}`  : ''}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}
