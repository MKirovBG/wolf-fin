// Wolf-Fin Calendar — Forex Factory free feed with Finnhub fallback

export interface EconomicEvent {
  name: string
  country: string
  impact: 'High' | 'Medium' | 'Low'
  time: number  // Unix ms
  forecast?: string
  previous?: string
  actual?: string | null
}

// ── Forex Factory free community JSON feed ────────────────────────────────────

const FF_URLS = {
  thisWeek: 'https://nfs.faireconomy.media/ff_calendar_thisweek.json',
  nextWeek: 'https://nfs.faireconomy.media/ff_calendar_nextweek.json',
}

let ffCache: { events: EconomicEvent[]; fetchedAt: number } | null = null
const FF_TTL_MS = 60 * 60 * 1000  // 1-hour cache

type FFRawEvent = {
  title: string
  country: string
  date: string
  impact: string
  forecast?: string
  previous?: string
  actual?: string | null
}

async function fetchFFCalendar(): Promise<EconomicEvent[]> {
  if (ffCache && Date.now() - ffCache.fetchedAt < FF_TTL_MS) return ffCache.events
  try {
    const fetches = [FF_URLS.thisWeek, FF_URLS.nextWeek].map(url =>
      fetch(url, { signal: AbortSignal.timeout(8000) })
        .then(r => r.ok ? r.json() as Promise<FFRawEvent[]> : [] as FFRawEvent[])
        .catch(() => [] as FFRawEvent[])
    )
    const [thisWeek, nextWeek] = await Promise.all(fetches)
    const raw: FFRawEvent[] = [...thisWeek, ...nextWeek]
    const events: EconomicEvent[] = raw.map(e => ({
      name:     e.title,
      country:  e.country,
      impact:   (e.impact.charAt(0).toUpperCase() + e.impact.slice(1).toLowerCase()) as 'High' | 'Medium' | 'Low',
      time:     new Date(e.date).getTime(),
      forecast: e.forecast ?? undefined,
      previous: e.previous ?? undefined,
      actual:   e.actual   ?? undefined,
    }))
    ffCache = { events, fetchedAt: Date.now() }
    return events
  } catch {
    return ffCache?.events ?? []
  }
}

// ── Finnhub fallback (only when FF fails and key is set) ─────────────────────

async function fetchFinnhubEvents(windowMs: number): Promise<EconomicEvent[]> {
  const key = process.env.FINNHUB_KEY
  if (!key) return []
  try {
    const today = new Date().toISOString().slice(0, 10)
    const url = `https://finnhub.io/api/v1/calendar/economic?from=${today}&to=${today}&token=${key}`
    const res = await fetch(url)
    if (!res.ok) return []
    const json = await res.json() as {
      economicCalendar?: Array<{ event?: string; country?: string; impact?: string; time?: string }>
    }
    const now = Date.now()
    const cutoff = now + windowMs
    return (json.economicCalendar ?? [])
      .filter(e => e.impact?.toLowerCase() === 'high' && e.time)
      .map(e => ({
        name: e.event ?? '', country: e.country ?? '',
        impact: 'High' as const,
        time: new Date(e.time!).getTime(),
      }))
      .filter(e => e.time >= now && e.time <= cutoff)
  } catch {
    return []
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Fetches high-impact economic events within the next `windowMs` ms.
 * Tries FF first; if FF returns [] and Finnhub key is set, falls back to Finnhub.
 * Returns [] on all errors — never throws.
 */
export async function fetchUpcomingEvents(windowMs = 2 * 60 * 60 * 1000): Promise<EconomicEvent[]> {
  const ffEvents = await fetchFFCalendar()
  const now = Date.now()
  const cutoff = now + windowMs

  const filtered = ffEvents.filter(e =>
    e.impact === 'High' && e.time >= now && e.time <= cutoff
  )

  // If FF returned something, use it
  if (ffEvents.length > 0) return filtered

  // FF feed empty/down — try Finnhub fallback
  return fetchFinnhubEvents(windowMs)
}

/**
 * Returns true if a high-impact event is scheduled within `windowMs`.
 * Returns false when no data is available (never blocks trading on data absence).
 */
export async function isHighImpactEventSoon(windowMs = 30 * 60 * 1000): Promise<boolean> {
  const events = await fetchUpcomingEvents(windowMs)
  return events.length > 0
}

/**
 * Fetches High + Medium impact events for the next N days.
 * Optionally filtered to a set of currency codes (e.g. ['USD', 'EUR']).
 * Used by the UI /api/economic-calendar route.
 */
export async function fetchCalendarForDisplay(currencies?: string[], daysAhead = 7): Promise<EconomicEvent[]> {
  const ffEvents = await fetchFFCalendar()
  const now = Date.now()
  const todayStart = new Date().setUTCHours(0, 0, 0, 0)  // Include today's past events
  const cutoff = now + daysAhead * 24 * 60 * 60 * 1000

  return ffEvents
    .filter(e => {
      if (e.time < todayStart || e.time > cutoff) return false
      if (e.impact !== 'High' && e.impact !== 'Medium') return false
      if (currencies && currencies.length > 0) {
        return currencies.some(c => e.country.toUpperCase() === c.toUpperCase())
      }
      return true
    })
    .sort((a, b) => a.time - b.time)
}
