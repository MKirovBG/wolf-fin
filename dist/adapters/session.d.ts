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
 * Returns a human-readable session label for the system prompt.
 * e.g. "London / New York overlap (high liquidity)"
 */
export declare function sessionLabel(): string;
//# sourceMappingURL=session.d.ts.map