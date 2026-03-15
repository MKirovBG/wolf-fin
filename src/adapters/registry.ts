// Wolf-Fin Adapter Registry — resolves market string to the correct adapter

import type { IMarketAdapter } from './interface.js'
import { binanceAdapter } from './binance.js'
import { alpacaAdapter } from './alpaca.js'

const adapters: Record<'crypto' | 'forex', IMarketAdapter> = {
  crypto: binanceAdapter,
  forex: alpacaAdapter,
}

export function getAdapter(market: 'crypto' | 'forex'): IMarketAdapter {
  return adapters[market]
}
