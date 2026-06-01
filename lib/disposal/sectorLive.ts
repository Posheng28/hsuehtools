// lib/disposal/sectorLive.ts
// 同類均值「盤中即時」計算：在歷史 5 日累積之上，加同類成員當日 live% 貢獻。
import { trunc2, type Market } from '@/lib/disposal/marketData'
import { misExCh, parseMisQuoteRows } from '@/lib/disposal/quote'

const CHUNK = 40

/** 代號每 CHUNK 檔一批，各批以 | 串成 MIS ex_ch 字串 */
export function misExChBatch(market: Market, codes: string[]): string[] {
  const out: string[] = []
  for (let i = 0; i < codes.length; i += CHUNK) {
    out.push(codes.slice(i, i + CHUNK).map(c => misExCh(market, c)).join('|'))
  }
  return out
}

/** MIS 解析列 → { code: 今日漲跌%(trunc2) }；price/prevClose 缺或 prevClose≤0 跳過 */
export function misRowsToTodayPct(
  rows: { code: string; price: number | null; prevClose: number | null }[],
): Record<string, number> {
  const out: Record<string, number> = {}
  for (const r of rows) {
    if (r.price == null || r.prevClose == null || r.prevClose <= 0) continue
    out[r.code] = trunc2((r.price - r.prevClose) / r.prevClose * 100)
  }
  return out
}

/** 同類 live 均值：members = sectorMap===sector 且 ∈cums 且 ≠exclude；
 *  liveCum=cums[m]+(todayPct[m]||0)；等權。回 { avg, n, todayAvg }（n=0→全 null）。 */
export function liveSectorAvg(
  cums: Record<string, number>,
  sectorMap: Record<string, string>,
  sector: string,
  exclude: string,
  todayPct: Record<string, number>,
): { avg: number | null; n: number; todayAvg: number | null } {
  let sumLive = 0, sumToday = 0, n = 0
  for (const [c, base] of Object.entries(cums)) {
    if (c === exclude) continue
    if (sectorMap[c] !== sector) continue
    const t = todayPct[c] ?? 0
    sumLive += base + t
    sumToday += t
    n++
  }
  if (!n) return { avg: null, n: 0, todayAvg: null }
  return { avg: +(sumLive / n).toFixed(2), n, todayAvg: +(sumToday / n).toFixed(2) }
}

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'

/** 抓同類成員今日 live%：分批打 MIS getStockInfo → 解析 → todayPct map。
 *  任何一批失敗 → 該批成員缺漏（視同今日無資料），不整體拋錯。 */
export async function fetchSectorTodayPct(market: Market, codes: string[]): Promise<Record<string, number>> {
  if (!codes.length) return {}
  const out: Record<string, number> = {}
  for (const exCh of misExChBatch(market, codes)) {
    try {
      const url = `https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=${encodeURIComponent(exCh)}&json=1&delay=0&_=${Date.now()}`
      const res = await fetch(url, {
        headers: { 'User-Agent': UA, Referer: 'https://mis.twse.com.tw/stock/fibest.jsp' },
        cache: 'no-store',
        signal: AbortSignal.timeout(6000),
      })
      if (!res.ok) continue
      Object.assign(out, misRowsToTodayPct(parseMisQuoteRows(await res.json())))
    } catch { /* 該批略過 */ }
  }
  return out
}
