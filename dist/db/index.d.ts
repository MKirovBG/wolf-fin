import type { WatchSymbol, AnalysisResult, LogEntry } from '../types.js';
import type { FeatureSnapshot, MarketState } from '../types/market.js';
export { dbSaveCandidates, dbGetCandidatesForAnalysis, dbGetLatestCandidates, dbSaveStrategyVersion, dbGetStrategyVersions, dbUpdateStrategyDefinition, dbCreateBacktestRun, dbCompleteBacktestRun, dbFailBacktestRun, dbGetBacktestRun, dbSaveBacktestTrades, dbCreateAlertRule, dbGetAlertRules, dbToggleAlertRule, dbDeleteAlertRule, dbFireAlert, dbGetAlertFirings, dbAcknowledgeAlert, dbGetLatestFeatureHistory, } from './phase25.js';
export declare function initDb(): void;
/** Expose migration status for the health endpoint. */
export declare function dbGetMigrationStatus(): {
    version: number;
    name: string;
    appliedAt: string;
}[];
/**
 * Prune old log entries, keeping only the most recent `maxEntries`.
 * Returns the number of rows deleted.
 */
export declare function dbPruneLogs(maxEntries?: number): number;
/**
 * Run SQLite integrity_check and return the result lines.
 * Returns ['ok'] when the database is healthy.
 */
export declare function dbCheckIntegrity(): string[];
export declare function dbGetAllSymbols(): WatchSymbol[];
export declare function dbGetSymbol(key: string): WatchSymbol | null;
export declare function dbUpsertSymbol(sym: WatchSymbol): void;
export declare function dbDeleteSymbol(key: string): void;
export declare function dbSetLastAnalysisAt(key: string, time: string): void;
export declare function dbSaveAnalysis(result: Omit<AnalysisResult, 'id'>): number;
export declare function dbGetAnalyses(symbolKey: string, limit?: number): AnalysisResult[];
export declare function dbGetLatestAnalysis(symbolKey: string): AnalysisResult | null;
export declare function dbGetAllRecentAnalyses(limit?: number): AnalysisResult[];
export declare function dbGetAnalysisById(id: number): AnalysisResult | null;
export declare function dbLogEvent(entry: LogEntry): void;
export declare function dbGetLogs(sinceId?: number, symbolKey?: string, limit?: number): LogEntry[];
export declare function dbGetMaxLogId(): number;
export declare function dbGetSetting(key: string): string | null;
export declare function dbSetSetting(key: string, value: string): void;
export interface Mt5AccountRow {
    login: number;
    name: string;
    server: string;
    mode: string;
    lastSeenAt: string;
    inBridge: boolean;
}
export declare function dbUpsertMt5Accounts(accounts: Mt5AccountRow[]): void;
export declare function dbMarkMt5AccountsGone(): void;
export declare function dbGetAllMt5Accounts(): Mt5AccountRow[];
export declare function makeSymbolKey(symbol: string, mt5AccountId?: number): string;
export interface StrategyRow {
    id: number;
    key: string;
    name: string;
    description: string | null;
    instructions: string;
    definition?: string | null;
    isBuiltin: boolean;
    createdAt: string;
}
export declare function dbGetAllStrategies(): StrategyRow[];
export declare function dbGetStrategy(key: string): StrategyRow | null;
export declare function dbUpsertStrategy(s: {
    key: string;
    name: string;
    description?: string;
    instructions: string;
}): void;
export declare function dbDeleteStrategy(key: string): void;
export type OutcomeStatus = 'pending' | 'entered' | 'hit_tp1' | 'hit_tp2' | 'hit_sl' | 'expired' | 'invalidated';
export interface ProposalOutcome {
    id: number;
    analysisId: number;
    symbolKey: string;
    direction: 'BUY' | 'SELL';
    entryLow: number;
    entryHigh: number;
    sl: number;
    tp1: number | null;
    tp2: number | null;
    tp3: number | null;
    status: OutcomeStatus;
    createdAt: string;
    enteredAt: string | null;
    resolvedAt: string | null;
    exitPrice: number | null;
    pipsResult: number | null;
}
export declare function dbCreateOutcome(o: Omit<ProposalOutcome, 'id' | 'enteredAt' | 'resolvedAt' | 'exitPrice' | 'pipsResult'>): number;
export declare function dbUpdateOutcomeStatus(id: number, status: OutcomeStatus, fields?: {
    enteredAt?: string;
    resolvedAt?: string;
    exitPrice?: number;
    pipsResult?: number;
}): void;
export declare function dbGetPendingOutcomes(): ProposalOutcome[];
export declare function dbGetOutcomes(symbolKey?: string, limit?: number): ProposalOutcome[];
export declare function dbGetOutcomeStats(symbolKey?: string): {
    total: number;
    entered: number;
    hitTp1: number;
    hitTp2: number;
    hitSl: number;
    expired: number;
    winRate: number;
};
export declare function dbSaveFeatures(features: FeatureSnapshot, analysisId: number): void;
export declare function dbGetLatestFeatures(symbolKey: string): FeatureSnapshot | null;
export declare function dbGetFeaturesForAnalysis(analysisId: number): FeatureSnapshot | null;
export declare function dbSaveMarketState(state: MarketState, analysisId: number): void;
export declare function dbGetLatestMarketState(symbolKey: string): MarketState | null;
export declare function dbGetMarketStateForAnalysis(analysisId: number): MarketState | null;
//# sourceMappingURL=index.d.ts.map