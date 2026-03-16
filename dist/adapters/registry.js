// Wolf-Fin Adapter Registry — resolves market string to the correct adapter
import { binanceAdapter } from './binance.js';
import { alpacaAdapter } from './alpaca.js';
const adapters = {
    crypto: binanceAdapter,
    forex: alpacaAdapter,
};
export function getAdapter(market) {
    return adapters[market];
}
//# sourceMappingURL=registry.js.map