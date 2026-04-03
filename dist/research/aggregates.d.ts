import type { SetupCandidate } from '../types/setup.js';
export interface PerformanceSlice {
    key: string;
    trades: number;
    wins: number;
    losses: number;
    winRate: number;
    avgScore: number;
    avgRR: number;
}
/** Aggregate setup candidate outcomes by a grouping key. */
export declare function aggregateByKey(candidates: Array<SetupCandidate & {
    outcome?: string;
    rMultiple?: number;
}>, getKey: (c: SetupCandidate) => string): PerformanceSlice[];
export declare function leaderboardByDetector(candidates: Array<SetupCandidate & {
    outcome?: string;
    rMultiple?: number;
}>): PerformanceSlice[];
export declare function leaderboardBySession(candidates: Array<SetupCandidate & {
    outcome?: string;
    rMultiple?: number;
}>): PerformanceSlice[];
export declare function leaderboardByRegime(candidates: Array<SetupCandidate & {
    outcome?: string;
    rMultiple?: number;
}>): PerformanceSlice[];
//# sourceMappingURL=aggregates.d.ts.map