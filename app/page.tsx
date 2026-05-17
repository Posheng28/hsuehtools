'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import dynamic from 'next/dynamic'
import SeriesPanel from '@/components/SeriesPanel'
import { SeriesConfig, DateRange, DATE_RANGE_LABELS, ChartType } from '@/lib/types'

const ChartOverlay = dynamic(() => import('@/components/ChartOverlay'), { ssr: false })

const STORAGE_KEY = 'chart-overlay-series'
const RANGE_KEY   = 'chart-overlay-range'

type SeriesSaved = Omit<SeriesConfig, 'data' | 'loading' | 'error'>

function saveSeries(series: SeriesConfig[]) {
  const saved: SeriesSaved[] = series.map(({ data: _d, loading: _l, error: _e, ...rest }) => rest)
  localStorage.setItem(STORAGE_KEY, JSON.stringify(saved))
}

const TICKER_MIGRATION: Record<string, string> = {
  '^spx': '^GSPC', '^ndx': '^NDX', '^ndq': '^NDX', '^dji': '^DJI',
  'soxx.us': 'SOXX', 'qqq.us': 'QQQ', 'qqq': 'QQQ',
}

function migrateSaved(items: SeriesSaved[]): SeriesSaved[] {
  return items.map((s) => {
    if (s.type === 'stocks' && s.ticker) {
      const mapped = TICKER_MIGRATION[s.ticker.toLowerCase()]
      if (mapped) return { ...s, ticker: mapped }
    }
    return s
  })
}

function loadSeries(): SeriesSaved[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    return migrateSaved(JSON.parse(raw))
  } catch { return [] }
}

async function fetchSeries(
  cfg: Omit<SeriesConfig, 'data' | 'loading'>,
  range: DateRange,
): Promise<{ data: { date: string; value: number }[]; error?: string }> {
  try {
    let url: string
    if (cfg.type === 'stocks') {
      url = `/api/stocks?ticker=${encodeURIComponent(cfg.ticker!)}&range=${range}`
    } else {
      url = `/api/fred?series=${encodeURIComponent(cfg.fredId!)}&range=${range}`
    }
    const res = await fetch(url)
    const json = await res.json()
    if (json.error) return { data: [], error: json.error }
    return { data: json.data }
  } catch (e) {
    return { data: [], error: e instanceof Error ? e.message : 'Failed to fetch' }
  }
}

export default function Home() {
  const [series, setSeries]           = useState<SeriesConfig[]>([])
  const [range, setRange]             = useState<DateRange>(() => {
    if (typeof window === 'undefined') return '2Y'
    return (localStorage.getItem(RANGE_KEY) as DateRange) || '2Y'
  })
  const [normalizeAll, setNormalizeAll] = useState(false)
  const [sidebarOpen, setSidebarOpen]   = useState(false)
  const hydrated = useRef(false)

  useEffect(() => {
    if (!hydrated.current) return
    saveSeries(series)
  }, [series])

  useEffect(() => {
    hydrated.current = true
    const saved = loadSeries()
    if (saved.length === 0) return
    const restored: SeriesConfig[] = saved.map((s) => ({
      ...s,
      visible: s.visible ?? true,
      data: [],
      loading: s.type !== 'formula',
    }))
    setSeries(restored)
    const r = (localStorage.getItem(RANGE_KEY) as DateRange) || '2Y'
    for (const s of saved) {
      if (s.type !== 'formula') {
        fetchSeries(s, r).then(({ data, error }) => {
          setSeries((prev) => prev.map((p) => p.id === s.id ? { ...p, data, loading: false, error } : p))
        })
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const loadData = useCallback(async (cfg: Omit<SeriesConfig, 'data' | 'loading'>, r: DateRange) => {
    if (cfg.type === 'formula') return
    setSeries((prev) => prev.map((s) => s.id === cfg.id ? { ...s, loading: true, error: undefined } : s))
    const { data, error } = await fetchSeries(cfg, r)
    setSeries((prev) => prev.map((s) => s.id === cfg.id ? { ...s, data, loading: false, error } : s))
  }, [])

  const handleToggleVisible = useCallback((id: string) => {
    setSeries((prev) => prev.map((s) => s.id === id ? { ...s, visible: !s.visible } : s))
  }, [])

  const handleAdd = useCallback(async (cfg: Omit<SeriesConfig, 'data' | 'loading'>) => {
    const newSeries: SeriesConfig = { ...cfg, visible: true, data: [], loading: cfg.type !== 'formula' && cfg.type !== undefined }
    setSeries((prev) => [...prev, newSeries])
    if (cfg.type !== 'formula') {
      const { data, error } = await fetchSeries(cfg, range)
      setSeries((prev) => prev.map((s) => s.id === cfg.id ? { ...s, data, loading: false, error } : s))
    }
  }, [range])

  const handleRemove = useCallback((id: string) => {
    setSeries((prev) => prev.filter((s) => s.id !== id))
  }, [])

  const handleToggleAxis = useCallback((id: string) => {
    setSeries((prev) => prev.map((s) =>
      s.id === id ? { ...s, axis: s.axis === 'left' ? 'right' : 'left' } : s
    ))
  }, [])

  const handleToggleNormalize = useCallback((id: string) => {
    setSeries((prev) => prev.map((s) => s.id === id ? { ...s, normalize: !s.normalize } : s))
  }, [])

  const handleColorChange = useCallback((id: string, color: string) => {
    setSeries((prev) => prev.map((s) => s.id === id ? { ...s, color } : s))
  }, [])

  const handleChartTypeChange = useCallback((id: string, chartType: ChartType) => {
    setSeries((prev) => prev.map((s) => s.id === id ? { ...s, chartType } : s))
  }, [])

  const handleRangeChange = useCallback((newRange: DateRange) => {
    setRange(newRange)
    localStorage.setItem(RANGE_KEY, newRange)
    series.forEach((s) => loadData(s, newRange))
  }, [series, loadData])

  const anyLoading = series.some((s) => s.loading)

  return (
    <div className="flex h-screen bg-gray-950 text-gray-100 overflow-hidden">

      {/* Mobile sidebar overlay backdrop */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/60 z-20 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar — fixed drawer on mobile, static on desktop */}
      <div className={`
        fixed inset-y-0 left-0 z-30 flex transition-transform duration-300 ease-in-out
        lg:static lg:translate-x-0 lg:z-auto
        ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
      `}>
        <SeriesPanel
          series={series}
          onAdd={handleAdd}
          onRemove={handleRemove}
          onToggleVisible={handleToggleVisible}
          onToggleAxis={handleToggleAxis}
          onToggleNormalize={handleToggleNormalize}
          onColorChange={handleColorChange}
          onChartTypeChange={handleChartTypeChange}
          onClose={() => setSidebarOpen(false)}
        />
      </div>

      <main className="flex-1 flex flex-col overflow-hidden min-w-0">
        <header className="flex items-center justify-between px-3 py-2 border-b border-gray-800 shrink-0 gap-2">

          {/* Left: hamburger + title */}
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => setSidebarOpen((v) => !v)}
              className="lg:hidden w-8 h-8 flex flex-col items-center justify-center gap-1.5 rounded text-gray-400 hover:text-gray-200 hover:bg-gray-800 transition-colors"
            >
              <span className="w-5 h-0.5 bg-current rounded" />
              <span className="w-5 h-0.5 bg-current rounded" />
              <span className="w-5 h-0.5 bg-current rounded" />
            </button>
            <h1 className="text-sm font-semibold text-white whitespace-nowrap">圖表疊加工具</h1>
            {anyLoading && <span className="text-xs text-gray-400 animate-pulse">載入中…</span>}
          </div>

          {/* Right: controls */}
          <div className="flex items-center gap-1.5 flex-wrap justify-end">
            <button
              onClick={() => setNormalizeAll((v) => !v)}
              className={`text-xs px-2 py-1.5 rounded-lg transition-colors border whitespace-nowrap
                ${normalizeAll
                  ? 'bg-green-700/40 border-green-600 text-green-300'
                  : 'bg-gray-800 border-gray-700 text-gray-300 hover:border-gray-600'}`}
            >
              {normalizeAll ? '% 變化' : '原始值'}
            </button>

            <div className="flex gap-1">
              {(Object.keys(DATE_RANGE_LABELS) as DateRange[]).map((r) => (
                <button key={r} onClick={() => handleRangeChange(r)}
                  className={`text-xs px-2.5 py-1.5 rounded-lg transition-colors whitespace-nowrap
                    ${range === r ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'}`}
                >
                  {DATE_RANGE_LABELS[r]}
                </button>
              ))}
            </div>
          </div>
        </header>

        <div className="flex-1 p-2 min-h-0">
          <ChartOverlay series={series} normalizeAll={normalizeAll} />
        </div>
      </main>
    </div>
  )
}
