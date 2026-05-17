'use client'

import { useEffect, useRef, useCallback } from 'react'
import {
  createChart,
  LineSeries,
  AreaSeries,
  HistogramSeries,
  IChartApi,
  ISeriesApi,
  SeriesType,
  Time,
  MouseEventParams,
} from 'lightweight-charts'
import { SeriesConfig } from '@/lib/types'
import { evaluateFormula } from '@/lib/formula'

interface Props {
  series: SeriesConfig[]
  normalizeAll: boolean
}

type AnySeriesApi = ISeriesApi<SeriesType>

// Compute display data for one series (handles formula + normalization)
function buildData(
  s: SeriesConfig,
  allSeries: SeriesConfig[],
  normalizeAll: boolean,
): { time: Time; value: number }[] {
  let raw: { date: string; value: number }[]

  if (s.type === 'formula' && s.formula) {
    const dataSeries = allSeries.filter((x) => x.type !== 'formula' && x.data.length > 0)
    const maps: Record<string, Map<string, number | null>> = {}
    for (const ds of dataSeries) {
      maps[ds.id] = new Map(ds.data.map((d) => [d.date, d.value]))
    }
    const dates = [...new Set(dataSeries.flatMap((ds) => ds.data.map((d) => d.date)))].sort()
    raw = dates
      .map((date) => {
        const vars: Record<string, number | null> = {}
        for (const ds of dataSeries) vars[ds.id] = maps[ds.id]?.get(date) ?? null
        const v = evaluateFormula(s.formula!, vars)
        return v == null ? null : { date, value: v }
      })
      .filter(Boolean) as { date: string; value: number }[]
  } else {
    raw = s.data.filter((d) => d.value != null) as { date: string; value: number }[]
  }

  if (raw.length === 0) return []

  if (normalizeAll || s.normalize) {
    const base = raw[0].value
    if (base !== 0) raw = raw.map((d) => ({ ...d, value: ((d.value - base) / base) * 100 }))
  }

  return raw.map((d) => ({ time: d.date as Time, value: d.value }))
}

export default function ChartOverlay({ series, normalizeAll }: Props) {
  const containerRef  = useRef<HTMLDivElement>(null)
  const chartRef      = useRef<IChartApi | null>(null)
  const seriesMapRef  = useRef<Map<string, AnySeriesApi>>(new Map())
  const tooltipRef    = useRef<HTMLDivElement>(null)
  const seriesCfgRef  = useRef(series)
  const normalizeRef  = useRef(normalizeAll)

  // Keep refs in sync without re-running effects
  useEffect(() => { seriesCfgRef.current = series }, [series])
  useEffect(() => { normalizeRef.current = normalizeAll }, [normalizeAll])

  // ── Init chart once ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current) return

    const chart = createChart(containerRef.current, {
      width:  containerRef.current.clientWidth,
      height: containerRef.current.clientHeight,
      layout: {
        background:  { color: '#030712' },
        textColor:   '#9ca3af',
        fontFamily:  'system-ui, -apple-system, sans-serif',
        fontSize:    11,
      },
      grid: {
        vertLines: { color: '#1f2937' },
        horzLines: { color: '#1f2937' },
      },
      crosshair: {
        vertLine: { color: '#6b7280', labelBackgroundColor: '#374151' },
        horzLine: { color: '#6b7280', labelBackgroundColor: '#374151' },
      },
      timeScale: {
        borderColor:    '#374151',
        timeVisible:    false,
        secondsVisible: false,
      },
      rightPriceScale: { borderColor: '#374151', visible: true,  title: '殖利率 (%)' },
      leftPriceScale:  { borderColor: '#374151', visible: false, title: '價格' },
      handleScroll: { pressedMouseMove: true, mouseWheel: true, horzTouchDrag: true },
      handleScale:  { mouseWheel: true, pinch: true, axisPressedMouseMove: true },
    })

    chartRef.current = chart

    // Responsive resize
    const ro = new ResizeObserver(([entry]) => {
      chart.applyOptions({
        width:  entry.contentRect.width,
        height: entry.contentRect.height,
      })
    })
    ro.observe(containerRef.current)

    return () => {
      ro.disconnect()
      chart.remove()
      chartRef.current = null
    }
  }, [])

  // ── Crosshair tooltip (re-subscribe when series/normalize changes) ───────
  useEffect(() => {
    const chart = chartRef.current
    if (!chart) return

    const handler = (param: MouseEventParams) => {
      const tooltip = tooltipRef.current
      if (!tooltip) return

      if (!param.time || !param.point || param.point.x < 0) {
        tooltip.style.opacity = '0'
        return
      }

      const date = param.time as string
      let html = `<div style="color:#9ca3af;font-size:11px;margin-bottom:6px">${date}</div>`

      for (const [id, lwcSeries] of seriesMapRef.current) {
        const pt = param.seriesData.get(lwcSeries) as { value?: number } | undefined
        if (pt?.value == null) continue
        const cfg = seriesCfgRef.current.find((s) => s.id === id)
        if (!cfg || cfg.visible === false) continue
        const v   = pt.value
        const nor = normalizeRef.current || cfg.normalize
        const fmt = nor
          ? `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`
          : v >= 1000
            ? v.toLocaleString(undefined, { maximumFractionDigits: 2 })
            : v.toFixed(4)
        html += `
          <div style="display:flex;align-items:center;gap:8px;font-size:12px;margin-bottom:3px">
            <span style="width:8px;height:8px;border-radius:50%;background:${cfg.color};flex-shrink:0"></span>
            <span style="color:#d1d5db;flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${cfg.label}</span>
            <span style="color:#fff;font-family:monospace;margin-left:8px">${fmt}</span>
          </div>`
      }

      tooltip.innerHTML = html
      tooltip.style.opacity = '1'
    }

    chart.subscribeCrosshairMove(handler)
    return () => { chart.unsubscribeCrosshairMove(handler) }
  }, [series, normalizeAll])

  // ── Rebuild all series when data/options change ──────────────────────────
  useEffect(() => {
    const chart = chartRef.current
    if (!chart) return

    // Remove previous
    for (const s of seriesMapRef.current.values()) {
      try { chart.removeSeries(s) } catch { /* ignore if already removed */ }
    }
    seriesMapRef.current.clear()

    const hasLeft  = !normalizeAll && series.some((s) => s.axis === 'left')
    const hasRight = !normalizeAll && series.some((s) => s.axis === 'right')
    chart.applyOptions({
      leftPriceScale:  { visible: hasLeft,              title: hasLeft  ? '價格'       : '' },
      rightPriceScale: { visible: hasRight || normalizeAll, title: normalizeAll ? '% 變化' : hasRight ? '殖利率 (%)' : '' },
    })

    let anyAdded = false

    for (const s of series) {
      if (s.loading) continue
      if (s.visible === false) continue
      const data = buildData(s, series, normalizeAll)
      if (data.length === 0) continue

      const scaleId = normalizeAll ? 'right' : s.axis
      const base    = { priceScaleId: scaleId, lastValueVisible: false, priceLineVisible: false }

      let lwcSeries: AnySeriesApi

      if (s.chartType === 'area') {
        lwcSeries = chart.addSeries(AreaSeries, {
          ...base,
          lineColor:    s.color,
          topColor:     s.color + '33',
          bottomColor:  s.color + '08',
          lineWidth:    2,
        })
      } else if (s.chartType === 'bar') {
        lwcSeries = chart.addSeries(HistogramSeries, {
          ...base,
          color: s.color + 'bf',
        })
      } else {
        lwcSeries = chart.addSeries(LineSeries, {
          ...base,
          color:     s.color,
          lineWidth: 2,
        })
      }

      lwcSeries.setData(data)
      seriesMapRef.current.set(s.id, lwcSeries)
      anyAdded = true
    }

    if (anyAdded) chart.timeScale().fitContent()
  }, [series, normalizeAll])

  // ── Zoom controls ────────────────────────────────────────────────────────
  const zoomIn = useCallback(() => {
    const r = chartRef.current?.timeScale().getVisibleLogicalRange()
    if (!r) return
    const half = (r.to - r.from) * 0.35
    const mid  = (r.from + r.to) / 2
    chartRef.current!.timeScale().setVisibleLogicalRange({ from: mid - half, to: mid + half })
  }, [])

  const zoomOut = useCallback(() => {
    const r = chartRef.current?.timeScale().getVisibleLogicalRange()
    if (!r) return
    const half = (r.to - r.from) * 0.65
    const mid  = (r.from + r.to) / 2
    chartRef.current!.timeScale().setVisibleLogicalRange({ from: mid - half, to: mid + half })
  }, [])

  const resetZoom = useCallback(() => {
    chartRef.current?.timeScale().fitContent()
  }, [])

  const isEmpty = !series.some(
    (s) => !s.loading && (s.data.length > 0 || s.type === 'formula'),
  )

  return (
    <div className="relative w-full h-full">
      {isEmpty && (
        <div className="absolute inset-0 flex items-center justify-center text-gray-500 text-sm pointer-events-none z-10">
          請從左側新增指標
        </div>
      )}

      {/* LWC container */}
      <div ref={containerRef} className="w-full h-full" />

      {/* Tooltip */}
      <div
        ref={tooltipRef}
        className="absolute top-3 left-16 pointer-events-none opacity-0 transition-opacity"
        style={{
          zIndex: 10,
          background: 'rgba(17,24,39,0.92)',
          border: '1px solid #374151',
          borderRadius: 8,
          padding: '8px 12px',
          minWidth: 180,
          backdropFilter: 'blur(4px)',
        }}
      />

      {/* Zoom controls */}
      {!isEmpty && (
        <div className="absolute top-3 right-3 flex gap-1" style={{ zIndex: 10 }}>
          <button
            onClick={zoomIn}
            className="w-7 h-7 bg-gray-800/80 hover:bg-gray-700 text-gray-300 rounded text-base font-bold transition-colors"
          >+</button>
          <button
            onClick={zoomOut}
            className="w-7 h-7 bg-gray-800/80 hover:bg-gray-700 text-gray-300 rounded text-base font-bold transition-colors"
          >−</button>
          <button
            onClick={resetZoom}
            className="px-2 h-7 bg-gray-800/80 hover:bg-gray-700 text-gray-400 rounded text-xs transition-colors"
          >全覽</button>
        </div>
      )}
    </div>
  )
}
