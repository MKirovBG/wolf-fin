// Wolf-Fin Adapter Registry

import { MT5Adapter } from './mt5.js'

export function getAdapter(mt5AccountId?: number): MT5Adapter {
  return new MT5Adapter(mt5AccountId)
}
