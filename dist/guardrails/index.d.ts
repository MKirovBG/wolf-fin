import type { OrderParams } from '../adapters/types.js';
import type { GuardrailsConfig } from '../types.js';
import type { ValidationResult } from './validate.js';
export * from './riskStateStore.js';
export * from './validate.js';
export * from './mt5.js';
export type ValidateCtx = {
    market: 'crypto';
    price: number;
} | {
    market: 'mt5';
    spread: number;
    sessionOpen: boolean;
    pipValue: number;
    guardrails?: Partial<GuardrailsConfig>;
};
/** Dispatches to the correct market validator. Single import point for all order validation. */
export declare function validateForMarket(params: OrderParams, ctx: ValidateCtx): ValidationResult;
//# sourceMappingURL=index.d.ts.map