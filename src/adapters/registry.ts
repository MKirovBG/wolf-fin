// Wolf-Fin Adapter Registry — resolves market string to the correct adapter

import type { IMarketAdapter } from './interface.js'
import { binanceAdapter } from './binance.js'
import { oandaAdapter } from './oanda.js'

const adapters: Record<'crypto' | 'forex', IMarketAdapter> = {
  crypto: binanceAdapter,
  forex: oandaAdapter,
}

export function getAdapter(market: 'crypto' | 'forex'): IMarketAdapter {
  return adapters[market]
}
