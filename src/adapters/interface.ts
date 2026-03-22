// Wolf-Fin Adapter Interface — shared contract for all market adapters

import type {
  MarketSnapshot,
  OrderBook,
  Trade,
  Balance,
  Order,
  Fill,
  OrderParams,
  OrderResult,
  RiskState,
} from './types.js'
import type { IndicatorConfig, CandleConfig } from '../types.js'

export interface IMarketAdapter {
  readonly market: 'crypto' | 'mt5'

  getSnapshot(symbol: string, riskState: RiskState, indicatorCfg?: IndicatorConfig, candleCfg?: CandleConfig): Promise<MarketSnapshot>
  getOrderBook(symbol: string, depth?: number): Promise<OrderBook>
  getRecentTrades(symbol: string, limit?: number): Promise<Trade[]>
  getBalances(): Promise<Balance[]>
  getOpenOrders(symbol?: string): Promise<Order[]>
  getTradeHistory(symbol: string, limit?: number): Promise<Fill[]>
  placeOrder(params: OrderParams): Promise<OrderResult>
  cancelOrder(symbol: string, orderId: string | number): Promise<void>

  // Optional — spread/session data used by MT5
  getSpread?(symbol: string): Promise<number | null>
  isMarketOpen?(symbol: string): Promise<boolean>
}
