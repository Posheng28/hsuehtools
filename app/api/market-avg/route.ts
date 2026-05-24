import { NextRequest, NextResponse } from 'next/server'
import { getCached, setCached } from '@/lib/cache'
import { loadSnapshot, saveSnapshot, pruneExcept } from '@/lib/marketStore'

// 全體有價證券「已知部分累積漲跌% 的簡單算術平均」(分上市/上櫃)。
// 用途：注意標準款一「差幅 ≥ 20%」的比較基底（個股漲幅 − 全體平均）。
//
// 窗口定義（重要）：
//  注意判定窗口 =「最近 6 個營業日(含當日)累積之最後成交價漲跌%」。
//  累積「基準」= 該 6 日區間之前一交易日收盤（例：判定 5/25 → 基準 = 5/15 收盤）。
//  完整 6 日 = 基準(5/15) → 5/18,19,20,21,22 → 當日(5/25)，共 6 個漲跌間隔。
//  其中「當日(5/25)」要收盤才知道、且是唯一變數；前面 5 個間隔(基準→最近收盤日)全部已知。
//  故本 API 算「已知部分」= 基準收盤(5/15) → 最近收盤日(5/22) 的累積(5 個間隔)；
//  判定當日注意時，再把「當日」全市場漲跌併為第 6 個間隔。
//  明天 5/25 收盤後，窗口自動滾成 基準 5/18 → 最近 5/25。
//
// 演算法：
//  1. 由今日往回找出最近 6 個已收盤交易日（含基準日；非交易日資料源回空 → 跳過，自動避開假日）。
//  2. 每個交易日抓全市場「當日漲跌幅%」快照（已存則略過），存檔並修剪到只留這 6 天。
//  3. 6 個交易日 = 5 個間隔；逐檔連乘 (1+漲跌幅) − 1 = 該檔已知累積漲跌%
//     （= (最近收盤 / 基準收盤) − 1，與法規「最後成交價累積漲跌%」一致）。
//  4. 對全市場「整段都有交易」的股票取簡單算術平均。

const WINDOW = 6 // 含基準日的已收盤交易日數 → 5 個已知間隔；第 6 個間隔=當日(變數)另外併入

const pad = (n: number) => String(n).padStart(2, '0')
const toYMD   = (d: Date) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`
const toSlash = (ymd: string) => `${ymd.slice(0, 4)}/${ymd.slice(4, 6)}/${ymd.slice(6, 8)}`
const parseNum = (s: unknown): number | null => {
  const n = parseFloat(String(s).replace(/,/g, ''))
  return isNaN(n) ? null : n
}
// 只取普通股 4 位數且非 0 開頭（排除 00xx ETF / 6 位數 ETN / 特別股如 2887B）
const isOrdinary = (code: string) => /^[1-9]\d{3}$/.test(code)

interface TableResp { tables?: { title?: string; data?: unknown[][] }[] }

/** 上市：回傳 { code: 當日漲跌幅% }，非交易日回 null */
async function fetchTWSE(ymd: string): Promise<Record<string, number> | null> {
  const url = `https://www.twse.com.tw/exchangeReport/MI_INDEX?response=json&date=${ymd}&type=ALLBUT0999`
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } })
  if (!res.ok) return null
  const j = (await res.json()) as TableResp
  const t = (j.tables ?? []).find(x => String(x.title ?? '').includes('每日收盤行情'))
  if (!t?.data?.length) return null
  const out: Record<string, number> = {}
  for (const row of t.data) {
    const code = String(row[0]).trim()
    if (!isOrdinary(code)) continue
    const close = parseNum(row[8])         // 收盤價
    const mag   = parseNum(row[10])        // 漲跌價差（幅度，sign 在 row[9]）
    if (close === null || mag === null || close <= 0) continue
    const sign  = String(row[9]).includes('green') ? -1 : 1
    const diff  = mag * sign
    const prev  = close - diff
    if (prev <= 0) continue
    out[code] = (diff / prev) * 100
  }
  return Object.keys(out).length ? out : null
}

/** 上櫃：回傳 { code: 當日漲跌幅% }，非交易日回 null */
async function fetchTPEx(ymd: string): Promise<Record<string, number> | null> {
  const url = `https://www.tpex.org.tw/www/zh-tw/afterTrading/dailyQuotes?date=${toSlash(ymd)}&type=EW&id=&response=json`
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } })
  if (!res.ok) return null
  const j = (await res.json()) as TableResp
  const t = (j.tables ?? [])[0]
  if (!t?.data?.length) return null
  const out: Record<string, number> = {}
  for (const row of t.data) {
    const code = String(row[0]).trim()
    if (!isOrdinary(code)) continue
    const close = parseNum(row[2])         // 收盤
    const diff  = parseNum(row[3])         // 漲跌（已含正負號）
    if (close === null || diff === null || close <= 0) continue
    const prev = close - diff
    if (prev <= 0) continue
    out[code] = (diff / prev) * 100
  }
  return Object.keys(out).length ? out : null
}

/** 逐檔連乘 days[1..] 的漲跌幅 → 各檔累積%，再對全市場取簡單平均 */
function avgCumulative(snaps: Record<string, Record<string, number>>, days: string[]): { avg: number; n: number } {
  const intervals = days.slice(1) // 6 個交易日 = 5 個間隔（首日為基準，不含其自身漲跌）
  if (intervals.length === 0) return { avg: 0, n: 0 }
  let codes = new Set(Object.keys(snaps[intervals[0]] ?? {}))
  for (const d of intervals.slice(1)) {
    const s = snaps[d] ?? {}
    codes = new Set([...codes].filter(c => c in s))
  }
  let sum = 0, n = 0
  for (const c of codes) {
    let prod = 1
    for (const d of intervals) prod *= 1 + snaps[d][c] / 100
    sum += (prod - 1) * 100
    n++
  }
  return { avg: n ? sum / n : 0, n }
}

export async function GET(req: NextRequest) {
  const bust = new URL(req.url).searchParams.get('bust') === '1'

  // 找出最近 WINDOW 個交易日，並備妥兩市場快照（以 TWSE 是否有資料判定交易日）
  const days: string[] = []                              // 升冪 [最舊..最新]
  const twse: Record<string, Record<string, number>> = {}
  const tpex: Record<string, Record<string, number>> = {}

  const d = new Date()
  let guard = 0
  while (days.length < WINDOW && guard < 25) {
    guard++
    const dow = d.getDay()
    if (dow !== 0 && dow !== 6) {                        // 先跳過週末
      const ymd = toYMD(d)
      let tw = bust ? null : await loadSnapshot('TWSE', ymd)
      if (!tw) { tw = await fetchTWSE(ymd); if (tw) await saveSnapshot('TWSE', ymd, tw) }
      if (tw) {                                          // 有資料 = 交易日
        let tp = bust ? null : await loadSnapshot('TPEx', ymd)
        if (!tp) { tp = await fetchTPEx(ymd); if (tp) await saveSnapshot('TPEx', ymd, tp) }
        days.unshift(ymd)
        twse[ymd] = tw
        if (tp) tpex[ymd] = tp
      }
    }
    d.setDate(d.getDate() - 1)
  }

  if (days.length < WINDOW) {
    return NextResponse.json({ error: `只取得 ${days.length} 個交易日，不足 ${WINDOW} 天` }, { status: 503 })
  }

  // 只保留這 6 個交易日的快照（規矩：超過即刪）
  await pruneExcept('TWSE', days)
  await pruneExcept('TPEx', days.filter(x => x in tpex))

  const calcDate = days[days.length - 1]
  const cacheKey = `market-avg:${calcDate}`
  if (!bust) {
    const cached = getCached(cacheKey)
    if (cached) return NextResponse.json({ ...(cached as object), cached: true })
  }

  const tw = avgCumulative(twse, days)
  const tpexDays = days.filter(x => x in tpex)
  const tp = tpexDays.length === WINDOW ? avgCumulative(tpex, days) : { avg: 0, n: 0 }

  const result = {
    knownIntervals: WINDOW - 1,    // 已知漲跌間隔數（= 5）
    baseDate: days[0],             // 累積基準（6 日窗口前一交易日收盤，如 5/15）
    lastClosedDate: calcDate,      // 最近已收盤交易日（如 5/22）
    days,
    note: '此為已知部分累積漲幅平均（基準→最近收盤日，5 個間隔）；判定「當日(下一交易日)」注意時須再併入當日全市場漲跌成為第 6 個間隔（當日為不可預測變數）',
    twse: { avg: +tw.avg.toFixed(2), count: tw.n },
    tpex: tpexDays.length === WINDOW
      ? { avg: +tp.avg.toFixed(2), count: tp.n }
      : { avg: null, count: 0, note: `上櫃僅取得 ${tpexDays.length}/${WINDOW} 日，資料累積中` },
  }

  setCached(cacheKey, result, 6 * 60 * 60 * 1000) // 同一交易日數字不變，快取 6 小時
  return NextResponse.json(result)
}
