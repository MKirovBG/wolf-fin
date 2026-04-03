import type { WatchSymbol } from '../types.js';
export declare function startSchedule(sym: WatchSymbol): void;
export declare function stopSchedule(symbolKey: string): void;
/**
 * Sync a symbol's schedule with the current config.
 * Call after adding, updating, or removing a symbol.
 */
export declare function syncSchedule(sym: WatchSymbol): void;
/** Stop all running schedules (called on server shutdown). */
export declare function stopAllSchedules(): void;
/** Return the keys of all currently scheduled symbols. */
export declare function getScheduledKeys(): string[];
//# sourceMappingURL=index.d.ts.map