// app/api/market-avg/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { getCached, setCached } from '@/lib/cache'
import { fetchTwseDailyPct, fetchTpexDailyPct, cumulativeMap, eqAvg } from '@/lib/disposal/marketData'

const WINDOW = 6
const pad = (n: number) => String(n).padStart(2, '0')
const toYMD = (d: Date) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`
const rocToYMD = (roc: string) => { const m = roc.match(/(\d+)\/(\d+)\/(\d+)/); return m ? `${+m[1] + 1911}${pad(+m[2])}${pad(+m[3])}` : '' }
const UA = 'Mozilla/5.0'

/** 上櫃櫃買指數收盤 { YYYYMMDD: close }（僅用來定出上櫃交易日窗口） */
async function fetchTpexIndexDates(): Promise<string[]> {
  try {
    const res = await fetch('https://www.tpex.org.tw/openapi/v1/tpex_index', { headers: { 'User-Agent': UA } })
    if (!res.ok) return []
    return ((await res.json()) as { Date: string }[]).map(r => r.Date).filter(d => /^\d{8}$/.test(d))
  } catch { return [] }
}
/** 上市 TAIEX 交易日（抓指定月，回 YYYYMMDD 陣列），僅用來定窗口 */
async function fetchTwseIndexDates(ymd: string): Promise<string[]> {
  try {
    const res = await fetch(`https://www.twse.com.tw/indicesReport/MI_5MINS_HIST?response=json&date=${ymd}`, { headers: { 'User-Agent': UA } })
    if (!res.ok) return []
    const j = (await res.json()) as { data?: string[][] }
    return (j.data ?? []).map(r => rocToYMD(String(r[0]))).filter(Boolean)
  } catch { return [] }
}

/** 取 ≤ endYMD 的最近 WINDOW 個交易日(升冪)的「interval 部分」= slice(1) (5 日) */
function intervalDays(allDates: string[], endYMD: string): string[] {
  const win = [...new Set(allDates)].filter(d => d <= endYMD).sort().slice(-WINDOW)
  return win.slice(1)   // 5 個 interval-end 日
}

/** 抓多日個股漲跌%並等權累積平均（全市場，不排除） */
async function eqAvgOverDays(days: string[], fetcher: (d: string) => Promise<Record<string, number> | null>): Promise<number | null> {
  if (days.length < 1) return null
  const snaps: Record<string, number>[] = []
  for (const d of days) { const s = await fetcher(d); if (!s) return null; snaps.push(s) }
  return eqAvg(cumulativeMap(snaps)).avg
}

export async function GET(req: NextRequest) {
  const params = new URL(req.url).searchParams
  const bust = params.get('bust') === '1'
  const dateParam = params.get('date')
  const endYMD = dateParam && /^\d{8}$/.test(dateParam) ? dateParam : toYMD(new Date())

  const cacheKey = `market-avg:eq:${endYMD}`
  if (!bust) { const c = getCached(cacheKey); if (c) return NextResponse.json({ ...(c as object), cached: true }) }

  const prevMonthYMD = toYMD(new Date(+endYMD.slice(0, 4), +endYMD.slice(4, 6) - 2, 15))
  const [tpexDates, twA, twB] = await Promise.all([
    fetchTpexIndexDates(), fetchTwseIndexDates(endYMD), fetchTwseIndexDates(prevMonthYMD),
  ])
  const twDates = [...twB, ...twA]
  const twIv = intervalDays(twDates, endYMD)
  const tpIv = intervalDays(tpexDates, endYMD)

  const [twAvg, tpAvg] = await Promise.all([
    eqAvgOverDays(twIv, fetchTwseDailyPct),
    eqAvgOverDays(tpIv, fetchTpexDailyPct),
  ])

  const lastClosed = twIv.at(-1) ?? tpIv.at(-1) ?? endYMD
  const baseDate = (twDates.filter(d => d <= endYMD).sort().slice(-WINDOW)[0]) ?? ''
  const result = {
    knownIntervals: WINDOW - 1,
    baseDate, lastClosedDate: lastClosed,
    note: '全體均值：上市/上櫃皆=普通股逐日漲跌%(2位無條件捨去)相加再等權平均；當日(下一交易日)以0%計',
    twse: { avg: twAvg }, tpex: { avg: tpAvg },
  }
  setCached(cacheKey, result, 6 * 60 * 60 * 1000)
  return NextResponse.json(result)
}
