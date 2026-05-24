import { NextRequest, NextResponse } from 'next/server'
import { getCached, setCached, deleteCachePrefix } from '@/lib/cache'

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'

function yahooRange(range: string): string {
  if (range === '1Y') return '1y'
  if (range === '5Y') return '5y'
  return '2y'
}

function candidateTickers(ticker: string): string[] {
  const t = ticker.trim().toUpperCase()
  if (/^\d{4}$/.test(t)) return [`${t}.TW`, `${t}.TWO`]
  if (t.includes('.')) return [t]
  return [t]
}

/** Most recent weekday in Taiwan timezone (UTC+8) */
function latestTaiwanWeekday(): string {
  const tw = new Date(Date.now() + 8 * 3600 * 1000)
  while (tw.getUTCDay() === 0 || tw.getUTCDay() === 6) tw.setUTCDate(tw.getUTCDate() - 1)
  return tw.toISOString().split('T')[0]
}

function rocToISO(s: string, sep: string): string {
  const p = s.split(sep)
  return `${1911 + parseInt(p[0])}-${p[1].padStart(2, '0')}-${p[2].padStart(2, '0')}`
}
function toROCSlash(isoDate: string): string {
  const [y, m, d] = isoDate.split('-')
  return `${parseInt(y) - 1911}/${m}/${d}`
}

/** TWSE monthly individual-stock trading data → close prices */
async function fetchTWSEMonthly(stockNo: string, yyyymm: string): Promise<{ date: string; value: number }[]> {
  try {
    const url = `https://www.twse.com.tw/rwd/zh/afterTrading/STOCK_DAY?response=json&date=${yyyymm}&stockNo=${stockNo}`
    const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(8000) })
    if (!res.ok) return []
    const json = await res.json()
    if (json.stat !== 'OK' || !Array.isArray(json.data)) return []
    return (json.data as string[][]).flatMap(row => {
      const parts = String(row[0]).split('/')
      if (parts.length < 3) return []
      const date  = rocToISO(String(row[0]), '/')
      const value = parseFloat(String(row[6]).replace(/,/g, ''))
      return isNaN(value) ? [] : [{ date, value }]
    })
  } catch { return [] }
}

/** TPEx monthly individual-stock trading data → close prices */
async function fetchTPExMonthly(stockNo: string, rocYM: string): Promise<{ date: string; value: number }[]> {
  try {
    const url = `https://www.tpex.org.tw/www/zh-tw/afterTrading/tradingInfo/seD?MarketType=0&StockCode=${stockNo}&d=${encodeURIComponent(rocYM)}&response=json`
    const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(8000) })
    if (!res.ok) return []
    const json = await res.json()
    const rows: string[][] = json?.aaData ?? json?.data ?? []
    if (!Array.isArray(rows)) return []
    return rows.flatMap(row => {
      const date  = rocToISO(String(row[0]), '/')
      const value = parseFloat(String(row[6]).replace(/,/g, ''))
      return isNaN(value) ? [] : [{ date, value }]
    })
  } catch { return [] }
}

async function fetchYahoo(symbol: string, params: { range?: string; from?: string; to?: string }) {
  let url: string
  if (params.from && params.to) {
    const p1 = Math.floor(new Date(params.from + 'T00:00:00Z').getTime() / 1000)
    const p2 = Math.floor(new Date(params.to   + 'T23:59:59Z').getTime() / 1000)
    url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&period1=${p1}&period2=${p2}`
  } else {
    url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=${yahooRange(params.range ?? '2Y')}`
  }

  const res = await fetch(url, { headers: { 'User-Agent': UA } })
  if (!res.ok) return null
  const json   = await res.json()
  const result = json?.chart?.result?.[0]
  if (!result) return null

  const timestamps: number[] = result.timestamp ?? []
  const closes: number[]     = result.indicators?.quote?.[0]?.close ?? []
  const volumes: number[]    = result.indicators?.quote?.[0]?.volume ?? []

  const data = timestamps
    .map((ts, i) => {
      // Yahoo Finance stores Taiwan stock timestamps at midnight UTC+8 (= prev-day 16:00 UTC).
      // Add +8 h so the ISO date string matches the actual Taiwan trading date.
      const date  = new Date((ts + 28800) * 1000).toISOString().split('T')[0]
      const value = closes[i]
      if (value == null || isNaN(value)) return null
      const vol = volumes[i]   // 成交股數（款三 60 日均量用）；缺值留 undefined
      return { date, value, volume: vol == null || isNaN(vol) ? undefined : vol }
    })
    .filter(Boolean)
    .sort((a, b) => (a!.date < b!.date ? -1 : 1)) as { date: string; value: number; volume?: number }[]

  return data.length > 0 ? data : null
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const ticker = searchParams.get('ticker')
  const range  = searchParams.get('range') || '2Y'
  const from   = searchParams.get('from') ?? undefined
  const to     = searchParams.get('to')   ?? undefined

  if (!ticker) return NextResponse.json({ error: 'Missing ticker' }, { status: 400 })

  const bust = searchParams.get('bust') === '1'
  const candidates = candidateTickers(ticker)
  const cacheKey   = from && to
    ? `stocks:${candidates[0]}:${from}:${to}`
    : `stocks:${candidates[0]}:${range}`

  // Bust stale cache entries for this ticker when explicitly requested
  if (bust) deleteCachePrefix(`stocks:${candidates[0]}:`)

  const hit = getCached(cacheKey) as { data: unknown; market?: string } | null
  if (hit) {
    // Backward-compat: older cache entries stored the bare data array
    if (Array.isArray(hit)) return NextResponse.json({ data: hit, cached: true })
    return NextResponse.json({ ...hit, cached: true })
  }

  try {
    for (const symbol of candidates) {
      let data = await fetchYahoo(symbol, { range, from, to })
      if (!data) continue

      // 判定市場別：.TW → 上市(TWSE)，.TWO → 上櫃(TPEx)
      const market: 'TWSE' | 'TPEx' = symbol.endsWith('.TWO') ? 'TPEx' : 'TWSE'

      // ── Supplement missing recent trading days from TWSE / TPEx ──────────────
      // Only run for range queries (not from/to period queries used by chart overlay)
      if (!from && !to) {
        const latestYahoo  = data[data.length - 1].date
        const latestNeeded = latestTaiwanWeekday()

        if (latestYahoo < latestNeeded) {
          const stockNo = symbol.split('.')[0]
          // Try both current month and previous month in case of month boundary
          const targetDate   = new Date(latestNeeded + 'T12:00:00Z')
          const currentYYYYMM = `${targetDate.getUTCFullYear()}${String(targetDate.getUTCMonth()+1).padStart(2,'0')}01`
          const currentROCYM  = toROCSlash(latestNeeded).slice(0, -3) // "115/05"

          let extra: { date: string; value: number }[] = []
          if (symbol.endsWith('.TW')) {
            extra = await fetchTWSEMonthly(stockNo, currentYYYYMM)
          } else if (symbol.endsWith('.TWO')) {
            extra = await fetchTPExMonthly(stockNo, currentROCYM)
          }

          if (extra.length > 0) {
            // Merge: add any dates not already in Yahoo data
            const existing = new Set(data.map(d => d.date))
            const newRows   = extra.filter(r => !existing.has(r.date))
            if (newRows.length > 0) {
              data = [...data, ...newRows].sort((a, b) => a.date < b.date ? -1 : 1)
            }
          }
        }
      }

      const payload = { data, market }
      setCached(cacheKey, payload, 30 * 60 * 1000)
      return NextResponse.json(payload)
    }
    throw new Error(`找不到 "${ticker}" 的資料（已嘗試：${candidates.join('、')}）`)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
