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
  support:    '#20D68A',
  resistance: '#FF4757',
  pivot:      '#9B59FF',
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
        background:  { type: ColorType.Solid, color: '#0E1929' },
        textColor:   '#6B84A0',
        fontSize:    11,
      },
      grid: {
        vertLines:   { color: '#1A2840' },
        horzLines:   { color: '#1A2840' },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: '#2A4A6E', labelBackgroundColor: '#152035' },
        horzLine: { color: '#2A4A6E', labelBackgroundColor: '#152035' },
      },
      rightPriceScale: {
        borderColor: '#1E3352',
        textColor:   '#6B84A0',
      },
      timeScale: {
        borderColor:       '#1E3352',
        timeVisible:       true,
        secondsVisible:    false,
        rightOffset:       5,
        barSpacing:        8,
      },
      width:  containerRef.current.clientWidth,
      height,
    })

    const series = chart.addSeries(CandlestickSeries, {
      upColor:          '#20D68A',
      downColor:        '#FF4757',
      borderUpColor:    '#20D68A',
      borderDownColor:  '#FF4757',
      wickUpColor:      '#20D68A',
      wickDownColor:    '#FF4757',
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
      const dirColor = isBuy ? '#20D68A' : '#FF4757'

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
        color:      '#FF475799',
        lineWidth:  2,
        lineStyle:  LineStyle.Dashed,
        axisLabelVisible: true,
        title:      `SL`,
      } as PriceLineOptions)

      // Take profits
      proposal.takeProfits.forEach((tp, i) => {
        series.createPriceLine({
          price:      tp,
          color:      '#20D68A99',
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
        color:      '#00E5CC99',
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
      className="rounded-xl overflow-hidden border border-border"
    />
  )
}
