// Wolf-Fin DataConfigEditors — UI controls for IndicatorConfig, CandleConfig, ContextConfig

import type { IndicatorConfig, CandleConfig, ContextConfig } from '../types/index.ts'

// ── Shared primitives ─────────────────────────────────────────────────────────

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2.5 border-b border-border last:border-0">
      <div className="min-w-0 flex-1">
        <span className="text-sm text-text font-medium">{label}</span>
        {hint && <p className="text-xs text-muted mt-0.5 leading-relaxed">{hint}</p>}
      </div>
      <div className="shrink-0 pt-0.5">{children}</div>
    </div>
  )
}

function Toggle({ checked, onChange, disabled }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none disabled:opacity-40 disabled:cursor-not-allowed ${
        checked ? 'bg-green' : 'bg-border'
      }`}
    >
      <span
        className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
          checked ? 'translate-x-4' : 'translate-x-1'
        }`}
      />
    </button>
  )
}

function NumInput({ value, onChange, min, max, step = 1, disabled }: {
  value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number; disabled?: boolean
}) {
  return (
    <input
      type="number"
      value={value}
      min={min}
      max={max}
      step={step}
      disabled={disabled}
      onChange={e => onChange(parseInt(e.target.value) || (min ?? 0))}
      className="w-20 bg-input border border-border rounded px-2 py-1 text-sm text-primary text-right focus:outline-none focus:border-green disabled:opacity-50"
    />
  )
}

// ── IndicatorConfigEditor ─────────────────────────────────────────────────────

const IND_DEFAULTS: Required<IndicatorConfig> = {
  rsiPeriod: 14, emaFast: 20, emaSlow: 50, atrPeriod: 14,
  bbPeriod: 20, bbStdDev: 2, vwapEnabled: true, mtfEnabled: true,
}

export function IndicatorConfigEditor({
  value, onChange, disabled,
}: {
  value: IndicatorConfig
  onChange: (v: IndicatorConfig) => void
  disabled?: boolean
}) {
  const v = { ...IND_DEFAULTS, ...value }
  const set = <K extends keyof IndicatorConfig>(k: K, val: IndicatorConfig[K]) =>
    onChange({ ...v, [k]: val })

  return (
    <div>
      <Row
        label="VWAP"
        hint="Volume-Weighted Average Price — anchors intraday price to volume activity. When price is above VWAP the market is broadly bullish for the session; below is bearish. Useful for mean-reversion and entry timing."
      >
        <Toggle checked={v.vwapEnabled} onChange={val => set('vwapEnabled', val)} disabled={disabled} />
      </Row>
      <Row
        label="Multi-timeframe (MTF)"
        hint="Computes RSI and EMA cross on M15 and H4 in addition to the primary H1. Produces a confluence score from −3 (all bearish) to +3 (all bullish). Helps the agent avoid counter-trend entries — disable to reduce per-tick computation."
      >
        <Toggle checked={v.mtfEnabled} onChange={val => set('mtfEnabled', val)} disabled={disabled} />
      </Row>

      <div className="pt-3 grid grid-cols-2 gap-x-6">
        <Row
          label="RSI period"
          hint="Relative Strength Index lookback. 14 is the standard. Lower (e.g. 9) is more reactive and suits scalping; higher (e.g. 21) smooths noise and suits swing trading."
        >
          <NumInput value={v.rsiPeriod} min={2} max={50} onChange={val => set('rsiPeriod', val)} disabled={disabled} />
        </Row>
        <Row
          label="ATR period"
          hint="Average True Range lookback for volatility measurement. 14 is standard. ATR drives stop-loss and take-profit sizing — a wider ATR means wider stops. Keep matched to your RSI period."
        >
          <NumInput value={v.atrPeriod} min={2} max={50} onChange={val => set('atrPeriod', val)} disabled={disabled} />
        </Row>
        <Row
          label="EMA fast"
          hint="Fast exponential moving average. Crosses above EMA slow signal bullish momentum. 20 is the default. Use 9 for scalping or 50 for trend-following on longer timeframes."
        >
          <NumInput value={v.emaFast} min={2} max={200} onChange={val => set('emaFast', val)} disabled={disabled} />
        </Row>
        <Row
          label="EMA slow"
          hint="Slow EMA — acts as the trend baseline. When price is above EMA slow the broader trend is up. 50 is the standard medium-term trend filter. Use 200 for long-term trend-following strategies."
        >
          <NumInput value={v.emaSlow} min={2} max={500} onChange={val => set('emaSlow', val)} disabled={disabled} />
        </Row>
        <Row
          label="BB period"
          hint="Bollinger Bands SMA period. 20 is standard. BB Width measures volatility squeeze — a narrow band (low BB Width) often precedes a breakout move. The agent uses BB Width, not the bands directly."
        >
          <NumInput value={v.bbPeriod} min={2} max={100} onChange={val => set('bbPeriod', val)} disabled={disabled} />
        </Row>
        <Row
          label="BB std dev"
          hint="Standard deviation multiplier for the Bollinger Bands envelope. 2 is the standard (covers ~95% of price action). Increase to 2.5–3 for volatile assets to avoid false squeezes."
        >
          <NumInput value={v.bbStdDev} min={1} max={5} step={1} onChange={val => set('bbStdDev', val)} disabled={disabled} />
        </Row>
      </div>
    </div>
  )
}

// ── CandleConfigEditor ────────────────────────────────────────────────────────

const ALL_TFS = ['m1', 'm5', 'm15', 'm30', 'h1', 'h4'] as const
type TF = typeof ALL_TFS[number]
const TF_LABELS: Record<TF, string> = { m1: 'M1', m5: 'M5', m15: 'M15', m30: 'M30', h1: 'H1', h4: 'H4' }

const TF_HINTS: Record<TF, string> = {
  m1:  'Used for immediate price action, entry timing, and short-term pattern detection.',
  m5:  'Useful for scalping strategies and fine-tuning entries within an M15 trend.',
  m15: 'Primary timeframe for intraday strategies — balances signal quality with responsiveness.',
  m30: 'Good for session-level context. Bridges M15 noise and H1 trend.',
  h1:  'Primary trend timeframe. Used for indicator computation (RSI, EMA, ATR) by default.',
  h4:  'Higher timeframe trend filter. Used in MTF confluence scoring. Essential for swing strategies.',
}

export function CandleConfigEditor({
  value, onChange, disabled,
}: {
  value: CandleConfig
  onChange: (v: CandleConfig) => void
  disabled?: boolean
}) {
  const tfs: TF[] = (value.timeframes as TF[] | undefined) ?? [...ALL_TFS]
  const limit = value.limit ?? 100

  const toggleTF = (tf: TF) => {
    const next = tfs.includes(tf) ? tfs.filter(t => t !== tf) : [...tfs, tf]
    onChange({ ...value, timeframes: next.length === ALL_TFS.length ? undefined : next })
  }

  return (
    <div>
      <Row
        label="Candles per timeframe"
        hint="How many bars to fetch for each selected timeframe every tick. 100 is the default and covers ~4 days on H1 or ~1.5 hours on M1. Increase for strategies that need deeper history (e.g. weekly pivots need 168+ H1 bars). Decreasing saves API quota."
      >
        <NumInput
          value={limit}
          min={20}
          max={500}
          step={10}
          onChange={val => onChange({ ...value, limit: val === 100 ? undefined : val })}
          disabled={disabled}
        />
      </Row>

      <div className="py-3 border-b border-border last:border-0">
        <div className="text-sm text-text font-medium mb-1">Timeframes to fetch</div>
        <p className="text-xs text-muted mb-3 leading-relaxed">
          Only selected timeframes are fetched each tick. Deselect timeframes your strategy does not use to reduce latency and broker API load. H1 is used for primary indicator computation — keep it selected unless you override that in your strategy.
        </p>
        <div className="flex flex-wrap gap-2 mb-2">
          {ALL_TFS.map(tf => {
            const active = tfs.includes(tf)
            return (
              <button
                key={tf}
                type="button"
                onClick={() => !disabled && toggleTF(tf)}
                disabled={disabled}
                title={TF_HINTS[tf]}
                className={`px-3 py-1.5 rounded text-xs font-medium border transition-colors disabled:opacity-50
                  ${active
                    ? 'bg-green-dim border-green text-green'
                    : 'bg-input text-muted border-border hover:border-muted2 hover:text-text'}`}
              >
                {TF_LABELS[tf]}
              </button>
            )
          })}
        </div>
        <div className="space-y-1">
          {ALL_TFS.filter(tf => tfs.includes(tf)).map(tf => (
            <p key={tf} className="text-xs text-muted2 leading-relaxed">
              <span className="text-green font-medium">{TF_LABELS[tf]}:</span> {TF_HINTS[tf]}
            </p>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── ContextConfigEditor ───────────────────────────────────────────────────────

export function ContextConfigEditor({
  value, onChange, market, disabled,
}: {
  value: ContextConfig
  onChange: (v: ContextConfig) => void
  market: 'crypto' | 'mt5'
  disabled?: boolean
}) {
  const get = (k: keyof ContextConfig) => value[k] !== false
  const set = (k: keyof ContextConfig, val: boolean) =>
    onChange({ ...value, [k]: val === true ? undefined : false })

  return (
    <div>
      <Row
        label="Economic calendar"
        hint="Injects upcoming high-impact macro events (next 2 hours) into every tick. The agent uses this to avoid opening positions ahead of NFP, CPI, FOMC, or other market-moving releases. Strongly recommended — disable only if you trade a strategy that ignores news."
      >
        <Toggle checked={get('economicCalendar')} onChange={val => set('economicCalendar', val)} disabled={disabled} />
      </Row>

      {market === 'crypto' && <>
        <Row
          label="Fear & Greed index"
          hint="The Crypto Fear & Greed Index (0–100) measures overall market sentiment sourced from volatility, volume, social media, and dominance. Extreme Fear (0–25) can signal buying opportunities; Extreme Greed (75–100) can signal overextension. Useful for contra-trend filters."
        >
          <Toggle checked={get('fearGreed')} onChange={val => set('fearGreed', val)} disabled={disabled} />
        </Row>
        <Row
          label="Crypto news"
          hint="Recent headlines for the traded symbol from CryptoPanic, ranked by community votes. Helps the agent avoid entering during negative news events or capitalise on momentum driven by positive announcements. Disable if you prefer a purely technical approach."
        >
          <Toggle checked={get('news')} onChange={val => set('news', val)} disabled={disabled} />
        </Row>
        <Row
          label="Crypto market data"
          hint="BTC dominance and total crypto market cap from CoinGecko. Rising BTC dominance signals risk-off rotation into BTC at the expense of altcoins. Useful for altcoin agents to assess broader market health before trading."
        >
          <Toggle checked={get('cryptoMarket')} onChange={val => set('cryptoMarket', val)} disabled={disabled} />
        </Row>
      </>}

      {market === 'mt5' && (
        <Row
          label="Forex news"
          hint="Recent forex-specific headlines from Finnhub with bullish/bearish/neutral sentiment tags. Helps the agent gauge directional bias from news flow for currency pairs and metals. Disable for purely technical strategies or if you want to reduce prompt size."
        >
          <Toggle checked={get('forexNews')} onChange={val => set('forexNews', val)} disabled={disabled} />
        </Row>
      )}
    </div>
  )
}
