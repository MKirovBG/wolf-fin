// Wolf-Fin Session — forex session open/close logic
const SESSIONS = {
    sydney: { openUtcHour: 22, closeUtcHour: 7 }, // wraps midnight
    tokyo: { openUtcHour: 0, closeUtcHour: 9 },
    london: { openUtcHour: 8, closeUtcHour: 17 },
    newyork: { openUtcHour: 13, closeUtcHour: 22 },
};
function utcHour() {
    return new Date().getUTCHours();
}
function isInSession(session, hour) {
    if (session.openUtcHour < session.closeUtcHour) {
        // Normal window e.g. 08:00-17:00
        return hour >= session.openUtcHour && hour < session.closeUtcHour;
    }
    else {
        // Wraps midnight e.g. 22:00-07:00
        return hour >= session.openUtcHour || hour < session.closeUtcHour;
    }
}
/** Returns which sessions are currently open. */
export function openSessions() {
    const hour = utcHour();
    return Object.keys(SESSIONS).filter(s => isInSession(SESSIONS[s], hour));
}
/**
 * Returns true when forex markets have meaningful liquidity:
 * - At least one major session is open (Tokyo, London, or New York)
 * - Not in the 30-minute buffer before Sydney-only periods
 */
export function isForexSessionOpen() {
    const sessions = openSessions();
    return sessions.some(s => s === 'tokyo' || s === 'london' || s === 'newyork');
}
/**
 * Returns minutes remaining until the earliest active session closes.
 * Returns null if no major session is open.
 */
export function minutesUntilSessionClose() {
    const now = new Date();
    const hour = now.getUTCHours();
    const minute = now.getUTCMinutes();
    const minutesNow = hour * 60 + minute;
    let minRemaining = null;
    for (const [, w] of Object.entries(SESSIONS)) {
        if (!isInSession(w, hour))
            continue;
        let closeMinutes = w.closeUtcHour * 60;
        // If session wraps midnight (e.g. Sydney 22:00-07:00)
        if (w.openUtcHour > w.closeUtcHour && minutesNow >= w.openUtcHour * 60) {
            closeMinutes += 24 * 60; // next day
        }
        const remaining = closeMinutes - minutesNow;
        if (remaining > 0 && (minRemaining === null || remaining < minRemaining)) {
            minRemaining = remaining;
        }
    }
    return minRemaining;
}
/**
 * Derives pip size from broker point value.
 * point >= 0.01 → index/commodity/crypto-CFD → pip = 1.0
 * point >= 0.001 → JPY/ZAR pairs → pip = point × 10
 * default → 4-decimal forex → pip = 0.0001
 */
export function pipSize(symbol, point) {
    if (point != null && point > 0) {
        return point >= 0.01 ? 1.0 : point * 10;
    }
    const s = symbol.toUpperCase();
    if (s.startsWith('XAU') || s.startsWith('XAG') || s.includes('OIL') || s.includes('GOLD'))
        return 1.0;
    if (s.includes('JPY'))
        return 0.01;
    return 0.0001;
}
/**
 * Returns a human-readable session label for the system prompt.
 * e.g. "London / New York overlap (high liquidity)"
 */
export function sessionLabel() {
    const sessions = openSessions();
    if (sessions.length === 0)
        return 'Off-hours (low liquidity)';
    const active = sessions.filter(s => s !== 'sydney');
    if (active.length === 0)
        return 'Sydney only (low liquidity)';
    const labels = {
        sydney: 'Sydney',
        tokyo: 'Tokyo',
        london: 'London',
        newyork: 'New York',
    };
    if (active.includes('london') && active.includes('newyork')) {
        return 'London / New York overlap (highest liquidity)';
    }
    if (active.includes('tokyo') && active.includes('london')) {
        return 'Tokyo / London overlap (good liquidity)';
    }
    return active.map(s => labels[s]).join(' + ');
}
//# sourceMappingURL=session.js.map