import { useEffect, useState } from 'react'
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import { getMarketData } from '../api/client.ts'
import type { MarketSnapshot } from '../types/index.ts'

interface Props {
  market: 'crypto' | 'forex'
  symbol: string
  onClose: () => void
}

function fmt(n: number, d = 4) { return n.toFixed(d) }
function pct(n: number) { return `${n >= 0 ? '+' : ''}${n.toFixed(2)}%` }

export function MarketDataModal({ market, symbol, onClose }: Props) {
  const [data, setData] = useState<MarketSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    getMarketData(market, symbol)
      .then(setData)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [market, symbol])

  const chartData = data?.candles.h1.slice(-24).map(c => ({
    t: new Date(c.openTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    price: c.close,
  })) ?? []

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div
        className="bg-surface border border-border rounded-lg w-full max-w-2xl max-h-[85vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex justify-between items-center p-4 border-b border-border">
          <div>
            <h2 className="text-white font-bold text-base">{symbol}</h2>
            <span className="text-muted text-xs uppercase">{market} · live snapshot</span>
          </div>
          <button onClick={onClose} className="text-muted hover:text-white text-lg leading-none">✕</button>
        </div>

        <div className="p-4">
          {loading && <div className="text-muted text-sm py-8 text-center">Fetching market data...</div>}
          {error && (
            <div className="text-red text-sm py-8 text-center">
              Failed to fetch: {error}
            </div>
          )}

          {data && (
            <div className="space-y-4">
              {/* Price row */}
              <div className="grid grid-cols-3 gap-3">
                {[
                  { label: 'BID',  val: fmt(data.price.bid) },
                  { label: 'ASK',  val: fmt(data.price.ask) },
                  { label: 'LAST', val: fmt(data.price.last) },
                ].map(({ label, val }) => (
                  <div key={label} className="bg-surface2 rounded p-3 text-center">
                    <div className="text-muted text-[10px] tracking-widest mb-1">{label}</div>
                    <div className="text-white font-bold text-sm font-mono">{val}</div>
                  </div>
                ))}
              </div>

              {/* 24h stats */}
              <div className="grid grid-cols-4 gap-3">
                {[
                  { label: '24H CHANGE', val: pct(data.stats24h.changePercent), color: data.stats24h.changePercent >= 0 ? 'text-green' : 'text-red' },
                  { label: '24H HIGH',   val: fmt(data.stats24h.high), color: 'text-white' },
                  { label: '24H LOW',    val: fmt(data.stats24h.low), color: 'text-white' },
                  { label: 'VOLUME',     val: data.stats24h.volume > 1e6 ? `${(data.stats24h.volume / 1e6).toFixed(1)}M` : data.stats24h.volume.toFixed(0), color: 'text-white' },
                ].map(({ label, val, color }) => (
                  <div key={label} className="bg-surface2 rounded p-2">
                    <div className="text-muted text-[9px] tracking-widest mb-1">{label}</div>
                    <div className={`font-bold text-xs font-mono ${color}`}>{val}</div>
                  </div>
                ))}
              </div>

              {/* H1 price chart */}
              {chartData.length > 0 && (
                <div>
                  <div className="text-muted text-[10px] uppercase tracking-widest mb-2">Price — Last 24h (H1)</div>
                  <ResponsiveContainer width="100%" height={140}>
                    <AreaChart data={chartData}>
                      <defs>
                        <linearGradient id="priceGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#00e676" stopOpacity={0.15} />
                          <stop offset="95%" stopColor="#00e676" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <XAxis dataKey="t" tick={{ fill: '#444', fontSize: 9 }} interval="preserveStartEnd" />
                      <YAxis domain={['auto', 'auto']} tick={{ fill: '#444', fontSize: 9 }} width={55} tickFormatter={v => fmt(v, 2)} />
                      <Tooltip
                        contentStyle={{ background: '#1e1e1e', border: '1px solid #2a2a2a', borderRadius: 4, fontSize: 11 }}
                        labelStyle={{ color: '#666' }}
                        itemStyle={{ color: '#00e676' }}
                      />
                      <Area type="monotone" dataKey="price" stroke="#00e676" strokeWidth={1.5} fill="url(#priceGrad)" dot={false} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              )}

              {/* Indicators */}
              <div>
                <div className="text-muted text-[10px] uppercase tracking-widest mb-2">Technical Indicators</div>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { label: 'RSI 14',   val: data.indicators.rsi14.toFixed(1), color: data.indicators.rsi14 > 70 ? 'text-red' : data.indicators.rsi14 < 30 ? 'text-green' : 'text-white' },
                    { label: 'EMA 20',   val: fmt(data.indicators.ema20), color: 'text-white' },
                    { label: 'EMA 50',   val: fmt(data.indicators.ema50), color: 'text-white' },
                    { label: 'ATR 14',   val: fmt(data.indicators.atr14), color: 'text-white' },
                    { label: 'VWAP',     val: fmt(data.indicators.vwap), color: 'text-white' },
                    { label: 'BB WIDTH', val: fmt(data.indicators.bbWidth), color: 'text-white' },
                  ].map(({ label, val, color }) => (
                    <div key={label} className="bg-surface2 rounded p-2 flex justify-between items-center">
                      <span className="text-muted text-[10px]">{label}</span>
                      <span className={`font-bold text-xs font-mono ${color}`}>{val}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Forex extras */}
              {data.forex && (
                <div>
                  <div className="text-muted text-[10px] uppercase tracking-widest mb-2">Forex</div>
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { label: 'SPREAD',      val: `${data.forex.spread.toFixed(1)} pips` },
                      { label: 'PIP VALUE',   val: `$${data.forex.pipValue.toFixed(2)}` },
                      { label: 'SESSION',     val: data.forex.sessionOpen ? 'OPEN' : 'CLOSED', color: data.forex.sessionOpen ? 'text-green' : 'text-red' },
                    ].map(({ label, val, color }) => (
                      <div key={label} className="bg-surface2 rounded p-2 flex justify-between items-center">
                        <span className="text-muted text-[10px]">{label}</span>
                        <span className={`font-bold text-xs font-mono ${color ?? 'text-white'}`}>{val}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Balances */}
              {data.account.balances.length > 0 && (
                <div>
                  <div className="text-muted text-[10px] uppercase tracking-widest mb-2">Account Balances</div>
                  <div className="space-y-1">
                    {data.account.balances.map(b => (
                      <div key={b.asset} className="flex justify-between text-xs bg-surface2 rounded px-3 py-1.5">
                        <span className="text-muted">{b.asset}</span>
                        <span className="text-white font-mono">{b.free.toFixed(4)} <span className="text-muted">free</span> · {b.locked.toFixed(4)} <span className="text-muted">locked</span></span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="text-muted text-[10px] text-right pt-2 border-t border-border">
                Snapshot at {new Date(data.timestamp).toLocaleString()} · Read-only, no trades
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
