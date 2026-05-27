import { NextRequest, NextResponse } from 'next/server'
import { getCached, setCached } from '@/lib/cache'

// 全體均值 = 官方發行量加權指數的「逐日漲跌%相加(全精度)」：上市=發行量加權股價指數(TAIEX)、上櫃=櫃買指數。
// 用途：注意標準款一「差幅 ≥ 20%」比較基底（個股累積漲幅 − 全體均值）。
// 窗口：基準日→最近收盤日(5 個已知間隔)；當日(下一交易日)以 0% 計。?date=個股最近收盤日 對齊窗口。

const WINDOW = 6 // 含基準日的已收盤交易日數 → 5 個已知間隔；第 6 個間隔=當日(變數)另外併入

const pad = (n: number) => String(n).padStart(2, '0')
const toYMD   = (d: Date) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`

// 逐日漲跌%相加（全精度）。closes 升冪(基準→最近收盤)，回傳 (closes.length-1) 個間隔相加%
function sumDailyPct(closes: number[]): number {
  let s = 0
  for (let i = 1; i < closes.length; i++) s += (closes[i] / closes[i - 1] - 1) * 100
  return s
}
const idxNum = (s: unknown): number | null => {
  const n = parseFloat(String(s).replace(/,/g, '')); return isNaN(n) ? null : n
}
const rocToYMD = (roc: string) => {
  const m = roc.match(/(\d+)\/(\d+)\/(\d+)/); if (!m) return ''
  return `${+m[1] + 1911}${pad(+m[2])}${pad(+m[3])}`
}
/** 上櫃櫃買指數收盤 { YYYYMMDD: close }（OpenAPI，最近約一個月） */
async function fetchTpexIndex(): Promise<Record<string, number>> {
  try {
    const res = await fetch('https://www.tpex.org.tw/openapi/v1/tpex_index', { headers: { 'User-Agent': 'Mozilla/5.0' } })
    if (!res.ok) return {}
    const arr = (await res.json()) as { Date: string; Close: string }[]
    const out: Record<string, number> = {}
    for (const r of arr) { const c = idxNum(r.Close); if (/^\d{8}$/.test(r.Date) && c) out[r.Date] = c }
    return out
  } catch { return {} }
}
/** 上市 TAIEX 收盤 { YYYYMMDD: close }，抓指定月份(YYYYMMDD)；回整月 */
async function fetchTwseIndexMonth(ymd: string): Promise<Record<string, number>> {
  try {
    const res = await fetch(`https://www.twse.com.tw/indicesReport/MI_5MINS_HIST?response=json&date=${ymd}`, { headers: { 'User-Agent': 'Mozilla/5.0' } })
    if (!res.ok) return {}
    const j = (await res.json()) as { data?: string[][] }
    const out: Record<string, number> = {}
    for (const row of j.data ?? []) { const d = rocToYMD(String(row[0])); const c = idxNum(row[4]); if (d && c) out[d] = c }
    return out
  } catch { return {} }
}

export async function GET(req: NextRequest) {
  const params = new URL(req.url).searchParams
  const bust = params.get('bust') === '1'
  const dateParam = params.get('date')
  const endYMD = dateParam && /^\d{8}$/.test(dateParam) ? dateParam : toYMD(new Date())

  // 取兩市場指數收盤序列（TAIEX 抓 endMonth + 前一月以防跨月；櫃買指數 OpenAPI 給近一個月）
  const prevMonthYMD = toYMD(new Date(+endYMD.slice(0, 4), +endYMD.slice(4, 6) - 2, 15))
  const [tpexIdx, twseA, twseB] = await Promise.all([
    fetchTpexIndex(),
    fetchTwseIndexMonth(endYMD),
    fetchTwseIndexMonth(prevMonthYMD),
  ])
  const twseIdx = { ...twseB, ...twseA }

  // 取 ≤ endYMD 的最近 WINDOW 個交易日收盤（升冪）
  const pickWindow = (idx: Record<string, number>): { days: string[]; closes: number[] } => {
    const ds = Object.keys(idx).filter(d => d <= endYMD).sort().slice(-WINDOW)
    return { days: ds, closes: ds.map(d => idx[d]) }
  }
  const tpW = pickWindow(tpexIdx)
  const twW = pickWindow(twseIdx)

  const mkResult = (w: { days: string[]; closes: number[] }) =>
    w.closes.length === WINDOW
      ? { avg: +sumDailyPct(w.closes).toFixed(2), baseDate: w.days[0], lastClosedDate: w.days[WINDOW - 1] }
      : null

  const tp = mkResult(tpW)
  const tw = mkResult(twW)
  const lastClosed = tw?.lastClosedDate ?? tp?.lastClosedDate ?? endYMD
  const baseDate = tw?.baseDate ?? tp?.baseDate ?? ''

  const cacheKey = `market-avg:idx:${endYMD}`
  if (!bust) { const c = getCached(cacheKey); if (c) return NextResponse.json({ ...(c as object), cached: true }) }

  const result = {
    knownIntervals: WINDOW - 1,
    baseDate, lastClosedDate: lastClosed,
    note: '全體均值 = 發行量加權指數(上市TAIEX/上櫃櫃買指數)逐日漲跌%相加(全精度)；當日(下一交易日)以0%計',
    twse: tw ? { avg: tw.avg } : { avg: null },
    tpex: tp ? { avg: tp.avg } : { avg: null },
  }
  setCached(cacheKey, result, 6 * 60 * 60 * 1000)
  return NextResponse.json(result)
}
