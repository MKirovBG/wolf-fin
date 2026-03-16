// Wolf-Fin Adapter Registry — resolves market string to the correct adapter

import type { IMarketAdapter } from './interface.js'
import { binanceAdapter } from './binance.js'
import { alpacaAdapter } from './alpaca.js'
import { MT5Adapter } from './mt5.js'

const adapters: Record<'crypto' | 'forex', IMarketAdapter> = {
  crypto: binanceAdapter,
  forex: alpacaAdapter,
}

export function getAdapter(market: 'crypto' | 'forex' | 'mt5', mt5AccountId?: number): IMarketAdapter {
  if (market === 'mt5') {
    // Create new MT5Adapter instance with account context
    return new MT5Adapter(mt5AccountId)
  }
  return adapters[market]
}
