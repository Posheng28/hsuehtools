'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import dynamic from 'next/dynamic'
import SeriesPanel  from '@/components/SeriesPanel'
import PeriodPanel  from '@/components/PeriodPanel'
import DisposalTool from '@/components/DisposalTool'
import { SeriesConfig, DateRange, DATE_RANGE_LABELS, ChartType, PeriodSegment, COLORS } from '@/lib/types'

const ChartOverlay = dynamic(() => import('@/components/ChartOverlay'), { ssr: false })
const PeriodChart  = dynamic(() => import('@/components/PeriodChart'),  { ssr: false })

// ── Overlay mode persistence ──────────────────────────────────────────────
const STORAGE_KEY = 'chart-overlay-series'
const RANGE_KEY   = 'chart-overlay-range'
type SeriesSaved  = Omit<SeriesConfig, 'data' | 'loading' | 'error'>

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
  try { const raw = localStorage.getItem(STORAGE_KEY); return raw ? migrateSaved(JSON.parse(raw)) : [] }
  catch { return [] }
}

// ── Period mode persistence ───────────────────────────────────────────────
const PERIOD_KEY = 'chart-period-segments'
type SegSaved    = Omit<PeriodSegment, 'data' | 'loading' | 'error'>

function saveSegments(segs: PeriodSegment[]) {
  const saved: SegSaved[] = segs.map(({ data: _d, loading: _l, error: _e, ...rest }) => rest)
  localStorage.setItem(PERIOD_KEY, JSON.stringify(saved))
}
function loadSegments(): SegSaved[] {
  try { const raw = localStorage.getItem(PERIOD_KEY); return raw ? JSON.parse(raw) : [] }
  catch { return [] }
}

// ── Fetch helpers ─────────────────────────────────────────────────────────
async function fetchSeries(cfg: Omit<SeriesConfig, 'data' | 'loading'>, range: DateRange) {
  try {
    const url = cfg.type === 'stocks'
      ? `/api/stocks?ticker=${encodeURIComponent(cfg.ticker!)}&range=${range}`
      : `/api/fred?series=${encodeURIComponent(cfg.fredId!)}&range=${range}`
    const res  = await fetch(url)
    const json = await res.json()
    if (json.error) return { data: [] as { date: string; value: number }[], error: json.error as string }
    return { data: json.data as { date: string; value: number }[] }
  } catch (e) { return { data: [] as { date: string; value: number }[], error: e instanceof Error ? e.message : 'Failed to fetch' } }
}

async function fetchSegment(seg: SegSaved) {
  try {
    const url  = `/api/stocks?ticker=${encodeURIComponent(seg.ticker)}&from=${seg.from}&to=${seg.to}`
    const res  = await fetch(url)
    const json = await res.json()
    if (json.error) return { data: [] as { date: string; value: number }[], error: json.error as string }
    return { data: json.data as { date: string; value: number }[] }
  } catch (e) { return { data: [] as { date: string; value: number }[], error: e instanceof Error ? e.message : 'Failed to fetch' } }
}

// ─────────────────────────────────────────────────────────────────────────
export default function Home() {
  const [mode, setMode] = useState<'overlay' | 'period' | 'disposal'>('overlay')

  // ── Overlay state ──
  const [series, setSeries]             = useState<SeriesConfig[]>([])
  const [range, setRange]               = useState<DateRange>(() => {
    if (typeof window === 'undefined') return '2Y'
    return (localStorage.getItem(RANGE_KEY) as DateRange) || '2Y'
  })
  const [normalizeAll, setNormalizeAll] = useState(false)
  const [sidebarOpen, setSidebarOpen]   = useState(false)
  const [showHelp, setShowHelp]         = useState(false)
  const overlayHydrated                 = useRef(false)

  // ── Period state ──
  const [segments, setSegments]         = useState<PeriodSegment[]>([])
  const periodHydrated                  = useRef(false)

  // Save overlay
  useEffect(() => { if (!overlayHydrated.current) return; saveSeries(series) }, [series])

  // Restore overlay
  useEffect(() => {
    overlayHydrated.current = true
    const saved = loadSeries()
    if (saved.length === 0) return
    const restored: SeriesConfig[] = saved.map((s) => ({ ...s, visible: s.visible ?? true, data: [], loading: s.type !== 'formula' }))
    setSeries(restored)
    const r = (localStorage.getItem(RANGE_KEY) as DateRange) || '2Y'
    for (const s of saved) {
      if (s.type !== 'formula') {
        fetchSeries(s, r).then(({ data, error }) =>
          setSeries((prev) => prev.map((p) => p.id === s.id ? { ...p, data, loading: false, error } : p)))
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Save periods
  useEffect(() => { if (!periodHydrated.current) return; saveSegments(segments) }, [segments])

  // Restore periods
  useEffect(() => {
    periodHydrated.current = true
    const saved = loadSegments()
    if (saved.length === 0) return
    const restored: PeriodSegment[] = saved.map((s) => ({ ...s, visible: s.visible ?? true, data: [], loading: true }))
    setSegments(restored)
    for (const s of saved) {
      fetchSegment(s).then(({ data, error }) =>
        setSegments((prev) => prev.map((p) => p.id === s.id ? { ...p, data, loading: false, error } : p)))
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Overlay handlers ──
  const loadData = useCallback(async (cfg: Omit<SeriesConfig, 'data' | 'loading'>, r: DateRange) => {
    if (cfg.type === 'formula') return
    setSeries((prev) => prev.map((s) => s.id === cfg.id ? { ...s, loading: true, error: undefined } : s))
    const { data, error } = await fetchSeries(cfg, r)
    setSeries((prev) => prev.map((s) => s.id === cfg.id ? { ...s, data, loading: false, error } : s))
  }, [])

  const handleAdd = useCallback(async (cfg: Omit<SeriesConfig, 'data' | 'loading'>) => {
    setSeries((prev) => [...prev, { ...cfg, visible: true, data: [], loading: cfg.type !== 'formula' }])
    if (cfg.type !== 'formula') {
      const { data, error } = await fetchSeries(cfg, range)
      setSeries((prev) => prev.map((s) => s.id === cfg.id ? { ...s, data, loading: false, error } : s))
    }
  }, [range])

  const handleRemove          = useCallback((id: string) => setSeries((prev) => prev.filter((s) => s.id !== id)), [])
  const handleToggleVisible   = useCallback((id: string) => setSeries((prev) => prev.map((s) => s.id === id ? { ...s, visible: !s.visible } : s)), [])
  const handleToggleAxis      = useCallback((id: string) => setSeries((prev) => prev.map((s) => s.id === id ? { ...s, axis: s.axis === 'left' ? 'right' : 'left' } : s)), [])
  const handleToggleNormalize = useCallback((id: string) => setSeries((prev) => prev.map((s) => s.id === id ? { ...s, normalize: !s.normalize } : s)), [])
  const handleColorChange     = useCallback((id: string, color: string) => setSeries((prev) => prev.map((s) => s.id === id ? { ...s, color } : s)), [])
  const handleChartTypeChange = useCallback((id: string, chartType: ChartType) => setSeries((prev) => prev.map((s) => s.id === id ? { ...s, chartType } : s)), [])
  const handleRangeChange     = useCallback((newRange: DateRange) => {
    setRange(newRange); localStorage.setItem(RANGE_KEY, newRange)
    series.forEach((s) => loadData(s, newRange))
  }, [series, loadData])

  // ── Period handlers ──
  const handleAddSegment = useCallback(async (seg: Omit<PeriodSegment, 'data' | 'loading'>) => {
    setSegments((prev) => [...prev, { ...seg, data: [], loading: true }])
    const { data, error } = await fetchSegment(seg)
    setSegments((prev) => prev.map((s) => s.id === seg.id ? { ...s, data, loading: false, error } : s))
  }, [])

  const handleUpdateSegment = useCallback(async (id: string, patch: Partial<SegSaved>) => {
    const cur = segments.find((s) => s.id === id)
    if (!cur) return
    const needRefetch = 'ticker' in patch || 'from' in patch || 'to' in patch
    const merged = { ...cur, ...patch }
    setSegments((prev) => prev.map((s) => s.id === id
      ? { ...merged, data: s.data, loading: needRefetch, error: needRefetch ? undefined : s.error }
      : s))
    if (needRefetch) {
      const { data, error } = await fetchSegment(merged)
      setSegments((prev) => prev.map((s) => s.id === id ? { ...s, data, loading: false, error } : s))
    }
  }, [segments])

  const handleRemoveSegment        = useCallback((id: string) => setSegments((prev) => prev.filter((s) => s.id !== id)), [])
  const handleToggleSegmentVisible = useCallback((id: string) => setSegments((prev) => prev.map((s) => s.id === id ? { ...s, visible: !s.visible } : s)), [])
  const handleSegmentColorChange   = useCallback((id: string, color: string) => setSegments((prev) => prev.map((s) => s.id === id ? { ...s, color } : s)), [])

  const anyLoading = series.some((s) => s.loading)

  return (
    <div className="flex h-screen bg-gray-950 text-gray-100 overflow-hidden">

      {sidebarOpen && (
        <div className="fixed inset-0 bg-black/60 z-20 lg:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      {mode !== 'disposal' && (
        <div className={`fixed inset-y-0 left-0 z-30 flex transition-transform duration-300 ease-in-out lg:static lg:translate-x-0 lg:z-auto ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}>
          {mode === 'overlay' ? (
            <SeriesPanel series={series} onAdd={handleAdd} onRemove={handleRemove}
              onToggleVisible={handleToggleVisible} onToggleAxis={handleToggleAxis}
              onToggleNormalize={handleToggleNormalize} onColorChange={handleColorChange}
              onChartTypeChange={handleChartTypeChange} onClose={() => setSidebarOpen(false)} />
          ) : (
            <PeriodPanel segments={segments} onAdd={handleAddSegment} onRemove={handleRemoveSegment}
              onToggleVisible={handleToggleSegmentVisible} onColorChange={handleSegmentColorChange}
              onUpdate={handleUpdateSegment} onClose={() => setSidebarOpen(false)} />
          )}
        </div>
      )}

      <main className="flex-1 flex flex-col overflow-hidden min-w-0">
        <header className="flex items-center justify-between px-3 py-2 border-b border-gray-800 shrink-0 gap-2">

          <div className="flex items-center gap-2 shrink-0">
            <button onClick={() => setSidebarOpen((v) => !v)}
              className="lg:hidden w-8 h-8 flex flex-col items-center justify-center gap-1.5 rounded text-gray-400 hover:text-gray-200 hover:bg-gray-800 transition-colors">
              <span className="w-5 h-0.5 bg-current rounded" />
              <span className="w-5 h-0.5 bg-current rounded" />
              <span className="w-5 h-0.5 bg-current rounded" />
            </button>

            {/* Mode toggle */}
            <div className="flex rounded-lg overflow-hidden border border-gray-700 shrink-0">
              <button onClick={() => setMode('overlay')}
                className={`text-xs px-3 py-1.5 transition-colors ${mode === 'overlay' ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-gray-200'}`}>
                疊加圖表
              </button>
              <button onClick={() => setMode('period')}
                className={`text-xs px-3 py-1.5 transition-colors ${mode === 'period' ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-gray-200'}`}>
                時段比較
              </button>
              <button onClick={() => setMode('disposal')}
                className={`text-xs px-3 py-1.5 transition-colors ${mode === 'disposal' ? 'bg-orange-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-gray-200'}`}>
                注意/處置
              </button>
            </div>

            {anyLoading && mode === 'overlay' && <span className="text-xs text-gray-400 animate-pulse">載入中…</span>}
            {segments.some((s) => s.loading) && mode === 'period' && <span className="text-xs text-gray-400 animate-pulse">載入中…</span>}
            {mode === 'disposal' && <span className="text-xs text-orange-400/70">台股注意 / 處置推演</span>}
          </div>

          <div className="flex items-center gap-1.5 flex-wrap justify-end">
            <button onClick={() => setShowHelp(true)}
              className="text-xs px-2 py-1.5 rounded-lg bg-gray-800 border border-gray-700 text-gray-300 hover:border-gray-500 transition-colors whitespace-nowrap">
              使用說明
            </button>
            {mode === 'overlay' && (
              <>
                <button onClick={() => setNormalizeAll((v) => !v)}
                  className={`text-xs px-2 py-1.5 rounded-lg transition-colors border whitespace-nowrap
                    ${normalizeAll ? 'bg-green-700/40 border-green-600 text-green-300' : 'bg-gray-800 border-gray-700 text-gray-300 hover:border-gray-600'}`}>
                  {normalizeAll ? '% 變化' : '原始值'}
                </button>
                <div className="flex gap-1">
                  {(Object.keys(DATE_RANGE_LABELS) as DateRange[]).map((r) => (
                    <button key={r} onClick={() => handleRangeChange(r)}
                      className={`text-xs px-2.5 py-1.5 rounded-lg transition-colors whitespace-nowrap
                        ${range === r ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'}`}>
                      {DATE_RANGE_LABELS[r]}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </header>

        <div className="flex-1 min-h-0 overflow-hidden">
          {mode === 'overlay' && (
            <div className="p-2 h-full">
              <ChartOverlay series={series} normalizeAll={normalizeAll} />
            </div>
          )}
          {mode === 'period' && (
            <div className="p-2 h-full">
              <PeriodChart segments={segments} />
            </div>
          )}
          {mode === 'disposal' && (
            <DisposalTool sidebarOpen={sidebarOpen} onCloseSidebar={() => setSidebarOpen(false)} />
          )}
        </div>
      </main>

      {/* Help modal */}
      {showHelp && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70" onClick={() => setShowHelp(false)}>
          <div className="bg-gray-900 border border-gray-700 rounded-xl w-full max-w-lg max-h-[85vh] overflow-y-auto shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800 sticky top-0 bg-gray-900">
              <h2 className="text-base font-semibold text-white">使用說明</h2>
              <button onClick={() => setShowHelp(false)} className="text-gray-500 hover:text-gray-200 text-xl leading-none transition-colors">✕</button>
            </div>
            <div className="px-5 py-4 space-y-5 text-sm text-gray-300">
              <p className="text-gray-400 leading-relaxed border-l-2 border-blue-500 pl-3">
                三種模式（右上角切換）：<span className="text-gray-200">疊加圖表</span>（台美股 + 經濟數據疊加，看連動）、<span className="text-gray-200">時段比較</span>（不同期間起點對齊比走勢）、<span className="text-gray-200">注意/處置</span>（台股監視制度推演）。
              </p>
              <section>
                <h3 className="text-white font-semibold mb-2">疊加圖表模式</h3>
                <ul className="space-y-1.5 text-gray-400">
                  <li>• 點左上角 ☰ 開啟側欄</li>
                  <li>• <span className="text-gray-200">預設指標</span>：點分類名稱展開，點指標名稱加入</li>
                  <li>• <span className="text-gray-200">自訂代碼</span>：美股輸入 <code className="bg-gray-800 px-1 rounded text-xs">AAPL</code>、台股輸入四位數字 <code className="bg-gray-800 px-1 rounded text-xs">2330</code>（自動判斷上市/上櫃）</li>
                  <li>• <span className="text-gray-200">四則運算</span>：用已加入的指標 ID 組合公式，例如 <code className="bg-gray-800 px-1 rounded text-xs">US10Y - US2Y</code></li>
                </ul>
              </section>
              <section>
                <h3 className="text-white font-semibold mb-2">時段比較模式</h3>
                <ul className="space-y-1.5 text-gray-400">
                  <li>• 輸入代碼 + 開始/結束日期，加入時段</li>
                  <li>• 所有時段的 <span className="text-gray-200">起點對齊</span>，以 % 變化顯示</li>
                  <li>• 可比較同一股票不同時期，或不同股票同一時期</li>
                  <li>• X 軸顯示距起始日天數（D+N / W+N / M+N）</li>
                  <li>• 卡片 <code className="bg-gray-800 px-1 rounded text-xs">✎</code> 編輯：就地改代碼/名稱/起迄（預填現值，可只改日期）；<code className="bg-gray-800 px-1 rounded text-xs">⧉</code> 複製：複製一張並立刻編輯，快速產生同標的不同時段</li>
                  <li>• 📅 年份快選、🕘 歷史紀錄（自動保存，重整仍在）</li>
                </ul>
              </section>

              <section>
                <h3 className="text-white font-semibold mb-2">注意/處置推演模式</h3>
                <ul className="space-y-1.5 text-gray-400">
                  <li>• 模擬未來股價，推估會不會被台股列「<span className="text-gray-200">注意</span>」或「<span className="text-gray-200">處置</span>」</li>
                  <li>• 輸入股號（如 <code className="bg-gray-800 px-1 rounded text-xs">2330</code>、<code className="bg-gray-800 px-1 rounded text-xs">3105</code>）匯入 → 自動帶入近 6 日收盤、歷史注意/處置紀錄、市場別</li>
                  <li>• <span className="text-gray-200">拖滑桿或輸入價格</span>模擬每日收盤；卡片即時顯示 vs 基準累積漲幅與日內漲跌</li>
                  <li>• 配色：<span className="text-red-400">🔴 款一①</span>（純價格，上市&gt;32%/上櫃&gt;30%）、<span className="text-red-300">🔴 款一②</span>（價格+價差，&gt;25%/23% 且起迄差≥50/40元）、<span className="text-yellow-400">🟡 款二</span>（長窗口倍漲）、<span className="text-green-400">🟢 無注意</span></li>
                  <li>• <span className="text-gray-200">差幅條件</span>：除了價格，還要「漲幅 − 全體市場近 6 日平均 ≥ 20%」才算注意，門檻已自動納入（大盤越熱門檻越高）</li>
                  <li>• <span className="text-gray-200">處置</span>：連 3 日款一 / 連 5 日 / 10 日內 6 日 / 30 日內 12 日 → 處置</li>
                  <li>• <code className="bg-gray-800 px-1 rounded text-xs">📖 規則說明</code> 看完整法規門檻；<code className="bg-gray-800 px-1 rounded text-xs">🚨 查詢清單</code> 看全市場目前處置股</li>
                  <li className="text-amber-400/80">• 當日全體漲幅以 0% 估、同類差幅無產業資料未驗證 → 結果為「價格面推演參考」，非官方判定</li>
                </ul>
              </section>
              <section>
                <h3 className="text-white font-semibold mb-2">圖表操作（疊加 / 時段模式）</h3>
                <ul className="space-y-1.5 text-gray-400">
                  <li>• 滾輪 / 雙指捏合：縮放</li>
                  <li>• 拖拉：左右平移</li>
                  <li>• <code className="bg-gray-800 px-1 rounded text-xs">+</code> / <code className="bg-gray-800 px-1 rounded text-xs">−</code> 按鈕：縮放　　全覽：回到完整範圍</li>
                </ul>
              </section>
              <section>
                <h3 className="text-white font-semibold mb-2">指標設定（疊加模式）</h3>
                <ul className="space-y-1.5 text-gray-400">
                  <li>• 色塊：點擊更改顏色　　<code className="bg-gray-800 px-1 rounded text-xs">〰</code> <code className="bg-gray-800 px-1 rounded text-xs">◭</code> <code className="bg-gray-800 px-1 rounded text-xs">▊</code>：切換圖表類型</li>
                  <li>• 左軸 / 右軸：切換 Y 軸（建議股價左軸、殖利率右軸）</li>
                  <li>• %變化：相對起點的百分比，方便不同單位比較</li>
                  <li>• 👁 眼睛：隱藏/顯示　　× ：刪除指標</li>
                </ul>
              </section>
              <section>
                <h3 className="text-white font-semibold mb-2">其他</h3>
                <ul className="space-y-1.5 text-gray-400">
                  <li>• 右上角「原始值 / % 變化」：一鍵切換所有指標</li>
                  <li>• 時間範圍：1年 / 2年 / 5年</li>
                  <li>• 設定自動儲存，重整後恢復上次的指標與時段</li>
                </ul>
              </section>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
