import type { OrderParams } from '../adapters/types.js';
import type { ValidationResult } from './validate.js';
import type { GuardrailsConfig } from '../types.js';
/**
 * Validate an MT5 order before sending to the bridge.
 * Follows the same pattern as validateForexOrder for forex-class symbols.
 */
export declare function validateMt5Order(params: OrderParams, spread: number, sessionOpen: boolean, pipValue: number, guardrails?: Partial<GuardrailsConfig>): ValidationResult;
//# sourceMappingURL=mt5.d.ts.map