// Wolf-Fin Adapter Registry — resolves market string to the correct adapter

import type { IMarketAdapter } from './interface.js'
import { binanceAdapter } from './binance.js'
import { MT5Adapter } from './mt5.js'

export function getAdapter(market: 'crypto' | 'mt5', mt5AccountId?: number): IMarketAdapter {
  if (market === 'mt5') {
    return new MT5Adapter(mt5AccountId)
  }
  return binanceAdapter
}
