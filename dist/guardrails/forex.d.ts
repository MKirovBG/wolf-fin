import type { OrderParams } from '../adapters/types.js';
import type { ValidationResult } from './validate.js';
/**
 * Validate a forex order before sending to Alpaca.
 *
 * @param params    - Order parameters (symbol, side, qty, price, stopPips)
 * @param spread    - Current bid/ask spread in pips (from last snapshot)
 * @param sessionOpen - Whether a major forex session is currently active
 * @param pipValue  - USD value per pip per unit (from Alpaca adapter)
 */
export declare function validateForexOrder(params: OrderParams, spread: number, sessionOpen: boolean, pipValue: number): ValidationResult;
//# sourceMappingURL=forex.d.ts.map