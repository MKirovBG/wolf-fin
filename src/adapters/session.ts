// Wolf-Fin Session — forex session open/close logic

export type Session = 'sydney' | 'tokyo' | 'london' | 'newyork'

interface SessionWindow {
  openUtcHour: number  // inclusive
  closeUtcHour: number // exclusive
}

const SESSIONS: Record<Session, SessionWindow> = {
  sydney:  { openUtcHour: 22, closeUtcHour: 7  },  // wraps midnight
  tokyo:   { openUtcHour: 0,  closeUtcHour: 9  },
  london:  { openUtcHour: 8,  closeUtcHour: 17 },
  newyork: { openUtcHour: 13, closeUtcHour: 22 },
}

function utcHour(): number {
  return new Date().getUTCHours()
}

function isInSession(session: SessionWindow, hour: number): boolean {
  if (session.openUtcHour < session.closeUtcHour) {
    // Normal window e.g. 08:00-17:00
    return hour >= session.openUtcHour && hour < session.closeUtcHour
  } else {
    // Wraps midnight e.g. 22:00-07:00
    return hour >= session.openUtcHour || hour < session.closeUtcHour
  }
}

/** Returns which sessions are currently open. */
export function openSessions(): Session[] {
  const hour = utcHour()
  return (Object.keys(SESSIONS) as Session[]).filter(s => isInSession(SESSIONS[s], hour))
}

/**
 * Returns true when forex markets have meaningful liquidity:
 * - At least one major session is open (Tokyo, London, or New York)
 * - Not in the 30-minute buffer before Sydney-only periods
 */
export function isForexSessionOpen(): boolean {
  const sessions = openSessions()
  return sessions.some(s => s === 'tokyo' || s === 'london' || s === 'newyork')
}

/**
 * Returns minutes remaining until the earliest active session closes.
 * Returns null if no major session is open.
 */
export function minutesUntilSessionClose(): number | null {
  const now = new Date()
  const hour = now.getUTCHours()
  const minute = now.getUTCMinutes()
  const minutesNow = hour * 60 + minute

  let minRemaining: number | null = null

  for (const [, w] of Object.entries(SESSIONS) as [Session, SessionWindow][]) {
    if (!isInSession(w, hour)) continue
    let closeMinutes = w.closeUtcHour * 60
    // If session wraps midnight (e.g. Sydney 22:00-07:00)
    if (w.openUtcHour > w.closeUtcHour && minutesNow >= w.openUtcHour * 60) {
      closeMinutes += 24 * 60 // next day
    }
    const remaining = closeMinutes - minutesNow
    if (remaining > 0 && (minRemaining === null || remaining < minRemaining)) {
      minRemaining = remaining
    }
  }

  return minRemaining
}

/**
 * Returns a human-readable session label for the system prompt.
 * e.g. "London / New York overlap (high liquidity)"
 */
export function sessionLabel(): string {
  const sessions = openSessions()
  if (sessions.length === 0) return 'Off-hours (low liquidity)'

  const active = sessions.filter(s => s !== 'sydney')
  if (active.length === 0) return 'Sydney only (low liquidity)'

  const labels: Record<Session, string> = {
    sydney: 'Sydney',
    tokyo: 'Tokyo',
    london: 'London',
    newyork: 'New York',
  }

  if (active.includes('london') && active.includes('newyork')) {
    return 'London / New York overlap (highest liquidity)'
  }
  if (active.includes('tokyo') && active.includes('london')) {
    return 'Tokyo / London overlap (good liquidity)'
  }

  return active.map(s => labels[s]).join(' + ')
}
