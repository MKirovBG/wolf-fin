export type SessionName = 'sydney' | 'tokyo' | 'london' | 'newyork';
export interface SessionContext {
    activeSessions: SessionName[];
    isLondonOpen: boolean;
    isNYOpen: boolean;
    isLondonNYOverlap: boolean;
    nextSession: SessionName | null;
    minutesToNextOpen: number | null;
    isOptimalSession: boolean;
    note: string;
}
export declare function buildSessionContext(symbol: string): SessionContext;
//# sourceMappingURL=session.d.ts.map