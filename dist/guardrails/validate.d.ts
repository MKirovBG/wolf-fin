import type { OrderParams } from '../adapters/types.js';
export interface ValidationResult {
    ok: boolean;
    reason?: string;
}
/**
 * Validate an order before sending to Binance.
 * Returns { ok: true } when the order passes all checks, or { ok: false, reason } otherwise.
 */
export declare function validateOrder(params: OrderParams, currentPrice: number): ValidationResult;
//# sourceMappingURL=validate.d.ts.map