// lib/disposal/quote.ts
// 證交所 MIS 即時報價 (getStockInfo.jsp) 回應解析。純函式，方便單元測試與 route 共用。
import type { Market } from '@/lib/disposal/marketData'

export interface MisQuote {
  source: 'mis'
  code: string
  name: string
  market: Market
  price: number | null      // z 最新成交價（尚無成交為 null）
  open: number | null       // o 當日開盤
  high: number | null       // h 當日最高
  low: number | null        // l 當日最低
  prevClose: number | null  // y 昨收（前一營業日收盤）
  limitUp: number | null    // u 當日漲停價
  limitDown: number | null  // w 當日跌停價
  volShares: number | null  // v 累計成交量（原始為「張」，×1000 = 股）
  date: string              // d 'YYYYMMDD' → 'YYYY-MM-DD'
  time: string              // t 最後成交時間 hh:mm:ss
}

/** 解析 MIS 數值字串：'-'／空／NaN → null；去千分位逗號 */
const num = (s: unknown): number | null => {
  if (s == null) return null
  const t = String(s).trim()
  if (!t || t === '-') return null
  const n = parseFloat(t.replace(/,/g, ''))
  return isNaN(n) ? null : n
}

/** 'YYYYMMDD' → 'YYYY-MM-DD'；非 8 碼原樣回傳 */
const fmtDate = (d: unknown): string => {
  const s = String(d ?? '').trim()
  return /^\d{8}$/.test(s) ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : s
}

interface MisRow {
  c?: string; n?: string; ex?: string
  z?: string; o?: string; h?: string; l?: string; y?: string; u?: string; w?: string; v?: string
  d?: string; t?: string
}

/** MIS getStockInfo 回應 → 指定代號的乾淨報價；查無代號／格式錯誤回 null。
 *  market 由回應的 ex 欄位判定（otc=上櫃，其餘=上市），比呼叫端傳入更可靠。 */
export function parseMisQuote(json: unknown, code: string): MisQuote | null {
  const arr = (json as { msgArray?: MisRow[] } | null)?.msgArray
  if (!Array.isArray(arr) || arr.length === 0) return null
  const row = arr.find(r => String(r?.c ?? '').trim() === code)
  if (!row) return null
  const lots = num(row.v)
  return {
    source: 'mis',
    code,
    name: String(row.n ?? '').trim(),
    market: String(row.ex ?? '').trim().toLowerCase() === 'otc' ? 'TPEx' : 'TWSE',
    price: num(row.z),
    open: num(row.o),
    high: num(row.h),
    low: num(row.l),
    prevClose: num(row.y),
    limitUp: num(row.u),
    limitDown: num(row.w),
    volShares: lots == null ? null : Math.round(lots * 1000),
    date: fmtDate(row.d),
    time: String(row.t ?? '').trim(),
  }
}

/** 組 MIS ex_ch 參數：上市 tse_、上櫃 otc_（例：tse_2330.tw / otc_6488.tw） */
export function misExCh(market: Market, code: string): string {
  return `${market === 'TPEx' ? 'otc' : 'tse'}_${code}.tw`
}

export interface MisRowLite { code: string; price: number | null; prevClose: number | null; market: Market }

/** 解析 MIS getStockInfo 回應的「全部」列（批量查多檔用）。無 c 的列跳過。 */
export function parseMisQuoteRows(json: unknown): MisRowLite[] {
  const arr = (json as { msgArray?: MisRow[] } | null)?.msgArray
  if (!Array.isArray(arr)) return []
  const out: MisRowLite[] = []
  for (const r of arr) {
    const code = String(r?.c ?? '').trim()
    if (!code) continue
    out.push({
      code,
      price: num(r.z),
      prevClose: num(r.y),
      market: String(r.ex ?? '').trim().toLowerCase() === 'otc' ? 'TPEx' : 'TWSE',
    })
  }
  return out
}
