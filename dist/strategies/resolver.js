// Wolf-Fin — Strategy resolver (Phase 3)
// Resolves the active StrategyDefinition for a symbol from the DB.
import { dbGetStrategy } from '../db/index.js';
import { BUILTIN_DEFINITIONS } from './schema.js';
/**
 * Returns the structured StrategyDefinition for a strategy key.
 * Priority: DB definition column → builtin definitions → undefined
 */
export function resolveStrategyDefinition(strategyKey) {
    if (!strategyKey)
        return undefined;
    const row = dbGetStrategy(strategyKey);
    if (row?.definition) {
        try {
            return JSON.parse(row.definition);
        }
        catch {
            // Malformed definition — fall through to builtin
        }
    }
    return BUILTIN_DEFINITIONS[strategyKey];
}
//# sourceMappingURL=resolver.js.map