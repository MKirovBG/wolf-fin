// Wolf-Fin Adapter Registry — resolves market string to the correct adapter
import { binanceAdapter } from './binance.js';
import { alpacaAdapter } from './alpaca.js';
import { MT5Adapter } from './mt5.js';
const adapters = {
    crypto: binanceAdapter,
    forex: alpacaAdapter,
};
export function getAdapter(market, mt5AccountId) {
    if (market === 'mt5') {
        // Create new MT5Adapter instance with account context
        return new MT5Adapter(mt5AccountId);
    }
    return adapters[market];
}
//# sourceMappingURL=registry.js.map