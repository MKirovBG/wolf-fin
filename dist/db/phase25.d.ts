import Database from 'better-sqlite3';
import type { SetupCandidate } from '../types/setup.js';
import type { AlertRule, AlertFiring, BacktestTrade } from '../types/research.js';
export declare function initPhase25(dbInstance: Database.Database): void;
export declare function dbSaveCandidates(candidates: SetupCandidate[], analysisId: number): void;
export declare function dbGetCandidatesForAnalysis(analysisId: number): SetupCandidate[];
export declare function dbGetLatestCandidates(symbolKey: string): SetupCandidate[];
export declare function dbSaveStrategyVersion(strategyKey: string, version: string, definition: object, notes?: string): void;
export declare function dbGetStrategyVersions(strategyKey: string): Array<{
    id: number;
    version: string;
    createdAt: string;
    notes: string | null;
}>;
export declare function dbUpdateStrategyDefinition(key: string, definition: object): void;
export declare function dbCreateBacktestRun(symbolKey: string, config: object): number;
export declare function dbCompleteBacktestRun(id: number, metrics: object): void;
export declare function dbFailBacktestRun(id: number, error: string): void;
export declare function dbGetBacktestRun(id: number): {
    id: number;
    symbolKey: string;
    config: object;
    status: string;
    startedAt: string;
    completedAt: string | null;
    error: string | null;
    metrics: object | null;
} | null;
export declare function dbSaveBacktestTrades(trades: BacktestTrade[]): void;
export declare function dbCreateAlertRule(rule: Omit<AlertRule, 'id' | 'createdAt'>): number;
export declare function dbGetAlertRules(symbolKey?: string): AlertRule[];
export declare function dbToggleAlertRule(id: number, enabled: boolean): void;
export declare function dbDeleteAlertRule(id: number): void;
export declare function dbFireAlert(ruleId: number, symbolKey: string, message: string, analysisId?: number): void;
export declare function dbGetAlertFirings(symbolKey?: string, limit?: number): AlertFiring[];
export declare function dbAcknowledgeAlert(id: number): void;
export declare function dbGetLatestFeatureHistory(symbolKey: string, limit?: number): Array<{
    analysisId: number;
    capturedAt: string;
}>;
//# sourceMappingURL=phase25.d.ts.map