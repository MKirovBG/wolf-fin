import type { StrategyDefinition } from '../types/strategy.js';
export declare const STRATEGY_DEFINITION_VERSION = "1.0";
/** Validate a StrategyDefinition object, returning error strings. Empty = valid. */
export declare function validateStrategyDefinition(def: unknown): string[];
export declare const BUILTIN_DEFINITIONS: Record<string, StrategyDefinition>;
//# sourceMappingURL=schema.d.ts.map