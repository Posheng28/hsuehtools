import { NextRequest, NextResponse } from 'next/server'
import { getCached, setCached } from '@/lib/cache'

// 全體均值（款一「差幅 ≥ 20%」比較基底 = 個股累積漲幅 − 全體均值）。**上市/上櫃算法不同**：
//   上市 = 全體普通股「逐日漲跌%(2位無條件捨去)相加」再等權(簡單)平均。
//   上櫃 = 櫃買指數(發行量加權)逐日漲跌%相加(全精度)。
// 窗口：基準日→最近收盤日(5 個已知間隔)；當日(下一交易日)以 0% 計。?date=個股最近收盤日 對齊窗口。
// 註：與 attstock 對拍——上櫃 = 櫃買指數(9.98)；上市為個股等權(~5)、非 TAIEX 指數(8.14)。

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
/** 上市 TAIEX 收盤 { YYYYMMDD: close }，抓指定月份(YYYYMMDD)；回整月。僅用來定出上市交易日窗口。 */
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

const trunc2 = (x: number) => { const v = Math.round(x * 1e8) / 1e8; return Math.trunc(v * 100) / 100 }   // 每日漲跌% 取小數 2 位無條件捨去(向零)
const isOrd  = (c: string) => /^[1-9]\d{3}$/.test(c)       // 普通股(排除 ETF/ETN/特別股)
interface MiResp { tables?: { title?: string; data?: unknown[][] }[] }
/** 上市某日 普通股 { code: 當日漲跌幅% }；非交易日/失敗回 null（含重試，避免 API 偶爾掉檔） */
async function fetchTwseStocks(ymd: string): Promise<Record<string, number> | null> {
  const url = `https://www.twse.com.tw/exchangeReport/MI_INDEX?response=json&date=${ymd}&type=ALLBUT0999`
  for (let a = 0; a < 3; a++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } })
      if (res.ok) {
        const j = (await res.json()) as MiResp
        const t = (j.tables ?? []).find(x => String(x.title ?? '').includes('每日收盤行情'))
        if (t?.data?.length) {
          const out: Record<string, number> = {}
          for (const row of t.data) {
            const code = String(row[0]).trim(); if (!isOrd(code)) continue
            const close = idxNum(row[8]), mag = idxNum(row[10])     // row[8]=收盤, row[10]=漲跌價差, row[9]=漲跌方向(green=跌)
            if (close === null || mag === null || close <= 0) continue
            const sign = String(row[9]).includes('green') ? -1 : 1
            const diff = mag * sign, prev = close - diff
            if (prev <= 0) continue
            out[code] = (diff / prev) * 100
          }
          if (Object.keys(out).length) return out
        }
      }
    } catch { /* retry */ }
    await new Promise(r => setTimeout(r, 600))
  }
  return null
}
/** 上市全體均值 = 普通股逐日漲跌%(截斷)相加，再對「整段都有交易」者取等權簡單平均。days=窗口6收盤日(升冪) */
async function twseEqAvg(days: string[]): Promise<number | null> {
  if (days.length !== WINDOW) return null
  const snaps: Record<string, Record<string, number>> = {}
  for (const d of days) { const s = await fetchTwseStocks(d); if (!s) return null; snaps[d] = s }
  const iv = days.slice(1)
  let codes = new Set(Object.keys(snaps[days[0]]))
  for (const d of iv) codes = new Set([...codes].filter(c => c in snaps[d]))
  let sum = 0, n = 0
  for (const c of codes) { let cum = 0; for (const d of iv) cum += trunc2(snaps[d][c]); sum += cum; n++ }
  return n ? +(sum / n).toFixed(2) : null
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
  const tpW = pickWindow(tpexIdx)   // 上櫃：櫃買指數窗口
  const twW = pickWindow(twseIdx)   // 上市：用 TAIEX 指數定出交易日窗口（個股漲幅另抓）

  // 結果快取（key=endYMD），命中直接回（避免上市逐檔重抓）
  const cacheKey = `market-avg:idx:${endYMD}`
  if (!bust) { const c = getCached(cacheKey); if (c) return NextResponse.json({ ...(c as object), cached: true }) }

  // 上櫃 = 櫃買指數逐日相加；上市 = 普通股逐日截斷相加再等權平均
  const tpAvg = tpW.closes.length === WINDOW ? +sumDailyPct(tpW.closes).toFixed(2) : null
  const twAvg = await twseEqAvg(twW.days)

  const lastClosed = (twW.days.at(-1)) ?? tpW.days.at(-1) ?? endYMD
  const baseDate   = (twW.days[0]) ?? tpW.days[0] ?? ''

  const result = {
    knownIntervals: WINDOW - 1,
    baseDate, lastClosedDate: lastClosed,
    note: '全體均值：上市=普通股逐日漲跌%(2位無條件捨去)相加再等權平均；上櫃=櫃買指數逐日漲跌%相加(全精度)；當日(下一交易日)以0%計',
    twse: { avg: twAvg },
    tpex: { avg: tpAvg },
  }
  setCached(cacheKey, result, 6 * 60 * 60 * 1000)
  return NextResponse.json(result)
}
