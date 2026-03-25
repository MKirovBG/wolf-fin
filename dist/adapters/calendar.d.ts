export interface EconomicEvent {
    name: string;
    country: string;
    impact: 'High' | 'Medium' | 'Low';
    time: number;
    forecast?: string;
    previous?: string;
    actual?: string | null;
}
/**
 * Fetches high-impact economic events within the next `windowMs` ms.
 * Tries FF first; if FF returns [] and Finnhub key is set, falls back to Finnhub.
 * Returns [] on all errors — never throws.
 */
export declare function fetchUpcomingEvents(windowMs?: number): Promise<EconomicEvent[]>;
/**
 * Returns true if a high-impact event is scheduled within `windowMs`.
 * Returns false when no data is available (never blocks trading on data absence).
 */
export declare function isHighImpactEventSoon(windowMs?: number): Promise<boolean>;
/**
 * Fetches High + Medium impact events for the next N days.
 * Optionally filtered to a set of currency codes (e.g. ['USD', 'EUR']).
 * Used by the UI /api/economic-calendar route.
 */
export declare function fetchCalendarForDisplay(currencies?: string[], daysAhead?: number): Promise<EconomicEvent[]>;
//# sourceMappingURL=calendar.d.ts.map