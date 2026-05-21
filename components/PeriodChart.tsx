'use client'

import { useEffect, useRef, useCallback } from 'react'
import {
  createChart, LineSeries, IChartApi, ISeriesApi, SeriesType, Time, MouseEventParams,
} from 'lightweight-charts'
import { PeriodSegment } from '@/lib/types'

interface Props {
  segments: PeriodSegment[]
}

type AnySeriesApi = ISeriesApi<SeriesType>

// Map segment data to relative x-axis starting from a fixed reference date
// Each trading day i → reference + i calendar days
const REF = '2020-01-01'
function refDate(dayIndex: number): string {
  const d = new Date(REF + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + dayIndex)
  return d.toISOString().split('T')[0]
}
function dayIndex(dateStr: string): number {
  const ref = new Date(REF + 'T00:00:00Z').getTime()
  const d   = new Date(dateStr + 'T00:00:00Z').getTime()
  return Math.round((d - ref) / 86400000)
}

function buildData(seg: PeriodSegment): { time: Time; value: number; origDate: string }[] {
  if (seg.data.length === 0) return []
  const base = seg.data[0].value
  if (!base) return []
  return seg.data.map((d, i) => ({
    time:     refDate(i) as Time,
    value:    parseFloat((((d.value - base) / base) * 100).toFixed(4)),
    origDate: d.date,
  }))
}

export default function PeriodChart({ segments }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef     = useRef<IChartApi | null>(null)
  const seriesMapRef = useRef<Map<string, AnySeriesApi>>(new Map())
  const tooltipRef   = useRef<HTMLDivElement>(null)
  const segsRef      = useRef(segments)
  // Store original date mapping per series: segId → string[]
  const origDatesRef = useRef<Map<string, string[]>>(new Map())

  useEffect(() => { segsRef.current = segments }, [segments])

  // Init chart once
  useEffect(() => {
    if (!containerRef.current) return
    const chart = createChart(containerRef.current, {
      width:  containerRef.current.clientWidth,
      height: containerRef.current.clientHeight,
      layout: { background: { color: '#030712' }, textColor: '#9ca3af', fontFamily: 'system-ui, sans-serif', fontSize: 11 },
      grid:   { vertLines: { color: '#1f2937' }, horzLines: { color: '#1f2937' } },
      crosshair: {
        vertLine: { color: '#6b7280', labelBackgroundColor: '#374151' },
        horzLine: { color: '#6b7280', labelBackgroundColor: '#374151' },
      },
      timeScale: {
        borderColor: '#374151',
        timeVisible: false,
        secondsVisible: false,
        tickMarkFormatter: (time: string) => {
          const idx = dayIndex(time)
          if (idx === 0) return '起點'
          if (idx < 7)  return `D+${idx}`
          if (idx < 30) return `W+${Math.floor(idx / 7)}`
          return `M+${Math.floor(idx / 30)}`
        },
      },
      rightPriceScale: { borderColor: '#374151', visible: true },
      leftPriceScale:  { borderColor: '#374151', visible: false },
      handleScroll: { pressedMouseMove: true, mouseWheel: true, horzTouchDrag: true },
      handleScale:  { mouseWheel: true, pinch: true, axisPressedMouseMove: true },
    })
    chartRef.current = chart

    const ro = new ResizeObserver(([entry]) => {
      chart.applyOptions({ width: entry.contentRect.width, height: entry.contentRect.height })
    })
    ro.observe(containerRef.current)

    return () => { ro.disconnect(); chart.remove(); chartRef.current = null }
  }, [])

  // Crosshair tooltip
  useEffect(() => {
    const chart = chartRef.current
    if (!chart) return
    const handler = (param: MouseEventParams) => {
      const tooltip = tooltipRef.current
      if (!tooltip) return
      if (!param.time || !param.point || param.point.x < 0) { tooltip.style.opacity = '0'; return }

      const idx  = dayIndex(param.time as string)
      let html = `<div style="color:#9ca3af;font-size:11px;margin-bottom:6px">起點後第 ${idx} 天</div>`

      for (const [id, lwcSeries] of seriesMapRef.current) {
        const pt = param.seriesData.get(lwcSeries) as { value?: number } | undefined
        if (pt?.value == null) continue
        const seg = segsRef.current.find((s) => s.id === id)
        if (!seg) continue
        const origDates = origDatesRef.current.get(id) ?? []
        const origDate  = origDates[idx] ?? ''
        const v = pt.value
        html += `
          <div style="display:flex;align-items:center;gap:8px;font-size:12px;margin-bottom:3px">
            <span style="width:8px;height:8px;border-radius:50%;background:${seg.color};flex-shrink:0"></span>
            <span style="color:#d1d5db;flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${seg.label}</span>
            <span style="color:#9ca3af;font-size:10px;margin-left:4px">${origDate}</span>
            <span style="color:${v >= 0 ? '#4ade80' : '#f87171'};font-family:monospace;margin-left:4px">${v >= 0 ? '+' : ''}${v.toFixed(2)}%</span>
          </div>`
      }

      tooltip.innerHTML = html
      tooltip.style.opacity = '1'
    }
    chart.subscribeCrosshairMove(handler)
    return () => { chart.unsubscribeCrosshairMove(handler) }
  }, [segments])

  // Rebuild series
  useEffect(() => {
    const chart = chartRef.current
    if (!chart) return

    for (const s of seriesMapRef.current.values()) {
      try { chart.removeSeries(s) } catch { /* ignore */ }
    }
    seriesMapRef.current.clear()
    origDatesRef.current.clear()

    let anyAdded = false
    for (const seg of segments) {
      if (seg.loading || seg.visible === false) continue
      const pts = buildData(seg)
      if (pts.length === 0) continue

      // Store original date mapping (index → original date)
      const origMap: string[] = []
      pts.forEach((p, i) => { origMap[i] = p.origDate })
      origDatesRef.current.set(seg.id, origMap)

      const lwcSeries = chart.addSeries(LineSeries, {
        priceScaleId: 'right',
        color:     seg.color,
        lineWidth: 2,
        lastValueVisible: false,
        priceLineVisible: false,
      })
      lwcSeries.setData(pts.map(({ time, value }) => ({ time, value })))
      seriesMapRef.current.set(seg.id, lwcSeries)
      anyAdded = true
    }
    if (anyAdded) chart.timeScale().fitContent()
  }, [segments])

  const zoomIn   = useCallback(() => {
    const r = chartRef.current?.timeScale().getVisibleLogicalRange()
    if (!r) return
    const half = (r.to - r.from) * 0.35, mid = (r.from + r.to) / 2
    chartRef.current!.timeScale().setVisibleLogicalRange({ from: mid - half, to: mid + half })
  }, [])
  const zoomOut  = useCallback(() => {
    const r = chartRef.current?.timeScale().getVisibleLogicalRange()
    if (!r) return
    const half = (r.to - r.from) * 0.65, mid = (r.from + r.to) / 2
    chartRef.current!.timeScale().setVisibleLogicalRange({ from: mid - half, to: mid + half })
  }, [])
  const resetZoom = useCallback(() => { chartRef.current?.timeScale().fitContent() }, [])

  const isEmpty = !segments.some((s) => !s.loading && s.data.length > 0 && s.visible !== false)

  return (
    <div className="relative w-full h-full">
      {isEmpty && (
        <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-500 text-sm pointer-events-none z-10 gap-2">
          <span>從左側新增時段</span>
          <span className="text-xs text-gray-600">所有時段起點對齊，以 % 變化比較走勢</span>
        </div>
      )}
      <div ref={containerRef} className="w-full h-full" />
      <div ref={tooltipRef}
        className="absolute top-3 left-16 pointer-events-none opacity-0 transition-opacity"
        style={{ zIndex: 10, background: 'rgba(17,24,39,0.92)', border: '1px solid #374151', borderRadius: 8, padding: '8px 12px', minWidth: 200, backdropFilter: 'blur(4px)' }} />
      {!isEmpty && (
        <div className="absolute top-3 right-3 flex gap-1" style={{ zIndex: 10 }}>
          <button onClick={zoomIn}  className="w-7 h-7 bg-gray-800/80 hover:bg-gray-700 text-gray-300 rounded text-base font-bold transition-colors">+</button>
          <button onClick={zoomOut} className="w-7 h-7 bg-gray-800/80 hover:bg-gray-700 text-gray-300 rounded text-base font-bold transition-colors">−</button>
          <button onClick={resetZoom} className="px-2 h-7 bg-gray-800/80 hover:bg-gray-700 text-gray-400 rounded text-xs transition-colors">全覽</button>
        </div>
      )}
      {/* X-axis label */}
      <div className="absolute bottom-8 left-1/2 -translate-x-1/2 pointer-events-none" style={{ zIndex: 10 }}>
        <span className="text-xs text-gray-600 bg-gray-950/80 px-2 py-0.5 rounded">X 軸：距起始日天數</span>
      </div>
    </div>
  )
}
