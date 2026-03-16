export interface EconomicEvent {
    name: string;
    country: string;
    impact: string;
    time: number;
}
/**
 * Fetches today's high-impact economic events from Finnhub.
 * Returns events happening within the next `windowMs` milliseconds.
 * Returns [] when FINNHUB_KEY is missing or on any network error.
 */
export declare function fetchUpcomingEvents(windowMs?: number): Promise<EconomicEvent[]>;
/**
 * Returns true if a high-impact event is scheduled within `windowMs`.
 * Used by the forex guardrail to skip the trading cycle.
 */
export declare function isHighImpactEventSoon(windowMs?: number): Promise<boolean>;
//# sourceMappingURL=calendar.d.ts.map