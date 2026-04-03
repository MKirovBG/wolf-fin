import type { WatchSymbol, AnalysisResult, LogEntry } from '../types.js';
export declare function initDb(): void;
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
//# sourceMappingURL=index.d.ts.map