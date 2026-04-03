import type { LogEntry, LogLevel, LogEvent } from '../types.js';
type LogSubscriber = (entry: LogEntry) => void;
export declare function subscribeToLogs(cb: LogSubscriber): () => void;
export interface AnalysisEvent {
    type: 'analysis_update';
    symbolKey: string;
    analysisId: number;
}
type AnalysisSubscriber = (event: AnalysisEvent) => void;
export declare function subscribeToAnalyses(cb: AnalysisSubscriber): () => void;
export declare function broadcastAnalysisUpdate(symbolKey: string, analysisId: number): void;
export declare function logEvent(symbolKey: string, level: LogLevel, event: LogEvent, message: string, data?: Record<string, unknown>): void;
export declare function getLogs(sinceId?: number, symbolKey?: string, limit?: number): LogEntry[];
export {};
//# sourceMappingURL=state.d.ts.map