import { NextRequest, NextResponse } from 'next/server'
import { parseMisQuote, misExCh } from '@/lib/disposal/quote'
import type { Market } from '@/lib/disposal/marketData'

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'

/** 對外統一的盤中報價形狀（MIS 與 Yahoo 退路共用） */
interface QuoteOut {
  source: 'mis' | 'yahoo'
  market: Market
  code: string
  name?: string
  price: number | null       // 最新成交價（盤前/無成交為 null）
  open?: number | null       // 當日開盤
  high?: number | null
  low?: number | null
  prevClose?: number | null  // 昨收（前一營業日收盤）
  limitUp?: number | null
  limitDown?: number | null
  volShares?: number | null  // 累計成交量（股）
  date: string               // 'YYYY-MM-DD'
  time?: string              // hh:mm:ss（MIS 才有）
}

/** MIS 即時報價：一次同查上市+上櫃，由回應 ex 欄位判定市場。失敗回 null。 */
async function fetchMis(code: string): Promise<QuoteOut | null> {
  const exCh = `${misExCh('TWSE', code)}|${misExCh('TPEx', code)}`
  const url = `https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=${encodeURIComponent(exCh)}&json=1&delay=0&_=${Date.now()}`
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Referer: 'https://mis.twse.com.tw/stock/fibest.jsp' },
      cache: 'no-store',
      signal: AbortSignal.timeout(6000),
    })
    if (!res.ok) return null
    const q = parseMisQuote(await res.json(), code)
    if (!q) return null
    return {
      source: 'mis', market: q.market, code: q.code, name: q.name,
      price: q.price, open: q.open, high: q.high, low: q.low,
      prevClose: q.prevClose, limitUp: q.limitUp, limitDown: q.limitDown,
      volShares: q.volShares, date: q.date, time: q.time,
    }
  } catch { return null }
}

/** Yahoo 最新日K退路（延遲 ~15–20 分，但勝過無資料）。依市場提示先試對應後綴，再試另一個。 */
async function fetchYahooLatest(code: string, hint: Market): Promise<QuoteOut | null> {
  const suffixes = hint === 'TPEx' ? ['.TWO', '.TW'] : ['.TW', '.TWO']
  for (const sfx of suffixes) {
    const symbol = `${code}${sfx}`
    try {
      const res = await fetch(
        `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=5d`,
        { headers: { 'User-Agent': UA }, cache: 'no-store', signal: AbortSignal.timeout(8000) },
      )
      if (!res.ok) continue
      const json = await res.json()
      const result = json?.chart?.result?.[0]
      if (!result) continue
      const ts: number[] = result.timestamp ?? []
      const qq = result.indicators?.quote?.[0] ?? {}
      const meta = result.meta ?? {}
      const closes: (number | null)[] = qq.close ?? []
      let i = ts.length - 1
      while (i >= 0 && (closes[i] == null || isNaN(closes[i] as number))) i--
      if (i < 0) continue
      const prevC = i > 0 && closes[i - 1] != null && !isNaN(closes[i - 1] as number)
        ? (closes[i - 1] as number)
        : (typeof meta.chartPreviousClose === 'number' ? meta.chartPreviousClose
          : typeof meta.previousClose === 'number' ? meta.previousClose : null)
      const numOrNull = (x: unknown): number | null => (typeof x === 'number' && !isNaN(x) ? x : null)
      return {
        source: 'yahoo',
        market: sfx === '.TWO' ? 'TPEx' : 'TWSE',
        code,
        name: meta.shortName || meta.longName || undefined,
        price: numOrNull(closes[i]),
        open: numOrNull(qq.open?.[i]),
        high: numOrNull(qq.high?.[i]),
        low: numOrNull(qq.low?.[i]),
        prevClose: prevC,
        volShares: numOrNull(qq.volume?.[i]),
        date: new Date((ts[i] + 28800) * 1000).toISOString().split('T')[0],
      }
    } catch { /* try next suffix */ }
  }
  return null
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const code = (searchParams.get('code') || '').trim().toUpperCase()
  const marketParam = (searchParams.get('market') || '').trim().toUpperCase()
  const hint: Market = marketParam === 'TPEX' ? 'TPEx' : 'TWSE'

  if (!/^\d{4,6}[A-Z]?$/.test(code)) {
    return NextResponse.json({ error: 'Missing or invalid code' }, { status: 400 })
  }

  // 優先 MIS（近即時）；失敗退回 Yahoo（延遲），確保不低於既有行為
  const quote = (await fetchMis(code)) ?? (await fetchYahooLatest(code, hint))
  if (!quote) {
    return NextResponse.json({ error: `查無 ${code} 即時報價` }, { status: 502 })
  }
  return NextResponse.json(quote)
}
