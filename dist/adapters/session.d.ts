export type Session = 'sydney' | 'tokyo' | 'london' | 'newyork';
/** Returns which sessions are currently open. */
export declare function openSessions(): Session[];
/**
 * Returns true when forex markets have meaningful liquidity:
 * - At least one major session is open (Tokyo, London, or New York)
 * - Not in the 30-minute buffer before Sydney-only periods
 */
export declare function isForexSessionOpen(): boolean;
/**
 * Returns minutes remaining until the earliest active session closes.
 * Returns null if no major session is open.
 */
export declare function minutesUntilSessionClose(): number | null;
/**
 * Derives pip size from broker point value.
 * point >= 0.01 → index/commodity/crypto-CFD → pip = 1.0
 * point >= 0.001 → JPY/ZAR pairs → pip = point × 10
 * default → 4-decimal forex → pip = 0.0001
 */
export declare function pipSize(symbol: string, point?: number): number;
/**
 * Returns a human-readable session label for the system prompt.
 * e.g. "London / New York overlap (high liquidity)"
 */
export declare function sessionLabel(): string;
//# sourceMappingURL=session.d.ts.map