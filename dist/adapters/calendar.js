// Wolf-Fin Calendar — Finnhub economic calendar for high-impact event detection
/**
 * Fetches today's high-impact economic events from Finnhub.
 * Returns events happening within the next `windowMs` milliseconds.
 * Returns [] when FINNHUB_KEY is missing or on any network error.
 */
export async function fetchUpcomingEvents(windowMs = 2 * 60 * 60 * 1000) {
    const key = process.env.FINNHUB_KEY;
    if (!key)
        return [];
    try {
        const today = new Date().toISOString().slice(0, 10);
        const url = `https://finnhub.io/api/v1/calendar/economic?from=${today}&to=${today}&token=${key}`;
        const res = await fetch(url);
        if (!res.ok)
            return [];
        const json = await res.json();
        const now = Date.now();
        const cutoff = now + windowMs;
        return (json.economicCalendar ?? [])
            .filter(e => e.impact?.toLowerCase() === 'high' && e.time)
            .map(e => ({
            name: e.event ?? '',
            country: e.country ?? '',
            impact: e.impact ?? '',
            time: new Date(e.time).getTime(),
        }))
            .filter(e => e.time >= now && e.time <= cutoff);
    }
    catch {
        return [];
    }
}
/**
 * Returns true if a high-impact event is scheduled within `windowMs`.
 * Used by the forex guardrail to skip the trading cycle.
 */
export async function isHighImpactEventSoon(windowMs = 30 * 60 * 1000) {
    const events = await fetchUpcomingEvents(windowMs);
    return events.length > 0;
}
//# sourceMappingURL=calendar.js.map