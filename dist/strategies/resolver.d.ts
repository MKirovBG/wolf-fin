import type { StrategyDefinition } from '../types/strategy.js';
/**
 * Returns the structured StrategyDefinition for a strategy key.
 * Priority: DB definition column → builtin definitions → undefined
 */
export declare function resolveStrategyDefinition(strategyKey: string | undefined | null): StrategyDefinition | undefined;
//# sourceMappingURL=resolver.d.ts.map