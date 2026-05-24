'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { createChart, LineSeries, IChartApi, ISeriesApi, Time } from 'lightweight-charts'

// 集保大戶佔比趨勢（內部大戶概念）。資料來自 /api/chips（TDCC 15 級距週資料）。
// 可自訂「價格區間 → 幾張算大戶」(可加區間)，依股價挑門檻；門檻對齊集保級距邊界。

interface ChipsResp {
  code: string
  weeks: number
  tierLots: number[]            // 15 個級距的「≥張數」下界
  series: { date: string; tiers: number[] }[]
}
interface Band { maxPrice: number | null; lots: number } // maxPrice=null → 以上（無上界）

const LOT_OPTIONS = [50, 100, 200, 400, 600, 800, 1000]
const DEFAULT_BANDS: Band[] = [{ maxPrice: 50, lots: 1000 }, { maxPrice: null, lots: 400 }]
const BANDS_KEY = 'chips_bands_v1'

const ymd = (d: string) => `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`

/** 依張數門檻，把 ≥ 該張數的級距佔比加總 */
function bigHolderPct(tiers: number[], tierLots: number[], lots: number): number {
  let sum = 0
  for (let i = 0; i < tiers.length; i++) if (tierLots[i] >= lots) sum += tiers[i] || 0
  return +sum.toFixed(2)
}
/** 依股價挑出對應區間的張數門檻 */
function pickLots(bands: Band[], price: number): number {
  for (const b of bands) if (b.maxPrice == null || price <= b.maxPrice) return b.lots
  return bands[bands.length - 1]?.lots ?? 400
}

export default function ChipsView() {
  const [input, setInput]     = useState('')
  const [data, setData]       = useState<ChipsResp | null>(null)
  const [price, setPrice]     = useState<number | null>(null)
  const [foreignByDate, setForeignByDate] = useState<Record<string, number | null>>({}) // 逐週外資持股%（官方）
  const [subForeign, setSubForeign] = useState(true)                // 是否扣外資
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState<string | null>(null)
  const [bands, setBands]     = useState<Band[]>(() => {
    if (typeof window === 'undefined') return DEFAULT_BANDS
    try { const r = localStorage.getItem(BANDS_KEY); return r ? JSON.parse(r) : DEFAULT_BANDS } catch { return DEFAULT_BANDS }
  })

  useEffect(() => { try { localStorage.setItem(BANDS_KEY, JSON.stringify(bands)) } catch { /* ignore */ } }, [bands])

  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef     = useRef<IChartApi | null>(null)
  const seriesRef    = useRef<ISeriesApi<'Line'> | null>(null)

  // 查詢：抓 chips + 股價
  const query = useCallback(async (raw: string) => {
    const code = raw.trim()
    if (!/^\d{4}$/.test(code)) { setError('請輸入 4 位數台股代號'); return }
    setLoading(true); setError(null); setForeignByDate({})
    try {
      const [cRes, sRes] = await Promise.all([
        fetch(`/api/chips?ticker=${code}`),
        fetch(`/api/stocks?ticker=${code}&range=1Y`),
      ])
      const cJson = await cRes.json()
      if (cJson.error) { setError(cJson.error); setData(null); return }
      setData(cJson)
      try {
        const sJson = await sRes.json()
        const arr = sJson.data as { value: number }[] | undefined
        setPrice(arr && arr.length ? arr[arr.length - 1].value : null)
      } catch { setPrice(null) }
      // 逐週外資持股%（官方 MI_QFIIS，全市場 per-date 快取）
      const dates = (cJson.series ?? []).map((w: { date: string }) => w.date)
      if (dates.length) {
        try { const fJson = await (await fetch(`/api/foreign?ticker=${code}&dates=${dates.join(',')}`)).json(); setForeignByDate(fJson.foreign ?? {}) }
        catch { setForeignByDate({}) }
      }
    } catch {
      setError('查詢失敗，請稍後再試')
    } finally { setLoading(false) }
  }, [])

  // 初始化圖表
  useEffect(() => {
    if (!containerRef.current) return
    const chart = createChart(containerRef.current, {
      width: containerRef.current.clientWidth, height: containerRef.current.clientHeight,
      layout: { background: { color: '#030712' }, textColor: '#9ca3af', fontFamily: 'system-ui, sans-serif', fontSize: 12 },
      grid: { vertLines: { color: '#1f2937' }, horzLines: { color: '#1f2937' } },
      crosshair: { vertLine: { color: '#6b7280', labelBackgroundColor: '#374151' }, horzLine: { color: '#6b7280', labelBackgroundColor: '#374151' } },
      timeScale: { borderColor: '#374151', timeVisible: false },
      rightPriceScale: { borderColor: '#374151' },
    })
    chartRef.current = chart
    seriesRef.current = chart.addSeries(LineSeries, { color: '#fbbf24', lineWidth: 2, priceFormat: { type: 'custom', minMove: 0.01, formatter: (v: number) => `${v.toFixed(2)}%` } })
    const ro = new ResizeObserver(([e]) => chart.applyOptions({ width: e.contentRect.width, height: e.contentRect.height }))
    ro.observe(containerRef.current)
    return () => { ro.disconnect(); chart.remove(); chartRef.current = null; seriesRef.current = null }
  }, [])

  // 依資料 + 門檻 + 逐週扣外資 重繪
  const activeLots = price != null ? pickLots(bands, price) : bands[bands.length - 1]?.lots ?? 400
  const effPct = useCallback((w: { date: string; tiers: number[] }): number => {
    const big = bigHolderPct(w.tiers, data!.tierLots, activeLots)
    const f = subForeign ? (foreignByDate[w.date] ?? 0) : 0
    return +(big - f).toFixed(2)
  }, [data, activeLots, subForeign, foreignByDate])

  useEffect(() => {
    const s = seriesRef.current
    if (!s || !data) return
    s.setData(data.series.map(w => ({ time: ymd(w.date) as Time, value: effPct(w) })))
    chartRef.current?.timeScale().fitContent()
  }, [data, effPct])

  // 統計：最新 + 週對週（扣外資後）
  const series = data?.series ?? []
  const latestPct = series.length ? effPct(series[series.length - 1]) : null
  const prevPct   = series.length > 1 ? effPct(series[series.length - 2]) : null
  const wow = latestPct != null && prevPct != null ? +(latestPct - prevPct).toFixed(2) : null
  const latestForeign = series.length ? foreignByDate[series[series.length - 1].date] : null

  const setBand = (i: number, patch: Partial<Band>) => setBands(bs => bs.map((b, j) => j === i ? { ...b, ...patch } : b))
  const addBand = () => setBands(bs => {
    const last = bs[bs.length - 1]
    const newMax = last.maxPrice == null ? 100 : last.maxPrice + 100
    return [...bs.slice(0, -1), { maxPrice: newMax, lots: last.lots }, { maxPrice: null, lots: last.lots }]
  })
  const removeBand = (i: number) => setBands(bs => bs.length <= 1 ? bs : bs.filter((_, j) => j !== i))

  return (
    <div className="h-full flex flex-col gap-3 p-3 overflow-y-auto">
      {/* 查詢列 */}
      <div className="flex items-center gap-2 flex-wrap">
        <input value={input} onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && query(input)}
          placeholder="輸入台股代號，如 2330"
          className="w-44 bg-gray-800 text-gray-200 text-sm rounded-lg px-3 py-2 border border-gray-700 focus:outline-none focus:border-amber-500" />
        <button onClick={() => query(input)} disabled={loading}
          className="text-sm px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white transition-colors">
          {loading ? '爬取中…(首次約數秒)' : '查詢'}
        </button>
        {data && <span className="text-sm text-gray-400">{data.code}　股價 {price ?? '—'}　大戶門檻：≥ <b className="text-amber-300">{activeLots}</b> 張（{data.weeks} 週）</span>}
        {error && <span className="text-sm text-red-400">{error}</span>}
      </div>

      {/* 價格區間 → 張數門檻 設定 */}
      <div className="bg-gray-900 border border-gray-800 rounded-lg p-3">
        <div className="text-xs text-gray-400 mb-2">自訂「股價區間 → 幾張算大戶」（門檻對齊集保級距：{LOT_OPTIONS.join('/')} 張）</div>
        <div className="flex flex-col gap-1.5">
          {bands.map((b, i) => {
            const lo = i === 0 ? 0 : (bands[i - 1].maxPrice ?? 0)
            return (
              <div key={i} className="flex items-center gap-2 text-sm">
                <span className="text-gray-500">股價</span>
                <span className="text-gray-300 w-28">{lo} ~ {b.maxPrice == null ? '以上' : b.maxPrice} 元</span>
                {b.maxPrice != null && (
                  <input type="number" value={b.maxPrice} onChange={e => setBand(i, { maxPrice: parseFloat(e.target.value) || 0 })}
                    className="w-20 bg-gray-800 text-gray-200 rounded px-2 py-1 border border-gray-700 text-xs" />
                )}
                <span className="text-gray-500">→ ≥</span>
                <select value={b.lots} onChange={e => setBand(i, { lots: parseInt(e.target.value) })}
                  className="bg-gray-800 text-amber-300 rounded px-2 py-1 border border-gray-700 text-xs">
                  {LOT_OPTIONS.map(l => <option key={l} value={l}>{l} 張</option>)}
                </select>
                {bands.length > 1 && (
                  <button onClick={() => removeBand(i)} className="text-gray-500 hover:text-red-400 text-base leading-none px-1">✕</button>
                )}
              </div>
            )
          })}
        </div>
        <button onClick={addBand} className="mt-2 text-xs px-2 py-1 rounded bg-gray-800 border border-gray-700 text-gray-300 hover:border-gray-500">＋ 加區間</button>
      </div>

      {/* 統計 + 扣外資 */}
      {latestPct != null && (
        <div className="flex items-center gap-x-6 gap-y-1.5 text-sm flex-wrap">
          <span className="text-gray-400">最新{subForeign && latestForeign != null ? '內部' : ''}大戶佔比 <b className="text-amber-300 text-lg">{latestPct}%</b></span>
          {wow != null && (
            <span className="text-gray-400">週對週 <b style={{ color: wow > 0 ? '#f87171' : wow < 0 ? '#4ade80' : '#9ca3af' }}>{wow > 0 ? '+' : ''}{wow}%</b></span>
          )}
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input type="checkbox" checked={subForeign} onChange={e => setSubForeign(e.target.checked)} className="accent-amber-500" />
            <span className="text-gray-300">扣外資（逐週·官方）</span>
            {latestForeign != null
              ? <span className="text-gray-500">最新 {latestForeign}%</span>
              : <span className="text-gray-600">（上櫃/查無，未扣）</span>}
          </label>
          <span className="text-xs text-gray-600">※ 投信/自營為估算、暫未扣（之後補）</span>
        </div>
      )}

      {/* 趨勢圖 */}
      <div className="flex-1 min-h-[300px] relative">
        {!data && !loading && (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-500 text-sm gap-2 pointer-events-none">
            <span>輸入股號查詢大戶持股趨勢</span>
            <span className="text-xs text-gray-600">資料來自集保戶股權分散表（每週五更新），首次查詢會即時爬取約 1 年週資料</span>
          </div>
        )}
        <div ref={containerRef} className="w-full h-full" />
      </div>
    </div>
  )
}
