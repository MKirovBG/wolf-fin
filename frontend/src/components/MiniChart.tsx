import { useEffect, useRef, useCallback } from 'react'
import {
  createChart,
  ColorType,
  CrosshairMode,
  CandlestickSeries,
} from 'lightweight-charts'
import type { IChartApi, CandlestickData, Time } from 'lightweight-charts'
import type { CandleBar } from '../types/index.ts'

interface Props {
  candles: CandleBar[]
  height?: number
}

export function MiniChart({ candles, height = 120 }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)

  const buildChart = useCallback(() => {
    if (!containerRef.current) return

    if (chartRef.current) {
      chartRef.current.remove()
      chartRef.current = null
    }

    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: '#6B84A0',
        fontSize: 9,
      },
      grid: {
        vertLines: { visible: false },
        horzLines: { color: '#1A284022' },
      },
      crosshair: {
        mode: CrosshairMode.Magnet,
        vertLine: { visible: false, labelVisible: false },
        horzLine: { visible: false, labelVisible: false },
      },
      rightPriceScale: {
        visible: false,
      },
      timeScale: {
        visible: false,
        rightOffset: 1,
        barSpacing: 3,
      },
      handleScroll: false,
      handleScale: false,
      width: containerRef.current.clientWidth,
      height,
    })

    const series = chart.addSeries(CandlestickSeries, {
      upColor: '#20D68A',
      downColor: '#FF4757',
      borderUpColor: '#20D68A',
      borderDownColor: '#FF4757',
      wickUpColor: '#20D68A',
      wickDownColor: '#FF4757',
    })

    if (candles.length > 0) {
      series.setData(candles.map(c => ({
        time: c.time as Time,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      })) as CandlestickData[])
    }

    chart.timeScale().fitContent()
    chartRef.current = chart
  }, [candles, height])

  useEffect(() => {
    buildChart()
    return () => {
      chartRef.current?.remove()
      chartRef.current = null
    }
  }, [buildChart])

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

  return <div ref={containerRef} style={{ width: '100%', height }} />
}
