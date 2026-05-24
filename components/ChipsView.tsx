'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { createChart, LineSeries, HistogramSeries, IChartApi, ISeriesApi, Time } from 'lightweight-charts'

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
  const [foreignByDate, setForeignByDate] = useState<Record<string, number | null>>({}) // 逐週外資持股%
  const [legalByDate, setLegalByDate]     = useState<Record<string, number | null>>({}) // 逐週三大法人持股%
  const [qfiiByDate, setQfiiByDate]     = useState<Record<string, number | null>>({}) // 外資持股(張)
  const [itByDate, setItByDate]         = useState<Record<string, number | null>>({}) // 投信持股(張)
  const [dealerByDate, setDealerByDate] = useState<Record<string, number | null>>({}) // 自營持股(張)
  const [subLegal, setSubLegal] = useState(true)                    // 是否扣三大法人
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
  const barTotalRef     = useRef<ISeriesApi<'Histogram'> | null>(null) // 外資+投信+自營（自營色，最底層繪）
  const barQiRef        = useRef<ISeriesApi<'Histogram'> | null>(null) // 外資+投信（投信色）
  const barQRef         = useRef<ISeriesApi<'Histogram'> | null>(null) // 外資（外資色，最上層）
  const barTooltipRef   = useRef<HTMLDivElement>(null)
  // tooltip 用：持有最新的逐日三者張數（init effect 只跑一次，需經 ref 取最新）
  const qByRef = useRef<Record<string, number | null>>({})
  const iByRef = useRef<Record<string, number | null>>({})
  const dByRef = useRef<Record<string, number | null>>({})
  useEffect(() => { qByRef.current = qfiiByDate; iByRef.current = itByDate; dByRef.current = dealerByDate }, [qfiiByDate, itByDate, dealerByDate])

  // 查詢：抓 chips + 股價
  const query = useCallback(async (raw: string) => {
    const code = raw.trim()
    if (!/^\d{4}$/.test(code)) { setError('請輸入 4 位數台股代號'); return }
    setLoading(true); setError(null); setForeignByDate({}); setLegalByDate({}); setQfiiByDate({}); setItByDate({}); setDealerByDate({})
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
      // 逐週三大法人持股%（DJ：外資官方近似 + 投信/自營估算，上市櫃通吃）
      const dates = (cJson.series ?? []).map((w: { date: string }) => w.date)
      if (dates.length) {
        try {
          const fJson = await (await fetch(`/api/foreign?ticker=${code}&dates=${dates.join(',')}`)).json()
          setForeignByDate(fJson.foreign ?? {}); setLegalByDate(fJson.legal ?? {})
          setQfiiByDate(fJson.qfiiLots ?? {}); setItByDate(fJson.itLots ?? {}); setDealerByDate(fJson.dealerLots ?? {})
        } catch { setForeignByDate({}); setLegalByDate({}); setQfiiByDate({}); setItByDate({}); setDealerByDate({}) }
      }
    } catch {
      setError('查詢失敗，請稍後再試')
    } finally { setLoading(false) }
  }, [])

  // 初始化圖表（單張：折線走右軸於上方、三色堆疊柱走左軸壓底部，疊在同一時間軸）
  useEffect(() => {
    if (!containerRef.current) return
    const chart = createChart(containerRef.current, {
      width: containerRef.current.clientWidth, height: containerRef.current.clientHeight,
      layout: { background: { color: '#030712' }, textColor: '#9ca3af', fontFamily: 'system-ui, sans-serif', fontSize: 12 },
      grid: { vertLines: { color: '#1f2937' }, horzLines: { color: '#1f2937' } },
      crosshair: { vertLine: { color: '#6b7280', labelBackgroundColor: '#374151' }, horzLine: { color: '#6b7280', labelBackgroundColor: '#374151' } },
      timeScale: { borderColor: '#374151', timeVisible: false },
      rightPriceScale: { borderColor: '#374151', scaleMargins: { top: 0.05, bottom: 0.42 } }, // 線(%)佔上方
      leftPriceScale: { borderColor: '#374151', visible: true, scaleMargins: { top: 0.62, bottom: 0 } }, // 柱(張)壓底部，數字走左軸
    })
    chartRef.current = chart
    const fmt = { type: 'custom' as const, minMove: 1, formatter: (v: number) => `${Math.round(v).toLocaleString()}張` }
    // 先畫柱（在底層），最後畫線（在最上層）
    // 堆疊技巧：總和(自營色)→外資+投信(投信色)→外資(外資色)，視覺由下而上=外資/投信/自營
    barTotalRef.current = chart.addSeries(HistogramSeries, { color: '#34d399', priceScaleId: 'left', priceFormat: fmt, priceLineVisible: false, lastValueVisible: false }) // 自營(綠)
    barQiRef.current    = chart.addSeries(HistogramSeries, { color: '#f59e0b', priceScaleId: 'left', priceFormat: fmt, priceLineVisible: false, lastValueVisible: false }) // 投信(橘)
    barQRef.current     = chart.addSeries(HistogramSeries, { color: '#3b82f6', priceScaleId: 'left', priceFormat: fmt, priceLineVisible: false, lastValueVisible: false }) // 外資(藍)
    seriesRef.current = chart.addSeries(LineSeries, { color: '#fbbf24', lineWidth: 2, priceScaleId: 'right', priceFormat: { type: 'custom', minMove: 0.01, formatter: (v: number) => `${v.toFixed(2)}%` } })
    const ro = new ResizeObserver(([e]) => chart.applyOptions({ width: e.contentRect.width, height: e.contentRect.height }))
    ro.observe(containerRef.current)

    // tooltip：該週 內部大戶% + 三大法人個別庫存（張）
    chart.subscribeCrosshairMove(param => {
      const tip = barTooltipRef.current
      if (!tip) return
      if (!param.time || !param.point || param.point.x < 0) { tip.style.opacity = '0'; return }
      const key = String(param.time).replace(/-/g, '')
      const q = qByRef.current[key], i = iByRef.current[key], d = dByRef.current[key]
      const lineVal = seriesRef.current ? (param.seriesData.get(seriesRef.current) as { value?: number } | undefined)?.value : undefined
      if (q == null && i == null && d == null && lineVal == null) { tip.style.opacity = '0'; return }
      const row = (c: string, label: string, v: number | null | undefined) =>
        `<div style="display:flex;gap:8px;align-items:center"><span style="width:8px;height:8px;background:${c};border-radius:2px"></span><span style="color:#d1d5db;flex:1">${label}</span><span style="color:#e5e7eb;font-family:monospace">${v != null ? Math.round(v).toLocaleString() : '—'} 張</span></div>`
      tip.innerHTML =
        `<div style="color:#9ca3af;font-size:11px;margin-bottom:4px">${String(param.time)}</div>` +
        (lineVal != null ? `<div style="color:#fbbf24;font-size:12px;margin-bottom:4px">內部大戶 ${lineVal.toFixed(2)}%</div>` : '') +
        row('#3b82f6', '外資', q) + row('#f59e0b', '投信', i) + row('#34d399', '自營', d)
      tip.style.opacity = '1'
    })

    return () => {
      ro.disconnect(); chart.remove(); chartRef.current = null; seriesRef.current = null
      barTotalRef.current = null; barQiRef.current = null; barQRef.current = null
    }
  }, [])

  // 依資料 + 門檻 + 逐週扣外資 重繪
  const activeLots = price != null ? pickLots(bands, price) : bands[bands.length - 1]?.lots ?? 400
  const effPct = useCallback((w: { date: string; tiers: number[] }): number => {
    const big = bigHolderPct(w.tiers, data!.tierLots, activeLots)
    const sub = subLegal ? (legalByDate[w.date] ?? 0) : 0
    return +(big - sub).toFixed(2)
  }, [data, activeLots, subLegal, legalByDate])

  useEffect(() => {
    const s = seriesRef.current
    if (!s || !data) return
    s.setData(data.series.map(w => ({ time: ymd(w.date) as Time, value: effPct(w) })))
    chartRef.current?.timeScale().fitContent()
    // 底部柱圖：三色堆疊（外資/投信/自營），用累積值 + z-order 疊出堆疊效果
    if (barTotalRef.current && barQiRef.current && barQRef.current) {
      const tot: { time: Time; value: number }[] = []
      const qi: { time: Time; value: number }[] = []
      const q: { time: Time; value: number }[] = []
      for (const w of data.series) {
        const qf = qfiiByDate[w.date], it = itByDate[w.date], de = dealerByDate[w.date]
        if (qf == null || it == null || de == null) continue
        const t = ymd(w.date) as Time
        tot.push({ time: t, value: qf + it + de }) // 自營色，最底
        qi.push({ time: t, value: qf + it })        // 投信色
        q.push({ time: t, value: qf })              // 外資色，最上
      }
      barTotalRef.current.setData(tot)
      barQiRef.current.setData(qi)
      barQRef.current.setData(q)
    }
    chartRef.current?.timeScale().fitContent()
  }, [data, effPct, qfiiByDate, itByDate, dealerByDate])

  // 統計：最新 + 週對週（扣外資後）
  const series = data?.series ?? []
  const latestPct = series.length ? effPct(series[series.length - 1]) : null
  const prevPct   = series.length > 1 ? effPct(series[series.length - 2]) : null
  const wow = latestPct != null && prevPct != null ? +(latestPct - prevPct).toFixed(2) : null
  const lastDate = series.length ? series[series.length - 1].date : null
  const latestForeign = lastDate ? foreignByDate[lastDate] : null
  const latestLegal   = lastDate ? legalByDate[lastDate] : null

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
          <span className="text-gray-400">最新{subLegal && latestLegal != null ? '內部' : ''}大戶佔比 <b className="text-amber-300 text-lg">{latestPct}%</b></span>
          {wow != null && (
            <span className="text-gray-400">週對週 <b style={{ color: wow > 0 ? '#f87171' : wow < 0 ? '#4ade80' : '#9ca3af' }}>{wow > 0 ? '+' : ''}{wow}%</b></span>
          )}
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input type="checkbox" checked={subLegal} onChange={e => setSubLegal(e.target.checked)} className="accent-amber-500" />
            <span className="text-gray-300">扣三大法人（逐週）</span>
            {latestLegal != null
              ? <span className="text-gray-500">最新 {latestLegal}%（外資 {latestForeign ?? '—'}%）</span>
              : <span className="text-gray-600">（查無，未扣）</span>}
          </label>
          <span className="text-xs text-gray-600">※ 投信/自營為 DJ 估算值；持股比重以佔已發行計（與集保庫存略有差異）</span>
        </div>
      )}

      {/* 趨勢圖（單張疊圖：上=內部大戶%折線；下=三大法人庫存三色堆疊柱，左軸） */}
      <div className="flex-1 min-h-[360px] relative">
        {!data && !loading && (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-500 text-sm gap-2 pointer-events-none z-10">
            <span>輸入股號查詢大戶持股趨勢</span>
            <span className="text-xs text-gray-600">資料來自集保戶股權分散表（每週五更新），首次查詢會即時爬取約 1 年週資料</span>
          </div>
        )}
        {data && (
          <div className="absolute top-1 left-2 z-10 flex items-center gap-3 text-xs pointer-events-none">
            <span className="text-amber-300">— 內部大戶%</span>
            <span className="text-gray-500">｜庫存(張)：</span>
            <span className="text-blue-400">■ 外資</span>
            <span className="text-amber-500">■ 投信</span>
            <span className="text-emerald-400">■ 自營</span>
          </div>
        )}
        <div ref={containerRef} className="w-full h-full" />
        <div ref={barTooltipRef}
          className="absolute top-6 right-14 pointer-events-none opacity-0 transition-opacity z-20"
          style={{ background: 'rgba(17,24,39,0.95)', border: '1px solid #374151', borderRadius: 8, padding: '8px 10px', minWidth: 160 }} />
      </div>
    </div>
  )
}
