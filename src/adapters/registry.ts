// Wolf-Fin Adapter Registry — resolves market string to the correct adapter

import type { IMarketAdapter } from './interface.js'
import { binanceAdapter } from './binance.js'
import { alpacaAdapter } from './alpaca.js'
import { mt5Adapter } from './mt5.js'

const adapters: Record<'crypto' | 'forex' | 'mt5', IMarketAdapter> = {
  crypto: binanceAdapter,
  forex: alpacaAdapter,
  mt5: mt5Adapter,
}

export function getAdapter(market: 'crypto' | 'forex' | 'mt5'): IMarketAdapter {
  return adapters[market]
}
