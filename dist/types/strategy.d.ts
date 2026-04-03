export interface StrategyContext {
    allowedSessions: string[];
    allowedRegimes: string[];
    newsBufferMinutes: number;
    maxSpreadPips: number;
}
export interface StrategyEntryRules {
    maxEntryWidthATR: number;
    requireConfirmation: boolean;
}
export interface StrategyRiskRules {
    minRR: number;
    maxStopATR: number;
    minStopATR?: number;
}
export interface StrategyDefinition {
    strategyKey: string;
    name: string;
    description?: string;
    version: string;
    tags?: string[];
    allowedSymbolFamilies?: string[];
    context: StrategyContext;
    biasRules?: string[];
    allowedDetectors: string[];
    entryRules: StrategyEntryRules;
    riskRules: StrategyRiskRules;
    disqualifiers?: string[];
    promptNotes?: string;
}
//# sourceMappingURL=strategy.d.ts.map