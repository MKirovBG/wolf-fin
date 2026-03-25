// Wolf-Fin Tool Handlers — market data reads
// Handles: get_snapshot, get_order_book, get_recent_trades, get_open_orders

import { getAdapter } from '../../adapters/registry.js'
import { getRiskStateFor, updatePositionNotionalFor, setMt5Context } from '../../guardrails/riskStateStore.js'
import { pipSize } from '../../adapters/session.js'
import { buildMarketContext } from '../context.js'
import type { DispatchCtx } from './types.js'

export async function handleMarketData(name: string, ctx: DispatchCtx): Promise<unknown> {
  const { input, market, mt5AccountId, agentConfig } = ctx
  const adapter = getAdapter(market, mt5AccountId)

  switch (name) {
    case 'get_snapshot': {
      const riskState = getRiskStateFor(market)
      const snap = await adapter.getSnapshot(
        input.symbol as string,
        riskState,
        agentConfig?.indicatorConfig,
        agentConfig?.candleConfig,
      )
      snap.context = await buildMarketContext(input.symbol as string, market, agentConfig?.contextConfig)
      const openNotional = (snap.account.openOrders as Array<{ price: number; origQty: number }>)
        .reduce((sum, o) => sum + o.price * o.origQty, 0)
      updatePositionNotionalFor(market, openNotional)
      if (market === 'mt5' && snap.forex) {
        const pt = snap.forex.point ?? 0.0001
        const ps = snap.forex.pipSize ?? pipSize('', pt)
        setMt5Context({
          spread:      snap.forex.spread,
          sessionOpen: snap.forex.sessionOpen,
          pipValue:    snap.forex.pipValue,
          point:       pt,
          digits:      pt <= 0.001 ? 5 : 2,
          pipSize:     ps,
        })
      }
      return snap
    }
    case 'get_order_book':
      return adapter.getOrderBook(input.symbol as string, input.depth as number | undefined)
    case 'get_recent_trades':
      return adapter.getRecentTrades(input.symbol as string, input.limit as number | undefined)
    case 'get_open_orders':
      return adapter.getOpenOrders(input.symbol as string | undefined)
    default:
      throw new Error(`Unknown market data tool: ${name}`)
  }
}
