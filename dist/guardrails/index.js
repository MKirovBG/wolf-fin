// Wolf-Fin Guardrails — risk checks, position limits, circuit breakers
// Single entry point: import everything from here instead of individual modules.
import { validateOrder } from './validate.js';
import { validateMt5Order } from './mt5.js';
export * from './riskStateStore.js';
export * from './validate.js';
export * from './mt5.js';
/** Dispatches to the correct market validator. Single import point for all order validation. */
export function validateForMarket(params, ctx) {
    if (ctx.market === 'mt5') {
        return validateMt5Order(params, ctx.spread, ctx.sessionOpen, ctx.pipValue, ctx.guardrails);
    }
    return validateOrder(params, ctx.price);
}
//# sourceMappingURL=index.js.map