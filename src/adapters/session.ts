// Wolf-Fin — Forex session context
// Determines which trading sessions are active and generates a note for the LLM prompt.

export type SessionName = 'sydney' | 'tokyo' | 'london' | 'newyork'

interface SessionWindow {
  open: number   // UTC hour (0-23)
  close: number  // UTC hour; if > 24, session wraps midnight (e.g. 31 = 07:00 next day)
}

const SESSIONS: Record<SessionName, SessionWindow> = {
  sydney:  { open: 22, close: 31 },  // 22:00–07:00 UTC (wraps midnight)
  tokyo:   { open: 0,  close: 9  },  // 00:00–09:00 UTC
  london:  { open: 8,  close: 17 },  // 08:00–17:00 UTC
  newyork: { open: 13, close: 22 },  // 13:00–22:00 UTC
}

function isInSession(utcHour: number, win: SessionWindow): boolean {
  if (win.close > 24) {
    return utcHour >= win.open || utcHour < (win.close - 24)
  }
  return utcHour >= win.open && utcHour < win.close
}

function minutesUntilOpen(utcHour: number, utcMin: number, win: SessionWindow): number {
  const currentMins = utcHour * 60 + utcMin
  const openMins    = (win.open % 24) * 60
  let diff = openMins - currentMins
  if (diff <= 0) diff += 24 * 60
  return diff
}

// Symbols with preferred (most liquid) sessions
const PREFERRED_SESSIONS: Record<string, SessionName[]> = {
  XAUUSD: ['london', 'newyork'],
  XAGUSD: ['london', 'newyork'],
  EURUSD: ['london', 'newyork'],
  GBPUSD: ['london', 'newyork'],
  USDCHF: ['london', 'newyork'],
  USDJPY: ['tokyo', 'london', 'newyork'],
  EURJPY: ['tokyo', 'london'],
  GBPJPY: ['tokyo', 'london'],
  AUDUSD: ['sydney', 'tokyo'],
  NZDUSD: ['sydney', 'tokyo'],
  USDCAD: ['newyork'],
  USDMXN: ['newyork'],
  US30:   ['newyork'],
  US500:  ['newyork'],
  NAS100: ['newyork'],
  GER40:  ['london'],
  UK100:  ['london'],
  OIL:    ['london', 'newyork'],
  BRENT:  ['london', 'newyork'],
}

export interface SessionContext {
  activeSessions:     SessionName[]
  isLondonOpen:       boolean
  isNYOpen:           boolean
  isLondonNYOverlap:  boolean
  nextSession:        SessionName | null
  minutesToNextOpen:  number | null
  isOptimalSession:   boolean
  note:               string
}

export function buildSessionContext(symbol: string): SessionContext {
  const now     = new Date()
  const utcHour = now.getUTCHours()
  const utcMin  = now.getUTCMinutes()

  const sessionNames = Object.keys(SESSIONS) as SessionName[]
  const activeSessions = sessionNames.filter(s => isInSession(utcHour, SESSIONS[s]))

  const isLondonOpen      = isInSession(utcHour, SESSIONS.london)
  const isNYOpen          = isInSession(utcHour, SESSIONS.newyork)
  const isLondonNYOverlap = isLondonOpen && isNYOpen

  const preferred     = PREFERRED_SESSIONS[symbol.toUpperCase()] ?? ['london', 'newyork']
  const isOptimalSession = preferred.some(s => activeSessions.includes(s))

  // Find the next session to open
  const inactive = sessionNames.filter(s => !activeSessions.includes(s))
  let nextSession: SessionName | null = null
  let minutesToNextOpen: number | null = null
  for (const s of inactive) {
    const mins = minutesUntilOpen(utcHour, utcMin, SESSIONS[s])
    if (minutesToNextOpen === null || mins < minutesToNextOpen) {
      minutesToNextOpen = mins
      nextSession = s
    }
  }

  // Build a concise note for the LLM prompt
  let note: string
  if (activeSessions.length === 0) {
    note = `All major sessions closed. Next: ${nextSession} opens in ${minutesToNextOpen}min (UTC).`
  } else if (isLondonNYOverlap) {
    note = `London/New York overlap (highest liquidity).${isOptimalSession ? ' Optimal session for this symbol.' : ''}`
  } else {
    const labels = activeSessions.map(s => s.charAt(0).toUpperCase() + s.slice(1)).join(' + ')
    const optimal = isOptimalSession ? ' Optimal session for this symbol.' : ' Not the primary session for this symbol — expect lower liquidity.'
    const next = nextSession ? ` Next session: ${nextSession} in ${minutesToNextOpen}min.` : ''
    note = `${labels} session active.${optimal}${next}`
  }

  return {
    activeSessions,
    isLondonOpen,
    isNYOpen,
    isLondonNYOverlap,
    nextSession,
    minutesToNextOpen,
    isOptimalSession,
    note,
  }
}
