import { useEffect, useRef, useCallback } from 'react'
import {
  createChart,
  ColorType,
  CrosshairMode,
  LineStyle,
  CandlestickSeries,
} from 'lightweight-charts'
import type {
  IChartApi,
  ISeriesApi,
  CandlestickData,
  Time,
  PriceLineOptions,
} from 'lightweight-charts'
import type { CandleBar, KeyLevel, TradeProposal } from '../types/index.ts'

interface Props {
  candles:       CandleBar[]
  keyLevels?:    KeyLevel[]
  proposal?:     TradeProposal | null
  currentPrice?: number
  height?:       number
}

const BIAS_COLORS = {
  support:    '#26a69a',
  resistance: '#ef5350',
  pivot:      '#7e57c2',
}

const STRENGTH_OPACITY = {
  strong:   'ff',
  moderate: 'cc',
  weak:     '88',
}

export function CandlestickChart({ candles, keyLevels = [], proposal, currentPrice, height = 480 }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef     = useRef<IChartApi | null>(null)
  const seriesRef    = useRef<ISeriesApi<'Candlestick'> | null>(null)

  const buildChart = useCallback(() => {
    if (!containerRef.current) return

    // Destroy existing chart
    if (chartRef.current) {
      chartRef.current.remove()
      chartRef.current = null
      seriesRef.current = null
    }

    const chart = createChart(containerRef.current, {
      layout: {
        background:  { type: ColorType.Solid, color: '#0d0d0d' },
        textColor:   '#9e9e9e',
        fontSize:    11,
      },
      grid: {
        vertLines:   { color: '#1a1a1a' },
        horzLines:   { color: '#1a1a1a' },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: '#444', labelBackgroundColor: '#1e1e1e' },
        horzLine: { color: '#444', labelBackgroundColor: '#1e1e1e' },
      },
      rightPriceScale: {
        borderColor: '#2a2a2a',
        textColor:   '#9e9e9e',
      },
      timeScale: {
        borderColor:       '#2a2a2a',
        timeVisible:       true,
        secondsVisible:    false,
        rightOffset:       5,
        barSpacing:        8,
      },
      width:  containerRef.current.clientWidth,
      height,
    })

    const series = chart.addSeries(CandlestickSeries, {
      upColor:          '#26a69a',
      downColor:        '#ef5350',
      borderUpColor:    '#26a69a',
      borderDownColor:  '#ef5350',
      wickUpColor:      '#26a69a',
      wickDownColor:    '#ef5350',
    })

    if (candles.length > 0) {
      series.setData(candles.map(c => ({
        time:  c.time as Time,
        open:  c.open,
        high:  c.high,
        low:   c.low,
        close: c.close,
      })) as CandlestickData[])
    }

    // ── Key levels ──────────────────────────────────────────────────────────
    for (const level of keyLevels) {
      const baseColor = BIAS_COLORS[level.type] ?? '#9e9e9e'
      const opacity   = STRENGTH_OPACITY[level.strength] ?? 'aa'
      const color     = baseColor + opacity

      const lineOpts: Partial<PriceLineOptions> = {
        price:      level.price,
        color,
        lineWidth:  level.strength === 'strong' ? 2 : 1,
        lineStyle:  level.strength === 'strong' ? LineStyle.Solid : LineStyle.Dashed,
        axisLabelVisible: true,
        title:      level.label,
      }
      series.createPriceLine(lineOpts as PriceLineOptions)
    }

    // ── Trade proposal ──────────────────────────────────────────────────────
    if (proposal) {
      const isBuy = proposal.direction === 'BUY'
      const dirColor = isBuy ? '#26a69a' : '#ef5350'

      // Entry zone (upper bound line)
      series.createPriceLine({
        price:      proposal.entryZone.high,
        color:      dirColor + 'cc',
        lineWidth:  1,
        lineStyle:  LineStyle.Dotted,
        axisLabelVisible: true,
        title:      `Entry: ${proposal.entryZone.low.toFixed(5)}–${proposal.entryZone.high.toFixed(5)}`,
      } as PriceLineOptions)

      // Stop loss
      series.createPriceLine({
        price:      proposal.stopLoss,
        color:      '#ef535099',
        lineWidth:  2,
        lineStyle:  LineStyle.Dashed,
        axisLabelVisible: true,
        title:      `SL`,
      } as PriceLineOptions)

      // Take profits
      proposal.takeProfits.forEach((tp, i) => {
        series.createPriceLine({
          price:      tp,
          color:      '#26a69a99',
          lineWidth:  1,
          lineStyle:  LineStyle.Dashed,
          axisLabelVisible: true,
          title:      `TP${i + 1}`,
        } as PriceLineOptions)
      })
    }

    // ── Current price ────────────────────────────────────────────────────────
    if (currentPrice) {
      series.createPriceLine({
        price:      currentPrice,
        color:      '#ffd54f99',
        lineWidth:  1,
        lineStyle:  LineStyle.Solid,
        axisLabelVisible: true,
        title:      'Current',
      } as PriceLineOptions)
    }

    chart.timeScale().fitContent()

    chartRef.current  = chart
    seriesRef.current = series
  }, [candles, keyLevels, proposal, currentPrice, height])

  useEffect(() => {
    buildChart()
    return () => {
      chartRef.current?.remove()
      chartRef.current  = null
      seriesRef.current = null
    }
  }, [buildChart])

  // Resize observer
  useEffect(() => {
    if (!containerRef.current) return
    const ro = new ResizeObserver(entries => {
      if (chartRef.current && entries[0]) {
        chartRef.current.applyOptions({ width: entries[0].contentRect.width })
      }
    })
    ro.observe(containerRef.current)
    return () => ro.disconnect()
  }, [])

  return (
    <div
      ref={containerRef}
      style={{ width: '100%', height }}
      className="rounded-lg overflow-hidden border border-border"
    />
  )
}
