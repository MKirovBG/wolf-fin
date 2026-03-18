// Wolf-Fin Adapter Registry — resolves market string to the correct adapter
import { binanceAdapter } from './binance.js';
import { MT5Adapter } from './mt5.js';
export function getAdapter(market, mt5AccountId) {
    if (market === 'mt5') {
        return new MT5Adapter(mt5AccountId);
    }
    return binanceAdapter;
}
//# sourceMappingURL=registry.js.map